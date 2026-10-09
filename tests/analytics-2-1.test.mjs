// Analytics 2.1 (migração 20260928a): valor catalogado e encaminhado, contador
// de quem desliga a medição, alarme de medição parada, tempo de uso, retenção
// por conta, buscas, sets, custo de campanha, primeiros passos, push, portal
// da loja, resumo/limpeza de eventos, experimentos e a página de usuários.
//
// O que se trava aqui:
//   - nenhuma migração nova perde um nome de evento que uma anterior aceitava
//     (a 2.1 quase apagou os da vitrine, que entraram um dia antes);
//   - nenhum cifrão dentro de corpo de função — foi o que fez o SQL Editor do
//     Supabase recusar a 20260923a ("unterminated dollar-quoted string");
//   - o valor da carta chega no store_click, e o experimento é estável;
//   - as RPCs novas são só de admin, exceto as duas feitas pra serem anônimas
//     (portal da loja e alarme do healthcheck), que não vazam contagem;
//   - a página do parceiro não manda o token no Referer e não é indexada.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Na checkout Windows (core.autocrlf=true) o texto chega com CRLF; no CI, com
// LF. As regex que recortam corpo de função querem "\n" logo depois da "}" que
// fecha e, com o "\r" no meio, davam null: 3 testes daqui falhavam só na
// máquina local. Lido sempre em LF, o texto é o mesmo nos dois lados, e no CI
// a troca não muda nada.
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const MIG = "supabase/migrations/20260928a_analytics_2_1.sql";
const sql = ler(MIG);
const shared = ler("src/shared.js");
const admin = ler("src/admin.js");

const migracoes = readdirSync(join(raiz, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
const whitelist = (txt) => {
  const b = /new\.name not in \(([\s\S]*?)\)\s*\n?\s*then return null/.exec(txt);
  return b ? new Set([...b[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) : null;
};

test("a whitelist do events_guard só cresce: migração nova não derruba evento antigo", () => {
  let anterior = null, nomeAnterior = "";
  for (const f of migracoes) {
    const w = whitelist(ler(join("supabase", "migrations", f)));
    if (!w) continue;
    if (anterior) {
      for (const nome of anterior) {
        assert.ok(w.has(nome), `${f} redefine o events_guard sem '${nome}' (que a ${nomeAnterior} aceitava) — ele passaria a ser descartado calado`);
      }
    }
    anterior = w; nomeAnterior = f;
  }
  for (const nome of ["page_time", "search_hit", "onboard_state", "exp_view", "push_sent", "ad_view", "ad_click"]) {
    assert.ok(anterior.has(nome), `${nome} fora da whitelist mais nova`);
  }
});

test("nenhum cifrão solto dentro de corpo de função (o SQL Editor do Supabase quebra)", () => {
  // Vale da 20260923a (a que quebrou) em diante, menos a 20260927a: ela já
  // foi aplicada como está e reescrevê-la não muda nada no banco.
  for (const f of migracoes.filter((x) => x >= "20260923a" && !x.startsWith("20260927a"))) {
    const txt = ler(join("supabase", "migrations", f));
    let dentro = false;
    txt.split("\n").forEach((linha, i) => {
      const marcas = (linha.match(/\$\$/g) || []).length;
      const semMarcas = linha.replace(/\$\$/g, "");
      if (dentro && /\$/.test(semMarcas)) assert.fail(`${f}:${i + 1} tem cifrão dentro de um corpo $$…$$: ${linha.trim()}`);
      if (marcas % 2 === 1) dentro = !dentro;
    });
    assert.equal(dentro, false, `${f}: corpo $$ aberto e nunca fechado`);
  }
});

test("RPCs de admin da 2.1 checam admin logo no começo e não abrem pro anon", () => {
  for (const fn of ["admin_health", "admin_engagement", "admin_stores", "admin_campaigns", "admin_campaign_save",
    "admin_campaign_delete", "admin_partner_link_create", "admin_partner_link_revoke", "admin_partner_links",
    "admin_experiments", "admin_users"]) {
    const corpo = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?begin[\\s\\S]{0,40}?if not _is_admin\\(\\) then return null; end if;`);
    assert.match(sql, corpo, `${fn} não checa admin no começo`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`), `${fn} sem revoke do anon`);
  }
  for (const t of ["consent_daily", "campaign_costs", "partner_links", "events_daily"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated;`));
  }
  for (const fn of ["_colecao_usuarios", "_sentinela", "events_rollup", "events_purge", "metrics_snapshot"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), `${fn} chamável pela API`);
  }
});

test("as duas RPCs anônimas: portal só com token válido e alarme só com nomes", () => {
  const pr = /create or replace function public\.partner_report[\s\S]*?end \$\$;/.exec(sql)[0];
  assert.match(pr, /p_token !~ '\^\[0-9a-f\]\{64\}\\Z'/, "token sem validação de formato");
  assert.match(pr, /_rate_ok\('partner'/, "portal sem rate limit");
  assert.match(pr, /revoked_at is null/, "link revogado continuaria valendo");
  assert.match(pr, /where pessoas >= 3/, "carta com menos de 3 pessoas não pode aparecer nominalmente");
  assert.match(sql, /grant execute on function public\.partner_report\(text, int\) to anon, authenticated;/);
  const st = /create or replace function public\.analytics_sentinela[\s\S]*?\n\$\$;/.exec(sql)[0];
  assert.match(st, /jsonb_agg\(alvo/);
  assert.doesNotMatch(st, /ultimas48h,|media_dia,|count\(/, "o alarme anônimo não pode devolver contagem");
});

test("limpeza de eventos: 13 meses no mínimo e só depois do resumo", () => {
  const pg = /create or replace function public\.events_purge[\s\S]*?end \$\$;/.exec(sql)[0];
  assert.match(pg, /greatest\(13,/, "a limpeza tem de respeitar o piso de 13 meses");
  assert.ok(pg.indexOf("perform events_rollup") < pg.indexOf("delete from events"), "resumo tem de vir ANTES do delete");
});

test("store_click leva o valor da carta em R$", () => {
  const api = loadShared("window.__test = { brMarketplaceLinks };").window.__test;
  const card = { id: "sv1-25", name: "Pikachu", number: "25", setTotal: 198, game: "pokemon" };
  assert.match(api.brMarketplaceLinks(card, "", 123.6), /data-mkt-v="124"/);
  assert.doesNotMatch(api.brMarketplaceLinks(card, "", 0), /data-mkt-v/);
  const m = /function initStoreClicks\(\) \{([\s\S]*?)\n  \}\n/.exec(shared);
  assert.match(m[1], /props\.v = Number\(box\.dataset\.mktV\)/);
  assert.match(shared, /brMarketplaceLinks\(activeCard, gradedSearchTag\(activeGraded\), valorEmReais\(/, "o preview não passa o valor pro bloco de lojas");
});

test("experimento: variante sorteada uma vez e mantida; nome inválido cai na 1ª", () => {
  const ls = makeLocalStorage();
  const api = loadShared("window.__test = { experimento };", { localStorage: ls }).window.__test;
  const v = api.experimento("home_cta", ["a", "b"]);
  assert.ok(["a", "b"].includes(v));
  for (let i = 0; i < 20; i++) assert.equal(api.experimento("home_cta", ["a", "b"]), v, "a variante mudou entre chamadas");
  assert.equal(JSON.parse(ls.getItem("sleevu-exp-v1")).home_cta, v, "a variante não ficou guardada");
  assert.equal(api.experimento("Nome Inválido!", ["x", "y"]), "x");
});

test("tempo de página: só o tempo visível, piso de 2s e teto de 30min", () => {
  const m = /function initPageTime\(\) \{([\s\S]*?)\n  \}\n/.exec(shared);
  assert.ok(m, "initPageTime sumiu");
  assert.match(m[1], /visibilitychange/);
  assert.match(m[1], /addEventListener\("pagehide"/);
  assert.match(m[1], /acumulado < 2000/);
  assert.match(m[1], /Math\.min\(Math\.round\(acumulado\), 1800000\)/);
  assert.match(shared, /initStoreClicks\(\);\s*\n\s*initPageTime\(\);/);
});

test("recusa da medição: só a decisão, só quando muda, só em produção", () => {
  const m = /function setConsent\(cat, valor\) \{([\s\S]*?)\n  \}\n/.exec(shared);
  assert.match(m[1], /antes !== !!valor/);
  assert.match(m[1], /rpc\/consent_tally/);
  // Só em produção: desde a v3 do admin (2026-10-09) a trava é o
  // emProducao(), que é o sleevu.app OU o app das lojas (Capacitor).
  assert.match(m[1], /emProducao\(\)/);
  assert.match(shared, /function emProducao\(\) \{ return \/\(\^\|\\\.\)sleevu\\\.app\$\/i\.test\(location\.hostname\) \|\| appNativo\(\); \}/);
  assert.match(m[1], /p_on: !!valor/);
});

// O emProducao() em ação (a trava acima confere o texto): o sleevu.app OU o
// app das lojas, que roda em capacitor://localhost / https://localhost e se
// reconhece pela ponte nativa do Capacitor. O pacote do app aberto num
// navegador comum (o ensaio local do mobile/README.md) não tem a ponte e
// não é produção.
test("produção = sleevu.app ou o app nativo; localhost e preview ficam de fora", () => {
  const loc = (hostname) => ({ pathname: "/", search: "", hash: "", origin: `https://${hostname}`, hostname, href: `https://${hostname}/` });
  // Carrega em localhost (o boot em "sleevu.app" leria o cookie de sessão, que
  // o sandbox não tem) e troca o endereço depois: a régua lê na hora da chamada.
  const sb = loadShared("window.__test = { emProducao };");
  const em = (hostname, nativo) => {
    sb.location = loc(hostname);
    sb.Capacitor = nativo === undefined ? undefined : { isNativePlatform: () => nativo };
    return sb.window.__test.emProducao();
  };
  assert.equal(em("sleevu.app"), true);
  assert.equal(em("www.sleevu.app"), true);
  assert.equal(em("localhost"), false);
  assert.equal(em("tcg-collector.pages.dev"), false);
  assert.equal(em("sleevu.app.golpe.com"), false);
  assert.equal(em("localhost", true), true);
  assert.equal(em("localhost", false), false);
  // Os seis caminhos de medição passam pela mesma régua; o beacon da
  // Cloudflare e o cookie .sleevu.app continuam só no domínio.
  assert.equal((shared.match(/(?<!function )emProducao\(\)/g) || []).length, 6);
  assert.match(/function injectCfBeacon\(\) \{([\s\S]*?)\n  \}\n/.exec(shared)[1], /sleevu\\\.app\$\/i\.test\(location\.hostname\)/);
});

test("busca com resultado também é registrada, com as mesmas travas", () => {
  assert.match(shared, /if \(achados\) logEvento\("search_hit", \{ q: nq\.slice\(0, 40\)/);
  assert.match(shared, /else logEvento\("search_empty"/);
});

test("primeiros passos e push alimentam o funil", () => {
  const pp = ler("src/primeiros-passos.js");
  assert.match(pp, /sessionStorage\.getItem\("sleevu-pp-registrado"\)/, "onboard_state tem de sair uma vez por sessão");
  assert.match(pp, /logEvento\("onboard_state"/);
  const push = ler("scripts/send-wishlist-push.mjs");
  assert.match(push, /wishlist\.html\?utm_source=push&utm_campaign=wishlist/);
  assert.match(push, /name: "push_sent"/);
  const hc = ler("scripts/healthcheck.mjs");
  assert.match(hc, /rpc\/analytics_sentinela/);
});

test("página do parceiro: sem indexação, sem Referer, gráficos antes do script", () => {
  const html = ler("parceiro.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/, "o token iria no Referer de qualquer link pra fora");
  assert.ok(html.indexOf("src/admin.js") < html.indexOf("src/parceiro.js"), "parceiro.js precisa do TCGAdminCharts carregado antes");
  assert.match(ler("robots.txt"), /Disallow: \/parceiro/);
  assert.match(ler("scripts/lib/css-areas.mjs"), /nome: "conta",[^\n]*"parceiro\.html"/, "sem a área conta a página chega sem estilo");
  // Todo texto da página passa pelo i18n nos três idiomas.
  const js = ler("src/parceiro.js") + html;
  const i18n = ler("src/i18n.js");
  for (const m of js.matchAll(/(?:t\(|data-i18n=)"(ptn\.[a-zA-Z]+)"/g)) {
    assert.equal((i18n.match(new RegExp(`"${m[1].replace(".", "\\.")}":`, "g")) || []).length, 3, `${m[1]} não está nos 3 idiomas`);
  }
});

test("painel: RPCs sem parâmetro não recebem { days }", () => {
  const sem = /const SEM_DIAS = \[([^\]]*)\]/.exec(admin)[1];
  for (const k of ["campaigns", "partners", "health"]) assert.match(sem, new RegExp(`"${k}"`));
  for (const fn of ["admin_campaigns", "admin_partner_links", "admin_health"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(\\)`), `${fn} ganhou parâmetro — revise SEM_DIAS`);
  }
});

test("monthly soma o valor encaminhado e guarda o catalogado do último dia", () => {
  const window = { document: { getElementById: () => null }, location: { hash: "" } };
  const sb = { window, document: window.document, location: window.location, history: {}, console };
  vm.runInNewContext(admin, sb);
  const m = sb.window.TCGAdminCharts.monthly([
    { day: "2026-09-01", valor_encaminhado: 100, valor_catalogado: 1000 },
    { day: "2026-09-02", valor_encaminhado: 50, valor_catalogado: 1200 }
  ]);
  assert.equal(m[0].valor_encaminhado, 150);
  assert.equal(m[0].valor_catalogado, 1200);
});
