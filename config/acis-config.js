// ================================================================
// ACIS 설정 파일 — 운영 중 조정 가능한 임계값/시나리오 가정
// ================================================================
// 이 파일의 값을 변경하고 페이지를 새로고침하면 즉시 반영됩니다.
// 백테스트로 검증 후 수치 조정 권장.
//
// 전역 노출: window.ACIS_CONFIG
// ================================================================

window.ACIS_CONFIG = {

  // ---------------- 신호 임계값 ----------------
  // RPCI vs 이동평균 편차(%)에 따른 신호 분류
  // 기존 ±3% buy/avoid 동작은 그대로 보존, ±10% 초과에서 STRONG_ 발화
  signal: {
    // 단기(60일 MA) / 중장기(90일 MA) 공통 임계값
    waitBand:    3,    // ±3% 이내: HOLD (기존 wait 보존)
    strongBand: 10,    // ±10% 초과: STRONG_BUY 또는 STRONG_AVOID 후보
    //
    // STRONG_은 추가 조건: 단기·중장기 신호 방향이 일치해야 발화
    // (noise 방어 — 단기 신호 하나만으로 STRONG_ 발화 금지)
    requireDualConfirmForStrong: true,
  },

  // ---------------- 환율 추세 보조 판단 ----------------
  // 결론 헤더에서 신호 강화/약화에 사용
  fxTrend: {
    risingThreshold:  0.5,   // CNY/KRW 5일 변화율 > +0.5%면 "상승 추세"
    fallingThreshold: -0.5,  // < -0.5%면 "하락(안정적) 추세"
  },

  // ---------------- 백테스트 ----------------
  backtest: {
    horizonDays: 30,        // 예측 기간
    minHistory: 60,         // 최소 학습 데이터 길이
    cacheKey: 'acis_backtest_v1',
    poorAccuracy: {
      mapeThreshold: 5,     // MAPE > 5% → 정확도 낮음 경고
      dirAccThreshold: 55,  // 방향성 적중률 < 55% → 경고
    },
  },

  // ---------------- 시나리오 (P2-A) ----------------
  // Bull/Base/Bear 시나리오 가정 — 운영하면서 백테스트로 조정
  // 출처: 지시서 § P2-A 초기값. 실제 시장 검증 후 보정 필요.
  scenarios: {
    bull: {
      label: '낙관 (Bull)',
      shortName: 'Bull',
      color: '#22c55e',
      shfeMultiplier: 1.3,    // 최근 14일 모멘텀 × 1.3
      fxDelta: -0.02,         // 환율 -2% (원화 강세)
      ciMultiplier: 1.0,      // 신뢰구간 폭 기본
      description: '원자재 가격 상승 가속 + 원화 강세',
    },
    base: {
      label: '기준 (Base)',
      shortName: 'Base',
      color: '#a855f7',
      shfeMultiplier: 1.0,    // 모델 그대로
      fxDelta: 0.0,
      ciMultiplier: 1.0,
      description: '현재 모델 추세 그대로 진행',
    },
    bear: {
      label: '비관 (Bear)',
      shortName: 'Bear',
      color: '#ef4444',
      shfeMultiplier: 0.5,    // 추세 완화 + 평균 회귀 강화
      meanReversion: true,    // bear는 평균회귀 강화
      fxDelta: 0.03,          // 환율 +3% (원화 약세)
      ciMultiplier: 1.2,      // 불확실성 증가 → CI 폭 1.2배
      description: '수요 둔화 + 원화 약세 위험',
    },
    default: 'base',
  },

  // ---------------- BEP (손익분기 환율) ----------------
  bep: {
    lineColor: '#fbbf24',      // 호박색
    lineWidth: 1.5,
    lineDash: [6, 4],
  },

  // ---------------- 환율 위험구간 (P2-B) ----------------
  // cnyDanger 임계값(상위 15% 분위수)을 시각적으로 강조
  fxDanger: {
    lineColor: '#ef4444',           // 빨간 점선
    lineWidth: 1.2,
    lineDash: [5, 4],
    labelText: '위험구간 임계',     // 가로선 라벨
    fillAbove: 'rgba(239,68,68,0.10)',  // 임계선 위쪽 음영
  },

  // ---------------- 뉴 노멀 (v2.1 §4.4) ----------------
  // 미국-이란 전쟁 이후 형성된 구조적 가격 상승 환경을 모델에 반영하는 모듈.
  // 기준가(baseSHFE, preWarSHFE)는 admin.html에서 입력 → localStorage('acis_newnormal').
  // 본 config 값은 입력 누락 시의 fallback 및 임계값으로 사용.
  newNormal: {
    enabled: true,                  // 기능 토글 (false면 §4.4 카드 비표시)
    bandWidthPct: 5,                // 기준가 ±5% 를 New Normal 밴드로 음영
    spi: {                          // 구조적 가격지수 (SPI) = 현재 RPCI ÷ 뉴노멀 기준 RPCI
      buyMax:    1.02,              // SPI ≤ 1.02 → 매수 후보
      holdMax:   1.05,              // 1.02 < SPI ≤ 1.05 → 관망
      // SPI > 1.05 → 자제 (밴드 상단 돌파 경계)
    },
    eri: {                          // 환율지수 (ERI) = 현재 CNY/KRW ÷ 90일 평균
      favorableMax: 0.98,           // ERI ≤ 0.98 → 환율 유리 (BUY 확정 조건)
      unfavorableMin: 1.02,         // ERI ≥ 1.02 → 환율 불리 경계
    },
    colors: {
      band:       'rgba(201,168,76,0.10)',   // New Normal 밴드 음영 (gold 10%)
      bandBorder: 'rgba(201,168,76,0.45)',
      preWarLine: '#9aa3ba',                 // 전쟁 이전 평균 참조선 (silver, dashed)
    },
    fallback: {
      // admin에서 기준가를 입력하지 않은 경우 사용할 대략값
      // (실데이터 누적 후 admin에서 정확한 수치로 갱신할 것)
      baseSHFE:   20500,            // 2026년 New Normal 기준 SHFE 가격 (CNY/MT)
      preWarSHFE: 18000,            // 전쟁 이전(~2025) 평균 SHFE 가격 (CNY/MT)
    },
  },

  // ---------------- 매수/자제 오버레이 색상 ----------------
  signalOverlay: {
    buy:    'rgba(34, 197, 94, 0.12)',   // 녹색 12%
    wait:   'rgba(245, 158, 11, 0.10)',  // 황색 10%
    avoid:  'rgba(239, 68, 68, 0.12)',   // 적색 12%
    labelColors: {
      buy:    '#22c55e',
      wait:   '#f59e0b',
      avoid:  '#ef4444',
    },
  },

};
