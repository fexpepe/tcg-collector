// Garante que TODA entrada de manifest carregue os metadados do set (logo,
// símbolo, data, série, total oficial) e a soma de preço por moeda — que é o que
// a LISTA de sets desenha sem baixar carta nenhuma (ver setManifestMeta).
//
// Por que isto existe como passo PRÓPRIO, e não só dentro do sync:
//
//   1. BUILD RÁPIDO. O deploy restaura data/*.generated.js do cache do build
//      anterior e pula os syncs quando não há o que sincronizar. Nesse caminho o
//      manifest NUNCA é regerado — então, na primeira vez que o formato dele
//      mudou, a produção ficou com o manifest velho e a tela de Sets apareceu
//      sem logo, sem data e sem valor, com o nome do set em texto no lugar da
//      arte. Rodando sempre, o formato do manifest deixa de depender do modo do
//      build.
//   2. ORDEM DO ESPELHO DE LOGO. O mirror-set-logos (Pokémon) e o
//      mirror-magic-set-logos rodam DEPOIS do sync e reescrevem os CHUNKS pro
//      caminho local do logo — mas não o manifest. Rodando depois deles, o
//      manifest pega o espelho local, que é o que sobrevive a um fora-do-ar da
//      TCGdex.
//
// É idempotente: lê os chunks, recalcula e reescreve. Rodar duas vezes dá o
// mesmo arquivo.
//
// Uso: node scripts/enrich-manifest.mjs
import { readFile, writeFile } from "node:fs/promises";
import { setManifestMeta } from "./lib/sync-common.mjs";

const RAIZ = new URL("../", import.meta.url);

// dataDir de cada jogo, como no registro do src/game.js. O Pokémon é a raiz.
const DIRS = [
  "data/", "data/lorcana/", "data/onepiece/", "data/magic/", "data/fab/",
  "data/gundam/", "data/dbfw/", "data/ygo/", "data/digimon/", "data/riftbound/",
  "data/naruto/", "data/hxh/", "data/jump/"
];

async function leGlobal(caminho, nomeDaVar) {
  const texto = await readFile(new URL(caminho, RAIZ), "utf8");
  const igual = texto.indexOf("=");
  if (igual < 0) throw new Error(`sem atribuição em ${caminho}`);
  const corpo = texto.slice(igual + 1).trim().replace(/;\s*$/, "");
  const valor = JSON.parse(corpo);
  if (!nomeDaVar || texto.includes(nomeDaVar)) return valor;
  throw new Error(`${caminho} não declara ${nomeDaVar}`);
}

let jogosOk = 0;
const avisos = [];

for (const dir of DIRS) {
  let manifest;
  try {
    manifest = await leGlobal(`${dir}manifest.generated.js`, "TCG_MANIFEST");
  } catch {
    continue; // jogo sem manifest neste build (catálogo vazio ou não sincronizado)
  }
  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) continue;

  let pricing = {};
  try { pricing = await leGlobal(`${dir}pricing.generated.js`, "TCG_PRICING") || {}; } catch { /* sem preço: só metadados */ }

  let enriquecidas = 0;
  const semChunk = [];
  for (const entrada of manifest.sets) {
    if (!entrada.file) { semChunk.push(entrada.id); continue; }
    let cartas;
    try {
      cartas = JSON.parse(await readFile(new URL(entrada.file, RAIZ), "utf8"));
    } catch {
      semChunk.push(entrada.id);
      continue;
    }
    if (!Array.isArray(cartas) || !cartas.length) { semChunk.push(entrada.id); continue; }
    Object.assign(entrada, setManifestMeta(cartas, pricing));
    enriquecidas++;
  }

  // Nenhuma entrada enriquecida = os chunks não estão no disco. Seguir daria um
  // manifest sem metadado — exatamente o estado que este script existe pra
  // impedir —, então é erro, não aviso.
  if (!enriquecidas) {
    console.error(`enrich-manifest: ${dir} tem ${manifest.sets.length} sets no manifest e NENHUM chunk legível.`);
    process.exit(1);
  }
  if (semChunk.length) avisos.push(`${dir}: ${semChunk.length} set(s) sem chunk legível (${semChunk.slice(0, 3).join(", ")}…)`);

  await writeFile(new URL(`${dir}manifest.generated.js`, RAIZ), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
  console.log(`enrich-manifest: ${dir} — ${enriquecidas}/${manifest.sets.length} entradas com metadado`);
  jogosOk++;
}

avisos.forEach((a) => console.warn(`  aviso: ${a}`));
if (!jogosOk) {
  console.error("enrich-manifest: nenhum manifest encontrado — o build não produziu catálogo?");
  process.exit(1);
}
console.log(`enrich-manifest: ${jogosOk} jogo(s) prontos.`);
