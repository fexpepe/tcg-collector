// /admin: as LINHAS de cada jogo (2026-11-12, migração 20261112b).
//
// O jogo `naruto` junta o Card Game 2002~2006, o Data Carddass, o CCG e o
// Shippuden, e o evento só guardava o jogo: a aba Jogos dava tudo como
// "Naruto". O que se trava aqui:
//   - o cliente: todo evento numa página /games/<url> de jogo com linhas leva
//     props.ln (a chave da linha, "" no principal); fora de /games/ e em jogo
//     sem linhas, nada — o admin conta como "sem linha";
//   - os nomes que o admin mostra pra cada linha são os da página dela
//     (functions/_lib/jogos.js), e toda linha do GAME_LINES tem nome;
//   - o SQL: a admin_jogos nova tem tudo da 20261111g, o portão, os 30 s, uma
//     passada só em events, nenhum cifrão, e o recorte por linha.
// O comportamento do SQL foi ensaiado no PGlite (README das migrações); aqui
// fica a forma, que é o que uma edição futura quebra sem perceber.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { JOGOS_URL } from "../functions/_lib/jogos.js";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261112b_admin_jogos_linhas.sql");
const velha = ler("supabase/migrations/20261111g_admin_jogos.sql");

// ── Cliente ──────────────────────────────────────────────────────────────────
// O shared.js num navegador de mentira em PRODUÇÃO (sleevu.app, medição
// ligada), na página `pathname` do jogo/linha que o game.js teria resolvido.
// Devolve o corpo de cada POST pro /rest/v1/events.
function eventos(pathname, game, line) {
  const enviados = [];
  loadShared("", {
    localStorage: makeLocalStorage({ "sleevu-consent-v1": JSON.stringify({ analytics: true }) }),
    location: { pathname, search: "", hash: "", origin: "https://sleevu.app", hostname: "sleevu.app", href: `https://sleevu.app${pathname}` },
    antes: (sb) => {
      sb.SLEEVU = { game, line };
      sb.document.cookie = ""; // o rodapé lê a sessão do cookie no boot de algumas páginas
      sb.fetch = (url, init) => {
        if (String(url).includes("/rest/v1/events") && init && init.body) enviados.push(JSON.parse(init.body));
        return Promise.resolve({ ok: false, status: 599, json: async () => null, text: async () => "" });
      };
    }
  });
  return enviados;
}
const pageview = (lista) => lista.find((e) => e.name === "pageview");

test("pageview numa página de linha leva a linha (props.ln)", () => {
  const pv = pageview(eventos("/games/naruto-ccg/nrt-ccg-path-of-the-ninja", "naruto", "nrt-ccg"));
  assert.ok(pv, "o pageview saiu");
  assert.equal(pv.game, "naruto");
  assert.equal(pv.path, "detail");
  assert.equal(pv.props.ln, "nrt-ccg");
  assert.equal(pv.props.d, "d", "o resto do contexto continua indo junto");
});

test("o jogo principal de uma marca com linhas leva ln vazio (não 'sem linha')", () => {
  const pv = pageview(eventos("/games/naruto-card-game-2002", "naruto", ""));
  assert.equal(pv.path, "sets");
  assert.ok(Object.prototype.hasOwnProperty.call(pv.props, "ln"), "a chave vai, vazia");
  assert.equal(pv.props.ln, "");
  assert.equal(pageview(eventos("/games/one-piece-card-game-2002", "onepiece", "op2002")).props.ln, "op2002");
  assert.equal(pageview(eventos("/games/one-piece-card-game", "onepiece", "")).props.ln, "");
});

test("fora de /games/ e em jogo sem linhas, nada de ln", () => {
  for (const [p, g] of [["/scan", "naruto"], ["/games/pokemon", "pokemon"], ["/games/naruto-card-game", "narutocg"], ["/collection", "hub"], ["/", "hub"]]) {
    const pv = pageview(eventos(p, g, ""));
    assert.ok(pv, p);
    assert.ok(!pv.props || !Object.prototype.hasOwnProperty.call(pv.props, "ln"), `${p} (${g}) não leva ln`);
  }
});

test("os eventos de produto levam a linha pelo mesmo cano (mandaEvento)", () => {
  const js = ler("src/shared.js");
  const corpo = js.slice(js.indexOf("function mandaEvento("), js.indexOf("function logPageview("));
  assert.ok(corpo.includes("if (GAME_LINES[game] && /^\\/games\\//.test(location.pathname)) (props = props || {}).ln = lineParamOf();"));
  assert.ok(corpo.indexOf(".ln = lineParamOf()") < corpo.indexOf("if (props) corpo.props = props;"), "a linha entra antes de o corpo ser montado");
});

// ── Nomes no admin ──────────────────────────────────────────────────────────
function nomesDoAdmin() {
  const i = admin.indexOf("const NOME_LINHA = {");
  assert.ok(i >= 0, "NOME_LINHA no admin.js");
  const lit = admin.slice(i + "const NOME_LINHA = ".length, admin.indexOf("\n  };", i) + 4);
  return vm.runInNewContext(`(${lit})`);
}

test("o nome de cada linha no admin é o da página dela (jogos.js)", () => {
  const nomes = nomesDoAdmin();
  const comLinhas = new Set(JOGOS_URL.filter((j) => j.linha).map((j) => j.game));
  assert.deepEqual([...comLinhas].sort(), Object.keys(nomes).sort(), "os mesmos jogos com linhas");
  for (const j of JOGOS_URL.filter((x) => comLinhas.has(x.game))) {
    assert.equal(nomes[j.game][j.linha || ""], j.nome, `${j.game} ${j.linha || "(principal)"}`);
  }
  for (const g of Object.keys(nomes)) {
    const doRegistro = JOGOS_URL.filter((j) => j.game === g).map((j) => j.linha || "").sort();
    assert.deepEqual(Object.keys(nomes[g]).sort(), doRegistro, `${g}: nada a mais no admin`);
  }
});

test("toda linha do GAME_LINES tem nome no admin", () => {
  const S = loadShared("");
  const nomes = nomesDoAdmin();
  for (const [g, linhas] of Object.entries(S.TCGShared.GAME_LINES)) {
    for (const l of Object.keys(linhas)) assert.ok(nomes[g] && nomes[g][l], `${g} ${l} sem nome no admin`);
  }
});

test("admin: sub-linhas na tabela Por jogo, aviso sem histórico e nota no Resumo", () => {
  assert.ok(admin.includes("const proprio = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);"), "ln do cliente não acha o protótipo");
  assert.ok(admin.includes('(l === "?" ? "Sem linha registrada"'));
  assert.ok(admin.includes("const temLinhas = Array.isArray(jg.linhas);"), "sem a 20261112b, aviso em vez de sub-linhas");
  assert.ok(admin.includes("${section(\"Por jogo\", avisoLinhas + paged(\"jogos\""), "o aviso fica em cima da tabela");
  assert.ok(admin.includes("Não há histórico de antes: o evento só guardava o jogo."));
  assert.ok(admin.includes("supabase/migrations/20261112b_admin_jogos_linhas.sql"), "o aviso aponta a migração");
  assert.ok(admin.includes("(sub[x.game] || []).map((l, i, ls) => subLinha(x.game, l, i === ls.length - 1)).join(\"\")"), "as linhas vão na MESMA entrada do jogo (paginação)");
  assert.ok(admin.includes("const dL = (a, b) => (cmpL ? ` ${deltaChip(a, b)}` : \"\");"), "sem anterior completo, sem régua");
  assert.ok(admin.includes("barrasMov(vis, jogoNome, jogoCor) + porLinha(vis, \"visitantes\")"), "Resumo: visitantes por linha");
  const css = ler("styles.css");
  assert.ok(css.includes(".admin-table tr.adm-sub td:first-child { padding-left: 18px; }"));
});

// ── SQL ──────────────────────────────────────────────────────────────────────
const corpo = (texto, nome) => {
  const i = texto.indexOf(`create or replace function public.${nome}(`);
  assert.ok(i >= 0, nome);
  return texto.slice(i, texto.indexOf("end $$;", i));
};

test("admin_jogos 20261112b: portão, fechada pro anon, 30 s, só a janela, sem cifrão", () => {
  const f = corpo(sql, "admin_jogos");
  assert.ok(f.includes("if not _is_admin() then return null; end if;"));
  assert.ok(f.includes("set statement_timeout = '30s'"));
  assert.ok(f.includes("where not bot and ts >= ant"));
  assert.equal(f.split("from events").length - 1, 1, "uma passada só na tabela de eventos");
  assert.ok(f.includes("from card_views_daily where day >= ini_d - d"));
  assert.ok(sql.includes("revoke all on function public.admin_jogos(int) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.admin_jogos(int) to authenticated;"));
  assert.ok(!sql.replace(/^--.*$/gm, "").split("$$").join("").includes("$"), "nenhum cifrão dentro de corpo de função");
  assert.ok(f.includes("'migration', '20261112b'"));
});

test("admin_jogos 20261112b: tudo o que a 20261111g devolvia continua lá", () => {
  const v = corpo(velha, "admin_jogos"), f = corpo(sql, "admin_jogos");
  const chaves = (t) => [...t.matchAll(/^\s+'([a-z_]+)', /gm)].map((m) => m[1]);
  for (const k of chaves(v)) assert.ok(chaves(f).includes(k), `chave ${k}`);
  for (const cte of ["vis", "fez", "interagiu", "por", "tempo", "abertas", "jogos", "linhas", "totais", "vias", "topo_v", "topo_c", "serie_v", "serie_c"]) {
    const re = new RegExp(`\\n  ${cte} as \\(([\\s\\S]*?)\\n  \\)`);
    const a = re.exec(v), b = re.exec(f);
    assert.ok(a && b, `CTE ${cte}`);
    assert.equal(b[1], a[1], `CTE ${cte} igual à da 20261111g`);
  }
  assert.ok(f.includes("when name = 'store_click' and coalesce(props->>'g', '') <> '' then left(props->>'g', 32)"));
  assert.ok(f.includes("else coalesce(nullif(game, ''), 'hub') end as jogo"));
});

test("admin_jogos 20261112b: o recorte por linha", () => {
  const f = corpo(sql, "admin_jogos");
  assert.ok(f.includes("case when props->>'ln' is not null and (name <> 'store_click' or jogo = coalesce(nullif(game, ''), 'hub'))"), "clique em loja só leva linha se a carta é do jogo da página");
  assert.ok(f.includes("then left(props->>'ln', 16) end as linha"));
  assert.ok(f.includes("select jogo, coalesce(linha, '?') as ln, jan, name, anon, props"), "sem ln = '?'");
  assert.ok(f.includes("where jan is not null and jogo in (select distinct jogo from ev where linha is not null)"), "só os jogos com alguma linha");
  for (const k of ["'linhas'", "'linhas_desde'", "'linhas_comparavel'"]) assert.ok(f.includes(k), k);
  assert.ok(f.includes("coalesce(x.desde < ant + interval '36 hours', false)"), "a mesma régua de comparável do país");
});
