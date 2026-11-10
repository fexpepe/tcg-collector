// Nome do set é só o nome do set (contrato 7 do docs/CATALOGO.md, 2026-11-02).
//
// Os syncs vintage punham o jogo ou a linha na frente ("Naruto CCG — The Path
// to Hokage", "Miracle Battle DB01 — …", "Carddass — First Stage"), e o
// TCGplayer faz o mesmo nos grupos genéricos dos modernos ("One Piece
// Promotion Cards"): o nome repetia o cabeçalho, o logo e o endereço, e o tile
// cortava justo a parte que diferencia os sets. Aqui ficam travados os
// catálogos vintage (o nome sai dos nossos syncs) e os da família TCGCSV (o
// nome do grupo passa por scripts/lib/nome-do-set.mjs). Pokémon, Magic e
// Lorcana usam o nome oficial da fonte, que já não traz o jogo na frente.
//
// E o 301 dos endereços que a mudança trocou: o de-para de
// scripts/data/sets-renomeados.json tem de apontar pra set que existe.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JOGOS_URL, urlDoSet } from "../functions/_lib/jogos.js";
import { slugify } from "../functions/_lib/slug-carta.js";
import { setDoDePara } from "../functions/_lib/borda.js";
import { enderecosRenomeados } from "../scripts/lib/sets-renomeados.mjs";
import { nomeDoSet, NOMES_DO_JOGO as NOMES_TCGCSV } from "../scripts/lib/nome-do-set.mjs";

function catalogo(jogo) {
  // Yu-Gi-Oh!: padrão Magic, só os chunks são versionados.
  if (jogo === "ygo") {
    const dir = new URL("../data/ygo/sets/", import.meta.url);
    return readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  }
  const s = readFileSync(new URL(`../data/${jogo}/cards.js`, import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
}
const tabela = JSON.parse(readFileSync(new URL("../scripts/data/sets-renomeados.json", import.meta.url), "utf8"));

// Vintage: nomes do jogo e das linhas, como apareceriam na frente do set.
// `sets` limita aos setIds das linhas vintage quando o catálogo mistura
// moderno.
const NOMES_DO_JOGO = {
  // Gundam Carddass (linha gcd): a marca da linha no Japão é "SDガンダム
  // カードダス"; a série abre o nome sem ela ("本弾 第1弾", "外伝 第1弾「…」").
  // "機動武闘伝Gガンダム" é o título do anime, e não começa com a marca.
  gundam: { nomes: ["Gundam", "GUNDAM", "SD Gundam", "SDガンダム", "ガンダム", "Carddass", "カードダス"], sets: /^gcd-/ },
  naruto: { nomes: ["Naruto", "NARUTO", "ナルト", "Data Carddass", "データカードダス"] },
  onepiece: { nomes: ["One Piece", "ONE PIECE", "ワンピース", "Carddass", "カードダス", "OP 2002", "OP2002"], sets: /^(opcd|op2002)-/ },
  mbc: { nomes: ["Miracle Battle", "ミラクルバトル"] },
  // Carddass Masters: a IP abre o nome do set ("HUNTER×HUNTER パート1 …"), o
  // jogo não.
  cdm: { nomes: ["Carddass", "CARDDASS", "カードダス", "Masters", "MASTERS", "マスターズ"] },
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

test("nomeDoSet: tira a marca dos grupos genéricos do TCGplayer, não do título de outra obra", () => {
  assert.equal(nomeDoSet("onepiece", "One Piece Promotion Cards"), "Promotion Cards");
  assert.equal(nomeDoSet("fab", "Flesh and Blood: Promo Cards"), "Promo Cards");
  assert.equal(nomeDoSet("dbfw", "Fusion World Energy Markers"), "Energy Markers");
  assert.equal(nomeDoSet("riftbound", "Riftbound Judge Promotional Cards"), "Judge Promotional Cards");
  assert.equal(nomeDoSet("ygo", "Yu-Gi-Oh! Tokens"), "Tokens");
  // Série, mangá, videogame, filme e evento com a marca no título ficam.
  assert.equal(nomeDoSet("ygo", "Yu-Gi-Oh! GX Tag Force Promotional Cards"), "Yu-Gi-Oh! GX Tag Force Promotional Cards");
  assert.equal(nomeDoSet("ygo", "Yu-Gi-Oh! R Manga Promo"), "Yu-Gi-Oh! R Manga Promo");
  assert.equal(nomeDoSet("ygo", "Yu-Gi-Oh! Day Promos"), "Yu-Gi-Oh! Day Promos");
  assert.equal(nomeDoSet("digimon", "Digimon LIBERATOR"), "Digimon LIBERATOR");
  // Só a marca inteira, e o resto do nome não é tocado.
  assert.equal(nomeDoSet("gundam", "Gundamverse"), "Gundamverse");
  assert.equal(nomeDoSet("onepiece", "Extra Booster: One Piece Heroines Edition"), "Extra Booster: One Piece Heroines Edition");
  assert.equal(nomeDoSet("onepiece", "One Piece"), "One Piece");
  assert.equal(nomeDoSet("magic", "Magic 2015"), "Magic 2015");
});

test("catálogo da família TCGCSV já está com o nome que o sync grava hoje", () => {
  for (const jogo of Object.keys(NOMES_TCGCSV)) {
    const vistos = new Set();
    for (const c of catalogo(jogo)) {
      if (vistos.has(c.set)) continue;
      vistos.add(c.set);
      assert.equal(c.set, nomeDoSet(jogo, c.set), `${jogo} ${c.setId}: "${c.set}" — rode o sync (scripts/lib/nome-do-set.mjs)`);
    }
    assert.ok(vistos.size > 0, `${jogo}: catálogo sem sets`);
  }
});

test("dentro de um jogo, dois sets não dividem o nome (é a chave do set e do endereço)", () => {
  for (const jogo of new Set([...Object.keys(NOMES_DO_JOGO), ...Object.keys(NOMES_TCGCSV)])) {
    if (jogo === "ygo") continue; // edições regionais do mesmo set dividem o nome de propósito
    const idsDoNome = new Map();
    for (const c of catalogo(jogo)) {
      if (!idsDoNome.has(c.set)) idsDoNome.set(c.set, new Set());
      idsDoNome.get(c.set).add(c.setId);
    }
    const renomeados = new Set(Object.values(tabela.games).flatMap((m) => Object.values(m)));
    for (const [nome, ids] of idsDoNome) {
      // A trava vale pros sets que este trabalho renomeou; homônimo que a fonte
      // já tinha (pré-release e set no mesmo nome, edições) é outra conversa.
      if (![...ids].some((id) => renomeados.has(id))) continue;
      assert.equal(ids.size, 1, `${jogo}: "${nome}" é o nome de ${[...ids].join(", ")}`);
    }
  }
});

test("sets-renomeados.json: todo endereço antigo leva a um set que existe naquele /games", () => {
  const porUrl = new Map(JOGOS_URL.map((j) => [j.url, j]));
  const doUrl = (url) => {
    const jogo = porUrl.get(url);
    assert.ok(jogo, `${url}: não é endereço de jogo (functions/_lib/jogos.js)`);
    return catalogo(jogo.game).filter((c) => urlDoSet(jogo.game, c.setId) === url);
  };
  let total = 0;
  for (const [url, dePara] of Object.entries(tabela.games)) {
    const cartas = doUrl(url);
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
  assert.ok(total >= 213, `de-para encolheu: ${total}`);
  for (const [antigo, destino] of Object.entries(tabela.set)) {
    const [url, setId] = destino.split("/");
    assert.ok(doUrl(url).some((c) => c.setId === setId), `/set/${antigo}: o set ${setId} não está em /games/${url}`);
  }
});

test("enderecosRenomeados: setId -> slug de hoje; set vivo com o slug antigo vence; chave do /set/ fixada", () => {
  const pages = [
    { url: "naruto-ccg", slug: "the-path-to-hokage", cards: [{ setId: "nrt-ccg-s01" }] },
    { url: "naruto-ccg", slug: "naruto-ccg-promo", cards: [{ setId: "nrt-ccg-novo" }] },
    { url: "naruto-card-game", slug: "promotion-cards", cards: [{ setId: "nrt-ncg-promo" }] },
    { url: "outro", slug: "the-path-to-hokage", cards: [{ setId: "nrt-ccg-s01" }] }
  ];
  const { porUrl, legado, avisos } = enderecosRenomeados(pages, {
    games: {
      "naruto-ccg": {
        "naruto-ccg-the-path-to-hokage": "nrt-ccg-s01",
        "naruto-ccg-promo": "nrt-ccg-promo",
        "naruto-ccg-sumiu": "nrt-ccg-s99"
      }
    },
    set: { "promotion-cards": "naruto-card-game/nrt-ncg-promo", "sumiu": "naruto-ccg/nrt-ccg-s99" }
  });
  assert.deepEqual(porUrl.get("naruto-ccg"), { "naruto-ccg-the-path-to-hokage": "the-path-to-hokage" });
  assert.equal(porUrl.has("outro"), false);
  assert.deepEqual(legado, { "promotion-cards": "naruto-card-game/promotion-cards" });
  assert.equal(avisos.length, 2);
  assert.match(avisos.join(" "), /nrt-ccg-s99/);
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
