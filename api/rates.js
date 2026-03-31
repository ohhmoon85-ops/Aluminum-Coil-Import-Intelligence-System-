// Vercel Serverless Function — 한국은행 ECOS API 환율 수집
// USD/KRW, CNY/KRW 최근 120일치 가져오기
// + Yahoo Finance 실시간 보완 (ECOS 1~2일 지연 보정)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.BOK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'BOK_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  // 날짜 범위: 오늘 기준 120일 전 ~ 오늘 (주말·공휴일 제외 약 90 거래일)
  const today = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 150);

  const fmt = (d) =>
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');

  const start = fmt(from);
  const end = fmt(today);

  // 한국은행 ECOS 통계 조회 API
  // 통계표: 731Y001 (일반환율), 항목: 0000001=USD, 0000053=CNY
  const BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';

  const urls = {
    usd: `${BASE}/${apiKey}/json/kr/1/200/731Y001/D/${start}/${end}/0000001`,
    cny: `${BASE}/${apiKey}/json/kr/1/200/731Y001/D/${start}/${end}/0000053`,
  };

  try {
    const [usdRes, cnyRes] = await Promise.all([
      fetch(urls.usd),
      fetch(urls.cny),
    ]);

    if (!usdRes.ok || !cnyRes.ok) {
      throw new Error(`HTTP 오류 — USD:${usdRes.status} CNY:${cnyRes.status}`);
    }

    const usdJson = await usdRes.json();
    const cnyJson = await cnyRes.json();

    // ECOS API 오류 응답 처리
    if (usdJson.RESULT) {
      throw new Error(`ECOS 오류: ${usdJson.RESULT.MESSAGE}`);
    }

    const usdRows = usdJson.StatisticSearch?.row || [];
    const cnyRows = cnyJson.StatisticSearch?.row || [];

    if (usdRows.length === 0 || cnyRows.length === 0) {
      throw new Error('데이터가 없습니다. API 키를 확인하세요.');
    }

    // Yahoo Finance 실시간 환율 보완 (ECOS 1~2일 지연 보정)
    // USDKRW=X, CNYKRW=X 현재가 조회
    let currentUsd = null;
    let currentCny = null;

    const yahooUrls = [
      'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=5d',
      'https://query2.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=5d',
    ];
    const yahooCnyUrls = [
      'https://query1.finance.yahoo.com/v8/finance/chart/CNYKRW=X?interval=1d&range=5d',
      'https://query2.finance.yahoo.com/v8/finance/chart/CNYKRW=X?interval=1d&range=5d',
    ];

    try {
      for (const yUrl of yahooUrls) {
        const yRes = await fetch(yUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
        });
        if (!yRes.ok) continue;
        const yJson = await yRes.json();
        const meta = yJson?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          currentUsd = parseFloat(meta.regularMarketPrice.toFixed(2));
          break;
        }
      }
    } catch (e) {
      console.warn('[rates/Yahoo/USD] 실시간 조회 실패:', e.message);
    }

    try {
      for (const yUrl of yahooCnyUrls) {
        const yRes = await fetch(yUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
        });
        if (!yRes.ok) continue;
        const yJson = await yRes.json();
        const meta = yJson?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          currentCny = parseFloat(meta.regularMarketPrice.toFixed(2));
          break;
        }
      }
    } catch (e) {
      console.warn('[rates/Yahoo/CNY] 실시간 조회 실패:', e.message);
    }

    return res.status(200).json({
      usd: usdRows,  // [{ TIME: '20260320', DATA_VALUE: '1374.5' }, ...]
      cny: cnyRows,
      currentUsd,   // Yahoo Finance 실시간 USD/KRW (null이면 ECOS 최신값 사용)
      currentCny,   // Yahoo Finance 실시간 CNY/KRW (null이면 ECOS 최신값 사용)
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[rates] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
