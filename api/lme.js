// Vercel Serverless Function — LME 알루미늄 현물가 수집
// Yahoo Finance ALI=F (CME Aluminum Futures, USD/MT) — LME 연동 참고가
// LME 공식 API는 유료이므로 Yahoo Finance를 참고가로 사용

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/ALI=F' +
    '?interval=1d&range=6mo&includePrePost=false';

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });

    if (!response.ok) throw new Error(`Yahoo Finance HTTP 오류: ${response.status}`);

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('Yahoo Finance 데이터 없음');

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const data = timestamps
      .map((ts, i) => ({
        date:  new Date(ts * 1000).toISOString().slice(0, 10),
        price: closes[i] != null ? parseFloat(closes[i].toFixed(1)) : null,
      }))
      .filter(d => d.price !== null && d.price > 0);

    if (data.length < 20) throw new Error('LME 데이터 부족');

    return res.status(200).json({
      data,
      symbol: 'ALI=F',
      unit: 'USD/MT',
      source: 'Yahoo Finance (CME Aluminum Futures — LME 연동 참고가)',
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[lme] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
