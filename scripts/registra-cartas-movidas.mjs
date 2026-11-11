// Registra as cartas que mudaram de SET (mesmo id, outra página) entre o
// catálogo publicado e o recém-gerado, pro endereço antigo levar 301 pro de
// hoje — e, desde 2026-11-04, as que mudaram de endereço DENTRO do set quando
// o cartaParecida da borda levaria o antigo pra outra carta. O porquê e o
// formato estão em scripts/lib/cartas-movidas.mjs (enderecosARegistrar).
//
// E, desde 2026-11-10, os SETS que mudaram de endereço (o nome mudou na
// fonte): data/sets-renomeados-auto.json, o registro automático do
// scripts/lib/sets-renomeados.mjs. Sai da mesma comparação, no mesmo passo.
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
import { enderecosARegistrar, juntaNoRegistro } from "./lib/cartas-movidas.mjs";
import { resolveMergedId } from "./lib/set-supersede.mjs";
import { textoDoRegistroDeSets } from "./lib/sets-renomeados.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGISTRO = "data/cartas-movidas.json";
const REGISTRO_DE_SETS = "data/sets-renomeados-auto.json";
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

// Carta de set importado que a fonte publicou com outro id: o de-para do
// disco (o retire-imported-sets roda antes, no mesmo build).
let merges = {};
try { merges = JSON.parse(readFileSync(ROOT + "data/card-id-merges.json", "utf8")); } catch { /* sem de-para: nenhuma aposentadoria */ }
const idDeHoje = (id) => resolveMergedId(id, merges);

let novas = {};
let setsNovos = {};
for (const game of jogos) {
  const { antes, depois } = catalogos(game, alvos);
  if (!antes.length || !depois.length) continue;
  const { movidas, erradas, sets } = enderecosARegistrar(game, antes, depois, idDeHoje);
  const s = Object.keys(sets).length;
  if (s) console.log(`registra-cartas-movidas: ${game} — ${s} set(s) mudaram de endereço (ex.: /games/${Object.keys(sets)[0]})`);
  setsNovos = { ...setsNovos, ...sets };
  const n = Object.keys(movidas).length;
  if (n) {
    const exemplo = Object.keys(movidas)[0];
    console.log(`registra-cartas-movidas: ${game} — ${n} carta(s) mudaram de set (ex.: /games/${exemplo})`);
  }
  // Mudou dentro do set e o cartaParecida da borda levaria pra outra carta
  // (ou pra nenhuma): ver enderecosARegistrar.
  const e = Object.keys(erradas).length;
  if (e) {
    const exemplo = Object.keys(erradas)[0];
    console.log(`registra-cartas-movidas: ${game} — ${e} endereço(s) que o cartaParecida levaria pra carta errada (ex.: /games/${exemplo})`);
  }
  novas = { ...novas, ...movidas, ...erradas };
}

if (!Object.keys(novas).length && !Object.keys(setsNovos).length) {
  console.log(`registra-cartas-movidas: nada a registrar (${jogos.length} jogo(s) com catálogo mudado × ${REF}).`);
  process.exit(0);
}
// Junta as entradas de agora no arquivo. O dos sets vai um por linha: o valor
// é uma lista curta de ids, e o JSON indentado abriria um id por linha.
function grava(arquivo, novos, texto) {
  if (!Object.keys(novos).length) return;
  let registro = {};
  if (existsSync(ROOT + arquivo)) registro = JSON.parse(readFileSync(ROOT + arquivo, "utf8"));
  const final = juntaNoRegistro(registro, novos);
  writeFileSync(ROOT + arquivo, texto(final), "utf8");
  console.log(`registra-cartas-movidas: ${arquivo} com ${Object.keys(final).length} endereço(s) (${Object.keys(novos).length} de agora).`);
}
grava(REGISTRO, novas, (r) => JSON.stringify(r, null, 1) + "\n");
grava(REGISTRO_DE_SETS, setsNovos, textoDoRegistroDeSets);
