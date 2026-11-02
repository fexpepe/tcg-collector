// Testes do sync do Dragon Ball Z CCG da Score (scripts/sync-dbz.mjs): a
// leitura do título das galerias do retrodbzccg ("<número> <nome>"), o id pelo
// set + número, o nome do kizmt só quando a galeria não tem, os previews e
// promos embutidos nas galerias do GT, a variante Silver dos promos do Saiyan
// e o total só com a numeração completa. Sem rede.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { numeroENome, limpaNome, idDe, itensDaGaleria, cartasDasGalerias, mergeSnapshotCards, setTotalOf, imageUrl, nomeDaCarta, NOMES_LIDOS, SETS } from "../scripts/sync-dbz.mjs";

// Uma imagem de galeria como o WordPress (Jetpack tiled gallery) escreve.
const img = (titulo, arquivo) =>
  `<img data-attachment-id="1" data-orig-file="https://retrodbzccg.com/wp-content/uploads/${arquivo}" data-orig-size="400,550" data-image-title="${titulo}" src="https://i0.wp.com/retrodbzccg.com/wp-content/uploads/${arquivo}?w=147&#038;ssl=1" alt="${titulo}" />`;

test("título: número e nome, sem zero à esquerda; códigos de promo", () => {
  assert.deepEqual(numeroENome("60 Blue One-Arm Shoulder Throw"), { num: "60", nome: "Blue One-Arm Shoulder Throw" });
  assert.deepEqual(numeroENome("040"), { num: "40", nome: "" });
  assert.deepEqual(numeroENome("116b Android 18"), { num: "116b", nome: "Android 18" });
  assert.deepEqual(numeroENome("166 alt"), { num: "166 Alt", nome: "" });
  assert.deepEqual(numeroENome("PR1 The Talking Ends Here"), { num: "PR1", nome: "The Talking Ends Here" });
  assert.deepEqual(numeroENome("GKI-1 You&#8217;re Invited"), { num: "GKI-1", nome: "You're Invited" });
  assert.deepEqual(numeroENome("L3-0 Yamcha Season Wild Card"), { num: "L3-0", nome: "Yamcha Season Wild Card" });
  assert.deepEqual(numeroENome("VI01 Captain Ginyu Lv. 1"), { num: "VI1", nome: "Captain Ginyu Lv. 1" });
  // Previews e promos embutidos nas galerias do GT.
  assert.deepEqual(numeroENome("Preview 2 Munching Drill"), { num: "PR2", nome: "Munching Drill", embutido: true });
  assert.deepEqual(numeroENome("Promo 3 Magical Eyedrops"), { num: "P3", nome: "Magical Eyedrops", embutido: true });
  assert.deepEqual(numeroENome("The Golden Ticket"), { num: "", nome: "The Golden Ticket" });
});

test("nome: nível uniforme, aspas e travessão retos, entidades", () => {
  assert.equal(limpaNome("Saibaimen LV4"), "Saibaimen Lv. 4");
  assert.equal(limpaNome("Jeice Lv.1"), "Jeice Lv. 1");
  assert.equal(limpaNome("Goku Level 4"), "Goku Lv. 4");
  assert.equal(limpaNome("Ally&#8217;s Sacrifice"), "Ally's Sacrifice");
  assert.equal(limpaNome("Homework Time&#8230;"), "Homework Time...");
  assert.equal(limpaNome("Vegeta &#8211; Super Saiyan  Lv. 2"), "Vegeta - Super Saiyan Lv. 2");
});

test("id: set + número em minúsculas, ou o nome quando não há número", () => {
  assert.equal(idDe("s3", "40", "Tien's Ready"), "dbz-s3-40");
  assert.equal(idDe("p1", "P3", "Vegeta Lv. 4"), "dbz-p1-p3");
  assert.equal(idDe("s9", "166 Alt", "Kid Trunks Lv. 1"), "dbz-s9-166alt");
  assert.equal(idDe("gpr", "", "Earth Dragon Ball 1 Alt Art"), "dbz-gpr-earth-dragon-ball-1-alt-art");
  for (const id of ["dbz-s3-40", "dbz-lg-l3-0", "dbz-pr-gki-1"]) assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/); // a regex do banco
});

test("galeria: só imagens do uploads, com o caminho do arquivo original", () => {
  const html = `<p>texto</p>${img("1 Orange Standing Fist Punch", "2012/02/1-Orange-Standing-Fist-Punch.jpg")}<img src="https://retrodbzccg.com/logo.png" alt="logo" />`;
  assert.deepEqual(itensDaGaleria(html), [{ titulo: "1 Orange Standing Fist Punch", img: "2012/02/1-Orange-Standing-Fist-Punch.jpg" }]);
  assert.equal(imageUrl("2012/02/040.jpg"), "https://wsrv.nl/?url=retrodbzccg.com%2Fwp-content%2Fuploads%2F2012%2F02%2F040.jpg&w=440&we&output=webp");
});

test("nome: galeria > scan > kizmt (só nas sagas do KIZMT_SET)", () => {
  const paginas = {
    504: img("040", "2012/02/040.jpg") + img("002", "2012/02/210.jpg") + img("039 Tien&#8217;s Ready", "2012/02/039.jpg"),
    2297: img("004", "2012/02/004.jpg")   // Kid Buu Saga: o kizmt mistura o Bojack Unbound
  };
  const kizmt = [
    { set: "Trunks Saga", number: "040", name: "Tien's Ready Stance" },
    { set: "Trunks Saga", number: "039", name: "OUTRO NOME" },
    { set: "Kid Buu Saga", number: "4", name: "Kogu Lv.1" }
  ];
  const { cards, semNome } = cartasDasGalerias(paginas, kizmt);
  const por = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(por["dbz-s3-40"].name, "Tien's Ready Stance");
  assert.equal(por["dbz-s3-40"].nameSource, "kizmt");
  assert.equal(por["dbz-s3-39"].name, "Tien's Ready");           // a galeria vence
  assert.equal(por["dbz-s3-2"].name, NOMES_LIDOS["s3|2"]);       // lido no scan
  assert.equal(por["dbz-s3-2"].nameSource, "scan");
  assert.equal(por["dbz-s11-4"].name, "");                       // sem kizmt no Kid Buu
  assert.deepEqual(semNome, ["s11 4 (2012/02/004.jpg)"]);
  assert.equal(por["dbz-s3-40"].rarity, "Common");
});

test("número que só está no nome do arquivo (Saiyan Saga)", () => {
  const { cards } = cartasDasGalerias({ 34: img("Saiyan City Destruction", "2012/02/45-Saiyan-City-Destruction.jpg") });
  assert.deepEqual([cards[0].id, cards[0].num], ["dbz-s1-45", "45"]);
});

test("promos do Saiyan: revista sem a procedência no nome, Silver vira variante, erro fica fora", () => {
  const { cards } = cartasDasGalerias({
    306: img("P1 Goku Level 4 &#8211; In Power Magazine #3", "2020/11/P1-Goku.jpg")
      + img("P1 Goku Level 4 Silver", "2020/11/P1-Goku-Silver.jpg")
      + img("P4 Goku Level 4 Error Dupe", "2020/11/P4-Goku-Error.jpg")
  });
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0].id, cards[0].name, cards[0].variants], ["dbz-p1-p1", "Goku Lv. 4", ["Normal", "Silver"]]);
});

test("GT: preview e promo embutidos vão pro set de promos da saga; título com vírgula", () => {
  const { cards } = cartasDasGalerias({
    9940: img("001 Metal Mending", "2014/11/001.jpg") + img("Preview 1 Piccolo&#8217;s Knowledge Drill", "2014/11/p1.jpg")
      + img("Promo 2 Black Rejection", "2014/11/p2.jpg") + img("The Golden Ticket", "2014/11/t.jpg")
      + img("206 Goku &#8211; Golden Oozaru Lv. 4", "2014/11/206.jpg")
  });
  assert.deepEqual(cards.map((c) => [c.id, c.rarity]), [
    ["dbz-g1-1", ""], ["dbz-g1p-pr1", "Preview"], ["dbz-g1p-p2", "Promo"], ["dbz-g1p-the-golden-ticket", "Promo"], ["dbz-g1-206", ""]
  ]);
  assert.equal(cards[4].name, "Goku, Golden Oozaru Lv. 4");
});

test("build: o nome lido no scan vence o do snapshot (correção sem reimportar)", () => {
  assert.equal(nomeDaCarta("ca", { num: "CA21", name: "Goku's Super Saiyn Catch" }), "Goku's Super Saiyan Latch");
  assert.equal(nomeDaCarta("s4", { num: "80", name: "Saiayn Wrist Block" }), "Saiyan Wrist Block");
  assert.equal(nomeDaCarta("s1", { num: "1", name: "Orange Standing Fist Punch" }), "Orange Standing Fist Punch");
  // Erro impresso pela Score fica como está.
  assert.equal(nomeDaCarta("t1", { num: "117", name: "Chaiotzu's Self Destruct" }), "Chaiotzu's Self Destruct");
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/dbz-retro.json", import.meta.url), "utf8"));
  for (const s of snap.sets) for (const c of s.cards) {
    const lido = NOMES_LIDOS[`${s.code}|${c.num}`];
    if (lido) assert.equal(c.name, lido, `${c.id}: snapshot fora do NOMES_LIDOS`);
  }
});

test("re-import reaproveita o id conhecido e mantém o que a fonte tirou", () => {
  const known = [{ id: "dbz-s1-1", set: "s1", num: "1", name: "A" }, { id: "dbz-s1-2", set: "s1", num: "2", name: "B" }];
  const fresh = [{ id: "dbz-s1-1-novo", set: "s1", num: "1", name: "A" }];
  assert.deepEqual(mergeSnapshotCards(fresh, known).map((c) => c.id), ["dbz-s1-1", "dbz-s1-2"]);
});

test("total: só com a numeração de 1 ao último, e nunca em set de promo", () => {
  const nums = (...n) => n.map((x) => ({ num: String(x) }));
  assert.equal(setTotalOf(nums(1, 2, 3), { code: "s1" }), "3");
  assert.equal(setTotalOf([...nums(1, 2, 3), { num: "3b" }], { code: "s4" }), "3");
  assert.equal(setTotalOf(nums(30, 42), { code: "cc" }), "");
  assert.equal(setTotalOf(nums(1, 2), { code: "p1", promo: true }), "");
});

test("sets: códigos únicos, galerias sem repetição e o snapshot versionado coerente", () => {
  const codes = SETS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  const pages = SETS.flatMap((s) => s.pages.map((p) => p.id));
  assert.equal(new Set(pages).size, pages.length);
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/dbz-retro.json", import.meta.url), "utf8"));
  const ids = snap.sets.flatMap((s) => s.cards.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, "id repetido no snapshot");
  for (const s of snap.sets) {
    assert.ok(codes.includes(s.code), `set ${s.code} fora do SETS`);
    for (const c of s.cards) {
      assert.ok(c.name, `${c.id} sem nome`);
      assert.ok(c.id.startsWith(`dbz-${s.code}-`), `${c.id} fora do set ${s.code}`);
      assert.match(c.id, /^[a-z0-9][a-z0-9._-]{0,79}$/);
    }
  }
});
