// Migração de cardId aposentado (src/shared.js: ID_MERGES, remapIdsDeep,
// migrateMergedCardIds) — o que impede alguém de PERDER carta quando um set
// importado é aposentado porque a TCGdex publicou o mesmo set com outro id.
//
// A tabela testada é a de verdade, carimbada do data/card-id-merges.json: o
// "30th Celebration" viveu dois dias como cel30/cel30cc (16–18/09/2026) e passou
// a ser 30th/30th-c. Se o de-para mudar sem intenção, estes testes caem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOR = "window.__test = { mergedCardId, mergedSetId, remapIdsDeep, mergeData, ID_MERGES, ID_MERGES_KEY };";

test("a tabela carimbada no núcleo é a do data/card-id-merges.json", () => {
  const artefato = JSON.parse(readFileSync(new URL("../data/card-id-merges.json", import.meta.url), "utf8"));
  const { __test } = loadShared(EXPOR);
  // Objeto vindo do sandbox é de outro realm: compara pelo JSON (padrão do repo).
  assert.deepEqual(JSON.parse(JSON.stringify(__test.ID_MERGES.p)), artefato.prefixes);
  assert.deepEqual(JSON.parse(JSON.stringify(__test.ID_MERGES.c)), artefato.cards);
  assert.deepEqual(JSON.parse(JSON.stringify(__test.ID_MERGES.s)),
    Object.fromEntries(artefato.sets.map((x) => [x.from, x.to])));
});

test("link de set com o id aposentado segue pro set que ficou", () => {
  const { __test: t } = loadShared(EXPOR);
  // Os dois entram, inclusive o par a par — é o setId que o link carrega.
  assert.equal(t.mergedSetId("cel30"), "30th");
  assert.equal(t.mergedSetId("cel30cc"), "30th-c");
  assert.equal(t.mergedSetId("30th"), "");
  assert.equal(t.mergedSetId("cel25"), "");
  assert.equal(t.mergedSetId(""), "");
});

test("id novo: por prefixo de set e par a par", () => {
  const { __test: t } = loadShared(EXPOR);
  assert.equal(t.mergedCardId("cel30-001"), "30th-001");     // prefixo: o set inteiro numa regra
  assert.equal(t.mergedCardId("cel30-158"), "30th-158");
  assert.equal(t.mergedCardId("cel30cc-4"), "30th-c-001");   // numeração mudou: par a par
  assert.equal(t.mergedCardId("cel30cc-106-106"), "30th-c-022");
  assert.equal(t.mergedCardId("30th-001"), "");              // já migrado: não mexe
  assert.equal(t.mergedCardId("cel25-4"), "");               // Celebrations de 2021 é outro set
  assert.equal(t.mergedCardId(""), "");
  assert.equal(t.mergedCardId(null), "");
});

test("reescrita em profundidade: chave de objeto, string solta e aninhamento", () => {
  const { __test: t } = loadShared(EXPOR);
  const r = t.remapIdsDeep({
    "cel30-001": { Holo: { NM: 2 } },              // coleção: id é CHAVE
    ids: ["cel30-002", "sv01-050"],                 // lista de desejo: id é STRING
    decks: [{ cards: [{ id: "cel30cc-4", qty: 4 }] }] // deck: id aninhado
  });
  assert.equal(r.mudou, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.v)), {
    "30th-001": { Holo: { NM: 2 } },
    ids: ["30th-002", "sv01-050"],
    decks: [{ cards: [{ id: "30th-c-001", qty: 4 }] }]
  });
  const nada = t.remapIdsDeep({ "sv01-050": 1, ids: ["sv01-051"] });
  assert.equal(nada.mudou, false);
});

test("marcou nos dois ids: o que já estava no id novo vence", () => {
  const { __test: t } = loadShared(EXPOR);
  const r = t.remapIdsDeep({ "30th-001": { Holo: { NM: 9 } }, "cel30-001": { Holo: { NM: 1 } } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.v)), { "30th-001": { Holo: { NM: 9 } } });
});

// Coleção SOMA as cópias na colisão (24/09/2026): com o de-para automático de
// id provisório, quem marcou a versão provisória E a oficial perderia as
// cópias do id velho. Os outros stores seguem com "fica o do id novo".
test("coleção com id velho e novo: as cópias somam, por variante e condição", () => {
  const { __test: t } = loadShared(EXPOR);
  const r = t.remapIdsDeep({
    "30th-001": { Holo: { NM: 2 }, Normal: { SP: 1 } },
    "cel30-001": { Holo: { NM: 1, HP: 1 }, Reverse: { NM: 4 } }
  }, { somar: true });
  assert.deepEqual(JSON.parse(JSON.stringify(r.v)), {
    "30th-001": { Holo: { NM: 3, HP: 1 }, Normal: { SP: 1 }, Reverse: { NM: 4 } }
  });
  // A ordem das chaves no blob não muda a conta.
  const r2 = t.remapIdsDeep({ "cel30-001": { Holo: { NM: 1 } }, "30th-001": { Holo: { NM: 2 } } }, { somar: true });
  assert.equal(r2.v["30th-001"].Holo.NM, 3);
});

test("aparelho com as duas versões marcadas: a coleção soma, o custo não", () => {
  const localStorage = makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify({ "30th-001": { Holo: { NM: 2 } }, "cel30-001": { Holo: { NM: 1 } } }),
    "tcg-collector-collection-costs-v1": JSON.stringify({ "30th-001": { Holo: 10 }, "cel30-001": { Holo: 7 } })
  });
  loadShared(EXPOR, { localStorage });
  const d = localStorage._dump();
  assert.deepEqual(JSON.parse(d["tcg-collector-pokemon-collection-v3"]), { "30th-001": { Holo: { NM: 3 } } });
  assert.deepEqual(JSON.parse(d["tcg-collector-collection-costs-v1"]), { "30th-001": { Holo: 10 } });
});

test("nuvem com as duas versões marcadas: a coleção do blob soma antes do merge", () => {
  const { __test: t } = loadShared(EXPOR);
  const remoto = {
    collection: { "30th-001": { Holo: { NM: 2 } }, "cel30-001": { Holo: { NM: 1 } } },
    collectionMeta: { mod: { "30th-001": 900, "cel30-001": 900 }, del: {} }
  };
  const m = JSON.parse(JSON.stringify(t.mergeData({}, remoto)));
  assert.deepEqual(m.collection, { "30th-001": { Holo: { NM: 3 } } });
});

test("migração one-shot varre as chaves tcg- do localStorage e se marca", () => {
  const localStorage = makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify({ "cel30-001": { Holo: { NM: 1 } }, "cel30cc-94": { Holo: { NM: 1 } } }),
    "tcg-collector-pokemon-collection-meta-v1": JSON.stringify({ mod: { "cel30-001": 7 }, del: {} }),
    "tcg-collector-pokemon-wishlist-v1": JSON.stringify(["cel30-002"]),
    "tcg-collector-collection-costs-v1": JSON.stringify({ "cel30cc-4": { Holo: 12 } }),
    "tcg-collector-decks-all-v1": JSON.stringify({ d1: { game: "pokemon", cards: [{ id: "cel30-101", qty: 2 }] } }),
    "tcg-collector-pokemon-prices-v1": JSON.stringify({ "sv01-050": 3 }), // nada a fazer
    "outro-app-qualquer": JSON.stringify({ "cel30-001": "não é nosso" })
  });
  loadShared(EXPOR, { localStorage });
  const d = localStorage._dump();
  assert.deepEqual(JSON.parse(d["tcg-collector-pokemon-collection-v3"]), { "30th-001": { Holo: { NM: 1 } }, "30th-c-018": { Holo: { NM: 1 } } });
  assert.deepEqual(JSON.parse(d["tcg-collector-pokemon-collection-meta-v1"]), { mod: { "30th-001": 7 }, del: {} });
  assert.deepEqual(JSON.parse(d["tcg-collector-pokemon-wishlist-v1"]), ["30th-002"]);
  assert.deepEqual(JSON.parse(d["tcg-collector-collection-costs-v1"]), { "30th-c-001": { Holo: 12 } });
  assert.deepEqual(JSON.parse(d["tcg-collector-decks-all-v1"]), { d1: { game: "pokemon", cards: [{ id: "30th-101", qty: 2 }] } });
  assert.deepEqual(JSON.parse(d["tcg-collector-pokemon-prices-v1"]), { "sv01-050": 3 });
  // Chave de outro app na mesma origem não é tocada.
  assert.deepEqual(JSON.parse(d["outro-app-qualquer"]), { "cel30-001": "não é nosso" });
  assert.ok(d["tcg-collector-id-merges-v1"], "assinatura gravada");
});

test("assinatura gravada não deixa a migração rodar de novo", () => {
  const { __test: t } = loadShared(EXPOR);
  const assinatura = t.ID_MERGES_KEY;
  const localStorage = makeLocalStorage({
    [assinatura]: Object.keys(t.ID_MERGES.p).join(",") + "|" + Object.keys(t.ID_MERGES.c).length,
    // Carta readicionada no id velho DEPOIS da migração (o catálogo não tem
    // mais esse id; reescrever de novo seria ressuscitar dado de outra rodada).
    "tcg-collector-pokemon-collection-v3": JSON.stringify({ "cel30-001": { Holo: { NM: 1 } } })
  });
  loadShared(EXPOR, { localStorage });
  assert.deepEqual(JSON.parse(localStorage._dump()["tcg-collector-pokemon-collection-v3"]), { "cel30-001": { Holo: { NM: 1 } } });
});

test("blob que vem da nuvem com id velho é reescrito antes do merge", () => {
  const { __test: t } = loadShared(EXPOR);
  const local = { collection: { "30th-001": { Holo: { NM: 1 } } }, collectionMeta: { mod: { "30th-001": 10 }, del: {} } };
  const remoto = { collection: { "cel30-002": { Holo: { NM: 3 } } }, collectionMeta: { mod: { "cel30-002": 20 }, del: {} } };
  const m = t.mergeData(local, remoto);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(m.collection))).sort(), ["30th-001", "30th-002"]);
  assert.equal(m.collection["30th-002"].Holo.NM, 3);
});

// ── O caminho do APARELHO, de ponta a ponta ─────────────────────────────────
// Não basta a tabela estar certa: o que importa é a carta que a pessoa marcou
// continuar na Coleção depois que o set trocou de id. Estes dois testes fazem o
// percurso real — localStorage do aparelho, store da coleção e o blob da nuvem.

test("aparelho: o que foi marcado no id velho abre no id novo, com a mesma quantidade", () => {
  // Estado de quem marcou cartas nos dois dias em que o set foi cel30/cel30cc.
  const localStorage = makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify({
      "cel30-001": { Holo: { NM: 2 } },
      "cel30-158": { Normal: { NM: 1, SP: 3 } },
      "cel30cc-4": { Holo: { NM: 1 } }
    }),
    "tcg-collector-pokemon-collection-meta-v1": JSON.stringify({
      mod: { "cel30-001": 111, "cel30-158": 222, "cel30cc-4": 333 }, del: {}
    })
  });
  const sandbox = loadShared(EXPOR, { localStorage });
  const store = sandbox.window.TCGShared.createCollectionStore("pokemon");

  assert.equal(store.getQuantity("30th-001", "Holo", "NM"), 2);
  assert.equal(store.getQuantity("30th-158", "Normal", "NM"), 1);
  assert.equal(store.getQuantity("30th-158", "Normal", "SP"), 3);
  assert.equal(store.getQuantity("30th-c-001", "Holo", "NM"), 1); // Charizard da Classic Collection
  assert.equal(store.totalQuantity(), 7);                          // nada se perdeu no caminho
  // O id velho não existe mais na conta (senão a carta apareceria duas vezes).
  assert.equal(store.has("cel30-001"), false);
  assert.equal(store.has("cel30cc-4"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(store.knownCardIds())).sort(), ["30th-001", "30th-158", "30th-c-001"]);
  // O timestamp do LWW viaja junto: sem ele o sync trataria a carta como nova.
  const meta = JSON.parse(localStorage._dump()["tcg-collector-pokemon-collection-meta-v1"]);
  assert.equal(meta.mod["30th-001"], 111);
  assert.equal(meta.mod["30th-c-001"], 333);
});

test("aparelho já migrado + nuvem com id velho: a carta não volta em dobro", () => {
  // O outro aparelho ainda não abriu o site, então o blob da nuvem tem o id
  // velho. É o caso do celular que sincroniza depois do desktop (ou vice-versa).
  const { __test: t } = loadShared(EXPOR);
  const local = {
    collection: { "30th-001": { Holo: { NM: 2 } } },
    collectionMeta: { mod: { "30th-001": 500 }, del: {} }
  };
  const remoto = {
    collection: { "cel30-001": { Holo: { NM: 9 } }, "cel30-002": { Holo: { NM: 1 } } },
    collectionMeta: { mod: { "cel30-001": 900, "cel30-002": 900 }, del: {} }
  };
  const m = JSON.parse(JSON.stringify(t.mergeData(local, remoto)));
  assert.deepEqual(Object.keys(m.collection).sort(), ["30th-001", "30th-002"]);
  assert.equal(m.collection["30th-001"].Holo.NM, 9); // o remoto é mais novo: vence pelo LWW
  assert.equal(m.collection["30th-002"].Holo.NM, 1); // e a carta que só existia lá entrou
});

test("link ?card= com id aposentado é reescrito pro id novo antes de a página olhar", () => {
  const chamadas = [];
  const history = { state: { x: 1 }, replaceState: (st, _t, url) => chamadas.push([st, url]) };
  const location = { pathname: "/detail", search: "?type=set&card=cel30cc-4", hash: "", origin: "http://x", hostname: "localhost", href: "http://x/detail?type=set&card=cel30cc-4" };
  loadShared(EXPOR, { location, history });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0][1], "http://x/detail?type=set&card=30th-c-001");
  assert.deepEqual(chamadas[0][0], { x: 1 }); // o state da página é preservado
});

test("link ?card= com id vivo (ou sem ?card=) não mexe na URL", () => {
  const chamadas = [];
  const history = { replaceState: (st, _t, url) => chamadas.push(url) };
  loadShared(EXPOR, { history, location: { pathname: "/", search: "?card=30th-001", hash: "", origin: "http://x", hostname: "localhost", href: "http://x/?card=30th-001" } });
  loadShared(EXPOR, { history, location: { pathname: "/", search: "", hash: "", origin: "http://x", hostname: "localhost", href: "http://x/" } });
  assert.deepEqual(chamadas, []);
});
