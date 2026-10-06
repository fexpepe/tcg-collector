// Medição de campanha (2026-10-06, auditoria de aquisição).
//
// Duas pontas:
//   - banco (migração 20261006a): o events_guard limitava 60 eventos/min por
//     IP, e celular sai por CGNAT — visitantes diferentes dividiam o balde e o
//     excedente sumia calado. Agora é 60/min por (IP, anon) + 600/min por IP,
//     e o RESTO do guard tem de continuar idêntico ao da 20260928a;
//   - cliente (contextoPageview no shared.js): o pageview leva o anúncio
//     (utm_content → a) e o NOME do parâmetro de clique pago (k), nunca o id.
//     Clique do Google Ads sem utm vira campanha "google-ads" (o _canal do
//     banco contava como busca orgânica); fbclid não, porque o Instagram e o
//     Facebook o põem em qualquer link.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8").replace(/\r\n/g, "\n");

const guardDe = (arquivo) => {
  const sql = ler(join("supabase", "migrations", arquivo));
  const i = sql.indexOf("create or replace function public.events_guard()");
  const fim = "revoke all on function public.events_guard() from public, anon, authenticated;";
  assert.ok(i >= 0, `events_guard não está em ${arquivo}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const semLimite = (g) => g.split("\n").filter((l) => !/_rate_ok\(/.test(l) && !/^\s*--/.test(l)).join("\n");

test("o guard novo só muda a linha do limite", () => {
  const velho = guardDe("20260928a_analytics_2_1.sql");
  const novo = guardDe("20261006a_eventos_por_visitante.sql");
  assert.equal(semLimite(novo), semLimite(velho), "whitelist, tetos, uid e robô têm de ser cópia fiel da 20260928a");
  assert.match(velho, /_rate_ok\('events', 60\)/);
  assert.doesNotMatch(novo, /_rate_ok\('events', 60\)/, "o limite antigo por IP não pode sobrar");
});

test("60/min por visitante e 600/min por IP", () => {
  const novo = guardDe("20261006a_eventos_por_visitante.sql");
  assert.match(novo, /if not _rate_ok\('events:' \|\| left\(coalesce\(new\.anon, ''\), 64\), 60\) then return null; end if;/);
  assert.match(novo, /if not _rate_ok\('events', 600\) then return null; end if;/);
});

test("a migração entra na lista de pendentes do README", () => {
  assert.match(ler(join("supabase", "migrations", "README.md")), /`20261006a` — limite de eventos por VISITANTE/);
});

// O trecho de campanha do contextoPageview, rodado com uma URL de mentira.
const shared = ler(join("src", "shared.js"));
const ini = shared.indexOf("      const qs = new URLSearchParams(location.search);");
const fimTrecho = shared.indexOf("    } catch (e) { /* sem contexto, o pageview vale do mesmo jeito */ }", ini);
const trecho = shared.slice(ini, fimTrecho);
function campanha(search) {
  const p = {};
  vm.runInNewContext(trecho, { p, location: { search }, URLSearchParams });
  return p;
}

test("o trecho de campanha existe no contextoPageview", () => {
  assert.ok(ini > 0 && fimTrecho > ini, "trecho não encontrado no shared.js");
});

test("utm: fonte, campanha e anúncio, em minúsculas e saneados", () => {
  assert.deepEqual(campanha("?utm_source=Instagram&utm_campaign=Lancamento-Out&utm_content=Video_Charizard!"),
    { u: "instagram", c: "lancamento-out", a: "video_charizard" });
  assert.deepEqual(campanha("?q=charizard"), {});
});

test("clique do Google Ads sem utm vira campanha, e o id nunca é gravado", () => {
  for (const k of ["gclid", "gbraid", "wbraid"]) {
    const p = campanha(`?${k}=Cj0KCQjw-ABC123`);
    assert.deepEqual(p, { k, u: "google-ads" }, k);
    assert.ok(!JSON.stringify(p).includes("Cj0KCQjw"), "o valor do clique não pode ir pro banco");
  }
});

test("utm explícito vence a origem deduzida do clique", () => {
  assert.deepEqual(campanha("?utm_source=google&utm_campaign=busca&gclid=abc"), { u: "google", c: "busca", k: "gclid" });
});

test("fbclid fica só como marca: Instagram/Facebook põem em qualquer link", () => {
  assert.deepEqual(campanha("?fbclid=IwAR0xyz"), { k: "fbclid" });
  assert.deepEqual(campanha("?utm_source=instagram&fbclid=IwAR0xyz"), { u: "instagram", k: "fbclid" });
});
