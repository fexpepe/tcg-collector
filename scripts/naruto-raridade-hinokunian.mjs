// RARIDADE do Naruto vintage japonês, carta a carta (2026-11-01). Nenhuma das
// fontes da checklist dá a raridade (tcg-db quase nunca, TV Tokyo nunca); o
// hinokunian.konohashigure.com (site de fã, estático, Shift-JIS, sem
// robots.txt) tem uma página por volume com a raridade na 1ª célula da linha:
//   - NARUTO カードゲーム 巻ノ壱–巻ノ十五 (cardgamemakino1–15.html);
//   - ナルティメットカードバトル 第一〜四弾 (cardbattle1–4.html), DN-001T–107T.
// Os 巻ノ十六/十七, o resto do Card Battle e a Mission não têm página.
//
// Desde 2026-11-13 lê também os 14 produtos FORA dos boosters (starters,
// 拡張シート, 忍兵法札絵巻/大全), que é onde estreou toda carta que os volumes
// não têm: as do set "拡張・スペシャル" e as de starter numeradas dentro da
// faixa de um volume. Cuidado que custou medir: nessas páginas a raridade é a
// do PRODUTO, e quase tudo ali é reimpressão — a mesma carta é R no booster e
// N no starter (148 casos). Então dessas páginas só vale a linha da ESTREIA
// da carta (ver estreiasForaDosBoosters): número que nenhum booster tem, no
// produto mais antigo em que aparece. A conta fecha com o catálogo: o starter
// 雷鳴の書・風雲の書 saiu no dia do 巻ノ五, o 蝦蟇・守鶴 na véspera do 巻ノ八, e
// as cartas de cada um caem na faixa de número desses volumes.
//
// Vocabulário do site → o que vai pro catálogo (a sigla, como o tcg-db e o
// Suruga-ya escrevem): vazio = ノーマル "N", R = レア "R", SR = スーパーレア
// "SR", U = ウルトラレア "UR", M = "Memorial". Os totais por raridade batem com
// o quadro de cada página (巻ノ壱: UR 4, SR 8, R 18, N 40).
//
// Erros conhecidos do site, corrigidos aqui:
//   - no 巻ノ七 os 術 e 作 vêm rotulados "忍-127…" (a numeração REINICIA no
//     meio da tabela de 忍): queda no número de um 忍 = começou a seção
//     seguinte (忍 → 術 → 作, a ordem de todas as páginas);
//   - o 第四弾 do Card Battle escreve "DT-" no lugar de "DN-", e o sufixo "T"
//     do número oficial (DN-001T) não existe no nosso catálogo (DN-001).
// A trava de verdade é no build (aplicaRaridade): a raridade só entra se o
// NÚMERO e o NOME japonês baterem com a carta do catálogo.
//
// História encerrada: roda à mão, não no CI (padrão dos snapshots manuais).
//   node scripts/naruto-raridade-hinokunian.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sync-common.mjs";

const SNAP = new URL("../data/vintage/naruto-raridade.json", import.meta.url);
const BASE = "http://hinokunian.konohashigure.com/";
const PAGINAS = [
  ...Array.from({ length: 15 }, (_, i) => `cardgamemakino${i + 1}.html`),
  ...Array.from({ length: 4 }, (_, i) => `cardbattle${i + 1}.html`)
];
// Produtos fora dos boosters, na ORDEM de lançamento (a 発売日 de cada página;
// a do 迅雷・烈火 vem digitada "2004312.10" e é 2004-12-10). A ordem é o que
// decide a estreia, então produto novo entra na posição da data dele. Ficam
// de fora o COIN＋ e o カードスタンド, que a página lista sem raridade.
export const EXTRAS = [
  ["cardgamestarter.html", "2003-07"], // 秘技伝授スターター ナルトの書・サスケの書
  ["cardgamestarterraimeifuuun.html", "2003-10-24"], // 雷鳴の書・風雲の書
  ["cardgamestartergokui.html", "2003-12"], // 拡張シート 極意忍法帖
  ["cardshinobihyouhou1.html", "2004-03-18"], // 忍兵法札絵巻
  ["cardgamestaetergamashukaku.html", "2004-07-08"], // 蝦蟇の書・守鶴の書 ("staeter" é do site)
  ["cardgameyukihime.html", "2004-08"], // 拡張シート 雪姫忍法帖
  ["cardgamestarterjinrairekka.html", "2004-12-10"], // 迅雷の書・烈火の書
  ["cardgamehyouhouemaki2.html", "2005-02-12"], // 忍兵法札絵巻・弐
  ["cardgamekakuchouemaki.html", "2005-02-12"], // 拡張シート 忍兵法札絵巻
  ["cardgamestarterkonohajuin.html", "2005-07-15"], // 木ノ葉の書・呪印の書
  ["cardgamekakuchoufail1.html", "2005-08-27"], // 拡張ファイリングシート１
  ["cardgameshinobitaizen.html", "2005-11"], // 忍兵法札大全
  ["cardgameanyaku.html", "2006-03-17"], // 暗躍の書
  ["cardgamekakuchoufail2.html", "2006-03-17"] // 拡張ファイリングシート２
];
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

const RARIDADE = { "": "N", R: "R", SR: "SR", U: "UR", M: "Memorial" };
const SECOES = ["忍", "術", "作"];

const limpa = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/[\s　]+/g, " ").trim();

// Uma página → [[número, raridade, nome]]. Linha de carta = 1ª célula a
// raridade, 2ª o número, 3ª o nome. `extra` = página de produto fora dos
// boosters: ali a seção vem rotulada certo e a numeração NÃO é crescente (são
// dois baralhos na mesma tabela), então a troca de seção pela queda do
// número, que conserta o 巻ノ七, fica desligada; e aparecem as OP忍 da folha de
// expansão, com o número escrito como no catálogo. As duas PR忍 do 忍兵法札
// 絵巻・弐 (PR忍-5 初代火影 e PR忍-6 二代目火影, "U" no site) NÃO entram: a
// raridade delas é curadoria do dono (naruto-promos-curated.json, "R"), e
// curadoria feita à mão vence fonte.
export function parseHinokunian(html, { extra = false } = {}) {
  const out = [];
  let secao = 0;
  let anterior = -1;
  for (const tr of html.split(/<TR[^>]*>/i).slice(1)) {
    const tds = tr.split(/<TD[^>]*>/i).slice(1).map(limpa);
    if (tds.length < 3) continue;
    const bruto = tds[1].normalize("NFKC").replace(/[－‐–]/g, "-");
    const m = extra
      ? bruto.replace(/ /g, "").match(/^((?:OP)?(?:忍|術|作|依|騎))-(\d+)$/)
      : bruto.match(/^(忍|術|作|依|騎|DN|DT)-(\d+)T?$/);
    if (!m || !Object.prototype.hasOwnProperty.call(RARIDADE, tds[0])) continue;
    let [, prefixo, n] = m;
    const num = Number(n);
    if (prefixo === "DT") prefixo = "DN";
    if (!extra && SECOES.includes(prefixo)) {
      // Rótulo explícito de outra seção manda; "忍" com o número caindo é a
      // seção seguinte rotulada errado (巻ノ七).
      if (prefixo !== "忍") secao = SECOES.indexOf(prefixo);
      else if (secao > 0 || num < anterior) {
        if (num < anterior) secao = Math.min(secao + 1, SECOES.length - 1);
        prefixo = SECOES[secao];
      }
      anterior = num;
    }
    const numero = prefixo === "DN" ? `DN-${String(num).padStart(3, "0")}` : `${prefixo}-${num}`;
    out.push([numero, RARIDADE[tds[0]], tds[2]]);
  }
  return out;
}

// Das páginas fora dos boosters, só a linha em que a carta ESTREOU. Entra
// `paginas` = [{ data, linhas }] já na ordem de lançamento, e os números que
// os boosters têm. Sai o que sobra depois de três cortes:
//   - número que algum booster tem: ali é reimpressão, com a raridade do
//     starter (e se o nome do booster não bater com o do catálogo, a carta
//     fica sem raridade, não com a da reimpressão);
//   - número que um produto mais antigo já trouxe: reimpressão também;
//   - dois produtos do MESMO dia com raridades diferentes: não dá pra saber
//     qual é a estreia, a carta sai.
export function estreiasForaDosBoosters(paginas, nosBoosters) {
  const estreia = new Map(); // número → { data, linha, empate }
  for (const { data, linhas } of paginas) {
    for (const linha of linhas) {
      const [num, rar] = linha;
      if (nosBoosters.has(num)) continue;
      const antes = estreia.get(num);
      if (!antes) estreia.set(num, { data, linha, empate: false });
      else if (antes.data === data && antes.linha[1] !== rar) antes.empate = true;
    }
  }
  return [...estreia.values()].filter((e) => !e.empate).map((e) => e.linha);
}

// Nome comparável: largura (NFKC), espaço, aspas e pontuação de enfeite fora.
export const nomeChave = (s) => String(s || "").normalize("NFKC").replace(/[\s・·.,!！?？「」『』()（）~〜ー\-"'“”‘’]/g, "");

// Distância de edição (Levenshtein), pra aceitar o mesmo nome com um kanji
// trocado — erro de digitação de um dos dois lados (隠れ蓑/隠れ身, 砂漠/砂瀑,
// イアシ/イヤシ). Até 1/4 do nome (mínimo 1): "阿吽の暗殺術" × "阿吽の呼吸" são
// cartas diferentes e ficam de fora.
function distancia(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return d[b.length];
}
export function mesmoNome(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return distancia(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4));
}

// Aplica o snapshot nas cartas de UMA linha (mexe nelas). Carta cujo número
// existe no snapshot mas com OUTRO nome fica sem raridade — é o caso em que
// o site numerou errado, e raridade de outra carta é pior que nenhuma.
// Devolve as contagens pro log do sync.
export function aplicaRaridade(cards, snap, { nomeDe = (c) => c.nameJp || c.name } = {}) {
  const porNumero = new Map();
  for (const [num, rar, nome] of (snap && snap.cards) || []) {
    if (!porNumero.has(num)) porNumero.set(num, []);
    porNumero.get(num).push({ rar, nome: nomeChave(nome) });
  }
  let aplicadas = 0;
  let nomeDiferente = 0;
  for (const c of cards) {
    const opcoes = porNumero.get(c.number);
    if (!opcoes) continue;
    const meu = nomeChave(nomeDe(c));
    const certo = opcoes.find((o) => o.nome === meu) || opcoes.find((o) => mesmoNome(o.nome, meu));
    if (certo) { c.rarity = certo.rar; aplicadas++; } else nomeDiferente++;
  }
  return { aplicadas, nomeDiferente };
}

async function baixa(pagina) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + pagina, { headers: UA, signal: AbortSignal.timeout(25000) });
      if (r.ok) return new TextDecoder("shift_jis").decode(await r.arrayBuffer());
    } catch (e) { /* tenta de novo */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

async function run() {
  const cards = [];
  for (const pagina of PAGINAS) {
    const html = await baixa(pagina);
    if (!html) { console.log(`  ${pagina}: inacessível — snapshot NÃO gravado (tudo ou nada).`); process.exitCode = 1; return; }
    const linhas = parseHinokunian(html);
    console.log(`  ${pagina}: ${linhas.length} linhas`);
    cards.push(...linhas);
    await sleep(400); // gentileza com o site de fã
  }
  // Fora dos boosters: lê as 14 páginas e fica só com a estreia de cada carta.
  const nosBoosters = new Set(cards.map(([num]) => num));
  const extras = [];
  for (const [pagina, data] of EXTRAS) {
    const html = await baixa(pagina);
    if (!html) { console.log(`  ${pagina}: inacessível — snapshot NÃO gravado (tudo ou nada).`); process.exitCode = 1; return; }
    const linhas = parseHinokunian(html, { extra: true });
    console.log(`  ${pagina} (${data}): ${linhas.length} linhas`);
    extras.push({ data, linhas });
    await sleep(400);
  }
  const estreias = estreiasForaDosBoosters(extras, nosBoosters);
  console.log(`  fora dos boosters: ${estreias.length} cartas na estreia (de ${extras.reduce((n, p) => n + p.linhas.length, 0)} linhas; o resto é reimpressão).`);
  cards.push(...estreias);
  const snap = {
    source: `${BASE} (cardgamemakino1–15, cardbattle1–4 e os ${EXTRAS.length} produtos fora dos boosters)`,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: "Raridade por número (N/R/SR/UR/Memorial) do Naruto Card Game e do Card Battle (DN). Dos starters, 拡張シート e coletâneas só entra a linha da ESTREIA da carta: a raridade ali é a do produto, e a reimpressão muda. Gerado por scripts/naruto-raridade-hinokunian.mjs; o build só aplica quando número E nome batem.",
    cards
  };
  await writeFile(SNAP, JSON.stringify(snap, null, 1) + "\n", "utf8");
  console.log(`Gravado ${fileURLToPath(SNAP)} — ${cards.length} linhas.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
