// Naruto CCG americano: as PROMOS que o narutocards.ca não tem (2026-11-13).
//
// O set de promos do narutocards (fonte do sync-naruto-ccg.mjs) tem 14 cartas,
// quase só missão: PR-010–013, 016–018, 021–026 e PR-US006. A série PR
// impressa vai até a PR-100, mais as PR-US, e as promos de ninja ficaram todas
// de fora. O N-CCG-DB (o mesmo arquivo e o mesmo commit do complemento, ver
// scripts/naruto-ccg-complemento.mjs) tem o grupo "Promo Cards", com 178
// linhas e scan 750×1050 de cada uma. Este script tira dali as cartas cujo
// número impresso o catálogo não tem em set nenhum.
//
// O QUE ENTRA: 98 cartas. PR-001–100 (as que faltavam), PR-US001–015, as
// reimpressões PR-005R–008R, EX-001/002, PS-001–004 e as três missões 作 621–
// 623. O número foi LIDO NO SCAN de cada uma (canto de baixo, à esquerda), e é
// o que o N-CCG-DB escreve, com uma exceção:
//   - PR-018B, PR-024B, PR-025B e PR-026B: o "B" é do N-CCG-DB, a carta diz
//     "PR 018". A Bandai repetiu o número em duas cartas diferentes (PR-018 é
//     a missão "Naruto vs Sasuke" e também o ninja "The First Hokage"). O
//     número do catálogo fica o impresso, e o código com B só dá o id.
//
// O QUE FICA DE FORA, e por quê:
//   - as 79 linhas cujo número o catálogo já tem. São a mesma carta (as 14 do
//     set de promo, as PR-063–082 das tins, a PR-US010 do Tournament Pack 4) ou
//     uma versão de arte alternativa de carta de set (N-086, N-US004…), que o
//     N-CCG-DB guarda nesse grupo com o número original;
//   - a segunda linha da PR-048 ("pr048_original"): mesma carta, mesmo arquivo.
//
// DUPLICATA: antes de importar, as 98 foram comparadas por IMAGEM (dHash da
// carta inteira e só da arte) com as 292 cartas de promo, tins e Tournament
// Packs do catálogo, que é onde a numeração do narutocards não é a impressa e
// uma carta poderia estar escondida sob outro número. Nenhum par chegou perto:
// a menor distância foi 51 de 256, e a mesma carta em dois arquivos (TP1 × TP2)
// dá de 0 a 27. O nome não serve de prova: são dezenas de "Naruto Uzumaki".
//
// ID: nrt-ccg-<código em minúscula>, como no resto da linha (nrt-ccg-pr-001,
// nrt-ccg-pr-us001, nrt-ccg-pr-018b). As 作 621–623 colidem com id publicado
// de outra carta (o narutocards chamou de M-621 a "Shout of Victory", que é a
// M-657 impressa), então ganham `-promo-`, a regra do complemento:
// nrt-ccg-promo-m-621. O id vai GRAVADO no snapshot.
//
// RARIDADE: "Promo", a do resto do set. As 作 621–623 têm numeração de carta
// de set e o nome da primeira ("Fierce Ambition") é o da tin Fierce
// Ambitions; ficam no set de promos, que é onde a fonte as põe, até aparecer
// prova do produto em que saíram.
//
// Roda à mão (padrão dos snapshots manuais); o sync só lê o resultado.
//   node scripts/naruto-ccg-promos.mjs            # baixa o N-CCG-DB (cache) e confere os scans
//   node scripts/naruto-ccg-promos.mjs --sem-rede # usa o cache, sem conferir scans
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sync-common.mjs";
import { baixaFan, codigoCanonico, FAN_SHA, FAN_IMG } from "./naruto-ccg-complemento.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/naruto-ccg.json", ROOT);
const COMPLEMENTO = new URL("data/vintage/naruto-ccg-complemento.json", ROOT);
const IMPRESSO = new URL("data/vintage/naruto-ccg-numero-impresso.json", ROOT);
const OUT = new URL("data/vintage/naruto-ccg-promos.json", ROOT);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const SEM_REDE = process.argv.includes("--sem-rede");

export const GRUPO = "Promo Cards";

// Código do N-CCG-DB → número impresso, onde os dois diferem (lido no scan).
export const NUMERO_IMPRESSO = {
  "PR-018B": "PR-018", "PR-024B": "PR-024", "PR-025B": "PR-025", "PR-026B": "PR-026"
};

// As promos novas, sem disco. `noCatalogo` = números impressos (canônicos) que
// o catálogo já tem, em qualquer set; `idsPublicados` = ids que já existem.
// Devolve as cartas e o que ficou de fora, com o motivo.
export function promosNovas(grupo, noCatalogo, idsPublicados) {
  const cards = [];
  const fora = { jaNoCatalogo: [], repetida: [] };
  const vistos = new Set();
  for (const linha of grupo || []) {
    const code = String(linha["Collector Number"] || "").toUpperCase();
    const canon = codigoCanonico(code);
    if (!canon) continue;
    if (noCatalogo.has(canon)) { fora.jaNoCatalogo.push(code); continue; }
    if (vistos.has(canon)) { fora.repetida.push(code); continue; }
    vistos.add(canon);
    const numero = NUMERO_IMPRESSO[code];
    const idObvio = `nrt-ccg-${code.toLowerCase()}`;
    cards.push({
      code,
      ...(numero ? { numero } : {}),
      name: linha["Printed Name"] || linha["Display Name"] || "",
      rarity: "Promo",
      img: linha.image_path || "",
      // Id que outra carta já publicou: ganha `-promo-`.
      ...(idsPublicados.has(idObvio) ? { id: `nrt-ccg-promo-${code.toLowerCase()}` } : {})
    });
  }
  // Na ordem da série: PR, PR-US, EX, PS e o resto, cada uma pelo número (o
  // N-CCG-DB lista por tipo de carta, ninja antes de missão).
  cards.sort((a, b) => chaveDeOrdem(a.code).localeCompare(chaveDeOrdem(b.code)));
  return { cards, fora };
}

const SERIES = ["PR", "PR-US", "EX", "PS"];
function chaveDeOrdem(code) {
  const m = code.match(/^(.*?)-?(\d+)([A-Z]*)$/) || [null, code, "0", ""];
  const serie = SERIES.indexOf(m[1]);
  return `${serie < 0 ? SERIES.length : serie}${m[1]}-${m[2].padStart(5, "0")}${m[3]}`;
}

async function scanExiste(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://${FAN_IMG}${path}`, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch { /* tenta de novo */ }
    await sleep(800 * (i + 1));
  }
  return false;
}

async function run() {
  const fan = await baixaFan();
  const snap = JSON.parse(await readFile(SNAP, "utf8"));
  const comp = JSON.parse(await readFile(COMPLEMENTO, "utf8"));
  const impresso = JSON.parse(await readFile(IMPRESSO, "utf8"));
  // Tudo que o catálogo tem, pelo número IMPRESSO (o de-para corrige o do
  // narutocards do set 17 em diante, nos Tournament Packs e nas tins).
  const numeroDe = (key, c) => ((impresso.sets[key] || {})[c.code] || {}).numero || c.code;
  const noCatalogo = new Set([
    ...snap.sets.flatMap((s) => s.cards.map((c) => codigoCanonico(numeroDe(s.key, c)))),
    ...comp.sets.flatMap((s) => s.cards.map((c) => codigoCanonico(c.code)))
  ]);
  const idsPublicados = new Set([
    ...snap.sets.flatMap((s) => s.cards.map((c) => `nrt-ccg-${c.code.toLowerCase()}`)),
    ...comp.sets.flatMap((s) => s.cards.map((c) => c.id || `nrt-ccg-${c.code.toLowerCase()}`))
  ]);
  const { cards, fora } = promosNovas(fan[GRUPO], noCatalogo, idsPublicados);

  if (!SEM_REDE) {
    let faltam = 0;
    for (const c of cards) {
      if (c.img && !(await scanExiste(c.img))) { c.img = ""; faltam++; }
      await sleep(60);
    }
    console.log(`  scans conferidos no GitHub Pages do N-CCG-DB (${faltam} sem arquivo).`);
  }

  const out = {
    fontes: {
      cartas: `https://github.com/N-CCG-DB/naruto-ccg-deckbuilder/blob/${FAN_SHA}/narutoccgdatabase.json (grupo "${GRUPO}")`,
      scans: `https://${FAN_IMG}`
    },
    updatedAt: new Date().toISOString().slice(0, 10),
    nota: "Promos do Naruto CCG cujo número impresso o catálogo não tinha. `code` é o do N-CCG-DB (de onde sai o id); `numero` só aparece quando o impresso é outro (o B de PR-018B não está na carta). Gerado por scripts/naruto-ccg-promos.mjs; o sync anexa ao set de promos.",
    cards
  };
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n", "utf8");
  console.log(`Promos: ${cards.length} cartas novas de ${(fan[GRUPO] || []).length} linhas do grupo "${GRUPO}".`);
  console.log(`  já no catálogo pelo número: ${fora.jaNoCatalogo.length}; linha repetida: ${fora.repetida.join(", ") || "nenhuma"}.`);
  console.log(`  com id próprio (colisão): ${cards.filter((c) => c.id).map((c) => `${c.code} → ${c.id}`).join(", ") || "nenhuma"}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
