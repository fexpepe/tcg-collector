// Carta que estava DUAS vezes no catálogo (2026-11-11): a mesma carta, com o
// mesmo número e a mesma imagem, com dois ids no mesmo set. A página das duas
// saía com o mesmo título, e o Google conta isso como cópia. As 22 que havia
// (21 do Magic, o H36 do One Piece Carddass) foram juntadas pelo de-para do
// data/card-id-merges.json, que migra a coleção de quem marcou a cópia. O que
// se trava aqui:
//   - os dois syncs não criam a cópia de novo (sync-magic.mjs primeiraVez,
//     sync-onepiece-vintage.mjs semRepetidasNoSet);
//   - id juntado em outro não volta pelo cache nem pelos chunks
//     (lib/set-supersede.mjs semIdsJuntados);
//   - nenhuma das cópias juntadas está no catálogo, e a carta que ficou está.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { primeiraVez } from "../scripts/sync-magic.mjs";
import { semRepetidasNoSet } from "../scripts/sync-onepiece-vintage.mjs";
import { semIdsJuntados } from "../scripts/lib/set-supersede.mjs";
import { loadShared } from "./lib/shared-sandbox.mjs";

const RAIZ = new URL("../", import.meta.url);
const merges = JSON.parse(readFileSync(new URL("data/card-id-merges.json", RAIZ), "utf8"));

test("Magic: a carta que o Scryfall entrega em duas páginas da busca entra uma vez", () => {
  // O id é o do Scryfall (o da imagem): a The List deu a Hurkyl's Recall
  // MM2-48 na página 1 e de novo na 2.
  const vistas = new Set();
  const pagina1 = [{ id: "0d6439c1-9969-4fd0-b6ad-1a88c1aa6e31", collector_number: "MM2-48" }, { id: "a" }];
  const pagina2 = [{ id: "0d6439c1-9969-4fd0-b6ad-1a88c1aa6e31", collector_number: "MM2-48" }, { id: "b" }];
  const entram = [...pagina1, ...pagina2].filter((raw) => primeiraVez(raw, vistas));
  assert.deepEqual(entram.map((raw) => raw.id), ["0d6439c1-9969-4fd0-b6ad-1a88c1aa6e31", "a", "b"]);
  assert.equal(primeiraVez({}, vistas), true, "sem o id do Scryfall não dá pra saber: entra");
});

test("One Piece Carddass: a mesma carta duas vezes na lista do set sai uma vez", () => {
  // Linhas do data/vintage/onepiece-hyperbattle.json como estão: o Grand Box
  // DX junta dois decks, e o wiki lista o H36 nos dois.
  const h36 = { num: "H36", nameEn: "Final Battle", nameJp: "最終決戦", type: "Hyper", mark: "", power: "", finish: "Normal" };
  const h35 = { ...h36, num: "H35", nameEn: "Outra" };
  assert.deepEqual(semRepetidasNoSet([h36, h35, { ...h36 }]), [h36, h35]);
  // Mesmo número com outro nome é outra carta: o S75 do 7th Stage.
  const s75 = [
    { num: "S75", nameEn: "A Journey to The Legend", nameJp: "", finish: "Secret Rare" },
    { num: "S75", nameEn: "Luffy Pirates", nameJp: "ルフィ海賊団", finish: "Normal" }
  ];
  assert.equal(semRepetidasNoSet(s75).length, 2);
});

test("id juntado em outro não volta pro catálogo", () => {
  const cartas = [{ id: "mtg-plst-mm2-48" }, { id: "mtg-plst-mm2-48-2" }, { id: "opcd-H36" }, { id: "opcd-H36-grand-box-dx" }, { id: "cel30-001" }];
  // O par a par e a troca de prefixo (cel30 -> 30th) valem igual.
  assert.deepEqual(semIdsJuntados(cartas, merges).map((c) => c.id), ["mtg-plst-mm2-48", "opcd-H36"]);
  assert.equal(semIdsJuntados(cartas, {}).length, 5, "sem de-para, nada sai");
});

test("no app, quem marcou a cópia passa a ter a carta que ficou", () => {
  const { __test: t } = loadShared("window.__test = { mergedCardId, remapIdsDeep };");
  assert.equal(t.mergedCardId("mtg-sld-2766-2"), "mtg-sld-2766");
  assert.equal(t.mergedCardId("opcd-H36-grand-box-dx"), "opcd-H36");
  assert.equal(t.mergedCardId("mtg-sld-2766"), "", "a carta que ficou não muda");
  // Marcou as duas: na coleção as cópias somam (a regra do id-merges.test.mjs).
  const r = t.remapIdsDeep({ "mtg-trk-221": { Normal: { NM: 1 } }, "mtg-trk-221-2": { Foil: { NM: 1 } } }, { somar: true });
  assert.deepEqual(JSON.parse(JSON.stringify(r.v)), { "mtg-trk-221": { Normal: { NM: 1 }, Foil: { NM: 1 } } });
});

test("as cópias juntadas não estão no catálogo, e a carta que ficou está", () => {
  const pares = Object.entries(merges.cards).filter(([de]) => /^(mtg|opcd)-/.test(de));
  assert.ok(pares.length >= 22, "os 22 pares de 11/11 estão no de-para");
  const opcd = (() => { const w = {}; new Function("window", readFileSync(new URL("data/onepiece/cards.js", RAIZ), "utf8"))(w); return new Set(w.TCG_CARDS.map((c) => c.id)); })();
  const magic = new Map();
  const doMagic = (set) => {
    if (!magic.has(set)) magic.set(set, new Set(JSON.parse(readFileSync(new URL(`data/magic/sets/${set}.json`, RAIZ), "utf8")).map((c) => c.id)));
    return magic.get(set);
  };
  for (const [de, para] of pares) {
    const ids = de.startsWith("opcd-") ? opcd : doMagic(de.split("-")[1]);
    assert.ok(!ids.has(de), `${de} voltou pro catálogo`);
    assert.ok(ids.has(para), `${para} (pra onde ${de} foi) não está no catálogo`);
  }
});
