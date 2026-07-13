// ============================================================================
// Vercel Serverless Function — ACIS 구매 신호 (단일 진실 공급원)
// ----------------------------------------------------------------------------
// index.html 의 evaluateNewNormal() 과 "동일한 산식"을 서버에서 계산해 JSON 반환.
// 외부(예: 홍지 OMWIS 대시보드)는 이 엔드포인트만 받아쓰면 UI 와 항상 일치한다.
//
// 산식 출처(그대로 복제):
//   · calcRPCI()          index.html:2940
//   · padTo90()           index.html:3710
//   · 데이터 파이프라인    index.html:loadRealData (3771~)
//   · 신호 결정            index.html:evaluateNewNormal (4160~)
//   · 임계값              config/acis-config.js (newNormal.spi / .eri)
//
// 주의: 기준가(baseSHFE)는 index.html 이 브라우저 localStorage('acis_newnormal')
//   에서 admin 값을 읽지만, 서버는 그것을 볼 수 없어 config 의 fallback 을 사용한다.
//   admin 에서 기준가를 커스텀하지 않는 한(현재 상태) UI 와 완전히 일치한다.
// ============================================================================

// ── index.html 과 동일한 순수 함수 ──────────────────────────────────────────
function calcRPCI(shfe_cny, cny_krw, tariff = 0.05, misc = 0.03) {
  const shipping = 55000; // KRW/MT
  return parseFloat(((shfe_cny * cny_krw + shipping) * (1 + tariff + misc)).toFixed(0));
}

function padTo90(arr) {
  const a = [...arr];
  while (a.length < 90) a.unshift(a[0]);
  return a.slice(-90);
}

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// config/acis-config.js 를 정적 자산으로 받아 window.ACIS_CONFIG 를 추출 (임계값 단일 소스)
async function loadConfig(base) {
  try {
    const res = await fetch(`${base}/config/acis-config.js`);
    if (!res.ok) throw new Error(`config ${res.status}`);
    const text = await res.text();
    const window = {}; // 파일이 window.ACIS_CONFIG = {...} 형태
    // eslint-disable-next-line no-eval
    eval(text);
    return window.ACIS_CONFIG || null;
  } catch (e) {
    console.warn('[signal] config load failed, using inline fallback:', e.message);
    return null;
  }
}

// config 로드 실패 시 사용할 최소 임계값 (config/acis-config.js 와 동일하게 유지)
const INLINE = {
  newNormal: {
    spi: { buyMax: 1.02, holdMax: 1.05 },
    eri: { favorableMax: 0.98, unfavorableMin: 1.02 },
    fallback: { baseSHFE: 25250 },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');

  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const base = `${proto}://${req.headers.host}`;

    const [cfgRaw, ratesRes, alRes, lmeRes] = await Promise.all([
      loadConfig(base),
      fetch(`${base}/api/rates`),
      fetch(`${base}/api/aluminum`),
      fetch(`${base}/api/lme`),
    ]);
    if (!ratesRes.ok || !alRes.ok) {
      throw new Error(`upstream ${ratesRes.status}/${alRes.status}`);
    }

    const rates = await ratesRes.json();
    const alJson = await alRes.json();
    const lmeJson = lmeRes.ok ? await lmeRes.json() : null;
    if (rates.error) throw new Error('rates: ' + rates.error);
    if (alJson.error) throw new Error('aluminum: ' + alJson.error);

    const nn = ((cfgRaw && cfgRaw.newNormal) || INLINE.newNormal);
    const sCfg = nn.spi, eCfg = nn.eri;
    const baseSHFE = (nn.fallback && nn.fallback.baseSHFE) || 25250;

    // ── 시계열 구성 (loadRealData 와 동일) ──
    const cnyRows = (rates.cny || []).filter((r) => r.DATA_VALUE && r.DATA_VALUE !== '-');
    const usdRows = (rates.usd || []).filter((r) => r.DATA_VALUE && r.DATA_VALUE !== '-');
    if (cnyRows.length < 20) throw new Error('환율 데이터 부족');

    const cnyHist = padTo90(cnyRows.map((r) => parseFloat(r.DATA_VALUE)));
    const usdHist = padTo90(usdRows.map((r) => parseFloat(r.DATA_VALUE)));
    // Yahoo 실시간 최신값 보정 (ECOS 1~2일 지연)
    if (rates.currentCny && rates.currentCny > 0) cnyHist[cnyHist.length - 1] = rates.currentCny;
    if (rates.currentUsd && rates.currentUsd > 0) usdHist[usdHist.length - 1] = rates.currentUsd;

    const alData = (alJson.data || []).filter((d) => d.price && d.price > 0);
    if (alData.length < 20) throw new Error('알루미늄 데이터 부족');
    const shfeHist = padTo90(alData.map((d) => d.price)); // index.html 의 lmeHist(=SHFE CNY/MT)

    // ── 지표 (evaluateNewNormal 과 동일) ──
    const curCny = cnyHist[cnyHist.length - 1];
    const curUsd = usdHist[usdHist.length - 1];
    const curShfe = shfeHist[shfeHist.length - 1];

    const currentRPCI = calcRPCI(curShfe, curCny);         // rpciHist 마지막과 동일
    const baseRpci = calcRPCI(baseSHFE, curCny);
    const spi = baseRpci > 0 ? currentRPCI / baseRpci : null;
    const cnyAvg = mean(cnyHist);
    const eri = cnyAvg > 0 ? curCny / cnyAvg : null;
    if (spi === null || eri === null) throw new Error('지표 계산 불가');

    // ── 4단계 신호 (evaluateNewNormal 분기 그대로) ──
    const priceDiffPct = ((spi - 1) * 100).toFixed(1);
    const fxDiffPct = ((eri - 1) * 100).toFixed(1);
    const priceTxt = (priceDiffPct >= 0 ? '+' : '') + priceDiffPct + '%';
    const fxTxt = (fxDiffPct >= 0 ? '+' : '') + fxDiffPct + '%';

    let signal, label, detail;
    if (spi > sCfg.holdMax) {
      signal = 'AVOID'; label = '자제';
      detail = `알루미늄 가격이 뉴 노멀 기준 대비 ${priceTxt} 비쌉니다. 추가 상승 압력 — 신규 발주를 자제하세요.`;
    } else if (spi <= sCfg.buyMax && eri <= eCfg.favorableMax) {
      signal = 'BUY'; label = '매수';
      detail = `가격은 기준 대비 ${priceTxt}, 환율도 90일 평균 대비 ${fxTxt} 유리합니다. 가격·환율 동시 좋은 절호의 매수 시점.`;
    } else if (spi <= sCfg.buyMax && eri > eCfg.favorableMax) {
      signal = 'FX-WAIT'; label = '환율 대기';
      detail = `가격은 좋습니다(기준 대비 ${priceTxt})만 환율이 평균 대비 ${fxTxt} 불리합니다. 환율 진정될 때까지 대기.`;
    } else {
      signal = 'HOLD'; label = '관망';
      detail = `가격이 기준 근처(${priceTxt}), 환율도 평균 근처(${fxTxt}) — 뚜렷한 우위 없음. 소량 분할 구매 또는 환율 유리해질 때까지 관망.`;
    }

    const lmeUsd = lmeJson && !lmeJson.error && (lmeJson.data || []).length
      ? lmeJson.data[lmeJson.data.length - 1].price
      : null;

    return res.status(200).json({
      signal,                                   // 'BUY' | 'FX-WAIT' | 'HOLD' | 'AVOID'
      label,                                    // '매수' | '환율 대기' | '관망' | '자제'
      spi: Math.round(spi * 1000) / 1000,       // 비율 (예: 0.949)
      eri: Math.round(eri * 1000) / 1000,       // 비율 (예: 1.009)
      rpci: currentRPCI,                        // 원/MT
      shfe_price: curShfe,                      // SHFE CNY/MT
      lme_price: lmeUsd,                        // LME USD/MT (참고)
      cny_krw: curCny,
      usd_krw: curUsd,
      base_shfe: baseSHFE,
      recommendation: detail,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[signal] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
