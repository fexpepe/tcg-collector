// Enriquecimento do catálogo JAPONÊS — a parte PURA (sem rede, sem fs), usada
// pelo passo de build scripts/enrich-ja.mjs e travada por tests/enrich-ja.test.mjs.
//
// Por que existe (20/09/2026, v2 do modelo de carregamento): metade das cartas
// japonesas (150 sets, 10,5 mil cartas) entra pela TCGCSV, que só entrega
// nome em inglês, número, imagem e preço. Sem categoria, tipo e estágio a
// carta fica fora da régua de deck, dos filtros, da página de Treinadores e
// da Pokédex; sem série o set cai em "Outros"; sem nome japonês a busca por
// kana não acha. Três fontes fecham o buraco, nesta precedência, e SÓ em
// campo vazio — nada aqui sobrescreve o que a TCGdex ou a TCGCSV já disseram:
//   1. série pelo código do set (jpSerieOfCode, a mesma tabela do import);
//   2. Bulbapedia (data/ja-enrich/<setId>.json, baixado LOCAL pelo
//      sync-bulbapedia-ja.mjs): nome japonês, nome inglês, raridade, tipo,
//      ilustrador e scan — casado pelo NÚMERO impresso, nunca pelo nome;
//   3. o irmão INGLÊS: a carta importada tem o nome em inglês do TCGplayer,
//      que é o nome da carta EN. Quando todos os homônimos EN concordam,
//      categoria/tipo/estágio/tipo de treinador/tipo de energia são herdados.
//      Artista NÃO: a arte japonesa pode ser outra.
import { jpSerieOfCode } from "./tcgcsv-pokemon.mjs";
import { cardNameKey } from "./set-supersede.mjs";

const ASCII = /^[\x20-\x7E]+$/;
export const isAsciiName = (s) => ASCII.test(String(s || ""));

// "001" = "1", "TG05" = "tg5", "227/S-P" -> "227". Mesma régua do 2º passo do
// de-para de aposentadoria (set-supersede#numberKey).
export function numberKey(number) {
  return String(number || "").split("/")[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, "$1");
}

// Índice das cartas EN por nome comparável: para cada campo herdável, o
// conjunto de valores vistos. Herda-se só quando o conjunto tem UM valor.
const HERDAVEIS = ["category", "types", "stage", "trainerType", "energyType"];
export function buildEnIndex(enCards) {
  const idx = new Map();
  for (const c of enCards || []) {
    const k = cardNameKey(c && c.name);
    if (!k) continue;
    let e = idx.get(k);
    if (!e) { e = {}; for (const f of HERDAVEIS) e[f] = new Set(); idx.set(k, e); }
    for (const f of HERDAVEIS) if (c[f]) e[f].add(String(c[f]));
  }
  return idx;
}

// Tipo da Bulbapedia -> categoria/tipo do catálogo. A coluna "Type" da lista
// de set traz o tipo de energia do Pokémon ("Grass"), ou a classe da carta de
// treinador/energia ("Item", "Supporter", "Stadium", "Pokémon Tool", "Basic
// Energy", "Special Energy"). Os nomes de tipo são os da TCGdex ("Lightning",
// "Colorless", "Darkness", "Metal", "Dragon", "Fairy", "Psychic"…).
const TIPOS_POKEMON = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Fairy", "Colorless"]);
export function classificarTipoBulba(type) {
  const t = String(type || "").trim();
  if (!t) return null;
  if (TIPOS_POKEMON.has(t)) return { category: "Pokemon", types: t };
  if (/energy/i.test(t)) return { category: "Energy", energyType: /special/i.test(t) ? "Special" : "Normal" };
  if (/^(item|supporter|stadium|tool|pokémon tool|pokemon tool|trainer|technical machine|ace spec)$/i.test(t)) {
    const m = t.toLowerCase();
    const trainerType = m.includes("tool") ? "Tool" : m.includes("supporter") ? "Supporter" : m.includes("stadium") ? "Stadium" : m.includes("item") ? "Item" : "";
    return Object.assign({ category: "Trainer" }, trainerType ? { trainerType } : {});
  }
  return null;
}

// Raridade que PARECE raridade: sigla japonesa (C, U, R, RR, SR, SAR, ACE…) ou
// nome ocidental ("Common", "Rare Holo", "Promo"). Guarda contra coluna
// deslocada na lista do wiki — no 1º run (21/09/2026) veio "Promotion" em
// todas as cartas, e isso teria virado raridade de 10 mil cartas.
export function raridadeValida(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  if (/^[A-Z]{1,4}$/.test(t)) return true;
  return /\b(common|uncommon|rare|promo|legend|classic|holo)\b/i.test(t) && t.length <= 40;
}

// O cache de um set CABE no chunk? Guarda contra página errada (título que
// resolveu pro set ocidental homônimo ou pra outra expansão): 21/09/2026, a
// lista de expansões deu "Steam Siege" como tradução de 爆熱の闘士, e o sync
// leu a lista do set inglês como se fosse a japonesa — nome, raridade e
// ilustrador de OUTRA carta entrariam por número. Duas réguas, as duas por
// número impresso: (1) o cache COBRE o chunk — 60%+ dos números do chunk
// estão no cache (a conta é sobre o chunk, não sobre o cache: a página de
// um par de sets lista as duas metades, e o cache do 1º run ainda carrega
// números de outra tabela); (2) entre as cartas casadas que têm nome
// comparável — nome ASCII do import ou a espécie (pokemonName) —, metade ou
// mais bate com o `en` do cache (página errada fica perto de zero; a certa,
// perto de 100%, com folga pra decoração de nome que a régua não previu).
// Sem nome comparável nenhum, vale só a régua 1. Devolve { cabe, motivo }.
export function cacheCabeNoChunk(cards, bulba) {
  const entradas = bulba && bulba.cards ? Object.keys(bulba.cards) : [];
  if (!entradas.length || !(cards || []).length) return { cabe: false, motivo: "cache vazio" };
  const porNumero = new Map((cards || []).map((c) => [numberKey(c.number), c]));
  const casadas = entradas.filter((k) => porNumero.has(k));
  const cobertura = new Set(casadas).size / porNumero.size;
  if (cobertura < 0.6) return { cabe: false, motivo: `cache cobre só ${Math.round(cobertura * 100)}% dos números do chunk` };
  let comparaveis = 0, batem = 0;
  for (const k of casadas) {
    const c = porNumero.get(k);
    const en = String(bulba.cards[k].en || "").toLowerCase();
    if (!en) continue;
    const nome = isAsciiName(c.name) ? c.name : (c.nameEn || "");
    const especie = c.category === "Pokemon" || !c.category ? String(c.pokemonName || "") : "";
    if (nome) { comparaveis++; if (cardNameKey(nome) === cardNameKey(en) || en.includes(nome.toLowerCase())) batem++; }
    else if (especie) { comparaveis++; if (en.includes(especie.toLowerCase())) batem++; }
  }
  if (comparaveis >= 5 && batem / comparaveis < 0.5) return { cabe: false, motivo: `só ${batem} de ${comparaveis} nomes batem` };
  return { cabe: true, motivo: "" };
}

// Enriquece UMA carta ja no lugar. Devolve a lista dos campos alterados
// (vazia = nada mudou). `bulba` é o cache do set ({ cards: { número: {…} } })
// ou null; `enIndex` vem de buildEnIndex.
export function enrichJaCard(card, { enIndex, bulba } = {}) {
  const mudou = [];
  const preenche = (campo, valor) => {
    if (valor == null || valor === "" || (card[campo] && card[campo] !== "None")) return;
    card[campo] = valor; mudou.push(campo);
  };
  // 1. série pelo código do set
  if (!card.setSerieId) {
    const s = jpSerieOfCode(card.setId);
    if (s) { card.setSerieId = s.setSerieId; card.setSerieName = s.setSerieName; mudou.push("setSerieId"); }
  }
  // 2. nome: a carta importada nasce com o nome INGLÊS no `name`. Guarda-o em
  //    nameEn (busca) e, se a Bulbapedia trouxer o japonês, `name` passa a ser
  //    o japonês — como nos sets que vêm da TCGdex.
  if (!card.nameEn && isAsciiName(card.name)) { card.nameEn = card.name; mudou.push("nameEn"); }
  const b = bulba && bulba.cards ? bulba.cards[numberKey(card.number)] : null;
  if (b) {
    if (b.ja && isAsciiName(card.name)) { card.name = b.ja; mudou.push("name"); }
    preenche("nameEn", b.en);
    if (raridadeValida(b.rarity)) preenche("rarity", b.rarity);
    preenche("artist", b.artist);
    if (/\.jpe?g$/i.test(String(b.image || ""))) preenche("image", b.image);
    const t = classificarTipoBulba(b.type);
    if (t) for (const [k, v] of Object.entries(t)) preenche(k, v);
  }
  // 3. irmão inglês, pelo nome em inglês (o `name` só quando ainda é ASCII)
  const chaveEn = cardNameKey(card.nameEn || (isAsciiName(card.name) ? card.name : ""));
  const e = chaveEn && enIndex ? enIndex.get(chaveEn) : null;
  if (e) {
    for (const f of HERDAVEIS) {
      if (e[f].size !== 1) continue;
      // tipo/estágio/tipo de treinador só fazem sentido na categoria certa
      if (f === "types" || f === "stage") { if ((card.category || [...e.category][0]) !== "Pokemon") continue; }
      if (f === "trainerType" && (card.category || [...e.category][0]) !== "Trainer") continue;
      if (f === "energyType" && (card.category || [...e.category][0]) !== "Energy") continue;
      preenche(f, [...e[f]][0]);
    }
  }
  return mudou;
}
