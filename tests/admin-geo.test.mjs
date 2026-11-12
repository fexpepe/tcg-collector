// /admin v4 (2026-11-10, migração 20261110a): de onde vêm os visitantes.
//
// O que se trava aqui:
//   - o mapa pinta o país certo na faixa certa, e as faixas não deixam o
//     Brasil apagar o resto do mundo (nem inventam 5 faixas pra 5 visitantes);
//   - o arquivo do contorno (src/admin-mundo.js, gerado) tem a forma que o
//     mapaMundo espera e é carregado ANTES do admin.js;
//   - o SQL: o guard é o da 20261009a mais o país (nenhum nome de evento
//     sumiu, o `co` do cliente não entra, o app das lojas fica sem país), e a
//     admin_geo tem portão, é fechada pro anon e nasce com os 30 s.
// O comportamento do SQL foi ensaiado no PGlite (README das migrações); aqui
// fica a forma, que é o que uma edição futura quebra sem perceber.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261110a_admin_geo.sql");
const v3 = ler("supabase/migrations/20261009a_admin_v3.sql");

function roda(fonte) {
  const window = { document: { getElementById: () => null }, location: { hash: "" } };
  vm.runInNewContext(fonte, { window, document: window.document, location: window.location, history: {}, console, Intl });
  return window;
}
const C = roda(admin).TCGAdminCharts;
const MUNDO = roda(ler("src/admin-mundo.js")).TCGMundo;

test("faixas do mapa: frações do maior país, sem faixa repetida", () => {
  assert.deepEqual(Array.from(C.faixasMapa(2000)), [40, 160, 500, 1200, 2000]);
  assert.deepEqual(Array.from(C.faixasMapa(5)), [1, 3, 5], "5 visitantes no líder não dão 5 faixas");
  assert.deepEqual(Array.from(C.faixasMapa(1)), [1]);
  assert.deepEqual(Array.from(C.faixasMapa(0)), []);
});

test("mapa: cada país na sua faixa, o líder no tom mais forte, país pequeno vira ponto", () => {
  const geo = { w: 100, h: 50, formas: { BR: "M1 1l2 0 0 2z", PT: "M9 9l1 0 0 1z", AR: "M5 5l1 0 0 1z" }, pontos: { SG: [80, 30], MT: [50, 20] } };
  const svg = C.mapaMundo([{ co: "BR", value: 2000, hint: "antes 1.800" }, { co: "PT", value: 100 }, { co: "SG", value: 3 }, { co: "ZZ", value: 9 }], geo);
  assert.match(svg, /class="adm-geo adm-geo-5" data-co="BR"/);
  assert.match(svg, /class="adm-geo adm-geo-2" data-co="PT"/, "100 de 2.000 cai na 2ª faixa (41–160)");
  assert.match(svg, /class="adm-geo" data-co="AR"/, "país sem visitante fica na cor da terra");
  assert.match(svg, /<circle cx="80" cy="30"[^>]*adm-geo-1" data-co="SG"/, "Singapura não tem contorno: círculo");
  assert.doesNotMatch(svg, /data-co="MT"/, "ponto só aparece com visitante");
  assert.match(svg, /<title>[^<]*2\.000 visitantes \(94,7%\) · antes 1\.800<\/title>/, "a dica traz o número, a fatia e a régua");
  assert.match(svg, /nenhum no período<\/title>/);
  assert.equal((svg.match(/adm-geo-cor/g) || []).length, 6, "escala: nenhum + 5 faixas");
  assert.match(svg, /41–160/);
  assert.ok(C.mapaMundo([], null).includes("não carregou"));
});

test("nome do país: português pela sigla, e o balde dos outros", () => {
  assert.equal(C.nomePais("(outros)"), "Outros países");
  assert.equal(C.nomePais(""), "—");
  assert.match(C.nomePais("br"), /^Bra[sz]il$/);
  assert.equal(C.nomePais("<x>"), "<X>", "sigla torta volta como veio (quem desenha escapa)");
});

test("contorno do mundo: a forma que o mapa espera, com a Guiana fora da França", () => {
  assert.equal(MUNDO.w, 2000);
  assert.ok(MUNDO.h > 700 && MUNDO.h < 1100);
  const formas = Object.keys(MUNDO.formas), pontos = Object.keys(MUNDO.pontos);
  assert.ok(formas.length >= 170, `${formas.length} países com contorno`);
  for (const co of ["BR", "PT", "US", "MX", "AR", "JP", "ES", "FR", "GF", "XK"]) assert.ok(MUNDO.formas[co], `falta ${co}`);
  for (const co of ["SG", "HK", "MT", "CV"]) assert.ok(MUNDO.pontos[co], `falta o ponto de ${co}`);
  assert.ok(!MUNDO.formas.AQ, "sem a Antártida");
  for (const co of formas.concat(pontos)) assert.match(co, /^[A-Z]{2}$/, co);
  for (const co of formas) assert.match(MUNDO.formas[co], /^(M-?\d+ -?\d+l[-\d ]+z)+$/, `caminho de ${co}`);
  for (const co of pontos) assert.ok(!MUNDO.formas[co], `${co} com contorno e ponto`);
  // O mapa de verdade desenha sem estourar a caixa.
  const svg = C.mapaMundo([{ co: "BR", value: 10 }, { co: "SG", value: 1 }], MUNDO);
  assert.equal((svg.match(/<path /g) || []).length, formas.length);
});

test("admin.html carrega o contorno antes do painel", () => {
  const html = ler("admin.html");
  const a = html.indexOf('src="src/admin-mundo.js"'), b = html.indexOf('src="src/admin.js"');
  assert.ok(a > 0 && a < b);
});

test("painel: o mapa é opcional no Resumo e na Audiência, e aponta a migração certa", () => {
  // (o Resumo ganhou depois a admin_jogos, 20261111g: outra RPC opcional no fim da lista)
  assert.match(admin, /geral: \["dash", "pulso", "notas", "geo"(, "\w+")*\]/);
  assert.match(admin, /geral: \["pulso", "notas", "geo"(, "\w+")*\], audiencia: \["pulso", "geo"\]/, "sem a migração, o resto da aba pinta");
  assert.match(admin, /geo: "admin_geo"/);
  assert.match(admin, /geo: "20261110a_admin_geo\.sql"/);
});

// ── SQL ──────────────────────────────────────────────────────────────────────
const corpo = (texto, nome) => {
  const i = texto.indexOf(`create or replace function public.${nome}(`);
  assert.ok(i >= 0, nome);
  return texto.slice(i, texto.indexOf("end $$;", i));
};

test("guard: o da 20261009a, mais o país — nada do que ele barrava passa a entrar", () => {
  const novo = corpo(sql, "events_guard"), velho = corpo(v3, "events_guard");
  const limpa = (t) => t.replace(/\s+/g, " ").trim();
  const corte = novo.indexOf("-- País do pageview");
  assert.ok(corte > 0 && novo.includes("cf-ipcountry"));
  assert.equal(limpa(novo.slice(0, corte)).replace(" co text;", ""), limpa(velho.slice(0, velho.indexOf("return new;"))), "até o carimbo do país, é o mesmo guard");
  assert.match(novo, /not in \('XX', 'T1'\)/, "desconhecido e Tor não são país");
  assert.match(novo, /not in \('android', 'ios'\)/, "o app das lojas fica sem país");
  assert.match(novo, /new\.props := new\.props - 'co'/, "o `co` do cliente é jogado fora");
  assert.match(novo, /jsonb_typeof\(new\.props\) = 'object'/, "props que não é objeto não dá erro");
  assert.ok(!sql.replace(/^--.*$/gm, "").split("$$").join("").includes("$"), "nenhum cifrão dentro de corpo de função (o SQL Editor se perde)");
});

test("admin_geo: portão, fechada pro anon, 30 s e sem ler o histórico inteiro", () => {
  const f = corpo(sql, "admin_geo");
  assert.match(f, /if not _is_admin\(\) then return null; end if;/);
  assert.match(f, /set statement_timeout = '30s'/);
  assert.match(f, /where not bot and name = 'pageview' and ts >= ant/, "só a janela de 2 × days");
  assert.match(sql, /revoke all on function public\.admin_geo\(int\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.admin_geo\(int\) to authenticated;/);
});
