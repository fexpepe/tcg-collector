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
//   4. Compara o hash do out/d1.sql com o gravado na tabela meta remota e
//      SÓ importa quando o catálogo mudou (a carga é total, não incremental).
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

// ── 4. Carga (só quando o catálogo mudou) ───────────────────────────────────
const sql = readFileSync(new URL("../out/d1.sql", import.meta.url), "utf8");
const hashLocal = (sql.match(/VALUES \('hash', '([0-9a-f]+)'\)/) || [])[1];
if (!hashLocal) { console.error("deploy-d1: out/d1.sql sem o hash — rode o build-d1 antes."); process.exit(1); }

let hashRemoto = null;
try {
  const r = JSON.parse(wrangler(["d1", "execute", BANCO, "--remote", "--json", "--command", "SELECT v FROM meta WHERE k='hash'"]));
  hashRemoto = r && r[0] && r[0].results && r[0].results[0] && r[0].results[0].v || null;
} catch (e) { /* banco novo/vazio: importa */ }

if (hashRemoto === hashLocal) {
  console.log(`deploy-d1: catálogo remoto já está no hash ${hashLocal} — carga pulada.`);
  process.exit(0);
}
console.log(`deploy-d1: carregando catálogo (${(sql.length / 1048576).toFixed(1)} MB, hash ${hashLocal}; remoto era ${hashRemoto || "vazio"})…`);
try {
  wrangler(["d1", "execute", BANCO, "--remote", "--file", new URL("../out/d1.sql", import.meta.url).pathname, "-y"], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("deploy-d1: carga concluída.");
} catch (e) {
  // A API sem dados responde 503 e o cliente cai no estático — um site novo
  // parado na esteira por causa disso seria trocar o certo pelo duvidoso.
  console.log("deploy-d1: CARGA FALHOU (a API segue desligada; o deploy do site continua):", String(e).slice(0, 300));
}
