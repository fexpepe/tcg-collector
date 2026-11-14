// Espelha os LOGOS de set do Flesh and Blood localmente. O TCGCSV não tem logo
// de set; a fonte é o projeto aberto the-fab-cube (JSON oficial da LSS), que
// traz `set_logo` (PNG transparente no CloudFront da Legend Story Studios) por
// set. Baixa o PNG original e grava no padrão dos logos (docs/LOGOS.md):
// data/fab/set-logos/<CODE>.webp recortado, sem véu, no teto de 960×320.
// Até 2026-11-14 ia pelo wsrv.nl a 600 px de largura, sem recorte: macio na
// vitrine do topo e com margem e véu em vários.
//
// Em 2026-11-14 o host do CloudFront do `set_logo` não resolvia mais (sem
// registro DNS; o wsrv devolve 404 pra ele): set novo não baixa até o
// the-fab-cube trocar o endereço. Os 53 arquivos de hoje foram regravados no
// padrão a partir deles mesmos.
//
// Só ~41 dos ~100 sets têm logo oficial (os principais jogáveis); o resto segue
// com o nome do set no lugar do logo. O sync-fab lê esta pasta e prefere o
// logo local quando existe.
//
// Idempotente (skip-if-exists). Precisa do sharp (SHARP_DIR); sem ele não grava
// nada. Rodar LOCAL e COMMITAR os arquivos novos.
//   SHARP_DIR=<…>/node_modules/sharp node scripts/mirror-fab-set-logos.mjs [--force]
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchRetry, mapLimit, sleep, winSafeName } from "./lib/sync-common.mjs";
import { sharpDoAmbiente, logoNoPadrao } from "./lib/logo-espelho.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/fab/set-logos/", ROOT);
const SET_JSON = "https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/set.json";
const FORCE = process.argv.includes("--force");

async function run() {
  if (!(await sharpDoAmbiente())) {
    console.log("FAB: sem SHARP_DIR — logo novo não entra fora do padrão (docs/LOGOS.md); nada a espelhar.");
    return;
  }
  console.log("FAB: buscando logos de set (the-fab-cube)…");
  let sets;
  try {
    sets = await (await fetchRetry(SET_JSON, { headers: { "User-Agent": "Sleevu (sleevu.app)" } })).json();
  } catch (e) {
    console.warn(`  set.json inacessível (${e.message}) — nada a espelhar.`);
    return;
  }
  // code (maiúsculo, = setId do catálogo) -> URL do logo oficial.
  const byCode = new Map();
  for (const s of sets) {
    const p = (s.printings || []).find((x) => x.set_logo);
    if (p && s.id) byCode.set(String(s.id).toUpperCase(), p.set_logo);
  }
  console.log(`  ${byCode.size} sets com logo oficial.`);

  await mkdir(OUT, { recursive: true });
  let ok = 0, skip = 0, fail = 0;
  await mapLimit([...byCode.entries()], 5, async ([code, url]) => {
    const dest = new URL(`${winSafeName(code)}.webp`, OUT);
    if (!FORCE && existsSync(dest)) { skip++; return; }
    try {
      const r = await fetchRetry(url, { timeoutMs: 30000 });
      const buf = Buffer.from(await r.arrayBuffer());
      // Guarda contra página de erro: o logo oficial é PNG de verdade.
      if (buf.length < 200 || buf.slice(1, 4).toString("ascii") !== "PNG") { fail++; return; }
      await writeFile(dest, await logoNoPadrao(buf, "set"));
      await sleep(80);
      ok++;
    } catch { fail++; }
  });
  console.log(`  baixados: ${ok} · já existiam: ${skip} · falharam: ${fail}`);
  console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos.`);
}

await run();
