// Alarme de medição parada sem estourar o tempo do anônimo (2026-10-17,
// migração 20261017a). O healthcheck acusou "HTTP 500" e era 57014: a
// `_sentinela` lia 16 dias de `events` três vezes, na tabela, e passava dos
// 3 s do anon com o cache frio. A saída nova foi comparada com a da 20261004a
// num Postgres de verdade (PGlite) — ver a descrição da migração; aqui fica o
// que não pode regredir no texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(raiz, "supabase", "migrations", "20261017a_sentinela_rapida.sql"), "utf8");
const corpo = (() => {
  const i = sql.indexOf("function public._sentinela(");
  assert.ok(i >= 0, "_sentinela não está na migração");
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3);
})();
const cte = (nome) => {
  const m = new RegExp(`${nome} as \\(([\\s\\S]*?)\\n  \\),?\\n`).exec(corpo);
  assert.ok(m, `CTE ${nome} não encontrada`);
  return m[1].replace(/--.*$/gm, ""); // o comentário explica o props; o código não pode usar
};

test("índice parcial só das linhas de gente, na ordem do filtro", () => {
  assert.match(sql, /create index if not exists events_humano_ts_idx on public\.events \(ts, name\) where not bot;/);
});

test("a passada por nome não toca no props (senão sai do índice e volta pra tabela)", () => {
  const n = cte("por_nome");
  assert.doesNotMatch(n, /props/);
  assert.match(n, /where not bot and ts >= now\(\) - interval '16 days'/);
  assert.match(n, /name not in \('jserror', 'push_sent'\)/);
});

test("duas leituras do events, não três: o tráfego sai da passada por nome", () => {
  assert.equal((corpo.match(/from events\b/g) || []).length, 2);
  assert.match(cte("por_loja"), /name = 'store_click'/);
  const t = cte("trafego");
  assert.match(t, /from por_nome where alvo = 'pageview'/);
  assert.doesNotMatch(t, /group by/, "sem group by o agregado sempre devolve uma linha, mesmo sem pageview");
});

test("a regra é a da 20261004a, palavra por palavra", () => {
  assert.match(corpo, /a\.antes::numeric \* t\.pv48 \/ t\.pv_antes/);
  assert.match(corpo, /when a\.alvo = 'pageview' or t\.pv_antes = 0 then a\.antes::numeric \/ 7/);
  assert.match(corpo, /media_dia >= 3 and ultimas48h = 0 and esperado48h >= 6 as alerta/);
});

test("mesmo retorno, sem drop, fechada pra API; o anon ganha folga de tempo", () => {
  assert.doesNotMatch(sql, /drop function/, "o retorno é o mesmo: create or replace basta e não derruba quem depende");
  assert.match(corpo, /returns table \(alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz,\s+esperado48h numeric, alerta boolean\)/);
  assert.match(sql, /revoke all on function public\._sentinela\(\) from public, anon, authenticated;/);
  assert.match(sql, /alter function public\.analytics_sentinela\(\) set statement_timeout = '15s';/);
});

test("nenhum cifrão dentro do corpo (o SQL Editor do Supabase se perde)", () => {
  assert.doesNotMatch(corpo.slice(corpo.indexOf("$$") + 2, corpo.lastIndexOf("$$")), /\$/);
});

test("o healthcheck mostra o motivo do erro da RPC, não só o status", () => {
  const hc = readFileSync(join(raiz, "scripts", "healthcheck.mjs"), "utf8");
  assert.match(hc, /j\?\.message/);
});
