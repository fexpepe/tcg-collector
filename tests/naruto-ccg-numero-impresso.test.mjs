// Número impresso do Naruto CCG americano (scripts/naruto-ccg-numero-impresso.mjs
// → data/vintage/naruto-ccg-numero-impresso.json → sync-naruto-ccg.mjs), sem
// rede. O narutocards renumera em sequência do set 17 em diante (e nas missões
// do 16, nos TPs e nas tins); o de-para corrige o `number` e o scan. O que este
// teste trava: que NENHUM id muda (o id é o código do narutocards, já
// publicado), que as cartas conferidas no scan ganham o número certo, e a
// regra que casa homônimos pelo deslocamento da numeração.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { numeroImpresso, chaveNome, casaSet, FIXO } from "../scripts/naruto-ccg-numero-impresso.mjs";
import { montaLinha } from "../scripts/sync-naruto-ccg.mjs";
import { slugsDasCartas, cartaParecida } from "../functions/_lib/slug-carta.js";

const json = (arq) => JSON.parse(readFileSync(new URL(`../${arq}`, import.meta.url), "utf8"));
const snap = json("data/vintage/naruto-ccg.json");
const comp = json("data/vintage/naruto-ccg-complemento.json");
const dp = json("data/vintage/naruto-ccg-numero-impresso.json");
const promos = json("data/vintage/naruto-ccg-promos.json");
const catalogo = (() => {
  const g = { window: {} };
  new Function("window", readFileSync(new URL("../data/naruto/cards.js", import.meta.url), "utf8"))(g.window);
  return g.window.TCG_CARDS.filter((c) => /^nrt-ccg-/.test(c.id));
})();

test("número impresso: sem o sufixo de reimpressão do N-CCG-DB e com o US na grafia do catálogo", () => {
  assert.equal(numeroImpresso("N-883"), "N-883");
  assert.equal(numeroImpresso("N-019B"), "N-019"); // a carta diz "019 TP1"
  assert.equal(numeroImpresso("J-696A"), "J-696");
  assert.equal(numeroImpresso("NUS-006B"), "N-US006"); // "US006 TP1"
  assert.equal(numeroImpresso("JUS-065"), "J-US065");
  assert.equal(numeroImpresso("PRUS-010B"), "PR-US010");
  assert.equal(numeroImpresso("N-US004"), "N-US004");
  assert.equal(numeroImpresso("PR-063"), "PR-063");
});

test("nome comparável: ordinal por extenso, sem acento e em qualquer ordem", () => {
  assert.equal(chaveNome("Kakashi Hatake & The 4th Hokage"), chaveNome("Kakashi Hatake & The Fourth Hokage"));
  assert.equal(chaveNome("Ūhei"), chaveNome("Uhei"));
  assert.equal(chaveNome("Tortoise Ninja"), chaveNome("Ninja Tortoise"));
  assert.notEqual(chaveNome("Hinata Hyuga"), chaveNome("Hanabi Hyuga"));
});

test("homônimos casam pelo deslocamento dos vizinhos, não pela ordem nem pelo código", () => {
  // Bloco das Super Rare que a fonte pôs no começo (impresso = dela + 50) e o
  // resto do set (impresso = dela − 2), com um Sasuke em cada bloco. A fonte
  // chama de N-11 o Sasuke impresso N-61, e o impresso N-11 é o outro.
  const nc = [
    { code: "N-10", name: "Pain (Deva Path)" }, { code: "N-11", name: "Sasuke Uchiha" },
    { code: "N-12", name: "Konan" }, { code: "N-13", name: "Sasuke Uchiha" }, { code: "N-14", name: "Tobi" }
  ];
  const fan = [
    { code: "N-10", name: "Konan", img: "n10" }, { code: "N-11", name: "Sasuke Uchiha", img: "n11" },
    { code: "N-12", name: "Tobi", img: "n12" }, { code: "N-60", name: "Pain (Deva Path)", img: "n60" },
    { code: "N-61", name: "Sasuke Uchiha", img: "n61" }
  ];
  const { par, semPar } = casaSet(nc, fan);
  assert.deepEqual(semPar, []);
  assert.equal(par.get("N-11").code, "N-61");
  assert.equal(par.get("N-13").code, "N-11");
  assert.equal(par.get("N-12").code, "N-10");
});

test("código igual só vale nos sets com número impresso, e com nome parecido", () => {
  const nc = [{ code: "M-585", name: "Reconnoitering Party" }, { code: "N-709", name: "Naruto Uzumaki" }];
  const fan = [
    { code: "M-585", name: "Succeeded Will of Fire", img: "m585" }, { code: "M-620", name: "Reconnoitering Party", img: "m620" },
    { code: "N-709", name: "Naruto Uzumaki", img: "n709" }
  ];
  const { par } = casaSet(nc, fan, { codigoImpresso: true });
  assert.equal(par.get("M-585").code, "M-620");
  assert.equal(par.get("N-709").code, "N-709");
});

test("de-para: as cartas conferidas no scan ganham o número impresso", () => {
  const num = (set, code) => (dp.sets[set][code] || {}).numero;
  assert.equal(num("s18", "N-880"), "N-883"); // Neji Hyuga
  assert.equal(num("tp1", "N-1701"), "N-880"); // Yamato
  assert.equal(num("s16", "M-585"), "M-620"); // Reconnoitering Party
  assert.equal(num("s16", "M-550"), "M-585"); // Succeeded Will of Fire
  assert.equal(num("s28", "J-1000"), "J-1023"); // Phosphorus Blast
  assert.equal(num("tin2", "N-1850"), "PR-063"); // Kakashi Hatake & Itachi Uchiha
  assert.equal(num("tin1", "N-1831"), "N-145"); // reimpressão: a carta diz "145"
  assert.equal(num("s17", "N-784"), "N-005"); // reimpressão do theme deck
  assert.equal(num("s17", "N-797"), "N-784"); // Hidan (Curse Mode)
  assert.equal(num("s18", "N-886"), "N-889"); // o Neji Rare: o narutocards mostra o scan do Common
  assert.equal(num("s19", "N-951"), "N-1005"); // Sasuke do bloco das Super Rare
  assert.equal(num("s19", "N-967"), "N-963");
  assert.equal(num("s09", "M-275"), "M-274"); // Frustrated Ambition (o scan dele diz "274")
  assert.equal(num("s14", "J-526"), "J-525"); // Chakra Cannon (o scan diz "525")
  // Número que já era o impresso não entra.
  assert.equal(num("s16", "N-709"), undefined);
  assert.equal(num("promo", "PR-010"), undefined);
});

test("de-para: só chave que existe no set do snapshot, sem dois números iguais no set", () => {
  for (const [key, cartas] of Object.entries(dp.sets)) {
    const set = snap.sets.find((s) => s.key === key);
    assert.ok(set, key);
    const codigos = new Set(set.cards.map((c) => c.code));
    const numeros = new Map();
    for (const c of set.cards) numeros.set(c.code, c.code);
    for (const [code, x] of Object.entries(cartas)) {
      assert.ok(codigos.has(code), `${key} ${code}: não está no snapshot (o narutocards mudou o código?)`);
      assert.ok(x.numero || x.img, `${key} ${code}: entrada vazia`);
      if (x.numero) numeros.set(code, x.numero);
    }
    const vistos = new Map();
    for (const [code, n] of numeros) {
      assert.ok(!vistos.has(n), `${key}: ${vistos.get(n)} e ${code} com o número ${n}`);
      vistos.set(n, code);
    }
  }
  for (const [key, fixos] of Object.entries(FIXO)) for (const code of Object.keys(fixos)) assert.ok(dp.sets[key][code], `FIXO ${key} ${code} fora do de-para`);
});

test("de-para: nos sets 1–15 o narutocards já usa o impresso, fora os dois números trocados", () => {
  for (let i = 1; i <= 15; i++) {
    const key = `s${String(i).padStart(2, "0")}`;
    const comNumero = Object.entries(dp.sets[key] || {}).filter(([, x]) => x.numero).map(([c]) => c);
    assert.deepEqual(comNumero, { s09: ["M-275"], s14: ["J-526"] }[key] || [], key);
  }
  // Do 17 em diante (e TPs e tins), toda carta tem par.
  for (const s of snap.sets) {
    if (!/^(s(1[7-9]|2[0-8])|tp\d|tin\d)$/.test(s.key)) continue;
    const semPar = s.cards.filter((c) => !dp.sets[s.key][c.code]).map((c) => c.code);
    assert.deepEqual(semPar, [], s.key);
  }
});

test("sync: NENHUM id muda com o de-para, e o id não vem do número", () => {
  const sem = montaLinha(snap, comp, null).line;
  const com = montaLinha(snap, comp, dp).line;
  const porId = new Map(com.map((c) => [c.id, c]));
  const semPorId = new Map(sem.map((c) => [c.id, c]));
  // Todo id de antes continua, no mesmo set (fora o N-099, que o de-para muda
  // de set de propósito); só entram as duas cartas que faltavam.
  for (const c of sem) {
    assert.ok(porId.has(c.id), `${c.id} sumiu`);
    if (c.id !== "nrt-ccg-n-099") assert.equal(porId.get(c.id).setId, c.setId, c.id);
  }
  assert.deepEqual(com.filter((c) => !semPorId.has(c.id)).map((c) => c.id).sort(), ["nrt-ccg-s09-m-275", "nrt-ccg-s14-j-526"]);
  // A armadilha: a carta impressa N-880 (Yamato, TP1) NÃO herda o nrt-ccg-n-880.
  assert.equal(porId.get("nrt-ccg-n-880").name, "Neji Hyuga");
  assert.equal(porId.get("nrt-ccg-n-880").number, "N-883");
  assert.equal(porId.get("nrt-ccg-n-880").setId, "nrt-ccg-s18");
  assert.equal(porId.get("nrt-ccg-n-1701").name, "Yamato");
  assert.equal(porId.get("nrt-ccg-n-1701").number, "N-880");
  assert.match(porId.get("nrt-ccg-n-880").image, /n-ccg-db\.github\.io.*set_18_fangs_of_the_snake%2Fn883\.webp/);
  // O scan errado do N-CCG-DB (J-470) fica fora: segue o do narutocards.
  assert.match(porId.get("nrt-ccg-j-470").image, /cdn\.narutocards\.ca/);
  const renumeradas = sem.filter((c) => porId.get(c.id).number !== c.number).length;
  assert.ok(renumeradas >= 1800, `renumeradas: ${renumeradas}`);
});

test("número trocado com a vizinha: o id antigo segue com a MESMA carta, e a verdadeira entra com -<set>-", () => {
  const porId = new Map(montaLinha(snap, comp, dp).line.map((c) => [c.id, c]));
  const ve = (id) => { const c = porId.get(id); return [c.setId, c.number, c.name]; };
  assert.deepEqual(ve("nrt-ccg-m-275"), ["nrt-ccg-s09", "M-274", "Frustrated Ambition"]);
  assert.deepEqual(ve("nrt-ccg-s09-m-275"), ["nrt-ccg-s09", "M-275", "Riot in High-Security Facility"]);
  assert.deepEqual(ve("nrt-ccg-j-526"), ["nrt-ccg-s14", "J-525", "Chakra Cannon"]);
  assert.deepEqual(ve("nrt-ccg-s14-j-526"), ["nrt-ccg-s14", "J-526", "Thunder Funeral: Feast of Lightning"]);
});

test("carta no set errado: o N-099 Raido vai pro Curse of the Sand, Starter Deck, com o mesmo id", () => {
  const linha = montaLinha(snap, comp, dp).line;
  const raido = linha.filter((c) => c.id === "nrt-ccg-n-099");
  assert.equal(raido.length, 1);
  assert.equal(raido[0].setId, "nrt-ccg-s03");
  assert.equal(raido[0].rarity, "Starter Deck");
  assert.deepEqual(raido[0].variants, ["Normal"]);
  assert.match(raido[0].image, /set_3_curse_of_the_sand%2Fn099\.webp/);
  // O Raido do Quest for Power (N-244) continua lá, sozinho.
  assert.deepEqual(linha.filter((c) => c.setId === "nrt-ccg-s07" && c.name === "Raido Namiashi").map((c) => c.id), ["nrt-ccg-n-244"]);
  // setTotal acompanha: o Curse of the Sand fica com as 148 do ccgtrader.
  assert.equal(raido[0].setTotal, 148);
});

test("catálogo versionado: regerado com o de-para (mesmos ids, mesmo set, número impresso)", () => {
  // Com as promos do N-CCG-DB (2026-11-13), que o sync anexa ao set de promos.
  const linha = montaLinha(snap, comp, dp, promos).line;
  assert.equal(catalogo.length, linha.length);
  const doCatalogo = new Map(catalogo.map((c) => [c.id, c]));
  for (const c of linha) {
    const v = doCatalogo.get(c.id);
    assert.ok(v, `${c.id} fora do data/naruto/cards.js`);
    assert.equal(v.setId, c.setId, c.id);
    assert.equal(v.number, c.number, c.id);
  }
});

// O endereço /games/naruto-ccg/<set>/<carta> leva o número, então os 1.844
// renumerados mudam de endereço. Sem registro (o mapa da borda cresceria
// ~200 KB): o cartaParecida acha a carta pelo id, que guarda o código antigo.
// Com a regra de antes, 461 iam pra carta ERRADA (o antigo kakashi-hatake-n-883
// caía no Neji, que é o N-883 de hoje) e 1.383 davam 404.
test("endereço antigo de TODA carta renumerada leva pra ela mesma, nenhum pra outra", () => {
  const porSet = (cs) => { const m = new Map(); for (const c of cs) (m.get(c.set) || m.set(c.set, []).get(c.set)).push(c); return m; };
  const antes = porSet(montaLinha(snap, comp, null).line);
  const depois = porSet(montaLinha(snap, comp, dp).line);
  let conferidos = 0;
  const erros = [];
  for (const [nome, cartas] of antes) {
    const velhos = slugsDasCartas(cartas);
    const hoje = depois.get(nome);
    const novos = slugsDasCartas(hoje);
    const vivos = new Set(novos.values());
    for (const [id, velho] of velhos) {
      const novo = novos.get(id);
      if (novo === velho) continue;
      conferidos++;
      if (vivos.has(velho)) { erros.push(`${id}: ${velho} é o endereço de outra carta hoje`); continue; }
      const achado = cartaParecida(hoje, novos, velho);
      // Carta que saiu do set (o N-099) não pode cair em outra: fica pro
      // data/cartas-movidas.json.
      if (achado !== (novo || null)) erros.push(`${id}: ${velho} -> ${achado} (devia ${novo || "nada"})`);
    }
  }
  assert.deepEqual(erros, []);
  assert.ok(conferidos >= 1845, `conferidos: ${conferidos}`);
});
