// Padrão da página de Sets (2026-10-09): o visual do Pokémon e do Magic vale
// em TODO jogo e linha — produtos do lançamento dentro do cartão do set
// (aninhaPorNome), as seções do jogo (agrupaSetsDoJogo) e, sem busca, o
// destaque do topo (vitrineDoTopo). Até aqui 13 jogos e as linhas vintage
// saíam do getViewItems por um `return group<Jogo>Sets(...)` próprio e
// ficavam sem as duas coisas. A regra está em docs/CATALOGO.md, 3.4.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(raiz, "src/app.js"), "utf8").replace(/\r\n/g, "\n");

function corpo(nome) {
  const i = app.search(new RegExp(`^ {2}(?:async )?function ${nome}\\s*\\(`, "m"));
  assert.ok(i >= 0, `${nome} existe`);
  return app.slice(i, app.indexOf("\n  }\n", i) + 4);
}
function constante(nome) {
  const m = app.match(new RegExp(`^ {2}const ${nome} =.*$`, "m"));
  assert.ok(m, `${nome} existe`);
  return m[0];
}

// A régua de EDIÇÃO (2nd Edition, Worldwide English…) mora no
// src/nomes-sets.js, que a lista de Sets e a página do set carregam.
const fakeWindow = {};
new Function("window", readFileSync(join(raiz, "src/nomes-sets.js"), "utf8"))(fakeWindow);
const edicaoDoSet = fakeWindow.SLEEVU_NOMES_SETS.edicaoDoSet;

const sortByReleaseDesc = (a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || a.name.localeCompare(b.name);
const sortByReleaseAsc = (a, b) => -sortByReleaseDesc(a, b);
const aninhaPorNome = new Function("sortByReleaseDesc", "edicaoDoSet",
  `${constante("VOLUME_SEGUINTE")}\n${corpo("aninhaPorNome")}\nreturn aninhaPorNome;`)(sortByReleaseDesc, edicaoDoSet);
const set = (name, releaseDate, extra = {}) => Object.assign({ type: "set", name, displayName: name, releaseDate }, extra);

test("a página de Sets tem UM caminho: aninha, agrupa pelo jogo, põe a Vitrine e ordena", () => {
  const vista = corpo("getViewItems");
  const sets = vista.slice(vista.indexOf('if (view === "sets")'), vista.indexOf('if (view === "artists")'));
  assert.ok(sets.includes("const grupos = agrupaSetsDoJogo(aninhaPorNome(setItems));"));
  // O destaque mora FORA da grade (2026-11-14), acima da linha do contador:
  // nada da Vitrine entra na lista que o pager desenha.
  assert.ok(sets.includes("pintaTopo(buscando ? [] : vitrineDoTopo(grupos));"));
  assert.ok(!sets.includes(".concat(grupos)"), "a Vitrine voltou pra dentro da grade");
  assert.ok(sets.includes("ordenaSets(grupos, ordem)"));
  assert.ok(!/return group\w+\(/.test(sets), "um jogo voltou a sair do getViewItems direto pelo agrupador, sem o padrão");
});

test("todo agrupador de sets é chamado pelo agrupaSetsDoJogo", () => {
  const agrupa = corpo("agrupaSetsDoJogo");
  const agrupadores = [...app.matchAll(/^ {2}function (group\w*Sets|groupNarutoDataCarddass|groupSetsBy\w+)\s*\(/gm)].map((m) => m[1]);
  assert.ok(agrupadores.length >= 17, `achei ${agrupadores.length} agrupadores`);
  for (const nome of agrupadores) assert.ok(agrupa.includes(nome), `${nome} não passa pelo agrupaSetsDoJogo`);
  // Nenhum agrupador monta cabeçalho à mão (só o ano, que não é seção de
  // promo): é o cabecalhoDeSecao que marca o que fica fora do destaque.
  const amao = app.match(/\{ type: "category-head", name: t\(/g) || [];
  assert.equal(amao.length, 1, "cabeçalho de seção montado fora do cabecalhoDeSecao");
});

test("aninhaPorNome: produto do lançamento entra no cartão; volume seguinte, deck e set de outra época não", () => {
  const raizes = aninhaPorNome([
    set("Paramount War", "2023-03-10"),
    set("Paramount War Pre-Release Cards", "2023-03-03"),
    set("Extra Booster: One Piece Heroines Edition", "2026-02-20"),
    set("Extra Booster: One Piece Heroines Edition Vol. 2", "2026-10-30"),
    set("Hidden Arsenal", "2009-11-10"),
    set("Hidden Arsenal 2", "2010-07-20"),
    set("Commander Anthology", "2017-06-09"),
    set("Commander Anthology Volume II", "2018-06-08"),
    set("Data Carddass — Formation", "2008-01-01"),
    set("Data Carddass — Formation 第1章", "2007-12-14"),
    set("Diagon Alley", "2002-03"),
    set("Diagon Alley 2-Player Starter Set", "2002-04", { kind: "deck" }),
    set("Compendium of Rathe", "2026-02-13"),
    set("Compendium of Rathe - Antiquity Pack", "2026-02-13"),
    set("Accel World", "2017-05-19"),
    set("Accel World -Infinite Burst-", "2017-11-10"),
    set("Dark Crisis", "2007-10-12"),
    set("Dark Crisis (Worldwide English)", "2007-12-12"),
    set("Legend of Blue Eyes", "2002-03-08"),
    set("Legend of Blue Eyes White Dragon 25th", "2023-04-01")
  ]);
  const filhos = (nome) => raizes.find((r) => r.name === nome).filhos.map((f) => f.rotulo);
  assert.deepEqual(filhos("Paramount War"), ["Pre-Release Cards"]);
  for (const sozinho of ["Extra Booster: One Piece Heroines Edition Vol. 2", "Hidden Arsenal 2", "Commander Anthology Volume II", "Data Carddass — Formation 第1章", "Diagon Alley 2-Player Starter Set", "Legend of Blue Eyes White Dragon 25th"]) {
    assert.ok(raizes.some((r) => r.name === sozinho), `${sozinho} devia ter cartão próprio`);
  }
  assert.deepEqual(filhos("Compendium of Rathe"), ["Antiquity Pack"]);
  assert.deepEqual(filhos("Accel World"), ["-Infinite Burst-"]);
  // Até 2026-11-12 a Worldwide English era chip; agora é EDIÇÃO (seletor da página do set).
  assert.deepEqual(filhos("Dark Crisis"), []);
  assert.deepEqual(raizes.find((r) => r.name === "Dark Crisis").edicoes.map((e) => e.rotulo), ["Worldwide English"]);
});

test("aninhaPorNome: o chip sai do nome de exibição quando ele traz o do pai (vintage japonês)", () => {
  const raizes = aninhaPorNome([
    set("Data Carddass — ナルティメットフォーメーション", "2008-01-01", { displayName: "Narutimate Formation" }),
    set("Data Carddass — ナルティメットフォーメーション 極秘任務", "2008-06-05", { displayName: "Narutimate Formation — Top Secret Mission" })
  ]);
  assert.equal(raizes.length, 1);
  assert.deepEqual(raizes[0].filhos.map((f) => f.rotulo), ["Top Secret Mission"]);
});

// Edição do set (2026-11-12): o MESMO set impresso de novo não vira chip nem
// cartão — vai pro seletor "Edição" da página do set. Regra do site.
test("edicaoDoSet: só reimpressão do set é edição", () => {
  assert.deepEqual(edicaoDoSet("BP01: Dawn of Palpagos (2nd Edition)"), { base: "BP01: Dawn of Palpagos", rotulo: "2nd Edition" });
  assert.deepEqual(edicaoDoSet("Metal Raiders (Worldwide English)"), { base: "Metal Raiders", rotulo: "Worldwide English" });
  assert.deepEqual(edicaoDoSet("The Dark Side of Dimensions Movie Pack: Gold Edition"), { base: "The Dark Side of Dimensions Movie Pack", rotulo: "Gold Edition" });
  assert.deepEqual(edicaoDoSet("Base Set - 1st Edition"), { base: "Base Set", rotulo: "1st Edition" });
  // Caixa de promos, produto de evento e os sets que SE CHAMAM edição (Magic).
  for (const nao of ["Tactical Evolution: Special Edition", "Duelist Alliance: Deluxe Edition", "Crossed Souls: Advanced Edition",
    "ST-01: Starter Deck 1 Straw Hat Crew (Super Pre-Release Edition)", "Unlimited Edition", "Revised Edition", "Limited Edition Alpha", "初階牌組100 特別版"]) {
    assert.equal(edicaoDoSet(nao), null, nao);
  }
});

test("aninhaPorNome: edição vai pro `edicoes` do original, sem chip e sem janela de 400 dias", () => {
  const raizes = aninhaPorNome([
    set("BP01: Dawn of Palpagos", "2026-07-30"),
    set("BP01: Dawn of Palpagos (2nd Edition)", "2026-07-30"),
    set("Metal Raiders", "2002-06-26"),
    set("Metal Raiders (Worldwide English)", "2004-12-01"),
    set("Tactical Evolution", "2007-08-15"),
    set("Tactical Evolution: Special Edition", "2007-09-12"),
    // Edição cujo original não está no catálogo: cartão próprio, como sempre.
    set("Legend of Blue Eyes White Dragon (Worldwide English)", "2004-12-01")
  ]);
  const raiz = (nome) => raizes.find((r) => r.name === nome);
  assert.equal(raizes.length, 4);
  assert.deepEqual(raiz("BP01: Dawn of Palpagos").edicoes.map((e) => e.rotulo), ["2nd Edition"]);
  assert.deepEqual(raiz("BP01: Dawn of Palpagos").filhos, []);
  assert.deepEqual(raiz("Metal Raiders").edicoes.map((e) => e.rotulo), ["Worldwide English"]);
  assert.deepEqual(raiz("Tactical Evolution").filhos.map((f) => f.rotulo), ["Special Edition"], "caixa de promos segue chip");
  assert.ok(raiz("Legend of Blue Eyes White Dragon (Worldwide English)"));
  // O cartão desenha só os `filhos`; a edição é achada pelo seletor "Edição"
  // da página do set (entravam também no Continue completando, que saiu em
  // 2026-11-14).
  assert.ok(!corpo("createSetCard").includes("edicoes"));
});

// A página do set (detail.js): o seletor lista o original e as edições, na
// mesma região de idioma, e aparece igual no original e em cada edição.
const detail = readFileSync(join(raiz, "src/detail.js"), "utf8").replace(/\r\n/g, "\n");
function corpoDetail(nome) {
  const i = detail.search(new RegExp(`^ {2}(?:async )?function ${nome}\\s*\\(`, "m"));
  assert.ok(i >= 0, `${nome} existe no detail.js`);
  return detail.slice(i, detail.indexOf("\n  }\n", i) + 4);
}
function edicoesNaPagina(detailName, sets, lang = "en") {
  const ordinal = detail.match(/^ {2}const EDICAO_ORDINAL =.*$/m)[0];
  const i18n = { "set.editionNth": "{n}ª", "set.editionOriginal": "Original" };
  const t = (k, v) => Object.entries(v || {}).reduce((s, [n, x]) => s.split(`{${n}}`).join(x), i18n[k] || k);
  const shared = { cardLanguageRegion: (l) => (l === "ja" ? "japanese" : "english") };
  const win = { SLEEVU_NOMES_SETS: fakeWindow.SLEEVU_NOMES_SETS, TCG_MANIFEST: { sets } };
  return new Function("window", "detailType", "pageCards", "detailName", "shared", "t",
    `${ordinal}\n${corpoDetail("edicoesDoSet")}\nreturn edicoesDoSet();`)(win, "set", [{ language: lang }], detailName, shared, t);
}

test("página do set: o seletor de edição sai no original e nas edições", () => {
  const sets = [
    { id: "EBP01", name: "BP01: Dawn of Palpagos", language: "en" },
    { id: "EBP01-2E", name: "BP01: Dawn of Palpagos (2nd Edition)", language: "en" },
    { id: "ETD01", name: "TD01: Dawn of Palpagos Red•Blue", language: "en" }
  ];
  const doOriginal = edicoesNaPagina("BP01: Dawn of Palpagos", sets);
  assert.deepEqual(doOriginal.map((e) => [e.setId, e.rotulo, e.atual]), [["EBP01", "1ª", true], ["EBP01-2E", "2ª", false]]);
  const daEdicao = edicoesNaPagina("BP01: Dawn of Palpagos (2nd Edition)", sets);
  assert.deepEqual(daEdicao.map((e) => [e.setId, e.atual]), [["EBP01", false], ["EBP01-2E", true]]);
  assert.deepEqual(edicoesNaPagina("TD01: Dawn of Palpagos Red•Blue", sets), [], "set sem edição: sem seletor");
  // Edição sem número: o original é "Original"; as outras, pela data.
  const mvp = edicoesNaPagina("The Dark Side of Dimensions Movie Pack", [
    { id: "MVP1-ENS", name: "The Dark Side of Dimensions Movie Pack: Secret Edition", language: "en", release: "2020-01-24" },
    { id: "MVP1", name: "The Dark Side of Dimensions Movie Pack", language: "en", release: "2016-07-22" },
    { id: "MVP1-ENG", name: "The Dark Side of Dimensions Movie Pack: Gold Edition", language: "en", release: "2017-01-13" },
    { id: "MVP1-SE", name: "The Dark Side of Dimensions Movie Pack: Special Edition", language: "en", release: "2018-09-07" }
  ]);
  assert.deepEqual(mvp.map((e) => e.rotulo), ["Original", "Gold Edition", "Secret Edition"]);
  // Outra região de idioma não entra.
  assert.deepEqual(edicoesNaPagina("Metal Raiders", [
    { id: "MRD", name: "Metal Raiders", language: "en" },
    { id: "MRD-JA", name: "Metal Raiders (2nd Edition)", language: "ja" }
  ]), []);
  // E o seletor é desenhado no cartão Visão geral.
  assert.ok(corpoDetail("renderInsights").includes("edicoesDoSet()"));
});

function vitrine(grupos, hoje, { comSobre = false } = {}) {
  const fn = new Function("sortByReleaseDesc", "sortByReleaseAsc", "Date", "comSobre",
    `${constante("NAO_DESTAQUE")}\n${corpo("foraDaSecao")}\n${corpo("vitrineDoTopo")}\nreturn vitrineDoTopo;`);
  const RealDate = Date;
  class Fixa extends RealDate { constructor(...a) { super(...(a.length ? a : [hoje])); } static parse(s) { return RealDate.parse(s); } }
  return fn(sortByReleaseDesc, sortByReleaseAsc, Fixa, comSobre)(grupos);
}

// Jogo vintage com "Sobre" (src/sobre-jogo.js, 2026-11-12): o topo é a
// história, sem o "Último set". E o "Continue completando" saiu de todo jogo
// em 2026-11-14 (o Ordenar tem "Progresso: mais completos primeiro"): com
// coleção ou sem, o topo é só o destaque.
test("jogo com \"Sobre\": sem destaque no topo; e o topo não tem mais o Continue completando", () => {
  const meio = Object.assign(set("Part 2", "1989-07"), { totalCount: 42, ownedCount: 10 });
  const grupos = [set("Part 1", "1988-11"), meio];
  assert.deepEqual(vitrine(grupos, "2026-11-12T12:00:00Z").map((i) => i.type), ["sx-hero"], "sem o Sobre, o destaque de sempre");
  assert.deepEqual(vitrine(grupos, "2026-11-12T12:00:00Z", { comSobre: true }), []);
  assert.ok(!app.includes("sx-continue") && !app.includes("sets.sx.continue"), "o Continue completando voltou");
});

test("o destaque é sempre um set principal: seção de promo/deck/raid não disputa", () => {
  const promos = { type: "category-head", name: "Promos", foraDoDestaque: true };
  const [heroi] = vitrine([
    { type: "category-head", name: "Principais", foraDoDestaque: false },
    set("Fabled", "2026-09-05"),
    promos,
    set("Promo Set 3", "2026-09-30")
  ], "2026-10-09T12:00:00Z");
  assert.equal(heroi.type, "sx-hero");
  assert.equal(heroi.set.name, "Fabled");
  assert.equal(heroi.parado, false);
});

test("jogo parado: o destaque vira \"Último set\" e o lado \"Anteriores\"", () => {
  const [heroi] = vitrine([set("Base Set", "2001-08"), set("Chamber of Secrets", "2002-10")], "2026-10-09T12:00:00Z");
  assert.equal(heroi.set.name, "Chamber of Secrets");
  assert.equal(heroi.parado, true);
  const hero = corpo("createHero");
  assert.ok(hero.includes('item.parado ? "sets.sx.last" : "sets.sx.latest"'));
  assert.ok(hero.includes('item.parado ? "sets.sx.earlier" : "sets.sx.recent"'));
});

test("o destaque fica fora das seções: volta o nome que a seção tirou", () => {
  // groupNarutoDataCarddass tira "Narutimate Cross — " dentro da seção; no
  // topo, sem o cabeçalho, "Ch. 7" sozinho não diz de qual título é.
  const [heroi] = vitrine([
    set("ナルティメットクロス 第6章", "2009-11-15", { displayName: "Ch. 6", nomeForaDaSecao: "Narutimate Cross — Ch. 6" }),
    set("ナルティメットクロス 第7章", "2010-01-15", { displayName: "Ch. 7", nomeForaDaSecao: "Narutimate Cross — Ch. 7" })
  ], "2026-11-02T12:00:00Z");
  assert.equal(heroi.set.displayName, "Narutimate Cross — Ch. 7");
  assert.deepEqual(heroi.lado.map((s) => s.displayName), ["Narutimate Cross — Ch. 6"]);
});

test("data só com ano e mês não ganha dia inventado no estilo longo", () => {
  const formatReleaseDate = new Function("shared",
    `const formatosDeData = new Map();\n${corpo("formatReleaseDate")}\nreturn formatReleaseDate;`)({ getLocale: () => "pt-BR" });
  assert.equal(formatReleaseDate("2002-10", "long"), "outubro de 2002");
  assert.equal(formatReleaseDate("2026-09-16", "long"), "16 de setembro de 2026");
  assert.match(formatReleaseDate("2002-10"), /out\.? de 2002/);
});

// O destaque mora na caixa #setsTopo, ANTES da linha do contador — o lugar
// do "Sobre" dos vintage, que a borda põe antes do .results-header. Assim a
// linha de contador/Ordenar/Visualização fica embaixo do topo nos dois.
test("o topo mora fora da grade, acima da linha do contador", () => {
  const html = readFileSync(join(raiz, "sets.html"), "utf8");
  const topo = html.indexOf('id="setsTopo"');
  assert.ok(topo >= 0 && topo < html.indexOf('class="results-header results-header-sets"'));
  assert.ok(corpo("pintaTopo").includes("createHero(heroi)"));
  assert.ok(!corpo("createViewItem").includes("createHero"), "o destaque voltou a ser item da grade");
});

// Ordenar dos Sets (2026-11-14). "Padrão" = as seções; as outras ordens são
// uma lista só, sem cabeçalho, com o nome cheio do set que a seção encurtou.
function ordena(lista, ordem) {
  const fn = new Function("sortByReleaseDesc", "sortByReleaseAsc", "shared",
    `${corpo("foraDaSecao")}\n${corpo("ordenaSets")}\nreturn ordenaSets;`);
  return fn(sortByReleaseDesc, sortByReleaseAsc, { getLocale: () => "pt-BR" })(lista, ordem);
}
test("Ordenar dos Sets: as opções do HTML são as do app.js", () => {
  const html = readFileSync(join(raiz, "sets.html"), "utf8");
  const select = html.slice(html.indexOf('<select id="setsSort"'), html.indexOf("</select>", html.indexOf('<select id="setsSort"')));
  const doHtml = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const doApp = JSON.parse(constante("ORDENS_DOS_SETS").replace(/^.*?=\s*/, "").replace(/;$/, "").replace(/'/g, '"'));
  assert.deepEqual(doHtml, doApp);
  assert.equal(doHtml[0], "padrao", "o padrão é a lista de sempre");
  assert.ok(select.includes("data-ordenar"), "sem o data-ordenar o menu do src/ordenar.js não abre");
});
test("Ordenar dos Sets: padrão mantém as seções; o resto vira lista só", () => {
  const cab = { type: "category-head", name: "Principais", count: 3 };
  const a = Object.assign(set("Alpha", "2024-01-10"), { totalCount: 100, ownedCount: 90, value: 50 });
  const b = Object.assign(set("Beta", "2025-05-02"), { totalCount: 10, ownedCount: 10, value: 900 });
  const c = Object.assign(set("ナルティメットクロス 第7章", "2026-02-01", { displayName: "Ch. 7", nomeForaDaSecao: "Narutimate Cross — Ch. 7" }), { totalCount: 40, ownedCount: 0, value: 0 });
  const d = Object.assign(set("Delta", "2023-03-03"), { totalCount: 80, ownedCount: 20, alt: { n: 60, langs: ["pt"] }, value: 10 });
  const lista = [cab, a, b, c, d];
  assert.equal(ordena(lista, "padrao"), lista, "padrão devolve a lista do jeito que veio");
  const nomes = (ordem) => ordena(lista, ordem).map((s) => s.displayName);
  // Progresso = o do cartão: Delta tem 20 aqui + 60 em PT = 100%, empata com
  // Beta (10/10) e passa na frente por ter mais cartas; sem carta, no fim.
  assert.deepEqual(nomes("progresso"), ["Delta", "Beta", "Alpha", "Narutimate Cross — Ch. 7"]);
  assert.deepEqual(nomes("recentes"), ["Narutimate Cross — Ch. 7", "Beta", "Alpha", "Delta"]);
  assert.deepEqual(nomes("antigos"), ["Delta", "Alpha", "Beta", "Narutimate Cross — Ch. 7"]);
  assert.deepEqual(nomes("nome"), ["Alpha", "Beta", "Delta", "Narutimate Cross — Ch. 7"]);
  assert.deepEqual(nomes("valor"), ["Beta", "Alpha", "Delta", "Narutimate Cross — Ch. 7"]);
  assert.ok(ordena(lista, "nome").every((i) => i.type === "set"), "cabeçalho de seção ficou na lista ordenada");
});

// Bandai moderno (2026-11-11): One Piece, Gundam, Fusion World, Digimon, Union
// Arena e o NARUTO CARD GAME de 2027 (narutocg) no formato do One Piece, e o
// Godzilla (Bushiroad), que tem a mesma forma. Os códigos são os do
// catálogo daquele dia; o que importa é cada um cair na seção certa, e o
// "ST01" do Fusion World (Story Booster) não virar starter.
function bandai() {
  const i = app.indexOf("  const SECOES_BANDAI = {");
  assert.ok(i >= 0, "SECOES_BANDAI existe");
  const regras = app.slice(i, app.indexOf("\n  };\n", i) + 5);
  return new Function("sortByReleaseDesc", "cabecalhoDeSecao",
    `${regras}\n${constante("EVENTO_BANDAI")}\n${corpo("groupBandaiSets")}\nreturn (jogo, sets) => groupBandaiSets(sets, SECOES_BANDAI[jogo]);`)(
    sortByReleaseDesc, (key, count) => ({ type: "category-head", key, count }));
}
function secoesBandai(jogo, setIds) {
  const fn = bandai();
  const secoes = {};
  let atual = null;
  for (const item of fn(jogo, setIds.map((setId) => set(setId, "2026-01-01", { setId })))) {
    if (item.type === "category-head") secoes[atual = item.key.replace("sets.category.", "")] = [];
    else secoes[atual].push(item.setId);
  }
  for (const lista of Object.values(secoes)) lista.sort();
  return secoes;
}

test("Bandai moderno: coleção numerada, boosters extras, decks e promos, pelo código do set", () => {
  assert.deepEqual(secoesBandai("onepiece", ["OP01", "OP15-EB04", "EB-05", "PRB-02", "ST-01", "ST-31", "LT-01", "SD01", "OP-PR", "OP-DD", "OP-RP", "OP17 RE"]), {
    main: ["OP01", "OP15-EB04"], extraBoosters: ["EB-05", "PRB-02"], decks: ["LT-01", "SD01", "ST-01", "ST-31"], promos: ["OP-DD", "OP-PR", "OP-RP", "OP17 RE"]
  });
  assert.deepEqual(secoesBandai("gundam", ["GD01", "GD06", "EB01", "GD01_b", "ST01", "ST14", "SC01", "GCG-PR", "EXBP", "RP"]), {
    main: ["GD01", "GD06"], extraBoosters: ["EB01", "GD01_b"], decks: ["SC01", "ST01", "ST14"], promos: ["EXBP", "GCG-PR", "RP"]
  });
  assert.deepEqual(secoesBandai("dbfw", ["FB01", "FB11", "SB01", "ST01", "FS01", "FS12", "FB02_AR", "DBSFW_PR", "DBSFW_EM"]), {
    main: ["FB01", "FB11"], extraBoosters: ["SB01", "ST01"], decks: ["FS01", "FS12"], promos: ["DBSFW_EM", "DBSFW_PR", "FB02_AR"]
  });
  assert.deepEqual(secoesBandai("digimon", ["BT-01", "BT-26", "BT27", "EX-13", "RB-01", "AD-01", "LM-08", "LM-01-05", "BT01-03A", "BT19-20", "ST-1", "ST-25", "BD02", "D-PR", "DEMO", "RPC"]), {
    main: ["BT-01", "BT-26", "BT01-03A", "BT19-20", "BT27"], extraBoosters: ["AD-01", "EX-13", "LM-01-05", "LM-08", "RB-01"], decks: ["BD02", "ST-1", "ST-25"], promos: ["D-PR", "DEMO", "RPC"]
  });
  assert.deepEqual(secoesBandai("unionarena", ["UE01BT", "UE24BT", "UEX08BT", "UP01BT", "UE01NC", "UE01ST", "UE01ST_PRE", "UE10DC", "UEPR"]), {
    main: ["UE01BT", "UE24BT"], extraBoosters: ["UE01NC", "UEX08BT", "UP01BT"], decks: ["UE01ST", "UE01ST_PRE", "UE10DC"], promos: ["UEPR"]
  });
  assert.deepEqual(secoesBandai("narutocg", ["nrt-ncg-promo", "nrt-ncg-bt01", "nrt-ncg-st01"]), {
    main: ["nrt-ncg-bt01"], decks: ["nrt-ncg-st01"], promos: ["nrt-ncg-promo"]
  });
  // Godzilla (Bushiroad, no mesmo formato): o Sleeve & Card Set fica nas promos.
  assert.deepEqual(secoesBandai("godzilla", ["EBP01", "EBP05", "ESD01", "ESD05", "EPR", "ESC01"]), {
    main: ["EBP01", "EBP05"], decks: ["ESD01", "ESD05"], promos: ["EPR", "ESC01"]
  });
  // Palworld (Bushiroad, idem): a 2ª edição é principal, o Sleeve Set é promo.
  assert.deepEqual(secoesBandai("palworld", ["EBP01", "EBP01-2E", "EBP02", "ESS01", "ETD01", "ETD02", "EPR", "PC"]), {
    main: ["EBP01", "EBP01-2E", "EBP02"], decks: ["ETD01", "ETD02"], promos: ["EPR", "ESS01", "PC"]
  });
  // Final Fantasy (Square Enix, na mesma forma): os Opus, o Legacy Collection
  // como extra, starters e Boss Decks nos decks, o resto nas promos.
  assert.deepEqual(secoesBandai("fftcg", ["OP1", "OP30", "RE", "ST27", "BDC", "BD7", "PR", "W24", "DEC"]), {
    main: ["OP1", "OP30"], extraBoosters: ["RE"], decks: ["BD7", "BDC", "ST27"], promos: ["DEC", "PR", "W24"]
  });
  // Shadowverse: Evolve: os Booster Sets numerados; colaboração, Seaside
  // Memories, Summer Edition e Gloryfinder Bundle nos extras; os decks; e
  // promos e Gloryfinder Events no resto.
  assert.deepEqual(secoesBandai("shadowverse", ["BP01", "BP20", "CP01", "ECP02", "SP01", "PCS01", "GFB01", "SD01", "CSD03", "SDD06", "GFD02", "SS01", "SVPR", "GFE"]), {
    main: ["BP01", "BP20"], extraBoosters: ["CP01", "ECP02", "GFB01", "PCS01", "SP01"], decks: ["CSD03", "GFD02", "SD01", "SDD06", "SS01"], promos: ["GFE", "SVPR"]
  });
  // hololive OFFICIAL CARD GAME: Booster Pack, Extra Booster, Start Deck (e
  // o Start Cheer Set) pelo código oficial; as promos no resto.
  assert.deepEqual(secoesBandai("hololive", ["HBP01", "HBP07", "HEB01", "HSD01", "HSD19", "HYS01", "HPR"]), {
    main: ["HBP01", "HBP07"], extraBoosters: ["HEB01"], decks: ["HSD01", "HSD19", "HYS01"], promos: ["HPR"]
  });
  // Dragon Ball Super Card Game Masters: os boosters numerados das duas
  // grafias (DBS-B01…, BT25…) e a 2nd Edition; Themed/Draft/Battle Evolution/
  // Mythic/Collector's como extra; Expansion Deck Box e Anniversary nos decks;
  // Pre-Release, Release Event, promos e Oversized no resto.
  assert.deepEqual(secoesBandai("dbs", ["DBS-B01", "DBS-B10-RE", "BT31", "DBS-TB01", "DB1", "EB-01", "MB-01", "CSV1", "DBS-BE01", "BE25", "DBS-B12PRE", "BT31_PR", "PR", "OVRS"]), {
    main: ["BT31", "DBS-B01", "DBS-B10-RE"], extraBoosters: ["CSV1", "DB1", "DBS-TB01", "EB-01", "MB-01"], decks: ["BE25", "DBS-BE01"], promos: ["BT31_PR", "DBS-B12PRE", "OVRS", "PR"]
  });
  // Grand Archive (Weebs of the Shore, na mesma forma): o booster de três
  // letras, a Alter Edition e os packs avulsos como extra, Starter Decks e
  // Re:Collection nos decks, Event/Supporter Pack e promos no resto.
  assert.deepEqual(secoesBandai("grandarchive", ["DOA-1ST", "FTC", "AMB1E", "PRD", "DOA-ALTER", "DTRAE", "AMBDP", "RDOPD", "PRDP", "PRDG", "DOAP",
    "DOASD", "SLM", "SLMLTE", "AURR", "REC-MSD", "DEMO23", "EVP", "EVP2", "RDOEVP", "PHME", "SP1", "PRXY", "KSP", "GSC", "SLC", "P"]), {
    main: ["AMB1E", "DOA-1ST", "FTC", "PRD"],
    extraBoosters: ["AMBDP", "DOA-ALTER", "DOAP", "DTRAE", "PRDG", "PRDP", "RDOPD"],
    decks: ["AURR", "DEMO23", "DOASD", "REC-MSD", "SLM", "SLMLTE"],
    promos: ["EVP", "EVP2", "GSC", "KSP", "P", "PHME", "PRXY", "RDOEVP", "SLC", "SP1"]
  });
  // Cardfight!! Vanguard (Bushiroad, cinco eras): os Booster Sets de todas
  // elas são os principais; extras, decks e promos pelo código, com ou sem o
  // prefixo da era.
  assert.deepEqual(secoesBandai("vanguard", ["BT01", "G-BT14", "DZ-BT16", "EB12", "V-SS10", "DZ-TBP01", "D-VS06", "TD17", "G-LD03", "D-TTD03", "DZ-PS03", "PR", "D-PR", "V-GM", "EVENT", "KA1-2"]), {
    main: ["BT01", "DZ-BT16", "G-BT14"], extraBoosters: ["D-VS06", "DZ-TBP01", "EB12", "V-SS10"],
    decks: ["D-TTD03", "DZ-PS03", "G-LD03", "TD17"], promos: ["D-PR", "EVENT", "KA1-2", "PR", "V-GM"]
  });
  // Duel Masters (Takara Tomy): as expansões numeradas de cada fase são as
  // principais (DM, DMR, DMRP, DMnn-RPn, com a 2ª edição e o desempate);
  // extras, decks e promos pelo código do produto.
  assert.deepEqual(secoesBandai("duelmasters", ["DM-01", "DMR-16KIWAMI", "DMRP-04-RP04M", "DM26-RP3", "DM23-RP2X", "DMX-01", "DMEX-19", "DM26-EX5", "DMART-26", "DMC-68", "DMD-35", "DMBD-22", "DM25-SP2", "DM26-SD1", "SPDECK13", "COROCOROY19", "PROMOY25", "SI"]), {
    main: ["DM-01", "DM23-RP2X", "DM26-RP3", "DMR-16KIWAMI", "DMRP-04-RP04M"], extraBoosters: ["DM26-EX5", "DMART-26", "DMEX-19", "DMX-01"],
    decks: ["COROCOROY19", "DM25-SP2", "DM26-SD1", "DMBD-22", "DMC-68", "DMD-35", "SPDECK13"], promos: ["PROMOY25", "SI"]
  });
});

// Cartão sem chip na Bandai (2026-11-12): pre-release, release event e torneio
// de aniversário viram set próprio na seção "Cartas de evento", pelo NOME (o
// setId não segue padrão, e o release event do Digimon BT-26 tem o mesmo
// "BT-26" do booster); o resto que estava no cartão vai pela regra do código.
test("Bandai moderno: cartas de evento saem do cartão e vão pra seção própria", () => {
  const raizes = aninhaPorNome([
    set("The Time of Battle", "2026-06-12", { setId: "OP16" }),
    set("The Time of Battle Release Event Cards", "2026-06-05", { setId: "OP16 RE" }),
    set("Carrying On His Will", "2025-11-07", { setId: "OP13" }),
    set("Carrying On His Will: 3rd Anniversary Tournament Cards", "2025-10-31", { setId: "OP13 ANN" }),
    set("ST-01: Starter Deck 1 Straw Hat Crew", "2022-12-02", { setId: "ST-01" }),
    set("ST-01: Starter Deck 1 Straw Hat Crew (Super Pre-Release Edition)", "2022-09-30", { setId: "ST-01 PRE" }),
    set("Promotion Cards", "2022-12-02", { setId: "OP-PR" })
  ]);
  assert.ok(raizes.some((r) => r.filhos.length), "o aninhaPorNome segue pondo o evento no cartão (os outros jogos usam)");
  const itens = bandai()("onepiece", raizes);
  const secoes = {};
  let atual = null;
  for (const item of itens) {
    if (item.type === "category-head") secoes[atual = item.key.replace("sets.category.", "")] = [];
    else { secoes[atual].push(item.setId); assert.deepEqual(item.filhos, [], `${item.setId} ficou com chip`); }
  }
  assert.deepEqual(secoes, { main: ["OP16", "OP13"], decks: ["ST-01"], events: ["OP16 RE", "OP13 ANN", "ST-01 PRE"], promos: ["OP-PR"] });
  // Digimon: o release event do BT-26 tem o setId do booster e ainda assim é evento.
  const dg = bandai()("digimon", aninhaPorNome([
    set("Timeless Bonds", "2026-09-04", { setId: "BT-26" }),
    set("Timeless Bonds Release Event Cards", "2026-08-28", { setId: "BT-26" })
  ]));
  assert.deepEqual(dg.map((x) => x.key || x.name), ["sets.category.main", "Timeless Bonds", "sets.category.events", "Timeless Bonds Release Event Cards"]);
  // Fusion World: os Alternate Art Reprints saem do cartão e vão pelo código (promos).
  const fw = bandai()("dbfw", aninhaPorNome([
    set("Awakened Pulse", "2024-02-23", { setId: "FB01" }),
    set("Awakened Pulse Alternate Art Reprints", "2024-05-10", { setId: "FB01_AR" }),
    set("Tournament and Championship Promos", "2024-02-16", { setId: "DBSFW_TPR" })
  ]));
  assert.deepEqual(fw.map((x) => x.key || x.setId), ["sets.category.main", "FB01", "sets.category.promos", "FB01_AR", "DBSFW_TPR"]);
  // Edição (2nd Edition do Palworld) segue no `edicoes` do set, pro seletor da página dele.
  const pw = bandai()("palworld", aninhaPorNome([
    set("BP01: Dawn of Palpagos", "2026-07-30", { setId: "EBP01" }),
    set("BP01: Dawn of Palpagos (2nd Edition)", "2026-07-30", { setId: "EBP01-2E" })
  ]));
  assert.deepEqual(pw.map((x) => x.key || x.setId), ["sets.category.main", "EBP01"]);
  assert.deepEqual(pw[1].edicoes.map((e) => e.setId), ["EBP01-2E"]);
});

test("Bandai moderno: as seções saem na ordem do One Piece e decks/eventos/promos ficam fora do destaque", () => {
  const ordem = [...corpo("groupBandaiSets").matchAll(/"(sets\.category\.\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ["sets.category.main", "sets.category.extraBoosters", "sets.category.decks", "sets.category.events", "sets.category.promos"]);
  const fora = constante("SECOES_FORA_DO_DESTAQUE");
  assert.ok(fora.includes('"sets.category.decks"') && fora.includes('"sets.category.promos"') && fora.includes('"sets.category.events"'));
  assert.ok(!fora.includes("extraBoosters"), "booster extra é lançamento e disputa o destaque");
  const agrupa = corpo("agrupaSetsDoJogo");
  assert.ok(agrupa.includes("SECOES_BANDAI[jogoAtual]"));
  assert.ok(agrupa.indexOf("if (lineDef)") < agrupa.indexOf("SECOES_BANDAI[jogoAtual]"), "linha vintage de jogo da Bandai (One Piece 2002) segue em ordem de lançamento");
});
