// Reparte a tabela de preços de cada jogo (pricing.generated.js, um MONÓLITO
// por jogo) em um arquivo POR SET, espelhando os chunks de carta. O monólito do
// Pokémon tem ~306 KB comprimidos — e era baixado inteiro por qualquer tela que
// desenhasse um valor, pra precificar as dezenas de cartas que a pessoa tem. O
// Portfólio, que carrega vários jogos, baixava VÁRIOS monólitos.
//
// Com os chunks de preço, quem busca as cartas de um set busca junto os preços
// DAQUELE set (ver fetchSetChunks no shared.js) — o download acompanha o que a
// tela realmente mostra. O caminho: o chunk data/sets/en/sv03.5.json ganha o
// irmão data/pricing-chunks/en/sv03.5.json.
//
// Cada chunk de preço leva as entradas dos ids do set E dos ids BASE
// (basePricingId): a carta -pt não tem preço próprio e o cardValue cai na
// referência da carta EN — os dois têm de estar no arquivo do chunk pt. O
// manifest ganha a flag `pc: 1`, que é como o cliente sabe que pode pular o
// monólito. O monólito continua sendo escrito (fallback de quem estiver com o
// shared.js antigo em cache durante a troca).
//
// Roda em TODO deploy, como o enrich-manifest e pela MESMA razão: o build
// rápido restaura os artefatos do cache e pula os syncs — um passo que só
// existisse dentro do sync deixaria a produção sem os chunks de preço no
// caminho rápido (foi exatamente assim que a tela de Sets perdeu os logos).
// Idempotente: apaga e reescreve os diretórios pricing-chunks/ inteiros.
//
// Uso: node scripts/split-pricing.mjs
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { basePricingId } from "./lib/sync-common.mjs";

const RAIZ = new URL("../", import.meta.url);
const DIRS = [
  "data/", "data/lorcana/", "data/onepiece/", "data/magic/", "data/fab/",
  "data/gundam/", "data/dbfw/", "data/ygo/", "data/digimon/", "data/riftbound/",
  "data/naruto/", "data/hxh/", "data/jump/"
];

async function leGlobal(caminho, nomeDaVar) {
  const texto = await readFile(new URL(caminho, RAIZ), "utf8");
  const igual = texto.indexOf("=");
  if (igual < 0 || !texto.includes(nomeDaVar)) throw new Error(`${caminho} sem ${nomeDaVar}`);
  return JSON.parse(texto.slice(igual + 1).trim().replace(/;\s*$/, ""));
}

let jogos = 0;
for (const dir of DIRS) {
  let manifest, pricing;
  try { manifest = await leGlobal(`${dir}manifest.generated.js`, "TCG_MANIFEST"); } catch { continue; }
  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) continue;
  try { pricing = await leGlobal(`${dir}pricing.generated.js`, "TCG_PRICING") || {}; } catch { pricing = {}; }

  // Recomeça do zero: nada de chunk órfão de set que saiu do catálogo.
  const raizChunks = new Set();
  for (const entrada of manifest.sets) {
    if (entrada.file) raizChunks.add(entrada.file.replace(/\/sets\/.*$/, "/pricing-chunks/"));
  }
  for (const r of raizChunks) {
    await rm(new URL(r, RAIZ), { recursive: true, force: true });
  }

  let escritos = 0, entradasTotais = 0;
  for (const entrada of manifest.sets) {
    if (!entrada.file || !entrada.file.includes("/sets/")) continue;
    let cartas;
    try { cartas = JSON.parse(await readFile(new URL(entrada.file, RAIZ), "utf8")); } catch { continue; }
    const tabela = {};
    for (const carta of cartas) {
      const id = carta.id;
      if (pricing[id]) tabela[id] = pricing[id];
      const base = basePricingId(id);
      if (base !== id && pricing[base]) tabela[base] = pricing[base];
    }
    const destino = entrada.file.replace("/sets/", "/pricing-chunks/");
    await mkdir(new URL(destino.replace(/\/[^/]+$/, "/"), RAIZ), { recursive: true });
    await writeFile(new URL(destino, RAIZ), JSON.stringify(tabela), "utf8");
    escritos++;
    entradasTotais += Object.keys(tabela).length;
  }
  if (!escritos) continue;

  // A flag no manifest é o contrato com o cliente: pc presente = pode pular o
  // monólito e confiar que todo chunk de carta tem o irmão de preço.
  manifest.pc = 1;
  await writeFile(new URL(`${dir}manifest.generated.js`, RAIZ), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
  console.log(`split-pricing: ${dir} — ${escritos} chunks de preço (${entradasTotais} entradas; monólito com ${Object.keys(pricing).length})`);
  jogos++;
}
if (!jogos) {
  console.error("split-pricing: nenhum manifest encontrado — o build não produziu catálogo?");
  process.exit(1);
}
console.log(`split-pricing: ${jogos} jogo(s) prontos.`);
