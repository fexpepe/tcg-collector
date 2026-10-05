// Alarme de medição parada com o tráfego (2026-10-04, migração 20261004a).
// O fim da campanha paga derrubou os visitantes de ~250 pra ~15 por dia e o
// scan_open acendeu sem nada quebrado: a regra da 20260928a comparava com a
// média da campanha. A regra rodou num Postgres de verdade (PGlite) com os
// cenários — ver a descrição da migração; aqui fica o que não pode regredir no
// texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(raiz, "supabase", "migrations", "20261004a_sentinela_trafego.sql"), "utf8");
const corpoDe = (fn) => {
  const i = sql.indexOf(`function public.${fn}(`);
  assert.ok(i >= 0, `${fn} não está na migração`);
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3);
};

test("o esperado escala pela razão de pageviews, menos o próprio pageview", () => {
  const s = corpoDe("_sentinela");
  assert.match(s, /where name = 'pageview' and not bot and ts >= now\(\) - interval '16 days'/, "o tráfego tem de sair sem robô e na mesma janela");
  assert.match(s, /a\.antes::numeric \* t\.pv48 \/ t\.pv_antes/, "o esperado é a contagem anterior × razão de pageviews");
  assert.match(s, /when a\.alvo = 'pageview' or t\.pv_antes = 0 then a\.antes::numeric \/ 7/,
    "o pageview escalado por ele mesmo nunca acusaria a própria queda");
  assert.match(s, /media_dia >= 3 and ultimas48h = 0 and esperado48h >= 6 as alerta/);
});

test("quem lê o alarme usa a coluna alerta, e o anônimo segue sem contagem", () => {
  const st = corpoDe("analytics_sentinela");
  assert.match(st, /from _sentinela\(\) where alerta/);
  assert.doesNotMatch(st, /ultimas48h|media_dia|esperado48h|count\(/, "o alarme anônimo não pode devolver contagem");
  assert.match(sql, /grant execute on function public\.analytics_sentinela\(\) to anon, authenticated;/);
  const ah = corpoDe("admin_health");
  assert.match(ah, /begin\s+if not _is_admin\(\) then return null; end if;/);
  assert.match(ah, /'alerta', alerta\)/, "o /admin não pode repetir a regra antiga por conta própria");
  assert.match(sql, /revoke all on function public\.admin_health\(\) from public, anon;/);
});

test("_sentinela é recriada (mudou o retorno) e continua fechada pra API", () => {
  assert.match(sql, /drop function if exists public\._sentinela\(\);\s+create function public\._sentinela\(\)/);
  assert.match(sql, /revoke all on function public\._sentinela\(\) from public, anon, authenticated;/);
  assert.equal((sql.match(/drop function/g) || []).length, 1, "só a _sentinela pode ser dropada");
});
