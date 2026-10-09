// /admin v3 (2026-10-09, migração 20261009a, docs/PLANO-ANALYTICS-3.md).
//
// O que se trava aqui:
//   - os gráficos novos (régua do período anterior, média de 7 dias, marcos,
//     mapa de calor, matriz de caminhos, barras empilhadas) dizem o que os
//     números dizem — média que olha pra trás, "+∞%" que não existe, ruído
//     (39 → 38) que não vira notícia;
//   - toda página que o painel conhece cai numa ÁREA do site (página nova sem
//     área vira "Outras" e some das contas por área);
//   - o app das lojas (Capacitor) MEDE: a trava de "só produção" aceita o
//     app, o pageview leva pl/av, e o navegador da equipe não conta;
//   - o SQL da 20261009a: guard igual ao da 20261006a fora o contador de
//     descartes, toda RPC de admin com portão e fechada pro anon, tabelas
//     trancadas, e a única porta anônima (robô das lojas) exige a chave.
// O comportamento do SQL foi testado no PGlite (README das migrações); aqui
// fica a forma, que é o que uma edição futura quebra sem perceber.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261009a_admin_v3.sql");

function charts() {
  const window = { document: { getElementById: () => null }, location: { hash: "" } };
  const sandbox = { window, document: window.document, location: window.location, history: {}, console };
  vm.runInNewContext(admin, sandbox);
  return sandbox.window.TCGAdminCharts;
}
const C = charts();

// ── gráficos e régua ────────────────────────────────────────────────────────
test("variação: sem base é null (não '+∞%'), e é fração", () => {
  assert.equal(C.variacao(10, 0), null);
  assert.equal(C.variacao(0, 0), null);
  assert.equal(C.variacao(15, 10), 0.5);
  assert.equal(C.variacao(5, 10), -0.5);
});

test("média móvel olha pra trás e começa junto com as barras", () => {
  const m = C.mediaMovel([7, 7, 7, 14, 0, 0, 0, 7], 7);
  assert.equal(m.length, 8);
  assert.equal(m[0], 7, "o 1º ponto é a média do que há, não vazio");
  assert.equal(m[6], 5, "7 dias: (7+7+7+14+0+0+0)/7");
  assert.equal(m[7], 5, "a janela anda: tira o 1º 7, entra o último 7");
});

test("o que mudou: impacto absoluto, volume mínimo e sem ruído", () => {
  const r = C.movimentos([
    { k: "grande", a: 520, b: 400 },
    { k: "porcentagem-enganosa", a: 4, b: 1 },
    { k: "ruido", a: 38, b: 39 },
    { k: "caiu", a: 50, b: 90 },
    { k: "novo", a: 30, b: 0 }
  ], { min: 10 });
  assert.deepEqual(r.sobe.map((x) => x.k), ["grande", "novo"], "1 → 4 é +300% e não muda nada");
  assert.deepEqual(r.desce.map((x) => x.k), ["caiu"], "39 → 38 é ruído");
  assert.equal(r.sobe[1].v, null, "sem base, sem porcentagem");
});

test("série no tempo: barras do período, média, período anterior tracejado e marcos numerados", () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, v: i * 3 }));
  const svg = C.serieTempo(pts, {
    fantasma: pts.map((p) => p.v / 2),
    marcos: [{ day: "2026-10-03", texto: "Campanha <b>", tipo: "campanha" }, { day: "2026-09-01", texto: "fora da série" }, { day: "2026-10-08", texto: "Deploy", tipo: "deploy" }]
  });
  assert.equal((svg.match(/class="adm-st-bar/g) || []).length, 10);
  assert.match(svg, /class="adm-st-media"/, "10 dias já têm média de 7");
  assert.match(svg, /class="adm-st-ant"/);
  assert.equal((svg.match(/<g class="adm-st-marco"/g) || []).length, 2, "marco fora dos dias do gráfico não aparece");
  assert.match(svg, /<li data-tipo="deploy"><b>2<\/b>/, "a numeração segue a ordem dos que aparecem");
  assert.doesNotMatch(svg, /Campanha <b>/, "texto do marco é escapado");
  const curto = C.serieTempo(pts.slice(0, 5), { fantasma: [1, 2] });
  assert.doesNotMatch(curto, /adm-st-media/, "menos de 7 dias não tem média de 7");
  assert.doesNotMatch(curto, /adm-st-ant/, "fantasma de tamanho diferente não é desenhado (alinharia errado)");
});

test("mapa de calor: 7 × 24, semana começando na segunda, intensidade pelo maior", () => {
  const html = C.mapaCalor([{ dow: 0, h: 21, n: 10 }, { dow: 1, h: 9, n: 5 }, { dow: 1, h: 9, n: 5 }]);
  assert.equal((html.match(/class="adm-calor-c"/g) || []).length, 7 * 24);
  const dias = [...html.matchAll(/class="adm-calor-d">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(dias, ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
  assert.match(html, /--p:100%" title="Seg 9h–10h: 10 páginas"/, "a mesma casa soma");
  assert.match(html, /--p:100%" title="Dom 21h–22h: 10 páginas"/);
  assert.match(C.mapaCalor([]), /Sem dados/);
});

test("matriz: a cor é a fração da LINHA e o zero não pinta", () => {
  const html = C.matriz([{ k: "a", label: "A" }], [{ k: "x", label: "X" }, { k: "y", label: "Y" }, { k: "z", label: "Z" }],
    (l, c) => ({ x: 30, y: 10, z: 0 }[c]));
  assert.match(html, /--p:60%" title="A → X: 30 \(75% da linha\)"/, "teto de 60% na mistura de cor");
  assert.match(html, /--p:25%" title="A → Y: 10 \(25% da linha\)"/);
  assert.match(html, /adm-zero/);
});

test("barras empilhadas em %: cada dia soma 100% (o eixo vai a 100%)", () => {
  const dias = [{ day: "2026-10-01", web: 30, ios: 10 }, { day: "2026-10-02", web: 5, ios: 5 }];
  const series = [{ key: "web", label: "Web", color: "#00f" }, { key: "ios", label: "iOS", color: "#f0f" }];
  const svg = C.barrasEmpilhadas(dias, series, { pct: true, w: 400, h: 200 });
  const hs = [...svg.matchAll(/height="([\d.]+)" fill/g)].map((m) => Number(m[1]));
  const ih = 200 - 10 - 24;
  assert.ok(Math.abs(hs[0] + hs[1] - ih) < 0.2 && Math.abs(hs[2] + hs[3] - ih) < 0.2, `cada coluna enche a altura: ${hs}`);
  assert.match(svg, />100%</);
});

test("sparkline: fantasma só quando tem o mesmo tamanho", () => {
  assert.match(C.sparkline([1, 2, 3], { fantasma: [3, 2, 1] }), /adm-spark-ant/);
  assert.doesNotMatch(C.sparkline([1, 2, 3], { fantasma: [3, 2] }), /adm-spark-ant/);
  assert.equal(C.sparkline([1]), "", "um ponto não é linha");
});

// ── áreas do site ───────────────────────────────────────────────────────────
// Recorta o literal do admin.js e avalia (o resto da página depende do DOM).
const literal = (nome) => {
  const i = admin.indexOf(`const ${nome} = `);
  assert.ok(i > 0, `${nome} não está no admin.js`);
  let j = admin.indexOf(nome === "AREAS" ? "\n  ];" : "\n  };", i);
  return vm.runInNewContext(`(${admin.slice(i + `const ${nome} = `.length, j + 4).replace(/;\s*$/, "")})`);
};

test("toda página com nome no painel tem área (fora 'Interno', só o que é do site)", () => {
  const AREAS = literal("AREAS");
  const PAGE_NAME = literal("PAGE_NAME");
  const mapa = {};
  AREAS.forEach(([id, , cor, paths]) => {
    assert.match(cor, /^#[0-9a-f]{6}$/, `cor da área ${id}`);
    paths.forEach((p) => { assert.ok(!mapa[p], `${p} em duas áreas`); mapa[p] = id; });
  });
  // As chaves antigas das ferramentas entram sem aspas (guarda de link antigo).
  mapa.ferramentas = mapa.condicao = "tools";
  const sem = Object.keys(PAGE_NAME).filter((p) => !mapa[p]);
  assert.deepEqual(sem, [], `página sem área (cai em "Outras"): ${sem.join(", ")}`);
  assert.ok(AREAS.length <= 8, "mais de 8 áreas deixa de ser agrupamento");
});

test("toda aba dos grupos tem o que buscar e o que desenhar", () => {
  const ids = [...admin.matchAll(/\["(\w+)", "[^"]+"\]/g)].map((m) => m[1]);
  for (const id of ["areas", "paginas", "caminhos", "plataformas", "versoes", "lojasapp", "marcos"]) {
    assert.ok(ids.includes(id), `aba ${id} fora dos GROUPS`);
    assert.match(admin, new RegExp(`\\b${id}: \\[`), `aba ${id} sem NEEDS`);
    assert.match(admin, new RegExp(`\\b${id}: \\(x\\) =>`), `aba ${id} sem RENDER`);
  }
  assert.match(admin, /const CORPO = \{ paginas: \(days\) => \(\{ days, p_areas: MAPA_AREAS \}\) \};/, "a admin_paginas recebe o mapa de áreas do próprio admin.js");
});

// ── cliente: app das lojas e navegador da equipe ───────────────────────────
function pageviewCom({ capacitor, equipe, hostname = "localhost" }) {
  const ls = makeLocalStorage(equipe ? { "sleevu-equipe-v1": "1" } : {});
  const sb = loadShared("window.__test = { logPageview };", {
    localStorage: ls,
    location: { pathname: "/collection.html", search: "", hash: "", origin: "https://localhost", hostname, href: "https://localhost/collection.html" }
  });
  const enviados = [];
  sb.fetch = (url, o) => { if (/\/rest\/v1\/events/.test(url)) enviados.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); };
  if (capacitor) sb.Capacitor = capacitor;
  sb.__test.logPageview();
  return new Promise((r) => setImmediate(() => setImmediate(() => r(enviados))));
}
const capacitor = (plat, versao) => ({
  isNativePlatform: () => true, getPlatform: () => plat,
  Plugins: { App: { getInfo: () => Promise.resolve({ version: versao, build: "12" }) } }
});

test("o app das lojas (Capacitor em localhost) MEDE, com plataforma e versão", async () => {
  const [ev] = await pageviewCom({ capacitor: capacitor("android", "1.2.3") });
  assert.ok(ev, "a trava de 'só produção' barrou o app — ele roda em https://localhost");
  assert.equal(ev.name, "pageview");
  assert.equal(ev.path, "collection");
  assert.equal(ev.props.pl, "android");
  assert.equal(ev.props.av, "1.2.3");
  const [ios] = await pageviewCom({ capacitor: capacitor("ios", "2.0.0") });
  assert.equal(ios.props.pl, "ios");
});

test("localhost de desenvolvimento segue sem medir; ponte não-nativa também", async () => {
  assert.deepEqual(await pageviewCom({}), []);
  assert.deepEqual(await pageviewCom({ capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }), []);
});

test("na web o pageview não ganha pl nem espera a ponte", async () => {
  const [ev] = await pageviewCom({ hostname: "sleevu.app" });
  assert.ok(ev);
  assert.equal(ev.props.pl, undefined);
  assert.equal(ev.props.av, undefined);
});

test("navegador da equipe (marcado no /admin) não conta", async () => {
  assert.deepEqual(await pageviewCom({ hostname: "sleevu.app", equipe: true }), []);
});

test("no app, o tempo da tela sai quando ele vai pro segundo plano (lá não há pagehide)", () => {
  const shared = ler("src/shared.js");
  const i = shared.indexOf("function initPageTime()");
  const corpo = shared.slice(i, shared.indexOf("\n  }\n", i));
  assert.match(corpo, /else if \(appNativo\(\)\) envia\(\);\s*\n\s*else pausa\(\);/, "só o app manda no hidden; a web segue no pagehide");
  assert.match(corpo, /window\.addEventListener\("pagehide", envia\);/);
  assert.match(corpo, /if \(enviado \|\| acumulado < 2000\) return;\s*\n\s*enviado = true;/, "uma vez por página");
});

test("todas as travas de medição usam o emProducao (nenhuma ficou só no host)", () => {
  const shared = ler("src/shared.js");
  for (const f of ["function mandaEvento", "function logCardView", "function logDeckView", "function initErros", "function setConsent"]) {
    const i = shared.indexOf(f);
    assert.ok(i > 0, f);
    const corpo = shared.slice(i, shared.indexOf("\n  }\n", i));
    assert.match(corpo, /emProducao\(\)/, `${f} sem emProducao()`);
    assert.doesNotMatch(corpo, /sleevu\\\.app\$\/i\.test\(location\.hostname\)/, `${f} ainda testa só o host`);
  }
});

// ── privacidade: o que a política promete, o código cumpre (A11) ───────────
test("política (pt/en/es): diz que a conta vai junto quando logado, a base legal, o contato e como desligar", () => {
  const docs = ler("src/i18n-docs.js");
  const sb = { window: { TCG_MESSAGES: {} } };
  vm.runInNewContext(docs, sb);
  const M = sb.window.TCG_MESSAGES;
  const regras = {
    pt: [/identificador interno da sua conta/, /LGPD, art\. 7º, IX/, /Ao apagar a conta, esse vínculo é apagado/, /relatórios de erro, sem identificador e sem a sua conta/, /Cloudflare Web Analytics\. Continuam/],
    en: [/account's internal identifier/, /LGPD, art\. 7, IX/, /Deleting your account deletes this link/, /error reports, with no identifier and no account/],
    es: [/identificador interno de tu cuenta/, /LGPD de Brasil, art\. 7, IX/, /Al borrar la cuenta, ese vínculo se borra/, /informes de error, sin identificador y sin tu cuenta/]
  };
  for (const [lg, rs] of Object.entries(regras)) {
    const a = M[lg]["privacy.s.analytics"];
    for (const r of rs) assert.match(a, r, `${lg}: privacy.s.analytics sem ${r}`);
    assert.match(M[lg]["privacy.s.contact"], /mailto:hi@sleevu\.app/, `${lg}: contato sem e-mail`);
    assert.match(M[lg]["privacy.s.retention"], /13/, lg);
    for (const k of ["privacy.s.analytics", "privacy.s.cookies", "privacy.s.retention"]) {
      assert.doesNotMatch(M[lg][k], /Nada disso identifica|None of this identifies|Nada de esto te identifica|sin datos personales|with no personal data|sem dados pessoais/, `${lg}: ${k} ainda promete anonimato total`);
    }
  }
  const i18n = ler("src/i18n.js");
  assert.doesNotMatch(i18n, /"settings\.analyticsDesc": "(Estatística anônima|Anonymous, aggregated|Estadística anónima)/, "a chave das Configurações ainda diz anônima");
  assert.match(ler("settings.html"), /data-i18n="settings\.analyticsDesc">Estatística de uso/);
});

test("medição desligada: o erro sai sem a conta e o Cloudflare não carrega", () => {
  const shared = ler("src/shared.js");
  const i = shared.indexOf("function initErros()");
  assert.match(shared.slice(i, i + 900), /authHeaders\(hasConsent\("analytics"\) \? tokenParaEvento\(\) : null\)/, "sem consentimento, o erro não pode levar o token (uid)");
  const j = shared.indexOf("function injectCfBeacon()");
  assert.match(shared.slice(j, j + 200), /!hasConsent\("analytics"\)\) return;/, "o beacon do Cloudflare tem de respeitar a chave");
});

test("20261009b: apagar a conta tira a conta dos eventos, sem nunca segurar o delete", () => {
  const b = ler("supabase/migrations/20261009b_eventos_sem_conta.sql");
  assert.match(b, /create trigger eventos_sem_conta after delete on auth\.users\s*\n\s*for each row execute function public\._eventos_sem_conta\(\);/);
  assert.match(b, /update events set uid = null where uid = old\.id;\s*\n\s*return old;\s*\nexception when others then\s*\n\s*return old;/, "falha na limpeza não pode impedir apagar a conta");
  assert.match(b, /revoke all on function public\._eventos_sem_conta\(\) from public, anon, authenticated;/);
  assert.match(b, /create index if not exists events_uid_idx on public\.events \(uid\) where uid is not null;/);
  assert.match(b, /not exists \(select 1 from auth\.users u where u\.id = e\.uid\)/, "limpa as contas apagadas antes");
  assert.match(ler("supabase/migrations/README.md"), /`20261009b` — apagar a conta tira a conta das estatísticas/);
});

// ── SQL da 20261009a ────────────────────────────────────────────────────────
const guardDe = (txt) => {
  const i = txt.indexOf("create or replace function public.events_guard()");
  const fim = "revoke all on function public.events_guard() from public, anon, authenticated;";
  return txt.slice(i, txt.indexOf(fim, i) + fim.length);
};

test("guard: o da 20261006a mais o contador de descartes, nada além", () => {
  const velho = guardDe(ler("supabase/migrations/20261006a_eventos_por_visitante.sql"));
  const novo = guardDe(sql);
  const norm = (g) => g.split("\n").filter((l) => !/^\s*--/.test(l) && !/_descarta\(/.test(l))
    .join("\n").replace(/then\s*\n\s*return null;\s*\n\s*end if;/g, "then return null; end if;").replace(/\s+/g, " ");
  assert.equal(norm(novo), norm(velho), "whitelist, tetos, limite por visitante, uid e robô têm de ser cópia fiel da 20261006a");
  for (const m of ["lista", "tamanho", "ritmo", "ritmo_ip"]) assert.match(novo, new RegExp(`_descarta\\('${m}', new\\.name\\)`), `descarte '${m}' sem contar`);
  assert.match(sql, /exception when others then\s*\n\s*return;\s*\nend \$\$;\s*\nrevoke all on function public\._descarta/, "contar descarte nunca vira erro no insert");
});

test("RPCs de admin da v3: portão de admin, revogadas do anon e liberadas só pro authenticated", () => {
  const rpcs = [...sql.matchAll(/create or replace function public\.(admin_\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rpcs.map((r) => r[0]).sort(), ["admin_anuncios", "admin_app_loja_save", "admin_descartes", "admin_nota_delete", "admin_nota_save", "admin_notas", "admin_paginas", "admin_plataformas", "admin_pulso"]);
  for (const [nome] of rpcs) {
    const i = sql.indexOf(`function public.${nome}(`);
    const corpo = sql.slice(i, sql.indexOf("end $$;", i));
    assert.match(corpo, /if not _is_admin\(\) then return null; end if;/, `${nome} sem o portão de admin`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${nome}\\([^)]*\\) from public, anon;`), `${nome} não foi revogada do anon`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${nome}\\([^)]*\\) to authenticated;`), `${nome} sem grant`);
  }
  for (const nome of ["admin_pulso", "admin_paginas", "admin_plataformas", "admin_descartes", "admin_notas", "admin_anuncios"]) {
    const i = sql.indexOf(`function public.${nome}(`);
    assert.match(sql.slice(i, i + 200), /language plpgsql stable/, `${nome} só lê: tem de ser stable`);
  }
});

test("tabelas novas trancadas pra API; a única porta anônima exige a chave do robô", () => {
  for (const t of ["events_descartes", "admin_notas", "app_store_daily", "app_store_robo"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;\\s*\\nrevoke all on public\\.${t} from public, anon, authenticated;`), `${t} aberta`);
  }
  assert.doesNotMatch(sql, /create policy/i, "nenhuma policy: só as funções SECURITY DEFINER tocam nas tabelas");
  const i = sql.indexOf("function public.app_store_import(");
  const corpo = sql.slice(i, sql.indexOf("end $$;", i));
  assert.match(corpo, /chave_sha256 = encode\(sha256\(convert_to\(p_key, 'UTF8'\)\), 'hex'\)/, "o robô entra pelo SHA-256 da chave");
  assert.match(corpo, /_rate_ok\('appstore', 30\)/);
  assert.match(sql, /grant execute on function public\.app_store_import\(text, jsonb\) to anon, authenticated;/);
});

test("o mapa de áreas que vem do cliente é limitado", () => {
  assert.match(sql, /jsonb_typeof\(p_areas\) = 'object' and pg_column_size\(p_areas\) <= 8192 then p_areas else '\{\}'::jsonb end/);
  assert.match(sql, /left\(areas->>pv\.path, 24\)/, "nome de área cortado");
});

test("a migração entra na lista de pendentes do README e declara que contém a 20261006a", () => {
  const readme = ler("supabase/migrations/README.md");
  assert.match(readme, /`20261009a` — \/admin v3/);
  assert.match(sql, /ESTA\s+(--\s+)?MIGRAÇÃO CONTÉM A 20261006a/);
});
