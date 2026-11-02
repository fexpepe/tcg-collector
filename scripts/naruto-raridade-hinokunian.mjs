// RARIDADE do Naruto vintage japonês, carta a carta (2026-11-01). Nenhuma das
// fontes da checklist dá a raridade (tcg-db quase nunca, TV Tokyo nunca); o
// hinokunian.konohashigure.com (site de fã, estático, Shift-JIS, sem
// robots.txt) tem uma página por volume com a raridade na 1ª célula da linha:
//   - NARUTO カードゲーム 巻ノ壱–巻ノ十五 (cardgamemakino1–15.html);
//   - ナルティメットカードバトル 第一〜四弾 (cardbattle1–4.html), DN-001T–107T.
// Os 巻ノ十六/十七, o resto do Card Battle e a Mission não têm página.
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
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

const RARIDADE = { "": "N", R: "R", SR: "SR", U: "UR", M: "Memorial" };
const SECOES = ["忍", "術", "作"];

const limpa = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/[\s　]+/g, " ").trim();

// Uma página → [[número, raridade, nome]]. Linha de carta = 1ª célula a
// raridade, 2ª o número, 3ª o nome.
export function parseHinokunian(html) {
  const out = [];
  let secao = 0;
  let anterior = -1;
  for (const tr of html.split(/<TR[^>]*>/i).slice(1)) {
    const tds = tr.split(/<TD[^>]*>/i).slice(1).map(limpa);
    if (tds.length < 3) continue;
    const bruto = tds[1].normalize("NFKC").replace(/[－‐–]/g, "-");
    const m = bruto.match(/^(忍|術|作|依|騎|DN|DT)-(\d+)T?$/);
    if (!m || !Object.prototype.hasOwnProperty.call(RARIDADE, tds[0])) continue;
    let [, prefixo, n] = m;
    const num = Number(n);
    if (prefixo === "DT") prefixo = "DN";
    if (SECOES.includes(prefixo)) {
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

async function run() {
  const cards = [];
  for (const pagina of PAGINAS) {
    let html = null;
    for (let i = 0; i < 3 && !html; i++) {
      try {
        const r = await fetch(BASE + pagina, { headers: UA, signal: AbortSignal.timeout(25000) });
        if (r.ok) html = new TextDecoder("shift_jis").decode(await r.arrayBuffer());
      } catch (e) { /* tenta de novo */ }
      if (!html) await sleep(1000 * (i + 1));
    }
    if (!html) { console.log(`  ${pagina}: inacessível — snapshot NÃO gravado (tudo ou nada).`); process.exitCode = 1; return; }
    const linhas = parseHinokunian(html);
    console.log(`  ${pagina}: ${linhas.length} linhas`);
    cards.push(...linhas);
    await sleep(400); // gentileza com o site de fã
  }
  const snap = {
    source: `${BASE} (cardgamemakino1–15, cardbattle1–4)`,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: "Raridade por número (N/R/SR/UR/Memorial) do Naruto Card Game e do Card Battle (DN). Gerado por scripts/naruto-raridade-hinokunian.mjs; o build só aplica quando número E nome batem.",
    cards
  };
  await writeFile(SNAP, JSON.stringify(snap, null, 1) + "\n", "utf8");
  console.log(`Gravado ${fileURLToPath(SNAP)} — ${cards.length} linhas.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
