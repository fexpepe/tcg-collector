// RARIDADE do Data Carddass NARUTO onde o catálogo não tinha (2026-11-28,
// pedido do Fernando: "todos os sets dessas coleções, não só a lista das
// cartas, mas a raridade delas"). Nenhuma lista oficial da Bandai dá
// raridade — nem a do Card Battle (carddas.com), nem a da Mission, nem a da
// Formation (fudanin.com), nem o popup de cada carta; só os PDFs de checklist
// da Cross, com estrelas (naruto-dc-checklists.json). Então vêm duas fontes
// de fora, as duas num snapshot só (data/vintage/naruto-dc-raridade.json):
//
// 1. O blog do nao-yoshi (nao-yoshi.seesaa.net, 2006–2010): listas de código
//    de barras de cada título com uma coluna "レア" carta a carta. O site dá
//    403 hoje (fora do Japão também no navegador), então o que vale são as
//    capturas do Wayback, FIXAS abaixo. Três posts sobreviveram: Card Battle
//    DN-108T–249T (o de DN-001–107 não foi arquivado — esses têm o Ameblo e
//    o hinokunian), Mission (vem pela metade a partir do 第4章) e Cross. O da
//    Formation não foi arquivado, nem a página do arquivo mensal em que ele
//    estava (dez/2007).
// 2. O Suruga-ya pela busca do Rakuten (a loja dele lá): o título do anúncio
//    é "NARUTOデータカードダス NF-185[SR]：自来也", a mesma escrita do
//    snapshot do Suruga-ya da Formation/Cross (naruto-dc-suruga.json). O site
//    do Suruga-ya barra robô e pede verificação no navegador; a busca do
//    Rakuten responde a fetch comum e o robots.txt dela libera a paginação
//    (?p=). Só aparece o que a loja tem anunciado, então cada coleta SOMA à
//    anterior (nunca regride).
//
// Vocabulário → sigla do catálogo:
//   - Card Battle (nao-yoshi): 爆 = 爆レア = UR, 激 = 激レア = SR, Ｒ, Ｎ — a
//     mesma escada do Ameblo e do hinokunian nos DN-001–107. No 第6弾
//     (DN-141–171) ele escreve "-" na normal, e só ali: é N (o Suruga-ya
//     anuncia a DN-142T como [N]).
//   - Mission e Cross (nao-yoshi): as siglas da carta (N, R, SR, UR, NR, WNR).
//     "-" é promo ou carta que ele não conferiu: fica de fora.
//   - Suruga-ya: a sigla impressa quase sempre; os nomes por extenso viram
//     sigla pelo RARIDADE_JP (o mesmo do sync da Formation/Cross).
// Linha com "(白)" no nome é a versão de verso branco, outro código de barras
// da MESMA carta (mesma raridade): não entra duas vezes.
//
// Os syncs aplicam isto SÓ nas cartas que ficaram sem raridade depois das
// fontes que já existiam (completaRaridade), e só quando número E nome
// batem. Onde as duas fontes falam da mesma carta e discordam, ela fica sem
// (ver completaRaridade). Onde uma delas discorda do que o catálogo já
// tinha, o catálogo fica: o PDF oficial da Cross dá WNR pras NX-259 e
// NX-282, que o nao-yoshi chama de NR.
//
// História encerrada: roda à mão, não no CI (padrão dos snapshots manuais).
//   node scripts/naruto-dc-raridade.mjs              # as duas fontes
//   node scripts/naruto-dc-raridade.mjs --nao-yoshi  # só relê o Wayback
//   node scripts/naruto-dc-raridade.mjs --rakuten    # só soma uma coleta nova do Rakuten
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { nomeChave, mesmoNome } from "./naruto-raridade-hinokunian.mjs";

const SNAP = new URL("../data/vintage/naruto-dc-raridade.json", import.meta.url);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Capturas fixas do Wayback. A da Cross é o arquivo mensal de jan/2009 (o
// post em si não foi arquivado): o post vai do título dele até o próximo
// cabeçalho de data.
export const NAO_YOSHI = [
  { titulo: "Card Battle DN-108T–249T", ts: "20200806200351", url: "https://nao-yoshi.seesaa.net/article/387082805.html" },
  { titulo: "Mission", ts: "20260316184526", url: "https://nao-yoshi.seesaa.net/article/387083049.html" },
  {
    titulo: "Cross", ts: "20140519022755", url: "http://nao-yoshi.seesaa.net:80/archives/200901-1.html",
    de: 'class="title">【ナルト疾風伝～ナルティメットクロス', ate: '<h2 class="date">'
  }
];

const limpa = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .normalize("NFKC").replace(/\s+/g, " ").trim();
const CODIGO = /^(DN|NM|DMP|NC|CAN|NX|NXP|NXpf|NF|NFP|NFC|NFF|NFM|NFPF|VJCF)-?[A-Za-z0-9]/;

// Tabela do post → [[número, raridade crua, nome]]. As colunas mudam de post
// pra post (o do Card Battle tem uma coluna "種" antes do número, o da Cross
// não), então a linha é achada pela célula do número: o nome vem logo
// depois e a raridade em seguida. Linha de seção (【第1章】) não tem número.
export function parseNaoYoshi(html, { de, ate } = {}) {
  let corpo = html;
  if (de) {
    const i = html.indexOf(de);
    if (i < 0) return [];
    const j = ate ? html.indexOf(ate, i + de.length) : -1;
    corpo = html.slice(i, j > 0 ? j : undefined);
  }
  const out = [];
  for (const tr of corpo.split(/<tr[^>]*>/i).slice(1)) {
    const tds = tr.split(/<\/tr>/i)[0].split(/<t[dh][^>]*>/i).slice(1).map(limpa);
    const k = tds.findIndex((t) => CODIGO.test(t));
    if (k < 0) continue;
    out.push([tds[k], tds[k + 2] || "", tds[k + 1] || ""]);
  }
  return out;
}

const SIGLAS = new Set(["N", "R", "SR", "UR", "NR", "WNR"]);
// Linha crua → [número do catálogo, sigla, nome], ou null quando não entra.
export function siglaNaoYoshi([bruto, rar, nome]) {
  // Verso branco, mesma carta: no Card Battle o 白 vem colado no número
  // (DN-155T白), na Mission no nome ("…(白)").
  if (/\(白\)$/.test(nome) || /白$/.test(bruto)) return null;
  let num = bruto;
  const dn = bruto.match(/^DN-(\d{3})T$/);
  if (/^DN-/.test(bruto) && !dn) return null;
  if (dn) {
    const n = Number(dn[1]);
    // O post é o "その2": o que ele lista abaixo de 108 é relistagem no
    // 第8弾, e a raridade da relistagem pode mudar (a DN-067 é UR no 第3弾
    // e N no 第4弾). Vale a da estreia, que este post não tem.
    if (n < 108) return null;
    num = `DN-${dn[1]}`;
    const sigla = { "爆": "UR", "激": "SR", R: "R", N: "N" }[rar] || (rar === "-" && n >= 141 && n <= 171 ? "N" : "");
    return sigla ? [num, sigla, nome] : null;
  }
  return SIGLAS.has(rar) ? [num, rar, nome] : null;
}

// Suruga-ya: o mesmo vocabulário do sync da Formation/Cross, mais os nomes
// das raridades do Card Battle por extenso.
export const RARIDADE_SURUGA = {
  "プロモ": "P",
  "プロモーションカード": "P",
  "ホログラフィックレア": "HR",
  "銀ホロカード": "Silver Holo",
  "デザインレア": "Design Rare",
  "激レア": "SR",
  "爆レア": "UR",
  "レア": "R",
  "ノーマル": "N"
};
// Página de busca do Rakuten → [[número, sigla, nome]]. Raridade fora do
// vocabulário conhecido vai crua (o relatório do script mostra).
export function parseRakuten(html) {
  const out = [];
  const re = /NARUTOデータカードダス\s*([A-Za-z]{1,5}-[0-9A-Za-z]+)\s*\[([^\]]+)\]\s*[：:]\s*([^"<]{1,60})/g;
  for (const m of html.normalize("NFKC").matchAll(re)) {
    // Card Battle: só a impressão de estreia (DN-120T). As relistagens
    // (T2–T8, TC2, TJ…) podem ter outra raridade, e a do catálogo é a da
    // estreia.
    if (/^DN-/.test(m[1]) && !/^DN-\d{3}T$/.test(m[1])) continue;
    const num = m[1].replace(/^(DN-\d{3})T$/, "$1");
    const rar = m[2].trim();
    // O mesmo título volta no JSON da página com as aspas escapadas: a barra
    // do escape não é do nome.
    out.push([num, RARIDADE_SURUGA[rar] || rar, m[3].replace(/\\+$/, "").trim()]);
  }
  return out;
}

// Aplica nas cartas SEM raridade, só com número e nome batendo (a mesma
// régua do aplicaRaridade do hinokunian). Duas travas, pela regra de que
// raridade de outra carta é pior que nenhuma:
//   - número com duas raridades no Suruga-ya pro mesmo nome (a paralela
//     NP/SP anunciada junto da normal): não dá pra saber qual é a do
//     catálogo, o Suruga-ya não conta pra essa carta;
//   - Suruga-ya e nao-yoshi com raridades diferentes: a carta fica sem.
//     Nas 141 em que os dois falam, discordam em 4 (DN-152 e DN-153, que
//     parecem trocadas numa das listas, NM-144 e NM-180).
// Devolve as contagens e os conflitos pro log do sync.
export function completaRaridade(cards, snap, { nomeDe = (c) => c.nameJp || c.name } = {}) {
  const indice = (linhas) => {
    const m = new Map();
    for (const [num, rar, nome] of linhas) {
      if (!m.has(num)) m.set(num, []);
      m.get(num).push({ rar, nome: nomeChave(nome) });
    }
    return m;
  };
  const su = indice((snap && snap.suruga) || []);
  for (const opcoes of su.values()) {
    for (const o of opcoes) if (opcoes.some((p) => p.nome === o.nome && p.rar !== o.rar)) o.ambigua = true;
  }
  const ny = indice((snap && snap.naoYoshi) || []);
  const escolhe = (opcoes, meu) => opcoes.find((o) => o.nome === meu) || opcoes.find((o) => mesmoNome(o.nome, meu));
  const out = { suruga: 0, naoYoshi: 0, conflitos: [] };
  for (const c of cards) {
    if (c.rarity) continue;
    const meu = nomeChave(nomeDe(c));
    const a = escolhe(su.get(c.number) || [], meu);
    const b = escolhe(ny.get(c.number) || [], meu);
    const doSuruga = a && !a.ambigua ? a.rar : "";
    if (doSuruga && b && doSuruga !== b.rar) { out.conflitos.push(`${c.number} (Suruga-ya ${doSuruga} × nao-yoshi ${b.rar})`); continue; }
    if (doSuruga) { c.rarity = doSuruga; out.suruga++; } else if (b) { c.rarity = b.rar; out.naoYoshi++; }
  }
  return out;
}

async function baixa(url, { shiftJis = false } = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.ok) return shiftJis ? new TextDecoder("shift_jis").decode(await r.arrayBuffer()) : await r.text();
    } catch { /* tenta de novo */ }
    await sleep(5000 * (i + 1));
  }
  return null;
}

async function leNaoYoshi() {
  const linhas = [];
  const vistas = new Set();
  for (const p of NAO_YOSHI) {
    const html = await baixa(`https://web.archive.org/web/${p.ts}id_/${p.url}`, { shiftJis: true });
    if (!html) { console.log(`  nao-yoshi ${p.titulo}: Wayback inacessível — nada gravado.`); return null; }
    const brutas = parseNaoYoshi(html, p);
    let n = 0;
    for (const b of brutas) {
      const l = siglaNaoYoshi(b);
      if (!l || vistas.has(`${l[0]}|${l[2]}`)) continue;
      vistas.add(`${l[0]}|${l[2]}`);
      linhas.push(l);
      n++;
    }
    console.log(`  nao-yoshi ${p.titulo}: ${brutas.length} linhas, ${n} com raridade.`);
    await sleep(2000);
  }
  return linhas;
}

// Uma busca por família de código; pagina até duas páginas seguidas sem
// título novo (a busca do Rakuten é por palavra, então traz de tudo um pouco).
export const BUSCAS_RAKUTEN = ["DN-", "NM-", "NC-", "NF-", "NFC-", "NFF-", "NFM-", "NFP-", "NX-", "NXP-"];
async function leRakuten(anteriores) {
  const linhas = new Map((anteriores || []).map((l) => [l.join("|"), l]));
  const antes = linhas.size;
  for (const b of BUSCAS_RAKUTEN) {
    let secas = 0;
    for (let p = 1; p <= 40 && secas < 2; p++) {
      const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(`NARUTOデータカードダス ${b}`)}/${p > 1 ? `?p=${p}` : ""}`;
      const html = await baixa(url);
      let novos = 0;
      for (const l of html ? parseRakuten(html) : []) {
        const k = l.join("|");
        if (!linhas.has(k)) { linhas.set(k, l); novos++; }
      }
      secas = novos ? 0 : secas + 1;
      await sleep(2500); // gentileza com a busca
    }
    console.log(`  Rakuten "${b}": ${linhas.size} títulos até aqui.`);
  }
  console.log(`  Rakuten: ${linhas.size - antes} títulos novos (${linhas.size} no total).`);
  return [...linhas.values()].sort((x, y) => x[0].localeCompare(y[0], "en", { numeric: true }) || x[2].localeCompare(y[2]));
}

async function run() {
  const so = process.argv.includes("--nao-yoshi") ? "nao" : process.argv.includes("--rakuten") ? "rakuten" : "";
  const atual = JSON.parse(await readFile(SNAP, "utf8").catch(() => "null")) || {};
  const naoYoshi = so === "rakuten" ? atual.naoYoshi : await leNaoYoshi();
  if (!naoYoshi) { process.exitCode = 1; return; }
  const suruga = so === "nao" ? atual.suruga : await leRakuten(atual.suruga);
  const snap = {
    _: "Raridade do Data Carddass NARUTO por número, pras cartas que as outras fontes deixaram sem. naoYoshi = colunas レア do blog nao-yoshi (Wayback, capturas em fontes); suruga = títulos do Suruga-ya na busca do Rakuten (soma a cada coleta). [número, sigla, nome]. Gerado por scripts/naruto-dc-raridade.mjs; os syncs só aplicam em carta sem raridade, com número E nome batendo.",
    updatedAt: new Date().toISOString().slice(0, 10),
    fontes: [...NAO_YOSHI.map((p) => `${p.ts} ${p.url}`), "https://search.rakuten.co.jp/search/mall/NARUTOデータカードダス <família>/"],
    naoYoshi,
    suruga: suruga || []
  };
  await writeFile(SNAP, JSON.stringify(snap, null, 1) + "\n", "utf8");
  const cru = snap.suruga.filter(([, r]) => !/^(N|R|SR|UR|NR|WNR|HR|NP|SP|P|Silver Holo|Design Rare)$/.test(r));
  if (cru.length) console.log(`  raridades do Suruga-ya fora do vocabulário: ${[...new Set(cru.map(([, r]) => r))].join(", ")}`);
  console.log(`Gravado ${fileURLToPath(SNAP)} — nao-yoshi ${snap.naoYoshi.length}, Suruga-ya ${snap.suruga.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
