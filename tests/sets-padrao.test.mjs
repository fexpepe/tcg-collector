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

const sortByReleaseDesc = (a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || a.name.localeCompare(b.name);
const sortByReleaseAsc = (a, b) => -sortByReleaseDesc(a, b);
const aninhaPorNome = new Function("sortByReleaseDesc",
  `${constante("VOLUME_SEGUINTE")}\n${corpo("aninhaPorNome")}\nreturn aninhaPorNome;`)(sortByReleaseDesc);
const set = (name, releaseDate, extra = {}) => Object.assign({ type: "set", name, displayName: name, releaseDate }, extra);

test("a página de Sets tem UM caminho: aninha, agrupa pelo jogo e põe a Vitrine", () => {
  const vista = corpo("getViewItems");
  const sets = vista.slice(vista.indexOf('if (view === "sets")'), vista.indexOf('if (view === "artists")'));
  assert.ok(sets.includes("const grupos = agrupaSetsDoJogo(aninhaPorNome(setItems));"));
  assert.ok(sets.includes("vitrineDoTopo(grupos).concat(grupos)"));
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
  assert.deepEqual(filhos("Dark Crisis"), ["Worldwide English"]);
});

test("aninhaPorNome: o chip sai do nome de exibição quando ele traz o do pai (vintage japonês)", () => {
  const raizes = aninhaPorNome([
    set("Data Carddass — ナルティメットフォーメーション", "2008-01-01", { displayName: "Narutimate Formation" }),
    set("Data Carddass — ナルティメットフォーメーション 極秘任務", "2008-06-05", { displayName: "Narutimate Formation — Top Secret Mission" })
  ]);
  assert.equal(raizes.length, 1);
  assert.deepEqual(raizes[0].filhos.map((f) => f.rotulo), ["Top Secret Mission"]);
});

function vitrine(grupos, hoje) {
  const fn = new Function("sortByReleaseDesc", "sortByReleaseAsc", "colecaoTem", "Date",
    `${constante("NAO_DESTAQUE")}\n${corpo("vitrineDoTopo")}\nreturn vitrineDoTopo;`);
  const RealDate = Date;
  class Fixa extends RealDate { constructor(...a) { super(...(a.length ? a : [hoje])); } static parse(s) { return RealDate.parse(s); } }
  return fn(sortByReleaseDesc, sortByReleaseAsc, () => 0, Fixa)(grupos);
}

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

test("o topo da Vitrine não conta como resultado", () => {
  assert.ok(corpo("render").includes("sx-hero|sx-continue"));
});

// Bandai moderno (2026-11-11): One Piece, Gundam, Fusion World, Digimon, Union
// Arena e o NARUTO CARD GAME de 2027 (narutocg) no formato do One Piece, e o
// Godzilla (Bushiroad), que tem a mesma forma. Os códigos são os do
// catálogo daquele dia; o que importa é cada um cair na seção certa, e o
// "ST01" do Fusion World (Story Booster) não virar starter.
function secoesBandai(jogo, setIds) {
  const i = app.indexOf("  const SECOES_BANDAI = {");
  assert.ok(i >= 0, "SECOES_BANDAI existe");
  const regras = app.slice(i, app.indexOf("\n  };\n", i) + 5);
  const fn = new Function("sortByReleaseDesc", "cabecalhoDeSecao",
    `${regras}\n${corpo("groupBandaiSets")}\nreturn (jogo, sets) => groupBandaiSets(sets, SECOES_BANDAI[jogo]);`)(
    sortByReleaseDesc, (key, count) => ({ type: "category-head", key, count }));
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
});

test("Bandai moderno: as seções saem na ordem do One Piece e decks/promos ficam fora do destaque", () => {
  const ordem = [...corpo("groupBandaiSets").matchAll(/"(sets\.category\.\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ["sets.category.main", "sets.category.extraBoosters", "sets.category.decks", "sets.category.promos"]);
  const fora = constante("SECOES_FORA_DO_DESTAQUE");
  assert.ok(fora.includes('"sets.category.decks"') && fora.includes('"sets.category.promos"'));
  assert.ok(!fora.includes("extraBoosters"), "booster extra é lançamento e disputa o destaque");
  const agrupa = corpo("agrupaSetsDoJogo");
  assert.ok(agrupa.includes("SECOES_BANDAI[jogoAtual]"));
  assert.ok(agrupa.indexOf("if (lineDef)") < agrupa.indexOf("SECOES_BANDAI[jogoAtual]"), "linha vintage de jogo da Bandai (One Piece 2002) segue em ordem de lançamento");
});
