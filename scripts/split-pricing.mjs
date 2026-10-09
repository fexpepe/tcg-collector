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
// Desde 2026-10-08 escreve também os FRAGMENTOS do histórico de preço
// (history-shards/<k>.json + a flag `hs` no manifest): o popup de uma carta
// baixava o price-history do jogo inteiro (1,5 MB brotli no Pokémon). Aqui e
// não no sync-price-history pela mesma razão dos chunks de preço — o build
// rápido pula os syncs e restaura o histórico do cache. O desenho e o porquê
// de não ser um arquivo por set estão em scripts/lib/history-shards.mjs.
//
// Uso: node scripts/split-pricing.mjs
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { basePricingId } from "./lib/sync-common.mjs";
import { montaFragmentos } from "./lib/history-shards.mjs";

const RAIZ = new URL("../", import.meta.url);
const DIRS = [
  "data/", "data/lorcana/", "data/onepiece/", "data/magic/", "data/fab/",
  "data/gundam/", "data/swu/", "data/cyberpunk/", "data/sorcery/", "data/dbfw/", "data/ygo/", "data/digimon/", "data/riftbound/",
  "data/unionarena/", "data/naruto/", "data/hxh/", "data/dbc/", "data/wow/", "data/lotr/", "data/harrypotter/", "data/weiss/", "data/mbc/", "data/jump/"
];

async function leGlobal(caminho, nomeDaVar) {
  const texto = await readFile(new URL(caminho, RAIZ), "utf8");
  const igual = texto.indexOf("=");
  if (igual < 0 || !texto.includes(nomeDaVar)) throw new Error(`${caminho} sem ${nomeDaVar}`);
  return JSON.parse(texto.slice(igual + 1).trim().replace(/;\s*$/, ""));
}
async function leJson(caminho) {
  try { return JSON.parse(await readFile(new URL(caminho, RAIZ), "utf8")); } catch { return null; }
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
  const idsPorSet = new Map(); // setId -> ids das cartas (pros fragmentos do histórico)
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
      // O setId DA CARTA, que é o que o cliente tem na mão ao abrir o popup.
      const setId = carta.setId || entrada.id;
      if (!idsPorSet.has(setId)) idsPorSet.set(setId, new Set());
      idsPorSet.get(setId).add(id);
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

  // Fragmentos do histórico (ver o cabeçalho). Sem price-history (dev, jogo
  // sem preço) a flag `hs` sai e o cliente fica nos arquivos inteiros.
  await rm(new URL(`${dir}history-shards/`, RAIZ), { recursive: true, force: true });
  const montados = montaFragmentos({
    hist: await leJson(`${dir}price-history.generated.json`),
    deltas: await leJson(`${dir}price-deltas.generated.json`),
    graded: await leJson(`${dir}graded-history.generated.json`),
    idsPorSet,
    basePricingId
  });
  let resumoHist = "sem histórico";
  if (montados) {
    await mkdir(new URL(`${dir}history-shards/`, RAIZ), { recursive: true });
    let bytes = 0;
    for (let k = 0; k < montados.n; k++) {
      const texto = JSON.stringify(montados.fragmentos[k]);
      bytes = Math.max(bytes, texto.length);
      await writeFile(new URL(`${dir}history-shards/${k}.json`, RAIZ), texto, "utf8");
    }
    manifest.hs = montados.n;
    resumoHist = `${montados.n} fragmento(s) de histórico, o maior com ${Math.round(bytes / 1024)} KB`;
  } else {
    delete manifest.hs;
  }
  await writeFile(new URL(`${dir}manifest.generated.js`, RAIZ), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
  console.log(`split-pricing: ${dir} — ${escritos} chunks de preço (${entradasTotais} entradas; monólito com ${Object.keys(pricing).length}); ${resumoHist}`);
  jogos++;
}
if (!jogos) {
  console.error("split-pricing: nenhum manifest encontrado — o build não produziu catálogo?");
  process.exit(1);
}
console.log(`split-pricing: ${jogos} jogo(s) prontos.`);
