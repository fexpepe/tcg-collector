// Bulbapedia — a parte PURA da ingestão do catálogo CHINÊS SIMPLIFICADO (a
// linha exclusiva da China continental: Gem Pack, Collection 151, Storming
// Emergence, Terastal Gathering…). Sem rede e sem fs de propósito: é o que
// tests/bulbapedia-zh.test.mjs trava com fixtures. Quem fala com a rede é
// scripts/sync-bulbapedia-zh.mjs; quem monta as cartas no build é
// scripts/import-zh.mjs.
//
// Por que a Bulbapedia (27/09/2026): a TCGdex lista 57 sets zh-cn, mas todos
// os exclusivos da China vêm com ZERO cartas (só nome e contagem) e o
// sync-tcgdex pula set vazio; a TCGCSV não tem categoria chinesa (o TCGplayer
// só vende EN e JP). A Bulbapedia tem a lista de cartas de TODOS os sets do
// "Template:Simplified Chinese Releases", com número, nome em inglês, tipo e
// raridade. Licença CC BY-NC-SA, a mesma já aceita pro japonês.
//
// Por que WIKITEXT e não o HTML renderizado (o japonês lê HTML): a página de
// set chinês traz várias listas (Radiant/Verdant/Abundant, os packs de
// modificação do Battle Party…) e o CÓDIGO de cada uma está no nome do
// símbolo do cabeçalho ({{Setlist/header|…|image=SetSymbolCSM1a.png}}). No
// HTML as tabelas são aninhadas e o símbolo fica longe da lista; no wikitext
// cabeçalho e entradas vêm em sequência, com parâmetros posicionais estáveis
// ({{Setlist/entry|número|marca|nome|tipo|subtipo|raridade|…}}). E a API
// devolve o wikitext de 50 páginas por requisição.
//
// IMAGEM (o achado que mudou o desenho): a página de uma carta chinesa na
// Bulbapedia é quase sempre um REDIRECT pra página da impressão ocidental/
// japonesa ("Moltres (Storming Emergence Radiant 6)" -> "Moltres (Lost
// Thunder 38)"), e o scan de lá é o inglês. Em vez de guardar esse scan do
// Archives — que o CSP não libera, o wsrv.nl leva 403 e o espelho R2 só
// serve host completo —, guardamos DE QUAL IMPRESSÃO a carta é reimpressão
// (set + número, EN e JP, escolhida pela raridade) e o build usa a imagem que
// a MESMA carta já tem no nosso catálogo EN (TCGdex, espelhada), ou no JA.
// Mesma regra do fallback de imagem da edição PT: arte igual, texto em outra
// língua. Carta sem página no wiki (os Gem Packs, parte dos sets mais novos)
// fica sem imagem até existir fonte de scan chinês.

export const LANG = "zh-cn";
export const TEMPLATE = "Template:Simplified Chinese Releases";

// Série por seção do template. Id e nome seguem a TCGdex zh-cn (o CSMPiC
// que ela já publica vem com "SM" / "太阳&月亮") pra, quando ela publicar as
// cartas, o set cair no mesmo grupo. "S" é o id que a TCGdex usa pra Espada
// e Escudo nas edições asiáticas (zh-tw).
export const ERAS = [
  { re: /sun\s*&\s*moon/i, id: "SM", name: "太阳&月亮" },
  { re: /sword\s*&\s*shield/i, id: "S", name: "剑&盾" },
  { re: /scarlet\s*&\s*violet/i, id: "SV", name: "朱&紫" },
  { re: /mega/i, id: "M", name: "MEGA" }
];

// ── wikitext mínimo ─────────────────────────────────────────────────────────
// Parâmetros de UM template, respeitando {{…}} e [[…]] aninhados:
// "a|{{x|y}}|[[p|q]]" -> ["a", "{{x|y}}", "[[p|q]]"].
export function splitParams(inner) {
  const out = [];
  let depth = 0, cur = "";
  const s = String(inner || "");
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth++; cur += two; i++; continue; }
    if ((two === "}}" || two === "]]") && depth > 0) { depth--; cur += two; i++; continue; }
    if (s[i] === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

// Todas as ocorrências de templates cujo nome casa `nameRe`, em ordem:
// [{ name, params: [posicionais…], named: {chave: valor}, index }]. Quem
// chama passa regex com /i: o wiki mistura Setlist/setlist.
export function templates(wt, nameRe) {
  const s = String(wt || "");
  const out = [];
  let i = 0;
  while ((i = s.indexOf("{{", i)) >= 0) {
    let depth = 0, j = i;
    for (; j < s.length - 1; j++) {
      const two = s.slice(j, j + 2);
      if (two === "{{") { depth++; j++; continue; }
      if (two === "}}") { depth--; j++; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    const inner = s.slice(i + 2, j - 1);
    const parts = splitParams(inner);
    const name = parts[0].trim();
    if (nameRe.test(name)) {
      const params = [], named = {};
      for (const p of parts.slice(1)) {
        const m = /^\s*([A-Za-z][\w ]*?)\s*=([\s\S]*)$/.exec(p);
        if (m && !p.trim().startsWith("{{") && !p.trim().startsWith("[[")) named[m[1].trim().toLowerCase()] = m[2].trim();
        else params.push(p.trim());
      }
      out.push({ name, params, named, index: i });
    }
    // Avança só o "{{": o template aninhado (o {{TCG|…}} dentro do infobox,
    // o {{TCG ID|…}} dentro da entrada) também é visitado.
    i += 2;
  }
  return out;
}

// Texto de um trecho de wikitext: {{TCG|X}} e {{TCG|X|rótulo}} -> X (o ALVO,
// não o rótulo: expansion={{TCG|SVP Black Star Promos|SVP Black Star
// Promotional}} precisa do nome do set pra casar com o catálogo), [[P|Q]] ->
// Q, [[P]] -> P, sem tags e sem '''negrito'''. Outros templates somem.
export function plain(wt) {
  let s = String(wt || "");
  for (let k = 0; k < 5; k++) {
    const antes = s;
    s = s.replace(/\{\{\s*(?:TCG|ATCG|SCTCG|rar|ct|tt|p|pmin|e)\s*\|([^{}|]*)(?:\|[^{}]*)?\}\}/gi, "$1")
      .replace(/\{\{[^{}]*\}\}/g, "");
    if (s === antes) break;
  }
  return s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/'{2,}/g, "")
    .replace(/&mdash;|&ndash;/g, "—").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// ── template de lançamentos ─────────────────────────────────────────────────
// Páginas de set em ordem, com a era da seção: [{ title, era }]. {{ATCG|X}}
// -> "X (ATCG)", {{SCTCG|X}} -> "X (SCTCG)" (as promos), {{TCG|X}} -> "X (TCG)"
// (produto japonês cuja página também traz a lista chinesa, como o Start Deck
// 100 e o 30th Celebration — ver listaChinesa).
export function releasePages(wikitext) {
  const s = String(wikitext || "");
  const secoes = [...s.matchAll(/Simplified Chinese ([^|\n]*?) Series/g)].map((m) => ({ nome: m[1], index: m.index }));
  const out = [], vistos = new Set();
  for (const m of s.matchAll(/\{\{\s*(ATCG|SCTCG|TCG)\s*\|([^}|]+)(?:\|[^}]*)?\}\}/g)) {
    const secao = secoes.filter((x) => x.index < m.index).pop();
    const era = secao ? ERAS.find((e) => e.re.test(secao.nome)) : null;
    const title = `${m[2].trim()} (${m[1]})`;
    if (vistos.has(title)) continue;
    vistos.add(title);
    out.push({ title, era: era ? { id: era.id, name: era.name } : null });
  }
  return out;
}

// ── página de set ───────────────────────────────────────────────────────────
const MESES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// Primeira data "Month D, YYYY" do texto -> "YYYY-MM-DD". Numa página (TCG)
// que lista Japão e China, a data depois de "Simplified Chinese" vence.
export function dataDe(texto) {
  const s = plain(texto);
  const achar = (t) => {
    const m = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i.exec(t);
    return m ? `${m[3]}-${String(MESES[m[1].toLowerCase()]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}` : "";
  };
  const i = s.search(/simplified chinese/i);
  return (i >= 0 && achar(s.slice(i))) || achar(s);
}

// Código oficial pelo nome do SÍMBOLO da lista: "SetSymbolCSM1a.png" ->
// "CSM1a". A Bulbapedia escreve sem o ponto os sets ".5"/".1" da Espada e
// Escudo e do Sol e Lua ("SetSymbolCS15.png" é o CS1.5, "CS41" o CS4.1,
// "CSM25" o CSM2.5) — o ponto volta aqui, porque o id da TCGdex tem ponto
// (CS1.5C, CSM2.5C). Só nos prefixos CS/CSM: CSV10 é o 10º set, não o "1.0".
// Símbolo de promo, com espaço no nome ou vazio -> "".
export function codigoDoSimbolo(image) {
  const m = /^SetSymbol\s*(.+?)\.(?:png|jpe?g|gif|svg)$/i.exec(String(image || "").trim());
  if (!m) return "";
  let c = m[1].trim();
  if (/^collection 151$/i.test(c)) return "151";
  const sc = /^(.+?)\s+SC$/i.exec(c); // "30th Celebration SC" = a lista chinesa de página (TCG)
  if (sc) c = /^30th celebration$/i.test(sc[1]) ? "30th" : sc[1];
  if (/\s/.test(c) || /promo$/i.test(c)) return "";
  const ponto = /^(CSM?)(\d)(\d)$/.exec(c);
  return ponto ? `${ponto[1]}${ponto[2]}.${ponto[3]}` : c;
}

// Códigos que o wiki NÃO traz no símbolo (lista sem imagem, ou página (TCG)
// com a lista chinesa sem símbolo). Chave: "<página sem sufixo>|<título da
// lista>". São os códigos impressos nos produtos — fato, conferido contra a
// lista oficial de produtos chineses em 27/09/2026.
export const CODIGOS_FIXOS = {
  "Start Deck 100|Start Deck 100 (Simplified Chinese)": "CS4Da",
  "Master Strategy Deck Building Sets|Charizard ex Master Strategy Deck Building Set": "CSVM1a",
  "Master Strategy Deck Building Sets|Gardevoir ex Master Strategy Deck Building Set": "CSVM1b",
  "Master Strategy Deck Building Sets|Miraidon ex Master Strategy Deck Building Set": "CSVM1c",
  "Master Strategy Deck Building Sets|Raging Bolt ex Master Strategy Deck Building Set": "CSVM2a",
  "Master Strategy Deck Building Sets|Dragapult ex Master Strategy Deck Building Set": "CSVM2b",
  "Master Strategy Deck Building Sets|Gholdengo ex Master Strategy Deck Building Set": "CSVM2c"
};

// Nome do set a partir da página e do título da lista. Lista única = o nome
// da PÁGINA (o wiki copia cabeçalho de outro set: a lista do Terastal
// Gathering se chama "Stellar Crystal", a do Gem Pack Vol. 3 "Gem Pack Vol.
// 1"). Várias listas: o título quando já contém o nome da página ("Battle
// Party Set Reward Pack"); senão página + título ("Storming Emergence
// Radiant"). Quando a soma passa de NOME_LONGO, o título vem PRIMEIRO e a
// página entre parênteses, sem a parte repetida: o tile de set corta o nome
// no fim, e "Dragonite & Mewtwo & Camerupt & Sinistcha Happy Set Reward
// Pack" aparecia igual às outras três listas da mesma página (conferido na
// tela em 27/09/2026) — vira "Happy Set Reward Pack (Dragonite & Mewtwo &
// Camerupt & Sinistcha)". Só palavras do wiki, reordenadas; nada inventado.
const NOME_LONGO = 40;
export function nomeDoSet(base, titulo, listas) {
  const t = String(titulo || "").replace(/\s*\(Simplified Chinese\)\s*$/i, "").trim();
  if (listas <= 1 || !t) return base;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = norm(base), nt = norm(t);
  if (nt.includes(nb) || nt.includes(nb.replace(/s$/, ""))) return t;
  if (nb.includes(nt)) return base;
  const bw = base.split(/\s+/), tw = t.split(/\s+/);
  let k = Math.min(bw.length, tw.length);
  while (k > 0 && norm(bw.slice(-k).join(" ")) !== norm(tw.slice(0, k).join(" "))) k--;
  const junto = [...bw, ...tw.slice(k)].join(" ");
  if (junto.length <= NOME_LONGO) return junto;
  const resto = bw.slice(0, bw.length - k).join(" ").replace(/[\s:–—-]+$/, "");
  return resto ? `${t} (${resto})` : t;
}

// Número da entrada -> { number, total, promo }:
//   "001/151"   -> { number: "001", total: 151 }
//   "01 01/07"  -> { number: "01-01" }            (Gem Pack: Pokémon 01, arte 1 de 7)
//   "001/SV-P"  -> { number: "001", promo: "SV-P" }
//   "SV-P"      -> { number: "", promo: "SV-P" }   (promo sem número: fica de fora)
//   "WAT"/"MET" -> { number: "WAT" }               (energia básica sem número)
export function numeroDe(raw) {
  const s = plain(raw).replace(/\s+/g, " ").trim();
  let m = /^(\d{1,3}) (\d{1,3})\/(\d{1,3})$/.exec(s);
  if (m) return { number: `${m[1]}-${m[2]}`, total: 0, promo: "" };
  m = /^([A-Za-z]*\d+[A-Za-z]?)\/(\d+)$/.exec(s);
  if (m) return { number: m[1], total: Number(m[2]), promo: "" };
  m = /^(\d+)\/([A-Za-z0-9]+-P)$/i.exec(s);
  if (m) return { number: m[1], total: 0, promo: m[2] };
  if (/^[A-Za-z0-9]+-P$/i.test(s)) return { number: "", total: 0, promo: s };
  if (/^[A-Z]{3}$/.test(s)) return { number: s, total: 0, promo: "" };
  m = /^([A-Za-z]*\d+[A-Za-z]?)$/.exec(s);
  if (m) return { number: m[1], total: 0, promo: "" };
  return { number: "", total: 0, promo: "" };
}

// Nome e página da carta a partir do 3º parâmetro da entrada:
//   {{TCG ID|Set|Nome|n|Espécie}}{{ex}}  -> Nome, página "Nome (Set n)"
//   [[Leafeon-GX (Battle Party Set Reward 1)|Leafeon]]{{GX}} -> "Leafeon-GX"
//   {{TCG|Basic Water Energy}}           -> "Basic Water Energy", sem página
export function nomeDaEntrada(campo) {
  const s = String(campo || "").replace(/<small>[\s\S]*?<\/small>/gi, "").trim();
  const id = templates(s, /^TCG ID$/i)[0];
  if (id && id.params.length >= 2) {
    const [set, nome, n] = id.params;
    return { name: plain(nome), page: n ? `${plain(nome)} (${plain(set)} ${plain(n)})` : "" };
  }
  const l = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(s);
  if (l) return { name: l[1].replace(/\s*\([^)]*\)\s*$/, "").trim(), page: l[1].trim() };
  return { name: plain(s), page: "" };
}

// A página (TCG) é de um produto japonês; só entra a lista marcada como
// chinesa (título "(Simplified Chinese)" ou símbolo "… SC.png"). Nas páginas
// (ATCG)/(SCTCG) todas as listas são chinesas.
export function listaChinesa(title, header) {
  if (!/\(TCG\)$/.test(title)) return true;
  const t = String(header.named.title || ""), img = String(header.named.image || "");
  return /simplified chinese/i.test(t) || /\bSC\.(png|jpe?g)$/i.test(img);
}

// Página de set -> { base, release, logo, listas: [{ code, setId, name, total,
// entries: [{ number, name, page, type, subtype, rarity, mark }] }] }.
// Lista sem código (sem símbolo e fora de CODIGOS_FIXOS) volta com code "" —
// quem chama registra e pula. Entrada de PROMO ("001/SV-P") vai pra lista do
// set de promo daquele código, qualquer que seja a página.
export function parseSetPage(wikitext, title) {
  // Comentário HTML fora: o infobox do Vivid Portrayals tem o logo comentado
  // ("<!--|setlogo=…-->") e ele vazava pro nome do arquivo.
  const wt = String(wikitext || "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const base = String(title || "").replace(/\s*\((?:ATCG|SCTCG|TCG)\)$/, "");
  // Três infoboxes no wild: expansão (release/setlogo), subset e promo
  // (date/period/logo) e deck kit (release).
  const info = templates(wt, /^(TCGExpansionInfobox|TCGPromoInfobox|DeckInfobox)$/i)[0];
  const n = info ? info.named : {};
  const release = dataDe(n.release || n.date || n.period || "");
  // Página (TCG) é do produto japonês: o logo dela é o japonês/inglês.
  const logo = /\(TCG\)$/.test(title) ? "" : String(n.setlogo || n.logo || "").trim();
  const alt = plain(n.alt || "");
  const partes = templates(wt, /^setlist\/(header|entry|footer)$/i);
  const headers = partes.filter((p) => /header$/i.test(p.name));
  const chinesas = headers.filter((h) => listaChinesa(title, h));
  const listas = [];
  let atual = null;
  const happy = /happy set$/i.test(base);
  let codigoPrincipal = "";
  for (const p of partes) {
    if (/header$/i.test(p.name)) {
      atual = null;
      if (!listaChinesa(title, p)) continue;
      const titulo = plain(p.named.title || "");
      let code = CODIGOS_FIXOS[`${base}|${titulo}`] || codigoDoSimbolo(p.named.image);
      // Happy Set: o wiki repete símbolos de OUTRO happy set nas sublistas (a
      // página do CSVH4 usa os do CSVH3). O código sai do principal + sufixo
      // pelo título, que é como a TCGdex/os produtos numeram (CSVH4a/p/e).
      if (happy) {
        if (/^happy set$/i.test(titulo)) codigoPrincipal = code;
        else if (codigoPrincipal) {
          const suf = /reward/i.test(titulo) ? "p" : /modification/i.test(titulo) ? "a" : /happy pack/i.test(titulo) ? "e" : "";
          if (suf) code = codigoPrincipal + suf;
        }
      }
      if (!code && chinesas.length === 1 && alt && !/\s/.test(alt)) code = alt;
      atual = { code, titulo, entries: [] };
      listas.push(atual);
      continue;
    }
    if (/footer$/i.test(p.name)) { atual = null; continue; }
    if (!atual) continue;
    const [numero, mark, nomeCampo, type, subtype, rarity] = p.params;
    const { number, total, promo } = numeroDe(numero);
    const { name, page } = nomeDaEntrada(nomeCampo);
    if (!name) continue;
    atual.entries.push({ number, total, promo, name, page, type: plain(type), subtype: plain(subtype), rarity: plain(rarity).replace(/^—$|^-$/, ""), mark: plain(mark).replace(/^—$|^-$/, "") });
  }
  // Monta os sets: entradas de promo saem pro set da promo; o resto fica na
  // lista. Nome e total por lista.
  const porSet = new Map();
  const add = (code, name, entry) => {
    const setId = `${code}C`;
    // `promo`: set de promo e a página É a lista oficial dele ("SV-P
    // Promotional cards") — quem junta páginas (o sync) dá preferência a ela.
    const promo = !!entry.promo;
    const casa = promo && new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} Promotional cards$`, "i").test(base);
    if (!porSet.has(setId)) porSet.set(setId, { code, setId, name, total: 0, promo, oficial: !promo || casa, release, logo, entries: [] });
    const s = porSet.get(setId);
    s.entries.push(entry);
    if (entry.total && !s.total) s.total = entry.total;
  };
  for (const l of listas) {
    for (const e of l.entries) {
      if (e.promo) { if (e.number) add(e.promo, `${e.promo} Promotional Cards`, e); continue; }
      if (!l.code || !e.number) continue;
      add(l.code, nomeDoSet(base, l.titulo, listas.length), e);
    }
  }
  const semCodigo = listas.filter((l) => !l.code && l.entries.some((e) => !e.promo)).map((l) => l.titulo);
  return { base, release, logo, listas: [...porSet.values()], semCodigo };
}

// Ordem natural de número ("001" < "002" < "010"; "01-01" < "01-02"; as
// energias sem número, "WAT", no fim).
export function ordemNumero(a, b) {
  const x = String((a && a.number) ?? a), y = String((b && b.number) ?? b);
  const dx = /\d/.test(x), dy = /\d/.test(y);
  if (dx !== dy) return dx ? -1 : 1;
  return x.localeCompare(y, "en", { numeric: true });
}

// Junta os sets de TODAS as páginas pelo setId. Acontece com promo: as três
// páginas "30th Celebration: First Partner … Vol. N" listam cartas 30th-P que
// também estão na lista oficial "30th-P Promotional cards". Entradas por
// número — a da página oficial vence —, e data/logo/nome também dela.
export function juntarSets(sets) {
  const out = new Map();
  for (const s of sets || []) {
    const cur = out.get(s.setId);
    if (!cur) { out.set(s.setId, { ...s, entries: [...s.entries] }); continue; }
    const base = s.oficial && !cur.oficial ? s : cur;
    const outro = base === s ? cur : s;
    const porNum = new Map(outro.entries.map((e) => [e.number, e]));
    for (const e of base.entries) porNum.set(e.number, e);
    out.set(s.setId, {
      ...base,
      oficial: !!(base.oficial || outro.oficial),
      release: base.release || outro.release,
      logo: base.logo || outro.logo,
      total: base.total || outro.total,
      entries: [...porNum.values()].sort(ordemNumero)
    });
  }
  return [...out.values()];
}

// Set sem data no wiki (subsets, caixas, decks sem "release" no infobox):
// herda a do set ANTERIOR da mesma era, na ordem do template — que é a ordem
// de lançamento. É aproximação (fica no máximo semanas antes da real) e só
// serve pra ordenar a tela de Sets; sem ela o set caía no fim da lista.
export function completarDatas(sets) {
  let ultima = {};
  for (const s of sets || []) {
    const era = s.serieId || "";
    if (s.release) ultima[era] = s.release;
    else if (ultima[era]) { s.release = ultima[era]; s.releaseAprox = true; }
  }
  return sets;
}

// ── página de carta ─────────────────────────────────────────────────────────
// Do infobox: espécie, estágio e as IMPRESSÕES ({{PokémoncardInfobox/
// Expansion|expansion=…|rarity=…|cardno=…|jpexpansion=…|jprarity=…|jpcardno=…}}).
// Treinador e energia usam {{TCGTrainerCardInfobox}}/{{TCGEnergyCardInfobox}},
// com o mesmo /Expansion.
const INFOBOX = /^(TCG)?(Pok[ée]mon|Trainer|Energy) ?card ?Infobox$/i;
const INFOBOX_IMPRESSAO = /^(TCG)?(Pok[ée]mon|Trainer|Energy) ?card ?Infobox\/Expansion$/i;

// Página de DESAMBIGUAÇÃO de promo: o mesmo número SV-P é outra carta em cada
// língua, e a página "Pikachu (SV-P Promo 1)" só aponta: "For the Simplified
// Chinese copy, see [[Pikachu (SVP Promo 190)]]". Devolve esse título, ou "".
export function desambiguacao(wikitext) {
  const wt = String(wikitext || "");
  if (!/\{\{\s*tcgdisambig/i.test(wt)) return "";
  const m = /Simplified Chinese[^\n]*?\[\[([^\]|]+)/i.exec(wt);
  return m ? m[1].trim() : "";
}
export function parseCardPage(wikitext) {
  const wt = String(wikitext || "");
  const box = templates(wt, INFOBOX)[0];
  const n = box ? box.named : {};
  const artistas = [...wt.matchAll(/Illus(?:trator|\.)?\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi)].map((m) => (m[2] || m[1]).trim());
  const prints = templates(wt, INFOBOX_IMPRESSAO).map((t) => ({
    expansion: plain(t.named.expansion || ""),
    rarity: plain(t.named.rarity || ""),
    cardno: plain(t.named.cardno || ""),
    jpexpansion: plain(t.named.jpexpansion || ""),
    jprarity: plain(t.named.jprarity || ""),
    jpcardno: plain(t.named.jpcardno || "")
  })).filter((p) => (p.expansion && p.cardno) || (p.jpexpansion && p.jpcardno));
  const dex = /\|\s*ndex\s*=\s*(\d+)/i.exec(wt);
  return {
    species: plain(n.species || ""),
    stage: plain(n.evostage || ""),
    dexId: dex ? Number(dex[1]) : 0,
    artist: new Set(artistas).size === 1 ? artistas[0] : "",
    prints
  };
}

// O cache guarda as impressões COMPACTAS (a escolha roda no build, então
// mudar a regra não pede outra rodada no wiki): [expansion, rarity, cardno,
// jpexpansion, jprarity, jpcardno].
const CAMPOS_IMPRESSAO = ["expansion", "rarity", "cardno", "jpexpansion", "jprarity", "jpcardno"];
export const compactarImpressoes = (prints) => (prints || []).map((p) => CAMPOS_IMPRESSAO.map((k) => p[k] || ""));
export const expandirImpressoes = (arr) => (arr || []).map((a) => Object.fromEntries(CAMPOS_IMPRESSAO.map((k, i) => [k, (a && a[i]) || ""])));

// Raridade chinesa de impressão REGULAR (a arte "de linha" da carta): comum,
// incomum, rara, RR/RRR (ex/V/VMAX de linha), promo e VAZIA (deck, caixa e
// promo não trazem raridade na lista). As outras (AR, SAR, SR, UR, S, SSR,
// CHR, K, A, as "Gem …" dos Gem Packs) são impressões com arte própria.
export function raridadeRegular(r) {
  return /^(|C|U|R|RR|RRR|PR|Common|Uncommon|Rare|Double Rare|Promo)$/i.test(String(r || "").trim());
}
// Impressão com arte especial, pela raridade EN ou JP da linha.
const ESPECIAL = /illustration|special|ultra|hyper|secret|full art|shiny|gold|rainbow|gallery|character|radiant|amazing|\b(AR|SAR|SR|HR|UR|SSR|S|CHR|CSR|K|A|ACE|TG\w*)\b/i;
const especial = (p) => ESPECIAL.test(p.rarity || "") || ESPECIAL.test(p.jprarity || "");

// Qual impressão da página é a carta chinesa, nesta ordem:
//   1. a raridade chinesa segue a japonesa (C/U/R/RR/AR/SR/SAR/UR/S/SSR…):
//      casa com `jprarity` — várias, a que tem par ocidental;
//   2. página com UMA impressão: é ela;
//   3. raridade regular (ou vazia) sem casar: a primeira impressão REGULAR —
//      o japonês "high class" não imprime C/U (Terastal Fest ex), o VMAX de
//      linha às vezes só tem a linha EN, e deck/caixa não têm raridade. Em
//      set de PROMO, a impressão promo vem antes (a arte de promo costuma
//      ser outra);
//   4. senão null — melhor sem imagem do que a arte de OUTRA raridade (a SAR
//      no lugar da RR).
// Devolve { en: {set, number} | null, ja: {set, number} | null } ou null.
export function escolherImpressao(prints, rarity, { promo = false } = {}) {
  const ps = (prints || []).filter((p) => p && ((p.expansion && p.cardno) || (p.jpexpansion && p.jpcardno)));
  if (!ps.length) return null;
  const r = String(rarity || "").trim().toLowerCase();
  const ref = (p) => ({
    en: p.expansion && p.cardno ? { set: p.expansion, number: p.cardno.split("/")[0].trim() } : null,
    ja: p.jpexpansion && p.jpcardno ? { set: p.jpexpansion, number: p.jpcardno.split("/")[0].trim() } : null
  });
  const comEn = (xs) => xs.find((p) => p.expansion && p.cardno) || xs[0];
  const cand = r ? ps.filter((p) => p.jprarity && p.jprarity.toLowerCase() === r) : [];
  if (cand.length) return ref(comEn(cand));
  if (ps.length === 1) return ref(ps[0]);
  if (raridadeRegular(rarity)) {
    const regs = ps.filter((p) => !especial(p));
    const promos = promo ? regs.filter((p) => /promo/i.test(p.expansion) || /promo/i.test(p.jpexpansion)) : [];
    if (promos.length) return ref(comEn(promos));
    if (regs.length) return ref(comEn(regs));
  }
  return null;
}

// ── arte pela impressão EN/JP ───────────────────────────────────────────────
// Nome de set comparável entre a Bulbapedia e o catálogo ("Pokémon Card 151",
// "SVP Black Star Promos", "Sun & Moon").
export function normSet(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
// Número comparável: "006" = "6", "SWSH100" = "swsh100", "TG05" = "tg5".
export function numKey(n) {
  return String(n == null ? "" : n).split("/")[0].trim().toLowerCase().replace(/\d+/g, (d) => String(Number(d)));
}
// Índice de busca: { en: Map(nomeNorm -> [Map(numKey -> carta)]), ja: idem }.
//   en: [{ name, cards }] — os chunks EN (o `set` é o nome da TCGdex, que é o
//       da Bulbapedia na quase totalidade: "Lost Thunder", "151",
//       "Prismatic Evolutions", "SWSH Black Star Promos");
//   ja: [{ name, cards }] — os chunks JA com o nome INGLÊS da página da
//       Bulbapedia do set (data/ja-enrich/<setId>.json#page sem " (TCG)"),
//       porque o `set` do chunk japonês é o nome em japonês.
export function indiceArte({ en = [], ja = [] } = {}) {
  const monta = (lista) => {
    const m = new Map();
    for (const { name, cards } of lista) {
      const k = normSet(name);
      if (!k || !cards || !cards.length) continue;
      const porNum = new Map();
      for (const c of cards) { const nk = numKey(c.number); if (nk && !porNum.has(nk)) porNum.set(nk, c); }
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(porNum);
    }
    return m;
  };
  return { en: monta(en), ja: monta(ja) };
}
// Imagem (e ilustrador) da impressão da qual a carta chinesa é reimpressão:
// EN primeiro (texto legível pra quem usa o site), JA depois. O número do
// wiki pode estar num subset do mesmo nome ("Astral Radiance" TG05 ->
// "Astral Radiance Trainer Gallery"; "Hidden Fates" SV88 -> "Hidden Fates
// Shiny Vault"), então os sets que COMEÇAM com o nome também contam.
// Devolve { image, artist, de: "en"|"ja" } ou null.
export function arteDe(raw, idx) {
  if (!idx) return null;
  for (const lado of ["en", "ja"]) {
    const ref = raw && raw[lado];
    if (!ref || !ref.set || !ref.number) continue;
    const k = normSet(ref.set), nk = numKey(ref.number);
    const mapa = idx[lado];
    const grupos = [...(mapa.get(k) || [])];
    for (const [nome, gs] of mapa) if (nome !== k && nome.startsWith(`${k} `)) grupos.push(...gs);
    for (const porNum of grupos) {
      const c = porNum.get(nk);
      if (c && c.image) return { image: c.image, artist: c.artist || "", de: lado };
    }
  }
  return null;
}

// ── carta do catálogo ───────────────────────────────────────────────────────
// Categoria pela coluna "Type" da lista (e o subtipo: "Item" + "Pokémon Tool"
// é ferramenta; "Energy" + tipo é energia). Pokémon = tipo de energia.
const TIPOS_POKEMON = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Fairy", "Colorless"]);
export function categoriaDe({ type, subtype, name }) {
  const t = String(type || "").trim(), st = String(subtype || "").trim();
  if (TIPOS_POKEMON.has(t)) return { category: "Pokemon", types: t };
  if (/energy/i.test(t)) return { category: "Energy", energyType: /^basic\b/i.test(name || "") || (!st && / energy$/i.test(name || "") && TIPOS_POKEMON.has(String(name).replace(/ energy$/i, ""))) ? "Normal" : "Special" };
  const cls = `${t} ${st}`.toLowerCase();
  if (/tool/.test(cls)) return { category: "Trainer", trainerType: "Tool" };
  if (/supporter/.test(cls)) return { category: "Trainer", trainerType: "Supporter" };
  if (/stadium/.test(cls)) return { category: "Trainer", trainerType: "Stadium" };
  if (/item|trainer|technical machine/.test(cls)) return { category: "Trainer", trainerType: "Item" };
  return {};
}

// Variantes: C/U/sem raridade saem como Normal; R pra cima e toda carta de
// Gem Pack (todas holo) como Holo. O chinês tem ainda espelhadas e padrões
// Poké Ball/Master Ball nas C/U/R — o catálogo não modela padrão, e chutar
// "Reverse" em set cuja impressão não conhecemos criaria variante que não
// existe; fica pra quando houver fonte.
export function variantesDe(rarity) {
  const r = String(rarity || "").trim();
  if (!r || /^(C|U|Common|Uncommon)$/i.test(r)) return ["Normal"];
  return ["Holo"];
}

// dexId pelo nome da espécie (mapa nome minúsculo -> dex da PokéAPI). Sem
// página no wiki (Gem Pack), tira sufixo de mecânica e, se preciso, palavras
// da frente ("Captain Pikachu", "Hisuian Growlithe", "Iono's Bellibolt").
export function dexDe({ species, name, dexId, category }, revNames) {
  if (Number(dexId) > 0) return Number(dexId);
  if (category && category !== "Pokemon") return 0;
  const rev = revNames || {};
  const tenta = (s) => rev[String(s || "").trim().toLowerCase()] || 0;
  if (species && tenta(species)) return tenta(species);
  const limpo = String(name || "").replace(/\s*[-\s](GX|EX|ex|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Prime|LEGEND|◇|☆)$/g, "").trim();
  const ws = limpo.split(/\s+/);
  for (let k = 0; k < ws.length; k++) { const d = tenta(ws.slice(k).join(" ")); if (d) return d; }
  return 0;
}
export function genOf(dexId) {
  const id = Number(dexId); if (!id) return "";
  const caps = [151, 251, 386, 493, 649, 721, 809, 905];
  const i = caps.findIndex((c) => id <= c);
  return i < 0 ? 9 : i + 1;
}

// Uma carta do cache (data/zh-import/<setId>.json) -> carta do catálogo.
// `set` = cabeçalho do cache; `arte` = { image, artist } resolvidos pelo build
// a partir da impressão EN/JP; `revNames` = nome -> dexId.
export function montarCarta(raw, set, { arte, revNames, sufixo } = {}) {
  const cat = categoriaDe(raw);
  const dexId = dexDe({ ...raw, category: cat.category }, revNames);
  const card = {
    id: `${set.id}-${raw.number}${sufixo ? `-${sufixo}` : ""}-${LANG}`,
    name: raw.name,
    pokemonName: cat.category === "Pokemon" || !cat.category ? (raw.species || "") : "",
    category: cat.category || "",
    dexId: dexId || "",
    generation: genOf(dexId),
    pokemonImage: dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "",
    number: raw.number,
    set: set.name,
    setId: set.id,
    setLogo: set.logo || "",
    setSymbol: "",
    setTotal: set.total || "",
    setReleaseDate: set.release || "",
    setSerieId: set.serieId || "",
    setSerieName: set.serieName || "",
    artist: (arte && arte.artist) || raw.artist || "",
    rarity: raw.rarity || "",
    language: LANG,
    image: (arte && arte.image) || "",
    variants: variantesDe(raw.rarity)
  };
  if (cat.types) card.types = cat.types;
  if (cat.trainerType) card.trainerType = cat.trainerType;
  if (cat.energyType) card.energyType = cat.energyType;
  if (raw.stage && card.category === "Pokemon") card.stage = raw.stage;
  return card;
}
