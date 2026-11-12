// /admin v5 (2026-11-11, migração 20261111g): o grupo Conteúdo e o
// movimento por jogo.
//
// O que se trava aqui:
//   - o grupo Conteúdo tem Jogos, Coleções, Demanda e Sets, e essas abas
//     saíram de Mercado com os MESMOS ids (link salvo #conteudo, #demanda,
//     #sets segue abrindo);
//   - a aba Jogos busca a admin_jogos e aponta a migração certa; no Resumo e
//     no kit ela é opcional (sem a migração, o resto da aba pinta);
//   - o SQL: portão, fechada pro anon, 30 s, só a janela de 2 × days, uma
//     passada só em events e nenhum cifrão no corpo;
//   - a capa do kit: logos em no máximo 3 fileiras. A página é A4 de altura
//     fixa e o que passa some calado — com 30 jogos em 7 colunas, o gráfico
//     de crescimento ia parar embaixo do rodapé.
// O comportamento do SQL foi ensaiado no PGlite (README das migrações); aqui
// fica a forma, que é o que uma edição futura quebra sem perceber.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261111g_admin_jogos.sql");
const css = ler("styles.css");
const linhas = admin.split("\n");
const grupo = (id) => linhas.find((l) => l.trim().startsWith(`["${id}", `)) || "";

test("grupo Conteúdo: Jogos, Coleções, Demanda e Sets; Mercado fica com loja e vitrine", () => {
  assert.ok(grupo("conteudo").includes('[["jogos", "Jogos"], ["conteudo", "Coleções"], ["demanda", "Demanda"], ["sets", "Sets"]]'), grupo("conteudo"));
  assert.ok(grupo("mercado").includes('[["lojas", "Lojas"], ["portal", "Portal da loja"], ["anuncios", "Vitrine"]]'), grupo("mercado"));
  const ids = [...admin.matchAll(/\["(\w+)", "[^"]+"\]/g)].map((m) => m[1]);
  for (const id of ["conteudo", "demanda", "sets"]) assert.equal(ids.filter((x) => x === id).length, 1, `aba ${id} em um grupo só`);
  assert.ok(admin.includes("    conteudo: `<rect"), "o grupo tem ícone na barra lateral");
});

test("aba Jogos: busca a admin_jogos; no Resumo e no kit ela é opcional", () => {
  assert.ok(admin.includes('    jogos: ["jogos"],'), "NEEDS da aba");
  assert.ok(admin.includes('jogos: "admin_jogos"'), "RPC");
  assert.ok(admin.includes('jogos: "20261111g_admin_jogos.sql"'), "MIGRACAO aponta o arquivo");
  assert.ok(admin.includes("jogos: (x) => tabJogos(x.jogos)"), "RENDER");
  assert.ok(admin.includes('geral: ["dash", "pulso", "notas", "geo", "jogos"]'), "o Resumo busca");
  assert.ok(admin.includes('geral: ["pulso", "notas", "geo", "jogos"]'), "…e não trava sem ela");
  assert.ok(admin.includes('parceiros: ["users", "anuncios", "pulso", "geo", "jogos"]'), "o kit não trava sem as RPCs novas");
  assert.ok(admin.includes('if (keys.every((k) => k === "jogos")) return pedeJogos('), "migração faltando = o aviso da 20261111g, não o da 20260923a");
});

// ── SQL ──────────────────────────────────────────────────────────────────────
const corpo = (texto, nome) => {
  const i = texto.indexOf(`create or replace function public.${nome}(`);
  assert.ok(i >= 0, nome);
  return texto.slice(i, texto.indexOf("end $$;", i));
};

test("admin_jogos: portão, fechada pro anon, 30 s e só a janela", () => {
  const f = corpo(sql, "admin_jogos");
  assert.ok(f.includes("if not _is_admin() then return null; end if;"));
  assert.ok(f.includes("set statement_timeout = '30s'"), "RPC nova nasce com o tempo-limite (a 20261031a não alcança)");
  assert.ok(f.includes("where not bot and ts >= ant"), "só a janela de 2 × days, nunca o histórico");
  assert.equal(f.split("from events").length - 1, 1, "uma passada só na tabela de eventos");
  assert.ok(f.includes("from card_views_daily where day >= ini_d - d"), "as cartas abertas também só na janela");
  assert.ok(sql.includes("revoke all on function public.admin_jogos(int) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.admin_jogos(int) to authenticated;"));
  assert.ok(!sql.replace(/^--.*$/gm, "").split("$$").join("").includes("$"), "nenhum cifrão dentro de corpo de função (o SQL Editor se perde)");
});

test("admin_jogos: o clique em loja leva o jogo da carta; o resto, o da página", () => {
  const f = corpo(sql, "admin_jogos");
  assert.ok(f.includes("when name = 'store_click' and coalesce(props->>'g', '') <> '' then left(props->>'g', 32)"));
  assert.ok(f.includes("else coalesce(nullif(game, ''), 'hub') end as jogo"));
  assert.ok(f.includes("least(_int(props->>'n'), 100000)"), "o n do card_added tem o mesmo teto da admin_pulso");
});

test("README das migrações lista a 20261111g pra aplicar", () => {
  const readme = ler("supabase/migrations/README.md");
  const pend = readme.slice(readme.indexOf("## Pendentes de aplicar"), readme.indexOf("### Já aplicadas"));
  assert.ok(pend.includes("`20261111g`"), "a 20261111g está em Pendentes");
});

// ── Kit para parceiros ───────────────────────────────────────────────────────
test("capa do kit: os logos cabem em 3 fileiras com qualquer número de jogos", () => {
  assert.ok(admin.includes("const colunasLogo = Math.max(7, Math.ceil(Object.keys(KIT_LOGO).length / 3));"));
  assert.ok(admin.includes('<ul class="adm-kit-logos" style="--kit-cols:${colunasLogo}">'));
  assert.ok(css.includes("grid-template-columns: repeat(var(--kit-cols, 7), minmax(0, 1fr))"), "o CSS lê a coluna do JS");
  const bloco = admin.slice(admin.indexOf("const KIT_LOGO = {"), admin.indexOf("};", admin.indexOf("const KIT_LOGO = {")));
  const n = (bloco.match(/: "game_/g) || []).length;
  assert.ok(n >= 25, `${n} logos no kit`);
  for (const jogos of [n, n + 6, 40]) {
    const cols = Math.max(7, Math.ceil(jogos / 3));
    assert.ok(Math.ceil(jogos / cols) <= 3, `${jogos} jogos em ${cols} colunas`);
  }
});
