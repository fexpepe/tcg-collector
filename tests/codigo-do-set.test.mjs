// Código oficial do set (scripts/lib/codigo-do-set.mjs): o selo na linha da
// data no cartão da tela de Sets (pedido de 2026-11-12). Trava a GRAFIA — a
// da PSA, sem hífen, mesmo onde a caixa da Bandai usa (OP-01 na caixa, OP01
// na PSA e no número da carta) — e a regra de ouro: grupo de promo, vintage e
// id inventado ficam SEM código.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codigoDoSet, prefixoDominante, jogoDoDiretorio } from "../scripts/lib/codigo-do-set.mjs";

const set = (id, name = "", language = "en") => ({ id, name, language });
const cartas = (...numeros) => numeros.map((number) => ({ number }));
const cod = (jogo, id, name, cs, language) => codigoDoSet(jogo, set(id, name, language), cs || []);

test("One Piece: grafia da PSA (OP01), mesmo com o setId do TCGplayer em OP-xx", () => {
  assert.equal(cod("onepiece", "OP17"), "OP17");
  assert.equal(cod("onepiece", "OP01"), "OP01");
  assert.equal(cod("onepiece", "ST-31"), "ST31");
  assert.equal(cod("onepiece", "EB-05"), "EB05");
  assert.equal(cod("onepiece", "PRB-02"), "PRB02");
  assert.equal(cod("onepiece", "PEB-01"), "PEB01");
  // Grupo de evento fica com o código do set pai; o combinado do TCGplayer, com o primeiro.
  assert.equal(cod("onepiece", "OP17 RE"), "OP17");
  assert.equal(cod("onepiece", "OP09 ANN"), "OP09");
  assert.equal(cod("onepiece", "ST-04 PRE"), "ST04");
  assert.equal(cod("onepiece", "OP15-EB04"), "OP15");
  // Sem código: promos, demo, revision pack e o Carddass de 1999–2002.
  for (const id of ["OP-PR", "OP-DD", "OP-RP", "SD01", "LT-01", "op2002-promos", "op2002-road-to-the-pirate-king", "opcd-first-stage"]) {
    assert.equal(cod("onepiece", id), "", id);
  }
});

test("Gundam, Fusion World e Union Arena: sem hífen", () => {
  assert.equal(cod("gundam", "GD05"), "GD05");
  assert.equal(cod("gundam", "ST14"), "ST14");
  assert.equal(cod("gundam", "EB01"), "EB01");
  for (const id of ["GD01_b", "GCG-PR", "RP", "EXRP", "EXBP"]) assert.equal(cod("gundam", id), "", id);
  assert.equal(cod("dbfw", "FB11"), "FB11");
  assert.equal(cod("dbfw", "FS12"), "FS12");
  assert.equal(cod("dbfw", "FB11_PR"), "FB11");
  assert.equal(cod("dbfw", "ST01"), "ST01"); // Story Booster 01, "[ST01]" no site oficial
  for (const id of ["DBSFW_PR", "DBSFW_TPR", "DBSFW_EM"]) assert.equal(cod("dbfw", id), "", id);
  assert.equal(cod("unionarena", "UEX08BT"), "UEX08BT");
  assert.equal(cod("unionarena", "UE24ST"), "UE24ST");
  assert.equal(cod("unionarena", "UE01BT_RE"), "UE01BT");
  assert.equal(cod("unionarena", "UEPR"), "");
});

test("Digimon: o TCGplayer mistura BT27 e BT-26; sai tudo igual, sem hífen", () => {
  assert.equal(cod("digimon", "BT27"), "BT27");
  assert.equal(cod("digimon", "BT-26"), "BT26");
  assert.equal(cod("digimon", "EX-13"), "EX13");
  assert.equal(cod("digimon", "BD02"), "BD02");
  assert.equal(cod("digimon", "BT-25_PR"), "BT25");
  // Starter antigo tem UM dígito (ST-1 na caixa), o novo dois (ST-10).
  assert.equal(cod("digimon", "ST-1"), "ST1");
  assert.equal(cod("digimon", "ST-25"), "ST25");
  for (const id of ["RPC", "DEMO", "D-PR", "BT01-03A", "BT18-19"]) assert.equal(cod("digimon", id), "", id);
});

test("Godzilla e Palworld: código da edição inglesa, sem promo", () => {
  assert.equal(cod("godzilla", "EBP04"), "EBP04");
  assert.equal(cod("godzilla", "ESD01"), "ESD01");
  assert.equal(cod("godzilla", "EPR"), "");
  assert.equal(cod("palworld", "EBP01-2E"), "EBP01");
  assert.equal(cod("palworld", "ETD02"), "ETD02");
  assert.equal(cod("palworld", "PC"), "");
});

test("DBS Masters: o código impresso na carta, sem as promos", () => {
  assert.equal(cod("dbs", "DBS-B10", "", cartas("BT10-001", "BT10-002", "BT10-003")), "BT10");
  assert.equal(cod("dbs", "DBS-B01", "", cartas("BT1-001", "BT1-002")), "BT1");
  assert.equal(cod("dbs", "DBS-TB01", "", cartas("TB1-001", "TB1-002")), "TB1");
  assert.equal(cod("dbs", "DB1", "", cartas("DB1-001", "DB1-002")), "DB1");
  // Pre-Release: o código do set pai.
  assert.equal(cod("dbs", "DBS-B12PRE", "", cartas("BT12-001", "BT12-002")), "BT12");
  // Expansion Set e promos ficam sem.
  assert.equal(cod("dbs", "DBS-BE21", "", cartas("EX21-01", "EX21-02")), "");
  assert.equal(cod("dbs", "PR", "", cartas("P-001", "P-002")), "");
});

test("hololive: o código oficial do produto, sem as promos", () => {
  assert.equal(cod("hololive", "HBP01"), "HBP01");
  assert.equal(cod("hololive", "HEB01"), "HEB01");
  assert.equal(cod("hololive", "HSD12"), "HSD12");
  assert.equal(cod("hololive", "HYS01"), "HYS01");
  assert.equal(cod("hololive", "HPR"), "");
});

test("Pokémon: TCGdex no inglês/português (só SV e ME), setId no japonês", () => {
  const comCodigo = (c, serie = "sv") => [{ number: "001", setCode: c, setSerieId: serie }];
  assert.equal(codigoDoSet("pokemon", set("sv03.5"), comCodigo("MEW")), "MEW");
  assert.equal(codigoDoSet("pokemon", set("me02", "", "pt"), comCodigo("PFL", "me")), "PFL");
  assert.equal(codigoDoSet("pokemon", set("me06"), comCodigo("DLR", "me")), "DLR");
  // Antes do SV a carta não imprime código: o da TCGdex é o do jogo online.
  assert.equal(codigoDoSet("pokemon", set("xy12"), comCodigo("EVO", "xy")), "");
  assert.equal(codigoDoSet("pokemon", set("swsh3"), comCodigo("DAA", "swsh")), "");
  // Set EN sem código na TCGdex (importado da TCGCSV): sem selo.
  assert.equal(codigoDoSet("pokemon", set("delta-reign"), cartas("001")), "");
  for (const id of ["SV2a", "M1L", "S12a", "SM11b", "SV-P", "S-P"]) {
    assert.equal(codigoDoSet("pokemon", set(id, "", "ja"), cartas("001")), id, id);
  }
  // Id que a TCGdex inventou pros antigos/starters: sem.
  for (const id of ["neo1", "PMCG1", "web1", "sB", "smA", "XY11-Bb", "BW8a", "CP6"]) {
    assert.equal(codigoDoSet("pokemon", set(id, "", "ja"), cartas("001")), "", id);
  }
});

test("códigos que vêm do NÚMERO impresso: Yu-Gi-Oh!, Weiß, Flesh and Blood", () => {
  // Yu-Gi-Oh!: setId numérico do TCGplayer, código certo no número.
  assert.equal(cod("ygo", "1338", "GX Tag Force Evolution Promo", cartas("GX05-EN001", "GX05-EN002", "GX05-EN003")), "GX05");
  assert.equal(cod("ygo", "LC04", "Legendary Collection 4", cartas("LCJW-EN001", "LCJW-EN002", "LCJW-EN003")), "LCJW");
  assert.equal(cod("weiss", "UMA-W119", "", cartas("UMA/W119-E001", "UMA/W119-E002")), "UMA/W119");
  assert.equal(cod("weiss", "BD-WE49", "", cartas("BD/WE49-E01", "BD/WE49-E02")), "BD/WE49");
  assert.equal(cod("fab", "MON", "", cartas("MON001", "MON002")), "MON");
  assert.equal(cod("fab", "1HP", "", cartas("1HP001", "1HP002")), "1HP");
  // Mistura sem maioria (reimpressões de vários sets): sem código.
  assert.equal(cod("ygo", "MISC", "", cartas("LOB-EN001", "MRD-EN002", "SDK-EN003")), "");
});

test("prefixoDominante exige a maioria", () => {
  const re = /^([A-Z0-9]{2,5})-/;
  assert.equal(prefixoDominante(cartas("AB-1", "AB-2", "CD-3"), re), "AB");
  assert.equal(prefixoDominante(cartas("AB-1", "CD-2", "EF-3"), re), "");
  assert.equal(prefixoDominante([], re), "");
});

test("Magic, Star Wars e Riftbound: setId de 3 letras, sem os grupos de promo", () => {
  assert.equal(cod("magic", "dft"), "DFT");
  assert.equal(cod("magic", "2xm"), "2XM");
  assert.equal(cod("swu", "SOR", "Spark of Rebellion"), "SOR");
  assert.equal(cod("swu", "OPP", "Organized Play Promos"), "");
  assert.equal(cod("swu", "JDG", "Judge Promos"), "");
  assert.equal(cod("swu", "GFT", "2025 Gift Box"), "");
  assert.equal(cod("swu", "SOR-WPP", "Spark of Rebellion: Weekly Play Promos"), "");
  assert.equal(cod("riftbound", "OGN", "Origins"), "OGN");
  assert.equal(cod("riftbound", "SGN", "Secret Garden"), "");
  assert.equal(cod("riftbound", "PR", "Promotional Cards"), "");
});

test("Vanguard: o código impresso antes da barra, com o hífen da era", () => {
  for (const id of ["BT01", "EB12", "TD17", "G-BT14", "G-CHB03", "V-EB15", "V-SS10", "D-LBT04", "D-TTD03", "DZ-BT16", "DZ-TBP01", "DZ-PS03"]) {
    assert.equal(cod("vanguard", id), id, id);
  }
  for (const id of ["PR", "VPR", "D-PR", "V-GM", "EVENT", "CLN", "KA1-2"]) assert.equal(cod("vanguard", id), "", id);
});

test("Duel Masters: o código do produto, com o hífen da Takara Tomy", () => {
  for (const id of ["DM-01", "DM-39", "DMR-01", "DMRP-22", "DMX-26", "DMEX-19", "DMC-68", "DMD-35", "DMSD-21", "DMBD-22", "DMART-26", "DM26-RP3", "DM23-RP2X", "DM26-EX5", "DM25-SP2"]) {
    assert.equal(cod("duelmasters", id), id, id);
  }
  for (const id of ["PROMOY5", "SPDECK13", "COROCOROY19", "SI", "GUM1", "DMRP-04-RP04M", "DMR-16KIWAMI", "DMARTKIWAMI-01"]) assert.equal(cod("duelmasters", id), "", id);
});

test("Final Fantasy vira Opus (grafia da PSA), Lorcana vira Set N", () => {
  assert.equal(cod("fftcg", "OP1"), "Opus I");
  assert.equal(cod("fftcg", "OP14"), "Opus XIV");
  assert.equal(cod("fftcg", "OP30"), "Opus XXX");
  for (const id of ["ST30", "BD7", "W24", "PR", "RE", "DEC"]) assert.equal(cod("fftcg", id), "", id);
  assert.equal(cod("lorcana", "1"), "Set 1");
  assert.equal(cod("lorcana", "14"), "Set 14");
  assert.equal(cod("lorcana", "Q3"), "Q3");
  for (const id of ["P1", "D23", "cp", "CC1", "Coconut"]) assert.equal(cod("lorcana", id), "", id);
});

test("vintage e jogos sem código impresso ficam sem selo", () => {
  assert.equal(cod("dbc", "dbc-h18"), "");
  assert.equal(cod("naruto", "nrt-ccg-s28"), "");
  assert.equal(cod("lotr", "lotr-19"), "");
  assert.equal(cod("sorcery", "ALP", "Alpha"), "");
  assert.equal(cod("cyberpunk", "WNC"), "");
  assert.equal(cod("mbc", "mb-db01"), "DB01");
  assert.equal(cod("mbc", "op-mb-op18"), "OP18");
  assert.equal(cod("mbc", "mb-db"), "");
});

test("jogo do diretório segue o registro do game.js (Pokémon é a raiz)", () => {
  assert.equal(jogoDoDiretorio("data/"), "pokemon");
  assert.equal(jogoDoDiretorio("data/onepiece/"), "onepiece");
  assert.equal(jogoDoDiretorio("data/ygo/"), "ygo");
});

test("o enrich-manifest grava o código e o cartão desenha o selo na linha da data", () => {
  const enrich = readFileSync(new URL("../scripts/enrich-manifest.mjs", import.meta.url), "utf8");
  assert.match(enrich, /codigoDoSet\(jogo, entrada, cartas\)/);
  assert.match(enrich, /else delete entrada\.code/);
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /code: entry\.code \|\| ""/);
  // Código ANTES da data, no mesmo contêiner: o CSS põe o primeiro na
  // esquerda e o segundo na direita (space-between).
  assert.match(app, /<span class="sx-badges">\$\{codeBadge\}\$\{releaseBadge\}<\/span>/);
  // A busca compara o código sem pontuação: "op-17" acha o OP17.
  assert.match(app, /semPontuacao\(normalize\(entry\.code\)\)\.includes\(q\)/);
});
