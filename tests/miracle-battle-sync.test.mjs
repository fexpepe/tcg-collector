// Testes do sync do Miracle Battle Carddass (scripts/sync-miracle-battle.mjs),
// que desde 2026-10-01 monta o jogo mbc com as sete séries. Sem rede: parte do
// snapshot versionado (data/vintage/miracle-battle.json).
//
// O que importa travar é o ID: as séries que já estavam no ar (One Piece,
// Naruto e HxH, como linhas dos jogos da marca) seguem com o id de sempre, que
// é a ponte com a coleção de quem marcou; as novas usam `mb-`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERIES, seriesOf, setNameOf, buildCards } from "../scripts/sync-miracle-battle.mjs";

const snap = JSON.parse(readFileSync(new URL("../data/vintage/miracle-battle.json", import.meta.url), "utf8"));

test("todo código de set do snapshot cai numa série", () => {
  const sem = snap.sets.map((s) => s.code).filter((c) => !seriesOf(c));
  assert.deepEqual(sem, []);
  // Prefixo mais longo primeiro: OPS não pode virar OP, nem DBS virar DB.
  assert.equal(seriesOf("OPS01").key, "op");
  assert.equal(seriesOf("OPC01").key, "op");
  assert.equal(seriesOf("DBS02").key, "db");
  assert.equal(seriesOf("HHEX01").key, "hh");
  assert.equal(seriesOf("DAS02").key, "jh");
  assert.equal(seriesOf("JS01").key, "jh");
  assert.equal(seriesOf("KB01").key, "kb");
  assert.equal(seriesOf("XYZ01"), null);
});

test("as séries que já estavam no ar mantêm o prefixo da marca", () => {
  const prefixo = Object.fromEntries(SERIES.map((s) => [s.key, s.idPrefix]));
  assert.equal(prefixo.op, "op-mb");
  assert.equal(prefixo.nr, "nrt-mb");
  assert.equal(prefixo.hh, "hxh-mb");
  for (const k of ["db", "tr", "jh", "kb"]) assert.equal(prefixo[k], "mb", k);
});

test("o nome do set (a chave dele) é o mesmo de antes da mudança de jogo", () => {
  const set = (code) => snap.sets.find((s) => s.code === code);
  assert.equal(setNameOf(set("OP01"), seriesOf("OP01")), "Miracle Battle OP01 — ブースターパック 第1弾");
  assert.equal(setNameOf(set("NRS01"), seriesOf("NRS01")), "Miracle Battle NRS01 — 構築済みデッキ 木ノ葉の絆");
  assert.equal(setNameOf(set("HH"), seriesOf("HH")), "Miracle Battle HH — プロモーションカード");
  assert.equal(setNameOf(set("DB01"), seriesOf("DB01")), "Miracle Battle DB01 — ブースターパック 第1弾");
  // J-Heroes não tem franquia no nome pra tirar.
  assert.equal(setNameOf(set("AS01"), seriesOf("AS01")), "Miracle Battle AS01 — Jヒーローブースター 1弾");
});

test("as cartas: ids únicos, formato por série, re-impressão (_2) colapsada", () => {
  const cards = buildCards(snap);
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "id duplicado");
  for (const c of cards) {
    // O número vem da fonte como está (tem "op-mb-op01-ω4" no ar desde 2026-07).
    assert.match(c.id, /^(op-mb|nrt-mb|hxh-mb|mb)-[a-z]+\d*-[^\s/]+$/, c.id);
    assert.ok(c.id.startsWith(`${c.setId}-`), `${c.id} fora do set ${c.setId}`);
    assert.equal(c.vintage, true);
    assert.equal(c.setLogo, "/assets/games/game_mbc.webp");
  }
  // Os três prefixos de marca não podem escapar das séries deles.
  assert.ok(cards.filter((c) => c.id.startsWith("op-mb-")).every((c) => c.vintageLine === "op"));
  assert.ok(cards.filter((c) => c.id.startsWith("nrt-mb-")).every((c) => c.vintageLine === "nr"));
  assert.ok(cards.filter((c) => c.id.startsWith("hxh-mb-")).every((c) => c.vintageLine === "hh"));
  // Id pelo número oficial (promo "OP 34" vira "op-34"), não pelo arquivo do scan.
  assert.ok(ids.includes("op-mb-op-op-34"));
  // Scan duplicado (_2) é a mesma carta: um registro só, com o scan base.
  const scans = snap.sets.flatMap((s) => s.cards.map((c) => `${s.code}|${c.num}`));
  assert.equal(cards.length, new Set(scans).size);
});

test("nome em inglês do Naruto vem do mapa, com o original no nameJp — só no Naruto", () => {
  const nr = snap.sets.find((s) => s.code === "NRS01").cards[0];
  const op = snap.sets.find((s) => s.code === "OP01").cards[0];
  const cards = buildCards(snap, { nomesEn: { [nr.name]: "Traduzida", [op.name]: "Não traduz" } });
  const a = cards.find((c) => c.setId === "nrt-mb-nrs01" && c.nameJp === nr.name);
  assert.ok(a, "carta do Naruto sem tradução");
  assert.equal(a.name, "Traduzida");
  const b = cards.find((c) => c.setId === "op-mb-op01" && c.name === op.name);
  assert.ok(b && !b.nameJp, "o mapa do Naruto não vale pro One Piece");
});

test("imagem curada ganha do scan", () => {
  const cards = buildCards(snap, { imagemCurada: (id) => (id === "nrt-mb-nr-nr-15" ? "/assets/cards/mbc/x.webp" : null) });
  assert.equal(cards.find((c) => c.id === "nrt-mb-nr-nr-15").image, "/assets/cards/mbc/x.webp");
});
