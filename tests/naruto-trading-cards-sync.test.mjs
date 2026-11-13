// Cartas de coleção do Naruto da Amada e da Ensky (linha nrt-tc, 2026-11-13):
// os Etching Card Collection 1–3 e a 忍術大全, pela lista do 火の国庵
// (scripts/sync-naruto-trading-cards.mjs). Sem rede: o snapshot versionado é
// o fixture. O que não pode quebrar calado: o id (sai do número, sem depender
// de quantos zeros a fonte escreve), os totais que a fonte oficial anuncia, o
// nome nos dois idiomas e o registro da linha.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUTOS, RARIDADE, numeroDaCarta, idDaCarta, nomeDaCarta, NOME_CORRIGIDO, montaLinha } from "../scripts/sync-naruto-trading-cards.mjs";

// Normaliza CRLF: a checkout Windows do repo usa core.autocrlf=true.
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const snapshot = JSON.parse(ler("data/vintage/naruto-trading-cards.json"));
const def = (key) => PRODUTOS.find((p) => p.key === key);
const temCjk = (s) => /[぀-ヿ一-鿿]/.test(String(s || ""));
function catalogoNaruto() {
  const s = ler("data/naruto/cards.js");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
}

test("id: produto + número inteiro, com o prefixo da raridade; o zero da fonte não entra", () => {
  assert.equal(idDaCarta("ecc1", { prefixo: "No", num: "1" }), "nrt-tc-ecc1-1");
  // o Card Check Box escreve "No.01" pra mesma carta
  assert.equal(idDaCarta("ecc1", { prefixo: "No", num: "01" }), "nrt-tc-ecc1-1");
  assert.equal(idDaCarta("ecc2", { prefixo: "No", num: "46" }), "nrt-tc-ecc2-46");
  assert.equal(idDaCarta("ecc2", { prefixo: "Pa", num: "01" }), "nrt-tc-ecc2-pa1");
  assert.equal(idDaCarta("ecc3", { prefixo: "V", num: "18" }), "nrt-tc-ecc3-v18");
  assert.equal(idDaCarta("ecc3", { prefixo: "SP", num: "10" }), "nrt-tc-ecc3-sp10");
  assert.equal(idDaCarta("ntz1", { prefixo: "SP", num: "01" }), "nrt-tc-ntz1-sp1");
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
  // sem tradução: fica o japonês, sem nameJp (o passo de tradução do deploy acusa)
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
  assert.equal(montaLinha(snapshot).find((c) => c.id === "nrt-tc-ecc3-sp17").name, "KAKASHI");
});

test("snapshot: 255 cartas, os totais e a composição que a TV Tokyo e a fonte anunciam", () => {
  const line = montaLinha(snapshot);
  assert.equal(line.length, 255);
  assert.equal(new Set(line.map((c) => c.id)).size, 255, "id repetido");
  const conta = (key, rar) => line.filter((c) => c.setId === `nrt-tc-${key}` && (!rar || c.rarity === rar)).length;
  assert.equal(conta("ecc1"), 45);
  assert.equal(conta("ecc1", "Normal"), 45);
  // TV Tokyo: 45 normais + 18 paralelas + 9 especiais; no 3, as 18 são "variety"
  assert.deepEqual([conta("ecc2"), conta("ecc2", "Normal"), conta("ecc2", "Parallel"), conta("ecc2", "Special")], [72, 45, 18, 9]);
  assert.deepEqual([conta("ecc3"), conta("ecc3", "Normal"), conta("ecc3", "Variety"), conta("ecc3", "Special")], [72, 45, 18, 9]);
  // TV Tokyo: 56 normais + 10 especiais
  assert.deepEqual([conta("ntz1"), conta("ntz1", "Normal"), conta("ntz1", "Special")], [66, 56, 10]);
  for (const c of line) assert.equal(c.setTotal, conta(c.setId.slice("nrt-tc-".length)), c.id);

  // As normais do Etching são contínuas nos três: 1–45, 46–90, 91–135.
  const normais = line.filter((c) => /^nrt-tc-ecc/.test(c.setId) && c.rarity === "Normal").map((c) => Number(c.number));
  assert.deepEqual(normais, Array.from({ length: 135 }, (_, i) => i + 1));
  // A fonte numera as especiais do 3 como SP.10 e SP.12–SP.19 (pula o SP.11):
  // fica como ela escreve, sem renumerar.
  assert.deepEqual(line.filter((c) => c.setId === "nrt-tc-ecc3" && c.rarity === "Special").map((c) => c.number),
    ["SP.10", "SP.12", "SP.13", "SP.14", "SP.15", "SP.16", "SP.17", "SP.18", "SP.19"]);
  // As paralelas do 2 são as No.73–90, na mesma ordem.
  const ecc2 = line.filter((c) => c.setId === "nrt-tc-ecc2");
  assert.deepEqual(ecc2.filter((c) => c.rarity === "Parallel").map((c) => c.name), ecc2.filter((c) => c.rarity === "Normal").slice(27).map((c) => c.name));
});

test("carta: linha vintage do Naruto, japonesa, sem imagem, com o nome em inglês", () => {
  const line = montaLinha(snapshot);
  assert.deepEqual(line[0], {
    id: "nrt-tc-ecc1-1", name: "Naruto Uzumaki", nameJp: "うずまきナルト", set: "エッチングカードコレクション", setId: "nrt-tc-ecc1",
    number: "1", setTotal: 45, setReleaseDate: "2004", rarity: "Normal", artist: "", language: "ja", image: "",
    variants: ["Normal"], setLogo: "/assets/games/game_naruto.webp", vintage: true, vintageLine: "nrt-tc"
  });
  for (const c of line) {
    assert.ok(c.id.startsWith("nrt-tc-"), c.id);
    assert.equal(c.vintageLine, "nrt-tc");
    assert.ok(c.name && !temCjk(c.name), `${c.id} sem nome em inglês: ${c.name}`);
  }
  // Etching 1 e 忍術大全 guardam o japonês; o 2 e o 3 não têm (a fonte dá romaji).
  assert.ok(line.filter((c) => /-(ecc1|ntz1)$/.test(c.setId)).every((c) => temCjk(c.nameJp)));
  assert.ok(line.filter((c) => /-(ecc2|ecc3)$/.test(c.setId)).every((c) => !("nameJp" in c)));
  // imagem curada do dono vence
  const curada = montaLinha(snapshot, { imagemCurada: (id) => (id === "nrt-tc-ntz1-sp9" ? "/assets/cards/naruto/nrt-tc-ntz1-sp9.webp" : "") });
  assert.equal(curada.find((c) => c.id === "nrt-tc-ntz1-sp9").image, "/assets/cards/naruto/nrt-tc-ntz1-sp9.webp");
});

test("datas: o dia quando uma fonte dá e nenhuma contradiz; só o ano quando divergem no mês", () => {
  assert.deepEqual(PRODUTOS.map((p) => [p.key, p.data]), [["ecc1", "2004"], ["ecc2", "2005-01-31"], ["ecc3", "2005-06-03"], ["ntz1", "2005-08-17"]]);
  // o que o 火の国庵 diz de cada um fica no snapshot, pra conferência
  assert.deepEqual(snapshot.sets.map((s) => s.dataNaFonte), ["2004", "2005.1.31", "2005.6", "2005.8"]);
});

test("registro: nome em inglês de cada set, nome de set único no Naruto e a linha nos lugares dela", () => {
  const nomesEn = ler("src/nomes-sets.js");
  for (const p of PRODUTOS) assert.ok(nomesEn.includes(`"nrt-tc-${p.key}":`), `nrt-tc-${p.key} sem nome em inglês no src/nomes-sets.js`);
  const cartas = catalogoNaruto();
  const setIdDoNome = new Map();
  for (const c of cartas) {
    const ja = setIdDoNome.get(c.set);
    assert.ok(!ja || ja === c.setId, `"${c.set}" é o nome de ${ja} e de ${c.setId}`);
    setIdDoNome.set(c.set, c.setId);
  }
  // o catálogo versionado tem a linha inteira, igual ao que o sync monta
  const doCatalogo = cartas.filter((c) => String(c.id).startsWith("nrt-tc-"));
  assert.deepEqual(doCatalogo.map((c) => c.id), montaLinha(snapshot).map((c) => c.id));
  // seção de cada produto na página de Sets, nos três idiomas
  const app = ler("src/app.js"), i18n = ler("src/i18n.js");
  for (const chave of ["sets.category.nrttc", "sets.category.nrttcEtching", "sets.category.nrttcTrading"]) {
    assert.equal(i18n.split(`"${chave}":`).length - 1, 3, chave);
  }
  assert.ok(app.includes('if (lineScope.line === "nrt-tc") return groupNarutoTradingSets(raizes);'));
  // o sync vintage preserva a linha, e o deploy a anexa antes da tradução
  const outras = ler("scripts/sync-naruto-vintage.mjs").match(/const OTHER_LINES = (.+);/);
  assert.ok(outras && new Function(`return ${outras[1]}`)().test("nrt-tc-ecc2-pa1"), "OTHER_LINES sem a linha nrt-tc");
  const deploy = ler(".github/workflows/deploy.yml");
  const passo = deploy.indexOf("sync-naruto-trading-cards.mjs --no-fetch");
  assert.ok(passo > 0 && passo < deploy.indexOf("node scripts/translate-naruto-names.mjs"), "o passo do deploy vem antes da tradução de nomes");
});

test("tradução de nomes do deploy: carta que já veio bilíngue do sync não vira pendência", () => {
  const src = ler("scripts/translate-naruto-names.mjs");
  assert.ok(src.includes("if (c.nameJp && !temCjk(c.name)) continue;"));
  // e de fato há cartas da linha cujo japonês inteiro não é chave do mapa
  const mapa = JSON.parse(ler("scripts/data/naruto-names-en.json"));
  const compostas = montaLinha(snapshot).filter((c) => c.nameJp && !mapa[c.nameJp]);
  assert.ok(compostas.length >= 66, "as 66 da 忍術大全 (jutsu + quem usa) e os pares do Etching 1");
});
