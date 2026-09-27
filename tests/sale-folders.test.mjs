// Pastas de venda (2026-09-27): cada pasta tem link público próprio,
// /users/<handle>/vendas/<slug do nome>. Três peças precisam concordar sobre o
// slug, e é isso que este arquivo trava:
//   - shared.saleFolderSlugs: o slug a partir do nome (a página de Vendas usa
//     pra montar o link que o "Compartilhar" copia);
//   - buildPublicPayload: grava o slug em cada item (sg) e a lista de pastas
//     (sales.groups) no perfil publicado — é o que o collection.js lê pra abrir
//     a pasta pelo caminho;
//   - a Function da borda (functions/users/[handle]/vendas/[pasta].js): acha a
//     pasta pelo slug no perfil e troca título/descrição/imagem da prévia.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";
import { metaDaPastaDeVenda, onRequestGet as rotaDaPasta } from "../functions/users/[handle]/vendas/[pasta].js";
import { onRequestGet as rotaDoPerfil } from "../functions/users/[handle].js";

const SALES_KEY = "tcg-collector-collection-sales-v1";

function sandboxCom(vendas, perfil) {
  const seed = { [SALES_KEY]: JSON.stringify(vendas) };
  if (perfil) seed["tcg-collector-profile-v1"] = JSON.stringify(perfil);
  return loadShared("window.__test = { buildPublicPayload };", { localStorage: makeLocalStorage(seed) });
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------
test("slug sai do nome: minúsculas, sem acento, hífen no lugar de espaço e pontuação", () => {
  const sb = loadShared("");
  const slugs = sb.TCGShared.saleFolderSlugs([
    { id: "a", name: "Cartas Raras" },
    { id: "b", name: "  Feira de Domingo!! (Centro) " },
    { id: "c", name: "Promoção — Pokémon/Lorcana" }
  ]);
  assert.equal(slugs.get("a"), "cartas-raras");
  assert.equal(slugs.get("b"), "feira-de-domingo-centro");
  assert.equal(slugs.get("c"), "promocao-pokemon-lorcana");
});

test("nome repetido ganha -2, -3 na ordem das pastas; nome sem letra latina vira 'pasta'", () => {
  const sb = loadShared("");
  const slugs = sb.TCGShared.saleFolderSlugs([
    { id: "a", name: "Raras" }, { id: "b", name: "raras" }, { id: "c", name: "RARAS" },
    { id: "d", name: "レア" }, { id: "e", name: "" }
  ]);
  assert.deepEqual([...slugs.values()], ["raras", "raras-2", "raras-3", "pasta", "pasta-2"]);
});

test("slug longo corta em 60 sem terminar em hífen", () => {
  const sb = loadShared("");
  const s = sb.TCGShared.saleFolderSlugs([{ id: "a", name: "x".repeat(59) + " yyyy" }]).get("a");
  assert.ok(s.length <= 60);
  assert.ok(!s.endsWith("-"));
});

test("link público da pasta: /users/<h>/vendas/<slug>; sem perfil público, null", () => {
  const publico = loadShared("", { localStorage: makeLocalStorage({ "tcg-collector-profile-v1": JSON.stringify({ handle: "fexpepe", isPublic: true }) }) });
  assert.equal(publico.TCGShared.publicProfileUrl("sales", "cartas-raras"), "https://sleevu.app/users/fexpepe/vendas/cartas-raras");
  assert.equal(publico.TCGShared.publicProfileUrl("sales"), "https://sleevu.app/users/fexpepe/vendas");
  const privado = loadShared("", { localStorage: makeLocalStorage({ "tcg-collector-profile-v1": JSON.stringify({ handle: "fexpepe", isPublic: false }) }) });
  assert.equal(privado.TCGShared.publicProfileUrl("sales", "cartas-raras"), null);
});

// ---------------------------------------------------------------------------
// Payload do perfil público
// ---------------------------------------------------------------------------
const CARTAS = [
  { id: "base1-4", name: "Charizard", set: "Base Set", number: "4", language: "en", game: "pokemon", image: "https://img/charizard.png" },
  { id: "base1-2", name: "Blastoise", set: "Base Set", number: "2", language: "en", game: "pokemon", image: "https://img/blastoise.png" },
  { id: "1-2", name: "Ariel", set: "The First Chapter", number: "2", language: "en", game: "lorcana", image: "https://img/ariel.avif" }
];
const NINGUEM = { has: () => false, variantTotal: () => 0, conditionBreakdown: () => [] };

test("payload: cada item leva o slug da pasta; item sem pasta cai na 1ª; pasta vazia não sai", () => {
  const sb = sandboxCom({
    sales: {
      "base1-4|Holo|0": { cardId: "base1-4", variant: "Holo", idx: 0, price: 350, cond: "NM", g: "vd_b" },
      "base1-2|Holo|0": { cardId: "base1-2", variant: "Holo", idx: 0, price: 120, cond: "LP", g: "vd_a" },
      "1-2|Foil|0": { cardId: "1-2", variant: "Foil", idx: 0, price: 30, cond: "NM" },
      "base1-2|Holo|1": { cardId: "base1-2", variant: "Holo", idx: 1, price: 99, cond: "NM", g: "vd_apagada" }
    },
    order: ["base1-4|Holo|0", "base1-2|Holo|0", "1-2|Foil|0", "base1-2|Holo|1"],
    groups: [{ id: "vd_a", name: "Feira de Domingo" }, { id: "vd_b", name: "Cartas Raras" }, { id: "vd_c", name: "Vazia" }]
  });
  // JSON: o objeto nasce no realm do vm, e o deepStrictEqual compara protótipos.
  const p = JSON.parse(JSON.stringify(sb.__test.buildPublicPayload(CARTAS, NINGUEM, null, false, "BRL")));
  assert.deepEqual(p.sales.groups, [{ id: "feira-de-domingo", name: "Feira de Domingo" }, { id: "cartas-raras", name: "Cartas Raras" }]);
  const porCarta = p.sales.items.map((it) => [it.id, it.sp, it.sg]);
  assert.deepEqual(porCarta, [
    ["base1-4", 350, "cartas-raras"],
    ["base1-2", 120, "feira-de-domingo"],
    ["1-2", 30, "feira-de-domingo"],        // sem pasta -> 1ª
    ["base1-2", 99, "feira-de-domingo"]     // pasta que não existe mais -> 1ª
  ]);
});

test("payload sem pasta nenhuma (lista de antes das pastas): grade plana, sem sg", () => {
  const sb = sandboxCom({
    sales: { "base1-4|Holo|0": { cardId: "base1-4", variant: "Holo", idx: 0, price: 350, cond: "NM" } },
    order: ["base1-4|Holo|0"]
  });
  // JSON: o objeto nasce no realm do vm, e o deepStrictEqual compara protótipos.
  const p = JSON.parse(JSON.stringify(sb.__test.buildPublicPayload(CARTAS, NINGUEM, null, false, "BRL")));
  assert.deepEqual(p.sales.groups, []);
  assert.equal(p.sales.items.length, 1);
  assert.ok(!("sg" in p.sales.items[0]), "sg indefinido não vai pro JSON publicado");
});

// ---------------------------------------------------------------------------
// Borda: prévia do link da pasta
// ---------------------------------------------------------------------------
const PERFIL = {
  handle: "fexpepe",
  display_name: "Fernando",
  show_values: true,
  data: {
    collection: { items: [] },
    sales: {
      cur: "BRL",
      groups: [{ id: "cartas-raras", name: "Cartas Raras" }, { id: "feira-de-domingo", name: "Feira de Domingo" }],
      items: [
        { id: "1-2", sp: 30, sg: "cartas-raras", img: "https://img/ariel.avif" },
        { id: "base1-4", sp: 350, sg: "cartas-raras", img: "https://img/charizard.webp" },
        { id: "base1-2", sp: 120, sg: "cartas-raras", img: "data/x/blastoise.png" },
        { id: "xy12-35", sp: 5, sg: "feira-de-domingo", img: "https://img/pikachu.jpg" }
      ]
    }
  }
};

test("meta da pasta: título com pasta e dono, total, canonical e imagem da carta mais cara", () => {
  const m = metaDaPastaDeVenda(PERFIL, "fexpepe", "cartas-raras");
  assert.equal(m.titulo, "Cartas Raras · Vendas de Fernando (@fexpepe) · Sleevu");
  assert.match(m.desc, /^3 cartas à venda · R\$\s?500,00 — /);
  assert.match(m.desc, /"Cartas Raras" de Fernando/);
  assert.equal(m.canonical, "https://sleevu.app/users/fexpepe/vendas/cartas-raras");
  // png/jpg primeiro (webp falha no WhatsApp), avif nunca; caminho relativo absolutizado.
  assert.equal(m.imagem, "https://sleevu.app/data/x/blastoise.png");
  const uma = metaDaPastaDeVenda(PERFIL, "fexpepe", "feira-de-domingo");
  assert.match(uma.desc, /^1 carta à venda/);
});

test("meta da pasta: pasta inexistente, perfil sem pastas ou sem cartas na pasta -> null", () => {
  assert.equal(metaDaPastaDeVenda(PERFIL, "fexpepe", "nao-existe"), null);
  assert.equal(metaDaPastaDeVenda({ data: { sales: { items: [{ sp: 1 }] } } }, "x", "a"), null);
  assert.equal(metaDaPastaDeVenda({ data: { sales: { groups: [{ id: "a", name: "A" }], items: [] } } }, "x", "a"), null);
  assert.equal(metaDaPastaDeVenda(null, "x", "a"), null);
});

// O encanamento da borda (HTMLRewriter, env.ASSETS) não existe em node: aqui
// ele é imitado só o bastante pra conferir QUE seletor recebe QUE valor e o
// status de cada desfecho da consulta.
class RewriterDeTeste {
  constructor() { this.regras = []; }
  on(sel, h) { this.regras.push([sel, h]); return this; }
  transform(resp) { return { rw: this, resp, status: 200 }; }
  valor(sel) {
    const r = this.regras.find(([s]) => s === sel);
    if (!r) return undefined;
    const el = { attrs: {}, texto: null, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute() {}, setInnerContent(v) { this.texto = v; }, remove() { this.removido = true; }, append(v) { this.append = v; } };
    r[1].element(el);
    return el.texto ?? el.attrs.content ?? el.attrs.href ?? (el.removido ? "REMOVIDO" : el.append);
  }
}
function contexto(params) {
  return {
    params,
    request: { url: "https://sleevu.app/users/" + params.handle },
    env: { ASSETS: { fetch: async (u) => new Response(`asset:${new URL(u).pathname}`, { headers: { "content-type": "text/html" } }) } }
  };
}
async function comFetch(resposta, fn) {
  const antes = { fetch: globalThis.fetch, HTMLRewriter: globalThis.HTMLRewriter };
  globalThis.HTMLRewriter = RewriterDeTeste;
  globalThis.fetch = async () => resposta;
  try { return await fn(); } finally { globalThis.fetch = antes.fetch; globalThis.HTMLRewriter = antes.HTMLRewriter; }
}
const ok = (rows) => ({ ok: true, status: 200, json: async () => rows });

test("rota da pasta: acha a pasta pelo slug e troca título, descrição, canonical e imagem", async () => {
  const r = await comFetch(ok([PERFIL]), () => rotaDaPasta(contexto({ handle: "FexPepe", pasta: "cartas-raras" })));
  assert.equal(r.rw.valor("title"), "Cartas Raras · Vendas de Fernando (@fexpepe) · Sleevu");
  assert.equal(r.rw.valor('link[rel="canonical"]'), "https://sleevu.app/users/fexpepe/vendas/cartas-raras");
  assert.equal(r.rw.valor('meta[property="og:image"]'), "https://sleevu.app/data/x/blastoise.png");
  assert.equal(r.rw.valor('meta[property="og:image:width"]'), "REMOVIDO");
  assert.equal(await r.resp.text(), "asset:/collection.html");
});

test("rota da pasta: pasta que não existe mais serve a SPA com canonical da aba e noindex", async () => {
  const r = await comFetch(ok([PERFIL]), () => rotaDaPasta(contexto({ handle: "fexpepe", pasta: "renomeada" })));
  assert.equal(r.rw.valor('link[rel="canonical"]'), "https://sleevu.app/users/fexpepe/vendas");
  assert.match(r.rw.valor("head"), /noindex/);
  assert.equal(r.rw.valor("title"), undefined);
});

test("rota da pasta: handle inexistente é 404 de verdade; consulta que falha NÃO é 404", async () => {
  const inexistente = await comFetch(ok([]), () => rotaDaPasta(contexto({ handle: "ninguem", pasta: "x" })));
  assert.equal(inexistente.status, 404);
  const falhou = await comFetch({ ok: false, status: 503, json: async () => null }, () => rotaDaPasta(contexto({ handle: "fexpepe", pasta: "cartas-raras" })));
  assert.notEqual(falhou.status, 404);
  assert.match(falhou.rw.valor("head"), /noindex/);
});

test("rota do perfil segue igual depois de a consulta ir pro _perfil.js", async () => {
  const perfil = { ...PERFIL, data: { ...PERFIL.data, collection: { items: [{ id: "a", vbrl: 10, q: 2, img: "https://img/a.jpg" }] } } };
  const r = await comFetch(ok([perfil]), () => rotaDoPerfil(contexto({ handle: "fexpepe" })));
  assert.equal(r.rw.valor("title"), "Fernando (@fexpepe) · Sleevu");
  assert.match(r.rw.valor('meta[name="description"]'), /^1 cartas · R\$ 20,00 — veja a coleção e a lista de Vendas e Trocas de Fernando/);
  assert.equal(r.rw.valor('meta[property="og:image"]'), "https://img/a.jpg");
  const inexistente = await comFetch(ok([]), () => rotaDoPerfil(contexto({ handle: "ninguem" })));
  assert.equal(inexistente.status, 404);
});
