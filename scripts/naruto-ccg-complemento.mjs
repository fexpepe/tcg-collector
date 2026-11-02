// Naruto CCG americano: as cartas que o narutocards.ca NÃO tem (2026-11-02).
//
// O narutocards (fonte do sync-naruto-ccg.mjs) é incompleto em 10 sets: o
// Curse of the Sand tem 108 cartas lá e 148 no ccgtrader.net, o Approaching
// Wind 90 × 163, o A New Chronicle 106 × 172… São buracos na numeração
// oficial (N-085–096, N-418–460…), e não só de starter: a maioria é Common/
// Uncommon/Rare de booster. Este script monta o COMPLEMENTO com duas fontes
// cruzadas, e o sync anexa ao set de origem.
//
//   1. N-CCG-DB (github.com/N-CCG-DB/naruto-ccg-deckbuilder, deckbuilder de
//      fã, código MIT): narutoccgdatabase.json tem o set, o NOME e o CÓDIGO
//      IMPRESSO de cada carta, e scans 750×1050 no GitHub Pages do projeto.
//      Fixado num commit (FAN_SHA) — história encerrada, e o arquivo muda à
//      mão lá.
//   2. ccgtrader.net: a lista do set com a RARIDADE (Starter Deck separado).
//      O site barra acesso automatizado; a lista foi copiada da página de
//      cada set no navegador, à mão, pra data/vintage/naruto-ccg-ccgtrader.json.
//      A página não mostra o código, mas o id interno da carta segue a
//      referência impressa ("S11-C-044": tipo, US, número) — em ordem de id,
//      a lista casa 1:1 com a do N-CCG-DB.
//
// Carta só entra se as duas fontes concordam: o alinhamento por nome
// (Needleman-Wunsch, tolerante a erro de digitação) tem de casar a carta do
// N-CCG-DB com uma do ccgtrader no MESMO set. Isso descarta as reimpressões
// que o N-CCG-DB lista em sets de theme deck (o Foretold Prophecy lá tem 216:
// 178 do set + 38 de outros sets). Conferência de 2026-11-02: nos 10 sets,
// 1.605 cartas do N-CCG-DB casaram com o ccgtrader pelo nome (4 caíram na
// mesma posição com grafia longe demais, e ficam de fora); a raridade do
// ccgtrader bate com a do narutocards em 1.175 das 1.203 cartas que as duas
// têm, e 24 das 28 diferenças são Starter Deck que o narutocards dá como U/C.
// Quatro scans conferidos à mão (N-784, N-883, M-620, J-1023): o código do
// N-CCG-DB é o impresso.
//
// O que fica de fora, de propósito:
//   - código que já existe no narutocards (inclusive com outra grafia:
//     NC-001 lá = N-C001 aqui);
//   - carta cujo NOME já está no set sob outro código: o narutocards errou o
//     número (no The Chosen o "Frustrated Ambition" está como M-275, que é o
//     "Riot in High-Security Facility"). Vai pra `pendentes`, porque importar
//     duplicaria a carta. Corrigir o número é outra conversa (ids publicados);
//   - os sets 16 em diante, os Tournament Packs, as tins e as promos: lá a
//     numeração do narutocards NÃO é a impressa (o scan que ele chama de N-880
//     tem "883" impresso), então casar por código não vale.
//
// Roda à mão (padrão dos snapshots manuais); o sync só lê o resultado.
//   node scripts/naruto-ccg-complemento.mjs            # baixa o N-CCG-DB (cache) e confere os scans
//   node scripts/naruto-ccg-complemento.mjs --sem-rede # usa o cache, sem conferir scans
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/naruto-ccg.json", ROOT);
const CCGT = new URL("data/vintage/naruto-ccg-ccgtrader.json", ROOT);
const OUT = new URL("data/vintage/naruto-ccg-complemento.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const FAN_SHA = "778f6376296dd2a4a810dfb5e76b1dc28cea1cba"; // 2026-10-17
const FAN_URL = `https://raw.githubusercontent.com/N-CCG-DB/naruto-ccg-deckbuilder/${FAN_SHA}/narutoccgdatabase.json`;
export const FAN_IMG = "n-ccg-db.github.io/naruto-ccg-deckbuilder/cards_database/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const SEM_REDE = process.argv.includes("--sem-rede");

// Chave do SETS do sync → nome do set no N-CCG-DB.
const FAN_SET = {
  s03: "03 Curse of the Sand", s04: "04 Revenge and Rebirth", s07: "07 Quest for Power",
  s08: "08 Battle of Destiny", s09: "09 The Chosen", s10: "10 Lineage of Legends",
  s11: "11 Approaching Wind", s12: "12 A New Chronicle", s14: "14 Emerging Alliance",
  s15: "15 Foretold Prophecy"
};

// Sigla da lista do ccgtrader → raridade do catálogo (o vocabulário do sync).
// "Super Rare (Starter Deck)" é a Super Rare dourada que vinha no starter: a
// raridade impressa é a mesma, só o canal muda.
export const RARIDADE_CCGT = {
  C: "Common", U: "Uncommon", R: "Rare", SR: "Super Rare", SRST: "Super Rare", ST: "Starter Deck"
};

// Código sem hífen: "NC-001" (narutocards) e "N-C001" (N-CCG-DB) são a mesma
// carta, "MUS-077" e "M-US077" também.
export const codigoCanonico = (code) => String(code || "").toUpperCase().replace(/-/g, "");

// Ordem da referência do ccgtrader: tipo (C, J, M, N), depois a série US,
// depois o número.
function refKey(code) {
  const m = String(code).toUpperCase().match(/^([A-Z])-?(US|C)?-?(\d+)/);
  return m ? `${m[1]}${m[2] || ""}-${m[3].padStart(5, "0")}` : `Z${code}`;
}

const norm = (s) => String(s || "").replace(/&#x27;|&#39;/g, "'").toLowerCase()
  .replace(/\bthe\b/g, "").replace(/[^a-z0-9]/g, "");

// Semelhança de nome: igual 3, um contém o outro 2, até 3 letras de
// diferença 1 (grafia: "Doppleganger", "Anko Mitarash"), senão -2.
export function semelhanca(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 3;
  if (a && b && (a.includes(b) || b.includes(a))) return 2;
  if (Math.abs(a.length - b.length) > 3) return -2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length] <= 3 ? 1 : -2;
}

// Alinhamento global (Needleman-Wunsch) de duas listas ordenadas por nome.
// Devolve [[i, j]] dos pares casados (i em `a`, j em `b`) com nome compatível.
export function alinha(a, b, nomeA = (x) => x.name, nomeB = (x) => x.name) {
  const GAP = -1;
  const S = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1));
  const T = Array.from({ length: a.length + 1 }, () => new Uint8Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) { S[i][0] = i * GAP; T[i][0] = 1; }
  for (let j = 1; j <= b.length; j++) { S[0][j] = j * GAP; T[0][j] = 2; }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const d = S[i - 1][j - 1] + semelhanca(nomeA(a[i - 1]), nomeB(b[j - 1]));
      const u = S[i - 1][j] + GAP;
      const l = S[i][j - 1] + GAP;
      if (d >= u && d >= l) { S[i][j] = d; T[i][j] = 0; } else if (u >= l) { S[i][j] = u; T[i][j] = 1; } else { S[i][j] = l; T[i][j] = 2; }
    }
  }
  const pares = [];
  for (let i = a.length, j = b.length; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && T[i][j] === 0) {
      if (semelhanca(nomeA(a[i - 1]), nomeB(b[j - 1])) > 0) pares.push([i - 1, j - 1]);
      i--; j--;
    } else if (i > 0 && (j === 0 || T[i][j] === 1)) i--;
    else j--;
  }
  return pares.reverse();
}

async function baixaFan() {
  const file = new URL(`naruto-ccg-nccgdb-${FAN_SHA.slice(0, 8)}.json`, CACHE_DIR);
  try { return JSON.parse(await readFile(file, "utf8")); } catch { /* sem cache */ }
  if (SEM_REDE) throw new Error("sem cache do N-CCG-DB; rode sem --sem-rede uma vez");
  const r = await fetch(FAN_URL, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`N-CCG-DB: HTTP ${r.status}`);
  const text = await r.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, text, "utf8");
  return JSON.parse(text);
}

async function scanExiste(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://${FAN_IMG}${path}`, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch { /* retry */ }
    await sleep(800 * (i + 1));
  }
  return false;
}

async function run() {
  const fan = await baixaFan();
  const snap = JSON.parse(await readFile(SNAP, "utf8"));
  const ccgt = JSON.parse(await readFile(CCGT, "utf8"));
  const doSnap = new Map(snap.sets.map((s) => [s.key, s.cards]));
  const todosCodigos = new Set(snap.sets.flatMap((s) => s.cards.map((c) => codigoCanonico(c.code))));

  const sets = [];
  const pendentes = [];
  const relatorio = [];
  for (const [key, fanSet] of Object.entries(FAN_SET)) {
    const lista = ccgt.sets[key].cartas.map((l) => { const i = l.indexOf("|"); return { sigla: l.slice(0, i), name: l.slice(i + 1) }; });
    const daFan = (fan[fanSet] || [])
      .map((c) => ({ code: String(c["Collector Number"]).toUpperCase().replace(/^MUS-/, "M-US"), name: c["Printed Name"], img: c.image_path }))
      .sort((a, b) => refKey(a.code).localeCompare(refKey(b.code)));
    const pares = alinha(daFan, lista);
    const nossas = doSnap.get(key) || [];
    const nossoPorCodigo = new Map(nossas.map((c) => [codigoCanonico(c.code), c]));

    // Carta nossa com nome que não bate com o da mesma posição no N-CCG-DB =
    // número errado no narutocards; o nome dela não pode entrar de novo.
    const nomesTrocados = new Set();
    for (const f of daFan) {
      const n = nossoPorCodigo.get(codigoCanonico(f.code));
      if (n && semelhanca(n.name, f.name) < 0) nomesTrocados.add(norm(n.name));
    }

    const cards = [];
    const starter = [];
    for (const [i, j] of pares) {
      const f = daFan[i];
      const canon = codigoCanonico(f.code);
      // Carta que já temos e o ccgtrader diz Starter Deck: o narutocards não
      // separa o starter (vem como U ou C), e aí ela ganharia foil paralelo
      // de booster, que não existe.
      const nossa = nossoPorCodigo.get(canon);
      if (nossa && lista[j].sigla === "ST" && nossa.rarity !== "F") starter.push(nossa.code);
      if (todosCodigos.has(canon)) continue;
      const rarity = RARIDADE_CCGT[lista[j].sigla];
      if (!rarity) throw new Error(`${key} ${f.code}: sigla do ccgtrader desconhecida "${lista[j].sigla}"`);
      // Nome da fonte com cara de arquivo ("n121e") cai pro do ccgtrader.
      const name = /^[a-z]{1,3}\d+[a-z]?$/i.test(f.name || "") ? lista[j].name : f.name;
      if (nomesTrocados.has(norm(name))) {
        pendentes.push({ key, code: f.code, name, motivo: "o nome já está no set sob outro código (número errado no narutocards)" });
        continue;
      }
      cards.push({ code: f.code, name, rarity, img: f.img || "" });
      todosCodigos.add(canon); // a mesma carta não entra por dois sets
    }

    // Trava: nenhum nome pode aparecer no set mais vezes do que no ccgtrader.
    // A grafia que conta é a do ccgtrader quando a carta casou com uma de lá
    // ("Ninja Info Cards" × "Ninja Info Card").
    const ccgtDoCodigo = new Map(pares.map(([i, j]) => [codigoCanonico(daFan[i].code), lista[j].name]));
    const chave = (c) => norm(ccgtDoCodigo.get(codigoCanonico(c.code)) || c.name);
    const conta = (arr, f) => arr.reduce((m, c) => m.set(f(c), (m.get(f(c)) || 0) + 1), new Map());
    const noCcgt = conta(lista, (c) => norm(c.name));
    const depois = conta([...nossas, ...cards], chave);
    for (const c of cards) {
      const n = chave(c);
      if (depois.get(n) > (noCcgt.get(n) || 0)) throw new Error(`${key} ${c.code}: "${c.name}" ficaria ${depois.get(n)}× (ccgtrader: ${noCcgt.get(n) || 0}×)`);
    }
    // Carta nossa que o ccgtrader não lista no set (o Tsunami, C-007, que o
    // narutocards e o N-CCG-DB põem no Revenge and Rebirth): fica, só avisa.
    const casadas = new Set(pares.map(([i]) => codigoCanonico(daFan[i].code)));
    const foraDoCcgt = nossas.filter((c) => !casadas.has(codigoCanonico(c.code))).map((c) => c.code);

    sets.push({ key, ccgtrader: lista.length, starter, cards });
    relatorio.push(`  ${key}: ${String(nossas.length).padStart(3)} + ${String(cards.length).padStart(2)} = ${String(nossas.length + cards.length).padStart(3)} de ${lista.length} (alinhadas ${pares.length}/${daFan.length}; ${starter.length} viram Starter Deck)`
      + (foraDoCcgt.length ? ` — nossas fora do ccgtrader: ${foraDoCcgt.join(", ")}` : ""));
  }

  if (!SEM_REDE) {
    let faltam = 0;
    for (const s of sets) {
      for (const c of s.cards) {
        if (c.img && !(await scanExiste(c.img))) { c.img = ""; faltam++; }
        await sleep(60);
      }
    }
    console.log(`  scans conferidos no GitHub Pages do N-CCG-DB (${faltam} sem arquivo).`);
  }

  const total = sets.reduce((n, s) => n + s.cards.length, 0);
  const out = {
    fontes: {
      cartas: `https://github.com/N-CCG-DB/naruto-ccg-deckbuilder/blob/${FAN_SHA}/narutoccgdatabase.json`,
      raridade: "https://www.ccgtrader.net/games/naruto-ccg (data/vintage/naruto-ccg-ccgtrader.json)",
      scans: `https://${FAN_IMG}`
    },
    updatedAt: new Date().toISOString().slice(0, 10),
    sets,
    pendentes
  };
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n", "utf8");
  console.log(relatorio.join("\n"));
  console.log(`Complemento: ${total} cartas em ${sets.length} sets; ${pendentes.length} pendente(s).`);
  for (const p of pendentes) console.log(`  pendente ${p.key} ${p.code} ${p.name}: ${p.motivo}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
