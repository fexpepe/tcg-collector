// RARIDADE do ナルティメットカードバトル 第1〜4弾 (DN-001T–107T) pela lista do
// blog do hash1ag no Ameblo (2026-11-27, pedido do Fernando). É a lista
// inteira numa página só, uma linha por carta, com a raridade escrita como o
// jogo diz: nada = ノーマル, レア, 激レア, 爆レア.
//
// Por que mais uma fonte, se o hinokunian já cobre esses números: as páginas
// dele relistam as cartas dos 弾 anteriores e se contradizem — DN-025 vem R
// numa página e N na outra, DN-053 R e SR, DN-067 UR e N — e o build ficava
// com a primeira que aparecesse. Duas ainda saíam erradas nas duas páginas:
// DN-026 (N, e é a rara do par de 大蛇丸) e DN-062 (rotulada うずまきナルト,
// mas é 九尾のナルト, então ficava sem raridade). A lista do blog resolve as
// quatro do jeito que o set é montado: no 第1弾 cada personagem tem a normal
// e depois a rara, com o golpe mais forte (DN-025 3000 × DN-026 3200, como o
// par do 白, DN-027/028); no 第2弾 vêm 3 激レア (DN-051–053), 8 レア e 4
// normais. Fora essas quatro, as 103 cartas batem com o hinokunian.
//
// A lista oficial da Bandai (carddas.com, no Wayback) não traz raridade, e o
// GIF oficial da carta não mostra o brilho, então não há fonte de primeira
// mão pra desempatar. Mas o próprio hinokunian se desmente: cada página abre
// com um quadro de quantas cartas há de cada raridade, e as linhas dele não
// fecham com o quadro justo onde o blog discorda — o 第二弾 diz SR 6 e R 12
// e as linhas dão 5 e 13 (a DN-053 é a SR que falta); o 第三弾 diz R 12 e
// N 22 e as linhas dão 11 e 23 (a DN-026, relistada ali, é a R).
//
// Vocabulário → sigla do catálogo, a mesma escada que o hinokunian já usava
// pra essas cartas (SR = 激レア e UR = 爆レア nas 18 em que os dois falam):
// nada = "N", レア = "R", 激レア = "SR", 爆レア = "UR". O build aplica DEPOIS
// do hinokunian (sync-naruto-datacarddass.mjs), então esta lista manda; e só
// quando número E nome batem, pelo mesmo aplicaRaridade.
//
// História encerrada: roda à mão, não no CI (padrão dos snapshots manuais).
// O robots.txt do Ameblo libera as páginas de post; o endereço vai sem o
// ?utm_source, que ele barra.
//   node scripts/naruto-raridade-ameblo.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SNAP = new URL("../data/vintage/naruto-raridade-ameblo.json", import.meta.url);
export const URL_LISTA = "https://ameblo.jp/hash1ag/entry-12704039883.html";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
// O 第4弾 termina no DN-107; a lista tem de vir inteira, sem buraco.
export const TOTAL = 107;

export const RARIDADE = { "": "N", "レア": "R", "激レア": "SR", "爆レア": "UR" };

const limpa = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .normalize("NFKC").replace(/\s+/g, " ").trim();

// Página do post → [[número, raridade, nome]]. Só o corpo do post (o
// #entryBody): o mesmo texto volta no JSON da página, e leria tudo duas vezes.
// Cada carta é um <p> "DN-001T <nome>　<raridade>"; o sufixo T do número
// oficial não existe no catálogo (DN-001). Raridade fora do vocabulário
// derruba a linha em vez de chutar.
export function parseAmeblo(html) {
  const ini = html.indexOf('id="entryBody"');
  if (ini < 0) return [];
  const corpo = html.slice(ini, html.indexOf("</div>", ini));
  const out = [];
  for (const p of corpo.split(/<p[^>]*>/i).slice(1)) {
    const m = limpa(p).match(/^DN-(\d+)T? (.+?)(?: (レア|激レア|爆レア))?$/);
    if (!m) continue;
    out.push([`DN-${m[1].padStart(3, "0")}`, RARIDADE[m[3] || ""], m[2]]);
  }
  return out;
}

async function run() {
  const r = await fetch(URL_LISTA, { headers: UA, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r || !r.ok) { console.log(`  ${URL_LISTA}: inacessível — snapshot NÃO gravado.`); process.exitCode = 1; return; }
  const cards = parseAmeblo(await r.text());
  // Tudo ou nada: DN-001 a DN-107 em ordem, um de cada.
  const esperado = Array.from({ length: TOTAL }, (_, i) => `DN-${String(i + 1).padStart(3, "0")}`);
  if (cards.map(([num]) => num).join() !== esperado.join()) {
    console.log(`  a lista veio com ${cards.length} linhas fora da sequência DN-001–${TOTAL} — snapshot NÃO gravado.`);
    process.exitCode = 1;
    return;
  }
  const snap = {
    source: URL_LISTA,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: "Raridade do ナルティメットカードバトル 第1〜4弾 (DN-001–107): nada = N, レア = R, 激レア = SR, 爆レア = UR. Aplicada DEPOIS do hinokunian no sync-naruto-datacarddass.mjs (esta manda), só quando número E nome batem. Gerado por scripts/naruto-raridade-ameblo.mjs.",
    cards
  };
  await writeFile(SNAP, JSON.stringify(snap, null, 1) + "\n", "utf8");
  const conta = cards.reduce((o, [, rar]) => ({ ...o, [rar]: (o[rar] || 0) + 1 }), {});
  console.log(`Gravado ${fileURLToPath(SNAP)} — ${cards.length} linhas (${Object.entries(conta).map(([k, v]) => `${k} ${v}`).join(", ")}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
