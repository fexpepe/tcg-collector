// Pontuação do "em destaque" da galeria (scripts/lib/decks-hot.mjs). Lógica
// PURA: o script de build só busca os dados e escreve o arquivo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { pontuaDecks } from "../scripts/lib/decks-hot.mjs";

const AGORA = Date.parse("2026-08-30T12:00:00Z");
const diasAtras = (n) => new Date(AGORA - n * 86400000).toISOString();

test("o deck novo com poucas visitas ganha do antigo com muitas — o motivo do item", () => {
  // É EXATAMENTE o defeito que a galeria tinha: contagem acumulada só cresce,
  // então o primeiro deck que viralizou ficava no topo pra sempre.
  const decks = [
    { id: "velho", created_at: diasAtras(60) },
    { id: "novo", created_at: diasAtras(2) }
  ];
  const views = [{ share_id: "velho", views: 500 }, { share_id: "novo", views: 40 }];
  const r = pontuaDecks(decks, views, AGORA);
  assert.equal(r[0][0], "novo");
  assert.ok(r[0][1] > r[1][1]);
});

test("entre decks da MESMA idade, quem tem mais visita ganha", () => {
  const decks = [{ id: "a", created_at: diasAtras(5) }, { id: "b", created_at: diasAtras(5) }];
  const r = pontuaDecks(decks, [{ share_id: "a", views: 10 }, { share_id: "b", views: 90 }], AGORA);
  assert.deepEqual(r.map((x) => x[0]), ["b", "a"]);
});

test("deck de HORAS com 3 visitas não atropela um deck bom de ontem", () => {
  // Sem o amortecedor de 2 dias, o denominador iria a ~0 e o score explodiria.
  const decks = [{ id: "recem", created_at: diasAtras(0.1) }, { id: "ontem", created_at: diasAtras(1) }];
  const r = pontuaDecks(decks, [{ share_id: "recem", views: 3 }, { share_id: "ontem", views: 60 }], AGORA);
  assert.equal(r[0][0], "ontem");
});

test("deck sem visita não disputa destaque", () => {
  const decks = [{ id: "a", created_at: diasAtras(1) }, { id: "zero", created_at: diasAtras(1) }];
  const r = pontuaDecks(decks, [{ share_id: "a", views: 5 }, { share_id: "zero", views: 0 }], AGORA);
  assert.deepEqual(r.map((x) => x[0]), ["a"]);
});

test("data inválida ou registro torto fica de fora, sem derrubar o resto", () => {
  const decks = [
    { id: "ok", created_at: diasAtras(3) },
    { id: "semData" },
    { id: "dataRuim", created_at: "ontem de manhã" },
    null,
    { created_at: diasAtras(1) } // sem id
  ];
  const r = pontuaDecks(decks, [
    { share_id: "ok", views: 20 }, { share_id: "semData", views: 99 }, { share_id: "dataRuim", views: 99 }
  ], AGORA);
  assert.deepEqual(r.map((x) => x[0]), ["ok"]);
});

test("empate no score desempata por id (ordem estável entre builds)", () => {
  const decks = [{ id: "zz", created_at: diasAtras(4) }, { id: "aa", created_at: diasAtras(4) }];
  const r = pontuaDecks(decks, [{ share_id: "zz", views: 7 }, { share_id: "aa", views: 7 }], AGORA);
  assert.deepEqual(r.map((x) => x[0]), ["aa", "zz"]);
});

test("entrada vazia devolve lista vazia (o build não escreve arquivo)", () => {
  assert.deepEqual(pontuaDecks([], [], AGORA), []);
  assert.deepEqual(pontuaDecks(null, null, AGORA), []);
});
