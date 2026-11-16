// Testes do sync da Carddass Hyper Battle de HUNTER×HUNTER
// (scripts/sync-hxh-hyper-battle.mjs, jogo hxh). O nome de arquivo da
// Hunterpedia vira set + número oficial — inclusive o pacote da Jump Festa
// 2001, cujos arquivos não trazem o número e por isso ficaram fora do catálogo
// até 2026-11-14. E a conta das promos contra a da Hunterpedia.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFile, JF01_POR_ARQUIVO } from "../scripts/sync-hxh-hyper-battle.mjs";

const SNAP = JSON.parse(readFileSync(new URL("../data/vintage/hxh-hyper-battle.json", import.meta.url), "utf8"));

test("arquivo das partes, da Jump Festa 2000/2002 e do Game Boy: número no nome", () => {
  assert.deepEqual(parseFile("Hyper_battle_part_3_card_c61.png"), { setCode: "p3", type: "c", num: "C61" });
  assert.deepEqual(parseFile("Hyper_battle_jump_festa_2000_gon_card_s-j1.png"), { setCode: "jf00", type: "s", num: "S-J1" });
  assert.deepEqual(parseFile("Hyper_battle_jump_festa_2002_card_c-j10.png"), { setCode: "jf02", type: "c", num: "C-J10" });
  assert.deepEqual(parseFile("Hyper_battle_game_boy_card_s-k1.png"), { setCode: "gb", type: "s", num: "S-K1" });
  // embalagem não é carta
  assert.equal(parseFile("Hyper_battle_carddass_part_6_booster_pack.png"), null);
});

test("Jump Festa 2001: a posição no pacote vira o número impresso lido no scan", () => {
  assert.deepEqual(parseFile("Jump_Festa_Edition_2001_Hyper_Battle_Pack_Card_1.png"), { setCode: "jf01", type: "c", num: "C-J1" });
  assert.deepEqual(parseFile("Jump_Festa_Edition_2001_Hyper_Battle_Pack_Card_5.png"), { setCode: "jf01", type: "c", num: "C-J5" });
  assert.deepEqual(parseFile("Jump_Festa_Edition_2001_Hyper_Battle_Pack_Card_6.png"), { setCode: "jf01", type: "s", num: "S-J2" });
  assert.deepEqual(parseFile("Jump_Festa_Edition_2001_Hyper_Battle_Pack_Card_8.png"), { setCode: "jf01", type: "s", num: "S-J4" });
  // uma 9ª carta que alguém suba não ganha número inventado
  assert.equal(parseFile("Jump_Festa_Edition_2001_Hyper_Battle_Pack_Card_9.png"), null);
  // as fotos do pacote fechado e da cartela não são carta
  assert.equal(parseFile("HxH_Jump_Festa_2001_Carddass_Hyper_Battle_Full_pack.png"), null);
  assert.equal(parseFile("Jump_Festa_2001_Limited_Pack.png"), null);
});

test("Jump Festa: S-J1 (2000), S-J2–4 e C-J1–5 (2001), S-J5–7 e C-J6–10 (2002) — sem buraco nem repetição", () => {
  const nums = SNAP.sets.filter((s) => /^jf/.test(s.code)).flatMap((s) => s.cards.map((c) => c.num));
  const esperado = [...Array.from({ length: 7 }, (_, i) => `S-J${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `C-J${i + 1}`)];
  assert.deepEqual([...nums].sort(), [...esperado].sort());
  assert.equal(Object.keys(JF01_POR_ARQUIVO).length, 8);
});

test("promos: as 23 que a Hunterpedia conta (6 do Game Boy + 17 da Jump Festa)", () => {
  const promos = SNAP.sets.filter((s) => s.code === "gb" || /^jf/.test(s.code)).flatMap((s) => s.cards);
  assert.equal(promos.length, 23);
  assert.ok(promos.every((c) => c.rarity === "Promo"));
});
