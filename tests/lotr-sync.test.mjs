// Testes do sync do LOTR TCG da Decipher (scripts/sync-lotr.mjs): o id pelo
// código impresso, a numeração dos impressos especiais (Tengwar, Legends,
// Masterworks, as três artes do 15C60), os sets de promo à parte, o foil como
// variante e o zip mínimo do export do Player's Council. Sem rede.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { cardFromRow, mergeSnapshotCards, parseTsv, unzip, variantsOf, setTotalOf, imageUrl, SETS } from "../scripts/sync-lotr.mjs";

const IMAGENS = new Set(["LOTR01284", "LOTR01001T", "LOTR11F01", "LOTR12O01", "LOTR09032", "LOTR15060D", "LOTR00AFD", "LOTR01M03", "LOTR00W01"]);
const carta = (row, extra = {}) => cardFromRow(
  { CardSuffix: "", TLHH_ImageNum: "", ...row },
  { setNumber: 1, title: "Bilbo", subtitle: "", culture: "", type: "", images: IMAGENS, ...extra }
);

test("id: código impresso em minúsculas; o + do Reflections vira 'plus'", () => {
  const c = carta({ RarityID: "8", CardNumber: "284", CollectorsInfo: "1R284", TLHH_ImageNum: "LOTR01284" },
    { subtitle: "Retired Adventurer", culture: "Shire", type: "Ally" });
  assert.deepEqual(c, {
    id: "lotr-1r284", code: "1R284", set: "01", num: "284", name: "Bilbo, Retired Adventurer",
    rarity: "Rare", kind: "base", culture: "Shire", type: "Ally", img: "LOTR01284"
  });
  const r = carta({ RarityID: "9", CardNumber: "32", CollectorsInfo: "9R+32" }, { setNumber: 9 });
  assert.equal(r.id, "lotr-9rplus32");
  assert.match(r.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/); // a regex do banco (increment_card_view)
});

test("Tengwar: sufixo no id e no número, raridade e nome próprios", () => {
  const c = carta({ RarityID: "8", CardNumber: "1", CardSuffix: "T", CollectorsInfo: "1R1", TLHH_ImageNum: "LOTR01001T" },
    { title: "The One Ring", subtitle: "Isildur's Bane" });
  assert.equal(c.id, "lotr-1r1t");
  assert.equal(c.num, "1T");
  assert.equal(c.rarity, "Tengwar");
  assert.equal(c.name, "The One Ring, Isildur's Bane (T)"); // o nome do MYP
});

test("Legends numeram F1…, Masterworks seguem a numeração do set", () => {
  const f = carta({ RarityID: "10", CardNumber: "1", CollectorsInfo: "11RF1", TLHH_ImageNum: "LOTR11F01" }, { setNumber: 11 });
  assert.deepEqual([f.id, f.num, f.kind, f.set], ["lotr-11rf1", "F1", "legends", "11"]);
  const o = carta({ RarityID: "5", CardNumber: "195", CollectorsInfo: "12O195", TLHH_ImageNum: "LOTR12O01" }, { setNumber: 12 });
  assert.deepEqual([o.id, o.num, o.kind], ["lotr-12o195", "195", "masterwork"]);
});

test("15C60: as outras duas artes (2060/3060 no PC) mostram o número 60", () => {
  const c = carta({ RarityID: "2", CardNumber: "2060", CollectorsInfo: "15C2060", TLHH_ImageNum: "LOTR15060D" }, { setNumber: 15 });
  assert.equal(c.id, "lotr-15c2060");
  assert.equal(c.num, "60-2");
  assert.equal(setTotalOf([c, { kind: "base", num: "194" }], { code: "15" }), "194");
});

test("promos especiais vão pros sets próprios, com numeração que não se intercala", () => {
  const m = carta({ RarityID: "4", CardNumber: "3", CollectorsInfo: "1M3", TLHH_ImageNum: "LOTR01M03" });
  assert.deepEqual([m.set, m.num, m.id], ["00m", "1M3", "lotr-1m3"]);
  const d = carta({ RarityID: "3", CardNumber: "8", CollectorsInfo: "0D8", TLHH_ImageNum: "LOTR00D08" }, { setNumber: 0 });
  assert.deepEqual([d.set, d.num, d.img], ["00d", "D8", ""]); // sem scan no host: fica sem imagem
  const w = carta({ RarityID: "14", CardNumber: "1", CollectorsInfo: "0W1", TLHH_ImageNum: "LOTR00W01" }, { setNumber: 0 });
  assert.deepEqual([w.set, w.num], ["00w", "W1"]);
  // A do 1º de abril vem sem código no banco: o arquivo da imagem dá o nome.
  const afd = carta({ RarityID: "1", CardNumber: "0", CollectorsInfo: "", TLHH_ImageNum: "LOTR00AFD" }, { setNumber: 0 });
  assert.deepEqual([afd.id, afd.set, afd.num, afd.rarity], ["lotr-0afd", "00j", "AFD", "April Fool's"]);
  const p = carta({ RarityID: "6", CardNumber: "12", CollectorsInfo: "0P12" }, { setNumber: 0 });
  assert.deepEqual([p.set, p.num, p.rarity], ["00", "12", "Promo"]);
});

test("foil: variante nos sets 1–8 e 10 (só C/U/R); Reflections, Legends e Masterworks só foil", () => {
  assert.deepEqual(variantsOf({ rarity: "Common", kind: "base" }, "01"), ["Normal", "Foil"]);
  assert.deepEqual(variantsOf({ rarity: "Rare", kind: "base" }, "10"), ["Normal", "Foil"]);
  assert.deepEqual(variantsOf({ rarity: "Premium", kind: "base" }, "04"), ["Normal"]);
  assert.deepEqual(variantsOf({ rarity: "Tengwar", kind: "tengwar" }, "01"), ["Normal"]);
  assert.deepEqual(variantsOf({ rarity: "Rare Plus", kind: "base" }, "09"), ["Foil"]);
  assert.deepEqual(variantsOf({ rarity: "Rare", kind: "base" }, "11"), ["Normal"]);
  assert.deepEqual(variantsOf({ rarity: "Legends", kind: "legends" }, "11"), ["Foil"]);
  assert.deepEqual(variantsOf({ rarity: "Masterwork", kind: "masterwork" }, "12"), ["Foil"]);
  assert.deepEqual(variantsOf({ rarity: "Promo", kind: "base" }, "00"), ["Normal"]);
});

test("re-import: id conhecido fica, carta que a fonte tirou fica", () => {
  const known = [{ id: "lotr-1r1", code: "1R1", name: "velha" }, { id: "lotr-1r2", code: "1R2", name: "sumiu" }];
  const out = mergeSnapshotCards([{ id: "lotr-novo", code: "1R1", name: "nova" }], known);
  assert.deepEqual(out.map((c) => [c.id, c.name]), [["lotr-1r1", "nova"], ["lotr-1r2", "sumiu"]]);
});

test("TSV do SQL Server: linha partida por quebra de texto é descartada", () => {
  const rows = parseTsv("ID\tName\tNotes\r\n1\tShire\t\r\n2\tTexto com\r\nquebra\t\r\n3\tGondor\t");
  assert.deepEqual(rows.map((r) => r.Name), ["Shire", "Gondor"]);
});

test("unzip mínimo: lê entrada deflate do diretório central", () => {
  const nome = Buffer.from("dbo.Sets.csv");
  const dado = Buffer.from("ID\tSetNumber\n1\t0\n");
  const comp = deflateRawSync(dado);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dado.length, 22); local.writeUInt16LE(nome.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dado.length, 24); central.writeUInt16LE(nome.length, 28);
  central.writeUInt32LE(0, 42);
  const corpo = Buffer.concat([local, nome, comp]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nome.length, 12); eocd.writeUInt32LE(corpo.length, 16);
  const zip = Buffer.concat([corpo, central, nome, eocd]);
  assert.equal(unzip(zip)["dbo.Sets.csv"].toString(), dado.toString());
});

test("imagem: scan original pelo wsrv.nl, sem ampliar; sem arquivo, sem imagem", () => {
  assert.equal(imageUrl("LOTR01284"), "https://wsrv.nl/?url=i.lotrtcgpc.net%2Fdecipher%2FLOTR01284.jpg&w=440&we&output=webp");
  assert.equal(imageUrl(""), "");
});

test("snapshot versionado: ids únicos, válidos pro banco e do formato lotr-<código>", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/lotr-pc.json", import.meta.url), "utf8"));
  const codes = new Set(SETS.map((s) => s.code));
  const ids = new Set();
  for (const s of snap.sets) {
    assert.ok(codes.has(s.code), `set desconhecido no snapshot: ${s.code}`);
    for (const c of s.cards) {
      assert.match(c.id, /^lotr-[0-9a-z]+$/);
      assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
      ids.add(c.id);
    }
  }
  assert.ok(ids.size >= 3527, `snapshot encolheu: ${ids.size}`);
  // A regra de ouro do PC: decipher/double e decipher/huge são cartas redesenhadas.
  assert.ok(!/decipher\/(double|huge)\//.test(readFileSync(new URL("../scripts/sync-lotr.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")));
});
