// Alarme de medição parada em PESSOAS, não eventos (2026-11-04, migração
// 20261104a). A aba Medição acusou "parou" no card_added e no store_click sem
// nada quebrado: uma pessoa cadastrou 109 vezes numa noite e puxou a média dos
// 14 dias. A saída nova foi comparada com a da 20261017a num Postgres de
// verdade (PGlite), em 6 cenários — ver o README das migrações; aqui fica o
// que não pode regredir no texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Sem o \r do checkout do Windows (autocrlf): os recortes abaixo procuram \n.
const ler = (...p) => readFileSync(join(raiz, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase", "migrations", "20261104a_sentinela_pessoas.sql");
const funcao = (nome) => {
  const i = sql.indexOf(`function public.${nome}(`);
  assert.ok(i >= 0, `${nome} não está na migração`);
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3);
};
const corpo = funcao("_sentinela");
const cte = (nome) => {
  const m = new RegExp(`${nome} as \\(([\\s\\S]*?)\\n  \\),?\\n`).exec(corpo);
  assert.ok(m, `CTE ${nome} não encontrada`);
  return m[1].replace(/--.*$/gm, "");
};

test("o alarme sai das colunas de pessoas, com os limites de sempre", () => {
  assert.match(corpo, /pessoas_dia >= 3 and pessoas48h = 0 and esperado_pessoas >= 6 as alerta/);
  assert.doesNotMatch(corpo, /media_dia >= 3 and ultimas48h = 0/, "o alarme não pode voltar a contar eventos");
});

test("pessoa = visitante × dia contado pra trás a partir de agora", () => {
  const quem = /coalesce\(anon, ''\) \|\| '\/' \|\| floor\(extract\(epoch from now\(\) - ts\) \/ 86400\)::int as quem/g;
  assert.equal((corpo.match(quem) || []).length, 2, "por nome e por loja, com a mesma definição");
  assert.match(cte("por_pessoa"), /group by name, quem/);
  assert.match(cte("por_nome"), /count\(\*\) filter \(where n48 > 0\)::int as pessoas48h/);
  assert.match(cte("por_nome"), /count\(\*\) filter \(where n_antes > 0\) as pessoas_antes/);
});

test("o tráfego que escala o esperado também é em pessoas; o pageview segue média × 2", () => {
  assert.match(cte("trafego"), /from por_nome where alvo = 'pageview'/);
  assert.doesNotMatch(cte("trafego"), /group by/, "sem group by o agregado sempre devolve uma linha");
  assert.match(corpo, /when a\.alvo = 'pageview' or t\.gente_antes = 0 then a\.pessoas_antes::numeric \/ 7/);
  assert.match(corpo, /else a\.pessoas_antes::numeric \* t\.gente48 \/ t\.gente_antes end, 1\) as esperado_pessoas/);
});

test("as colunas em eventos seguem com a conta da 20261004a (o /admin de antes lê elas)", () => {
  assert.match(corpo, /when a\.alvo = 'pageview' or t\.pv_antes = 0 then a\.antes::numeric \/ 7/);
  assert.match(corpo, /else a\.antes::numeric \* t\.pv48 \/ t\.pv_antes end, 1\) as esperado48h/);
  assert.match(corpo, /returns table \(alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz,\s+esperado48h numeric, pessoas48h int, pessoas_dia numeric,\s+esperado_pessoas numeric, alerta boolean\)/);
  assert.match(sql, /drop function if exists public\._sentinela\(\);\ncreate function public\._sentinela\(\)/, "retorno novo exige drop + create");
});

test("a passada por nome sai só do índice: sem props, e o índice novo tem o anon", () => {
  assert.doesNotMatch(cte("por_pessoa"), /props/);
  assert.match(cte("por_pessoa"), /where not bot and ts >= now\(\) - interval '16 days'/);
  assert.match(cte("por_pessoa"), /name not in \('jserror', 'push_sent'\)/);
  assert.match(sql, /create index if not exists events_humano_ts_anon_idx on public\.events \(ts, name, anon\) where not bot;/);
  assert.match(sql, /drop index if exists public\.events_humano_ts_idx;/);
  assert.equal((corpo.match(/from events\b/g) || []).length, 2, "duas leituras do events, como na 20261017a");
});

test("fechada pra API; admin_health leva as colunas novas e repete os 30 s; analytics_sentinela intocada", () => {
  assert.match(sql, /revoke all on function public\._sentinela\(\) from public, anon, authenticated;/);
  const health = funcao("admin_health");
  assert.match(health, /set statement_timeout = '30s'/, "create or replace apaga o ajuste da 20261031a");
  for (const c of ["pessoas48h", "pessoas_dia", "esperado_pessoas", "esperado48h", "alerta"]) assert.match(health, new RegExp(`'${c}', ${c}`));
  assert.match(health, /if not _is_admin\(\) then return null; end if;/);
  assert.doesNotMatch(sql, /function public\.analytics_sentinela/, "recriar apagaria os 15 s da 20261017a");
});

test("nenhum cifrão dentro dos corpos (o SQL Editor do Supabase se perde)", () => {
  for (const nome of ["_sentinela", "admin_health"]) {
    const f = funcao(nome);
    assert.doesNotMatch(f.slice(f.indexOf("$$") + 2, f.lastIndexOf("$$")), /\$/);
  }
});

test("a aba Medição mostra pessoas quando o banco manda, e a tabela de antes quando não", () => {
  const admin = ler("src", "admin.js");
  const i = admin.indexOf("function tabMedicao(");
  const tab = admin.slice(i, admin.indexOf("\n  }\n", i));
  assert.match(tab, /const porPessoa = \(h\.alvos \|\| \[\]\)\.some\(\(a\) => a\.pessoas48h != null\)/);
  assert.match(tab, /a\.esperado_pessoas/);
  assert.match(tab, /a\.esperado48h/, "sem a migração, a tabela de antes");
  assert.match(tab, /Pessoa = um visitante num dia/);
});
