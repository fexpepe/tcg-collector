// Skip-link ("Pular para o conteúdo", injetado pelo initPageNav do
// src/shared.js). Com <base href="/"> (collection.html, que também serve o
// perfil público em /users/<handle>, blog-post.html e 404.html) o href
// "#main" resolve em "/#main": o Enter no skip-link levava pra HOME em vez de
// pular pro <main> (2026-09-30). O teste imita o navegador ao ativar o link:
// roda os ouvintes de clique e, se nenhum cancelou, segue o href resolvido
// contra a base. Passa qualquer implementação que não saia da página e ponha
// o foco no <main>, inclusive depois de o perfil trocar o caminho por pushState.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

// Página de mentira: só o que o initPageNav toca pra montar o skip-link.
// Sem .page-nav, ele para logo depois (o menu não entra aqui).
function montaPagina(url, base) {
  const u = new URL(url);
  const location = { pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin, hostname: u.hostname, href: u.href };
  const sb = loadShared("window.__test = { initPageNav };", { location });
  const main = {
    id: "", attrs: {}, focado: false,
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    focus() { this.focado = true; }
  };
  let skip = null;
  sb.document.querySelector = (sel) => (sel === "main" ? main : sel === "base" && base ? { href: new URL(base, u).href } : null);
  sb.document.createElement = (tag) => {
    const el = { tagName: tag.toUpperCase(), href: "", ouvintes: [], addEventListener(tipo, fn) { if (tipo === "click") this.ouvintes.push(fn); } };
    if (tag === "a") skip = el;
    return el;
  };
  sb.document.body = { firstChild: null, insertBefore() {} };
  sb.window.__test.initPageNav();
  assert.ok(skip, "o initPageNav não criou o skip-link");
  return { location, main, skip, base };
}

// Troca o caminho como o history.pushState faz (o perfil faz isso a cada aba).
function pushState(pagina, caminho) {
  const u = new URL(caminho, pagina.location.href);
  Object.assign(pagina.location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
}

// Enter/clique no link: devolve pra onde o navegador iria, ou null se algum
// ouvinte cancelou a navegação.
function ativa({ location, skip, base }) {
  const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  skip.ouvintes.forEach((fn) => fn.call(skip, ev));
  if (ev.defaultPrevented) return null;
  return new URL(skip.href, base ? new URL(base, location.href) : location.href).href;
}

// Ou fica (e o foco pousa no <main>), ou vai só pro fragmento da própria URL,
// que o navegador trata sem recarregar e focando o alvo sozinho.
function confereQueFicaNaPagina(pagina) {
  const destino = ativa(pagina);
  if (destino === null) assert.ok(pagina.main.focado, "cancelou a navegação mas não pôs o foco no <main>");
  else assert.equal(destino, pagina.location.href.replace(/#.*$/, "") + "#" + pagina.main.id, "o skip-link saiu da página");
}

test("o <main> vira alvo focável e o skip-link continua sendo um link pra ele", () => {
  const p = montaPagina("https://sleevu.app/sets?game=pokemon");
  assert.equal(p.main.id, "main");
  assert.equal(p.main.attrs.tabindex, "-1");
  assert.equal(p.skip.className, "skip-link");
  assert.ok(p.skip.href.endsWith("#main"), `href sem o alvo: ${p.skip.href}`);
});

test("perfil em /users/<handle> (com <base href=\"/\">): fica na página em vez de ir pra home", () => {
  confereQueFicaNaPagina(montaPagina("https://sleevu.app/users/fulano", "/"));
});

test("perfil depois de abrir uma aba (pushState): fica na aba aberta, sem recarregar a do carregamento", () => {
  const p = montaPagina("https://sleevu.app/users/fulano", "/");
  pushState(p, "/users/fulano/sets/pokemon/Base%20Set");
  confereQueFicaNaPagina(p);
});

test("post do blog em /blog/<slug> (também com <base href=\"/\">)", () => {
  confereQueFicaNaPagina(montaPagina("https://sleevu.app/blog/como-guardar-cartas", "/"));
});

test("404.html num caminho fundo (também com <base href=\"/\">)", () => {
  confereQueFicaNaPagina(montaPagina("https://sleevu.app/a/b/c?x=1", "/"));
});

test("página sem <base> segue funcionando", () => {
  confereQueFicaNaPagina(montaPagina("https://sleevu.app/sets?game=pokemon"));
});
