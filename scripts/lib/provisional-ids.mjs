// IDs PROVISÓRIOS: carta que entrou no catálogo com um id ESCOLHIDO POR NÓS, na
// aposta de que a fonte canônica (TCGdex) vai usar o mesmo quando publicar.
// Três portas de entrada, cada uma carimba `prov` na carta:
//   prov: "tcgcsv" — add-on-miss / set importado da TCGCSV (TCGplayer);
//   prov: "ppt"    — add-on-miss da PokemonPriceTracker;
//   prov: "en"     — carta PT copiada da edição INGLESA do mesmo set enquanto a
//                    TCGdex não publica a portuguesa (fillFromEn, abaixo).
//
// Por que o carimbo (24/09/2026): o lint-catalog já barra o deploy quando um id
// publicado SOME. O furo que sobrava é o contrário — a TCGdex publica a mesma
// carta com OUTRO id ("30th-5-pt" onde apostamos "30th-005-pt") e as duas
// passam a existir lado a lado, em silêncio: duplicata no set e a coleção de
// quem marcou presa no id morto. findTwins acha esse par e o merge grava o
// de-para (data/card-id-merges.json -> ID_MERGES no núcleo), que é a mesma
// ponte que o retire-imported-sets usa pra set inteiro.
//
// Sem rede e sem fs de propósito — é o que tests/provisional-ids.test.mjs trava.
import { cardNameKey } from "./set-supersede.mjs";

// Número comparável entre fontes: "001" = "1", "SWSH075" = "swsh75", "4/102" = "4".
export function numKey(number) {
  return String(number == null ? "" : number).split("/")[0].trim().toLowerCase()
    .replace(/\d+/g, (d) => String(Number(d)));
}

// Set de PROMO não entra no preenchimento: promo inglesa muitas vezes nunca saiu
// no Brasil (Special Delivery Charizard, os Pikachu de boné do Ash…), e copiar
// criaria carta PT que não existe. Os sets principais saem inteiros nos dois.
export function isPromoSet(cards) {
  const c = (cards || [])[0];
  return !!c && /promo/i.test(String(c.set || ""));
}

// Rótulo inglês -> localizado (raridade, categoria) aprendido dos PARES que já
// existem: carta PT e EN com o mesmo id base. Vale o mais frequente; sem par
// conhecido, a carta copiada fica com o rótulo inglês (melhor que vazio).
//   pairs: [[enCard, locCard], ...]
export function learnLabels(pairs) {
  const conta = { rarity: new Map(), category: new Map() };
  for (const [en, loc] of pairs || []) {
    for (const campo of ["rarity", "category"]) {
      const de = en && en[campo], para = loc && loc[campo];
      if (!de || !para) continue;
      const m = conta[campo].get(de) || new Map();
      m.set(para, (m.get(para) || 0) + 1);
      conta[campo].set(de, m);
    }
  }
  const melhor = (m) => Object.fromEntries([...m].map(([de, votos]) =>
    [de, [...votos].sort((a, b) => b[1] - a[1])[0][0]]));
  return { rarity: melhor(conta.rarity), category: melhor(conta.category) };
}

// Completa o chunk LOCALIZADO com as cartas que só a edição inglesa do MESMO set
// tem. Regra de id conferida no catálogo inteiro em 24/09/2026: as 14.339 cartas
// PT têm exatamente o id da EN + "-pt" — então a carta copiada nasce com o id
// que a TCGdex vai dar à oficial, e quando ela chegar a cópia simplesmente sai
// (dedupe por id), sem mexer na conta de ninguém.
//   enCards:  chunk EN do set
//   locCards: chunk localizado do mesmo set (já existe: a edição saiu no idioma)
//   lang:     "pt"
//   skipIds:  ids que NÃO podem nascer (de-para já gravado: a oficial tem outro id)
//   skipEn:   ids EN que não servem de molde (injetados nesta rodada, sem TCGdex)
//   labels:   learnLabels(...)
// Devolve { cards, added, dropped }: `cards` é o chunk novo (as cópias da rodada
// anterior saem e são refeitas, pra acompanhar mudança na EN).
export function fillFromEn({ enCards, locCards, lang, skipIds, skipEn, labels }) {
  const suf = `-${lang}`;
  const oficiais = (locCards || []).filter((c) => c && c.prov !== "en");
  const dropped = (locCards || []).length - oficiais.length;
  if (!oficiais.length || isPromoSet(enCards) || oficiais.every((c) => c.retired)) {
    return { cards: oficiais, added: 0, dropped };
  }
  const tem = new Set(oficiais.map((c) => c.id));
  const irma = oficiais[0];
  const pula = skipIds || new Set();
  const pulaEn = skipEn || new Set();
  const rot = labels || { rarity: {}, category: {} };
  const novas = [];
  for (const en of enCards || []) {
    if (!en || !en.id || en.prov || en.retired || pulaEn.has(en.id)) continue;
    const id = en.id + suf;
    if (tem.has(id) || pula.has(id)) continue;
    // O preço sai (o merge o tiraria pra tabela com o id PT, e a carta PT já
    // herda o da base por basePricingId); a imagem fica VAZIA de propósito: o
    // fallback EN do merge preenche depois do fill da PPT/TCGCSV, com a melhor
    // arte que a EN tiver.
    const { price, retired, _new, image, ...resto } = en;
    novas.push({
      ...resto,
      id,
      language: lang,
      // Campos do SET vêm da irmã localizada: o nome do set, logo e série já
      // estão no idioma certo lá ("Celebração de 30 Anos").
      set: irma.set || en.set,
      setLogo: irma.setLogo || en.setLogo || "",
      setSymbol: irma.setSymbol || en.setSymbol || "",
      setSerieName: irma.setSerieName || en.setSerieName || "",
      setTotal: irma.setTotal || en.setTotal || "",
      setReleaseDate: irma.setReleaseDate || en.setReleaseDate || "",
      rarity: rot.rarity[en.rarity] || en.rarity || "",
      category: rot.category[en.category] || en.category || "",
      image: "",
      prov: "en"
    });
    tem.add(id);
  }
  return { cards: oficiais.concat(novas), added: novas.length, dropped };
}

// Pares (provisória -> oficial) dentro de UM chunk (mesmo set e idioma).
// Gêmea = carta SEM `prov`, de outro id, com o MESMO número (numKey) e a mesma
// identidade: nome igual (cardNameKey) ou, quando o nome não compara (cópia
// inglesa × oficial portuguesa), o mesmo dexId. Resultado:
//   { prov, twin }        — gêmea única: o de-para pode ser gravado sozinho;
//   { prov, candidates }  — mais de uma: só o aviso, a escolha é de gente.
// Número igual com identidade diferente NÃO é gêmea (a fonte pode ter
// renumerado outra carta pra aquele número) — vira `suspeita`, só aviso.
export function findTwins(cards) {
  const oficiais = new Map(); // numKey -> [cartas oficiais]
  for (const c of cards || []) {
    if (!c || !c.id || c.prov) continue;
    const k = numKey(c.number);
    if (!k) continue;
    if (!oficiais.has(k)) oficiais.set(k, []);
    oficiais.get(k).push(c);
  }
  const out = [];
  for (const p of cards || []) {
    if (!p || !p.id || !p.prov) continue;
    const k = numKey(p.number);
    const mesmos = (oficiais.get(k) || []).filter((c) => c.id !== p.id);
    if (!mesmos.length) continue;
    const dex = (c) => Math.trunc(Number(c.dexId)) || 0;
    const nome = cardNameKey(p.name);
    const iguais = mesmos.filter((c) => (nome && cardNameKey(c.name) === nome) || (dex(p) && dex(c) === dex(p)));
    if (iguais.length === 1) out.push({ prov: p.id, twin: iguais[0].id, number: p.number, name: p.name });
    else if (iguais.length > 1) out.push({ prov: p.id, candidates: iguais.map((c) => c.id), number: p.number, name: p.name });
    else out.push({ prov: p.id, suspeita: mesmos.map((c) => c.id), number: p.number, name: p.name });
  }
  return out;
}
