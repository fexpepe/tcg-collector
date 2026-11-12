// NARUTO Mythos TCG (jogo narutomythos, 2026-11-12): o id a partir do SKU
// oficial, o set pela edição, o nome com a versão e o catálogo versionado.
// Sem rede: fixtures no formato da API da galeria oficial.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETS, RARIDADE, lerSku, setDaChave, nomeDaCarta, cardOf, montaCatalogo } from "../scripts/sync-narutomythos.mjs";

const catalogo = () => {
  const s = readFileSync(new URL("../data/narutomythos/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

const registro = (extra) => ({
  ID: "003/130", SKU: "NM-S1E1-C003FAV1", Rarity: "C", CardType: "Character", Edition: "1st edition",
  Set: "Set 1: Konoha Shidō", Variant: "Full Art", Title: "Tsunade", Version: "Master Medical Ninja",
  Image: "https://cards.narutotcgmythos.com/storage/cards/003130-en-aaaa.webp", Order: 7, ...extra
});

test("SKU -> id, set e edição; o que não é SKU do jogo não vira carta", () => {
  assert.deepEqual(lerSku("NM-S1E1-C003FAV1"), { chave: "S1E1", set: 1, edicao: 1, id: "nmy-s1e1-c003fav1" });
  assert.deepEqual(lerSku("NM-S2E0-M126V2-RC"), { chave: "S2E0", set: 2, edicao: 0, id: "nmy-s2e0-m126v2-rc" });
  assert.equal(lerSku("XX-S1E1-C003"), null);
  assert.equal(lerSku(""), null);
  assert.equal(lerSku(undefined), null);
});

test("set pela chave do SKU: pinado, 2ª edição no formato da régua e promos fora de edição", () => {
  assert.equal(setDaChave(lerSku("NM-S1E1-R104V1")).setId, "nmy-s1");
  assert.equal(setDaChave(lerSku("NM-S1E2-R104V1")).nome, "Konoha Shidō (2nd Edition)");
  assert.equal(setDaChave(lerSku("NM-S1E0-M104V1")).nome, "Konoha Shidō Promos");
  // Chave que o SETS não conhece: nome da fonte sem o "Set N: " e marca de novo.
  assert.deepEqual(setDaChave(lerSku("NM-S3E1-C001V1"), "Set 3: Akatsuki"), { setId: "nmy-s3", nome: "Akatsuki", data: "", novo: true });
  assert.deepEqual(setDaChave(lerSku("NM-S3E2-C001V1"), "Set 3: Akatsuki"), { setId: "nmy-s3-2e", nome: "Akatsuki (2nd Edition)", data: "", novo: true });
  assert.equal(setDaChave(lerSku("NM-S3E0-M001V1"), "Set 3: Akatsuki").nome, "Akatsuki Promos");
  assert.equal(setDaChave(lerSku("NM-S3E3-C001V1"), "Set 3: Akatsuki").nome, "Akatsuki (3rd Edition)");
});

test("a 2ª edição cai na régua de edição do site (seletor Edição na página do set)", () => {
  const src = readFileSync(new URL("../src/nomes-sets.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const win = {};
  new Function("window", src)(win);
  const { edicaoDoSet } = win.SLEEVU_NOMES_SETS;
  for (const def of Object.values(SETS)) {
    const e = edicaoDoSet(def.nome);
    if (/Edition\)$/.test(def.nome)) assert.equal(e && e.base, "Konoha Shidō", def.nome);
    else assert.equal(e, null, `${def.nome} não é edição`);
  }
});

test("nome: título e versão, no formato do Lorcana; sem versão, só o título", () => {
  assert.equal(nomeDaCarta("Naruto Uzumaki", "I'll be the greatest Hokage"), "Naruto Uzumaki - I'll be the greatest Hokage");
  assert.equal(nomeDaCarta("Bring it back", ""), "Bring it back");
  assert.equal(nomeDaCarta("  Snake   Sword ", null), "Snake Sword");
});

test("cardOf: número impresso, raridade por extenso, acabamento e imagem pelo proxy", () => {
  const { card, ordem, setNovo } = cardOf(registro());
  assert.equal(card.id, "nmy-s1e1-c003fav1");
  assert.equal(card.name, "Tsunade - Master Medical Ninja");
  assert.equal(card.set, "Konoha Shidō");
  assert.equal(card.setId, "nmy-s1");
  assert.equal(card.number, "003/130");
  assert.equal(card.setReleaseDate, "2026-03-13");
  assert.equal(card.rarity, "Common");
  assert.deepEqual(card.variants, ["Normal"]);
  assert.equal(card.cardType, "Character");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://wsrv.nl/?url=cards.narutotcgmythos.com%2Fstorage%2Fcards%2F003130-en-aaaa.webp&w=440&output=webp");
  assert.equal(ordem, 7);
  assert.equal(setNovo, "");
  // Holográfica = Foil; raridade que a tabela não conhece passa como veio.
  assert.deepEqual(cardOf(registro({ SKU: "NM-S2E1-C079HV1", Variant: "Holo" })).card.variants, ["Foil"]);
  assert.equal(cardOf(registro({ Rarity: "ZZ" })).card.rarity, "ZZ");
  assert.equal(cardOf(registro({ Rarity: "SV" })).card.rarity, RARIDADE.SV);
  assert.equal(cardOf(registro({ SKU: "" })), null);
});

test("montaCatalogo: ordem da galeria dentro do set, total por set, SKU repetido uma vez só", () => {
  const { cards, avisos } = montaCatalogo([
    registro({ SKU: "NM-S1E1-R104V1", ID: "104/130", Rarity: "R", Order: 9 }),
    registro({ SKU: "NM-S1E1-C003FAV1", Order: 2 }),
    registro({ SKU: "NM-S1E1-C003FAV1", Order: 3 }),
    registro({ SKU: "NM-S1E2-C003FAV1", Order: 1 }),
    registro({ SKU: "NM-S3E1-C001V1", Set: "Set 3: Akatsuki", Order: 0 }),
    registro({ SKU: "sem-sku" })
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["nmy-s1e1-c003fav1", "nmy-s1e1-r104v1", "nmy-s1e2-c003fav1", "nmy-s3e1-c001v1"]);
  assert.equal(cards[0].setTotal, 2);
  assert.equal(cards[2].setTotal, 1);
  assert.equal(avisos.length, 2);
  assert.match(avisos.join("\n"), /set sem pin: S3E1 -> nmy-s3 "Akatsuki"/);
  assert.match(avisos.join("\n"), /1 registro\(s\) sem SKU/);
});

test("catálogo versionado: ids únicos e em ASCII, só os sets pinados, tudo com imagem", () => {
  const cards = catalogo();
  assert.ok(cards.length >= 646, `${cards.length} cartas`);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, "id repetido");
  const setIds = new Set(Object.values(SETS).map((s) => s.setId));
  for (const c of cards) {
    assert.match(c.id, /^nmy-s\d+e\d+-[a-z0-9-]+$/, c.id);
    assert.ok(setIds.has(c.setId), `${c.id}: set ${c.setId} fora do SETS`);
    assert.ok(c.image.startsWith("https://wsrv.nl/?url=cards.narutotcgmythos.com"), `${c.id} sem imagem`);
    assert.ok(c.name && c.number && c.rarity, `${c.id}: nome, número ou raridade vazios`);
  }
  // A 1ª e a 2ª edição do Set 1 são o mesmo set: mesma contagem por raridade
  // fora das Secret Variant, das Legendary e das Mythos, que mudam entre elas.
  const conta = (setId) => {
    const m = {};
    for (const c of cards) if (c.setId === setId && !["Secret Variant", "Legendary", "Mythos"].includes(c.rarity)) m[c.rarity] = (m[c.rarity] || 0) + 1;
    return m;
  };
  assert.deepEqual(conta("nmy-s1-2e"), conta("nmy-s1"));
});
