// Testes do sync do Carddass Masters (scripts/sync-carddass-masters.mjs, jogo
// cdm). Do HUNTER×HUNTER: o nome de arquivo da Hunterpedia vira set + número, o
// recorte da FRENTE (o scan é frente e verso juntos) e a lista impressa no
// verso das cartas. Do 新世紀エヴァンゲリオン: a página do animecollection.fr
// vira número + scan, e a lista do colecionador. E o id e o nome de set de
// todo o jogo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile, frontCrop, frontUrl, IMG, rarityOf, cardsOfSet, cardId, setIdOf, setNameOf, IPS, SETS_HXH, LISTA_HXH, numAc, parseAc, rarityAc, SETS_EVA, LISTA_EVA } from "../scripts/sync-carddass-masters.mjs";

const HXH = IPS.find((ip) => ip.ip === "hxh");
const EVA = IPS.find((ip) => ip.ip === "eva");

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

// ── 新世紀エヴァンゲリオン ───────────────────────────────────────────────────

test("eva, rótulo do animecollection.fr: vira o número da lista; embalagem e puzzle montado não são carta", () => {
  assert.equal(numAc("CH - 23"), "CH23");
  assert.equal(numAc("SP - 1"), "SP1");
  assert.equal(numAc("SP-06"), "SP6");
  assert.equal(numAc("DEATH-001"), "DEATH-1");
  assert.equal(numAc("REBIRTH-24"), "REBIRTH-24");
  assert.equal(numAc("25-01"), "25-01");
  assert.equal(numAc("26-7"), "26-07");
  assert.equal(numAc("26-84"), "26-84");
  // 破 第2章: número puro, como o site rotula
  assert.equal(numAc("101"), "101");
  assert.equal(numAc("173"), "173");
  for (const fora of ["Puzzle", "Binder", "Booster Box", "Booster Dos", "Pub", ""]) assert.equal(numAc(fora), null, fora);
});

// Recorte fiel da página (um bloco por carta): raridade no title, rótulo e a
// miniatura h100_<id>; o primeiro bloco é o puzzle montado, sem miniatura de carta.
const PAGINA_AC = `
<div class="bc_cadre_numero" title="Regular" style="background:x;"><div class="bc_texte_numero">Puzzle</div></div>
  <img id="img_1" src="cartes/61/561/h100_23080_puzzle.jpg" />
<div class="bc_cadre_numero" title="SP" style="background:x;"><div class="bc_texte_numero">SP - 1</div></div>
  <img id="img_23082" onclick="afficher_detail('23082','61/561/h400_23082');" src="cartes/61/561/h100_23082_carte.jpg" border="0" class="cadre_carte" />
<div class="bc_cadre_numero" title="Regular" style="background:x;"><div class="bc_texte_numero">CH - 23</div></div>
  <img id="img_23176" onclick="afficher_detail('23176','61/561/h400_23176');" src="cartes/61/561/h100_23176_carte.jpg" border="0" class="cadre_carte" />
<div class="bc_cadre_numero" title="Regular" style="background:x;"><div class="bc_texte_numero">CH - 23</div></div>
  <img id="img_99999" src="cartes/61/561/h100_99999_carte.jpg" />
`;

test("eva, página da série: número, raridade e o scan grande; repetido fica o primeiro", () => {
  assert.deepEqual(parseAc(PAGINA_AC, 61, 561), [
    { num: "SP1", rarity: "Special", img: "animecollection.fr/cartes/61/561/h3000_23082_carte.jpg" },
    { num: "CH23", rarity: "Normal", img: "animecollection.fr/cartes/61/561/h3000_23176_carte.jpg" }
  ]);
  // "Super Rare" é como o site chama as SP dos Wide
  const wide = '<div class="bc_cadre_numero" title="Super Rare" style="x"><div class="bc_texte_numero">SP-06</div></div><img src="cartes/63/151/h100_5770_carte.jpg" />';
  assert.deepEqual(parseAc(wide, 63, 151), [{ num: "SP6", rarity: "Special", img: "animecollection.fr/cartes/63/151/h3000_5770_carte.jpg" }]);
  // 破 第2章: SSP e SSSP ficam com o nome da Bandai; a キービジュアル é Promo
  assert.deepEqual(["SP", "SSP", "SSSP", "Promo", "Regular", "Rare"].map(rarityAc), ["Special", "SSP", "SSSP", "Promo", "Normal", "Normal"]);
  // miniatura de outra série não vale
  assert.deepEqual(parseAc(wide, 63, 149), []);
  // o site é http: a origem vai pro wsrv sem esquema e sai em https
  assert.equal(IMG("animecollection.fr/cartes/61/561/h3000_23082_carte.jpg"), "https://wsrv.nl/?url=animecollection.fr%2Fcartes%2F61%2F561%2Fh3000_23082_carte.jpg&w=440&output=webp");
});

test("eva, lista: total oficial de cada edição, número único, inglês sempre, SP no fim", () => {
  const total = { p1: 172, p2: 172, w1: 132, w2: 132, ha2: 73 }, sp = { p1: 4, p2: 9, w1: 6, w2: 6 };
  for (const def of SETS_EVA) {
    const l = LISTA_EVA[def.lista];
    assert.equal(l.length, total[def.code], def.code);
    assert.equal(new Set(l.map((c) => c.n)).size, l.length, def.code);
    for (const c of l) assert.ok(c.en && /^[A-Z0-9-]+$/.test(c.n), `${def.code} ${c.n}`);
    if (!sp[def.code]) continue;
    assert.deepEqual(l.slice(-sp[def.code]).map((c) => c.n), Array.from({ length: sp[def.code] }, (_, i) => `SP${i + 1}`), def.code);
    // id é o contrato: número nenhum da edição colide depois de virar id
    assert.equal(new Set(l.map((c) => cardId("eva", def.code, c.n))).size, l.length, def.code);
  }
  // episódio: japonês e o título oficial em inglês
  assert.deepEqual(LISTA_EVA.p1.find((c) => c.n === "EP1"), { n: "EP1", ja: "第1話「使徒、襲来」", en: "Episode 1: Angel Attack", ep: 1 });
  // as 10 do Air que a lista do colecionador deixa em branco saem do scan e ficam marcadas
  assert.equal(LISTA_EVA.w2.filter((c) => c.fonte === "scan").length, 10);
  assert.deepEqual(LISTA_EVA.w2.find((c) => c.n === "26-01"), { n: "26-01", en: "The End of Evangelion", fonte: "scan" });
  // Air: dois dígitos, pra tela (que desempata por texto) não pôr 26-10 antes de 26-07
  assert.ok(LISTA_EVA.w2.filter((c) => !/^SP/.test(c.n)).every((c) => /^2[56]-\d\d$/.test(c.n)));
  // 破 第2章: lida na frente das cartas, 101 a 173 sem buraco (o 第1章 vai até 100)
  assert.deepEqual(LISTA_EVA.ha2.map((c) => c.n), Array.from({ length: 73 }, (_, i) => String(101 + i)));
  assert.deepEqual(LISTA_EVA.ha2.find((c) => c.n === "130"), { n: "130", ja: "式波・アスカ・ラングレー", en: "Asuka Shikinami Langley" });
  assert.equal(LISTA_EVA.ha2.find((c) => c.n === "137").en, "Story Scene Select 01");
});

test("eva, cartas: a lista manda; a 第弐集 entra sem scan, com a raridade pelo número", () => {
  const p1 = SETS_EVA.find((s) => s.code === "p1");
  const cards = cardsOfSet(EVA, p1, parseAc(PAGINA_AC, 61, 561));
  assert.equal(cards.length, 172);
  assert.deepEqual(cards.find((c) => c.number === "CH23"), { id: "cdm-eva-p1-ch23", name: "EVA-00 (Refit)", nameJp: "エヴァンゲリオン零号機(改)", number: "CH23", rarity: "Normal", img: "animecollection.fr/cartes/61/561/h3000_23176_carte.jpg" });
  const p2 = cardsOfSet(EVA, SETS_EVA.find((s) => s.code === "p2"), undefined);
  assert.equal(p2.length, 172);
  assert.ok(p2.every((c) => c.img === ""));
  assert.equal(p2.filter((c) => c.rarity === "Special").length, 9);
  // Wide: o hífen do número vira o do id
  assert.equal(cardId("eva", "w1", "DEATH-1"), "cdm-eva-w1-death-1");
  assert.equal(cardId("eva", "w2", "26-84"), "cdm-eva-w2-26-84");
  // sem japonês (lida só do scan): a carta não leva nameJp
  const w2 = cardsOfSet(EVA, SETS_EVA.find((s) => s.code === "w2"), []);
  assert.ok(!("nameJp" in w2.find((c) => c.number === "26-01")));
});

test("eva, set: a IP abre o nome, o jogo e o formato (ワイド) não", () => {
  const nomes = EVA.sets.map((def) => setNameOf(EVA, def));
  // o 新劇場版 tem título próprio no lugar do da série de TV (`prefix`)
  assert.deepEqual(nomes, ["新世紀エヴァンゲリオン 第壱集", "新世紀エヴァンゲリオン 第弐集", "新世紀エヴァンゲリオン 劇場版 シト新生", "新世紀エヴァンゲリオン 劇場版 Air/まごころを、君に", "ヱヴァンゲリヲン新劇場版:破 第2章"]);
  for (const a of nomes) for (const b of nomes) assert.ok(a === b || !b.startsWith(a + " "), `${a} engoliria ${b}`);
  // ids de set e de carta de uma IP nunca caem nos de outra
  const todos = IPS.flatMap((ip) => ip.sets.map((def) => setIdOf(ip.ip, def.code)));
  assert.equal(new Set(todos).size, todos.length);
});
