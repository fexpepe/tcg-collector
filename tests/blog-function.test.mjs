// Functions do blog (functions/blog/): o que tem regra de verdade fora do
// encanamento da borda (HTMLRewriter, env.ASSETS e caches não rodam em node).
//   - meta/JSON-LD do post: título no orçamento, descrição, canonical, capa;
//   - "leia também": mesmo jogo primeiro;
//   - filtros do /blog: só valores conhecidos (o resto nem entra na chave do cache);
//   - cartas citadas: as MESMAS consultas da /api/collection, num SQLite real
//     com o esquema do D1, incluindo o preço da carta base pra localizada.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, SCHEMA_PRICES } from "../functions/api/_search-sql.js";
import { metaDoPost, escolheRelacionados } from "../functions/blog/[slug].js";
import { filtrosDaUrl, aplicaFiltros } from "../functions/blog/index.js";
import { cartasDoD1 } from "../functions/blog/_comum.js";

const POST = {
  id: "11111111-1111-1111-1111-111111111111", slug: "guia-do-charizard", title: "Guia do Charizard",
  subtitle: "", excerpt: "", body_md: "O **Charizard** do Base Set é a carta mais famosa do Pokémon TCG. ".repeat(10),
  cover_url: "https://dlnalopazitfdgnmdguu.supabase.co/storage/v1/object/public/blog-media/2026/09/c-w1200h630.webp",
  cover_alt: "", game: "pokemon", category: "guias", tags: ["vintage", "base set"], lang: "pt",
  seo_title: "", seo_desc: "", author_name: "Fernando", published_at: "2026-09-30T12:00:00Z", updated_at: "2026-09-30T13:00:00Z"
};

test("metaDoPost: título com a marca quando cabe, descrição do resumo, capa e JSON-LD BlogPosting", () => {
  const m = metaDoPost(POST);
  assert.equal(m.titulo, "Guia do Charizard | Sleevu");
  assert.equal(m.canonical, "https://sleevu.app/blog/guia-do-charizard");
  assert.ok(m.desc.length <= 155 && m.desc.startsWith("O Charizard do Base Set"), m.desc);
  assert.equal(m.imagem, POST.cover_url);
  const [artigo, trilha] = m.jsonLd["@graph"];
  assert.equal(artigo["@type"], "BlogPosting");
  assert.equal(artigo.inLanguage, "pt-BR");
  assert.deepEqual(artigo.author, { "@type": "Person", name: "Fernando" });
  assert.equal(artigo.articleSection, "Guias");
  assert.equal(artigo.keywords, "vintage, base set");
  assert.deepEqual(trilha.itemListElement.map((i) => i.name), ["Blog", "Guias", "Guia do Charizard"]);
});

test("metaDoPost: título longo sem a marca; SEO do editor manda; sem autor = organização; capa fora da CSP some", () => {
  const longo = Object.assign({}, POST, { title: "x".repeat(60), author_name: "", cover_url: "https://evil.example/a.png" });
  const m = metaDoPost(longo);
  assert.equal(m.titulo, "x".repeat(60));
  assert.equal(m.imagem, "");
  assert.equal(m.jsonLd["@graph"][0].author["@type"], "Organization");
  assert.equal(m.jsonLd["@graph"][0].image, undefined);
  const seo = metaDoPost(Object.assign({}, POST, { seo_title: "Charizard: guia", seo_desc: "Tudo sobre." }));
  assert.equal(seo.titulo, "Charizard: guia | Sleevu");
  assert.equal(seo.desc, "Tudo sobre.");
});

test("escolheRelacionados: mesmo jogo primeiro, sem o próprio post, no máximo 3", () => {
  const lista = [
    { slug: "guia-do-charizard", game: "pokemon" }, { slug: "a", game: "magic" }, { slug: "b", game: "pokemon" },
    { slug: "c", game: "lorcana" }, { slug: "d", game: "pokemon" }
  ];
  assert.deepEqual(escolheRelacionados(POST, lista).map((p) => p.slug), ["b", "d", "a"]);
  assert.deepEqual(escolheRelacionados(Object.assign({}, POST, { game: "" }), lista).map((p) => p.slug), ["a", "b", "c"]);
});

test("filtros do /blog: só categoria e jogo conhecidos; tag aparada", () => {
  const u = (q) => new URL("https://sleevu.app/blog" + q);
  assert.deepEqual(filtrosDaUrl(u("?cat=guias&jogo=pokemon&tag=%20Vintage%20")), { cat: "guias", jogo: "pokemon", tag: "Vintage" });
  assert.deepEqual(filtrosDaUrl(u("?cat=%3Cx%3E&jogo=inventado&utm_source=x")), { cat: "", jogo: "", tag: "" });
  const posts = [
    { slug: "1", category: "guias", game: "pokemon", tags: ["Vintage"] },
    { slug: "2", category: "mercado", game: "pokemon", tags: [] },
    { slug: "3", category: "guias", game: "magic", tags: ["vintage"] }
  ];
  assert.deepEqual(aplicaFiltros(posts, { cat: "guias", jogo: "", tag: "" }).map((p) => p.slug), ["1", "3"]);
  assert.deepEqual(aplicaFiltros(posts, { cat: "", jogo: "pokemon", tag: "vintage" }).map((p) => p.slug), ["1"]);
});

// D1 de mentira em cima de um SQLite real: prepare().bind().all() → { results }.
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(SCHEMA_PRICES);
  const carta = db.prepare(`INSERT INTO cards (game,id,name,set_name,number,card_type,cost,rarity,color,set_id,artist,language,image,variants,released)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  carta.run("pokemon", "base1-4", "Charizard", "Base Set", "4", "", "", "Rare", "Fire", "base1", "Arita", "en", "https://assets.tcgdex.net/en/base/base1/4", "[]", "1999-01-09");
  carta.run("pokemon", "base1-4-pt", "Charizard", "Base Set", "4", "", "", "Rare", "Fire", "base1", "Arita", "pt", "https://assets.tcgdex.net/pt/base/base1/4", "[]", "1999-01-09");
  carta.run("magic", "m-1", "Black Lotus", "Alpha", "232", "", "", "Rare", "", "lea", "", "en", "https://cards.scryfall.io/large/front/a.jpg", "[]", "1993-08-05");
  const preco = db.prepare("INSERT INTO prices (game,id,j) VALUES (?,?,?)");
  preco.run("pokemon", "base1-4", JSON.stringify({ u: 320.5 }));
  preco.run("magic", "m-1", JSON.stringify({ e: 20000 }));
  return {
    prepare(sql) {
      return { bind: (...params) => ({ all: async () => ({ results: db.prepare(sql).all(...params) }) }) };
    }
  };
}

test("cartasDoD1: carta e preço formatado; localizada usa o preço da base; jogo/ref inválidos caem", async () => {
  const mapa = await cartasDoD1({ DB: d1() }, ["pokemon/base1-4", "pokemon/base1-4-pt", "magic/m-1", "inventado/x", "pokemon/nao-existe", "lixo"], "pt");
  assert.deepEqual([...mapa.keys()].sort(), ["magic/m-1", "pokemon/base1-4", "pokemon/base1-4-pt"]);
  assert.deepEqual(mapa.get("pokemon/base1-4"), {
    name: "Charizard", set: "Base Set", setId: "base1", number: "4", image: "https://assets.tcgdex.net/en/base/base1/4", price: "US$ 320,50"
  });
  assert.equal(mapa.get("pokemon/base1-4-pt").price, "US$ 320,50", "a -pt sem preço próprio cai na base");
  assert.equal(mapa.get("magic/m-1").price, "€ 20.000,00");
});

test("cartasDoD1: sem banco (ou banco fora) o post sai sem cartas em vez de quebrar", async () => {
  assert.equal((await cartasDoD1({}, ["pokemon/base1-4"], "pt")).size, 0);
  const quebrado = { prepare() { return { bind: () => ({ all: async () => { throw new Error("D1 fora"); } }) }; } };
  assert.equal((await cartasDoD1({ DB: quebrado }, ["pokemon/base1-4"], "pt")).size, 0);
});
