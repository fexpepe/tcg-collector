// Testes do sync do Gundam Carddass (scripts/sync-gundam-carddass.mjs, a linha
// vintage gcd do jogo gundam): o parse da página do animecollection, o id
// pegajoso pelo id da carta na fonte, o número em kanji da 戦国伝, o nome do
// set (e o endereço que sai dele) e os nomes transcritos dos scans.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETS, SERIES, LINE, ID_PREFIX, parseAnimeCollection, assignIds, numeroArabico, nameEn,
  setName, setNameEn, setIdOf, scanDe, IMG, cartasDaLinha, corrige, CORRECOES
} from "../scripts/sync-gundam-carddass.mjs";
import { slugify } from "../functions/_lib/slug-carta.js";
import { chaveBase } from "../scripts/lib/img-mirror.mjs";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNAP = JSON.parse(ler("data/vintage/gundam-carddass.json"));
const NOMES = JSON.parse(ler("scripts/data/gundam-carddass-nomes.json"));
const NOMES_EN = JSON.parse(ler("scripts/data/gundam-carddass-nomes-en.json"));

// Recorte fiel da página de uma parte: o bloco da EMBALAGEM (que também tem
// "bc_cadre_numero", mas abre com afficher_detail_pack) e três cartas.
const carta = (raridade, numero, id, dir) => `
<td class="bloc_carte"><a name="c${id}"></a>
<div class="bc_cadre" style="padding-bottom:1px;">
	<div class="bc_cadre_numero" title="${raridade}" style="background:transparent url(images/titres_cartes/rouge.jpg) repeat-x;"><div class="bc_texte_numero">${numero}</div></div>
	<div class="bc_cadre_carte"><table><tr><td class="bc_zone_carte">
		<table class="table_carte"><tr><td class="cadre_carte1"><img id="img_${id}" onclick="afficher_detail('${id}','${dir}/h400_${id}');" src="cartes/${dir}/h100_${id}_carte.jpg" border="0" class="cadre_carte" /></td></tr></table>
	</td></tr></table></div>
</div>
</td>`;
const PAGINA = `
<div class="bc_cadre"><div class="bc_cadre_numero" title="" style=""><div class="bc_texte_numero">Display</div></div>
<img id="img_pack_1529" onclick="afficher_detail_pack('1529','167/351/h400_1529');" src="packagings/167/351/h100_1529_packaging.jpg" /></div>
<img src="images/bloc/titre_vert_cartes.jpg" />
<table><tr>${carta("Prism", "1", 14649, "167/351")}${carta("Regular", "2", 14650, "167/351")}${carta("Double Prism", "&#20108;&#21313;&#19968;", 29653, "340/720")}</tr></table>`;

test("página do animecollection: número, raridade, id na fonte e pasta do scan", () => {
  assert.deepEqual(parseAnimeCollection(PAGINA), [
    { src: 14649, num: "1", rar: "Prism", dir: "167/351" },
    { src: 14650, num: "2", rar: "Normal", dir: "167/351" },
    // kanji em entidade decimal (二十一), como a fonte escreve a 戦国伝
    { src: 29653, num: "21", rar: "Double Prism", dir: "340/720" }
  ]);
  // o item da embalagem ("Display") não vira carta nem empresta o cabeçalho pra 1ª
  assert.ok(!parseAnimeCollection(PAGINA).some((c) => c.num === "Display"));
  assert.deepEqual(parseAnimeCollection("<html>fora do ar</html>"), []);
});

test("número em kanji da 戦国伝 vira arábico; o resto passa como veio", () => {
  const casos = { "一": "1", "九": "9", "十": "10", "十一": "11", "二十": "20", "二十一": "21", "四十二": "42", "八十四": "84", "007": "7", "500": "500", "SP1": "SP1" };
  for (const [de, para] of Object.entries(casos)) assert.equal(numeroArabico(de), para, de);
});

test("id: linha + série e parte + número impresso; repetido ganha sufixo e o id GRUDA no src", () => {
  const pagina = [{ src: 26180, num: "500", rar: "Double Prism", dir: "167/625" }, { src: 26181, num: "500", rar: "Prism", dir: "167/625" }, { src: 26182, num: "501", rar: "Normal", dir: "167/625" }];
  const primeira = assignIds("wd13", pagina, []);
  assert.deepEqual(primeira.map((c) => c.id), ["gcd-wd13-500", "gcd-wd13-500b", "gcd-wd13-501"]);
  // a fonte reordena a página e corrige um número: nenhum id muda
  const depois = assignIds("wd13", [pagina[2], { ...pagina[1], num: "500" }, { ...pagina[0], rar: "Prism" }], primeira);
  assert.deepEqual(depois.map((c) => [c.src, c.id]), [[26182, "gcd-wd13-501"], [26181, "gcd-wd13-500b"], [26180, "gcd-wd13-500"]]);
  // carta que sumiu da fonte continua; carta nova não toma id já usado
  const some = assignIds("wd13", [pagina[0], { src: 99999, num: "501", rar: "Normal", dir: "167/625" }], primeira);
  assert.deepEqual(some.map((c) => c.id), ["gcd-wd13-500", "gcd-wd13-501b", "gcd-wd13-500b", "gcd-wd13-501"]);
});

test("snapshot: ids únicos, com o prefixo da linha e o número da carta", () => {
  const ids = new Set();
  for (const s of SNAP.sets) {
    assert.ok(SETS.some((d) => d.code === s.code && d.ac), `${s.code} não está no SETS`);
    for (const c of s.cards) {
      assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
      ids.add(c.id);
      assert.match(c.id, new RegExp(`^${ID_PREFIX}${s.code}-${c.num.toLowerCase()}[b-z]?$`), c.id);
      assert.ok(Number.isInteger(c.src) && /^\d+\/\d+$/.test(c.dir), c.id);
    }
  }
  assert.ok(ids.size >= 1475, `snapshot encolheu: ${ids.size}`);
});

test("set: a série abre o nome sem o SD da marca, e nenhum nome engole outro", () => {
  const def = (code) => SETS.find((s) => s.code === code);
  assert.equal(setName(def("wd01")), "本弾 第1弾");
  assert.equal(setName(def("gd08")), "外伝 第8弾「円卓の騎士」");
  assert.equal(setName(def("sg02")), "戦国伝 第2弾「風林火山編」");
  assert.equal(setName(def("sd02")), "聖伝 クエストツー「最強の闘士」");
  assert.equal(setName(def("gg01")), "機動武闘伝Gガンダム");
  assert.equal(setIdOf("gd08"), "gcd-gd08");
  const nomes = SETS.map(setName);
  assert.equal(new Set(nomes).size, nomes.length, "dois sets com o mesmo nome");
  // nenhum nome é começo de outro + espaço: o aninhaPorNome viraria um em chip do outro
  for (const a of nomes) for (const b of nomes) assert.ok(a === b || !b.startsWith(a + " "), `${a} engoliria ${b}`);
  for (const en of SETS.map(setNameEn)) for (const b of SETS.map(setNameEn)) assert.ok(en === b || !b.startsWith(en + " "), `${en} engoliria ${b}`);
});

test("endereço do set: único sem desempate (não depende da ordem do catálogo)", () => {
  // a mesma conta do scripts/lib/paginas-de-set.mjs, sem o desempate -2
  const slugs = SETS.map((s) => {
    let base = slugify(setName(s)) || slugify(setIdOf(s.code));
    if (base.length < 4) base = `${slugify(setIdOf(s.code))}-${base}`;
    return base;
  });
  assert.equal(new Set(slugs).size, slugs.length, "dois sets disputariam o endereço (um levaria -2 pela ordem)");
  // quase todos caem na régua do setId (o japonês não deixa nada no slug); o
  // "VS" do 外伝 第10弾 sobra e o endereço fica "10-vs", como o "9-vs" do dbc
  assert.equal(slugs[SETS.findIndex((s) => s.code === "wd01")], "gcd-wd01-1");
  assert.equal(slugs[SETS.findIndex((s) => s.code === "gd10")], "10-vs");
});

test("imagem: o scan grande pelo wsrv, e o espelho do R2 guarda pela URL de origem", () => {
  const c = { src: 14649, dir: "167/351" };
  assert.equal(scanDe(c), "www.animecollection.fr/cartes/167/351/h3000_14649_carte.jpg");
  assert.equal(IMG(scanDe(c)), "https://wsrv.nl/?url=www.animecollection.fr%2Fcartes%2F167%2F351%2Fh3000_14649_carte.jpg&w=440&output=webp");
  assert.equal(chaveBase(IMG(scanDe(c))), "wsrv.nl/www.animecollection.fr/cartes/167/351/h3000_14649_carte.jpg");
});

test("nome EN: inteiro ou composto; meia tradução não sai", () => {
  const g = { phrases: { "ガンダムVSシャア専用ザク": "Gundam vs. Char's Zaku" }, atoms: { "ガンダム": "Gundam", "シャア": "Char", "アムロ": "Amuro" } };
  assert.equal(nameEn("ガンダム", g), "Gundam");
  assert.equal(nameEn("アムロ＆シャア", g), "Amuro & Char");
  assert.equal(nameEn("ガンダムVSシャア", g), "Gundam vs. Char");
  assert.equal(nameEn("ガンダムVSシャア専用ザク", g), "Gundam vs. Char's Zaku");
  assert.equal(nameEn("ガンダム／シャア", g), "Gundam / Char"); // várias unidades na carta
  assert.equal(nameEn("アムロ＆ララァ", g), "");
  assert.equal(nameEn("", g), "");
});

test("cartas: nome transcrito (EN quando o glossário cobre), número, raridade e a linha", () => {
  const snap = { sets: [{ code: "wd13", cards: [
    { id: "gcd-wd13-500", src: 26180, num: "500", rar: "Double Prism", dir: "167/625" },
    { id: "gcd-wd13-500b", src: 26181, num: "500", rar: "Prism", dir: "167/625" },
    { id: "gcd-wd13-501", src: 26182, num: "501", rar: "Normal", dir: "167/625" },
    { id: "gcd-wd13-502", src: 26183, num: "502", rar: "Normal", dir: "167/625" }
  ] }] };
  const nomes = { "gcd-wd13-500": "ガンダム", "gcd-wd13-500b": "ガンダム", "gcd-wd13-501": "武者頑駄無" };
  const cartas = cartasDaLinha(snap, nomes, { phrases: {}, atoms: { "ガンダム": "Gundam" } });
  assert.deepEqual(cartas.map((c) => [c.id, c.name, c.nameJp, c.rarity]), [
    ["gcd-wd13-500", "Gundam", "ガンダム", "Double Prism"],
    ["gcd-wd13-500b", "Gundam", "ガンダム", "Prism"],
    ["gcd-wd13-501", "武者頑駄無", undefined, "Normal"], // sem tradução segura: fica o japonês
    ["gcd-wd13-502", "No. 502", undefined, "Normal"]    // sem nome transcrito: o número, nunca um nome inventado
  ]);
  const c = cartas[0];
  assert.equal(c.set, "本弾 第13弾");
  assert.equal(c.setId, "gcd-wd13");
  // 3 números (o 500 tem duas versões): é o Y do "X/Y"
  assert.equal(c.setTotal, 3);
  assert.equal(c.setReleaseDate, "1992");
  assert.equal(c.language, "ja");
  assert.equal(c.setLogo, "");
  assert.equal(c.vintage, true);
  assert.equal(c.vintageLine, LINE);
});

test("total oficial vale onde a fonte tem buraco (o No.124 do 本弾 第3弾)", () => {
  const wd03 = SNAP.sets.find((s) => s.code === "wd03");
  assert.ok(!wd03.cards.some((c) => c.num === "124"), "a fonte passou a ter o No.124: tire o `total` do wd03 no SETS");
  const cartas = cartasDaLinha({ sets: [wd03] }, {}, { phrases: {}, atoms: {} });
  assert.equal(cartas.length, 41);
  assert.equal(cartas[0].setTotal, 42);
});

test("erros da fonte: scan repetido sai, e o número impresso vence o da página", () => {
  const pagina = [
    { src: 29789, num: "30", rar: "Normal", dir: "342/725" },
    { src: 29790, num: "31", rar: "Normal", dir: "342/725" }, // impresso No.032
    { src: 29794, num: "36", rar: "Normal", dir: "342/725" },
    { src: 29795, num: "36", rar: "Normal", dir: "342/725" }  // o mesmo scan do 36
  ];
  assert.deepEqual(corrige(pagina).map((c) => [c.src, c.num]), [[29789, "30"], [29790, "32"], [29794, "36"]]);
  assert.deepEqual(assignIds("gg01", corrige(pagina), []).map((c) => c.id), ["gcd-gg01-30", "gcd-gg01-32", "gcd-gg01-36"]);
  // no snapshot: nenhuma das repetidas, e os três sets com o total oficial
  const srcs = new Set(SNAP.sets.flatMap((s) => s.cards.map((c) => c.src)));
  for (const [src, fix] of Object.entries(CORRECOES)) assert.equal(srcs.has(Number(src)), fix !== null, src);
  for (const [code, tem, total] of [["sg03", 20, 21], ["ns01", 20, 21], ["gg01", 41, 42]]) {
    const set = SNAP.sets.find((s) => s.code === code);
    assert.equal(set.cards.length, tem, code);
    assert.equal(cartasDaLinha({ sets: [set] }, {}, { phrases: {}, atoms: {} })[0].setTotal, total, code);
  }
});

test("nomes transcritos: toda carta do snapshot tem nome, e todo nome é de uma carta do snapshot", () => {
  const ids = new Set(SNAP.sets.flatMap((s) => s.cards.map((c) => c.id)));
  const semNome = [...ids].filter((id) => !NOMES.nomes[id]);
  assert.deepEqual(semNome, [], `${semNome.length} carta(s) sem nome transcrito`);
  const orfaos = Object.keys(NOMES.nomes).filter((id) => !ids.has(id));
  assert.deepEqual(orfaos, [], "nome de carta que não está no snapshot");
  for (const [id, nome] of Object.entries(NOMES.nomes)) {
    assert.equal(nome, nome.trim(), id);
    assert.ok(!/[|?？]/.test(nome) || /[?？]$/.test(nome), `${id}: "${nome}" ficou com marca de transcrição`);
  }
});

test("glossário EN: só nome que existe nas cartas, sem valor vazio", () => {
  const usados = new Set(Object.values(NOMES.nomes));
  for (const [ja, en] of Object.entries(NOMES_EN.phrases)) {
    assert.ok(en && en.trim() === en, `phrases["${ja}"] vazio`);
    assert.ok(usados.has(ja), `phrases["${ja}"] não é nome de carta nenhuma`);
  }
  for (const [ja, en] of Object.entries(NOMES_EN.atoms)) assert.ok(en && en.trim() === en, `atoms["${ja}"] vazio`);
});
