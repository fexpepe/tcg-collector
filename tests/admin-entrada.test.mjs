// Entrada do /admin (2026-10-31). O painel abria em "Acesso restrito" na conta
// de admin e só aparecia depois de vários F5: toda falha da RPC do portão —
// tempo esgotado do banco com o cache frio (57014, HTTP 500), token recusado
// (401), rede — virava o mesmo null de "não é admin".
//
// O que se trava aqui:
//   - adminChamada (shared.js) devolve o status e o motivo do PostgREST, renova
//     o token no 401 e tenta UMA vez de novo, e não chama RPC fora do painel
//     com o token da conta;
//   - adminRpc mantém o contrato de sempre (undefined = 404, null = falha);
//   - comFolga (admin.js) repete a LEITURA no 5xx/429/rede, até 3 vezes, e não
//     repete o que tentar de novo não muda (4xx, 200 com null); escrita não
//     passa por ela;
//   - barrado diz por que o painel não abriu, e só o 200-com-null é "não é
//     admin";
//   - a 20261031a dá 30 s às admin_* sem lista feita à mão.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").split(String.fromCharCode(13)).join("");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261031a_admin_tempo_limite.sql");
const leiaMe = ler("supabase/migrations/README.md");
// Objeto que nasceu no sandbox tem outro Object.prototype: compara por valor.
const plano = (x) => JSON.parse(JSON.stringify(x));

// ── shared.js: a porta logada ───────────────────────────────────────────────
const SESSAO = "tcg-supabase-session-v1";
const conta = { access_token: "velho", refresh_token: "r1", user: { id: "u1", email: "a@b.c" }, ts: Date.now() };
function porta(respostas, sessao = conta) {
  const ls = makeLocalStorage(sessao ? { [SESSAO]: JSON.stringify(sessao) } : {});
  const sb = loadShared("", { localStorage: ls });
  const pedidos = [];
  // Só as RPCs e o refresh entram na conta: o boot do shared.js pode pedir
  // outras coisas no sandbox, e essas continuam "offline".
  sb.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (u.indexOf("/rest/v1/rpc/") < 0 && u.indexOf("/auth/v1/token") < 0) return { ok: false, status: 599, json: async () => null };
    pedidos.push({ url: u, auth: opt.headers && opt.headers.Authorization, body: opt.body });
    const r = respostas.shift();
    if (!r) throw new Error(`pedido a mais: ${u}`);
    if (r === "rede") throw new TypeError("Failed to fetch");
    return {
      ok: r.st >= 200 && r.st < 300, status: r.st,
      json: async () => { if (r.corpo === undefined) throw new SyntaxError("corpo vazio"); return r.corpo; }
    };
  };
  return { S: sb.TCGShared, pedidos, ls };
}

test("401: renova a sessão e repete a RPC UMA vez com o token novo", async () => {
  const { S, pedidos, ls } = porta([
    { st: 401, corpo: { code: "PGRST301", message: "JWT expired" } },
    { st: 200, corpo: { access_token: "novo", refresh_token: "r2", user: { id: "u1", email: "a@b.c" } } },
    { st: 200, corpo: { days: 30 } }
  ]);
  const r = await S.adminChamada("admin_dashboard", { days: 30 });
  assert.deepEqual(plano(r), { st: 200, v: { days: 30 } });
  assert.equal(pedidos.length, 3);
  assert.ok(pedidos[0].url.endsWith("/rest/v1/rpc/admin_dashboard"));
  assert.equal(pedidos[0].auth, "Bearer velho");
  assert.ok(pedidos[1].url.indexOf("grant_type=refresh_token") > 0, "o 2º pedido é o refresh");
  assert.equal(pedidos[2].auth, "Bearer novo", "a repetição vai com o token renovado");
  assert.equal(JSON.parse(ls.getItem(SESSAO)).access_token, "novo", "a sessão renovada fica guardada");
});

test("401 que o refresh não resolve: devolve 401, sem laço", async () => {
  const { S, pedidos } = porta([
    { st: 401, corpo: { code: "PGRST301", message: "JWT expired" } },
    { st: 400, corpo: { error: "invalid_grant" } }
  ]);
  const r = await S.adminChamada("admin_dashboard", { days: 30 });
  assert.equal(r.st, 401);
  assert.equal(pedidos.length, 2, "refresh recusado = não repete a RPC");
});

test("tempo esgotado: o motivo do PostgREST chega ao painel, e adminRpc segue null", async () => {
  const motivo = { code: "57014", message: "canceling statement due to statement timeout" };
  const { S, pedidos } = porta([{ st: 500, corpo: motivo }, { st: 500, corpo: motivo }]);
  assert.deepEqual(plano(await S.adminChamada("admin_dashboard", { days: 30 })), { st: 500, code: "57014", msg: motivo.message });
  assert.equal(pedidos.length, 1, "o shared.js não repete o 5xx (quem decide é o painel, que só repete leitura)");
  assert.equal(await S.adminRpc("admin_dashboard", 30), null);
});

test("adminRpc: contrato de sempre (undefined = 404, null = sem acesso ou falha)", async () => {
  const { S, pedidos } = porta([
    { st: 404, corpo: { code: "PGRST202" } },
    { st: 200, corpo: null },
    { st: 200, corpo: { a: 1 } },
    { st: 204 },
    { st: 502 }
  ]);
  assert.equal(await S.adminRpc("admin_funnel", 7), undefined, "404 = migração pendente");
  assert.equal(await S.adminRpc("admin_funnel", 7), null, "200 com null = conta sem is_admin");
  assert.deepEqual(plano(await S.adminRpc("apoio_status", 0, {})), { a: 1 });
  assert.equal(await S.adminRpc("admin_nota_delete", 0, { p_id: 1 }), null, "204 sem corpo");
  assert.equal(await S.adminRpc("admin_funnel", 7), null, "502 do gateway, corpo não-JSON");
  assert.equal(pedidos[0].body, JSON.stringify({ days: 7 }), "sem body vai { days }");
  assert.equal(pedidos[2].body, "{}", "body próprio vai como veio");
});

test("sem sessão, sem rede e nome fora do painel", async () => {
  const sem = porta([], null);
  assert.deepEqual(plano(await sem.S.adminChamada("admin_dashboard", { days: 30 })), { st: 0, code: "sessao" });
  assert.equal(sem.pedidos.length, 0);

  const rede = porta(["rede"]);
  const r = await rede.S.adminChamada("admin_dashboard", { days: 30 });
  assert.equal(r.st, 0);
  assert.equal(r.code, "rede");

  // A porta leva o token da conta: delete_account (que existe no banco) não
  // pode ser chamada por ela.
  const fora = porta([]);
  assert.equal((await fora.S.adminChamada("delete_account", {})).code, "nome");
  assert.equal(await fora.S.adminRpc("delete_account", 0, {}), null);
  for (const nome of ["error_summary", "analytics_summary"]) {
    const p = porta([{ st: 200, corpo: [] }]);
    assert.equal((await p.S.adminChamada(nome, { days: 7 })).st, 200, `${nome} é do painel`);
  }
});

// ── admin.js: folga e barrado ───────────────────────────────────────────────
// Recorta do arquivo o trecho de TENTATIVAS até o MIGRACAO e roda com stubs
// (o resto da página depende do DOM).
function painel(respostas) {
  const i = admin.indexOf("  const TENTATIVAS = 3;");
  const j = admin.indexOf("  const MIGRACAO = {");
  assert.ok(i > 0 && j > i, "sumiu o trecho TENTATIVAS…MIGRACAO do admin.js");
  const chamadas = [], esperas = [];
  const ctx = {
    shared: { adminChamada: async (nome) => { chamadas.push(nome); return respostas.shift(); } },
    document: { getElementById: () => null },
    root: { querySelector: () => null },
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    setTimeout: (fn, ms) => { esperas.push(ms); fn(); }
  };
  vm.runInNewContext(`${admin.slice(i, j)}\nthis.api = { comFolga, motivo, barrado };`, ctx);
  return { ...ctx.api, chamadas, esperas };
}
const t57014 = { st: 500, code: "57014", msg: "canceling statement due to statement timeout" };

test("folga: tempo esgotado tenta de novo e a 3ª responde", async () => {
  const p = painel([t57014, t57014, { st: 200, v: { days: 30 } }]);
  const r = await p.comFolga("admin_dashboard", { days: 30 });
  assert.equal(r.st, 200);
  assert.equal(p.chamadas.length, 3);
  assert.deepEqual(p.esperas, [1500, 3000], "espera crescente entre as tentativas");
});

test("folga: desiste na 3ª e não repete o que não é passageiro", async () => {
  const tres = painel([t57014, t57014, t57014, { st: 200, v: {} }]);
  assert.equal((await tres.comFolga("admin_pulso", {})).code, "57014");
  assert.equal(tres.chamadas.length, 3, "3 tentativas, não 4");

  for (const r of [{ st: 200, v: null }, { st: 403, code: "42501" }, { st: 404 }, { st: 401 }, { st: 0, code: "sessao" }]) {
    const p = painel([r, { st: 200, v: {} }]);
    await p.comFolga("admin_dashboard", {});
    assert.equal(p.chamadas.length, 1, `${JSON.stringify(r)} não se resolve tentando de novo`);
  }
  for (const r of [{ st: 0, code: "rede" }, { st: 429 }, { st: 503 }]) {
    const p = painel([r, { st: 200, v: {} }]);
    assert.equal((await p.comFolga("admin_dashboard", {})).st, 200, `${JSON.stringify(r)} é passageiro`);
  }
});

test("escrita do painel NÃO passa pela folga (repetir POST duplicaria custo e link)", () => {
  const i = admin.indexOf("async function escreve(");
  const corpo = admin.slice(i, admin.indexOf("\n  }\n", i));
  assert.ok(corpo.indexOf("shared.adminRpc(nome, 0, body)") > 0);
  assert.equal(corpo.indexOf("comFolga"), -1);
  const portal = admin.indexOf("shared.adminRpc(\"admin_partner_link_create\"");
  assert.ok(portal > 0, "o link de loja é criado direto, uma vez");
  // A saúde vem com toda aba: falha dela não pode segurar a aba em 3 tentativas.
  assert.ok(admin.indexOf("key === \"health\" ? shared.adminChamada(rpcDe(key), body) : comFolga(rpcDe(key), body)") > 0);
});

test("barrado: cada motivo tem a sua frase; só o 200-com-null é 'não é admin'", () => {
  const { barrado } = painel([]);
  const semSessao = barrado({ st: 0, code: "sessao" });
  assert.ok(semSessao.indexOf("entre</a> com a conta de admin") > 0 && semSessao.indexOf("data-entrar") > 0);
  assert.ok(barrado({ st: 200, v: null }).indexOf("esta conta não é a de admin") > 0);
  assert.ok(barrado({ st: 401 }).indexOf("A sessão expirou") > 0);
  const tempo = barrado(t57014);
  assert.equal(tempo.indexOf("Acesso restrito"), -1, "tempo esgotado não é falta de acesso");
  assert.ok(tempo.indexOf("tempo-limite") > 0 && tempo.indexOf("data-retry") > 0, "diz o motivo e oferece de novo");
  const gw = barrado({ st: 502, code: "", msg: "" });
  assert.ok(gw.indexOf("HTTP 502") > 0 && gw.indexOf("data-retry") > 0);
  assert.ok(barrado({ st: 500, code: "XX000", msg: "<b>x</b>" }).indexOf("<b>") < 0, "a mensagem do banco é escapada");
});

test("o portão usa o barrado, e o Resumo distingue pulso pendente de pulso que falhou", () => {
  const i = admin.indexOf("// 1ª pintura:");
  const portao = admin.slice(i, admin.indexOf("let quadro = 0;", i));
  assert.equal((portao.match(/barrado\(state\.falha\.dash\)/g) || []).length, 2);
  assert.equal(portao.indexOf("Acesso restrito"), -1, "a frase fixa saiu do portão");
  assert.ok(admin.indexOf("pu === undefined ? pedeV3(") > 0, "pulso null (falhou) não pode pedir a migração");
  assert.ok(admin.indexOf("${k}: ${motivo(state.falha[k])}") > 0, "aba que falha diz o motivo de cada RPC");
});

// ── 20261031a ───────────────────────────────────────────────────────────────
test("20261031a: 30 s em toda admin_* que existir, sem lista na mão", () => {
  assert.ok(sql.indexOf("left(p.proname, 6) = 'admin_'") > 0, "pega as admin_* pelo nome");
  assert.ok(sql.indexOf("p.proname in ('error_summary', 'analytics_summary')") > 0);
  assert.ok(sql.indexOf("n.nspname = 'public'") > 0, "só o schema public");
  assert.ok(sql.indexOf("alter function %s set statement_timeout = %L', f, '30s'") > 0);
  assert.equal(sql.indexOf("create or replace function"), -1, "é um ajuste: não recria função nenhuma");
  assert.ok(leiaMe.indexOf("`20261031a`") > 0, "o README das migrações lista a 20261031a");
});
