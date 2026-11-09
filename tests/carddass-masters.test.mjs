// Testes do sync do Carddass Masters (scripts/sync-carddass-masters.mjs, jogo
// cdm). Do HUNTER×HUNTER: o nome de arquivo da Hunterpedia vira set + número, o
// recorte da FRENTE (o scan é frente e verso juntos) e a lista impressa no
// verso das cartas. E o id e o nome de set de todo o jogo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile, frontCrop, frontUrl, IMG, rarityOf, cardsOfSet, cardId, setIdOf, setNameOf, IPS, SETS_HXH, LISTA_HXH } from "../scripts/sync-carddass-masters.mjs";

const HXH = IPS.find((ip) => ip.ip === "hxh");

test("arquivo: parte, número impresso (sem zero à esquerda) e se tem o verso junto", () => {
  assert.deepEqual(parseFile("File:Carddass masters part 1 card 029.png"), { setCode: "p1", num: "29", fb: false });
  assert.deepEqual(parseFile("Carddass_masters_part_2_card_sp3.png"), { setCode: "p2", num: "SP3", fb: false });
  assert.deepEqual(parseFile("Carddass masters part 2 card 010 front and back.png"), { setCode: "p2", num: "10", fb: true });
  assert.deepEqual(parseFile("Carddass masters premium edition card 01 front and back.png"), { setCode: "pe", num: "1", fb: true });
  assert.deepEqual(parseFile("HxH CM Jacket Collection Bonus Card - Front.png"), { setCode: "vd", num: "VD3", fb: false });
  // embalagem e o VERSO do brinde não são carta
  assert.equal(parseFile("Carddass masters part 1 booster pack.png"), null);
  assert.equal(parseFile("HxH CM Jacket Collection Bonus Card - Back.png"), null);
});

test("recorte: metade esquerda do par lado a lado, metade de cima do empilhado, nada sem verso", () => {
  assert.deepEqual(frontCrop(true, 1024, 722), { x: 0, y: 0, w: 512, h: 722 });
  assert.deepEqual(frontCrop(true, 541, 768), { x: 0, y: 0, w: 541, h: 384 });
  // carta horizontal sozinha também é larga: sem "front and back", não corta
  assert.equal(frontCrop(false, 998, 698), null);
});

test("recorte no CAMINHO da Fandom (o espelho do R2 descarta a query do wsrv)", () => {
  const url = "https://static.wikia.nocookie.net/hunterxhunter/images/b/b2/X_front_and_back.png/revision/latest?cb=20230714001731";
  const src = frontUrl(url, frontCrop(true, 1024, 720));
  assert.equal(src, "static.wikia.nocookie.net/hunterxhunter/images/b/b2/X_front_and_back.png/revision/latest/window-crop/width/512/x-offset/0/y-offset/0/window-width/512/window-height/720");
  assert.equal(frontUrl(url, null), "static.wikia.nocookie.net/hunterxhunter/images/b/b2/X_front_and_back.png");
  // a chave do espelho sai do parâmetro url decodificado: o recorte vai junto
  const q = /[?&]url=([^&]+)/.exec(IMG(src));
  assert.match(decodeURIComponent(q[1]), /window-crop\/width\/512/);
});

test("raridade: categoria da Hunterpedia; o brinde da fita é Promo", () => {
  assert.equal(rarityOf(["Carddass Masters Regular Cards", "Images on Fair Use"], "p1"), "Normal");
  assert.equal(rarityOf(["Carddass Masters Special Cards"], "p2"), "Special");
  assert.equal(rarityOf(["Carddass Masters Special Cards"], "vd"), "Promo");
});

test("lista do verso: 139 cartas por parte (135 + 4 especiais), número único, inglês sempre", () => {
  for (const parte of ["p1", "p2"]) {
    const l = LISTA_HXH[parte];
    assert.equal(l.length, 139, parte);
    assert.equal(new Set(l.map((c) => c.n)).size, 139, parte);
    assert.deepEqual(l.slice(-4).map((c) => c.n), ["SP1", "SP2", "SP3", "SP4"]);
    for (const c of l) assert.ok(c.en, `${parte} ${c.n} sem inglês`);
  }
  // episódio: japonês + inglês do mesmo número (o 45 tem duas cartas na Parte 2)
  const ep45 = LISTA_HXH.p2.filter((c) => c.ep === 45).map((c) => c.n);
  assert.deepEqual(ep45, ["96", "97"]);
  assert.match(LISTA_HXH.p1.find((c) => c.n === "82").ja, /^第1話「/);
});

test("cartas: a lista manda nas partes (scan só põe imagem), a Premium sai dos scans", () => {
  const p1 = SETS_HXH.find((s) => s.code === "p1");
  const scans = [{ num: "29", rarity: "Normal", chars: ["Kurapika"], img: "a/b.png" }];
  const cards = cardsOfSet(HXH, p1, scans);
  assert.equal(cards.length, 139);
  const c29 = cards.find((c) => c.number === "29");
  assert.deepEqual(c29, { id: "cdm-hxh-p1-29", name: "Kurapika", nameJp: "クラピカ", number: "29", rarity: "Normal", img: "a/b.png" });
  // sem scan: a carta existe, sem imagem, e a raridade sai do número
  const sp1 = cards.find((c) => c.number === "SP1");
  assert.equal(sp1.img, "");
  assert.equal(sp1.rarity, "Special");

  const pe = SETS_HXH.find((s) => s.code === "pe");
  const peCards = cardsOfSet(HXH, pe, [
    { num: "8", rarity: "Normal", chars: ["Leorio Paradinight", "Kurapika", "Gon Freecss"], img: "x" },
    { num: "SP1", rarity: "Special", chars: [], img: "y" }
  ]);
  assert.deepEqual(peCards.map((c) => c.name), ["Leorio Paradinight & Kurapika", "Card SP1"]);
  assert.ok(!("nameJp" in peCards[0]));
});

test("id: jogo, IP, set e número impresso", () => {
  assert.equal(cardId("hxh", "p2", "SP4"), "cdm-hxh-p2-sp4");
  assert.equal(cardId("hxh", "vd", "VD3"), "cdm-hxh-vd-vd3");
  assert.equal(cardId("hxh", "pe", "12"), "cdm-hxh-pe-12");
  assert.equal(setIdOf("hxh", "p1"), "cdm-hxh-p1");
});

test("set: a IP abre o nome (é o que separa os sets no jogo), o jogo não", () => {
  const nomes = HXH.sets.map((def) => setNameOf(HXH, def));
  assert.deepEqual(nomes, ["HUNTER×HUNTER パート1 ゴン×ライバル×ハンター試験開始!", "HUNTER×HUNTER Premium Edition", "HUNTER×HUNTER パート2", "HUNTER×HUNTER セルビデオ 購入特典カード"]);
  // nenhum nome é começo de outro + espaço: o aninhaPorNome viraria um em chip do outro
  for (const a of nomes) for (const b of nomes) assert.ok(a === b || !b.startsWith(a + " "), `${a} engoliria ${b}`);
});
