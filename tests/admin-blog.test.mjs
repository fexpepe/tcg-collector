// /admin: o BLOG post por post (2026-11-21, migração 20261121a).
//
// O pedido: saber quantas pessoas abriram cada post, de onde vieram e que
// tipo de post rende mais. O `path` do evento é o 1º segmento do endereço,
// então /blog e /blog/<post> viravam o mesmo "blog". O que se trava aqui:
//   - o cliente: todo evento numa página de post leva em props.bp o que vem
//     depois de /blog/ ("<post>" ou "<idioma>/<post>"); a lista, o editor e o
//     resto do site, nada;
//   - o admin: a aba Conteúdo › Blog busca a admin_blog, avisa a migração
//     certa quando ela falta, e chama cada categoria pelo nome que o blog usa;
//   - o SQL: o portão, os 30 s, uma passada só em events, nenhum cifrão, e só
//     conta endereço que é de post publicado.
// O comportamento do SQL foi ensaiado no PGlite (README das migrações); aqui
// fica a forma, que é o que uma edição futura quebra sem perceber.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import "../src/blog-render.js";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const admin = ler("src/admin.js");
const sql = ler("supabase/migrations/20261121a_admin_blog.sql");

// ── Cliente ──────────────────────────────────────────────────────────────────
// O shared.js num navegador de mentira em PRODUÇÃO (sleevu.app, medição
// ligada) na página `pathname`. Devolve o corpo de cada POST pro
// /rest/v1/events.
function eventos(pathname) {
  const enviados = [];
  loadShared("", {
    localStorage: makeLocalStorage({ "sleevu-consent-v1": JSON.stringify({ analytics: true }) }),
    location: { pathname, search: "", hash: "", origin: "https://sleevu.app", hostname: "sleevu.app", href: `https://sleevu.app${pathname}` },
    antes: (sb) => {
      sb.SLEEVU = { game: "hub", line: "" };
      sb.document.cookie = "";
      sb.fetch = (url, init) => {
        if (String(url).includes("/rest/v1/events") && init && init.body) enviados.push(JSON.parse(init.body));
        return Promise.resolve({ ok: false, status: 599, json: async () => null, text: async () => "" });
      };
    }
  });
  return enviados;
}
const pageview = (lista) => lista.find((e) => e.name === "pageview");

test("pageview de um post leva o post (props.bp) e continua sendo a página 'blog'", () => {
  const pv = pageview(eventos("/blog/guia-de-condicao"));
  assert.ok(pv, "o pageview saiu");
  assert.equal(pv.path, "blog", "o path não muda: as abas de Páginas seguem somando o blog inteiro");
  assert.equal(pv.props.bp, "guia-de-condicao");
  assert.equal(pv.props.d, "d", "o resto do contexto continua indo junto");
});

test("a tradução leva o idioma na frente, como está no endereço", () => {
  assert.equal(pageview(eventos("/blog/en/bandai-carddass-history")).props.bp, "en/bandai-carddass-history");
  assert.equal(pageview(eventos("/blog/es/guia-de-condicao")).props.bp, "es/guia-de-condicao");
});

test("a lista, o editor e o resto do site não levam bp", () => {
  for (const p of ["/blog", "/blog/", "/blog-editor", "/blog.html", "/", "/cards", "/games/pokemon", "/users/blog"]) {
    const pv = pageview(eventos(p));
    assert.ok(pv, p);
    assert.ok(!pv.props || !Object.prototype.hasOwnProperty.call(pv.props, "bp"), `${p} não leva bp`);
  }
});

test("os outros eventos da página do post levam o post pelo mesmo cano (mandaEvento)", () => {
  const js = ler("src/shared.js");
  const corpo = js.slice(js.indexOf("function mandaEvento("), js.indexOf("function logPageview("));
  assert.ok(corpo.includes("if (/^\\/blog\\/./.test(location.pathname)) (props = props || {}).bp = location.pathname.slice(6);"));
  assert.ok(corpo.indexOf(".bp = location.pathname.slice(6)") < corpo.indexOf("if (props) corpo.props = props;"), "o post entra antes de o corpo ser montado");
  // É o que dá o tempo de leitura por post (page_time) e a carta marcada e o
  // clique em loja feitos no post: todos saem pelo logEvento, que só repassa.
  // (O erro de JS monta o próprio corpo e fica sem o post, de propósito.)
  assert.ok(/function logEvento\(nome, props\) \{\s+if \(EVENTOS\.indexOf\(nome\) < 0\) return;\s+mandaEvento\(nome, props\);\s+\}/.test(js));
  for (const nome of ["page_time", "store_click"]) assert.ok(js.includes(`logEvento("${nome}", `), nome);
});

// ── Admin ────────────────────────────────────────────────────────────────────
const linhas = admin.split("\n");
const grupo = (id) => linhas.find((l) => l.trim().startsWith(`["${id}", `)) || "";

test("aba Blog no grupo Conteúdo, ligada à admin_blog", () => {
  assert.ok(grupo("conteudo").includes('["sets", "Sets"], ["blog", "Blog"]]'), grupo("conteudo"));
  const ids = [...admin.matchAll(/\["(\w+)", "[^"]+"\]/g)].map((m) => m[1]);
  assert.equal(ids.filter((x) => x === "blog").length, 1, "aba blog em um grupo só");
  assert.ok(admin.includes('    blog: ["blog"],'), "NEEDS da aba");
  assert.ok(admin.includes('blog: "admin_blog"'), "RPC");
  assert.ok(admin.includes('blog: "20261121a_admin_blog.sql"'), "MIGRACAO aponta o arquivo");
  assert.ok(admin.includes("blog: (x) => tabBlog(x.blog)"), "RENDER");
  assert.ok(admin.includes('if (keys.every((k) => k === "blog")) return pedeBlog('), "migração faltando = o aviso da 20261121a, não o da 20260923a");
  assert.ok(admin.includes("supabase/migrations/20261121a_admin_blog.sql</code>"), "o aviso aponta a migração");
});

test("as categorias do admin têm o nome que o blog usa (pt do blog-render.js)", () => {
  const i = admin.indexOf("const BLOG_CAT = {");
  assert.ok(i >= 0, "BLOG_CAT no admin.js");
  const nomes = vm.runInNewContext(`(${admin.slice(i + "const BLOG_CAT = ".length, admin.indexOf("};", i) + 1)})`);
  const doBlog = {};
  for (const [k, v] of Object.entries(globalThis.SleevuBlog.CATEGORIAS)) doBlog[k] = v.pt;
  assert.deepEqual({ ...nomes }, doBlog, "categoria nova no blog-render.js entra também no BLOG_CAT");
});

test("aba Blog: sem histórico, régua só com o anterior completo, post zerado na lista", () => {
  const i = admin.indexOf("function tabBlog(bl) {");
  assert.ok(i >= 0);
  const f = admin.slice(i, admin.indexOf("\n  }\n", i));
  assert.ok(f.includes("const cmp = !!bl.comparavel;"));
  assert.ok(f.includes("const dL = (a, b) => (cmp ? ` ${deltaChip(a, b)}` : \"\");"), "sem anterior completo, sem régua");
  assert.ok(f.includes("!bl.desde ?"), "sem evento com post ainda = aviso, não tela vazia");
  assert.ok(f.includes("Não há histórico de antes"));
  assert.ok(f.includes("posts.map(linha)"), "todos os publicados, não só os lidos");
  // A chave dos mapas por post é o endereço do post, que vem do banco:
  // "constructor" é um endereço válido e acharia a função do protótipo.
  assert.ok(f.includes("const canaisDe = Object.create(null), origensDe = Object.create(null);"));
  assert.ok(f.includes('href="/blog/${esc(encodeURIComponent(p.slug))}"'), "o título abre o post");
  const css = ler("styles.css");
  assert.ok(css.includes(".admin-table td.adm-post { min-width: 200px; }"), "no celular o título não quebra numa palavra por linha");
});

// ── SQL ──────────────────────────────────────────────────────────────────────
const corpo = (texto, nome) => {
  const i = texto.indexOf(`create or replace function public.${nome}(`);
  assert.ok(i >= 0, nome);
  return texto.slice(i, texto.indexOf("end $$;", i));
};

test("admin_blog: portão, fechada pro anon, 30 s, só a janela, sem cifrão", () => {
  const f = corpo(sql, "admin_blog");
  assert.ok(f.includes("if not _is_admin() then return null; end if;"));
  assert.ok(f.includes("set statement_timeout = '30s'"), "RPC nova nasce com o tempo-limite (a 20261031a não alcança)");
  assert.ok(f.includes("where not bot and ts >= ant and anon is not null"), "só gente, só a janela de 2 × days");
  assert.equal(f.split("from events").length - 1, 1, "uma passada só na tabela de eventos");
  assert.ok(sql.includes("revoke all on function public.admin_blog(int) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.admin_blog(int) to authenticated;"));
  assert.ok(!sql.replace(/^--.*$/gm, "").split("$$").join("").includes("$"), "nenhum cifrão dentro de corpo de função (o SQL Editor se perde)");
  assert.ok(f.includes("'migration', '20261121a'"));
});

test("admin_blog: o post vem do bp, e só conta o que é post publicado", () => {
  const f = corpo(sql, "admin_blog");
  assert.ok(f.includes("case when b.path = 'blog' then nullif(left(regexp_replace(coalesce(b.props->>'bp', ''), '/+\\Z', ''), 120), '') end as bp"),
    "só em página do blog, sem a barra do fim e com teto de tamanho");
  assert.ok(f.includes("from posts where status = 'published' and published_at <= now()"), "rascunho e agendado ficam de fora");
  assert.ok(f.includes("left join pub p on p.slug = case when c.bp ~ '^(pt|en|es)/' then substr(c.bp, 4) else c.bp end"), "o prefixo de idioma sai antes de casar com o slug");
  assert.ok(f.includes("from s2 where slug is not null and jan is not null"), "leitura = página de post publicado");
  assert.ok(f.includes("quem as (select distinct anon from bruto where name = 'pageview' and path = 'blog')"), "as visitas são só de quem passou pelo blog");
  assert.ok(f.includes("interval '30 minutes'"), "a mesma visita de 30 min da admin_paginas");
});

test("admin_blog: de onde veio, o que fez depois e por tipo de post", () => {
  const f = corpo(sql, "admin_blog");
  assert.ok(f.includes("_canal(p0->>'r', p0->>'u') as canal"), "o canal é o da 1ª página da VISITA");
  assert.ok(f.includes("count(*) filter (where path <> 'blog') over (partition by anon, sid order by ts rows between 1 following and unbounded following) as fora_depois"),
    "seguiu pro site = página fora do blog DEPOIS, na mesma visita");
  assert.ok(f.includes("join contas c on c.anon = p.anon and c.jan = p.jan and c.ts >= p.t0"), "conta criada depois da 1ª leitura, não antes");
  assert.ok(f.includes("least(_int(props->>'ms'), 1800000)"), "o tempo tem o teto de 30 min das outras RPCs");
  assert.ok(f.includes("least(_int(props->>'n'), 100000)"), "o n do card_added tem o mesmo teto da admin_pulso");
  for (const k of ["'posts'", "'categorias'", "'jogos'", "'tags'", "'canais'", "'origens'", "'post_canal'", "'post_origem'", "'paises'", "'aparelhos'", "'versoes'", "'lista'", "'serie'", "'atual'", "'anterior'", "'desde'", "'comparavel'", "'publicados'"]) {
    assert.ok(f.includes(k), k);
  }
  assert.ok(f.includes("from pub p\n    left join por a on a.slug = p.slug and a.jan = 'a'"), "post sem leitura entra zerado");
  assert.ok(f.includes("coalesce(x.desde < ant + interval '36 hours', false)"), "a mesma régua de comparável das linhas");
});
