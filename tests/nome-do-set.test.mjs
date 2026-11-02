// Nome do set é só o nome do set (contrato 7 do docs/CATALOGO.md, 2026-11-02).
//
// Os syncs vintage punham o jogo ou a linha na frente ("Naruto CCG — The Path
// to Hokage", "Miracle Battle DB01 — …", "Carddass — First Stage"): o nome
// repetia o cabeçalho, o logo e o endereço, e o tile cortava justo a parte que
// diferencia os sets. Aqui ficam travados os catálogos cujo nome de set SAI
// DOS NOSSOS SYNCS (vintage e linhas vintage). Nos jogos modernos o nome é o
// da fonte (TCGplayer, Scryfall, TCGdex), como ela publica.
//
// E o 301 dos endereços que a mudança trocou: o de-para de
// scripts/data/sets-renomeados.json tem de apontar pra set que existe.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOGOS_URL, urlDoSet } from "../functions/_lib/jogos.js";
import { slugify } from "../functions/_lib/slug-carta.js";
import { setDoDePara } from "../functions/_lib/borda.js";
import { enderecosRenomeados } from "../scripts/lib/sets-renomeados.mjs";

function catalogo(jogo) {
  const s = readFileSync(new URL(`../data/${jogo}/cards.js`, import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
}

// Nomes do jogo e das linhas, como apareceriam na frente do set. `sets`
// limita aos setIds das linhas vintage quando o catálogo mistura moderno.
const NOMES_DO_JOGO = {
  naruto: { nomes: ["Naruto", "NARUTO", "ナルト", "Data Carddass", "データカードダス"] },
  onepiece: { nomes: ["One Piece", "ONE PIECE", "ワンピース", "Carddass", "カードダス", "OP 2002", "OP2002"], sets: /^(opcd|op2002)-/ },
  mbc: { nomes: ["Miracle Battle", "ミラクルバトル"] },
  hxh: { nomes: ["Hunter", "HUNTER", "ハンター", "Hyper Battle", "ハイパーバトル", "Carddass", "カードダス"] },
  dbc: { nomes: ["Dragon Ball", "DRAGON BALL", "ドラゴンボール", "Carddass", "カードダス"] },
  dbz: { nomes: ["Dragon Ball", "DBZ"] },
  harrypotter: { nomes: ["Harry Potter"] },
  // "LOTR Online" é o jogo DIGITAL da Decipher, outro produto: sem ele o nome
  // viraria "Online Promos".
  lotr: { nomes: ["The Lord of the Rings", "Lord of the Rings", "LOTR"], oficiais: ["LOTR Online Promos"] },
  wow: { nomes: ["World of Warcraft", "Warcraft", "WoW"] }
};

// Começa com o nome do jogo: em latim, seguido de fim ou de algo que não é
// letra/número ("Magic 2015" não é "MagicFest"); em japonês, colado mesmo
// ("カードダス本弾").
function comecaComONomeDoJogo(set, nomes) {
  return nomes.find((nome) => {
    if (!set.startsWith(nome)) return false;
    if (/[^\x00-\x7f]$/.test(nome)) return true;
    return !/^[A-Za-z0-9]/.test(set.slice(nome.length));
  }) || null;
}

test("a régua: nome do jogo na frente, sim; nome que só começa parecido, não", () => {
  assert.equal(comecaComONomeDoJogo("Naruto CCG — The Path to Hokage", ["Naruto"]), "Naruto");
  assert.equal(comecaComONomeDoJogo("カードダス本弾 第1弾", ["カードダス"]), "カードダス");
  assert.equal(comecaComONomeDoJogo("ナルティメットカードバトル 第１弾", ["ナルト"]), null);
  assert.equal(comecaComONomeDoJogo("WoWzers", ["WoW"]), null);
  assert.equal(comecaComONomeDoJogo("WoW: Promos", ["WoW"]), "WoW");
  assert.equal(comecaComONomeDoJogo("The Path to Hokage", ["Naruto"]), null);
});

test("set dos syncs vintage não leva o nome do jogo nem da linha na frente", () => {
  for (const [jogo, { nomes, sets, oficiais = [] }] of Object.entries(NOMES_DO_JOGO)) {
    const vistos = new Set();
    for (const c of catalogo(jogo)) {
      if (sets && !sets.test(String(c.setId))) continue;
      if (vistos.has(c.set)) continue;
      vistos.add(c.set);
      if (oficiais.includes(c.set)) continue;
      const nome = comecaComONomeDoJogo(String(c.set), nomes);
      assert.equal(nome, null, `${jogo} ${c.setId}: "${c.set}" começa com "${nome}" — o jogo já está no cabeçalho (contrato 7 do docs/CATALOGO.md)`);
    }
    assert.ok(vistos.size > 0, `${jogo}: catálogo sem sets`);
  }
});

test("dentro de um jogo, dois sets não dividem o nome (é a chave do set e do endereço)", () => {
  for (const jogo of Object.keys(NOMES_DO_JOGO)) {
    const idsDoNome = new Map();
    for (const c of catalogo(jogo)) {
      if (!idsDoNome.has(c.set)) idsDoNome.set(c.set, new Set());
      idsDoNome.get(c.set).add(c.setId);
    }
    for (const [nome, ids] of idsDoNome) assert.equal(ids.size, 1, `${jogo}: "${nome}" é o nome de ${[...ids].join(", ")}`);
  }
});

test("sets-renomeados.json: todo endereço antigo leva a um set que existe naquele /games", () => {
  const tabela = JSON.parse(readFileSync(new URL("../scripts/data/sets-renomeados.json", import.meta.url), "utf8"));
  const porUrl = new Map(JOGOS_URL.map((j) => [j.url, j]));
  let total = 0;
  for (const [url, dePara] of Object.entries(tabela)) {
    const jogo = porUrl.get(url);
    assert.ok(jogo, `${url}: não é endereço de jogo (functions/_lib/jogos.js)`);
    const cartas = catalogo(jogo.game).filter((c) => urlDoSet(jogo.game, c.setId) === url);
    const setIds = new Set(cartas.map((c) => c.setId));
    const slugsDeHoje = new Set(cartas.map((c) => slugify(c.set)));
    for (const [antigo, setId] of Object.entries(dePara)) {
      total++;
      assert.match(antigo, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${url}: "${antigo}" não é slug`);
      assert.ok(setIds.has(setId), `${url}/${antigo}: o set ${setId} não está em /games/${url}`);
      // Se um set de hoje tem esse nome, o endereço é dele e o de-para não vale.
      assert.ok(!slugsDeHoje.has(antigo), `${url}/${antigo}: é o slug de um set de hoje`);
    }
  }
  assert.ok(total >= 197, `de-para encolheu: ${total}`);
});

test("enderecosRenomeados: setId -> slug de hoje; set vivo com o slug antigo vence", () => {
  const pages = [
    { url: "naruto-ccg", slug: "the-path-to-hokage", cards: [{ setId: "nrt-ccg-s01" }] },
    { url: "naruto-ccg", slug: "naruto-ccg-promo", cards: [{ setId: "nrt-ccg-novo" }] },
    { url: "outro", slug: "the-path-to-hokage", cards: [{ setId: "nrt-ccg-s01" }] }
  ];
  const tabela = {
    "naruto-ccg": {
      "naruto-ccg-the-path-to-hokage": "nrt-ccg-s01",
      "naruto-ccg-promo": "nrt-ccg-promo",
      "naruto-ccg-sumiu": "nrt-ccg-s99"
    }
  };
  const { porUrl, avisos } = enderecosRenomeados(pages, tabela);
  assert.deepEqual(porUrl.get("naruto-ccg"), { "naruto-ccg-the-path-to-hokage": "the-path-to-hokage" });
  assert.equal(porUrl.has("outro"), false);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /nrt-ccg-s99/);
});

test("setDoDePara: só devolve set que está no mapa", () => {
  const mapa = { s: { "the-path-to-hokage": {} }, r: { "naruto-ccg-the-path-to-hokage": "the-path-to-hokage", "velho": "nao-existe" } };
  assert.equal(setDoDePara(mapa, "naruto-ccg-the-path-to-hokage"), "the-path-to-hokage");
  assert.equal(setDoDePara(mapa, "velho"), null);
  assert.equal(setDoDePara(mapa, "the-path-to-hokage"), null);
  assert.equal(setDoDePara({ s: {} }, "qualquer"), null);
  assert.equal(setDoDePara(null, "qualquer"), null);
  // Link compartilhado com o nome antigo: o slug dele é a chave.
  assert.equal(setDoDePara(mapa, slugify("Naruto CCG — The Path to Hokage")), "the-path-to-hokage");
});
