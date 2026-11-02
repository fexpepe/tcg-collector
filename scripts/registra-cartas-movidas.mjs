// Registra as cartas que mudaram de SET (mesmo id, outra página) entre o
// catálogo publicado e o recém-gerado, pro endereço antigo levar 301 pro de
// hoje. O porquê e o formato estão em scripts/lib/cartas-movidas.mjs.
//
//   node scripts/registra-cartas-movidas.mjs                # disco × HEAD
//   node scripts/registra-cartas-movidas.mjs --antes origin/main   # disco × outra ref
//
// Roda no deploy logo depois do lint-catalog (mesma comparação: o HEAD ainda é
// o catálogo no ar), e o data/cartas-movidas.json vai no commit do snapshot.
// Na PR que move carta de set à mão (a #224 do Data Carddass), rodar antes de
// commitar o catálogo — depois do commit, com --antes origin/main.
//
// Lê o catálogo do mesmo lugar que o prerender: os chunks no Pokémon, o
// cards.js nos outros. Magic e Yu-Gi-Oh! não versionam o cards.js (só os
// chunks), então ali os dois lados saem dos chunks.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JOGOS_URL } from "../functions/_lib/jogos.js";
import { cartasQueMudaramDeSet, juntaNoRegistro } from "./lib/cartas-movidas.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGISTRO = "data/cartas-movidas.json";
const i = process.argv.indexOf("--antes");
const REF = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "HEAD";

const git = (args, stdio) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio });
// Arquivo que não existe na ref (catálogo novo) é o esperado: sem o "fatal" no log.
const naRef = (f) => { try { return git(["show", `${REF}:${f}`], ["ignore", "pipe", "ignore"]); } catch { return null; } };
const noDisco = (f) => { try { return readFileSync(ROOT + f, "utf8"); } catch { return null; } };
const cartasDoJs = (texto) => {
  const g = { window: {} };
  new Function("window", texto)(g.window);
  return Array.isArray(g.window.TCG_CARDS) ? g.window.TCG_CARDS : [];
};
const cartasDoJson = (texto) => { const a = JSON.parse(texto); return Array.isArray(a) ? a : []; };

// Os chunks de uma pasta, na ordem do disco (a do prerender), mais os que só
// existem na ref (apagados), no fim.
function chunks(dir, mudados) {
  const arquivos = [];
  const anda = (rel) => {
    let nomes;
    try { nomes = readdirSync(ROOT + rel, { withFileTypes: true }); } catch { return; }
    for (const e of nomes) {
      if (e.isDirectory()) anda(`${rel}/${e.name}`);
      else if (e.name.endsWith(".json")) arquivos.push(`${rel}/${e.name}`);
    }
  };
  anda(dir);
  const noDiscoSet = new Set(arquivos);
  const depois = [], antes = [];
  for (const f of arquivos) {
    const atual = noDisco(f);
    if (atual) depois.push(...cartasDoJson(atual));
    const velho = mudados.has(f) ? naRef(f) : atual;
    if (velho) antes.push(...cartasDoJson(velho));
  }
  for (const f of mudados) {
    if (!f.startsWith(`${dir}/`) || noDiscoSet.has(f) || !f.endsWith(".json")) continue;
    const velho = naRef(f);
    if (velho) antes.push(...cartasDoJson(velho));
  }
  return { antes, depois };
}

function catalogos(game, mudados) {
  if (game === "pokemon") return chunks("data/sets", mudados);
  const js = `data/${game}/cards.js`;
  const velho = naRef(js);
  if (velho != null) {
    const atual = noDisco(js);
    return { antes: cartasDoJs(velho), depois: atual ? cartasDoJs(atual) : [] };
  }
  return chunks(`data/${game}/sets`, mudados);
}

let mudados;
try { mudados = git(["diff", "--name-only", REF, "--", "data"]).split("\n").map((s) => s.trim()).filter(Boolean); }
catch (e) {
  console.log(`registra-cartas-movidas: sem git (ou sem ${REF}) — nada a registrar.`);
  process.exit(0);
}
// Os mesmos arquivos de catálogo do lint-catalog: chunk de set ou cards.js.
const ehCatalogo = (f) => /^data\/(sets\/[^/]+\/[^/]+\.json|[a-z0-9]+\/sets\/[^/]+\.json|[a-z0-9]+\/cards\.js)$/.test(f);
const jogoDe = (f) => (f.startsWith("data/sets/") ? "pokemon" : f.split("/")[1]);
const alvos = new Set(mudados.filter(ehCatalogo));
const jogos = [...new Set([...alvos].map(jogoDe))].filter((g) => JOGOS_URL.some((j) => j.game === g));

let novas = {};
for (const game of jogos) {
  const { antes, depois } = catalogos(game, alvos);
  if (!antes.length || !depois.length) continue;
  const movidas = cartasQueMudaramDeSet(game, antes, depois);
  const n = Object.keys(movidas).length;
  if (n) {
    const exemplo = Object.keys(movidas)[0];
    console.log(`registra-cartas-movidas: ${game} — ${n} carta(s) mudaram de set (ex.: /games/${exemplo})`);
  }
  novas = { ...novas, ...movidas };
}

if (!Object.keys(novas).length) {
  console.log(`registra-cartas-movidas: nenhuma carta mudou de set (${jogos.length} jogo(s) com catálogo mudado × ${REF}).`);
  process.exit(0);
}
let registro = {};
if (existsSync(ROOT + REGISTRO)) registro = JSON.parse(readFileSync(ROOT + REGISTRO, "utf8"));
const final = juntaNoRegistro(registro, novas);
writeFileSync(ROOT + REGISTRO, JSON.stringify(final, null, 1) + "\n", "utf8");
console.log(`registra-cartas-movidas: ${REGISTRO} com ${Object.keys(final).length} endereço(s) (${Object.keys(novas).length} de agora).`);
