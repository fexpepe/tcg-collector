// Catálogo do DUEL MASTERS (デュエル・マスターズ; Takara Tomy / Wizards of the
// Coast, 2002–) — o jogo JAPONÊS, que segue ativo. O Fernando pediu "igual aos
// modernos, atualizando sozinho" (13/11/2026). O caminho dos modernos não
// existe: o TCGplayer não vende Duel Masters, então a TCGCSV não tem categoria
// (conferidas as 94 em 13/11/2026; nem Kaijudo). Ficam DUAS fontes:
//
//   CATÁLOGO — o banco oficial, dm.takaratomy.co.jp/card/ (robots.txt só barra
//   o /wp-admin). A busca é um POST no próprio endereço: `products=<valor>`
//   filtra pelo produto e `pagenum=N` pagina de 50 em 50. A lista só traz o id
//   ("dm26rp3-S001"); nome, tipo, civilização, raridade, custo, poder, raça,
//   ilustrador e o número impresso ("DM26RP3 S1/S11") vêm da ficha
//   /card/detail/?id=<id>. Em 13/11/2026: 399 produtos, ~24,1 mil impressões.
//
//   PREÇO — a Yuyu-tei (yuyu-tei.jp/sell/dm/s/<código>), uma página por set com
//   todas as cartas, preço de venda em iene e estoque (robots.txt sem
//   Disallow). É o preço de UMA loja, não média de mercado, e a loja mostra o
//   preço mesmo esgotada. Vira o slot `u` (USD) pela cotação do dia
//   (Frankfurter/BCE, a mesma referência do build-fx.mjs): o front só conhece
//   dólar e euro. O casamento é pelo NÚMERO IMPRESSO dentro do set — 100% nos
//   três sets do protótipo (DM-01 de 2002, DMR-01 de 2011, DM26-RP3 de 2026;
//   411 cartas, nenhuma ambígua). As quatro diferenças de grafia estão em
//   chaveDoNumero().
//
// Identidade: id = "dm-<id oficial em minúsculas>" ("dm-dm26rp3-s001"). O id
// oficial já é único e estável; o número impresso não serve (repete entre
// sets) e cada impressão (secreta, alternativa) é ficha própria lá — vira
// carta própria aqui, como no Weiß e no Vanguard.
//
// setId: o código que o produto imprime ("DM26-RP3", "DMR-01"), tirado do
// rótulo do filtro oficial. Produto sem código (as 25 temporadas de promo, os
// decks da CoroCoro) fica com o valor do filtro em maiúsculas ("PROMOY5").
// Nome do set: o rótulo sem o código — em japonês, como a fonte publica.
//
// Data de lançamento: a página do produto só traz 発売日 nos recentes. Os
// antigos vêm do snapshot scripts/data/duelmasters-datas.json (montado uma vez
// da wiki do Fandom por scripts/duelmasters-datas.mjs); o que não está em
// nenhum dos dois fica sem data (dado não se inventa).
//
// Imagem: /wp-content/card/cardimage/<arquivo>.jpg, 650×908, do site oficial,
// pedida pelo wsrv.nl (ver imagemDaCarta): sem host novo na CSP nem no SW.
//
// Custo por rodada. A primeira (--full) pede ~700 páginas de lista e uma ficha
// por carta (~24 mil); as fichas já conhecidas NÃO são pedidas de novo (o
// cards.js anterior é o cache). O modo padrão, do build diário, revisita só os
// produtos novos, os 15 do topo do filtro e as promos, e na loja os sets dos
// últimos dois anos mais um sétimo dos antigos por dia (o preço dos outros
// segue o do pricing.js anterior). O --full roda inteiro.
//
// Fora daqui: o texto da carta (ninguém guarda nos jogos de catálogo), o verso
// das cartas de duas faces, nome em inglês (não há oficial) e o Duel Masters
// americano de 2004–2006.
//
//   node scripts/sync-duelmasters.mjs          # incremental (build diário)
//   node scripts/sync-duelmasters.mjs --full   # tudo
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, mapLimit, sleep, decodeEntities } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/duelmasters/", ROOT);
const DATAS = new URL("scripts/data/duelmasters-datas.json", ROOT);
const OFICIAL = "https://dm.takaratomy.co.jp";
const LOJA = "https://yuyu-tei.jp/sell/dm/s/";
// PREÇO DESLIGADO (decisão do Fernando, 14/11/2026). Os termos da Yuyu-tei
// (yuyu-tei.jp/info/rule/) proíbem republicar conteúdo do site sem
// autorização, e a loja barra o servidor do GitHub. Até ela autorizar, o
// jogo vai pro ar SEM preço e o sync não pede nada à loja. Os preços lidos em
// 13/11 ficam guardados em scripts/data/duelmasters-precos-yuyutei.json (fora
// do deploy). Pra religar: true aqui, e devolver o passo de histórico de
// preços no deploy.yml, o healthcheck do pricing e o send-wishlist-push.
export const PRECO_LIGADO = false;
const UA = "Mozilla/5.0 (compatible; Sleevu catalog sync; +https://sleevu.app)";

const limpa = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function pega(url, { corpo, tentativas = 4 } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, {
        method: corpo ? "POST" : "GET",
        headers: Object.assign({ "User-Agent": UA }, corpo ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        body: corpo,
        signal: AbortSignal.timeout(40000)
      });
      if (r.ok) return await r.text();
      ultimo = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status < 500 && r.status !== 429) throw ultimo;
    } catch (e) { ultimo = e; if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e; }
    await sleep(1500 * (i + 1));
  }
  throw ultimo;
}

// ---------------------------------------------------------------- oficial

// O <select name="products"> do banco oficial: [{ valor, rotulo }], na ordem
// da página (o mais novo primeiro; as promos e os especiais no fim).
export function parseProdutos(html) {
  const sel = /<select[^>]*name="products"[\s\S]*?<\/select>/.exec(html);
  if (!sel) return [];
  return [...sel[0].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)/g)]
    .map((m) => ({ valor: m[1].trim(), rotulo: limpa(m[2]) }))
    .filter((p) => p.valor);
}

// "DM26-RP3 逆札篇 第3弾 勝敵！…" -> ["DM26-RP3", "逆札篇 第3弾 勝敵！…"]. O código
// é a grafia da Takara Tomy: começa com DM, letras/dígitos/hífen, e pode colar
// num kanji de edição ("DMR-16真", "DMART極-03"). Rótulo sem código (promos,
// CoroCoro) devolve ["", rótulo].
export function codigoETitulo(rotulo) {
  const r = String(rotulo || "").trim();
  const m = /^(DM[A-Z0-9]*(?:[極真])?-?[A-Z0-9]*[極真]?)\s*(.*)$/.exec(r);
  if (!m || !/\d/.test(m[1])) return ["", r];
  return [m[1], m[2].trim()];
}

// Kanji que entram em código e em id: a loja escreve por extenso.
const KANJI = { "極": "KIWAMI", "真": "SHIN" };
const ascii = (s) => String(s || "").replace(/[極真]/g, (k) => KANJI[k]);

export function setIdDe(produto) {
  const [codigo] = codigoETitulo(produto.rotulo);
  const base = ascii(codigo || produto.valor).toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "SEM-CODIGO";
}

// Ids da lista (uma página do POST). Só a grade de resultado: o resto da
// página não tem link de ficha.
export function parseLista(html) {
  const i = html.indexOf('id="cardlist"');
  if (i < 0) return [];
  return [...html.slice(i).matchAll(/data-href='\/card\/detail\/\?id=([^']+)'><img/g)].map((m) => decodeEntities(m[1]));
}

// A ficha. Carta de duas faces traz dois blocos .card-itself: vale a frente.
export function parseFicha(html) {
  const i = html.indexOf("class='card-itself'");
  if (i < 0) return null;
  const fim = html.indexOf("class='card-itself'", i + 10);
  const bloco = html.slice(i, fim > 0 ? fim : i + 20000);
  const nomeM = /class='card-name'>([\s\S]*?)<span class='packname'>\(([^)]*(?:\)[^<)]*)*)\)<\/span>/.exec(bloco);
  if (!nomeM) return null;
  const pack = limpa(nomeM[2]);
  const corte = pack.indexOf(" ");
  const campo = (classe) => {
    const m = new RegExp(`<td[^>]*class='(?:[^']* )?${classe}(?: [^']*)?'[^>]*>([\\s\\S]*?)</td>`).exec(bloco);
    return m ? limpa(m[1]) : "";
  };
  const img = /<img src="(\/wp-content\/card\/cardimage\/[^"]+)"/.exec(bloco);
  const num = (s) => (/^-?\d+$/.test(s.replace(/[,+]/g, "")) ? Number(s.replace(/[,+]/g, "")) : null);
  return {
    nome: limpa(nomeM[1]),
    numero: corte > 0 ? pack.slice(corte + 1).trim() : "",
    tipo: campo("type"),
    civilizacao: campo("civil"),
    raridade: campo("rarelity"),
    poder: campo("power"),
    custo: num(campo("cost")),
    raca: campo("race"),
    ilustrador: campo("illusttxt"),
    imagem: img ? OFICIAL + img[1] : ""
  };
}

// "dm26rp3-S001" -> "dm-dm26rp3-s001". O banco (card_views, contribute_price)
// só aceita [A-Za-z0-9._-]: o kanji de edição vai por extenso e o que sobrar de
// fora vira hífen.
export function idDaCarta(idOficial) {
  // "+" e "$" são parte do id em dez cartas ("dm34+1s-001", "dmrp07-s06$") e
  // vão por extenso: virar hífen fazia a "s06$" colidir com a "s06".
  return "dm-" + ascii(idOficial).toLowerCase().replace(/\+/g, "plus").replace(/\$/g, "-dollar")
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------------- loja

// Número impresso -> chave que as duas fontes dividem. As quatro diferenças
// medidas em 13/11/2026:
//   - secreta: oficial "㊙1/㊙24", loja "(秘)1/(秘)24" (o NFKC desfaz o ㊙);
//   - zero à esquerda: "S01/S10" × "S1/S10";
//   - numeração sem total: oficial "STD9/", loja "STD9";
//   - duas faces: a loja escreve "41a/110｜41b/110" e a edição alternativa
//     "53am/110｜53b/110"; o oficial, "41/110" e "53m/110".
//   - ano: nos sets de 2002 a 2018 a loja cola o ano no número, "S1/S5/Y5"
//     (ano 5 do jogo, como terceiro trecho) ou "76/80 [2017]"; o oficial só
//     tem "S1/S5" e "76/80". As promos do oficial ("P12/Y5") têm DOIS trechos
//     e ficam como estão. (Achado na carga completa: 74 sets saíram sem preço.)
const normaliza = (trecho) => String(trecho || "").normalize("NFKC").replace(/\s*\[\d{4}\]\s*/g, "").replace(/\s+/g, "")
  .replace(/^([^/]+\/[^/]+)\/Y\d+$/i, "$1").replace(/\(秘\)/g, "秘").toUpperCase()
  .replace(/(^|[^0-9])0+(?=[0-9])/g, "$1").replace(/\/$/, "");

export function chaveDoNumero(numero) {
  const frente = String(numero || "").split(/[｜|]/)[0].replace(/^([A-Za-z]*\d+)a(m?)(?=\/)/, "$1$2");
  return normaliza(frente);
}

// As chaves que um anúncio da LOJA atende. Nas cartas de duas faces o oficial
// tem as duas grafias: uma ficha só ("41/110") ou uma por face ("66A/80" e
// "66B/80"); o anúncio "66a/80｜66b/80" vale pras três.
export function chavesNaLoja(numero) {
  const partes = String(numero || "").split(/[｜|]/);
  return [...new Set([chaveDoNumero(numero), ...partes.map(normaliza)])].filter(Boolean);
}

// Página de set da Yuyu-tei -> [{ numero, nome, iene }].
export function parseLoja(html) {
  const re = /\/sell\/dm\/card\/[^/"]+\/\d+">\s*<div[^>]*product-img[^>]*>\s*<img[^>]*>[\s\S]*?<span[^>]*>([^<]*)<\/span>[\s\S]*?<h4[^>]*>([^<]*)<\/h4>[\s\S]*?<strong[^>]*>\s*([\d,]+)\s*円/g;
  return [...html.matchAll(re)].map((m) => ({ numero: limpa(m[1]), nome: limpa(m[2]), iene: Number(m[3].replace(/,/g, "")) }))
    .filter((l) => l.numero && l.iene > 0);
}

// Códigos de set que a loja tem (o filtro da busca dela).
export function parseSetsDaLoja(html) {
  return new Set([...html.matchAll(/value="([a-z][a-z0-9_-]*)"/g)].map((m) => m[1]));
}

// O código do set NA LOJA. Ela usa o prefixo do id oficial ("dm26rp3-S001" ->
// dm26rp3) em 349 dos 399 produtos; os outros candidatos cobrem o DM-01 (o
// valor do filtro oficial é "1"), o kanji por extenso e os decks.
export function codigoNaLoja(produto, prefixoDosIds, setsDaLoja) {
  const [codigo] = codigoETitulo(produto.rotulo);
  const doCodigo = ascii(codigo).replace(/-/g, "").toLowerCase().replace(/^dm(\d)$/, "dm0$1");
  const candidatos = [prefixoDosIds, doCodigo, "dm" + ascii(produto.valor).toLowerCase(), ascii(produto.valor).toLowerCase()]
    .map((c) => String(c || "").toLowerCase()).filter(Boolean);
  return candidatos.find((c) => setsDaLoja.has(c)) || "";
}

// --------------------------------------------------------------- montagem

// A imagem passa pelo wsrv.nl, como os scans dos vintage: o host já está na
// CSP, no SW e no espelho R2 (que guarda a cópia e tira o navegador do
// visitante de cima do site oficial). 650 px é a largura que a fonte publica;
// o `we` não deixa ampliar.
export const imagemDaCarta = (url) => (url
  ? `https://wsrv.nl/?url=${encodeURIComponent(String(url).replace(/^https?:\/\//, ""))}&w=650&we&output=webp`
  : "");

export function cardOf(idOficial, ficha, set) {
  return {
    id: idDaCarta(idOficial),
    name: ficha.nome,
    set: set.nome,
    setId: set.id,
    number: ficha.numero,
    setTotal: set.total,
    setReleaseDate: set.data || "",
    rarity: ficha.raridade || "",
    artist: ficha.ilustrador || "",
    language: "ja",
    image: imagemDaCarta(ficha.imagem),
    variants: ["Normal"],
    cardType: ficha.tipo || null,
    // CIVILIZAÇÃO (光/水/闇/火/自然/ゼロ; as multicoloridas vêm com barra).
    // `color` é o nome que o índice de busca espera (COLOR_FIELDS).
    color: ficha.civilizacao || null,
    cost: ficha.custo,
    power: ficha.poder || null,
    race: ficha.raca || null
  };
}

// Sets que a loja visita hoje no modo incremental: os dos últimos dois anos e
// um sétimo dos outros (pelo dia da semana), pra o preço de todo set renovar
// em até uma semana sem pedir as ~420 páginas por dia.
export function visitaHoje(set, i, hoje) {
  const idade = set.data ? (Date.parse(hoje) - Date.parse(set.data)) / 86400000 : Infinity;
  return idade < 730 || i % 7 === new Date(hoje).getUTCDay();
}

const dataDaPagina = (html) => {
  const m = /発売日\s*[::]?\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(limpa(html));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};

async function run() {
  const FULL = process.argv.includes("--full");
  // --cache <arquivo>: guarda listas e fichas já lidas, pra a carga completa
  // (mais de uma hora) continuar de onde parou se cair no meio. Só pra rodar à
  // mão; o build diário não usa.
  const iCache = process.argv.indexOf("--cache");
  const CACHE = iCache > 0 ? process.argv[iCache + 1] : "";
  const cache = CACHE && existsSync(CACHE) ? JSON.parse(await readFile(CACHE, "utf8")) : { listas: {}, fichas: {} };
  const salvaCache = async () => { if (CACHE) await writeFile(CACHE, JSON.stringify(cache), "utf8"); };
  const hoje = new Date().toISOString().slice(0, 10);
  console.log(`Duel Masters: banco oficial da Takara Tomy (${FULL ? "completo" : "incremental"})…`);

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const prevPorId = new Map(prev.map((c) => [c.id, c]));
  // Com o preço desligado, nem o pricing.js anterior entra (ele zera na 1ª rodada).
  const prevPreco = PRECO_LIGADO ? ((await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}) : {};
  const datas = existsSync(DATAS) ? JSON.parse(await readFile(DATAS, "utf8")) : {};
  const setsPrev = new Set(prev.map((c) => c.setId));

  // --no-fetch: só remonta o catálogo (manifest, chunks, pricing.generated) a
  // partir do cards.js e do pricing.js versionados. É a rede de segurança do
  // deploy: sem ela, um sync que cai no meio deixa o jogo sem manifest no ar
  // (foi o que aconteceu no 1º deploy, 14/11/2026).
  if (process.argv.includes("--no-fetch")) {
    if (!prev.length) throw new Error("--no-fetch sem cards.js anterior");
    await gravaCatalogo(prev, prevPreco);
    return;
  }

  const produtos = parseProdutos(await pega(`${OFICIAL}/card/`));
  if (produtos.length < 300) throw new Error(`filtro de produtos com ${produtos.length} itens (esperado 399+): a página mudou`);
  console.log(`  ${produtos.length} produtos no filtro.`);

  // 1) Lista de cada produto. No incremental, só os novos, o topo e as promos;
  //    os outros ficam com as cartas do cards.js anterior.
  const sets = []; // { produto, id, nome, ids:[idOficial], prefixo }
  const usados = new Set();
  const donoDoId = new Map();
  let i = 0;
  for (const produto of produtos) {
    const pos = i++;
    let id = setIdDe(produto);
    if (usados.has(id)) id = `${id}-${ascii(produto.valor).toUpperCase().replace(/[^A-Z0-9]+/g, "")}`;
    usados.add(id);
    const revisita = FULL || !setsPrev.has(id) || pos < 15 || /^promo/i.test(produto.valor);
    const set = { produto, id, ids: [], revisitado: revisita };
    sets.push(set);
    if (!revisita) continue;
    try {
      const daLista = cache.listas[produto.valor];
      if (daLista) {
        for (const idOficial of daLista) { if (!donoDoId.has(idOficial)) { donoDoId.set(idOficial, set); set.ids.push(idOficial); } }
        continue;
      }
      const lidos = [];
      for (let p = 1; p <= 60; p++) {
        const html = await pega(`${OFICIAL}/card/`, { corpo: `keyword=&products=${encodeURIComponent(produto.valor)}&pagenum=${p}&samename=show&sort=` });
        const ids = parseLista(html);
        lidos.push(...ids);
        for (const idOficial of ids) {
          if (donoDoId.has(idOficial)) continue; // a primeira lista em que aparece é a dona
          donoDoId.set(idOficial, set);
          set.ids.push(idOficial);
        }
        await sleep(250);
        if (ids.length < 50) break;
      }
      cache.listas[produto.valor] = lidos;
      await salvaCache();
    } catch (e) {
      console.warn(`  ${produto.valor}: erro ${e.message} (fica com o catálogo anterior)`);
      set.revisitado = false;
      for (const idOficial of set.ids) donoDoId.delete(idOficial);
      set.ids = [];
    }
  }
  const revisitados = sets.filter((s) => s.revisitado);
  console.log(`  ${revisitados.length} produtos listados, ${donoDoId.size} cartas.`);

  // 2) Ficha de cada carta NOVA (a conhecida sai do cards.js anterior).
  const novas = [...donoDoId.keys()].filter((idOficial) => !prevPorId.has(idDaCarta(idOficial)));
  console.log(`  ${novas.length} fichas novas a pedir…`);
  const fichas = new Map();
  let falhas = 0;
  await mapLimit(novas, 4, async (idOficial, n) => {
    if (cache.fichas[idOficial]) { fichas.set(idOficial, cache.fichas[idOficial]); return; }
    try {
      const f = parseFicha(await pega(`${OFICIAL}/card/detail/?id=${encodeURIComponent(idOficial)}`));
      if (f) { fichas.set(idOficial, f); cache.fichas[idOficial] = f; } else falhas++;
    } catch { falhas++; }
    await sleep(120);
    if ((n + 1) % 500 === 0) await salvaCache();
    if ((n + 1) % 2000 === 0) console.log(`    ${n + 1}/${novas.length}`);
  });
  await salvaCache();
  if (falhas) console.warn(`  ${falhas} fichas sem leitura (entram na próxima rodada).`);

  // 3) Nome, data e cartas de cada set revisitado.
  const titulos = new Map();
  for (const s of sets) {
    const t = nomeDoSet("duelmasters", codigoETitulo(s.produto.rotulo)[1] || s.produto.rotulo);
    titulos.set(t, (titulos.get(t) || 0) + 1);
  }
  const cards = [];
  const idsVistos = new Set();
  for (const s of revisitados) {
    const titulo = nomeDoSet("duelmasters", codigoETitulo(s.produto.rotulo)[1] || s.produto.rotulo);
    // Título repetido (ou vazio): fica o rótulo inteiro, com o código — o nome
    // do set é chave no índice e não pode repetir.
    s.nome = titulo && titulos.get(titulo) === 1 ? titulo : s.produto.rotulo;
    const prefixos = new Map();
    for (const idOficial of s.ids) { const p = idOficial.replace(/-[^-]*$/, "").toLowerCase(); prefixos.set(p, (prefixos.get(p) || 0) + 1); }
    s.prefixo = [...prefixos.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || "";
    const doPrev = prev.find((c) => c.setId === s.id && c.setReleaseDate);
    s.data = (doPrev && doPrev.setReleaseDate) || datas[s.produto.valor] || "";
    if (!s.data && s.prefixo) {
      // Produto novo: a página dele traz 発売日.
      try { s.data = dataDaPagina(await pega(`${OFICIAL}/product/${s.prefixo}/`)); await sleep(250); } catch { /* sem data */ }
    }
    s.total = s.ids.length;
    for (const idOficial of s.ids) {
      const id = idDaCarta(idOficial);
      if (idsVistos.has(id)) throw new Error(`id repetido depois da normalização: ${id} (${idOficial})`);
      const antiga = prevPorId.get(id);
      const ficha = fichas.get(idOficial);
      if (!ficha && !antiga) continue;
      idsVistos.add(id);
      const meta = { id: s.id, nome: s.nome, total: s.total, data: s.data };
      cards.push(ficha
        ? cardOf(idOficial, ficha, meta)
        : Object.assign({}, antiga, { set: s.nome, setId: s.id, setTotal: s.total, setReleaseDate: s.data || antiga.setReleaseDate || "" }));
    }
  }
  // Sets não revisitados: as cartas do catálogo anterior, como estavam.
  const idsRevisitados = new Set(revisitados.map((s) => s.id));
  for (const c of prev) if (!idsRevisitados.has(c.setId) && !idsVistos.has(c.id)) { cards.push(c); idsVistos.add(c.id); }

  // 4) Preço: a página do set na loja, casada pelo número impresso.
  const pricing = {};
  let cotacao = 0;
  if (!PRECO_LIGADO) console.log("  preço desligado (PRECO_LIGADO = false): a loja não é consultada.");
  else try {
    const j = JSON.parse(await pega("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY"));
    cotacao = Number(j && j.rates && j.rates.JPY);
  } catch (e) { console.warn(`  cotação do iene: ${e.message}`); }
  if (!PRECO_LIGADO) { /* sem preço */ } else if (!(cotacao > 50 && cotacao < 400)) {
    console.warn("  sem cotação USD/JPY confiável: o preço fica o do pricing.js anterior.");
    Object.assign(pricing, prevPreco);
  } else {
    // A loja barra o servidor do GitHub Actions (HTTP 403, nginx; visto no 1º
    // deploy, 14/11/2026 — da máquina do Fernando ela responde). Sem a página
    // de busca não há código de set: o preço fica o do pricing.js versionado
    // e o catálogo segue, em vez de derrubar o sync inteiro.
    let setsDaLoja = null;
    try { setsDaLoja = parseSetsDaLoja(await pega(`${LOJA}search`)); } catch (e) {
      console.warn(`  loja inacessível (${e.message}): o preço fica o do pricing.js anterior.`);
    }
    if (!setsDaLoja) Object.assign(pricing, prevPreco);
    const porSet = new Map();
    for (const c of cards) { if (!porSet.has(c.setId)) porSet.set(c.setId, []); porSet.get(c.setId).push(c); }
    let visitados = 0, semLoja = 0, casadas = 0, n = 0;
    for (const s of setsDaLoja ? sets : []) {
      const doSet = porSet.get(s.id) || [];
      if (!doSet.length) continue;
      const pos = n++;
      const prefixo = s.prefixo || doSet[0].id.replace(/^dm-/, "").replace(/-[^-]*$/, "");
      const codigo = codigoNaLoja(s.produto, prefixo, setsDaLoja);
      const data = doSet[0].setReleaseDate || "";
      const mantem = () => { for (const c of doSet) if (prevPreco[c.id]) pricing[c.id] = prevPreco[c.id]; };
      if (!codigo) { semLoja++; continue; }
      if (!FULL && !s.revisitado && !visitaHoje({ data }, pos, hoje)) { mantem(); continue; }
      try {
        const loja = parseLoja(await pega(`${LOJA}${codigo}`));
        const porChave = new Map();
        for (const l of loja) {
          // Dois anúncios na mesma chave: vale o mais barato (o mesmo critério
          // do "a partir de" da loja).
          for (const k of chavesNaLoja(l.numero)) if (!porChave.has(k) || l.iene < porChave.get(k)) porChave.set(k, l.iene);
        }
        for (const c of doSet) {
          const iene = porChave.get(chaveDoNumero(c.number));
          if (iene) { pricing[c.id] = { u: Math.round((iene / cotacao) * 100) / 100 }; casadas++; }
        }
        visitados++;
        await sleep(900); // educado: é o site de uma loja
      } catch (e) {
        console.warn(`  loja ${codigo}: ${e.message} (mantém o preço anterior)`);
        mantem();
      }
    }
    if (setsDaLoja) console.log(`  preço: ${visitados} sets visitados na loja, ${casadas} cartas casadas, ${semLoja} sets sem página lá; ¥${cotacao.toFixed(2)} por dólar.`);
  }

  // União preservadora: carta que sumiu da fonte fica (do cards.js anterior).
  const merged = cards.concat(preserveMissingCards(prev, cards));
  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço, ${new Set(merged.map((c) => c.setId)).size} sets.`);
  if (merged.length < prev.length * 0.9) throw new Error(`catálogo encolheu de ${prev.length} pra ${merged.length}: não gravo`);
  await gravaCatalogo(merged, pricing);
}

async function gravaCatalogo(merged, pricing) {
  // setLogo: o arquivo local quando existir; senão VAZIO, e o front desenha o
  // NOME do set (política única do site).
  for (const c of merged) {
    const local = `data/duelmasters/set-logos/${c.setId}.webp`;
    c.setLogo = existsSync(new URL(local, ROOT)) ? local : "";
  }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const byArtist = new Map();
  for (const c of merged) { if (c.artist) { if (!byArtist.has(c.artist)) byArtist.set(c.artist, []); byArtist.get(c.artist).push(c.id); } }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: [...byArtist.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name))
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/duelmasters/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
