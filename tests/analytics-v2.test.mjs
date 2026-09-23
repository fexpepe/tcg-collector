// Analytics v2 (migração 20260923a): clique de saída pra loja, conta nova,
// busca sem resultado, link compartilhado aberto e app instalado, mais o /admin
// em grupos com tabelas paginadas.
//
// O que se trava aqui:
//   - o link da loja carrega o que o store_click precisa (data-mkt + o
//     container com jogo/carta) e só as lojas BR ganham utm — um refactor do
//     marketplaceRow que perca o data-mkt zera a medição sem erro nenhum;
//   - os cinco eventos novos são DISPARADOS em algum lugar (a paridade com a
//     whitelist do banco é o tests/eventos-produto.test.mjs);
//   - as RPCs novas são só de admin e não ficam abertas pro anon;
//   - toda aba do painel sabe de quais RPCs depende;
//   - os helpers puros do painel (página, CSV, série mensal).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");
const shared = ler("src/shared.js");
const scan = ler("src/scan.js");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20260923a_analytics_v2.sql");

const api = loadShared("window.__test = { brMarketplaceLinks };").window.__test;

test("links de loja: data-mkt no link e jogo/carta no container", () => {
  const card = { id: "sv1-25", name: "Pikachu", number: "25", setTotal: 198, game: "pokemon" };
  const html = api.brMarketplaceLinks(card, "PSA 9");
  assert.match(html, /<div class="market-links" data-mkt-game="pokemon" data-mkt-card="sv1-25" data-mkt-gr="1">/);
  for (const k of ["liga", "ligabra", "myp", "ebay", "tcgplayer", "pricecharting"]) {
    assert.match(html, new RegExp(`data-mkt="${k}"`), `o link ${k} perdeu o data-mkt — clique nele não seria medido`);
  }
  // sem graduada, sem o flag
  assert.doesNotMatch(api.brMarketplaceLinks(card), /data-mkt-gr/);
});

test("utm_source=sleevu só nas lojas brasileiras", () => {
  const card = { id: "sv1-25", name: "Pikachu", number: "25", setTotal: 198, game: "pokemon" };
  const hrefs = {};
  for (const m of api.brMarketplaceLinks(card).matchAll(/data-mkt="([a-z]+)" href="([^"]+)"/g)) hrefs[m[1]] = m[2].replace(/&amp;/g, "&");
  for (const k of ["liga", "ligabra", "myp"]) {
    assert.ok(hrefs[k].endsWith("utm_source=sleevu&utm_medium=referral"), `${k}: ${hrefs[k]}`);
    // a busca continua intacta antes do utm
    assert.equal((hrefs[k].match(/\?/g) || []).length, 1, `${k} ficou com dois "?": ${hrefs[k]}`);
  }
  for (const k of ["ebay", "tcgplayer", "pricecharting"]) {
    assert.doesNotMatch(hrefs[k], /utm_/, `${k} não deveria levar utm`);
  }
});

test("store_click é delegado no document (sobrevive ao re-render do preview) e conta o clique do meio", () => {
  const m = /function initStoreClicks\(\) \{([\s\S]*?)\n  \}\n/.exec(shared);
  assert.ok(m, "initStoreClicks sumiu");
  assert.match(m[1], /document\.addEventListener\("click", registra, true\)/);
  assert.match(m[1], /document\.addEventListener\("auxclick", registra, true\)/);
  assert.match(m[1], /logEvento\("store_click"/);
  assert.match(shared, /logPageview\(\);[^\n]*\n\s*initStoreClicks\(\);/, "initStoreClicks não é chamado no boot");
});

test("os cinco eventos novos são disparados", () => {
  const todo = shared + scan;
  for (const nome of ["store_click", "signup", "search_empty", "share_open", "pwa_install"]) {
    assert.match(todo, new RegExp(`logEvento\\("${nome}"`), `${nome} está na whitelist mas ninguém dispara`);
  }
  // signup sai do único ponto por onde todo login passa
  assert.match(shared, /rememberAccount\(user\);\s*\n\s*marcarSignup\(user\);/);
});

test("busca vazia: espera parar de digitar, uma vez por termo, sem e-mail/telefone", () => {
  const m = /function talvezBuscaVazia\(q\) \{([\s\S]*?)\n    \}\n/.exec(shared);
  assert.ok(m, "talvezBuscaVazia sumiu");
  assert.match(m[1], /setTimeout\([\s\S]*?, 1500\)/, "sem espera, cada letra digitada vira um termo");
  assert.match(m[1], /sessionStorage/, "sem trava por termo, o mesmo termo conta várias vezes");
  assert.match(m[1], /\/@\|\\d\{5,\}\//, "e-mail/telefone colado na busca não pode virar dado");
  assert.match(m[1], /slice\(0, 40\)/);
});

test("scanner manda o tempo até a 1ª carta no resumo", () => {
  assert.match(scan, /logEvento\("scan_done",\s*\{[\s\S]{0,240}?\bt1:/);
  assert.match(scan, /if \(!funil\.t1\) funil\.t1 =/);
});

test("pageview leva app instalado e utm, cortados e só com caracteres seguros", () => {
  const m = /function contextoPageview\(\) \{([\s\S]*?)\n  \}\n/.exec(shared);
  assert.ok(m);
  assert.match(m[1], /isStandalonePWA\(\)\) p\.s = 1/);
  assert.match(m[1], /replace\(\/\[\^a-z0-9_\.-\]\/g, ""\)\.slice\(0, 30\)/);
});

test("RPCs novas: só admin, sem execução pro anon", () => {
  for (const fn of ["admin_stores", "admin_retention", "admin_demand", "admin_growth"]) {
    const corpo = new RegExp(`create or replace function public\\.${fn}\\(days int default 30\\)[\\s\\S]*?if not _is_admin\\(\\) then return null; end if;`);
    assert.match(sql, corpo, `${fn} não checa admin logo no começo`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(int\\) from public, anon;`));
  }
  // snapshot e helper não são chamáveis pela API
  assert.match(sql, /revoke all on function public\.metrics_snapshot\(date\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\._is_admin\(\) from public, anon, authenticated;/);
  // tabelas novas fechadas
  for (const t of ["card_views_daily", "metrics_daily"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated;`));
  }
});

test("admin_funnel recriada mantém as chaves de antes", () => {
  const m = /create or replace function public\.admin_funnel[\s\S]*?end \$\$;/.exec(sql);
  assert.ok(m);
  for (const k of ["'scan'", "'cadastro'", "'ativados'", "'gate'", "'gate_pessoas'", "'gate_paginas'"]) {
    assert.ok(m[0].includes(k), `a admin_funnel nova perdeu ${k}`);
  }
});

// ── Painel ──────────────────────────────────────────────────────────────────
function carregaAdmin() {
  const window = { document: { getElementById: () => null }, location: { hash: "" } };
  const sandbox = { window, document: window.document, location: window.location, history: {}, console };
  vm.runInNewContext(admin, sandbox);
  return sandbox.window.TCGAdminCharts;
}
const C = carregaAdmin();

test("toda aba de todo grupo tem renderizador e sabe de quais RPCs depende", () => {
  const grupos = /const GROUPS = \[([\s\S]*?)\n  \];/.exec(admin)[1];
  const abas = [...grupos.matchAll(/\["([a-z]+)", "[^"]+"\]/g)].map((m) => m[1]);
  assert.ok(abas.length >= 12, `esperava 12+ abas, achei ${abas.length}`);
  const needs = /const NEEDS = \{([\s\S]*?)\n  \};/.exec(admin)[1];
  const render = /const RENDER = \{([\s\S]*?)\n  \};/.exec(admin)[1];
  for (const a of abas) {
    assert.match(needs, new RegExp(`\\b${a}: \\[`), `aba ${a} sem NEEDS — abriria sem dados`);
    assert.match(render, new RegExp(`\\b${a}: \\(x\\) =>`), `aba ${a} sem RENDER`);
  }
});

test("pageSlice: página sempre dentro do intervalo", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(C.pageSlice(rows, 1, 10).rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ult = C.pageSlice(rows, 3, 10);
  assert.deepEqual([ult.from, ult.to, ult.pages, ult.rows.length], [21, 23, 3, 3]);
  assert.equal(C.pageSlice(rows, 99, 10).page, 3, "página maior que o total volta pra última");
  assert.equal(C.pageSlice(rows, 0, 10).page, 1);
  const vazio = C.pageSlice([], 2, 10);
  assert.deepEqual([vazio.page, vazio.pages, vazio.from, vazio.total], [1, 1, 0, 0]);
});

test("toCsv: ; e aspas escapados, BOM pro Excel", () => {
  const csv = C.toCsv([{ a: 'Pikachu; "V"', b: 3 }, { a: "x\ny", b: null }], [{ t: "Carta", k: "a" }, { t: "N", k: (r) => r.b }]);
  assert.ok(csv.startsWith("﻿Carta;N\r\n"));
  assert.ok(csv.includes('"Pikachu; ""V""";3'));
  assert.ok(csv.includes('"x\ny";'));
});

test("monthly: estoque é o último dia do mês, fluxo soma, crescimento contra o mês anterior", () => {
  const serie = [
    { day: "2026-08-30", mau: 90, contas: 10, ativacoes: 2, cliques_loja: 1 },
    { day: "2026-08-31", mau: 100, contas: 11, ativacoes: 3, cliques_loja: 0 },
    { day: "2026-09-01", mau: 105, contas: 11, ativacoes: 1 },
    { day: "2026-09-02", mau: 120, contas: 12, ativacoes: 4, colecionadores: 7 }
  ];
  const m = C.monthly(serie);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].mes, m[0].mau, m[0].contas, m[0].ativacoes, m[0].cliques_loja], ["2026-08", 100, 11, 5, 1]);
  assert.deepEqual([m[1].mau, m[1].ativacoes, m[1].colecionadores], [120, 5, 7]);
  assert.equal(m[0].cresc_mau, null);
  assert.ok(Math.abs(m[1].cresc_mau - 0.2) < 1e-9);
});
