// Preço de referência POR IMPRESSÃO — o contrato entre os syncs (TCGdex, TCGCSV,
// PPT), o merge e o cliente (shared.js#cardValue). Sem dependências: as funções
// são puras de propósito, pra serem travadas por teste sem rede.
//
// Formato de uma entrada de data/pricing.generated.js:
//   { u: USD "principal", e: EUR (Cardmarket), v?: { <variante>: USD }, uf?, b?, g? }
//
// Por que `v` existe (14/09/2026): a tabela guardava UM número por carta, e ele
// era a primeira impressão com preço na ordem Normal → Holo → Reverse → 1st
// Edition. Uma carta com Normal a US$ 3 e Reverse a US$ 300 saía valendo US$ 3
// no tile do Reverse, na Coleção e na ordenação por valor — o Bulbasaur
// 95/165 da Expedition aparecia a R$ 343 quando o Reverse vale R$ 1.800. 8.127
// das 21.594 cartas EN têm Normal + alguma foil/1st, então não era caso raro.
// `u` continua existindo (é o que o histórico de preços, o índice de mercado e
// o manifest somam), e `v` leva o preço de CADA impressão; o cliente escolhe
// pela variante do tile e cai em `u` quando a impressão não tem cotação.

// Nomes de variante do catálogo (os mesmos que o sync-tcgdex grava em
// card.variants): Normal, Reverse, Holo, 1st Edition. "W Promo" não tem preço
// próprio em fonte nenhuma e cai em `u`.
export const VARIANTS = ["Normal", "Holo", "Reverse", "1st Edition"];

// Chave de impressão da fonte -> variante do catálogo. Cobre a TCGdex
// (tcgplayer.normal / holofoil / reverseHolofoil / 1stEditionHolofoil /
// 1stEdition, e a grafia com hífen que já apareceu no payload), a TCGCSV
// (subTypeName "Normal" / "Holofoil" / "Reverse Holofoil" / "1st Edition
// Holofoil" / "1st Edition" / "Unlimited" / "Unlimited Holofoil") e a PPT
// (prices.variants com nomes livres). Normaliza pra minúsculas sem separador.
export function variantOfPrinting(key) {
  const s = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s) return null;
  if (s.includes("1stedition") || s.includes("firstedition")) return "1st Edition";
  if (s.includes("reverse")) return "Reverse";
  if (s.includes("holo") || s.includes("foil")) return "Holo";
  if (s.includes("normal") || s.includes("unlimited") || s === "nonfoil") return "Normal";
  return null;
}

// Ordem de preferência do `u` (a impressão "principal"). É a MESMA ordem de
// antes de propósito: `u` alimenta o histórico de preços (price-history) e uma
// troca de critério recomeçaria todas as séries num degrau falso.
const MAIN_ORDER = ["Normal", "Holo", "Reverse", "1st Edition"];

const r2 = (x) => Math.round(x * 100) / 100;

// Monta { u, v } a partir de um mapa variante -> USD (já normalizado). `v` só
// viaja quando acrescenta algo além de `u`: uma carta só-Normal ou só-Holo tem
// um preço só, e repetir ele em `v` custaria bytes em 50 mil entradas.
export function packVariantPrices(byVariant) {
  const clean = {};
  for (const [variant, usd] of Object.entries(byVariant || {})) {
    if (VARIANTS.includes(variant) && Number(usd) > 0) clean[variant] = r2(Number(usd));
  }
  const keys = Object.keys(clean);
  if (!keys.length) return null;
  const main = MAIN_ORDER.find((k) => clean[k] > 0) || keys[0];
  const out = { u: clean[main] };
  if (keys.length > 1) out.v = clean;
  return out;
}

// Payload `pricing` de um card completo da TCGdex -> { u, e, v? } ou null.
// USD do TCGplayer por impressão (market > mid > low), EUR do Cardmarket (avg >
// trend > avg-holo > low > low-holo — um valor só, o Cardmarket não separa
// impressão de forma confiável na TCGdex).
export function compactTcgdexPrice(pricing) {
  if (!pricing || typeof pricing !== "object") return null;
  const tp = pricing.tcgplayer || {};
  const cm = pricing.cardmarket || {};
  const pick = (obj, keys) => {
    for (const k of keys) { const v = obj && obj[k]; if (typeof v === "number" && v > 0) return v; }
    return 0;
  };
  const byVariant = {};
  for (const [key, node] of Object.entries(tp)) {
    if (!node || typeof node !== "object") continue;
    const variant = variantOfPrinting(key);
    if (!variant) continue;
    const usd = pick(node, ["marketPrice", "midPrice", "lowPrice"]);
    // Duas chaves na mesma variante (holofoil + unlimitedHolofoil): fica a maior
    // cotação — a de mercado da impressão que existe de verdade.
    if (usd > 0 && !(byVariant[variant] >= usd)) byVariant[variant] = usd;
  }
  const packed = packVariantPrices(byVariant) || {};
  const eur = pick(cm, ["avg", "trendPrice", "avg-holo", "low", "low-holo"]);
  if (eur > 0) packed.e = r2(eur);
  return (packed.u > 0 || packed.e > 0) ? packed : null;
}

// Linhas de preço da TCGCSV de UM produto ([{ subTypeName, marketPrice, midPrice,
// lowPrice }]) -> { u, v? } ou null.
export function compactTcgcsvPrice(rows) {
  const byVariant = {};
  for (const p of rows || []) {
    const variant = variantOfPrinting(p && p.subTypeName);
    if (!variant) continue;
    const usd = Number(p.marketPrice) > 0 ? Number(p.marketPrice)
      : (Number(p.midPrice) > 0 ? Number(p.midPrice) : (Number(p.lowPrice) > 0 ? Number(p.lowPrice) : 0));
    if (usd > 0 && !(byVariant[variant] >= usd)) byVariant[variant] = usd;
  }
  return packVariantPrices(byVariant);
}

// Um card da PPT (prices.market + prices.variants) -> { u, v? } ou null. O
// `market` é a impressão principal; `variants` (quando vem) é { nomeLivre:
// { condição: { price } } } — fica o preço da melhor condição por variante.
export function compactPptPrice(prices) {
  if (!prices || typeof prices !== "object") return null;
  const byVariant = {};
  const vars = prices.variants;
  if (vars && typeof vars === "object") {
    for (const [name, conds] of Object.entries(vars)) {
      const variant = variantOfPrinting(name);
      if (!variant || !conds || typeof conds !== "object") continue;
      let best = 0;
      for (const cond of Object.values(conds)) {
        const p = cond && Number(cond.price);
        if (p > 0 && p > best) best = p;
      }
      if (best > 0 && !(byVariant[variant] >= best)) byVariant[variant] = best;
    }
  }
  const packed = packVariantPrices(byVariant) || {};
  if (Number(prices.market) > 0) packed.u = r2(Number(prices.market));
  return packed.u > 0 ? packed : null;
}

// Aplica uma cotação { u, v? } por cima de uma entrada existente: `u` e `v`
// da fonte nova vencem (é a fonte mais fresca/completa que chama isto); o
// resto (e, b, g, uf) fica.
export function applyVariantPrices(ref, src) {
  if (!src) return ref;
  const out = ref || {};
  if (src.u > 0) out.u = src.u;
  if (src.v && Object.keys(src.v).length) out.v = Object.assign({}, src.v);
  else if (src.u > 0 && out.v) delete out.v; // fonte nova sem impressões: não deixar v velho contradizer u novo
  return out;
}

// Preço em USD de UMA variante, a partir da entrada: a impressão em `v` quando
// existe, senão `uf` pra acabamento foil (Lorcana/One Piece/Magic) e por fim
// `u`. É a régua do cliente (cardValue) e do manifest (setValueBuckets) — as
// duas têm que dar o mesmo número, então vive aqui e é copiada no shared.js
// (que não importa módulo) com o teste cruzado em tests/pricing-variants.
export function usdForVariant(ref, variant) {
  if (!ref) return 0;
  const v = ref.v && variant && ref.v[variant];
  if (v > 0) return v;
  if (/foil/i.test(variant || "") && ref.uf > 0) return ref.uf;
  return ref.u > 0 ? ref.u : 0;
}

// Entre a entrada PRÓPRIA de uma carta localizada (-pt/-ja/-zh) e a da carta
// BASE (EN), qual vale: a de melhor fonte — BR (MYP) > USD (TCGplayer) > EUR
// (Cardmarket). Antes valia "a própria, se existir": a carta PT do Van Gogh
// Pikachu tinha só o EUR do Cardmarket e a EN tinha o USD do TCGplayer, e a
// mesma impressão aparecia com dois valores diferentes conforme a bandeira.
// Uma carta JP com USD próprio (mercado JP) continua vencendo a base EN.
export function pickPricingRef(own, base) {
  if (!own) return base || null;
  if (!base || own === base) return own;
  const rank = (r) => (r.b && r.b.md > 0 ? 3 : (r.u > 0 ? 2 : (r.e > 0 ? 1 : 0)));
  return rank(base) > rank(own) ? base : own;
}

// ── Guarda do add-on-miss ────────────────────────────────────────────────────
// Prefixo alfabético do número como a fonte escreve ("SWSH227" -> "swsh",
// "227" -> "", "TG08/TG30" -> "tg"). Número que não é <letras><dígitos> ("SVP
// 200", "?") devolve null: não dá pra saber a que série pertence.
export function numberPrefix(number) {
  const t = String(number || "").split("/")[0].trim().toLowerCase();
  const m = t.match(/^([a-z]*)0*\d+[a-z]*$/);
  return m ? m[1] : null;
}

// Prefixos que o chunk de um set USA (o padrão de numeração da TCGdex pra ele):
// swshp = {"swsh"}, svp = {""}, swsh9 = {"", "tg"}. Cartas já sintetizadas
// (sem raridade e com imagem do TCGplayer) ficam de fora do aprendizado — senão
// a primeira injeção errada ensinaria o padrão errado pra sempre.
export function chunkNumberPrefixes(cards) {
  const out = new Set();
  for (const c of cards || []) {
    if (!c || c.image && /tcgplayer-cdn/.test(c.image) && !c.rarity) continue;
    const p = numberPrefix(c.number);
    if (p != null) out.add(p);
  }
  return out;
}

// Uma carta que a fonte tem e o chunk não só entra se o NÚMERO dela segue o
// padrão do set. Foi assim que promos JAPONESAS foram parar em sets americanos
// (14/09/2026): o TCGplayer mistura "227/S-P" (Pikachu de Kanazawa) no set
// "SWSH Promo", o "227" não casa com "SWSH227", e a carta nascia como
// swshp-227, EN, sem raridade, no topo do ranking de Pikachu com bandeira dos
// EUA. Também barra a mesma carta duplicada por grafia ("SVP 200" além de
// "200"). Sem chunk (set importado inteiro) tudo passa: não há padrão a seguir.
export function missAllowed(number, prefixes) {
  if (!prefixes || !prefixes.size) return true;
  const p = numberPrefix(number);
  return p != null && prefixes.has(p);
}
