// Backfill das FATIAS de índice (indexes-<chave>.js) a partir dos indexes.js /
// indexes.generated.js já versionados de cada jogo.
//
// Por que existe: as fatias passaram a ser o que as páginas carregam (ver
// writeSplitIndexes no lib/sync-common.mjs), mas os arquivos de catálogo são
// COMMITADOS no repo e nem todo deploy roda o sync de todos os 12 jogos. Sem
// este backfill, um jogo cujo sync não rodasse ficaria com 404 na fatia e a
// página abriria com índice vazio.
//
// Idempotente: rodar de novo só reescreve o mesmo conteúdo.
//
//   node scripts/split-indexes.mjs [--check]
//
// --check não escreve nada; sai com código 1 se alguma fatia estiver faltando
// ou desatualizada (é o que o CI roda).
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { writeSplitIndexes, INDEX_KEYS, indexSliceFile, indexSliceBody } from "./lib/sync-common.mjs";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });
const dataDir = new URL("../data/", import.meta.url);

// Lê `window.TCG_INDEXES = {...};` sem eval: corta o prefixo e o `;\n` final.
async function readIndexes(fileUrl) {
  const src = await readFile(fileUrl, "utf8");
  const eq = src.indexOf("=");
  if (eq < 0) throw new Error(`formato inesperado em ${fileUrl.pathname}`);
  return JSON.parse(src.slice(eq + 1).trim().replace(/;$/, ""));
}

// Diretórios de jogo = data/ + cada subdiretório que tenha um indexes.js.
async function gameDirs() {
  const out = [];
  for (const name of ["", ...(await readdir(dataDir))]) {
    const dir = name ? new URL(`${name}/`, dataDir) : dataDir;
    try {
      if (name && !(await stat(dir)).isDirectory()) continue;
      await stat(new URL("indexes.js", dir));
      out.push({ name: name || "pokemon", dir });
    } catch { /* sem indexes.js: não é diretório de jogo */ }
  }
  return out;
}

// ── Índice de NOMES da paleta de comandos (Ctrl+K) ──────────────────────────
// A paleta lista espécies, sets e artistas de TODOS os jogos. Ela fazia isso
// baixando o indexes.generated.js inteiro de cada um — 4,5 MB somados, o do
// Magic sozinho com 2,8 MB — e jogava fora tudo menos os nomes: o peso daqueles
// arquivos é o array `cardIds` de cada entrada, que a paleta nunca lê.
// Aqui sobram só os nomes. O arquivo resultante é ~2% do original, e o cliente
// passa a poder buscar os 13 jogos em paralelo (ver loadCmdkIndex).
async function writeCmdkNames(dir, gen) {
  const nomes = (lista) => {
    const vistos = new Set();
    for (const item of lista || []) {
      const n = item && item.name;
      if (n) vistos.add(n);
    }
    return [...vistos];
  };
  // Espécies: o índice da Pokédex quando existe; senão as chaves de
  // pokemonTotals (mesma escolha que o cliente fazia).
  const species = (gen.pokedex && gen.pokedex.length)
    ? nomes(gen.pokedex)
    : Object.keys(gen.pokemonTotals || {});
  const corpo = JSON.stringify({ species, sets: nomes(gen.sets), artists: nomes(gen.artists) });
  await writeFile(new URL("cmdk-names.generated.json", dir), corpo, "utf8");
  return corpo.length;
}

let missing = 0;
for (const { name, dir } of await gameDirs()) {
  // A fatia tem que espelhar o arquivo que a página usaria: em produção o
  // game.js lê os .generated, então é dele que a fatia .generated sai.
  const idx = await readIndexes(new URL("indexes.js", dir));
  let gen = idx;
  try { gen = await readIndexes(new URL("indexes.generated.js", dir)); } catch { /* usa o dev */ }

  if (values.check) {
    // Só a família VERSIONADA (indexes-X.js). Os .generated são artefato de
    // build — não existem num checkout limpo, e quem garante que estão lá é o
    // passo "Deriva fatias de índice que faltarem" do deploy.
    // Compara o ARQUIVO INTEIRO com o que indexSliceBody produziria — nada de
    // reparsear o JS (o `(window.X = ...)` tem um `=` antes do valor).
    for (const k of INDEX_KEYS) {
      const file = indexSliceFile(k, false);
      const want = indexSliceBody(k, idx[k]);
      let have = null;
      try { have = await readFile(new URL(file, dir), "utf8"); } catch { /* ausente */ }
      if (have !== want) { console.error(`FALTA/DESATUALIZADA: ${name}/${file}`); missing++; }
    }
    continue;
  }

  // dev e prod podem divergir (o .generated do Pokémon é o merge de idiomas):
  // cada família sai da SUA fonte.
  await writeSplitIndexes(dir, idx, { only: "dev" });
  await writeSplitIndexes(dir, gen, { only: "generated" });
  const cmdk = await writeCmdkNames(dir, gen);
  const sizes = INDEX_KEYS.map((k) => `${k}=${JSON.stringify(gen[k] ?? "").length >> 10}KB`).join(" ");
  console.log(`${name.padEnd(12)} ${sizes} cmdk=${cmdk >> 10}KB`);
}

if (values.check) {
  if (missing) { console.error(`\n${missing} fatia(s) fora de sincronia. Rode: node scripts/split-indexes.mjs`); process.exit(1); }
  console.log("Fatias de índice em dia.");
}
