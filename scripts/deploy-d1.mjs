// Prepara a API na borda em TODO deploy — mas degrada pra "ainda não" sem
// quebrar o build enquanto o token não tiver a permissão de D1.
//
// O que faz, em ordem:
//   1. Testa a permissão (wrangler d1 list). Sem ela: imprime a instrução
//      exata pro dono e SAI COM SUCESSO — o site continua saindo igual, a
//      /api/search responde 503 {off:1} e o cliente usa o caminho estático.
//   2. Garante o banco `sleevu-api` (cria se não existir).
//   3. Liga o binding DB no projeto Pages (API REST, production + preview) —
//      ANTES do passo de deploy do site, pra o deployment já nascer ligado.
//   4. Compara o hash do out/d1-*.sql com o gravado na tabela meta remota e
//      SÓ importa quando o catálogo mudou (a carga é total, não incremental).
//      Com LOCK: dois deploys nunca importam ao mesmo tempo, e qualquer
//      dúvida sobre o estado remoto significa NÃO carregar (ver lá embaixo).
//
// Pré-requisito de quem chama: node scripts/build-d1.mjs já rodou.
// Env: CLOUDFLARE_API_TOKEN (com Pages:Edit + D1:Edit) e CLOUDFLARE_ACCOUNT_ID.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CONTA = process.env.CLOUDFLARE_ACCOUNT_ID;
const PROJETO = "tcg-collector";
const BANCO = "sleevu-api";

if (!TOKEN || !CONTA) {
  console.log("deploy-d1: sem credenciais da Cloudflare no ambiente — pulando (API fica desligada).");
  process.exit(0);
}

function wrangler(args, opts) {
  return execFileSync("npx", ["--yes", "wrangler@3", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  });
}

// ── 1. Permissão ────────────────────────────────────────────────────────────
let bancos;
try {
  bancos = JSON.parse(wrangler(["d1", "list", "--json"]));
} catch (e) {
  console.log("deploy-d1: o token NÃO tem permissão de D1 — a API na borda fica desligada por enquanto.");
  console.log("  Pra ligar (uma vez só): dash.cloudflare.com -> My Profile -> API Tokens ->");
  console.log("  editar o token do deploy -> adicionar 'Account / D1 / Edit' -> salvar.");
  console.log("  (Se criar um token novo, atualizar o secret CLOUDFLARE_API_TOKEN no GitHub.)");
  console.log("  No próximo deploy este passo cria o banco, carrega o catálogo e liga tudo sozinho.");
  process.exit(0);
}

// ── 2. Banco ────────────────────────────────────────────────────────────────
let db = (bancos || []).find((b) => b.name === BANCO);
if (!db) {
  console.log(`deploy-d1: criando o banco ${BANCO}…`);
  wrangler(["d1", "create", BANCO]);
  db = JSON.parse(wrangler(["d1", "list", "--json"])).find((b) => b.name === BANCO);
}
if (!db || !db.uuid) { console.error("deploy-d1: não achei o uuid do banco depois de criar."); process.exit(1); }
console.log(`deploy-d1: banco ${BANCO} = ${db.uuid}`);

// ── 3. Binding no projeto Pages ─────────────────────────────────────────────
// REST direto (não wrangler.toml): mexer no arquivo de config mudaria o
// comportamento do `wrangler pages deploy` inteiro; o PATCH só acrescenta o
// binding e preserva o resto do deployment_config.
const resposta = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CONTA}/pages/projects/${PROJETO}`, {
  method: "PATCH",
  headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    deployment_configs: {
      production: { d1_databases: { DB: { id: db.uuid } } },
      preview: { d1_databases: { DB: { id: db.uuid } } }
    }
  })
});
const corpo = await resposta.json().catch(() => ({}));
if (!resposta.ok || corpo.success === false) {
  // NÃO derruba o build (na primeira execução real derrubou — o site ficou um
  // deploy sem sair por causa de config de binding). Binding e CARGA são
  // independentes: a carga segue abaixo, e a API só fica escura até o binding
  // existir. O 403 aqui com um token que cria banco e faz deploy indica que a
  // permissão do endpoint de settings do projeto é outra — o caminho manual é
  // um clique único e definitivo:
  console.log(`deploy-d1: não consegui ligar o binding via API (HTTP ${resposta.status}: ${JSON.stringify(corpo.errors || {}).slice(0, 200)}).`);
  console.log("  Ligue UMA VEZ no painel: dash.cloudflare.com -> Workers & Pages -> tcg-collector ->");
  console.log("  Settings -> Bindings (ou Functions) -> Add -> D1 database ->");
  console.log(`  variável: DB · banco: ${BANCO} — em Production E Preview -> Save.`);
  console.log("  (Depois disso a /api/search liga no deploy seguinte; a carga de dados abaixo já vale.)");
} else {
  console.log("deploy-d1: binding DB ligado no projeto (production + preview).");
}

// ── 4. Carga (cada parte só quando ELA mudou) ───────────────────────────────
// Duas cargas independentes: o catálogo muda raramente e os preços mudam a
// cada sync. Com um arquivo só, um ajuste de preço reescreveria as 236 mil
// cartas e os 2,3 milhões de palavras de dois em dois dias.
//
// REGRA DE OURO (aprendida na prática, custou a cota do D1): na dúvida, NÃO
// carrega. Cada carga do catálogo insere 2,3 milhões de linhas e cria dois
// índices por cima delas — só isso lê mais de 4 milhões de linhas, quase a
// cota diária inteira do plano grátis (5M rows_read). A versão anterior
// tratava QUALQUER erro ao ler a meta remota como "banco vazio, carrega tudo".
// Quando outro deploy estava no meio de um import (o D1 fica indisponível
// durante o import), a leitura falhava, este run disparava um segundo import
// de 122 MB por cima do primeiro, os dois colidiam na tabela sombra (UNIQUE
// constraint em cards_new), a meta ficava sem hash e o push seguinte repetia
// tudo. Dezenas de vezes por dia.
//
// Agora: (a) erro ao ler a meta = pula a carga, com o motivo no log; (b) um
// lock em `meta` garante que só um deploy importa por vez; (c) o hash é lido
// DE NOVO depois de pegar o lock — quem esperou pode achar a carga já feita.

function sqlMeta(sql) {
  return JSON.parse(wrangler(["d1", "execute", BANCO, "--remote", "--json", "--command", sql]));
}
const ultimoValor = (r) => (r && r[r.length - 1] && r[r.length - 1].results && r[r.length - 1].results[0] && r[r.length - 1].results[0].v) || null;

// Hash gravado na meta remota. null = a chave (ou a tabela) ainda não existe,
// que é o ÚNICO caso em que "carrega" é a resposta certa. Qualquer outra
// falha (banco indisponível, permissão, rede) sobe como erro pro chamador.
function hashRemoto(chave) {
  try {
    return ultimoValor(sqlMeta(`SELECT v FROM meta WHERE k='${chave}'`));
  } catch (e) {
    const msg = String((e && e.stdout) || "") + String((e && e.stderr) || "") + String((e && e.message) || e);
    if (/no such table/i.test(msg)) return null;   // banco novo: meta ainda não existe
    throw new Error(`não consegui ler meta.${chave} no D1 — ${msg.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

// Lock: uma linha em meta (k='lock') com o instante em ms. Só entra quem
// consegue gravar o PRÓPRIO instante — o UPSERT só sobrescreve um lock velho
// (carga que morreu sem soltar; 20 min cobre a carga de 122 MB com folga).
// A leitura de volta diz quem ganhou. Falhou a gravação = alguém está
// importando (ou o banco não responde): NÃO carrega.
const LOCK_TTL_MS = 20 * 60 * 1000;
const MEU_LOCK = String(Date.now());
function pegaLock() {
  const r = sqlMeta(
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
     INSERT INTO meta (k, v) VALUES ('lock', '${MEU_LOCK}')
       ON CONFLICT(k) DO UPDATE SET v = excluded.v
       WHERE CAST(meta.v AS INTEGER) < ${Number(MEU_LOCK) - LOCK_TTL_MS};
     SELECT v FROM meta WHERE k='lock';`
  );
  return ultimoValor(r) === MEU_LOCK;
}
function soltaLock() {
  try { sqlMeta(`DELETE FROM meta WHERE k='lock' AND v='${MEU_LOCK}'`); }
  catch (e) { console.log("deploy-d1: não consegui soltar o lock (expira sozinho em 20 min):", String(e).slice(0, 200)); }
}

function hashLocal(rotulo, arquivo, marcador) {
  const url = new URL(`../out/${arquivo}`, import.meta.url);
  let sql;
  try { sql = readFileSync(url, "utf8"); }
  catch (e) { console.log(`deploy-d1: ${arquivo} não existe — rode o build-d1 antes. (${rotulo} não carregado)`); return null; }
  const local = (sql.match(marcador) || [])[1];
  if (!local) { console.log(`deploy-d1: ${arquivo} sem o hash — ${rotulo} não carregado.`); return null; }
  return { url, sql, local };
}

// true = carregou (ou já estava). false = não carregou (motivo no log).
function carrega(rotulo, arquivo, chaveHash, marcador) {
  const h = hashLocal(rotulo, arquivo, marcador);
  if (!h) return false;
  const remoto = hashRemoto(chaveHash);   // pode lançar: o chamador decide
  if (remoto === h.local) {
    console.log(`deploy-d1: ${rotulo} remoto já está no hash ${h.local} — carga pulada.`);
    return true;
  }
  console.log(`deploy-d1: carregando ${rotulo} (${(h.sql.length / 1048576).toFixed(1)} MB, hash ${h.local}; remoto era ${remoto || "vazio"})…`);
  try {
    wrangler(["d1", "execute", BANCO, "--remote", "--file", h.url.pathname, "-y"], { stdio: ["ignore", "inherit", "inherit"] });
    console.log(`deploy-d1: ${rotulo} carregado.`);
    return true;
  } catch (e) {
    // A API sem dados responde 503 e o cliente cai no estático — um site novo
    // parado na esteira por causa disso seria trocar o certo pelo duvidoso.
    console.log(`deploy-d1: CARGA DE ${rotulo.toUpperCase()} FALHOU (a API degrada; o deploy do site continua):`, String(e).slice(0, 300));
    return false;
  }
}

const CARGAS = [
  ["catálogo", "d1-cards.sql", "hash", /VALUES \('hash', '([0-9a-f]+)'\)/],
  ["preços", "d1-prices.sql", "hashPrices", /VALUES \('hashPrices', '([0-9a-f]+)'\)/]
];

// Passo barato antes do lock: se NADA mudou (o caso de quase todo push), não
// há por que escrever lock nenhum.
let precisa;
try {
  precisa = CARGAS.filter(([rotulo, arquivo, chave, marcador]) => {
    const h = hashLocal(rotulo, arquivo, marcador);
    return h && hashRemoto(chave) !== h.local;
  });
} catch (e) {
  console.log(`deploy-d1: banco não respondeu — NÃO vou carregar nada neste deploy (o próximo tenta de novo). ${e.message}`);
  process.exit(0);
}
if (!precisa.length) {
  console.log("deploy-d1: catálogo e preços já estão no hash local — nada a carregar.");
  process.exit(0);
}

let lock = false;
try { lock = pegaLock(); }
catch (e) { console.log(`deploy-d1: não consegui pegar o lock — NÃO vou carregar (${String(e.message || e).slice(0, 200)}).`); process.exit(0); }
if (!lock) {
  console.log("deploy-d1: outro deploy está carregando o banco agora — este pula (o próximo push confere de novo).");
  process.exit(0);
}
try {
  for (const args of precisa) {
    try { carrega(...args); }
    catch (e) { console.log(`deploy-d1: ${args[0]} não carregado — ${e.message}`); }
  }
} finally {
  soltaLock();
}
