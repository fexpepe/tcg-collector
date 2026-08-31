// Os nomes dos eventos de produto (E6) precisam bater EXATAMENTE com a whitelist
// do trigger `events_guard` no banco (migração 20260830a). O banco descarta
// CALADO o nome que não conhece — `return null` no BEFORE INSERT, e o PostgREST
// responde 201 do mesmo jeito. Ou seja: um nome errado aqui não gera erro
// nenhum, em lugar nenhum; simplesmente mede zero para sempre, e a gente só
// descobre meses depois olhando um painel vazio e achando que ninguém usa a
// feature.
//
// Este teste é a única coisa entre um typo e esse silêncio.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

// A whitelist como o BANCO a conhece, lida da migração — não copiada à mão pra
// cá, senão as duas listas divergiriam sem ninguém notar.
function nomesDaMigracao() {
  const sql = ler("supabase/migrations/20260830a_events_produto.sql");
  const bloco = /new\.name not in \(([\s\S]*?)\)\s*\n?\s*then return null/.exec(sql);
  assert.ok(bloco, "não achei a whitelist no SQL da migração");
  return new Set([...bloco[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

// E como o CLIENTE a conhece.
function nomesDoCliente() {
  const js = ler("src/shared.js");
  const bloco = /const EVENTOS = \[([^\]]*)\]/.exec(js);
  assert.ok(bloco, "não achei a lista EVENTOS no shared.js");
  return new Set([...bloco[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

test("todo nome que o cliente envia existe na whitelist do banco", () => {
  const banco = nomesDaMigracao();
  for (const nome of nomesDoCliente()) {
    assert.ok(banco.has(nome), `'${nome}' não está na whitelist do events_guard — seria descartado em silêncio`);
  }
});

test("o pageview e o jserror continuam na whitelist", () => {
  // Eles não passam pelo logEvento, mas vivem na MESMA lista do banco: uma
  // migração futura que reescreva a função sem eles derrubaria o analytics
  // inteiro sem erro nenhum.
  const banco = nomesDaMigracao();
  assert.ok(banco.has("pageview"), "pageview saiu da whitelist");
  assert.ok(banco.has("jserror"), "jserror saiu da whitelist");
});

test("os cinco eventos de produto estão declarados no cliente", () => {
  const cliente = nomesDoCliente();
  for (const nome of ["export_done", "import_done", "deck_created", "backup_done", "share_created"]) {
    assert.ok(cliente.has(nome), `${nome} não está em EVENTOS`);
  }
});

test("todo logEvento do código usa um nome declarado", () => {
  // Pega o typo no lugar onde ele de fato acontece: na chamada.
  const cliente = nomesDoCliente();
  for (const arquivo of ["src/shared.js", "src/decks.js"]) {
    for (const m of ler(arquivo).matchAll(/logEvento\(\s*"([a-z_]+)"/g)) {
      assert.ok(cliente.has(m[1]), `${arquivo} chama logEvento("${m[1]}"), que não está em EVENTOS`);
    }
  }
});
