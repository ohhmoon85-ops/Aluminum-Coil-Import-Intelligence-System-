// Vercel Serverless Function — 알루미늄 선물 가격 수집
// Yahoo Finance 비공식 API (ALI=F: CME 알루미늄 선물, USD/MT)
// ※ LME 공식 API는 유료 구독 필요. 추후 LME DataConnect API로 교체 가능.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 야후 파이낸스 — ALI=F (Aluminum Futures, USD/MT)
  // 6개월치 일별 데이터
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/ALI=F' +
    '?interval=1d&range=6mo&includePrePost=false';

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance HTTP 오류: ${response.status}`);
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];

    if (!result) {
      throw new Error('Yahoo Finance 데이터 구조 오류');
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // 유효한 거래일만 필터링 (null 제거)
    const data = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        price: closes[i] != null ? parseFloat(closes[i].toFixed(2)) : null,
      }))
      .filter((d) => d.price !== null && d.price > 0);

    if (data.length < 20) {
      throw new Error('알루미늄 가격 데이터 부족');
    }

    return res.status(200).json({
      data,
      symbol: 'ALI=F',
      unit: 'USD/MT',
      source: 'Yahoo Finance (CME Aluminum Futures)',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[aluminum] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
