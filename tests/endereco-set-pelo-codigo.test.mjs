// Endereço de set pelo código quando o nome é japonês e só sobra ruído
// (D7 da revisão de novembro, pacote 4G, 2026-11-28).
//
// O slug do set sai do nome. Nome só em japonês já usava o setId desde
// 2026-11-02; nome com kana ou kanji E algumas letras latinas escapava e virava
// o que sobrava: "本弾 第30弾「出現！究極の敵DB！？」" -> "30-db". A regra
// (scripts/lib/paginas-de-set.mjs, baseDoEnderecoDoSet) manda o setId quando a
// sobra tem 4 ou mais caracteres e nenhuma palavra (3 letras seguidas) nem
// código. Este teste trava:
//   - o que muda e, tão importante quanto, o que NÃO muda;
//   - o slug do /set/ antigo, que segue a régua de antes;
//   - o de-para dos 52 endereços antigos (scripts/data/sets-renomeados.json);
//   - o 301 do set, da variante -en e das cartas abaixo dele, pela borda.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseDoEnderecoDoSet, agrupaPorSet, paginasDoJogo } from "../scripts/lib/paginas-de-set.mjs";
import { enderecosRenomeados } from "../scripts/lib/sets-renomeados.mjs";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { onRequestGet } from "../functions/games/[[path]].js";

const lerJson = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("sobra sem palavra e sem código: o endereço é o setId", () => {
  const muda = [
    ["本弾 第30弾「出現！究極の敵DB！？」", "dbc-h30", "30-db"],
    ["本弾 第29弾「超サイヤ人4発動！！」", "dbc-h29", "29-4"],
    ["本弾 第16弾「決起！！新Z戦士たち」", "dbc-h16", "16-z"],
    ["本弾 第12弾「逆襲！！3大超サイヤ人」", "dbc-h12", "12-3"],
    ["本弾 第9弾「壮絶！！最強VS最強」", "dbc-h09", "9-vs"],
    ["本弾 第6弾「白熱！！悟空VSギニュー」", "dbc-h06", "6-vs"],
    ["外伝 第10弾「聖機兵VS機兵軍団」", "GCD-GD10", "10-vs"],
    ["ジャンプフェスタ2000 限定カード", "hxh-hb-jf00", "2000"],
    ["ジャンプフェスタ2002エディション パック", "hxh-hb-jf02", "2002"],
    ["パート6 9月4日×G・I×発修行", "hxh-hb-p6", "6-9-4-g-i"],
    ["エントリーデッキ 2010 サムライ・アンビシャス", "DMC-59", "2010"],
    ["20th クロニクルデッキ 決闘!! ボルシャック・デュエル", "DMBD-16", "20th"],
    ["双極篇 拡張パック第３弾 †ギラギラ†煌世主と終葬のQX!!", "DMRP-07", "3-qx"],
    ["起始組合ex 呆火鱷&電龍 ex", "SVAL", "ex-ex"]
  ];
  for (const [nome, setId, antigo] of muda) {
    const r = baseDoEnderecoDoSet(nome, setId);
    assert.equal(r.legado, antigo, `${nome}: a régua de antes`);
    assert.equal(r.base, setId.toLowerCase(), `${nome}: o setId puro`);
  }
});

test("o que NÃO muda: sobra com palavra, com código, curta, sem japonês", () => {
  const fica = [
    // Sobra com palavra.
    ["劇場版 NARUTO-ナルト- 大激突!幻の地底遺跡だってばよ", "cdm-naruto-m2", "naruto"],
    ["ドラマチックブースター「ガンダムSEED DESTINY編」", "gw-db4", "seed-destiny"],
    ["VSTARユニバース", "s12a", "vstar"],
    ["拡張シート Ver.1", "gw-ext1", "ver-1"],
    ["セイントパラダイス ACT.1", "ss-sp01", "act-1"],
    ["HUNTER×HUNTER パート2", "cdm-hxh-p2", "hunter-hunter-2"],
    // Sobra com código: já tem o que o setId diria.
    ["AS01 — Jヒーローブースター 1弾", "mb-as01", "as01-j-1"],
    ["DB10 — ブースターパック 極限闘争", "mb-db10", "db10"],
    ["OP13 — ブースターパック Zの脅威", "op-mb-op13", "op13-z"],
    // Sobra curta: o setId já vai na frente ("dbc-h10-10"), nada a trocar.
    ["本弾 第10弾「戦慄！！人造人間起動」", "dbc-h10", "dbc-h10-10"],
    // Só japonês: já era o setId.
    ["本弾 特別弾", "dbc-h31", "dbc-h31"],
    // Sem japonês, mesmo com sobra curta ou sem palavra.
    ["Base Set", "base1", "base-set"],
    ["2000 Collection", "x2000", "2000-collection"],
    ["Set 3-VS", "ab12", "set-3-vs"]
  ];
  for (const [nome, setId, esperado] of fica) {
    const r = baseDoEnderecoDoSet(nome, setId);
    assert.equal(r.base, esperado, nome);
    assert.equal(r.legado, esperado, `${nome}: a régua de antes é a mesma`);
  }
});

test("WCS23: com o nome japonês inteiro da TCGdex (pacote 4I) o endereço \"2023\" vira wcs23", () => {
  const nome = "ポケモンワールドチャンピオンシップス2023横浜 記念デッキ「ピカチュウ」";
  assert.deepEqual(baseDoEnderecoDoSet(nome, "WCS23"), { base: "wcs23", legado: "2023" });
});

const c = (id, set, setId, number) => ({ id, name: `Carta ${id}`, set, setId, number: String(number), language: "ja" });
const DBC30 = "本弾 第30弾「出現！究極の敵DB！？」";
const DBC10 = "本弾 第10弾「戦慄！！人造人間起動」";
const DBC = [
  c("dbc-h30-1", DBC30, "dbc-h30", 1), c("dbc-h30-2", DBC30, "dbc-h30", 2),
  c("dbc-h10-1", DBC10, "dbc-h10", 1), c("dbc-h31-1", "本弾 特別弾", "dbc-h31", 1)
];

test("paginasDoJogo: o slug novo é o setId; o do /set/ antigo segue a régua de antes", () => {
  const pedidos = [];
  const paginas = paginasDoJogo("dbc", agrupaPorSet(DBC), { slugAntigo: (base) => { pedidos.push(base); return base; } });
  assert.deepEqual(paginas.map((p) => p.slug), ["dbc-h30", "dbc-h10-10", "dbc-h31"]);
  // O legado recebe "30-db", e não "dbc-h30": as chaves de legado-sets.json e a
  // ordem dos -2 antigos não mudam.
  assert.deepEqual(pedidos, ["30-db", "dbc-h10-10", "dbc-h31"]);
  assert.deepEqual(paginas.map((p) => p.slugAntigo), ["30-db", "dbc-h10-10", "dbc-h31"]);
});

// Os 52 endereços que a regra troca no catálogo de 2026-11-28 (lista gerada
// rodando o prerender sem rede antes e depois): url do jogo -> slug antigo -> setId.
const ANTIGOS = {
  "dragon-ball-carddass": { "12-3": "dbc-h12", "16-z": "dbc-h16", "29-4": "dbc-h29", "30-db": "dbc-h30", "6-vs": "dbc-h06", "9-vs": "dbc-h09" },
  "gundam-carddass": { "10-vs": "gcd-gd10" },
  "hunter-x-hunter-carddass": { "2000": "hxh-hb-jf00", "2001": "hxh-hb-jf01", "2002": "hxh-hb-jf02", "6-9-4-g-i": "hxh-hb-p6" },
  "pokemon": { "2023": "WCS23", "ex-ex": "SVAL", "ex-ex-2": "SVAM", "ex-q-ex": "SVAW" },
  "duel-masters": {
    "2010": "DMC-59", "2010-2": "DMC-60", "2016": "DMD-32", "2016-2": "DMD-33", "2018": "DMBD-05", "2018-2": "DMBD-06", "2019": "DMBD-09",
    "100-gr-100": "DMEX-05", "20th": "DMBD-16", "20th-2": "DMBD-17", "20-20": "DMEX-16", "sp-jr": "GUM2", "3-vs-3": "DMR-09",
    "4-dx-gr": "DMBD-11", "4-dx": "DMBD-12", "e1-e2-e3": "DMX-25", "3-qx": "DMRP-07", "no-1": "DMEX-04", "2-b-a-d": "DMRP-02",
    "3-j-o-e-2": "DMRP-03", "3-vs": "DM-26", "3-vs-4": "DMRP-19", "w-1-vs": "DM25-RP1", "w-2-vs-ii": "DM25-RP2", "w-3-vs": "DM25-RP3",
    "4-vs": "DM-35", "3-vs-2": "DM-38", "7-dg": "DMBD-04", "7-j-o-e": "DMBD-03", "1-gr": "DMRP-09", "2-c-a-p": "DMRP-10",
    "3-1059": "DMRP-11", "4-vs-2": "DMRP-12", "80-j-vs": "DMBD-07", "80-vs": "DMBD-08", "1-vs": "DM26-RP1", "vs-x": "DMR-23"
  }
};

test("o de-para tem os 52 endereços antigos, cada um pro setId do set de hoje", () => {
  const tabela = lerJson("scripts/data/sets-renomeados.json").games;
  let total = 0;
  for (const [url, pares] of Object.entries(ANTIGOS)) {
    for (const [antigo, setId] of Object.entries(pares)) {
      total++;
      assert.equal(tabela[url] && tabela[url][antigo], setId, `${url}/${antigo}`);
    }
  }
  assert.equal(total, 52);
  // Os de antes seguem lá (a tabela só cresceu).
  assert.equal(tabela["hunter-x-hunter-carddass"]["hyper-battle-2000"], "hxh-hb-jf00");
  // O Miracle Battle não entrou: o código já está no endereço.
  assert.equal(Object.keys(tabela["miracle-battle-carddass"]).includes("db10"), false);
});

// A borda ponta a ponta: o mapa do jogo sai do prerender (paginasDoJogo +
// enderecosRenomeados, com a tabela de verdade) e a Function responde 301.
function bordaComMapa(url, game, cartas) {
  const paginas = paginasDoJogo(game, agrupaPorSet(cartas));
  const tabela = lerJson("scripts/data/sets-renomeados.json");
  const { porUrl, avisos } = enderecosRenomeados(paginas.map((p) => ({ ...p, url })), tabela, {}, null);
  // A tabela é a de verdade e o catálogo do ensaio é pequeno: os outros sets da
  // tabela avisam que não existem aqui. Os que o ensaio usa não podem avisar.
  assert.deepEqual(avisos.filter((a) => a.startsWith(`${url}/30-db:`)), []);
  const mapa = { g: game, n: url, s: {}, r: porUrl.get(url) };
  for (const p of paginas) mapa.s[p.slug] = { n: p.name, f: [], c: p.cards.length, d: "" };
  const pedidos = [];
  const env = {
    ASSETS: {
      fetch: async (req) => {
        const u = new URL(req instanceof Request ? req.url : String(req));
        pedidos.push(u.pathname);
        if (u.pathname === `/data/game-pages/${url}.json`) return Response.json(mapa);
        return new Response("", { status: 404 });
      }
    }
  };
  const pede = (caminho) => {
    const request = new Request(`https://sleevu.app${caminho}`);
    const path = new URL(request.url).pathname.split("/").slice(2);
    return onRequestGet({ request, env, params: { path }, waitUntil() {}, next: async () => new Response("next") });
  };
  return { mapa, pedidos, pede };
}

test("301 do endereço antigo: o set, a variante -en e as cartas abaixo dele", async () => {
  const { mapa, pedidos, pede } = bordaComMapa("dragon-ball-carddass", "dbc", DBC);
  assert.deepEqual(Object.keys(mapa.s), ["dbc-h30", "dbc-h10-10", "dbc-h31"]);
  assert.equal(mapa.r["30-db"], "dbc-h30");
  const vai = async (de, para) => {
    const r = await pede(de);
    assert.equal(r.status, 301, de);
    assert.equal(r.headers.get("location"), `https://sleevu.app${para}`, de);
  };
  await vai("/games/dragon-ball-carddass/30-db", "/games/dragon-ball-carddass/dbc-h30");
  await vai("/games/dragon-ball-carddass/30-db-en", "/games/dragon-ball-carddass/dbc-h30-en");
  // O endereço da carta não depende do set: só o trecho do set troca.
  const carta = slugsDasCartas(DBC.filter((x) => x.setId === "dbc-h30")).get("dbc-h30-1");
  assert.ok(carta);
  await vai(`/games/dragon-ball-carddass/30-db/${carta}`, `/games/dragon-ball-carddass/dbc-h30/${carta}`);
  await vai("/games/dragon-ball-carddass/30-db?utm_source=x", "/games/dragon-ball-carddass/dbc-h30?utm_source=x");
  assert.deepEqual([...new Set(pedidos)], ["/data/game-pages/dragon-ball-carddass.json"], "o 301 lê só o mapa do jogo");
});

// O de-para vai pro setId. Com o set inteiro sob o nome japonês (o que o 4I faz
// com o WCS23), "2023" acha o wcs23. Enquanto o mesmo setId tiver dois nomes,
// o de-para cai na primeira página dele (o nome em inglês): o 4I resolve isso.
test("pokémon: \"2023\" leva pro wcs23 quando o set inteiro tem o nome japonês", async () => {
  const JA = "ポケモンワールドチャンピオンシップス2023横浜 記念デッキ「ピカチュウ」";
  const cartas = [1, 2, 3].map((n) => ({ id: `WCS23-00${n}-ja`, name: `Pikachu ${n}`, number: `00${n}`, set: JA, setId: "WCS23", language: "ja" }));
  const { mapa, pede } = bordaComMapa("pokemon", "pokemon", cartas);
  assert.deepEqual(Object.keys(mapa.s), ["wcs23"]);
  const r = await pede("/games/pokemon/2023");
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://sleevu.app/games/pokemon/wcs23");
});

test("um endereço que nunca existiu segue 404; o de hoje não é redirecionado", async () => {
  const { pede } = bordaComMapa("dragon-ball-carddass", "dbc", DBC);
  assert.notEqual((await pede("/games/dragon-ball-carddass/99-zz")).status, 301);
  assert.notEqual((await pede("/games/dragon-ball-carddass/99-zz")).status, 200);
  // O de hoje abre a tela do set (a casca falta no ensaio, então não é 301).
  assert.notEqual((await pede("/games/dragon-ball-carddass/dbc-h30")).status, 301);
});

test("o /set/ legado de antes de 2026-09-30 também chega no endereço novo", () => {
  const paginas = paginasDoJogo("dbc", agrupaPorSet(DBC), { slugAntigo: (base) => base });
  const legado = {};
  for (const p of paginas) legado[p.slugAntigo] = `${p.url}/${p.slug}`;
  assert.equal(legado["30-db"], "dragon-ball-carddass/dbc-h30");
});
