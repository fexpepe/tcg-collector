// Marvel Hero Rush (jogo herorush, 2026-11-19): o id por número e raridade, o
// nome dos sets, a imagem pela chave (a URL da fonte é assinada e vence) e a
// troca da matriz no espelho. Sem rede: fixtures no formato da API oficial.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETS, cardOf, dataDoProduto, montaCatalogo, montaSets, nomeDaCarta, nomeDoProduto, setIdDe } from "../scripts/sync-herorush.mjs";
import { aplicaAssinadas, assinadasDe, chaveDaBase, listaCartas, urlDoCatalogo } from "../scripts/lib/herorush-fonte.mjs";
import { chaveBase, chaveDe, matrizDe } from "../scripts/lib/img-mirror.mjs";

const catalogo = () => {
  const s = readFileSync(new URL("../data/herorush/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

const CHAVE = "6a86a5cd9da74fc0904ed73a";
const imagem = (key = CHAVE) => ({
  key, url: `https://marvel-tcg.janime.cn/${key}?e=1795151848&token=abc:def=`,
  variants: { original: { url: `https://marvel-tcg.janime.cn/${key}?e=1795151848&token=abc:orig=` }, small: { url: `https://marvel-tcg.janime.cn/${key}?imageView2/2/w/320&e=1&token=x` } }
});
const registro = (extra) => ({
  attack_range: "1", attribute: "Red", card_no: "BP01-001", card_type: "character", effect: "…", environment: "S1",
  feature: "Human/Avengers", id: "6a86a6bc9da74fc0904ed862", image: imagem(), language: "en", level: "6",
  name: "「Antimatter」Iron Man", power: "6500", product_series: "BP01", rarity: "MR", ...extra
});

test("nome: o título entre 「」 vai pro fim, como no Lorcana; sem título fica como vem", () => {
  assert.equal(nomeDaCarta("「Antimatter」Iron Man"), "Iron Man - Antimatter");
  assert.equal(nomeDaCarta("「Guardian of Nine Realms」 Odin"), "Odin - Guardian of Nine Realms");
  assert.equal(nomeDaCarta("RUSH POINT"), "RUSH POINT");
  assert.equal(nomeDaCarta("「」Groot"), "Groot");
  assert.equal(nomeDaCarta("  Thor  "), "Thor");
});

test("nome do set: só o nome, e o código na frente dos genéricos (contrato 7)", () => {
  assert.equal(nomeDoProduto("BP02", "Secret Wars", "supplement"), "Secret Wars");
  assert.equal(nomeDoProduto("SD07", "TIME STONE", "base"), "Starter Deck TIME STONE");
  assert.equal(nomeDoProduto("SD07", "Starter Deck Chaos", "base"), "Starter Deck Chaos");
  assert.equal(nomeDoProduto("PB03", "Promotion Pack", "other"), "PB03 — Promotion Pack");
  assert.equal(nomeDoProduto("EB02", "Event Pack", "other"), "EB02 — Event Pack");
  // O Lite Pack é "Expansion Pack" na fonte, mas o nome repete a cada volume.
  assert.equal(nomeDoProduto("LP02", "Lite Pack", "supplement"), "LP02 — Lite Pack");
  assert.equal(nomeDoProduto("XX01", "", "other"), "XX01");
  // Nenhum set leva o jogo ou a marca na frente.
  for (const s of Object.values(SETS)) assert.doesNotMatch(s.nome, /^(marvel|hero ?rush)/i);
  // Os três "Promotion Pack" têm nomes diferentes.
  const nomes = Object.values(SETS).map((s) => s.nome);
  assert.equal(new Set(nomes).size, nomes.length);
});

test("data do produto: o dia no fuso da editora", () => {
  assert.equal(dataDoProduto(1794621600000), "2026-11-14");
  assert.equal(dataDoProduto(1788834960000), "2026-09-08");
  assert.equal(dataDoProduto(0), "");
  assert.equal(dataDoProduto(undefined), "");
});

test("sets: o SETS fixa nome e data; produto novo entra pela regra e marcado", () => {
  const sets = montaSets([
    { series: "BP01", name: "Outro nome", category: "supplement", start_time: 1 },
    { series: "BP02", name: "Secret Wars", category: "supplement", start_time: 1794621600000 }
  ]);
  assert.deepEqual(sets.get("BP01"), { setId: "mhr-bp01", nome: "The Avengers", data: "2026-08-03" });
  assert.deepEqual(sets.get("BP02"), { setId: "mhr-bp02", nome: "Secret Wars", data: "2026-11-14", novo: true });
  assert.equal(setIdDe("PB01-A"), "mhr-pb01-a");
});

test("carta: id por número e raridade, campos do jogo e imagem pela chave", () => {
  const x = cardOf(registro(), montaSets([]));
  assert.equal(x.base, "mhr-bp01-001-mr");
  assert.equal(x.card.name, "Iron Man - Antimatter");
  assert.equal(x.card.set, "The Avengers");
  assert.equal(x.card.setId, "mhr-bp01");
  assert.equal(x.card.number, "BP01-001");
  assert.equal(x.card.rarity, "MR");
  assert.equal(x.card.cardType, "Character");
  assert.equal(x.card.color, "Red");
  assert.equal(x.card.level, 6);
  assert.equal(x.card.power, 6500);
  assert.equal(x.card.traits, "Human/Avengers");
  // A assinatura (e, token) não entra no catálogo: vence em um dia.
  assert.equal(x.card.image, `https://wsrv.nl/?url=marvel-tcg.janime.cn%2F${CHAVE}&w=440&output=webp`);
  assert.doesNotMatch(x.card.image, /token|[?&]e=/);
  // RUSH POINT: sem cor, sem nível e sem poder.
  const rp = cardOf(registro({ card_no: "BP01-131", card_type: "impact", name: "RUSH POINT", attribute: " ", level: "", power: "", feature: "", rarity: "C" }), montaSets([])).card;
  assert.equal(rp.cardType, "Impact");
  assert.equal(rp.color, null);
  assert.equal(rp.level, null);
  assert.equal(rp.power, null);
  assert.equal(cardOf(registro({ attribute: "-" }), montaSets([])).card.color, null);
  // Sem número ou sem raridade não há id estável.
  assert.equal(cardOf(registro({ card_no: "" }), montaSets([])), null);
  assert.equal(cardOf(registro({ rarity: "" }), montaSets([])), null);
});

test("catálogo: raridades do mesmo número são cartas diferentes; repetição ganha -2 pela ordem do registro", () => {
  const { cards, avisos } = montaCatalogo([
    registro({ id: "6a86a6bc9da74fc0904ed864", rarity: "SEC" }),
    registro({ id: "6a86a6bc9da74fc0904ed862", rarity: "MR" }),
    // A mesma entrada em duas páginas da lista: uma carta só.
    registro({ id: "6a86a6bc9da74fc0904ed862", rarity: "MR" }),
    // Número e raridade repetidos (ouro e prata): a de registro mais novo é a -2,
    // em qualquer ordem que a lista venha.
    registro({ id: "6a9f78220f644336606f88df", card_no: "SP01-021", product_series: "SP01", rarity: "HR" }),
    registro({ id: "6a9f78220f644336606f88dd", card_no: "SP01-021", product_series: "SP01", rarity: "HR", image: imagem("6a9f77970f644336606f8792") })
  ], []);
  assert.deepEqual(cards.map((c) => c.id), ["mhr-bp01-001-mr", "mhr-bp01-001-sec", "mhr-sp01-021-hr", "mhr-sp01-021-hr-2"]);
  assert.match(cards[2].image, /6a9f77970f644336606f8792/);
  assert.equal(cards[0].setTotal, 2);
  assert.deepEqual(avisos, []);
  const invertido = montaCatalogo([
    registro({ id: "6a9f78220f644336606f88dd", card_no: "SP01-021", product_series: "SP01", rarity: "HR", image: imagem("6a9f77970f644336606f8792") }),
    registro({ id: "6a9f78220f644336606f88df", card_no: "SP01-021", product_series: "SP01", rarity: "HR" })
  ], []).cards;
  assert.match(invertido.find((c) => c.id === "mhr-sp01-021-hr").image, /6a9f77970f644336606f8792/);
});

test("catálogo: set novo avisa, e dois sets de mesmo nome não dividem a chave", () => {
  const { cards, avisos } = montaCatalogo(
    [registro({ card_no: "BP02-001", product_series: "BP02" }), registro({ id: "x2", card_no: "BP03-001", product_series: "BP03" })],
    [{ series: "BP02", name: "Secret Wars", category: "supplement", start_time: 1794621600000 }, { series: "BP03", name: "Secret Wars", category: "supplement", start_time: 1794621600000 }]
  );
  assert.deepEqual(cards.map((c) => c.set), ["Secret Wars", "BP03 — Secret Wars"]);
  assert.ok(avisos.some((a) => a.includes("mesmo nome")));
  assert.ok(avisos.some((a) => a.includes("fora do SETS")));
});

test("lista de cartas: segue as páginas que a API diz que existem", async () => {
  const pedidos = [];
  const fetchImpl = async (url) => {
    pedidos.push(url);
    const pagina = Number(/page=(\d+)/.exec(url)[1]);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ current_page: pagina, page_count: 2, list: [registro({ id: `r${pagina}` })] }) };
  };
  const cartas = await listaCartas({ fetchImpl, pausaMs: 0 });
  assert.equal(cartas.length, 2);
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[0], /language=en/);
});

test("espelho: a chave sai da URL do catálogo e a matriz vira a URL assinada da rodada", () => {
  const url = urlDoCatalogo(CHAVE);
  const base = chaveBase(url);
  assert.equal(base, `wsrv.nl/marvel-tcg.janime.cn/${CHAVE}`);
  assert.equal(chaveDaBase(base), CHAVE);
  assert.equal(chaveDaBase("wsrv.nl/cards.narutotcgmythos.com/storage/cards/x.webp"), "");
  assert.equal(chaveDe(url, 300), `wsrv.nl/marvel-tcg.janime.cn/${CHAVE}@300.webp`);
  assert.equal(urlDoCatalogo(""), "");
  assert.equal(urlDoCatalogo("../x"), "");
  // A original (PNG), não uma variante já comprimida.
  assert.equal(assinadasDe([registro()]).get(CHAVE), `https://marvel-tcg.janime.cn/${CHAVE}?e=1795151848&token=abc:orig=`);

  const outra = "wsrv.nl/cards.narutotcgmythos.com/storage/cards/x.webp";
  const semAssinatura = `wsrv.nl/marvel-tcg.janime.cn/${"f".repeat(24)}`;
  const alvo = new Map([
    [base, { url, matriz: matrizDe(url) }],
    [semAssinatura, { url: urlDoCatalogo("f".repeat(24)), matriz: "x" }],
    [outra, { url: "u", matriz: "fica" }]
  ]);
  assert.deepEqual(aplicaAssinadas(alvo, [registro()]), { trocadas: 1, adiadas: 1 });
  assert.equal(alvo.get(base).matriz, `https://marvel-tcg.janime.cn/${CHAVE}?e=1795151848&token=abc:orig=`);
  // Carta sem assinatura nesta rodada sai do alvo (não vira "não existe na
  // origem" por 30 dias); as outras fontes do wsrv.nl não mudam.
  assert.equal(alvo.has(semAssinatura), false);
  assert.equal(alvo.get(outra).matriz, "fica");
  // API fora do ar: todas as do jogo esperam a rodada seguinte.
  const alvo2 = new Map([[base, { url, matriz: "x" }], [outra, { url: "u", matriz: "fica" }]]);
  assert.deepEqual(aplicaAssinadas(alvo2, null), { trocadas: 0, adiadas: 1 });
  assert.deepEqual([...alvo2.keys()], [outra]);
});

test("catálogo versionado: ids únicos, todas com imagem pela chave e sem assinatura", () => {
  const cartas = catalogo();
  assert.ok(cartas.length >= 660, `só ${cartas.length} cartas`);
  assert.equal(new Set(cartas.map((c) => c.id)).size, cartas.length);
  for (const c of cartas) {
    assert.match(c.id, /^mhr-[a-z0-9-]+$/);
    assert.match(c.setId, /^mhr-/);
    assert.match(c.image, /^https:\/\/wsrv\.nl\/\?url=marvel-tcg\.janime\.cn%2F[0-9a-f]+&w=440&output=webp$/);
    assert.doesNotMatch(c.set, /^(marvel|hero ?rush)/i);
  }
  // Um nome por set, um set por nome.
  const nomeDoSet = new Map();
  for (const c of cartas) { assert.ok(!nomeDoSet.has(c.set) || nomeDoSet.get(c.set) === c.setId, c.set); nomeDoSet.set(c.set, c.setId); }
});
