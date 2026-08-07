// Lint dos catálogos gerados — roda no deploy DEPOIS dos syncs, pra corrupção
// não ir pro ar em silêncio (os syncs têm "|| echo" de resiliência; o lint é o
// contrapeso que FALHA alto em erro duro).
//
//   node scripts/lint-catalog.mjs                # todos os jogos
//   node scripts/lint-catalog.mjs --update-baseline  # regrava a régua (rodar local e commitar)
//   node scripts/lint-catalog.mjs --aceitar-mudanca-de-id   # libera id que sumiu/repontou
//
// Erro DURO (exit 1): ids duplicados, carta sem id/nome/set, catálogo zerado
//   quando a régua diz que havia cartas, e — a trava que importa pras CONTAS —
//   id publicado que SUMIU ou passou a apontar pra outra carta.
// AVISO (exit 0): contagem caiu vs a régua (data/catalog-baseline.json), % de
//   imagem baixou muito — pode ser legítimo (fonte removeu), então não bloqueia,
//   mas fica gritante no log do deploy.
//
// POR QUE A ESTABILIDADE DE ID É ERRO DURO: coleção, wishlist, decks, binders,
// vendas e custos são todos indexados por cardId — no localStorage de cada
// pessoa e no blob da nuvem. O catálogo é a ÚNICA ponte entre esse id e uma
// carta de verdade. Então um id que some faz a carta desaparecer da conta (e
// voltar como "nova" quando a pessoa readiciona = duplicada), e um id que passa
// a apontar pra outra carta troca a carta da pessoa em silêncio — inclusive por
// uma de outro idioma, que é o sintoma que já foi reportado. Nenhum dos dois é
// consertável depois do deploy: a régua tem que barrar ANTES.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const BASELINE = new URL("data/catalog-baseline.json", ROOT);
const GAMES = { pokemon: "data/", lorcana: "data/lorcana/", onepiece: "data/onepiece/", magic: "data/magic/", fab: "data/fab/", gundam: "data/gundam/", dbfw: "data/dbfw/", ygo: "data/ygo/", digimon: "data/digimon/", riftbound: "data/riftbound/", unionarena: "data/unionarena/", naruto: "data/naruto/", hxh: "data/hxh/", jump: "data/jump/" };
const UPDATE = process.argv.includes("--update-baseline");
const ACEITA_ID = process.argv.includes("--aceitar-mudanca-de-id");

async function readCards(dir) {
  // Pokémon não tem cards.js de verdade: em produção são os CHUNKS
  // (data/sets/<idioma>/<set>.json) e o cards.js versionado é só uma amostra de
  // 13 cartas pro dev. Ler a amostra deixava justamente o maior catálogo do
  // site (52 mil cartas, 5 idiomas, o único que recebe cartas injetadas pela
  // PPT) FORA de toda checagem — id duplicado passava batido aqui.
  let deCards = null;
  try {
    const t = await readFile(new URL(dir + "cards.js", ROOT), "utf8");
    const g = { window: {} };
    new Function("window", t)(g.window);
    deCards = g.window.TCG_CARDS || null;
  } catch { /* sem cards.js: só chunks */ }
  // Só cai nos chunks quando o cards.js não serve como catálogo (ausente ou
  // amostra): pros outros jogos ele continua sendo a fonte que a régua conhece.
  if (deCards && deCards.length >= 100) return deCards;
  const porChunks = await readChunks(dir);
  return (porChunks && porChunks.length) ? porChunks : deCards;
}

// Chunks de set: <dir>sets/*.json (magic, ygo) ou <dir>sets/<idioma>/*.json
// (Pokémon). Devolve null quando o jogo não usa chunks.
async function readChunks(dir) {
  const base = new URL(dir + "sets/", ROOT);
  let entradas;
  try { entradas = await readdir(base, { withFileTypes: true }); } catch { return null; }
  const arquivos = [];
  for (const e of entradas) {
    if (e.isDirectory()) {
      try { (await readdir(new URL(e.name + "/", base))).forEach((f) => { if (f.endsWith(".json")) arquivos.push(`${e.name}/${f}`); }); }
      catch { /* subpasta ilegível: segue */ }
    } else if (e.name.endsWith(".json")) arquivos.push(e.name);
  }
  if (!arquivos.length) return null;
  const cards = [];
  for (const f of arquivos) {
    try {
      const arr = JSON.parse(await readFile(new URL(f, base), "utf8"));
      if (Array.isArray(arr)) cards.push(...arr);
    } catch { /* chunk ilegível vira "carta quebrada" pela contagem que não veio */ }
  }
  return cards;
}

const errors = [];
const warnings = [];
const lidos = {};   // jogo -> cartas já lidas no laço principal
let baseline = {};
try { baseline = JSON.parse(await readFile(BASELINE, "utf8")); } catch { /* primeira rodada */ }
const nextBaseline = {};

for (const [game, dir] of Object.entries(GAMES)) {
  const cards = await readCards(dir);
  if (!cards) { console.log(`  ${game}: sem catálogo (ok se o jogo ainda não tem dados)`); continue; }

  // Erros duros: integridade básica.
  const seen = new Set();
  let dupes = 0, broken = 0, withImage = 0;
  for (const c of cards) {
    if (!c || !c.id || !c.name || !c.set) { broken++; continue; }
    if (seen.has(c.id)) dupes++;
    seen.add(c.id);
    if (c.image) withImage++;
  }
  if (dupes) errors.push(`${game}: ${dupes} id(s) duplicado(s)`);
  if (broken) errors.push(`${game}: ${broken} carta(s) sem id/nome/set`);

  lidos[game] = cards;                        // reaproveitado pela trava de id
  const sets = new Set(cards.map((c) => c.set)).size;
  const imgPct = cards.length ? Math.round((withImage / cards.length) * 100) : 0;
  const base = baseline[game];
  const sample = cards.length < 100; // amostra local (ex.: Pokémon dev): não aplica régua
  if (base && !sample) {
    if (cards.length === 0 && base.cards > 0) errors.push(`${game}: catálogo ZEROU (régua: ${base.cards})`);
    else if (cards.length < base.cards) warnings.push(`${game}: ${cards.length} cartas < régua ${base.cards} (regressão?)`);
    if (sets < base.sets) warnings.push(`${game}: ${sets} sets < régua ${base.sets}`);
    if (base.imgPct && imgPct < base.imgPct - 10) warnings.push(`${game}: imagens ${imgPct}% (régua ${base.imgPct}%)`);
  }
  nextBaseline[game] = sample && base ? base : { cards: cards.length, sets, imgPct };
  console.log(`  ${game}: ${cards.length} cartas · ${sets} sets · ${imgPct}% com imagem${sample ? " (amostra: régua não aplicada)" : ""}`);
}

// ── Estabilidade de ID ──────────────────────────────────────────────────────
// Compara o catálogo recém-gerado com o PUBLICADO (o que está no HEAD do git —
// o deploy versiona o catálogo validado a cada build). Duas perguntas, as duas
// sobre a conta de quem já coleciona:
//   1. algum id que existia SUMIU?           -> carta some da coleção da pessoa
//   2. algum id passou a apontar pra OUTRA carta (idioma/número/set)?
//                                            -> a carta da pessoa vira outra
// Só os arquivos que MUDARAM entram na conta (o resto não tem como perder id),
// mas o "sumiu" é conferido contra o catálogo NOVO INTEIRO: carta que trocou de
// chunk (mudou de set/idioma no arquivo) não é sumiço.
await checarEstabilidadeDeId();

async function checarEstabilidadeDeId() {
  const cwd = fileURLToPath(ROOT);
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  let mudados;
  try { mudados = git(["diff", "--name-only", "HEAD", "--", "data"]).split("\n").map((s) => s.trim()).filter(Boolean); }
  catch (e) {
    warnings.push("estabilidade de id: sem git (ou sem HEAD) — checagem pulada");
    return;
  }
  // Só arquivo de catálogo: chunk de set ou cards.js. O resto de data/ (preço,
  // índice, logo) não define id de carta.
  const ehCatalogo = (f) => /^data\/(sets\/[^/]+\/[^/]+\.json|[a-z0-9]+\/sets\/[^/]+\.json|[a-z0-9]+\/cards\.js|cards\.js)$/.test(f);
  const jogoDe = (f) => (f.startsWith("data/sets/") || f === "data/cards.js" ? "pokemon" : f.split("/")[1]);
  const alvos = mudados.filter(ehCatalogo);
  if (!alvos.length) { console.log("\n  estabilidade de id: nenhum arquivo de catálogo mudou"); return; }

  const parse = (nome, texto) => {
    if (nome.endsWith(".json")) { const a = JSON.parse(texto); return Array.isArray(a) ? a : []; }
    const g = { window: {} };
    new Function("window", texto)(g.window);
    return g.window.TCG_CARDS || [];
  };
  // IDENTIDADE = idioma + set. Trocar isso num id que já está publicado é trocar
  // a carta da pessoa por outra — erro duro. O NÚMERO fica separado porque muda
  // por formatação da fonte ("4/102" -> "4") sem a carta deixar de ser ela:
  // vale um aviso, não vale barrar o deploy.
  const assina = (c) => `${c.language || "en"}|${c.setId || ""}`;
  const numDe = (c) => String(c.number || "");

  const antes = {};   // jogo -> Map(id -> assinatura), lido do HEAD
  for (const f of alvos) {
    const jogo = jogoDe(f);
    let texto;
    try { texto = git(["show", `HEAD:${f}`]); } catch { continue; }   // arquivo NOVO: nada a perder
    let cartas;
    try { cartas = parse(f, texto); } catch { continue; }
    antes[jogo] = antes[jogo] || new Map();
    for (const c of cartas) if (c && c.id) antes[jogo].set(c.id, { sig: assina(c), num: numDe(c) });
  }

  let achou = false;
  for (const jogo of Object.keys(antes)) {
    const cards = lidos[jogo] || await readCards(GAMES[jogo] || `data/${jogo}/`);
    if (!cards || !cards.length) { warnings.push(`${jogo}: estabilidade de id não checada (catálogo novo não lido)`); continue; }
    const agora = new Map();
    for (const c of cards) if (c && c.id) agora.set(c.id, { sig: assina(c), num: numDe(c) });
    const sumidos = [], repontados = [], renumerados = [];
    for (const [id, antigo] of antes[jogo]) {
      const nova = agora.get(id);
      if (!nova) sumidos.push(id);
      else if (nova.sig !== antigo.sig) repontados.push(`${id} (${antigo.sig} -> ${nova.sig})`);
      else if (nova.num !== antigo.num) renumerados.push(`${id} (nº ${antigo.num} -> ${nova.num})`);
    }
    const lista = (arr) => arr.slice(0, 10).join(", ") + (arr.length > 10 ? `, +${arr.length - 10}` : "");
    if (sumidos.length) { achou = true; (ACEITA_ID ? warnings : errors).push(`${jogo}: ${sumidos.length} id(s) PUBLICADO(S) sumiram do catálogo — some da coleção de quem tem: ${lista(sumidos)}`); }
    if (repontados.length) { achou = true; (ACEITA_ID ? warnings : errors).push(`${jogo}: ${repontados.length} id(s) passaram a apontar pra OUTRA carta (idioma/set): ${lista(repontados)}`); }
    if (renumerados.length) warnings.push(`${jogo}: ${renumerados.length} id(s) mudaram de número (mesma carta?): ${lista(renumerados)}`);
    if (!sumidos.length && !repontados.length) console.log(`  estabilidade de id: ${jogo} ok (${antes[jogo].size} ids conferidos${renumerados.length ? `, ${renumerados.length} renumerado(s)` : ""})`);
  }
  if (achou && !ACEITA_ID) console.log("\n  (mudança intencional? rode com --aceitar-mudanca-de-id — mas confira antes quem perde carta.)");
}

if (UPDATE) {
  // Jogo sem catálogo local (o .gitignore não versiona o cards.js de todos)
  // mantém a régua que já estava: regravar do zero apagaria a linha dele.
  await writeFile(BASELINE, JSON.stringify(Object.assign({}, baseline, nextBaseline), null, 1), "utf8");
  console.log("  régua atualizada: data/catalog-baseline.json (commitar).");
}
if (warnings.length) { console.log(`\n⚠ ${warnings.length} AVISO(S):`); warnings.forEach((w) => console.log("   - " + w)); }
if (errors.length) { console.log(`\n✖ ${errors.length} ERRO(S) DURO(S):`); errors.forEach((e) => console.log("   - " + e)); process.exit(1); }
console.log("\n✓ catálogos íntegros");
