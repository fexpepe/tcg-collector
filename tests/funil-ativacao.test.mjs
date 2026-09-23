// Funil de ativação (item 7): abriu o scanner → leu o código → achou a carta →
// adicionou à coleção, mais o ritmo de cadastro e o atrito do portão de login.
//
// O RISCO que este arquivo existe pra travar não é o funil estar errado — é
// ele MEDIR MENOS QUANTO MAIS A PESSOA USA. O `events_guard` aceita 60 eventos
// por minuto por IP e descarta o resto com `return null`: sem erro, sem 4xx,
// sem nada no log do cliente. Um funil com um evento por carta (abriu/leu/
// achou/adicionou) estoura isso a partir de ~15 cartas/min — ou seja, some
// exatamente a medição de quem abre um booster inteiro, que é a pessoa que o
// funil existe pra enxergar. Por isso os eventos são AGREGADOS: 2 por sessão
// de scanner e 1 por rajada de cadastro, com os números em `props`.
//
// A paridade dos NOMES com a whitelist do banco já é travada pelo
// tests/eventos-produto.test.mjs — aqui é o orçamento e o comportamento.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");
const shared = ler("src/shared.js");
const scan = ler("src/scan.js");

// O limite como o BANCO o define — lido da migração, não copiado à mão.
function limitePorMinuto() {
  const dir = join(raiz, "supabase", "migrations");
  const arqs = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const define = arqs.filter((f) => /create or replace function public\.events_guard\(\)/.test(ler(join("supabase/migrations", f))));
  const sql = ler(join("supabase/migrations", define[define.length - 1]));
  const m = /_rate_ok\('events',\s*(\d+)\)/.exec(sql);
  assert.ok(m, "não achei o _rate_ok('events', N) na migração do events_guard");
  return Number(m[1]);
}

test("ORÇAMENTO: escanear e cadastrar em lote não pode estourar o teto do banco", () => {
  const teto = limitePorMinuto();

  // Pior caso realista de uma sessão de scanner: a pessoa passa cartas o mais
  // rápido que o OCR aguenta por um minuto inteiro, adicionando cada uma.
  const CARTAS_POR_MIN = 30;   // ~2s por carta, acima do que a fase 1 entrega

  // Desenho ANTIGO (um evento por carta), pra mostrar por que ele foi descartado.
  const porCarta = 1 /* scan_open */ + CARTAS_POR_MIN * 3 /* leu + achou + add */;
  assert.ok(porCarta > teto,
    "se o desenho por carta coubesse no teto, o resumo agregado não precisaria existir — reveja este teste");

  // Desenho ATUAL: scan_open na abertura, scan_done no fechamento, e uma
  // rajada de cadastro fechada por silêncio (no máximo ~3 por minuto, porque a
  // rajada só fecha após RAJADA_MS de pausa).
  const rajadaMs = Number(/const RAJADA_MS = (\d+)/.exec(shared)[1]);
  const rajadasPorMin = Math.ceil(60000 / rajadaMs);
  const agregado = 1 /* scan_open */ + 1 /* scan_done */ + rajadasPorMin + 1 /* collection_first */;
  assert.ok(agregado <= teto,
    `o desenho agregado manda ${agregado} eventos/min e o banco aceita ${teto} — passaria a descartar calado`);
  // e com folga de sobra pros pageviews da mesma navegação
  assert.ok(agregado < teto / 3, `folga pequena demais: ${agregado} de ${teto}`);
});

test("o scanner manda UM resumo, não um evento por leitura", () => {
  // scan_done tem de ser disparado no fechar, e não dentro do laço de leitura.
  assert.match(scan, /function fechar\(\)\s*\{[\s\S]{0,400}?logEvento\("scan_done"/,
    "o scan_done não está no fechar() — se estiver por leitura, estoura o teto do banco");
  const porLeitura = /function entregar\([\s\S]{0,600}?logEvento\(/.exec(scan);
  assert.equal(porLeitura, null, "entregar() está mandando evento por leitura; ele só deve CONTAR");
  // os contadores existem e são somados em entregar()
  assert.match(scan, /funil\.n \+= 1/);
  assert.match(scan, /if \(codigo\) funil\.lido \+= 1/);
  assert.match(scan, /if \(achados\.length\) funil\.achou \+= 1/);
});

test("o resumo do scanner carrega o funil inteiro em props", () => {
  const m = /logEvento\("scan_done",\s*\{([\s\S]{0,240}?)\}\)/.exec(scan);
  assert.ok(m, "não achei o payload do scan_done");
  for (const campo of ["n", "lido", "achou", "add", "ms"]) {
    assert.match(m[1], new RegExp(`\\b${campo}:`), `o scan_done não manda "${campo}" — o passo some do funil`);
  }
});

test("a rajada de cadastro fecha por silêncio E quando a aba some", () => {
  assert.match(shared, /setTimeout\(fecharRajada, RAJADA_MS\)/, "a rajada não fecha por silêncio");
  assert.match(shared, /addEventListener\("pagehide", fecharRajada\)/,
    "sem pagehide a última rajada — a que a pessoa fez antes de sair — nunca vira evento");
  assert.match(shared, /visibilitychange[\s\S]{0,120}fecharRajada/,
    "no iOS o pagehide nem sempre vem; o visibilitychange é a rede de segurança");
  // e o payload tem o que faz a métrica de ritmo
  const m = /logEvento\("card_added",\s*\{([\s\S]{0,160}?)\}\)/.exec(shared);
  assert.ok(m, "não achei o payload do card_added");
  for (const campo of ["via", "n", "ms"]) {
    assert.match(m[1], new RegExp(`\\b${campo}:`), `sem "${campo}" não dá pra medir cartas por minuto`);
  }
});

test("conta CARTA NOVA, não cópia a mais", () => {
  // O gancho tem de estar no passouATer (carta que não existia passou a
  // existir), não no add() cru — senão "adicionei a 2ª cópia" vira cadastro.
  assert.match(shared, /function passouATer\(cardId\)\s*\{[\s\S]{0,600}?marcarCadastro\(\)/,
    "o marcarCadastro não está no passouATer");
  assert.match(shared, /function passouATer\(cardId\)\s*\{[\s\S]{0,600}?marcarPrimeiraCarta\(\)/);
});

test("a ativação é uma vez por navegador, e sem localStorage não vira evento", () => {
  const m = /function marcarPrimeiraCarta\(\)\s*\{([\s\S]{0,500}?)\n  \}/.exec(shared);
  assert.ok(m, "não achei marcarPrimeiraCarta");
  assert.match(m[1], /getItem\(ATIVADO_KEY\)/, "sem checar a marca, dispararia a cada carta");
  assert.match(m[1], /catch \(e\) \{ return;/,
    "sem localStorage não dá pra garantir 'uma vez só' — tem de desistir, não disparar sempre");
  // a gravação vem ANTES do evento: se gravar depois, duas cartas na mesma
  // sessão disparariam dois eventos.
  assert.ok(m[1].indexOf("setItem") < m[1].indexOf('logEvento("collection_first")'));
});

test("o portão de login é medido antes do replace, senão o beacon morre", () => {
  const m = /logEvento\("login_gate"[\s\S]{0,120}?window\.location\.replace\("login"\)/.exec(shared);
  assert.ok(m, "o login_gate tem de ser disparado ANTES do replace('login')");
  assert.match(shared, /keepalive: true/, "o mandaEvento precisa de keepalive pro beacon sobreviver à navegação");
});

test("a origem do cadastro é uma lista fechada e volta pra 'ui'", () => {
  assert.match(shared, /const ORIGENS = \["ui", "scan", "csv", "lista"\]/);
  assert.match(shared, /ORIGENS\.indexOf\(via\) >= 0 \? via : "ui"/,
    "origem desconhecida tem de virar 'ui', não entrar crua no props");
  assert.match(scan, /setOrigemCadastro\("scan"\)/);
  assert.match(scan, /function fechar\(\)[\s\S]{0,400}?setOrigemCadastro\("ui"\)/,
    "sem voltar pra 'ui' no fechar, todo cadastro seguinte seria contado como scanner");
});

test("TODO caminho declarado em ORIGENS está de fato ligado no código", () => {
  // Declarar "csv" e "lista" sem ligar os dois faria essas cartas serem
  // contadas como "ui" — e a tabela "ritmo por caminho" mentiria sem que
  // nenhum teste reclamasse. Cada origem declarada tem de existir como chamada.
  const importador = ler("src/backup-import.js");
  const todo = shared + scan + importador;
  const origens = /const ORIGENS = \[([^\]]+)\]/.exec(shared)[1]
    .split(",").map((x) => x.trim().replace(/"/g, ""));
  assert.deepEqual(origens, ["ui", "scan", "csv", "lista"]);
  for (const via of origens) {
    const n = todo.split(`setOrigemCadastro("${via}")`).length - 1;
    assert.ok(n >= 1, `a origem "${via}" está declarada mas nunca é usada — as cartas dela cairiam em "ui"`);
  }
  // e toda origem usada tem de estar declarada
  for (const m of todo.matchAll(/setOrigemCadastro\("([a-z]+)"\)/g)) {
    assert.ok(origens.indexOf(m[1]) >= 0, `"${m[1]}" é usada mas não está em ORIGENS — vira "ui" calado`);
  }
});

test("quem muda a origem devolve pra 'ui' no mesmo bloco", () => {
  // Origem que não volta contamina todo cadastro seguinte da sessão.
  const importador = ler("src/backup-import.js");
  for (const [arquivo, txt] of [["scan.js", scan], ["shared.js", shared], ["backup-import.js", importador]]) {
    const abre = (txt.match(/setOrigemCadastro\("(?:scan|csv|lista)"\)/g) || []).length;
    const fecha = (txt.match(/setOrigemCadastro\("ui"\)/g) || []).length;
    assert.equal(abre, fecha, `${arquivo}: ${abre} troca(s) de origem e ${fecha} volta(s) pra "ui"`);
  }
});

test("a RPC do painel existe, é só de admin e não derruba a admin_dashboard", () => {
  const sql = ler("supabase/migrations/20260919a_funil_ativacao.sql");
  assert.match(sql, /create or replace function public\.admin_funnel\(days int default 30\)/);
  assert.match(sql, /is_admin/, "a RPC tem de ser gated por admin");
  assert.match(sql, /revoke all on function public\.admin_funnel\(int\) from public, anon/);
  assert.doesNotMatch(sql, /create or replace function public\.admin_dashboard/,
    "esta migração não pode reescrever a admin_dashboard — é aditiva de propósito");
  // cast defensivo: props vem do cliente
  assert.match(sql, /~ '\^\[0-9\]\{1,7\}\$'/, "props sem cast defensivo derruba a query com dado do cliente");
});

test("o painel avisa quando a migração está pendente, em vez de mostrar zero", () => {
  const admin = ler("src/admin.js");
  // Desde o v2 (20260923a) o aviso é um só, gerado por aba a partir das RPCs
  // que ela usa (NEEDS) — então o que se trava é o gerador: nomeia a RPC que
  // falta e a aba do funil depende da admin_funnel.
  assert.match(admin, /A RPC <code>\$\{esc\(r\)\}<\/code> ainda não existe no banco/,
    "sem o aviso, o funil pendente parece 'ninguém usa o scanner'");
  assert.match(admin, /k === "funnel" \? "admin_funnel"/, "o aviso tem de nomear a admin_funnel");
  assert.match(admin, /funil: \["funnel"/, "a aba Funil tem de depender da admin_funnel");
  assert.match(admin, /20260919a_funil_ativacao\.sql/, "o aviso tem de dizer QUAL migração aplicar");
  assert.match(shared, /rpc\/admin_funnel[\s\S]{0,300}?status === 404\) return undefined/,
    "404 tem de virar undefined, que é como o painel distingue 'pendente' de 'sem acesso'");
});
