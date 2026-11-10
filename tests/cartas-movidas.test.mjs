// Registro das cartas que mudaram de SET (2026-11-02, scripts/lib/
// cartas-movidas.mjs): o que entra, como o prerender resolve no catálogo de
// hoje e onde o deploy roda. O 301 na borda, de ponta a ponta, está no
// tests/games-rota.test.mjs.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agrupaPorSet, paginasDoJogo, enderecosDasCartas } from "../scripts/lib/paginas-de-set.mjs";
import { cartasQueMudaramDeSet, enderecosARegistrar, juntaNoRegistro, destinosDasMovidas } from "../scripts/lib/cartas-movidas.mjs";
import { setsARegistrar, enderecosRenomeados, textoDoRegistroDeSets } from "../scripts/lib/sets-renomeados.mjs";
import { jogoDaUrl } from "../functions/_lib/jogos.js";
import { cartaParecida } from "../functions/_lib/slug-carta.js";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DC1 = "Data Carddass — ナルティメットカードバトル 第１弾";
const DC2 = "Data Carddass — ナルティメットカードバトル 第２弾";
const dc = (id, name, number, set, setId, extra) => ({ id, name, number, set, setId, language: "ja", ...extra });
const BASE = [
  dc("nrt-dc-dn-001", "Naruto Uzumaki", "DN-001", DC1, "nrt-dc-s01"),
  dc("nrt-dc-dn-051", "Nine-Tails Naruto", "DN-051", DC1, "nrt-dc-s01"),
  dc("nrt-dc-dn-101", "Sasuke Uchiha", "DN-101", DC2, "nrt-dc-s02")
];
const troca = (cards, id, mudanca) => cards.map((c) => (c.id === id ? { ...c, ...mudanca } : c));

test("a página de set e o endereço da carta saem com a régua do prerender", () => {
  const paginas = paginasDoJogo("naruto", agrupaPorSet([...BASE, dc("nrt-dc-x", "Aposentada", "X-1", DC1, "nrt-dc-s01", { retired: true })]));
  assert.deepEqual(paginas.map((p) => `${p.url}/${p.slug}`), ["naruto-data-carddass/data-carddass-1", "naruto-data-carddass/data-carddass-2"]);
  const enderecos = enderecosDasCartas(paginas);
  assert.equal(enderecos.get("naruto|nrt-dc-dn-051"), "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp");
  assert.equal(enderecos.has("naruto|nrt-dc-x"), false, "aposentada não forma página");
  // O prerender usa esta mesma função (a régua copiada divergiria no 1º ajuste).
  assert.match(ler("scripts/prerender-catalog.mjs"), /paginasDoJogo\(game, byName,/);
});

test("entra só a carta que foi pra OUTRO set que segue existindo", () => {
  const movida = troca(BASE, "nrt-dc-dn-051", { set: DC2, setId: "nrt-dc-s02" });
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, movida),
    { "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051" });
  // Mudou de endereço dentro do set (nome, número): o cartaParecida resolve.
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, troca(BASE, "nrt-dc-dn-051", { name: "Kyubi Naruto" })), {});
  // Carta nova e carta que saiu do catálogo: nada a redirecionar.
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, [...BASE, dc("nrt-dc-dn-052", "Kakashi", "DN-052", DC1, "nrt-dc-s01")]), {});
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, BASE.slice(1)), {});
  // Set renomeado: TODAS as cartas mudam de set, e o antigo deixa de existir.
  // Quem leva o endereço é o de-para do SET (uma entrada, ver os testes do
  // registro de sets abaixo); registrar carta por carta incharia o mapa.
  const renomeado = BASE.map((c) => (c.set === DC2 ? { ...c, set: "Data Carddass — Card Battle Vol. 2" } : c));
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, renomeado), {});
});

// ── Set que mudou de endereço sem PR (2026-11-10) ───────────────────────────
// O caso que abriu o registro automático: no sync de 08/11/2026 o set japonês
// "Rapid Strike Master" passou a se chamar "連撃マスター". O nome sem letra
// latina vira o slug do setId ("s5r-s5r"), que era o endereço do set CHINÊS de
// mesmo setId; o chinês foi pro "-2". O endereço antigo do japonês ficou sem
// página e sem de-para: set, -en e 91 cartas em 404.
const S5R_JA = "Rapid Strike Master", S5R_JA_HOJE = "連撃マスター", S5R_ZH = "連撃大師";
const pk = (n, set, lang) => ({
  id: `S5R-00${n}-${lang}`, name: lang === "ja" ? `Carta ${n}` : "卡片", number: `00${n}`, setTotal: 70,
  set, setId: "S5R", language: lang
});
const S5R_ANTES = [...[1, 2, 3, 4].map((n) => pk(n, S5R_JA, "ja")), ...[1, 2].map((n) => pk(n, S5R_ZH, "zh-tw"))];
const S5R_DEPOIS = [...[1, 2, 3, 4].map((n) => pk(n, S5R_JA_HOJE, "ja")), ...[1, 2].map((n) => pk(n, S5R_ZH, "zh-tw"))];

test("set renomeado na fonte: entra UMA entrada no registro de sets, com ids de carta", () => {
  const { movidas, sets } = enderecosARegistrar("pokemon", S5R_ANTES, S5R_DEPOIS);
  // Primeiro, do meio e último id, em ordem: até 3 por set.
  assert.deepEqual(sets, { "pokemon/rapid-strike-master": ["S5R-001-ja", "S5R-003-ja", "S5R-004-ja"] });
  // As japonesas vão com o set (nenhuma entra carta a carta); as chinesas
  // perderam o endereço pra OUTRO set que existe, e essas são carta movida.
  assert.deepEqual(Object.keys(movidas), ["pokemon/s5r-s5r/001-070-zh", "pokemon/s5r-s5r/002-070-zh"]);
  assert.equal(movidas["pokemon/s5r-s5r/001-070-zh"], "S5R-001-zh-tw");
  assert.deepEqual(setsARegistrar("pokemon", S5R_ANTES, S5R_DEPOIS), sets, "o atalho da lib dá o mesmo registro");
});

test("registro de sets: o prerender acha a página de hoje pelos ids, não pelo setId", () => {
  const { sets } = enderecosARegistrar("pokemon", S5R_ANTES, S5R_DEPOIS);
  const paginas = paginasDoJogo("pokemon", agrupaPorSet(S5R_DEPOIS));
  assert.deepEqual(paginas.map((p) => p.slug), ["s5r-s5r", "s5r-s5r-2"], "japonês e chinês: mesmo setId, duas páginas");
  const { porUrl, avisos } = enderecosRenomeados(paginas, { games: {}, set: {} }, sets);
  assert.deepEqual(porUrl.get("pokemon"), { "rapid-strike-master": "s5r-s5r" });
  assert.deepEqual(avisos, []);
  // A tabela à mão, que só sabe o setId, não distingue as duas edições: a
  // primeira página com aquele setId leva (aqui acerta por acaso da ordem).
  // Renomeado de novo, o mesmo registro segue achando a página.
  const deNovo = S5R_DEPOIS.map((c) => (c.set === S5R_JA_HOJE ? { ...c, set: "Rengeki Master" } : c));
  assert.deepEqual(enderecosRenomeados(paginasDoJogo("pokemon", agrupaPorSet(deNovo)), {}, sets).porUrl.get("pokemon"),
    { "rapid-strike-master": "rengeki-master" });
});

test("set que se dividiu: o set vai com a maioria, e a carta que foi pra outro lugar entra uma a uma", () => {
  const X = "Set X", Y = "Set Y";
  const antes = [...BASE, dc("x-1", "Um", "X-1", X, "nrt-dc-sx"), dc("x-2", "Dois", "X-2", X, "nrt-dc-sx"), dc("x-3", "Três", "X-3", X, "nrt-dc-sx")];
  const depois = [...BASE, dc("x-1", "Um", "X-1", Y, "nrt-dc-sx"), dc("x-2", "Dois", "X-2", Y, "nrt-dc-sx"), dc("x-3", "Três", "X-3", DC2, "nrt-dc-s02")];
  const { movidas, sets } = enderecosARegistrar("naruto", antes, depois);
  assert.deepEqual(sets, { "naruto-data-carddass/set-x": ["x-1", "x-2"] });
  assert.deepEqual(movidas, { "naruto-data-carddass/set-x/tres-x-3-jp": "x-3" });
});

test("set que se espalhou sem maioria não ganha de-para: cada carta entra com o endereço dela", () => {
  const X = "Set X";
  const antes = [...BASE, dc("x-1", "Um", "X-1", X, "nrt-dc-sx"), dc("x-2", "Dois", "X-2", X, "nrt-dc-sx")];
  const depois = [...BASE, dc("x-1", "Um", "X-1", DC1, "nrt-dc-s01"), dc("x-2", "Dois", "X-2", DC2, "nrt-dc-s02")];
  const { movidas, sets } = enderecosARegistrar("naruto", antes, depois);
  assert.deepEqual(sets, {}, "metade não é maioria: redirecionar o set diria que ele foi inteiro pra lá");
  assert.deepEqual(movidas, { "naruto-data-carddass/set-x/um-x-1-jp": "x-1", "naruto-data-carddass/set-x/dois-x-2-jp": "x-2" });
  // Set que saiu do catálogo: nada a registrar, o endereço segue 404.
  assert.deepEqual(enderecosARegistrar("naruto", antes, BASE), { movidas: {}, erradas: {}, sets: {} });
});

test("set importado que a fonte publicou com outro nome E outro id: o de-para de id acha as cartas", () => {
  const antes = [...BASE, dc("imp-1", "Um", "X-1", "Importado", "nrt-dc-imp"), dc("imp-2", "Dois", "X-2", "Importado", "nrt-dc-imp")];
  const depois = [
    ...BASE,
    dc("imp-1", "Um", "X-1", "Importado", "nrt-dc-imp", { retired: true }), dc("imp-2", "Dois", "X-2", "Importado", "nrt-dc-imp", { retired: true }),
    dc("of-1", "Um", "X-1", "Oficial", "nrt-dc-of"), dc("of-2", "Dois", "X-2", "Oficial", "nrt-dc-of")
  ];
  const idDeHoje = (id) => String(id).replace(/^imp-/, "of-");
  assert.deepEqual(enderecosARegistrar("naruto", antes, depois).sets, {}, "sem o de-para, as cartas parecem ter sumido");
  const { sets } = enderecosARegistrar("naruto", antes, depois, idDeHoje);
  assert.deepEqual(sets, { "naruto-data-carddass/importado": ["of-1", "of-2"] });
  // E o inverso no prerender: o registro guardou o id de ANTES da aposentadoria.
  const paginas = paginasDoJogo("naruto", agrupaPorSet(depois));
  assert.equal(enderecosRenomeados(paginas, {}, { "naruto-data-carddass/importado": ["imp-1", "imp-2"] }).porUrl.has("naruto-data-carddass"), false);
  assert.deepEqual(enderecosRenomeados(paginas, {}, { "naruto-data-carddass/importado": ["imp-1", "imp-2"] }, idDeHoje).porUrl.get("naruto-data-carddass"),
    { importado: "oficial" });
});

test("registro de sets no prerender: a tabela à mão e a página viva vencem; entrada sem carta vira aviso", () => {
  const paginas = paginasDoJogo("naruto", agrupaPorSet(BASE));
  const registro = {
    // A tabela à mão já resolve este: fica com ela.
    "naruto-data-carddass/velho-1": ["nrt-dc-dn-101"],
    // Endereço que voltou a ser de um set de hoje: a página vence.
    "naruto-data-carddass/data-carddass-2": ["nrt-dc-dn-001"],
    // Maioria: duas no 第1弾, uma no 第2弾.
    "naruto-data-carddass/velho-2": ["nrt-dc-dn-001", "nrt-dc-dn-051", "nrt-dc-dn-101"],
    // Nenhuma carta no catálogo, jogo de outra entrada e entrada torta.
    "naruto-data-carddass/velho-3": ["sumiu-1"],
    "outro-jogo/velho": ["nrt-dc-dn-001"],
    "sem-barra": ["nrt-dc-dn-001"],
    "naruto-data-carddass/velho-4": "nrt-dc-dn-001"
  };
  const { porUrl, avisos } = enderecosRenomeados(paginas, { games: { "naruto-data-carddass": { "velho-1": "nrt-dc-s01" } } }, registro);
  assert.deepEqual(porUrl.get("naruto-data-carddass"), { "velho-1": "data-carddass-1", "velho-2": "data-carddass-1" });
  assert.equal(porUrl.has("outro-jogo"), false);
  assert.equal(avisos.length, 4);
});

test("o arquivo do registro de sets: uma entrada por linha, em ordem", () => {
  const texto = textoDoRegistroDeSets({ "b/y": ["2", "1"], "a/x": ["3"] });
  assert.equal(texto, '{\n "a/x": ["3"],\n "b/y": ["2","1"]\n}\n');
  assert.deepEqual(JSON.parse(texto), { "a/x": ["3"], "b/y": ["2", "1"] });
  assert.equal(textoDoRegistroDeSets({}), "{\n\n}\n");
  assert.deepEqual(JSON.parse(textoDoRegistroDeSets(null)), {});
});

// Os quatro sets que perderam o endereço antes de o deploy registrar sozinho
// (achados comparando os snapshots de 01/10 a 05/11/2026 com o catálogo de
// 10/11): os três japoneses do Pokémon e o "Heroine's" do One Piece, que
// perdeu o apóstrofo. O arquivo cresce sozinho a cada deploy, então aqui só o
// formato e essas quatro chaves são travados.
test("o registro de sets versionado traz os quatro sets de outubro e novembro", () => {
  const registro = JSON.parse(ler("data/sets-renomeados-auto.json"));
  for (const chave of [
    "pokemon/rapid-strike-master",
    "pokemon/mega-expansion-30th-celebration",
    "pokemon/30th-celebration-premium-deck-set-espeon-umbreon",
    "one-piece-card-game/extra-booster-one-piece-heroine-s-edition-vol-2"
  ]) assert.ok(Array.isArray(registro[chave]), chave);
  for (const [chave, ids] of Object.entries(registro)) {
    const partes = chave.split("/");
    assert.equal(partes.length, 2, chave);
    assert.ok(jogoDaUrl(partes[0]), `jogo desconhecido: ${chave}`);
    assert.match(partes[1], /^[a-z0-9]+(-[a-z0-9]+)*$/, chave);
    assert.ok(Array.isArray(ids) && ids.length >= 1 && ids.length <= 3 && ids.every((id) => typeof id === "string" && id), chave);
  }
  assert.deepEqual(Object.keys(registro), [...Object.keys(registro)].sort(), "em ordem (o diff do snapshot fica limpo)");
  assert.equal(ler("data/sets-renomeados-auto.json"), textoDoRegistroDeSets(registro), "no formato que o deploy grava");
});

// Dentro do set, o que a borda faz com o endereço antigo é o cartaParecida.
// Ele erra quando dois números viram o mesmo pedaço de endereço: o kanji some,
// e PR忍-17 e PR作-17 são os dois "pr-17" (Naruto Card Game, PR #234: a promo
// sem nome ganhou o nome oficial e entrou a PR忍-17 que faltava).
test("dentro do set: entra o endereço que o cartaParecida levaria pra OUTRA carta", () => {
  const antes = [...BASE, dc("nrt-PRS-017", "Name unconfirmed", "PR作-17", DC1, "nrt-dc-s01")];
  const depois = [
    ...BASE,
    dc("nrt-PRS-017", "A New Enemy", "PR作-17", DC1, "nrt-dc-s01"),
    dc("nrt-PRN-017", "Naruto Uzumaki & Sasuke Uchiha", "PR忍-17", DC1, "nrt-dc-s01")
  ];
  const { movidas, erradas } = enderecosARegistrar("naruto", antes, depois);
  assert.deepEqual(movidas, {});
  // Sem o registro, a regra do número casa as duas e a ordem do id leva pra PR忍-17.
  const pagina = paginasDoJogo("naruto", agrupaPorSet(depois)).find((p) => p.slug === "data-carddass-1");
  const naBorda = cartaParecida(pagina.cards, pagina.slugsCartas, "name-unconfirmed-pr-17-jp");
  assert.equal(naBorda, pagina.slugsCartas.get("nrt-PRN-017"));
  assert.deepEqual(erradas, { "naruto-data-carddass/data-carddass-1/name-unconfirmed-pr-17-jp": "nrt-PRS-017" });
});

test("dentro do set: o que a borda já resolve certo e o endereço que é de outra carta ficam de fora", () => {
  // Nome mudou, número igual: a regra do número acha a mesma carta.
  assert.deepEqual(enderecosARegistrar("naruto", BASE, troca(BASE, "nrt-dc-dn-051", { name: "Kyubi Naruto" })).erradas, {});
  // O DN-051 passou pra outra carta e o antigo virou DN-052: o endereço
  // "nine-tails-naruto-dn-051-jp" agora é da carta nova, que vence.
  const trocou = [
    ...troca(BASE, "nrt-dc-dn-051", { number: "DN-052" }),
    dc("nrt-dc-dn-051b", "Nine-Tails Naruto", "DN-051", DC1, "nrt-dc-s01")
  ];
  assert.deepEqual(enderecosARegistrar("naruto", BASE, trocou).erradas, {});
});

test("dentro do set: entra o endereço que viraria 404 (nome e número mudaram)", () => {
  const depois = troca(BASE, "nrt-dc-dn-051", { name: "Kyubi", number: "DN-099" });
  assert.deepEqual(enderecosARegistrar("naruto", BASE, depois).erradas,
    { "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051" });
});

test("o registro junta em ordem, e o mesmo endereço fica com a carta mais recente", () => {
  const r = juntaNoRegistro({ "j/b/x": "id-1", "j/a/y": "id-2" }, { "j/b/x": "id-3", "j/0/z": "id-4" });
  assert.deepEqual(Object.keys(r), ["j/0/z", "j/a/y", "j/b/x"]);
  assert.equal(r["j/b/x"], "id-3");
  assert.deepEqual(juntaNoRegistro(null, null), {});
});

test("o prerender resolve o registro no catálogo de hoje", () => {
  const registro = {
    // Mudou duas vezes (1 -> 2 -> 3): os dois endereços antigos vão pro de hoje.
    "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051",
    "naruto-data-carddass/data-carddass-2/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051",
    // O endereço antigo voltou a ser de uma carta: ela vence, sem 301.
    "naruto-data-carddass/data-carddass-1/naruto-uzumaki-dn-001-jp": "nrt-dc-dn-101",
    // Id que saiu do catálogo, endereço torto e jogo que não existe: fora.
    "naruto-data-carddass/data-carddass-1/sumiu-dn-999-jp": "nrt-dc-dn-999",
    "naruto-data-carddass/data-carddass-1": "nrt-dc-dn-051",
    "nao-existe/x/y": "nrt-dc-dn-051"
  };
  const DC3 = "Data Carddass — ナルティメットカードバトル 第３弾";
  const hoje = troca(BASE, "nrt-dc-dn-051", { set: DC3, setId: "nrt-dc-s03" });
  const porUrl = destinosDasMovidas(registro, paginasDoJogo("naruto", agrupaPorSet(hoje)));
  assert.deepEqual([...porUrl.keys()], ["naruto-data-carddass"]);
  assert.deepEqual(porUrl.get("naruto-data-carddass"), {
    "data-carddass-1/nine-tails-naruto-dn-051-jp": "naruto-data-carddass/data-carddass-3/nine-tails-naruto-dn-051-jp",
    "data-carddass-2/nine-tails-naruto-dn-051-jp": "naruto-data-carddass/data-carddass-3/nine-tails-naruto-dn-051-jp"
  });
  // A carta que voltou pro endereço registrado não ganha 301 pra si mesma.
  assert.equal(destinosDasMovidas(registro, paginasDoJogo("naruto", agrupaPorSet(BASE))).get("naruto-data-carddass")["data-carddass-1/nine-tails-naruto-dn-051-jp"], undefined);
});

// As 39 cartas que a PR #224 trocou entre o 第1弾 e o 第2弾. Antes dela entrar,
// cada chave é o endereço vivo da própria carta (o prerender não gera 301);
// depois, é 301 pro set novo.
test("o registro versionado traz as cartas do Data Carddass da #224", () => {
  const registro = JSON.parse(ler("data/cartas-movidas.json"));
  assert.equal(registro["naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp"], "nrt-dc-dn-051");
  assert.ok(Object.keys(registro).length >= 39);
  for (const [chave, id] of Object.entries(registro)) {
    const partes = chave.split("/");
    assert.equal(partes.length, 3, chave);
    assert.ok(jogoDaUrl(partes[0]), `jogo desconhecido: ${chave}`);
    assert.match(partes[1] + "/" + partes[2], /^[a-z0-9-]+\/[a-z0-9-]+$/, chave);
    assert.ok(typeof id === "string" && id, chave);
  }
  assert.deepEqual(Object.keys(registro), [...Object.keys(registro)].sort(), "em ordem (o diff do snapshot fica limpo)");
});

// O registro compara o disco com o HEAD. Depois do commit do snapshot o HEAD
// já é o catálogo novo e nada mais muda de set: o passo tem que vir ANTES, e
// o commit tem que levar o arquivo junto.
test("o deploy registra entre o lint e o commit do snapshot, e não publica o registro", () => {
  const deploy = ler(".github/workflows/deploy.yml");
  const lint = deploy.indexOf("run: node scripts/lint-catalog.mjs");
  const registra = deploy.indexOf("run: node scripts/registra-cartas-movidas.mjs");
  const snapshot = deploy.indexOf("- name: Versiona snapshot do catálogo");
  const prerender = deploy.indexOf("run: node scripts/prerender-catalog.mjs");
  assert.ok(lint > 0 && registra > lint && snapshot > registra && prerender > snapshot, "ordem: lint, registro, snapshot, prerender");
  assert.match(deploy.slice(snapshot, prerender), /git add data /, "o snapshot leva data/ (e o registro junto)");
  const remove = /- name: Remove arquivos que não vão para o site[\s\S]*?\n\s*rm -rf ([^\n]+)/.exec(deploy);
  assert.ok(remove && remove[1].split(/\s+/).includes("data/cartas-movidas.json"));
  // O registro dos sets sai do mesmo passo e também só serve ao prerender.
  assert.ok(remove[1].split(/\s+/).includes("data/sets-renomeados-auto.json"));
  assert.match(ler("scripts/registra-cartas-movidas.mjs"), /data\/sets-renomeados-auto\.json/);
  assert.match(ler("scripts/prerender-catalog.mjs"), /sets-renomeados-auto\.json/);
});
