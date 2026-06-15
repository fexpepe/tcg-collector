// Amostra LOCAL de preços de referência (dev). Em produção o deploy gera
// data/pricing.generated.js a partir do pricing da TCGdex (sync + merge).
// Formato: { cardId: { u: USD (TCGplayer), e: EUR (Cardmarket) } }.
window.TCG_PRICING = {
  "base1-4": { u: 320.50, e: 290.00 },
  "base1-2": { u: 180.00, e: 165.00 },
  "base1-15": { u: 95.00, e: 88.00 },
  "base1-92": { u: 2.50, e: 1.80 },
  "xy12-35": { u: 4.20, e: 3.50 },
  "swsh3-136": { u: 1.10, e: 0.90 },
  "swsh3-159": { u: 6.80, e: 5.40 },
  "sv3pt5-6": { u: 0.50, e: 0.40 },
  "sv3pt5-6-pt": { u: 0.45, e: 0.35 },
  "sv3pt5-199": { u: 12.00, e: 10.50 },
  "sv03.5-199-pt": { u: 11.00, e: 9.80 },
  "SV9-001-ja": { u: 0.80, e: 0.70 },
  "SV9-010-zh": { u: 0.30, e: 0.25 }
};
