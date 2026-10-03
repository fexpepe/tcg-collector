// Aba Técnico › Qualidade v2 (2026-10-03, migração 20261003a,
// docs/PLANO-TECNICO.md D0/D3). Trava o contrato que faz o corte celular ×
// desktop valer: a RPC só responde pra admin, tira robô pelos DOIS lados
// (evento e pageview do mesmo navegador — o jserror antigo não mandava o
// webdriver), pega o aparelho do evento v2 e, no antigo, do pageview, e tira o
// hash da leva da assinatura (senão volta a ser uma linha por deploy). No
// admin.js, a v2 é opcional na aba: sem a migração, a tabela antiga continua.
// A RPC rodou num Postgres de verdade (PGlite) com eventos v1/v2 — ver a
// descrição da migração; aqui fica o que não pode regredir no texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(raiz, "supabase", "migrations", "20261003a_erros_v2.sql"), "utf8");
const admin = readFileSync(join(raiz, "src", "admin.js"), "utf8");
const corpo = sql.slice(sql.indexOf("create or replace function public.admin_erros"));

test("admin_erros: portão de admin, só leitura, sem anon", () => {
  assert.match(corpo, /returns jsonb language plpgsql stable security definer set search_path = public/);
  assert.match(corpo, /where user_id = auth\.uid\(\) and is_admin\) then return null/);
  assert.match(sql, /revoke all on function public\.admin_erros\(int\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.admin_erros\(int\) to authenticated;/);
  assert.doesNotMatch(corpo, /\b(insert|update|delete)\b\s/i, "a RPC de leitura não escreve");
  // o SQL Editor do Supabase parte o comando em regex que termina em cifrão
  // dentro do corpo (visto na 20260923a): nada de "$'" aqui
  assert.doesNotMatch(corpo.slice(corpo.indexOf("$$") + 2, corpo.lastIndexOf("$$")), /\$'/);
});

test("robô sai pelo evento e pelo pageview; aparelho do evento v2 ou do pageview", () => {
  assert.match(corpo, /bool_or\(bot or coalesce\(props->>'wd', ''\) = '1'\) as robo/);
  assert.match(corpo, /e\.bot or coalesce\(a\.robo, false\) as robo/);
  assert.match(corpo, /where not robo/);
  assert.match(corpo, /coalesce\(nullif\(e\.props->>'d', ''\), a\.d\) as d/);
});

test("a assinatura não carrega o hash da leva nem a origem", () => {
  assert.match(corpo, /'\\\.\[0-9a-f\]\{8\}\\\.\(js\|css\)', '\.\\1', 'g'\) as quadro/);
  assert.match(corpo, /'\^https\?:\/\/\(www\\\.\)\?sleevu\\\.app\/', ''/);
  assert.match(corpo, /group by classe, k, msg, quadro/);
});

test("admin.js: a v2 é opcional na Qualidade e o corte de aparelho existe", () => {
  assert.match(admin, /erros: "admin_erros"/);
  assert.match(admin, /qualidade: \["dash", "erros"\]/);
  assert.match(admin, /qualidade: \["erros"\]/, "sem a 20261003a a aba não pode ficar presa no aviso de migração");
  assert.match(admin, /erros: "20261003a_erros_v2\.sql"/);
  assert.match(admin, /data-aparelho="\$\{id\}"/);
  assert.match(admin, /function qualidadeV1\(/);
});
