// Robôs retroativos (migração 20260929a): marca como robô a rajada de
// navegadores "de passagem" de julho/agosto, que entrou como gente porque
// antes da 20260914a não existia a coluna `bot`, e refaz a série.
//
// O comportamento foi testado no PGlite com as funções reais (ver o README das
// migrações). O que se trava aqui é o que não pode mudar sem ninguém ver, já
// que o arquivo roda direto no banco de produção:
//   - nada é APAGADO do `events` — só reclassificado (e dá pra desfazer);
//   - a correção só vale antes do corte (depois dele o trigger já marca robô)
//     e só mexe em quem ainda não era robô;
//   - quem fez qualquer coisa além de ver página nunca entra na regra;
//   - a lista do que foi marcado nasce trancada, como as outras tabelas;
//   - as funções que refazem a série são chamadas só se existirem.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const bruto = readFileSync(join(raiz, "supabase", "migrations", "20260929a_robos_retroativos.sql"), "utf8");
// O cabeçalho cita a receita de desfazer (com update e truncate): as
// garantias valem pro SQL que RODA, então os comentários saem antes.
const sql = bruto.replace(/--[^\n]*/g, "");

test("nada é apagado do events: a correção só reclassifica", () => {
  assert.doesNotMatch(sql, /\bdelete\s+from\s+(public\.)?events\b/i, "delete no events");
  assert.doesNotMatch(sql, /\btruncate\b/i, "truncate fora da receita de desfazer");
  assert.doesNotMatch(sql, /\bdrop\s+table\s+(if\s+exists\s+)?(public\.)?events\b/i);
  const updates = [...sql.matchAll(/update\s+public\.events\b[\s\S]*?;/gi)].map((m) => m[0]);
  assert.equal(updates.length, 1, "esperava um único update no events");
  assert.match(updates[0], /set\s+bot\s*=\s*true/i, "o update só pode ligar o flag de robô");
});

test("só antes do corte de 2026-09-15 e só em quem ainda não era robô", () => {
  assert.match(sql, /corte\s+timestamptz\s*:=\s*date\s+'2026-09-15'::timestamp\s+at\s+time\s+zone\s+'America\/Sao_Paulo'/i);
  const upd = /update\s+public\.events\b[\s\S]*?;/i.exec(sql)[0];
  assert.match(upd, /not\s+e\.bot/i, "o update tem de pular o que já era robô");
  assert.match(upd, /e\.ts\s*<\s*corte/i, "o update tem de parar no corte");
  assert.match(sql, /p_ate\s+date\s+default\s+date\s+'2026-09-15'/i, "a regra tem de olhar só antes do corte");
});

test("quem fez qualquer coisa além de ver página fica fora da regra", () => {
  assert.match(sql, /agiu\s+as\s*\([\s\S]*?e\.name\s+not\s+in\s*\(\s*'pageview'\s*,\s*'jserror'\s*\)/i);
  assert.match(sql, /not\s+exists\s*\(\s*select\s+1\s+from\s+agiu/i);
  // "De passagem" é visita única: toda a história do navegador em 30 minutos.
  assert.match(sql, /a\.ultima\s*-\s*a\.primeira\s*<=\s*interval\s+'30 minutes'/i);
  // E a régua da avalanche tem piso absoluto além do múltiplo do normal.
  assert.match(sql, /greatest\(p_piso_hora::numeric/i);
  assert.match(sql, /greatest\(p_piso_dia::numeric/i);
});

test("a lista do que foi marcado nasce trancada e a regra não abre pra API", () => {
  assert.match(sql, /alter\s+table\s+public\.robos_retro\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke\s+all\s+on\s+public\.robos_retro\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\._robos_retro_candidatos\(date,\s*int,\s*int,\s*numeric\)\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /grant\s+/i, "nenhum grant: ninguém lê a lista pela API");
});

test("refaz a série só com as funções que existem, e o desfazer está escrito", () => {
  assert.match(sql, /to_regprocedure\('public\.metrics_snapshot\(date\)'\)\s+is\s+not\s+null/i);
  assert.match(sql, /to_regprocedure\('public\.events_rollup\(date\)'\)\s+is\s+not\s+null/i);
  // O MAU olha 30 dias pra trás: a série é refeita até 30 dias depois.
  assert.match(sql, /least\(hoje,\s*v_fim\s*\+\s*30\)/i);
  assert.match(bruto, /DESFAZER[\s\S]*set bot = false from public\.robos_retro/i, "a receita de desfazer sumiu do cabeçalho");
});
