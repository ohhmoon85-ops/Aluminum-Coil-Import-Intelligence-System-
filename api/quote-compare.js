// ============================================================================
// Vercel Serverless Function — 공급자 견적 도착 최저가 (실시간 총액) 단일 진실 공급원
// ----------------------------------------------------------------------------
// index.html ⑥번 섹션의 computeQuote() + SMM 반영 로직을 서버에서 재현해 JSON 반환.
// 홍지 OMWIS 등 외부 시스템은 이 엔드포인트만 받아쓰면 ACIS UI 와 항상 완벽 일치.
//
// 산식 출처 (그대로 복제):
//   · DEFAULT_QUOTES         index.html:5744
//   · computeQuote()         index.html:5872
//   · SMM 반영(실시간 총액)  index.html:5893 (smmAdjTotalKrw)
//
// SMM 값 저장:
//   현재는 브라우저 localStorage 기반이라 서버가 볼 수 없음. MVP 로 환경변수
//   LATEST_SMM_CNY (CNY/MT) 를 Vercel 에 세팅하면 반영. 미설정 시 fallback 23200
//   (모든 견적의 smmAtQuote 와 동일) → SMM 조정치 0 → 견적 확정치 = 실시간 총액.
//
// TODO(Phase 2): SMM 을 Vercel KV 로 이전, ACIS UI 저장 시 자동 서버 반영.
// ============================================================================

// ── 프리셋 견적 (index.html 5744~ 와 동일 · smmAtQuote 포함) ────────────────
const DEFAULT_QUOTES = [
  { id:'xd-raw-coil',  supplier:'신다통 (Xindatong)', product:'raw-coil',  inco:'CIF', currency:'USD', pricePerTon:4129,    cut:false, date:'2026-07-24', smmAtQuote:23200 },
  { id:'xd-raw-sheet', supplier:'신다통 (Xindatong)', product:'raw-sheet', inco:'CIF', currency:'USD', pricePerTon:4203,    cut:true,  date:'2026-07-24', smmAtQuote:23200 },
  { id:'xd-dos-coil',  supplier:'신다통 (Xindatong)', product:'dos-coil',  inco:'CIF', currency:'USD', pricePerTon:4277,    cut:false, date:'2026-07-24', smmAtQuote:23200 },
  { id:'ws-raw-coil',  supplier:'워스윌 (Worthwill)', product:'raw-coil',  inco:'CIF', currency:'USD', pricePerTon:4146.44, cut:false, date:'2026-07-15', smmAtQuote:23200 },
  { id:'ws-dos-coil',  supplier:'워스윌 (Worthwill)', product:'dos-coil',  inco:'CIF', currency:'USD', pricePerTon:4412.44, cut:false, date:'2026-07-15', smmAtQuote:23200 },
];

// index.html 5819~ getQuoteParams() 기본값과 동일
const DEFAULTS = {
  freight:  39,        // FOB→CIF USD/톤
  overhead: 35000,     // 부대비 원/톤
  tariff:   7.2,       // % (한중FTA)
  domestic: 6500,      // 국내 비교가 원/kg
  kgm2:     0.3252,    // 0.17mm 기준 kg/㎡
};

// v2.7: DOS 오일은 별도 관세율(1.2%) — index.html 의 quoteTariffPct 와 동일 규칙 (값 복제)
const DOS_TARIFF_PCT = 1.2;
function quoteTariffPct(product, globalPct) {
  return (typeof product === 'string' && product.startsWith('dos')) ? DOS_TARIFF_PCT : globalPct;
}

// index.html 5872~ computeQuote 그대로
function computeQuote(q, p, smmCurrentCny) {
  const usdPerTon = q.currency === 'CNY' ? (q.pricePerTon / p.usdCny) : q.pricePerTon;
  const cifUsd    = q.inco === 'FOB' ? (usdPerTon + p.freight) : usdPerTon;
  const cifKrw    = cifUsd * p.usdKrw;
  const tariffPct = quoteTariffPct(q.product, p.tariff);   // DOS 1.2% / 그 외 7.2%
  const tariffKrw = cifKrw * (tariffPct / 100);
  const totalKrw  = cifKrw + tariffKrw + p.overhead;    // 견적 확정치
  const perKg     = totalKrw / 1000;
  const perM2     = perKg * p.kgm2;
  const marginPct = p.domestic > 0 ? ((p.domestic - perKg) / p.domestic * 100) : 0;

  // SMM 반영 실시간 총액 — index.html 5893~ 동일
  const cifCny = cifUsd * p.usdCny;
  let smmDeltaCny = null, smmAdjTotalKrw = totalKrw, smmAdjPerKg = perKg;
  if (q.smmAtQuote && smmCurrentCny && smmCurrentCny > 0) {
    smmDeltaCny = smmCurrentCny - q.smmAtQuote;
    const adjCifCny = cifCny + smmDeltaCny;
    const adjCifUsd = p.usdCny > 0 ? (adjCifCny / p.usdCny) : cifUsd;
    const adjCifKrw = adjCifUsd * p.usdKrw;
    smmAdjTotalKrw = adjCifKrw * (1 + tariffPct / 100) + p.overhead;
    smmAdjPerKg = smmAdjTotalKrw / 1000;
  }

  return {
    ...q,
    cifUsd, cifKrw, tariffKrw, tariffPct,   // v2.7: 적용 관세율(%) — DOS 1.2% / 그 외 7.2%
    totalKrw,         // 견적 확정치 (SMM 반영 전)
    perKg,
    perM2,
    marginPct,
    // 실시간 총액 (SMM 반영) — OMWIS 카드가 표시할 값
    smmAdjTotalKrw,
    smmAdjPerKg,
    smmDeltaCny,
    smmAtQuote: q.smmAtQuote ?? null,
    smmCurrentCny: smmCurrentCny ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 10분 edge 캐시 + 30분 SWR — OMWIS 도 10분 revalidate 이므로 정합
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');

  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const base = `${proto}://${req.headers.host}`;

    // 실시간 환율
    const ratesRes = await fetch(`${base}/api/rates`);
    if (!ratesRes.ok) throw new Error(`rates ${ratesRes.status}`);
    const rates = await ratesRes.json();
    if (rates.error) throw new Error('rates: ' + rates.error);

    const usdKrw = Number(rates.currentUsd)
      || parseFloat(rates.usd?.[rates.usd.length - 1]?.DATA_VALUE)
      || 1470;
    const cnyKrw = Number(rates.currentCny)
      || parseFloat(rates.cny?.[rates.cny.length - 1]?.DATA_VALUE)
      || 217.8;
    const usdCny = cnyKrw > 0 ? usdKrw / cnyKrw : 6.75;

    // 최신 SMM (CNY/MT) — 환경변수 미설정 시 baseline 23200 (조정치 0)
    const smmCurrent = Number(process.env.LATEST_SMM_CNY) || 23200;

    const params = { ...DEFAULTS, usdKrw, cnyKrw, usdCny };

    const computed = DEFAULT_QUOTES.map((q) => computeQuote(q, params, smmCurrent));

    return res.status(200).json({
      quotes: computed,
      params,
      smmCurrentCny: smmCurrent,
      smmSource: process.env.LATEST_SMM_CNY ? 'env' : 'fallback',
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[quote-compare] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
