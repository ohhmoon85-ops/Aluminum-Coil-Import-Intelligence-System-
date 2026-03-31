// Vercel Serverless Function — SHFE 알루미늄 가격 수집
// 상하이선물거래소(SHFE) 알루미늄 주력 계약 (AL9999), 단위: CNY/MT
// 출처: 东方财富(Eastmoney) 공공 API

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Eastmoney SHFE 알루미늄 주력 계약 일봉 데이터
  // secid: 113 = SHFE, AL9999 = 알루미늄 주력합약
  // iscca/forcect 제거: 선물 계약에 불필요, 빈 klines 원인
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
    '?secid=113.AL9999' +
    '&klt=101' +       // 일봉
    '&fqt=0' +
    '&lmt=200' +       // 최근 200거래일
    '&end=20991231' +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56';

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://quote.eastmoney.com/',
      },
    });

    if (!response.ok) throw new Error(`Eastmoney HTTP 오류: ${response.status}`);

    const json = await response.json();
    const klines = json?.data?.klines;

    // 응답 구조 디버깅 (빈 klines 시 원인 파악용)
    if (!klines || klines.length === 0) {
      const preview = JSON.stringify(json).slice(0, 300);
      throw new Error(`SHFE 알루미늄 데이터 없음. 응답: ${preview}`);
    }

    // 각 kline 형식: "날짜,시가,종가,최고,최저,거래량"
    const data = klines.map((k) => {
      const parts = k.split(',');
      return {
        date:  parts[0],                           // YYYY-MM-DD
        price: parseFloat(parseFloat(parts[2]).toFixed(0)), // 종가 CNY/MT
        open:  parseFloat(parts[1]),
        high:  parseFloat(parts[3]),
        low:   parseFloat(parts[4]),
      };
    }).filter(d => d.price > 0);

    if (data.length < 20) throw new Error('SHFE 데이터 부족');

    return res.status(200).json({
      data,
      symbol: 'AL9999',
      unit: 'CNY/MT',
      source: '上海期货交易所 (SHFE) — 东方财富 제공',
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[aluminum/SHFE] 오류:', err.message);

    // 폴백: Yahoo Finance ALI=F (CME, USD/MT) → CNY 환산
    // query1 → query2 순서로 시도 (IP 차단 우회)
    const fallbackUrls = [
      'https://query1.finance.yahoo.com/v8/finance/chart/ALI=F?interval=1d&range=6mo&includePrePost=false',
      'https://query2.finance.yahoo.com/v8/finance/chart/ALI=F?interval=1d&range=6mo&includePrePost=false',
    ];

    for (const fallbackUrl of fallbackUrls) {
      try {
        const fbRes = await fetch(fallbackUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json',
          },
        });
        if (!fbRes.ok) continue;

        const fbJson = await fbRes.json();
        const result = fbJson?.chart?.result?.[0];
        if (!result) continue;

        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        const USD_CNY = 7.25; // 고정 환산율 (폴백용)

        const data = timestamps
          .map((ts, i) => ({
            date:  new Date(ts * 1000).toISOString().slice(0, 10),
            price: closes[i] != null
              ? parseFloat((closes[i] * USD_CNY).toFixed(0))  // USD→CNY 환산
              : null,
          }))
          .filter(d => d.price !== null && d.price > 0);

        if (data.length < 20) continue;

        return res.status(200).json({
          data,
          symbol: 'ALI=F (CME→CNY 환산)',
          unit: 'CNY/MT (추정)',
          source: 'Yahoo Finance CME → USD/CNY 7.25 환산 (SHFE API 장애 시 폴백)',
          fetchedAt: new Date().toISOString(),
          fallback: true,
        });

      } catch (fbErr) {
        console.error('[aluminum/Yahoo] 폴백 실패:', fallbackUrl, fbErr.message);
      }
    }

    return res.status(500).json({ error: err.message });
  }
}
