// Espelha os LOGOS de set do Flesh and Blood localmente. O TCGCSV não tem logo
// de set; a fonte é o projeto aberto the-fab-cube (JSON oficial da LSS), que
// traz `set_logo` (PNG transparente no CloudFront da Legend Story Studios) por
// set. Baixa via wsrv.nl redimensionado pra webp (host já liberado na CSP/SW;
// o PNG original tem ~1MB, o webp fica ~40KB) pra data/fab/set-logos/<CODE>.webp.
//
// Só ~41 dos ~100 sets têm logo oficial (os principais jogáveis); o resto segue
// no fallback de arte da 1ª carta (definido no sync-fab). O sync-fab lê esta
// pasta e prefere o logo local quando existe.
//
// Idempotente (skip-if-exists). Rodar LOCAL e COMMITAR os arquivos novos.
//   node scripts/mirror-fab-set-logos.mjs [--force]
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchRetry, mapLimit, sleep, winSafeName } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/fab/set-logos/", ROOT);
const SET_JSON = "https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/set.json";
const FORCE = process.argv.includes("--force");

// wsrv.nl: redimensiona o PNG grande do CloudFront pra um webp pequeno.
const resized = (url) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=600&output=webp&we`;

async function run() {
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
      const r = await fetchRetry(resized(url), { timeoutMs: 25000 });
      const buf = Buffer.from(await r.arrayBuffer());
      // Guarda contra página de erro: webp de verdade começa com RIFF….WEBP.
      if (buf.length < 200 || buf.slice(0, 4).toString("ascii") !== "RIFF" || buf.slice(8, 12).toString("ascii") !== "WEBP") { fail++; return; }
      await writeFile(dest, buf);
      await sleep(80);
      ok++;
    } catch { fail++; }
  });
  console.log(`  baixados: ${ok} · já existiam: ${skip} · falharam: ${fail}`);
  console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos.`);
}

await run();
