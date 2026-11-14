// Testes do sync do Saint Seiya (scripts/sync-saint-seiya.mjs, o jogo vintage
// seiya): o id pegajoso pelo id da carta na fonte, a cor do G Crusade no id,
// a raridade, o nome do set (e o endereço que sai dele), os nomes transcritos
// dos scans e a seção de cada família na página de Sets.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETS, SERIES, CORES, ID_PREFIX, assignIds, raridade, nameEn, numeroDaFonte,
  setName, setNameEn, setIdOf, scanDe, IMG, cartasDoJogo, NUMERO_IMPRESSO, SCAN_ERRADO
} from "../scripts/sync-saint-seiya.mjs";
import { slugify } from "../functions/_lib/slug-carta.js";
import { chaveBase } from "../scripts/lib/img-mirror.mjs";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNAP = JSON.parse(ler("data/vintage/saint-seiya.json"));
const NOMES = JSON.parse(ler("scripts/data/saint-seiya-nomes.json"));
const CORES_SRC = JSON.parse(ler("scripts/data/saint-seiya-cores.json"));

test("id: família + parte + número impresso; repetido ganha sufixo e o id GRUDA no src", () => {
  const semCor = () => "";
  const pagina = [{ src: 1, num: "1", rar: "Prism", dir: "118/271" }, { src: 2, num: "1", rar: "Normal", dir: "118/271" }, { src: 3, num: "2", rar: "Normal", dir: "118/271" }];
  const primeira = assignIds("cd02", pagina, [], semCor);
  assert.deepEqual(primeira.map((c) => c.id), ["ss-cd02-1", "ss-cd02-1b", "ss-cd02-2"]);
  // a fonte reordena a página: nenhum id muda
  const depois = assignIds("cd02", [pagina[2], pagina[1], pagina[0]], primeira, semCor);
  assert.deepEqual(depois.map((c) => [c.src, c.id]), [[3, "ss-cd02-2"], [2, "ss-cd02-1b"], [1, "ss-cd02-1"]]);
  // carta que sumiu da fonte continua; carta nova não toma id já usado
  const some = assignIds("cd02", [pagina[0], { src: 9, num: "2", rar: "Normal", dir: "118/271" }], primeira, semCor);
  assert.deepEqual(some.map((c) => c.id), ["ss-cd02-1", "ss-cd02-2b", "ss-cd02-1b", "ss-cd02-2"]);
});

test("Crusade: o número repete em cada cor, e a cor entra no id e na carta", () => {
  const cor = (src) => ({ 10: "青", 11: "黒", 12: "緑", 13: "赤" })[src] || "";
  const pagina = [10, 11, 12, 13].map((src) => ({ src, num: "U-001", rar: "Rare", dir: "115/267" }));
  assert.deepEqual(assignIds("cr01", pagina, [], cor).map((c) => c.id), ["ss-cr01-b-u-001", "ss-cr01-k-u-001", "ss-cr01-g-u-001", "ss-cr01-r-u-001"]);
  // toda carta do Crusade no snapshot tem cor conhecida, e o id leva a letra dela
  for (const s of SNAP.sets.filter((x) => /^cr/.test(x.code))) {
    for (const c of s.cards) {
      const k = CORES_SRC.cores[String(c.src)];
      assert.ok(CORES[k], `${c.id}: sem cor (${k})`);
      assert.ok(c.id.startsWith(`${ID_PREFIX}${s.code}-${CORES[k].id}-`), `${c.id} não leva a cor ${k}`);
    }
  }
});

test("raridade: o francês e o plural da fonte no padrão do catálogo", () => {
  assert.equal(raridade("Hors-série"), "Special");
  assert.equal(raridade("Holographics"), "Holographic");
  assert.equal(raridade("Metal"), "Metal Rare");
  assert.equal(raridade("Cosmo"), "Cosmo Rare");
  assert.equal(raridade("Prism"), "Prism");
});

test("snapshot: ids únicos, com o prefixo do jogo e a família da parte", () => {
  const ids = new Set();
  for (const s of SNAP.sets) {
    const def = SETS.find((d) => d.code === s.code);
    assert.ok(def && (def.ac || def.ssit), `${s.code} não está no SETS`);
    for (const c of s.cards) {
      assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
      ids.add(c.id);
      assert.ok(c.id.startsWith(`${ID_PREFIX}${s.code}-`), c.id);
      // animecollection: id numérico da carta + pasta do scan; saint-seiya.it:
      // o arquivo do scan (é ele que gruda no id) e a URL de origem
      if (def.ac) assert.ok(Number.isInteger(c.src) && /^\d+\/\d+$/.test(c.dir), c.id);
      else assert.ok(/^power\/(sp)?asg\d+\.jpg$/.test(c.src) && c.img === `www.saint-seiya.it/sito4/${c.src}`, c.id);
    }
  }
  assert.ok(ids.size >= 1724, `snapshot encolheu: ${ids.size}`);
});

test("Carddass Part 1: sem número impresso, o rótulo do site (S1–S7 e 1–36) e o scan do saint-seiya.it", () => {
  const p1 = SNAP.sets.find((s) => s.code === "cd01").cards;
  assert.equal(p1.length, 43);
  assert.deepEqual(p1.slice(0, 2).map((c) => [c.id, c.num, c.rar]), [["ss-cd01-s1", "S1", "Prism"], ["ss-cd01-s2", "S2", "Prism"]]);
  assert.deepEqual(p1.slice(-1).map((c) => [c.id, c.num, c.rar]), [["ss-cd01-36", "36", "Normal"]]);
  const carta = cartasDoJogo({ sets: [{ code: "cd01", cards: [p1[0]] }] })[0];
  assert.equal(carta.image, IMG("www.saint-seiya.it/sito4/power/spasg1.jpg"));
});

test("promos: o rótulo por extenso da fonte vira a sigla", () => {
  assert.equal(numeroDaFonte("Promo"), "PR");
  assert.equal(numeroDaFonte("Promo 01"), "PR-01");
  assert.equal(numeroDaFonte("Box card 3"), "BOX-3");
  assert.equal(numeroDaFonte("PR-01 HS"), "PR-01 HS");
  assert.equal(numeroDaFonte("U-P001"), "U-P001");
});

test("set: a família abre o nome sem o 聖闘士星矢 da marca, e nenhum nome engole outro", () => {
  for (const s of SETS) assert.ok(SERIES[s.series], `${s.code}: família desconhecida`);
  const nomes = SETS.map(setName);
  assert.equal(new Set(nomes).size, nomes.length, "dois sets com o mesmo nome");
  for (const n of nomes) assert.ok(!/^(聖闘士星矢|Saint Seiya)/i.test(n), n);
  // Nome que é começo de outro + espaço vira CHIP do outro no aninhaPorNome
  // (src/app.js) quando os dois saem a até 400 dias. Só a promo da coleção
  // pode (é o chip que se quer: "Promo" no cartão da coleção); a coleção de
  // 2000, sem subtítulo, abre o nome das de 2003 de propósito, longe da janela.
  const dias = (a, b) => Math.abs(Date.parse(`${a.date}-01`.slice(0, 10)) - Date.parse(`${b.date}-01`.slice(0, 10))) / 864e5;
  for (const nome of [setName, setNameEn]) {
    for (const a of SETS) for (const b of SETS) {
      if (a === b || !nome(b).startsWith(nome(a) + " ")) continue;
      assert.ok(b.promo || dias(a, b) > 400, `${nome(a)} engoliria ${nome(b)}`);
    }
  }
  assert.equal(SETS.find((s) => s.code === "tcsap") && setNameEn(SETS.find((s) => s.code === "tcsap")), "Trading Collection Promo");
});

test("endereço do set: único sem desempate (não depende da ordem do catálogo)", () => {
  // a mesma conta do scripts/lib/paginas-de-set.mjs, sem o desempate -2
  const slugs = SETS.map((s) => {
    let base = slugify(setName(s)) || slugify(setIdOf(s.code));
    if (base.length < 4) base = `${slugify(setIdOf(s.code))}-${base}`;
    return base;
  });
  assert.equal(new Set(slugs).size, slugs.length, "dois sets disputariam o endereço (um levaria -2 pela ordem)");
});

test("nome em inglês dos sets (src/nomes-sets.js) é o setNameEn do sync, e só das partes com carta", () => {
  const fonte = ler("src/nomes-sets.js");
  const noArquivo = Object.fromEntries([...fonte.matchAll(/^\s*"(ss-[a-z0-9]+)": ("(?:[^"\\]|\\.)*"),$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
  const esperado = Object.fromEntries(SNAP.sets.map((s) => [setIdOf(s.code), setNameEn(SETS.find((d) => d.code === s.code))]));
  assert.deepEqual(noArquivo, esperado);
  // o agrupador da página de Sets tira o prefixo da família que o sync põe
  const app = ler("src/app.js");
  for (const [code, fam] of Object.entries(SERIES)) {
    assert.ok(app.includes(`["${code}", "sets.category.`), `groupSeiyaSets sem a família ${code}`);
    assert.ok(app.includes(`"${fam.en} "`), `groupSeiyaSets sem o prefixo "${fam.en} "`);
  }
});

test("imagem: o scan grande pelo wsrv, e o espelho do R2 guarda pela URL de origem", () => {
  const c = { src: 10740, dir: "118/271" };
  assert.equal(scanDe(c), "www.animecollection.fr/cartes/118/271/h3000_10740_carte.jpg");
  assert.equal(chaveBase(IMG(scanDe(c))), "wsrv.nl/www.animecollection.fr/cartes/118/271/h3000_10740_carte.jpg");
});

test("nome EN: inteiro ou composto; a armadura antes do nome; meia tradução não sai", () => {
  const g = {
    phrases: { "燃えろ！オレの小宇宙よ!!": "Burn, My Cosmo!!", "聖剣": "Excalibur" },
    atoms: { "星矢": "Seiya", "紫龍": "Shiryu", "瞬": "Shun", "ユナ": "Yuna", "魔鈴": "Marin" },
    constelacoes: { "天馬星座": "Pegasus", "ペガサス": "Pegasus", "鷲星座": "Eagle", "アクィラ": "Aquila", "ペルセウス座": "Perseus" }
  };
  assert.equal(nameEn("星矢", g), "Seiya");
  assert.equal(nameEn("星矢＆紫龍", g), "Seiya & Shiryu");
  assert.equal(nameEn("燃えろ！オレの小宇宙よ!!", g), "Burn, My Cosmo!!");
  // a grafia da lista oficial do Crusade (furigana entre parênteses, já em NFKC)
  assert.equal(nameEn("天馬星座(ペガサス)の星矢", g), "Pegasus Seiya");
  // com furigana vale a leitura: o 鷲座 do Ω é Aquila; o 鷲星座 do clássico, Eagle
  assert.equal(nameEn("鷲座(アクィラ)のユナ", g), "Aquila Yuna");
  assert.equal(nameEn("鷲星座の魔鈴", g), "Eagle Marin");
  // o rótulo da Saint Paradise: constelação, espaço, nome
  assert.equal(nameEn("天馬星座 星矢", g), "Pegasus Seiya");
  assert.equal(nameEn("聖剣(エクスカリバー)", g), "Excalibur");
  assert.equal(nameEn("黄金聖衣装着 天馬星座 星矢", g), "");
  assert.equal(nameEn("ペルセウス座のアルゴル", g), "");
  assert.equal(nameEn("星矢＆一輝", g), "");
  assert.equal(nameEn("", g), "");
});

test("número impresso: o filme IV numera à parte, a fonte troca dois blocos, e a jumbo é SPECIAL", () => {
  const iv = Object.values(NUMERO_IMPRESSO).filter((n) => n.startsWith("IV-"));
  assert.deepEqual(iv.sort(), Array.from({ length: 36 }, (_, i) => `IV-${String(i + 1).padStart(3, "0")}`));
  assert.deepEqual(SNAP.sets.find((s) => s.code === "spx").cards.map((c) => [c.id, c.num]), [["ss-spx-special", "SPECIAL"]]);
  const tcm3 = SNAP.sets.find((s) => s.code === "tcm3").cards;
  assert.equal(tcm3.find((c) => c.src === 17237).id, "ss-tcm3-iv-016");
  assert.equal(tcm3.find((c) => c.src === 17243).id, "ss-tcm3-iv-010");
  assert.ok(!tcm3.some((c) => /^1[4-8]\d$/.test(c.num)), "sobrou número 145–180 da fonte");
});

test("catálogo: toda carta com nome (transcrito ou descrição nossa), set, família e imagem", () => {
  const cartas = cartasDoJogo(SNAP);
  assert.equal(cartas.length, SNAP.sets.reduce((n, s) => n + s.cards.length, 0));
  const semNome = cartas.filter((c) => /^No\. /.test(c.name));
  assert.equal(semNome.length, 0, `sem nome transcrito: ${semNome.slice(0, 5).map((c) => c.id).join(", ")}`);
  const srcDe = new Map(SNAP.sets.flatMap((s) => s.cards.map((c) => [c.id, c.src])));
  for (const c of cartas) {
    // a carta de scan errado na fonte fica sem imagem (SCAN_ERRADO)
    assert.ok(c.set && c.setId && (c.image || SCAN_ERRADO[srcDe.get(c.id)]) && c.vintage === true, c.id);
    assert.ok(SERIES[c.vintageLine], `${c.id}: família ${c.vintageLine}`);
    if (c.nameJp) assert.ok(NOMES.nomes[c.id] === c.nameJp, c.id);
  }
  // nome transcrito só de carta que existe
  const ids = new Set(cartas.map((c) => c.id));
  for (const id of Object.keys(NOMES.nomes)) assert.ok(ids.has(id), `nome de carta que não existe: ${id}`);
});
