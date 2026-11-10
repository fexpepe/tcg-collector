// ENCAIXE NO CATÁLOGO e a foto como verificador (src/scan.js, 2026-11-10).
// O OCR devolve texto; o catálogo é um vocabulário fechado. Até aqui a ponte
// era só formato + busca: o que tivesse cara de código ia pra borda, que casa
// por prefixo e pelo NOME, e o primeiro resultado virava "a carta". Na bancada
// (139 cartas reais de 13 jogos, foto simulada) isso dava 38 certas e 26
// erradas, 13 delas SEM AVISO: "4/3" achava uma promo do Lorcana, o "71/204"
// de uma carta com "© Disney" achava um Pokémon chinês de set com 204 cartas,
// "YOU 4" achava "If I Didn't Have You". Depois: 49 certas, 8 erradas, todas
// marcadas pra conferir.
//
// O que estes testes travam:
//   - o resultado tem de CASAR com o código (casaCodigo);
//   - o set tem de EXISTIR (índice de sets: filtrarPorIndice, detectarJogo);
//   - o erro de um dígito ou de uma letra do set vira VIZINHO, pra foto decidir;
//   - a decisão pela foto (estadoDaFoto) e a regra de quem entra sem ela;
//   - a miniatura de referência nunca é o palpite do pokemontcg.io fora do
//     Pokémon (o defeito que comparava carta do Lorcana com Pokémon).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(scanSrc, sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const lista = (x) => Array.from(x);

// Um catálogo de mentira com o que os casos precisam: ids repetidos entre
// jogos como no de verdade ("OP05" é set do One Piece e pacote do Yu-Gi-Oh;
// "DIS" é promo do Lorcana e set do Magic).
const indice = S.montarIndice([
  ["onepiece", { sets: [{ id: "OP01" }, { id: "OP05" }, { id: "OP09" }, { id: "ST10" }, { id: "EB01" }] }],
  ["ygo", { sets: [{ id: "LOB" }, { id: "DUAD" }, { id: "OP05" }] }],
  ["magic", { sets: [{ id: "mh3" }, { id: "dmu" }, { id: "dis" }] }],
  ["swu", { sets: [{ id: "JTL" }, { id: "SOR" }] }],
  ["riftbound", { sets: [{ id: "RAD" }] }],
  ["lorcana", { sets: [{ id: "4" }, { id: "12" }, { id: "DIS" }] }],
  ["gundam", { sets: [{ id: "GD01" }, { id: "RP" }, { id: "ST10" }, { id: "EB01" }] }],
  ["dbfw", { sets: [{ id: "FB04" }, { id: "FB05_PR" }] }],
  ["digimon", { sets: [{ id: "BT-04" }, { id: "ST-10" }] }],
  ["weiss", { sets: [{ id: "SAO-S20" }] }],
  ["unionarena", { sets: [{ id: "UE21BT" }] }],
  ["naruto", null] // jogo sem manifest (dev, rede fora): não derruba o índice
]);

test("casaCodigo: o resultado da busca tem de ser a carta do código", () => {
  const carta = (number, setId, extra) => Object.assign({ number, setId }, extra);
  assert.ok(S.casaCodigo("OP05-119", carta("OP05-119", "OP05")));
  assert.ok(!S.casaCodigo("OP05-119", carta("OP05-110", "OP05")));
  // A raridade grudada no número guardado não desfaz o casamento…
  assert.ok(S.casaCodigo("BT1-003", carta("BT1-003 R", "BT-01")));
  assert.ok(S.casaCodigo("P-214", carta("P - 214 P", "D-PR")));
  assert.ok(S.casaCodigo("MM/W17-E001", carta("MM/W17-E001S", "MM-W17")));
  // …mas um dígito a mais é OUTRA carta.
  assert.ok(!S.casaCodigo("OP05-11", carta("OP05-119", "OP05")));
  assert.ok(!S.casaCodigo("BT1-003", carta("BT1-0031", "BT-01")));
  // "SET NÚMERO": o set E o número. "1 11" colado dava "111".
  assert.ok(S.casaCodigo("MH3 123", carta("123", "mh3")));
  assert.ok(S.casaCodigo("4 12", carta("012", "4")));
  assert.ok(!S.casaCodigo("1 11", carta("111", "1")));
  assert.ok(!S.casaCodigo("MH3 123", carta("123", "dmu")));
  // O que a borda acha pelo NOME não casa ("YOU 4" -> "If I Didn't Have You").
  assert.ok(!S.casaCodigo("YOU 4", carta("14", "P4", { name: "If I Didn't Have You" })));
  // Com as escritas da carta (cardCodeForms do shared): a fração impressa.
  const formas = (c) => [c.number, `${c.number}/${c.setTotal}`, `${parseInt(c.number, 10)}/${c.setTotal}`];
  assert.ok(S.casaCodigo("9/94", carta("009", "sv06", { setTotal: 94 }), formas));
  assert.ok(!S.casaCodigo("9/95", carta("009", "sv06", { setTotal: 94 }), formas));
});

test("chaveDoSet: o que vem antes do número, em cada formato", () => {
  assert.equal(S.chaveDoSet("MH3 123"), "mh3");
  assert.equal(S.chaveDoSet("OP05-119"), "op05");
  assert.equal(S.chaveDoSet("LOB-EN001"), "lob");
  assert.equal(S.chaveDoSet("UE21BT/RLY-1-082"), "ue21bt");
  assert.equal(S.chaveDoSet("SAO/S20-E001"), "saos20");
  assert.equal(S.chaveDoSet("DG/EN-S03-E001"), "dgens03");
  // Fração e código colado não têm set.
  assert.equal(S.chaveDoSet("4/102"), "");
  assert.equal(S.chaveDoSet("263A/298"), "");
  assert.equal(S.chaveDoSet("WTR001"), "");
});

test("o índice tira o SET que não existe e dá peso ao que existe", () => {
  const c = (codigo, peso) => ({ codigo, peso });
  const cands = [c("YOU 4", 2), c("OBF 6", 2), c("006/197", 2), c("JTL 760", 2), c("LOB-032", 1), c("XYZ-032", 1), c("OMU 257", 1)];
  const f = S.filtrarPorIndice(cands, indice);
  assert.deepEqual(lista(f.map((x) => x.codigo)), ["006/197", "JTL 760", "LOB-032", "XYZ-032"]);
  // "LOB-032": o Yu-Gi-Oh antigo, sem o "-EN" que o formato conhece. O set
  // existe, então é código — e passa a valer pros vizinhos.
  assert.equal(f.find((x) => x.codigo === "LOB-032").peso, 2);
  assert.equal(f.find((x) => x.codigo === "XYZ-032").peso, 1);
  // Os que saíram ficam pros vizinhos do set (o D de "DMU" lido como O).
  assert.deepEqual(lista(S.orfaosDoIndice(cands, indice).map((x) => x.codigo)), ["YOU 4", "OBF 6", "OMU 257"]);
  // Sem índice (dev, rede fora), nada muda.
  assert.equal(S.filtrarPorIndice(cands, null).length, cands.length);
  assert.equal(S.filtrarPorIndice(cands, S.montarIndice([])).length, cands.length);
  assert.equal(S.orfaosDoIndice(cands, null).length, 0);
});

test("detectarJogo com o índice: o set diz qual dos jogos do formato", () => {
  // "SET NÚMERO" é de qualquer jogo; quem tem o set é quem o índice diz.
  const swu = S.detectarJogo("", ["JTL 760"], "hub", {}, indice);
  assert.deepEqual(lista(swu.restritos), ["swu"]);
  assert.equal(swu.confiante, true);
  const dis = S.detectarJogo("", ["DIS 4"], "hub", {}, indice);
  assert.deepEqual(lista(dis.restritos).sort(), ["lorcana", "magic"]);
  assert.equal(dis.confiante, false);
  // Sem índice, o formato sozinho: os três do "SET NÚMERO".
  assert.equal(S.detectarJogo("", ["JTL 760"], "hub", {}).restritos.length, 3);
  // Starter "ST10-003" lido no rodapé: formato de quatro jogos; o índice
  // tira o DBFW, que não tem set ST10.
  const st = S.detectarJogo("", ["ST10-003"], "hub", { "ST10-003": "base" }, indice);
  assert.deepEqual(lista(st.restritos).sort(), ["digimon", "onepiece"]);
  // "OP05" também é pacote de torneio do Yu-Gi-Oh: o FORMATO manda.
  assert.deepEqual(lista(S.detectarJogo("", ["OP05-119"], "hub", {}, indice).restritos), ["onepiece"]);
  // Código que nenhum formato conhece, mas cujo set existe.
  const lob = S.detectarJogo("", ["LOB-032"], "hub", {}, indice);
  assert.equal(lob.jogos[0], "ygo");
  assert.equal(lob.confiante, true);
});

test("vizinhosDoNumero: um dígito trocado, as confusões do OCR na frente", () => {
  const v = lista(S.vizinhosDoNumero("OP05-010"));
  assert.equal(v.length, 27);
  assert.ok(v.every((c) => /^OP05-\d{3}$/.test(c) && c !== "OP05-010"));
  // O caso da bancada: "OP05-019" lido "OP05-010" (o 9 virou 0).
  assert.ok(v.indexOf("OP05-019") < 8, "o vizinho mais provável tem de estar entre os primeiros");
  assert.ok(v.indexOf("OP05-019") < v.indexOf("OP05-012"));
  // Fração: só o número, nunca o total; a letra da versão fica.
  const f = lista(S.vizinhosDoNumero("76/204"));
  assert.ok(f.includes("16/204") && f.every((c) => /\/204$/.test(c)));
  assert.ok(lista(S.vizinhosDoNumero("263A/298")).includes("268A/298"));
  // "SET NÚMERO", raridade grudada, e código sem dígito nenhum.
  assert.ok(lista(S.vizinhosDoNumero("MH3 123")).includes("MH3 128"));
  assert.ok(lista(S.vizinhosDoNumero("MH3 123")).every((c) => /^MH3 \d{3}$/.test(c)));
  assert.ok(lista(S.vizinhosDoNumero("BT1-003 R")).includes("BT1-008 R"));
  assert.deepEqual(lista(S.vizinhosDoNumero("ABC")), []);
});

test("vizinhosDoSet: uma letra trocada ou o começo engolido", () => {
  const ids = (g) => indice.ids[g];
  assert.deepEqual(lista(S.vizinhosDoSet("OP00-119", ids("onepiece"))).sort(), ["OP01-119", "OP05-119", "OP09-119"]);
  assert.deepEqual(lista(S.vizinhosDoSet("B04-094", ids("dbfw"))), ["FB04-094"]);
  assert.deepEqual(lista(S.vizinhosDoSet("P-063", ids("gundam"))), ["RP-063"]);
  assert.deepEqual(lista(S.vizinhosDoSet("OMU 257", ids("magic"))), ["DMU 257"]);
  // Yu-Gi-Oh: dois caracteres engolidos, com o idioma no meio.
  assert.deepEqual(lista(S.vizinhosDoSet("AD-EN043", ids("ygo"))), ["DUAD-EN043"]);
  // O próprio set não é vizinho de si mesmo, e fração não tem set.
  assert.deepEqual(lista(S.vizinhosDoSet("OP05-119", ["OP05"])), []);
  assert.deepEqual(lista(S.vizinhosDoSet("4/102", ids("onepiece"))), []);
});

test("estadoDaFoto: a foto confirma, deixa em dúvida ou derruba", () => {
  // Confirmou: vale pra qualquer resultado, forte ou não.
  assert.equal(S.estadoDaFoto(0.97, true, 3), "certo");
  assert.equal(S.estadoDaFoto(0.62, false, 0), "certo");
  // Código forte que a foto não confirma fica, pra conferir.
  assert.equal(S.estadoDaFoto(0.5, true, 3), "duvida");
  assert.equal(S.estadoDaFoto(0.5, true, 2), "duvida");
  // Bem abaixo: só o formato de jogo fica; fração e "SET NÚMERO" são o que
  // o lixo do OCR mais imita ("10/41" lido do texto da carta).
  assert.equal(S.estadoDaFoto(0.2, true, 3), "duvida");
  assert.equal(S.estadoDaFoto(0.2, true, 2), "negado");
  // Resultado fraco (não casa com o código, ou peso 0) só entra confirmado.
  assert.equal(S.estadoDaFoto(0.5, false, 2), "negado");
  // Sem imagem nenhuma: o formato de jogo vale a busca, como sempre valeu;
  // fração e "SET NÚMERO" ficam em dúvida ("249/288" casando com uma promo
  // japonesa sem miniatura entrava calado).
  assert.equal(S.estadoDaFoto(null, true, 3), "semfoto");
  assert.equal(S.estadoDaFoto(null, true, 2), "duvida");
  assert.equal(S.estadoDaFoto(null, false, 2), "negado");
});

test("set travado: as palavras do texto que são número de carta do set", () => {
  const cartas = [
    { id: "a", number: "60" }, { id: "b", number: "6" }, { id: "c", number: "C01" },
    { id: "d", number: "015" }, { id: "e", number: "M19" }
  ];
  // Dragon Ball Z imprime só o número; em volta, ataque, ano e lixo.
  assert.deepEqual(lista(S.cartasPelasPalavras(cartas, "POWER 9000\n1999 BIRD STUDIO 60")).map((c) => c.id), ["a"]);
  // Com letra (mais específica) vem antes do número solto, na ordem do
  // texto; zero à esquerda não importa.
  assert.deepEqual(lista(S.cartasPelasPalavras(cartas, "15 M19 C01")).map((c) => c.id), ["e", "c", "d"]);
  assert.deepEqual(lista(S.cartasPelasPalavras(cartas, "NADA AQUI")), []);
  assert.deepEqual(lista(S.cartasPelasPalavras(cartas, "")), []);
});

test("a busca da leitura passa TODA tentativa pela foto, na ordem certa", () => {
  // A miniatura de referência nunca é o palpite do pokemontcg.io fora do
  // Pokémon: ele carrega com CORS aberto e é a imagem de OUTRA carta.
  assert.match(scanSrc, /const pokemon = \(game \|\| card\.game \|\| "pokemon"\) === "pokemon";/);
  assert.match(scanSrc, /fallback: pokemon \? src\.fallback : ""/);
  assert.match(scanSrc, /function assinaturaDaCarta\(h, ate\) \{\s*const urls = urlsDaCarta\(h\.card, h\.game\);/);
  // Com o jogo impresso na carta, resultado de OUTRO jogo só entra confirmado.
  assert.match(scanSrc, /const exigeFoto = \(k\) => k > 0 && deteccao\.confiante && !selJogo\.value;/);
  assert.match(scanSrc, /if \(r\.estado === "negado" \|\| exigeFoto\(k\)\) \{ negou = true; continue; \}/);
  // O que entra pela foto (vizinho, número solto, palavra do set) exige a
  // confirmação — nunca "em dúvida".
  // — nunca "em dúvida" —, com régua mais alta e folga sobre a segunda
  // colocada: a foto escolhe entre cartas que ninguém leu.
  assert.match(scanSrc, /if \(i < 0 \|\| sims\[i\] < FOTO_CONFIRMA \+ FOLGA_REPARO\) return null;/);
  assert.match(scanSrc, /if \(sims\[i\] - rival < MARGEM_REPARO\) return null;/);
  // Um teto de tempo pra todas as comparações de uma leitura.
  assert.match(scanSrc, /const ate = Date\.now\(\) \+ ORCAMENTO_FOTO;/);
  // A leitura em dúvida vai marcada pra lista e não conta pra sugestão de trava.
  assert.match(scanSrc, /itemAtual = somarItem\(achados\[0\], 1, !!duvida \|\| /);
  assert.match(scanSrc, /if \(!trava && achados\.length && !duvida\) \{/);
});
