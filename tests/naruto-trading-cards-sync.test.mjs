// Naruto Trading Cards (jogo narutotc, 2026-11-13): as cartas de coleção da
// Amada e da Ensky — os Etching Card Collection 1–3 e a 忍術大全 —, pela lista
// do 火の国庵 (scripts/sync-naruto-trading-cards.mjs). Sem rede: o snapshot
// versionado é o fixture. O que não pode quebrar calado: o id (sai do número,
// sem depender de quantos zeros a fonte escreve), os totais que a fonte
// oficial anuncia, o nome nos dois idiomas e o registro do jogo (é jogo
// próprio, não linha do `naruto`).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUTOS, RARIDADE, numeroDaCarta, idDaCarta, nomeDaCarta, NOME_CORRIGIDO, montaCatalogo } from "../scripts/sync-naruto-trading-cards.mjs";

// Normaliza CRLF: a checkout Windows do repo usa core.autocrlf=true.
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const snapshot = JSON.parse(ler("data/vintage/naruto-trading-cards.json"));
const def = (key) => PRODUTOS.find((p) => p.key === key);
const temCjk = (s) => /[぀-ヿ一-鿿]/.test(String(s || ""));
function catalogo(jogo) {
  const s = ler(`data/${jogo}/cards.js`);
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
}

test("id: prefixo do jogo, produto e número inteiro, com o prefixo da raridade; o zero da fonte não entra", () => {
  assert.equal(idDaCarta("ecc1", { prefixo: "No", num: "1" }), "ntc-ecc1-1");
  // o Card Check Box escreve "No.01" pra mesma carta
  assert.equal(idDaCarta("ecc1", { prefixo: "No", num: "01" }), "ntc-ecc1-1");
  assert.equal(idDaCarta("ecc2", { prefixo: "No", num: "46" }), "ntc-ecc2-46");
  assert.equal(idDaCarta("ecc2", { prefixo: "Pa", num: "01" }), "ntc-ecc2-pa1");
  assert.equal(idDaCarta("ecc3", { prefixo: "V", num: "18" }), "ntc-ecc3-v18");
  assert.equal(idDaCarta("ecc3", { prefixo: "SP", num: "10" }), "ntc-ecc3-sp10");
  assert.equal(idDaCarta("ntz1", { prefixo: "SP", num: "01" }), "ntc-ntz1-sp1");
});

test("número: como a fonte escreve, a normal sem prefixo", () => {
  assert.equal(numeroDaCarta({ prefixo: "No", num: "46" }), "46");
  assert.equal(numeroDaCarta({ prefixo: "No", num: "01" }), "01");
  assert.equal(numeroDaCarta({ prefixo: "Pa", num: "01" }), "Pa.01");
  assert.equal(numeroDaCarta({ prefixo: "V", num: "07" }), "V.07");
  assert.equal(numeroDaCarta({ prefixo: "SP", num: "19" }), "SP.19");
  assert.deepEqual(RARIDADE, { No: "Normal", Pa: "Parallel", V: "Variety", SP: "Special" });
});

test("nome: japonês pelo mapa, romaji como a fonte dá, e a 忍術大全 com quem usa o jutsu", () => {
  // Etching 1: nome em japonês, inglês pelo mapa (par dividido no ＆)
  assert.deepEqual(nomeDaCarta(def("ecc1"), { prefixo: "No", num: "9", nome: "ロック・リー" }), { name: "Rock Lee", nameJp: "ロック・リー" });
  assert.deepEqual(nomeDaCarta(def("ecc1"), { prefixo: "No", num: "36", nome: "白＆桃地再不斬" }), { name: "Haku & Zabuza Momochi", nameJp: "白＆桃地再不斬" });
  // sem tradução: fica o japonês, sem nameJp
  assert.deepEqual(nomeDaCarta(def("ecc1"), { prefixo: "No", num: "99", nome: "未知の人物" }), { name: "未知の人物" });
  // Etching 2 e 3: romaji verbatim, sem separar personagens e sem japonês
  assert.deepEqual(nomeDaCarta(def("ecc2"), { prefixo: "No", num: "79", nome: "GAI ASUMA KURENAI KAKASHI" }), { name: "GAI ASUMA KURENAI KAKASHI" });
  assert.deepEqual(nomeDaCarta(def("ecc3"), { prefixo: "No", num: "135", nome: "SHODAI HOKAGE" }), { name: "SHODAI HOKAGE" });
  // 忍術大全: o mesmo jutsu em cartas de quem o usa
  assert.deepEqual(nomeDaCarta(def("ntz1"), { prefixo: "No", num: "29", nome: "写輪眼", extra: "はたけカカシ" }), { name: "Sharingan (Kakashi Hatake)", nameJp: "写輪眼 (はたけカカシ)" });
  assert.deepEqual(nomeDaCarta(def("ntz1"), { prefixo: "SP", num: "09", nome: "螺旋丸", extra: "うずまきナルト" }), { name: "Rasengan (Naruto Uzumaki)", nameJp: "螺旋丸 (うずまきナルト)" });
  // metade sem tradução: o nome inteiro fica em japonês, não meio a meio
  assert.deepEqual(nomeDaCarta(def("ntz1"), { prefixo: "No", num: "99", nome: "螺旋丸", extra: "未知の人物" }), { name: "螺旋丸 (未知の人物)" });
});

test("typo da fonte: o SP.17 do Etching 3 é KAKASHI, e é a única correção", () => {
  assert.deepEqual(NOME_CORRIGIDO, { "ecc3:SP.17": "KAKASHI" });
  const bruta = snapshot.sets.find((s) => s.key === "ecc3").cards.find((c) => c.prefixo === "SP" && c.num === "17");
  assert.equal(bruta.nome, "KAKASHU", "o snapshot guarda o que a fonte escreve");
  assert.equal(montaCatalogo(snapshot).find((c) => c.id === "ntc-ecc3-sp17").name, "KAKASHI");
});

test("snapshot: 255 cartas, os totais e a composição que a TV Tokyo e a fonte anunciam", () => {
  const cards = montaCatalogo(snapshot);
  assert.equal(cards.length, 255);
  assert.equal(new Set(cards.map((c) => c.id)).size, 255, "id repetido");
  const conta = (key, rar) => cards.filter((c) => c.setId === `ntc-${key}` && (!rar || c.rarity === rar)).length;
  assert.equal(conta("ecc1"), 45);
  assert.equal(conta("ecc1", "Normal"), 45);
  // TV Tokyo: 45 normais + 18 paralelas + 9 especiais; no 3, as 18 são "variety"
  assert.deepEqual([conta("ecc2"), conta("ecc2", "Normal"), conta("ecc2", "Parallel"), conta("ecc2", "Special")], [72, 45, 18, 9]);
  assert.deepEqual([conta("ecc3"), conta("ecc3", "Normal"), conta("ecc3", "Variety"), conta("ecc3", "Special")], [72, 45, 18, 9]);
  // TV Tokyo: 56 normais + 10 especiais
  assert.deepEqual([conta("ntz1"), conta("ntz1", "Normal"), conta("ntz1", "Special")], [66, 56, 10]);
  for (const c of cards) assert.equal(c.setTotal, conta(c.setId.slice("ntc-".length)), c.id);

  // As normais do Etching são contínuas nos três: 1–45, 46–90, 91–135.
  const normais = cards.filter((c) => /^ntc-ecc/.test(c.setId) && c.rarity === "Normal").map((c) => Number(c.number));
  assert.deepEqual(normais, Array.from({ length: 135 }, (_, i) => i + 1));
  // A fonte numera as especiais do 3 como SP.10 e SP.12–SP.19 (pula o SP.11):
  // fica como ela escreve, sem renumerar.
  assert.deepEqual(cards.filter((c) => c.setId === "ntc-ecc3" && c.rarity === "Special").map((c) => c.number),
    ["SP.10", "SP.12", "SP.13", "SP.14", "SP.15", "SP.16", "SP.17", "SP.18", "SP.19"]);
  // As paralelas do 2 são as No.73–90, na mesma ordem.
  const ecc2 = cards.filter((c) => c.setId === "ntc-ecc2");
  assert.deepEqual(ecc2.filter((c) => c.rarity === "Parallel").map((c) => c.name), ecc2.filter((c) => c.rarity === "Normal").slice(27).map((c) => c.name));
});

test("carta: vintage, japonesa, sem imagem, com o nome em inglês", () => {
  const cards = montaCatalogo(snapshot);
  assert.deepEqual(cards[0], {
    id: "ntc-ecc1-1", name: "Naruto Uzumaki", nameJp: "うずまきナルト", set: "エッチングカードコレクション", setId: "ntc-ecc1",
    number: "1", setTotal: 45, setReleaseDate: "2004", rarity: "Normal", artist: "", language: "ja", image: "",
    variants: ["Normal"], setLogo: "/assets/games/game_naruto-v2.webp", vintage: true
  });
  for (const c of cards) {
    assert.ok(c.id.startsWith("ntc-"), c.id);
    assert.equal(c.vintage, true);
    // jogo próprio: a carta não leva a marca de linha do `naruto`
    assert.ok(!("vintageLine" in c), c.id);
    assert.ok(c.name && !temCjk(c.name), `${c.id} sem nome em inglês: ${c.name}`);
  }
  // Etching 1 e 忍術大全 guardam o japonês; o 2 e o 3 não têm (a fonte dá romaji).
  assert.ok(cards.filter((c) => /-(ecc1|ntz1)$/.test(c.setId)).every((c) => temCjk(c.nameJp)));
  assert.ok(cards.filter((c) => /-(ecc2|ecc3)$/.test(c.setId)).every((c) => !("nameJp" in c)));
  // imagem curada do dono vence
  const curada = montaCatalogo(snapshot, { imagemCurada: (id) => (id === "ntc-ntz1-sp9" ? "/assets/cards/narutotc/ntc-ntz1-sp9.webp" : "") });
  assert.equal(curada.find((c) => c.id === "ntc-ntz1-sp9").image, "/assets/cards/narutotc/ntc-ntz1-sp9.webp");
});

test("datas: o dia quando uma fonte dá e nenhuma contradiz; só o ano quando divergem no mês", () => {
  assert.deepEqual(PRODUTOS.map((p) => [p.key, p.data]), [["ecc1", "2004"], ["ecc2", "2005-01-31"], ["ecc3", "2005-06-03"], ["ntz1", "2005-08-17"]]);
  // o que o 火の国庵 diz de cada um fica no snapshot, pra conferência
  assert.deepEqual(snapshot.sets.map((s) => s.dataNaFonte), ["2004", "2005.1.31", "2005.6", "2005.8"]);
});

test("catálogo versionado: o jogo inteiro em data/narutotc/, e nada dele no catálogo do Naruto", () => {
  // igual ao que o sync monta do snapshot
  assert.deepEqual(catalogo("narutotc"), montaCatalogo(snapshot));
  // nome de set único dentro do jogo (é a chave do set e do endereço)
  const setIdDoNome = new Map();
  for (const c of catalogo("narutotc")) {
    const ja = setIdDoNome.get(c.set);
    assert.ok(!ja || ja === c.setId, `"${c.set}" é o nome de ${ja} e de ${c.setId}`);
    setIdDoNome.set(c.set, c.setId);
  }
  // não é linha do naruto: o catálogo dele não tem carta nem set deste jogo
  const doNaruto = catalogo("naruto").filter((c) => /^(ntc|nrt-tc)-/.test(String(c.id)) || /エッチング|忍術大全/.test(String(c.set)));
  assert.deepEqual(doNaruto.map((c) => c.id), []);
});

test("registro: jogo vintage próprio, com a seção de cada produto, e não linha do Naruto", () => {
  const nomesEn = ler("src/nomes-sets.js");
  for (const p of PRODUTOS) assert.ok(nomesEn.includes(`"ntc-${p.key}":`), `ntc-${p.key} sem nome em inglês no src/nomes-sets.js`);
  // seção de cada produto na página de Sets, nos três idiomas, pelo mapa do jogo
  const app = ler("src/app.js"), i18n = ler("src/i18n.js"), shared = ler("src/shared.js");
  for (const chave of ["sets.category.ntcEtching", "sets.category.ntcTrading", "filter.gameNarutotc"]) {
    assert.equal(i18n.split(`"${chave}":`).length - 1, 3, chave);
  }
  assert.ok(app.includes("narutotc: groupNarutoTradingSets,"));
  // a linha nrt-tc da primeira versão da PR saiu de todo lugar
  for (const [arq, src] of [["src/app.js", app], ["src/i18n.js", i18n], ["src/shared.js", shared], ["scripts/sync-naruto-vintage.mjs", ler("scripts/sync-naruto-vintage.mjs")]]) {
    assert.ok(!/nrt-tc|sets\.category\.nrttc"/.test(src), `${arq} ainda fala da linha nrt-tc`);
  }
  // o prefixo de id é do jogo, no filtro Vintage e no binder
  assert.match(shared, /narutotc: \["ntc-"\]/);
  assert.ok(ler("src/binders.js").includes('["ntc-", "narutotc"]'));
  // o deploy monta o catálogo nos dois modos e guarda o cache do jogo
  const deploy = ler(".github/workflows/deploy.yml");
  assert.ok(deploy.includes("node scripts/sync-naruto-trading-cards.mjs --no-fetch"));
  assert.equal((deploy.match(/^\s+data\/narutotc\/sets$/gm) || []).length, 2, "listas de cache do deploy (restore e save)");
  assert.ok(deploy.includes("data/narutotc/manifest.generated.js"), "guarda do modo do build");
  // o espelho de imagens pega o jogo pelo pacote genérico do deploy (data/*/sets),
  // sem lista própria — ver tests/img-mirror.test.mjs
});
