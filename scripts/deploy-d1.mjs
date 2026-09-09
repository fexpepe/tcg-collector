// Prepara a API na borda em TODO deploy do main — mas degrada pra "ainda não"
// sem quebrar o build enquanto o token não tiver a permissão de D1.
//
// O que faz, em ordem:
//   1. Testa a permissão (wrangler d1 list). Sem ela: imprime a instrução
//      exata pro dono e SAI COM SUCESSO — o site continua saindo igual, a
//      /api/search responde 503 {off:1} e o cliente usa o caminho estático.
//   2. Garante o banco `sleevu-api` (cria se não existir).
//   3. Liga o binding DB no projeto Pages (API REST, production + preview) —
//      ANTES do passo de deploy do site, pra o deployment já nascer ligado.
//   4. Compara o hash do out/d1-*.sql com o gravado na tabela meta remota.
//      Igual = nada a fazer (o caso de quase todo push). Diferente = grava a
//      DIFERENÇA: lê as impressões digitais remotas (id + hash por linha),
//      compara com o catálogo local e escreve só as linhas que mudaram, dentro
//      de um ORÇAMENTO diário de linhas escritas. A carga total (tabela sombra
//      + troca) só roda quando o banco está numa versão de esquema anterior.
//      Com LOCK: dois deploys nunca escrevem ao mesmo tempo, e qualquer dúvida
//      sobre o estado remoto significa NÃO escrever (ver lá embaixo).
//
// Pré-requisito de quem chama: node scripts/build-d1.mjs já rodou.
// Env: CLOUDFLARE_API_TOKEN (com Pages:Edit + D1:Edit), CLOUDFLARE_ACCOUNT_ID
// e, opcional, D1_ROWS_WRITTEN_BUDGET (ver "Orçamento").
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ESQUEMA, RAIZ, aspas, lerCatalogo } from "./lib/d1-catalogo.mjs";
import { diffCartas, diffPrecos, planoCartas, planoPrecos } from "./lib/d1-delta.mjs";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CONTA = process.env.CLOUDFLARE_ACCOUNT_ID;
const PROJETO = "tcg-collector";
const BANCO = "sleevu-api";

// ── Orçamento ───────────────────────────────────────────────────────────────
// O plano grátis do D1 dá 100 mil linhas ESCRITAS por dia (reset 00:00 UTC),
// e índice conta como linha. Todo deploy soma o que escreveu em meta.gasto
// ("AAAA-MM-DD:n") e para quando o dia chega no teto: o que ficou pendente é
// gravado no deploy seguinte (a diferença é recalculada contra o banco, então
// nada se perde — só atrasa). 90 mil e não 100: a estimativa é por cima, mas
// a margem cobre uma leitura de meta a mais ou um índice que a conta esqueceu.
// Passou pro Workers Paid (50M de escritas/mês inclusas)? É só definir a
// variável D1_ROWS_WRITTEN_BUDGET no repositório (Settings -> Variables), sem
// mexer em código — 1000000 dá 30M/mês com folga pra tudo sair no mesmo dia.
const ORCAMENTO = Number(process.env.D1_ROWS_WRITTEN_BUDGET) || 90000;
const MINIMO = 1000;   // abaixo disso não vale nem ler as impressões remotas
const HOJE = new Date().toISOString().slice(0, 10);

if (!TOKEN || !CONTA) {
  console.log("deploy-d1: sem credenciais da Cloudflare no ambiente — pulando (API fica desligada).");
  process.exit(0);
}

function wrangler(args, opts) {
  return execFileSync("npx", ["--yes", "wrangler@3", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 512 * 1024 * 1024,   // as impressões de um jogo inteiro voltam num JSON só
    ...opts
  });
}
const textoErro = (e) => (String((e && e.stdout) || "") + String((e && e.stderr) || "") + String((e && e.message) || e)).replace(/\s+/g, " ");

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

// ── 4. Carga ────────────────────────────────────────────────────────────────
// REGRA DE OURO (aprendida na prática, custou a cota do D1): na dúvida, NÃO
// escreve. A versão anterior tratava QUALQUER erro ao ler a meta remota como
// "banco vazio, carrega tudo". Quando outro deploy estava no meio de um import
// (o D1 fica indisponível durante o import), a leitura falhava, este run
// disparava um segundo import de 122 MB por cima do primeiro, os dois colidiam
// na tabela sombra, a meta ficava sem hash e o push seguinte repetia tudo.
//
// Agora: (a) erro ao ler a meta = pula, com o motivo no log; (b) um lock em
// `meta` garante que só um deploy escreve por vez; (c) tudo o que se escreve
// é a DIFERENÇA contra o banco, dentro do orçamento do dia.

function sqlJson(sql) {
  return JSON.parse(wrangler(["d1", "execute", BANCO, "--remote", "--json", "--command", sql]));
}
const ultimo = (r) => (r && r[r.length - 1]) || {};
const resultados = (r) => ultimo(r).results || [];
const ultimoValor = (r) => (resultados(r)[0] && resultados(r)[0].v) || null;

// Toda a meta de uma vez (hashes, esquema, gasto do dia). Map vazio = a tabela
// ainda não existe (banco novo), o ÚNICO caso em que "carrega tudo" é a
// resposta certa. Qualquer outra falha sobe como erro pro chamador.
function lerMeta() {
  try {
    const m = new Map();
    for (const l of resultados(sqlJson("SELECT k, v FROM meta"))) m.set(l.k, l.v);
    return m;
  } catch (e) {
    const msg = textoErro(e);
    if (/no such table/i.test(msg)) return new Map();
    throw new Error(`não consegui ler a meta no D1 — ${msg.slice(0, 300)}`);
  }
}
function gravaMeta(pares) {
  const valores = Object.entries(pares).map(([k, v]) => `(${aspas(k)}, ${aspas(v)})`).join(", ");
  return `INSERT INTO meta (k, v) VALUES ${valores} ON CONFLICT(k) DO UPDATE SET v = excluded.v;`;
}

// Lock: uma linha em meta (k='lock') com o instante em ms. Só entra quem
// consegue gravar o PRÓPRIO instante — o UPSERT só sobrescreve um lock velho
// (carga que morreu sem soltar; 20 min cobre a carga de 122 MB com folga).
// A leitura de volta diz quem ganhou. Falhou a gravação = alguém está
// escrevendo (ou o banco não responde): NÃO escreve.
const LOCK_TTL_MS = 20 * 60 * 1000;
const MEU_LOCK = String(Date.now());
function pegaLock() {
  const r = sqlJson(
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
     INSERT INTO meta (k, v) VALUES ('lock', '${MEU_LOCK}')
       ON CONFLICT(k) DO UPDATE SET v = excluded.v
       WHERE CAST(meta.v AS INTEGER) < ${Number(MEU_LOCK) - LOCK_TTL_MS};
     SELECT v FROM meta WHERE k='lock';`
  );
  return ultimoValor(r) === MEU_LOCK;
}
function soltaLock() {
  try { sqlJson(`DELETE FROM meta WHERE k='lock' AND v='${MEU_LOCK}'`); }
  catch (e) { console.log("deploy-d1: não consegui soltar o lock (expira sozinho em 20 min):", textoErro(e).slice(0, 200)); }
}

// Gasto do dia (linhas escritas pelos deploys de hoje, UTC — o reset da cota
// é 00:00 UTC). Registrado DEPOIS de cada escrita, com o número que o próprio
// D1 devolve; se ele não vier, entra a estimativa.
let gasto = 0;
function gastoDe(meta) {
  const [dia, n] = String(meta.get("gasto") || "").split(":");
  return dia === HOJE ? (Number(n) || 0) : 0;
}
function registraGasto() {
  try { sqlJson(gravaMeta({ gasto: `${HOJE}:${gasto}` })); }
  catch (e) { console.log("deploy-d1: não consegui registrar o gasto do dia:", textoErro(e).slice(0, 200)); }
}

// Executa um arquivo SQL no banco e devolve as linhas escritas que o D1
// reportou (null se não deu pra ler). Saída do wrangler vai pro log, sem o
// JSON de cada statement.
function executaArquivo(caminho) {
  const saida = wrangler(["d1", "execute", BANCO, "--remote", "--file", caminho, "-y"]);
  const util = saida.split("\n").filter((l) => /🌀|🚣|WARNING|ERROR/.test(l) && !/Processed \d+ queries/.test(l));
  if (util.length) console.log("  " + util.join("\n  ").trim());
  const m = saida.match(/\((\d+) rows read, (\d+) rows written\)/);
  return m ? Number(m[2]) : null;
}

function hashLocal(rotulo, arquivo, marcador) {
  const url = new URL(`out/${arquivo}`, RAIZ);
  let sql;
  try { sql = readFileSync(url, "utf8"); }
  catch (e) { console.log(`deploy-d1: ${arquivo} não existe — rode o build-d1 antes. (${rotulo} não carregado)`); return null; }
  const local = (sql.match(marcador) || [])[1];
  if (!local) { console.log(`deploy-d1: ${arquivo} sem o hash — ${rotulo} não carregado.`); return null; }
  return { url, sql, local };
}

// Carga TOTAL (tabela sombra + troca, ver build-d1): só quando o banco está
// numa versão de esquema anterior — a incremental precisa das colunas h/hw e
// do índice por id, que só a total cria. Escreve 7 milhões de linhas; no plano
// grátis é UM dia acima da cota, o último. Ignora o orçamento de propósito:
// sem ela não há incremental nenhuma depois.
function cargaTotal(rotulo, h) {
  console.log(`deploy-d1: CARGA TOTAL de ${rotulo} (${(h.sql.length / 1048576).toFixed(1)} MB, hash ${h.local}) — esquema remoto anterior a ${ESQUEMA}; é a última vez: daqui em diante só a diferença é gravada.`);
  try {
    const escritas = executaArquivo(h.url.pathname);
    gasto += escritas ?? Math.round(h.sql.length / 18);   // ~18 bytes de SQL por linha escrita, medido
    console.log(`deploy-d1: ${rotulo} carregado (${escritas ?? "?"} linhas escritas).`);
    return true;
  } catch (e) {
    // A API sem dados responde 503 e o cliente cai no estático — um site novo
    // parado na esteira por causa disso seria trocar o certo pelo duvidoso.
    gasto = Math.max(gasto, ORCAMENTO);   // não insistir hoje: cota estourada é o motivo mais provável
    console.log(`deploy-d1: CARGA TOTAL DE ${rotulo.toUpperCase()} FALHOU (a API degrada; o deploy do site continua): ${textoErro(e).slice(0, 300)}`);
    return false;
  } finally { registraGasto(); }
}

// Impressões remotas de um jogo (Map id -> linha), lidas num SELECT só por
// jogo: ~250 mil linhas lidas no total, 5% da cota diária de leitura. Se a
// resposta de um jogo for grande demais pro D1/wrangler, divide a faixa de ids
// ao meio (pelos ids locais, ordenados) e tenta de novo — até 6 níveis.
let leituras = 0;
function lerImpressoes(tabela, colunas, game, idsLocais, lo = null, hi = null, nivel = 0) {
  const cond = [`game = ${aspas(game)}`];
  if (lo != null) cond.push(`id >= ${aspas(lo)}`);
  if (hi != null) cond.push(`id < ${aspas(hi)}`);
  let r;
  try { r = sqlJson(`SELECT ${colunas} FROM ${tabela} WHERE ${cond.join(" AND ")}`); }
  catch (e) {
    const faixa = idsLocais.filter((id) => (lo == null || id >= lo) && (hi == null || id < hi)).sort();
    if (nivel >= 6 || faixa.length < 2) throw e;
    const meio = faixa[Math.floor(faixa.length / 2)];
    return new Map([
      ...lerImpressoes(tabela, colunas, game, idsLocais, lo, meio, nivel + 1),
      ...lerImpressoes(tabela, colunas, game, idsLocais, meio, hi, nivel + 1)
    ]);
  }
  leituras += (ultimo(r).meta && ultimo(r).meta.rows_read) || 0;
  return new Map(resultados(r).map((l) => [l.id, l]));
}

// Carga INCREMENTAL de cartas e/ou preços, num passeio só pelo catálogo.
// Cartas primeiro (mudam pouco e é o que a busca precisa), preços com o que
// sobrar do orçamento. Cada tabela vira UM arquivo executado de uma vez; o
// hash da tabela só é gravado quando a diferença coube inteira — senão o
// próximo deploy recalcula e continua (é a retomada, ver d1-delta.mjs).
async function cargaIncremental(fazCartas, fazPrecos, hashes) {
  const restante = () => ORCAMENTO - gasto;
  if (restante() < MINIMO) {
    console.log(`deploy-d1: orçamento do dia esgotado (${gasto} de ${ORCAMENTO} linhas escritas hoje) — o que falta fica pro próximo deploy.`);
    return;
  }
  const stmtsCartas = [], precosPorJogo = [];
  let custoCartas = 0, feitos = 0, pendentes = 0, incompleto = false;
  for await (const { game, cards, precos } of lerCatalogo()) {
    if (fazPrecos) precosPorJogo.push({ game, precos });
    if (!fazCartas) continue;
    if (incompleto || restante() - custoCartas < MINIMO) { incompleto = true; continue; }   // não lê o que não vai gravar
    const mapa = new Map(cards.map((c) => [c.linha.id, c]));
    const remotos = lerImpressoes("cards", "id, h, hw", game, [...mapa.keys()]);
    const diff = diffCartas(mapa, remotos);
    const plano = planoCartas(game, diff, mapa, restante() - custoCartas);
    const n = diff.novos.length + diff.palavras.length + diff.linha.length + diff.acrescentar.length + diff.remover.length;
    if (n) console.log(`  ${game}: ${diff.novos.length} novas, ${diff.palavras.length} com palavras mudadas, ${diff.linha.length} com linha mudada, ${diff.acrescentar.length} só com palavras a acrescentar, ${diff.remover.length} sumiram → ${plano.feitos} agora (~${plano.custo} linhas), ${plano.pendentes} pendentes`);
    stmtsCartas.push(...plano.statements);
    custoCartas += plano.custo; feitos += plano.feitos; pendentes += plano.pendentes;
    if (plano.pendentes) incompleto = true;
  }
  if (fazCartas) {
    const ok = await executaDelta("catálogo", stmtsCartas, custoCartas, feitos, pendentes, incompleto,
      { hash: hashes.catalogo, geradoEm: new Date().toISOString() });
    if (!ok) return;   // falhou = provável cota; preços ficam pro próximo deploy
  }
  if (!fazPrecos) return;
  const stmts = [];
  let custo = 0, feitosP = 0, pendentesP = 0, incompletoP = false;
  for (const { game, precos } of precosPorJogo) {
    if (incompletoP || restante() - custo < MINIMO) { incompletoP = true; continue; }
    const mapa = new Map(precos.map((p) => [p.id, p]));
    const remotos = lerImpressoes("prices", "id, h", game, precos.map((p) => p.id));
    const diff = diffPrecos(new Map(precos.map((p) => [p.id, p.h])), new Map([...remotos].map(([id, l]) => [id, l.h])));
    const plano = planoPrecos(game, diff, mapa, restante() - custo);
    if (diff.gravar.length + diff.remover.length) console.log(`  ${game}: ${diff.gravar.length} preços mudaram, ${diff.remover.length} sumiram → ${plano.feitos} agora, ${plano.pendentes} pendentes`);
    stmts.push(...plano.statements);
    custo += plano.custo; feitosP += plano.feitos; pendentesP += plano.pendentes;
    if (plano.pendentes) incompletoP = true;
  }
  await executaDelta("preços", stmts, custo, feitosP, pendentesP, incompletoP,
    { hashPrices: hashes.precos, precosEm: new Date().toISOString() });
}

async function executaDelta(rotulo, statements, custo, feitos, pendentes, incompleto, metaSeCompleto) {
  if (!statements.length && !incompleto) {
    // Hash diferente mas nenhuma linha diferente (só o SQL mudou de forma):
    // registra o hash e pronto.
    console.log(`deploy-d1: ${rotulo} — nenhuma linha difere do remoto; hash registrado.`);
    try { sqlJson(gravaMeta(metaSeCompleto)); } catch (e) { console.log(`deploy-d1: não consegui gravar o hash de ${rotulo}: ${textoErro(e).slice(0, 200)}`); }
    return true;
  }
  if (!statements.length) {
    console.log(`deploy-d1: ${rotulo} — nada coube no orçamento de hoje (${gasto} de ${ORCAMENTO} já gastos); fica pro próximo deploy.`);
    return true;
  }
  const arquivo = new URL(`out/d1-delta-${rotulo === "preços" ? "prices" : "cards"}.sql`, RAIZ);
  const sql = statements.join("\n") + (incompleto ? "\n" : `\n${gravaMeta(metaSeCompleto)}\n`);
  writeFileSync(arquivo, sql, "utf8");
  console.log(`deploy-d1: gravando ${rotulo} — ${feitos} ${rotulo === "preços" ? "preços" : "cartas"} em ${statements.length} statements (~${custo} linhas escritas estimadas, ${(sql.length / 1024).toFixed(0)} KB)${incompleto ? `; ${pendentes} ficam pro próximo deploy (orçamento)` : ""}…`);
  try {
    const escritas = executaArquivo(arquivo.pathname);
    gasto += escritas ?? custo;
    console.log(`deploy-d1: ${rotulo} ${incompleto ? "parcialmente gravado" : "atualizado"} (${escritas ?? "~" + custo} linhas escritas; ${gasto} de ${ORCAMENTO} hoje).`);
    return true;
  } catch (e) {
    gasto = Math.max(gasto, ORCAMENTO);   // não insistir hoje
    console.log(`deploy-d1: GRAVAÇÃO DE ${rotulo.toUpperCase()} FALHOU (a diferença é recalculada no próximo deploy; o site continua): ${textoErro(e).slice(0, 300)}`);
    return false;
  } finally { registraGasto(); }
}

// ── Decide ──────────────────────────────────────────────────────────────────
const catalogo = hashLocal("catálogo", "d1-cards.sql", /VALUES \('hash', '([0-9a-f]+)'\)/);
const precos = hashLocal("preços", "d1-prices.sql", /VALUES \('hashPrices', '([0-9a-f]+)'\)/);

let meta;
try { meta = lerMeta(); }
catch (e) {
  console.log(`deploy-d1: banco não respondeu — NÃO vou escrever nada neste deploy (o próximo tenta de novo). ${e.message}`);
  process.exit(0);
}
gasto = gastoDe(meta);
const fazCartas = !!catalogo && meta.get("hash") !== catalogo.local;
const fazPrecos = !!precos && meta.get("hashPrices") !== precos.local;
if (!fazCartas && !fazPrecos) {
  console.log("deploy-d1: catálogo e preços já estão no hash local — nada a escrever.");
  process.exit(0);
}
console.log(`deploy-d1: ${fazCartas ? "catálogo mudou" : "catálogo igual"} · ${fazPrecos ? "preços mudaram" : "preços iguais"} · orçamento ${ORCAMENTO} linhas/dia, ${gasto} já gastas hoje.`);

let lock = false;
try { lock = pegaLock(); }
catch (e) { console.log(`deploy-d1: não consegui pegar o lock — NÃO vou escrever (${textoErro(e).slice(0, 200)}).`); process.exit(0); }
if (!lock) {
  console.log("deploy-d1: outro deploy está escrevendo no banco agora — este pula (o próximo push confere de novo).");
  process.exit(0);
}
try {
  // Esquema anterior (ou banco novo): a carga total, uma última vez, por tabela.
  const totalCartas = fazCartas && meta.get("esquema") !== ESQUEMA;
  const totalPrecos = fazPrecos && meta.get("esquemaPrecos") !== ESQUEMA;
  if (totalCartas) cargaTotal("catálogo", catalogo);
  if (totalPrecos) cargaTotal("preços", precos);
  if ((fazCartas && !totalCartas) || (fazPrecos && !totalPrecos)) {
    await cargaIncremental(fazCartas && !totalCartas, fazPrecos && !totalPrecos,
      { catalogo: catalogo && catalogo.local, precos: precos && precos.local });
  }
  console.log(`deploy-d1: ${gasto} linhas escritas hoje (orçamento ${ORCAMENTO}; leituras nesta rodada ${leituras}).`);
} finally {
  soltaLock();
}
