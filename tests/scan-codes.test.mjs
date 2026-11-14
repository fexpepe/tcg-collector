// Extração de código de carta do texto que o OCR devolve (src/scan.js). É a
// função que decide o que vai pra busca — se ela perde um "OP05-119" ou inventa
// um "4/102" a partir de uma data, o scanner "não acha" ou acha a carta errada,
// e a pessoa não tem como saber que o problema é a regex e não a foto.
//
// Os textos de entrada imitam o que o Tesseract devolve de verdade: caixa alta
// (whitelist), lixo em volta, quebras de linha e as confusões clássicas (O por
// 0, I por 1) em posições numéricas.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, "..", "src", "scan.js"), "utf8"), sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const codigos = (txt) => Array.from(S.extrairCodigos(txt));

test("One Piece: código com hífen no rodapé, com lixo em volta", () => {
  assert.deepEqual(codigos("©2023 EIICHIRO ODA\nOP05-119 SR  L"), ["OP05-119"]);
  assert.deepEqual(codigos("EB01-001 C")[0], "EB01-001");
});

test("Digimon, Gundam, DBFW e Yu-Gi-Oh seguem o mesmo molde", () => {
  assert.equal(codigos("BT1-001 R")[0], "BT1-001");
  assert.equal(codigos("ST01-001")[0], "ST01-001");
  assert.equal(codigos("EXB-001 RR")[0], "EXB-001");
  assert.equal(codigos("FB01-001")[0], "FB01-001");
  assert.equal(codigos("LOB-EN001 1ST EDITION")[0], "LOB-EN001");
});

test("DBFW Manga Booster (SB01-001) é formato de jogo e crava o DBFW", () => {
  // O copyright do DBFW vem na vertical e o OCR não lê: o formato é a única
  // pista. Antes o SB01 valia peso 1 e a leitura ia até a carta inteira.
  assert.equal(codigos("SAIYAN SB01-042 SCR")[0], "SB01-042");
  const d = S.detectarJogo("SB01-042", ["SB01-042"], "hub");
  assert.equal(d.jogos[0], "dbfw");
  assert.equal(d.confiante, true);
  // Os sets "SB" do Yu-Gi-Oh (SBAD-EN001) seguem Yu-Gi-Oh.
  assert.equal(S.detectarJogo("SBAD-EN001", ["SBAD-EN001"], "hub").jogos[0], "ygo");
});

test("confusão de OCR na parte numérica é corrigida; no prefixo a letra fica", () => {
  // "OP" é prefixo (letras); "O5" e "II9" são numéricos: O->0, I->1.
  assert.equal(codigos("OPO5-II9")[0], "OP05-119");
  assert.equal(codigos("BTI-OOI")[0], "BT1-001");
  // Fração: "4/1O2" -> 4/102.
  assert.equal(codigos("4/1O2")[0], "4/102");
  assert.deepEqual(codigos("OO9/O94"), ["009/094", "9/94"]);
});

test("Pokémon e Lorcana: fração N/T como impressa PRIMEIRO, sem zeros depois", () => {
  // O catálogo guarda "009/094" (moderno) e "4/102" (antigo); a borda casa
  // palavra por prefixo, então "9" não acha "009" — o bug da Nymble no celular.
  assert.deepEqual(codigos("ILLUS. YUKO MORI  009/094"), ["009/094", "9/94"]);
  assert.deepEqual(codigos("ILLUS. MITSUHIRO ARITA  4/102"), ["4/102"]);
  assert.equal(codigos("123/198")[0], "123/198");
});

test("Lorcana: número/total · idioma · set vira 'set número' antes da fração", () => {
  const c = codigos("12/204 · EN · 4");
  assert.equal(c[0], "4 12");
  assert.ok(c.includes("12/204"));
  assert.ok(!c.includes("012/204"));
});

test("Magic moderno: número e 'SET • IDIOMA' viram 'SET NÚMERO'", () => {
  const c = codigos("0123/0281 R\nMH3 • EN\n™ & © 2024 WIZARDS OF THE COAST");
  assert.equal(c[0], "MH3 123");
});

test("Union Arena e FAB", () => {
  assert.equal(codigos("UE21BT/RLY-1-082")[0], "UE21BT/RLY-1-082");
  assert.equal(codigos("WTR001 - C")[0], "WTR001");
});

test("o mais específico vem primeiro; sem código não inventa nada", () => {
  // Um código com hífen vale mais que uma fração solta no mesmo texto.
  const c = codigos("OP01-001 12/24");
  assert.equal(c[0], "OP01-001");
  assert.deepEqual(codigos(""), []);
  assert.deepEqual(codigos("PIKACHU HP 60"), []);
  // Fração com total zero é lixo (não existe set de 0 cartas).
  assert.deepEqual(codigos("3/0"), []);
});

test("candidatos não se repetem e têm teto", () => {
  const c = codigos("OP01-001 OP01-001 OP01-002 OP01-003 OP01-004 OP01-005 OP01-006 OP01-007");
  assert.equal(new Set(c).size, c.length);
  assert.ok(c.length <= 6);
});

// ── Detecção do JOGO ──────────────────────────────────────────────────────────
// O bug que motivou isto: uma carta de Pokémon ("4/102") voltava Lorcana (set
// "4") e Magic (número 4), porque a busca cruzava os 13 jogos e a ordenação
// só olhava o número.
const detecta = (txt, codigos, sessao) => {
  const d = S.detectarJogo(txt, codigos, sessao);
  return { top: d.jogos[0], confiante: d.confiante, restritos: Array.from(d.restritos) };
};

test("Pokémon: o rodapé impresso decide, mesmo com fração ambígua", () => {
  const d = detecta("ILLUS. MITSUHIRO ARITA 4/102 1999 NINTENDO CREATURES GAME FREAK", ["4/102"]);
  assert.equal(d.top, "pokemon");
  assert.equal(d.confiante, true);
  // Os cinco jogos que numeram em fração (SWU e Harry Potter entraram em 2026-11-10).
  // (O Duel Masters, "53/110", entrou em 2026-11-13.)
  assert.deepEqual(d.restritos, ["pokemon", "duelmasters", "harrypotter", "lorcana", "narutomythos", "riftbound", "swu"]);
});

test("Magic e Lorcana pelo copyright; One Piece pelo autor", () => {
  assert.equal(detecta("0123/0281 R MH3 EN TM AND 2024 WIZARDS OF THE COAST", ["MH3 123"]).top, "magic");
  assert.equal(detecta("12/204 EN 4 DISNEY", ["4 12", "12/204"]).top, "lorcana");
  assert.equal(detecta("2023 EIICHIRO ODA SHUEISHA OP05-119", ["OP05-119"]).top, "onepiece");
});

test("só o formato do código: restringe aos jogos possíveis sem cravar", () => {
  const d = detecta("OP05-119 SR", ["OP05-119"]);
  assert.equal(d.top, "onepiece");
  assert.deepEqual(d.restritos, ["onepiece"]);
  const frac = detecta("4/102", ["4/102"]);
  assert.equal(frac.confiante, false);
  assert.deepEqual(frac.restritos, ["duelmasters", "harrypotter", "lorcana", "narutomythos", "pokemon", "riftbound", "swu"]);
  assert.equal(detecta("LOB-EN001 1ST EDITION", ["LOB-EN001"]).top, "ygo");
  assert.equal(detecta("BT1-001 R", ["BT1-001"]).top, "digimon");
});

test("o jogo da sessão desempata, mas não vence uma pista impressa", () => {
  const d = detecta("4/102", ["4/102"], "pokemon");
  assert.equal(d.top, "pokemon");
  assert.equal(d.confiante, false); // 3 pontos por formato+sessão, mas Lorcana tem 2: não é "certeza"
  assert.equal(detecta("DISNEY 12/204", ["12/204"], "pokemon").top, "lorcana");
});

test("sem pista nenhuma, ninguém é restringido", () => {
  const d = detecta("", []);
  assert.deepEqual(d.restritos, []);
  assert.equal(d.confiante, false);
});

// ── Ranqueamento: peso do formato, não posição no texto ──────────────────────
// O bug que motivou isto: o One Piece imprime o copyright em JAPONÊS à
// esquerda do código, na mesma linha; o modelo inglês transcreve aquilo como
// lixo ("E-12", "3/7"), e na ordem do texto o lixo ia pra busca ANTES do
// "OP05-119" — a borda casava qualquer coisa por prefixo e vinha carta errada.
test("One Piece: lixo do copyright em japonês não passa na frente do código", () => {
  const c = codigos("OBE/EEA-FYT E-12 3/7 SHUEISHA OP05-119 SR");
  assert.equal(c[0], "OP05-119");
  // Fração de total minúsculo e hífen de uma letra ficam no fim, se ficarem.
  assert.ok(c.indexOf("3/7") === -1 || c.indexOf("3/7") > c.indexOf("OP05-119"));
  assert.ok(c.indexOf("E-12") === -1 || c.indexOf("E-12") > c.indexOf("OP05-119"));
  // Fração plausível continua valendo (Pokémon: "4/102" com lixo antes).
  assert.equal(codigos("ABC-12 4/102")[0], "4/102");
});

test("raridade grudada no número e 'O' inicial lido como zero", () => {
  assert.equal(codigos("OP05-119SR")[0], "OP05-119");
  assert.equal(codigos("OP01-001L")[0], "OP01-001");
  assert.equal(codigos("EB01-001C")[0], "EB01-001");
  assert.equal(codigos("OP05-119SEC")[0], "OP05-119");
  assert.equal(codigos("0P05-119")[0], "OP05-119");
  // Yu-Gi-Oh continua com o idioma; "II9" ainda vira 119.
  assert.equal(codigos("LOB-EN001")[0], "LOB-EN001");
  assert.equal(codigos("OP05-II9")[0], "OP05-119");
});

test("confiança das palavras desempata; leituras repetidas votam", () => {
  const texto = "OP05-113 OP05-119";
  const palavras = [{ ini: 0, fim: 8, conf: 61 }, { ini: 9, fim: 17, conf: 88 }];
  const c = S.extrair(texto, palavras);
  assert.equal(c[0].codigo, "OP05-119");
  assert.equal(c[0].conf, 88);
  assert.equal(c[1].codigo, "OP05-113");
  // Sem palavras a confiança é 0 e vale a ordem do texto.
  assert.equal(S.extrair(texto)[0].codigo, "OP05-113");
  // Duas leituras: quem aparece nas duas vence, mesmo com confiança menor.
  const j = S.juntar([S.extrair("OP05-113", [{ ini: 0, fim: 8, conf: 90 }]), S.extrair("OP05-119 OP05-113")]);
  assert.equal(j[0].codigo, "OP05-113");
  assert.equal(j[0].votos, 2);
  assert.equal(j[1].codigo, "OP05-119");
});

test("formato de um jogo só dá certeza; formato de vários, não", () => {
  // Carta do One Piece em inglês: copyright em japonês, nenhuma palavra bate.
  const d = detecta("OBE/EEA-FYT OP05-119 SR", ["OP05-119"]);
  assert.equal(d.top, "onepiece");
  assert.equal(d.confiante, true);
  assert.equal(detecta("LOB-EN001", ["LOB-EN001"]).confiante, true);
  assert.equal(detecta("ST01-001", ["ST01-001"]).confiante, false);
  // Palavra impressa de OUTRO jogo empata com o formato: sem certeza.
  assert.equal(detecta("DISNEY OP05-119", ["OP05-119"]).confiante, false);
});

test("Magic: número separado do set pelo artista, com zero à esquerda ou confusão de OCR", () => {
  // O Hobbit: "0042 R" e o artista na mesma linha, "HOB • EN" na de baixo.
  assert.equal(codigos("0042 R JOSU SOLANO\nHOB • EN TM 2026 WIZARDS OF THE COAST")[0], "HOB 42");
  // Último dígito lido como letra: "004Z" -> 42, e não "HOB 4".
  assert.equal(codigos("004Z R\nHOB • EN")[0], "HOB 42");
  assert.equal(codigos("OO42 R HOB EN")[0], "HOB 42");
  // Número logo antes continua valendo e vem na frente do solto.
  assert.equal(codigos("0042/0321 R HOB EN")[0], "HOB 42");
  // Poder/resistência ("3/3") e ano não viram número de carta.
  assert.ok(!codigos("3/3 HOB EN 2026").some((c) => /^HOB /.test(c)));
});

// ── One Piece, Gundam e Lorcana medidos com as imagens oficiais (2026-09-29) ──
// Os textos abaixo são o que o Tesseract devolveu DE VERDADE pros rodapés e
// cantos dessas cartas. Com eles o scanner acertava 3 de 8 no One Piece e 1 de
// 7 no Gundam, contra 4 de 4 no Magic.
test("Gundam: o G lido como 6/S/C e o D como zero voltam a ser 'GD'", () => {
  assert.equal(codigos("6001-110")[0], "GD01-110");
  assert.equal(codigos("SS | 6001-075")[0], "GD01-075");
  assert.equal(codigos("G001-001 | B")[0], "GD01-001");
  assert.equal(codigos("FE 4 | SL | S002-030 858")[0], "GD02-030");
  // Número de modelo no nome da unidade não vira código do Gundam.
  assert.ok(!codigos("MS-05L").some((c) => /^GD/.test(c)));
});

test("One Piece: 'O' inicial e zero do set perdidos, raridade grudada, zero engolido", () => {
  assert.equal(codigos("NMI | W H C | P01-016")[0], "OP01-016");
  assert.equal(codigos("NM | LIFE | JU | E B | P3-040")[0], "OP03-040");
  assert.equal(codigos("OP3-040")[0], "OP03-040");
  assert.equal(codigos("S/K P | OP07-05163")[0], "OP07-051");
  assert.equal(codigos("ECK | LIFE | K P | ST10-00308")[0], "ST10-003");
  assert.equal(codigos("OP9-00463")[0], "OP09-004");
  assert.equal(codigos("EB01-0129")[0], "EB01-012");
  assert.equal(codigos("A TWO | W H C | OP11-80")[0], "OP11-080");
  // Sem prefixo de jogo, número comprido continua não sendo código; e a
  // promo "P-001" (sem dígito no prefixo) fica como é.
  assert.deepEqual(codigos("AB-12345"), []);
  assert.equal(codigos("P-001")[0], "P-001");
  // Digimon numera o starter antigo com 2 dígitos: não ganha zero.
  assert.equal(codigos("ST1-01")[0], "ST1-01");
});

test("onde o código foi lido é pista do jogo: topo é Gundam, rodapé não", () => {
  const topo = S.detectarJogo("", ["ST01-005"], "hub", { "ST01-005": "topo" });
  assert.equal(topo.jogos[0], "gundam");
  assert.equal(topo.confiante, true);
  const base = S.detectarJogo("", ["ST10-003"], "hub", { "ST10-003": "base" });
  assert.ok(!base.restritos.includes("gundam"));
  // O Story Booster do DBFW também é "ST01-001" (2026-11-10).
  assert.deepEqual(Array.from(base.restritos).sort(), ["dbfw", "digimon", "onepiece"]);
  // Sem origem: os quatro.
  assert.equal(S.detectarJogo("", ["ST01-001"], "hub").restritos.length, 4);
});

// ── Formatos que o catálogo ganhou depois do scanner (2026-11-10) ───────────
// Medido no catálogo: 89 % do Weiss e 48 % do Union Arena não viravam
// candidato, e SWU/Harry Potter/DBFW Story Booster iam pra busca filtrados pro
// jogo errado. tests/scan-cobertura.test.mjs trava a taxa por jogo; aqui ficam
// os casos de borda de cada padrão.
test("Weiss: título/lado-número, com a raridade paralela grudada", () => {
  assert.deepEqual(codigos("SAO/S20-E001 RR"), ["SAO/S20-E001"]);
  // "E001S" é OUTRA carta: sai como lido e, depois, sem o sufixo.
  assert.deepEqual(codigos("MM/W17-E001S SR"), ["MM/W17-E001S", "MM/W17-E001"]);
  assert.equal(codigos("FT/SE10-E46")[0], "FT/SE10-E46");
  assert.equal(codigos("CCS/WX01-001")[0], "CCS/WX01-001");
  assert.equal(codigos("DG/EN-S03-E001")[0], "DG/EN-S03-E001");
  assert.equal(codigos("KLK/S27-TE19S")[0], "KLK/S27-TE19S");
  // O/I/L no lugar de dígito; S continua letra.
  assert.equal(codigos("SAO/SIOO-EOO4S")[0], "SAO/S100-E004S");
  // O miolo não vira carta de Yu-Gi-Oh ("W91-TE001").
  const d = S.detectarJogo("", codigos("HOL/W91-TE001"), "hub");
  assert.deepEqual(Array.from(d.restritos), ["weiss"]);
  assert.equal(d.confiante, true);
});

test("Palworld: E + set, número e a raridade paralela grudada (2026-11-11)", () => {
  assert.deepEqual(codigos("<RR> EBP01-002  II ©PALWORLD"), ["EBP01-002"]);
  // "EBP01-001OSR" é OUTRA carta: sai como lido e, depois, sem o sufixo.
  assert.deepEqual(codigos("<OSR> EBP01-001OSR"), ["EBP01-001OSR", "EBP01-001"]);
  assert.deepEqual(codigos("<TSR> ETD01-023TSR"), ["ETD01-023TSR", "ETD01-023"]);
  assert.deepEqual(codigos("<PR> EPR-002S"), ["EPR-002S", "EPR-002"]);
  assert.deepEqual(codigos("<PR> ESOUL-011"), ["ESOUL-011"]);
  // O/I no lugar de dígito; o sufixo continua letra.
  assert.equal(codigos("EBPO1-0O1SSP")[0], "EBP01-001SSP");
  // ETD/ESS/ESOUL só existem no Palworld.
  assert.deepEqual(Array.from(S.detectarJogo("", ["ETD01-023TSR"], "hub").restritos), ["palworld"]);
  assert.deepEqual(Array.from(S.detectarJogo("", ["ESOUL-011"], "hub").restritos), ["palworld"]);
});

test("Palworld e Godzilla imprimem o mesmo EBP01-001: a pista impressa decide", () => {
  // Sem pista, os dois (como o ST01-001 dos quatro jogos da Bandai).
  const sem = S.detectarJogo("EBP01-002", ["EBP01-002"], "hub");
  assert.deepEqual(Array.from(sem.restritos).sort(), ["godzilla", "palworld"]);
  assert.equal(sem.confiante, false);
  const pal = S.detectarJogo("<RR> EBP01-002 ©PALWORLD", ["EBP01-002"], "hub");
  assert.equal(pal.jogos[0], "palworld");
  assert.equal(pal.confiante, true);
  const gzc = S.detectarJogo("TM & © TOHO EBP01-002", ["EBP01-002"], "hub");
  assert.equal(gzc.jogos[0], "godzilla");
  assert.equal(gzc.confiante, true);
  // O índice de sets tem EBP01 nos dois (o setId do Palworld é o código
  // impresso): nenhum dos dois é cortado por ele.
  const indice = new Map([["ebp01", ["godzilla", "palworld"]]]);
  assert.deepEqual(Array.from(S.detectarJogo("EBP01-002", ["EBP01-002"], "hub", {}, indice).restritos).sort(), ["godzilla", "palworld"]);
});

test("Naruto Kayou: o código inteiro, de três trechos, e só dele (2026-11-12)", () => {
  assert.deepEqual(codigos("NRSA01-SE-001L5"), ["NRSA01-SE-001L5"]);
  assert.deepEqual(codigos("KAYOU  NREA02-UR-001L3"), ["NREA02-UR-001L3"]);
  // Série com hífen e a caixa de colecionador, que não imprime o nível.
  assert.deepEqual(codigos("NRSA-01-UR-003L4"), ["NRSA-01-UR-003L4"]);
  assert.deepEqual(codigos("NRCCNA-SP-011"), ["NRCCNA-SP-011"]);
  assert.deepEqual(Array.from(S.detectarJogo("", ["NRSA01-SE-001L5"], "hub").restritos), ["narutokayou"]);
  assert.equal(S.detectarJogo("NRSA01-SE-001L5", ["NRSA01-SE-001L5"], "hub").confiante, true);
  // "NR" sozinho não é a Kayou: precisa da série, da sigla e do número.
  assert.equal(Array.from(S.detectarJogo("", ["NR-001"], "hub").restritos).includes("narutokayou"), false);
});

test("Naruto Mythos TCG: a fração é de seis jogos, e o rodapé diz qual (2026-11-12)", () => {
  assert.deepEqual(codigos("C 3/130  1° EDITION NARUTO MYTHOS TCG"), ["3/130"]);
  const sem = S.detectarJogo("3/130", ["3/130"], "hub");
  assert.ok(sem.restritos.includes("narutomythos"));
  assert.ok(sem.restritos.includes("pokemon"));
  assert.equal(sem.confiante, false);
  // Com o rodapé, o Mythos passa na frente do vintage e do jogo de 2027, que
  // também têm "NARUTO" de pista.
  const com = S.detectarJogo("C 3/130  1° EDITION NARUTO MYTHOS TCG", ["3/130"], "hub");
  assert.equal(com.jogos[0], "narutomythos");
  assert.equal(com.confiante, true);
  // A Legendary abrevia: "0001/2000  1° ED. N. M. TCG".
  assert.equal(S.detectarJogo("Legendary 0001/2000 1° ED. N. M. TCG", ["0001/2000"], "hub").jogos[0], "narutomythos");
  // Uma carta do vintage ou do jogo de 2027 não vira Mythos.
  assert.equal(S.detectarJogo("©2002 MASASHI KISHIMOTO NARUTO CP-001", ["CP-001"], "hub").restritos.includes("narutomythos"), false);
});

test("Naruto Boruto Card Game: o NB02-48 e o BORUTO do rodapé tiram a carta do Naruto vintage (2026-11-13)", () => {
  assert.deepEqual(codigos("NB02-48-EB"), ["NB02-48"]);
  // Só o código: o formato é de um jogo só.
  assert.deepEqual(Array.from(S.detectarJogo("", ["NB02-48"], "hub").restritos), ["narutoboruto"]);
  // Com o rodapé inteiro, o KISHIMOTO bate no vintage e no jogo de 2027, mas
  // o jogo certo passa na frente.
  const d = S.detectarJogo("©2002 MASASHI KISHIMOTO / 2017 BORUTO All Rights Reserved. NOT FOR SALE NB02-48-EB", ["NB02-48"], "hub");
  assert.equal(d.jogos[0], "narutoboruto");
  assert.equal(d.confiante, true);
  // A carta do vintage e a do jogo de 2027 não viram Naruto Boruto.
  assert.equal(S.detectarJogo("©2002 MASASHI KISHIMOTO NARUTO CP-001", ["CP-001"], "hub").restritos.includes("narutoboruto"), false);
});

test("Union Arena: promo, extra, título com dígito, AP e paralela", () => {
  assert.deepEqual(codigos("UEPR/AOT-1-023"), ["UEPR/AOT-1-023"]);
  assert.deepEqual(codigos("UEX01BT/BLC-1-036 U"), ["UEX01BT/BLC-1-036"]);
  assert.deepEqual(codigos("UE12BT/KJ8-1-001"), ["UE12BT/KJ8-1-001"]);
  assert.deepEqual(codigos("UE01ST/BLC-1-AP01"), ["UE01ST/BLC-1-AP01"]);
  assert.deepEqual(codigos("UEPR/AOT-AP01"), ["UEPR/AOT-AP01"]);
  // O "-P-001" não vira a promo "P-001" do Digimon/One Piece.
  assert.deepEqual(codigos("UE02BT/HTR-P-001"), ["UE02BT/HTR-P-001"]);
  assert.deepEqual(Array.from(S.detectarJogo("", ["UE02BT/HTR-P-001"], "hub").restritos), ["unionarena"]);
  // Dígito do set lido como letra.
  assert.equal(codigos("UEO1BT/CGH-1-O82")[0], "UE01BT/CGH-1-082");
});

test("Star Wars Unlimited: o número vem DEPOIS de set e idioma", () => {
  assert.equal(codigos("AARON DHANDA  LFL FFG  JTL EN C 760")[0], "JTL 760");
  assert.equal(codigos("SOR EN 010/252")[0], "SOR 10");
  const d = S.detectarJogo("LFL FFG JTL EN C 760", ["JTL 760"], "hub");
  assert.equal(d.jogos[0], "swu");
  assert.equal(d.confiante, true);
  // O artista depois do set não vira número (LIZ -> 112), nem o ano.
  assert.deepEqual(codigos("0042 R\nHOB EN LIZ DANFORTH"), ["HOB 42"]);
  assert.ok(!codigos("MH3 EN TM 2024 WIZARDS").some((c) => /2024/.test(c)));
  // Número na OUTRA linha não é o do set.
  assert.ok(!codigos("MH3 EN\n77 ALGUMA COISA").includes("MH3 77"));
});

test("Riftbound: set, fração e idioma; arte alternativa com letra", () => {
  const c = codigos("RAD 137/167 EN  JUNHUAN 2026RGI");
  assert.equal(c[0], "RAD 137");
  assert.ok(c.includes("137/167"));
  assert.equal(S.detectarJogo("RAD 137/167 EN JUNHUAN 2026RGI", c, "hub").jogos[0], "riftbound");
  assert.deepEqual(codigos("263A/298").slice(0, 2), ["263A/298", "263/298"]);
});

test("FAB History Pack, DBFW Story Booster e fração de SWU/Harry Potter", () => {
  assert.equal(codigos("1HP001")[0], "1HP001");
  assert.equal(S.detectarJogo("", ["1HP001"], "hub").jogos[0], "fab");
  assert.ok(S.detectarJogo("", ["ST01-001"], "hub", { "ST01-001": "base" }).restritos.includes("dbfw"));
  const fr = S.detectarJogo("", ["10/116"], "hub").restritos;
  assert.ok(fr.includes("harrypotter") && fr.includes("swu"));
  // "Wizards" está no Harry Potter de 2001; as duas pistas dele vencem.
  assert.equal(S.detectarJogo("HARRY POTTER WARNER BROS 2001 WIZARDS", ["10/116"], "hub").jogos[0], "harrypotter");
});
