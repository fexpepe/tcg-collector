// NARUTO Kayou, edição em inglês (jogo narutokayou, 2026-11-12): a leitura do
// payload do Next.js das páginas de série do site oficial, o id a partir do
// código impresso (com a série e a paralela), a data e o catálogo versionado.
// Sem rede: fixture no formato da página.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERIES, rscDe, objetoEm, detalheDaPagina, limpa, dataDe, dataDaSerie, slugDoCodigo, cartasDaSerie } from "../scripts/sync-narutokayou.mjs";

const catalogo = () => {
  const s = readFileSync(new URL("../data/narutokayou/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

const DETALHE = {
  id: "series-5zdty4vj", title: "Series 1", seriesTypeName: "Heaven Scroll",
  editions: [
    { productSpecs: [{ label: "Model", value: "NR-X" }, { label: "Release Date", value: "November 2025" }] },
    { productSpecs: [{ label: "Release Date", value: "September 2025" }] },
    { productSpecs: [{ label: "Release Date", value: "TBA" }] }
  ],
  cards: [
    { name: "The Demon in the Snow\n5/5", rarity: "R", image: "https://static-sg.kayouofficial.com/overseas/website/2026/06/15/aaa-1029-733.png", idCode: "NRSA01-R-050L1", sortOrder: 3 },
    { name: "Sasuke Uchiha", rarity: "SE", image: "https://static-sg.kayouofficial.com/overseas/website/2026/06/15/bbb-733-1029.png", idCode: "NRSA01-SE-001L5", sortOrder: 1 },
    { name: "Naruto Uzumaki", rarity: "&#x25C7;UR", image: "https://static-sg.kayouofficial.com/x/ccc.png", idCode: "NRSA01-&#x25C7;UR-001L5", sortOrder: 2 },
    { name: "Sem código", rarity: "R", image: "", idCode: "", sortOrder: 4 }
  ]
};
// A página como o Next.js a serve: o JSON vem em pedaços de string, dentro de
// chamadas self.__next_f.push, e o "detail" atravessa mais de um pedaço.
const paginaCom = (detalhe) => {
  const txt = `1:["$","div",null,{"detail":${JSON.stringify(detalhe)},"outro":{"a":"}"}}]`;
  const meio = Math.floor(txt.length / 2);
  const pedaco = (s) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<html><body>${pedaco(txt.slice(0, meio))}<script>self.__next_f.push([0])</script>${pedaco(txt.slice(meio))}</body></html>`;
};

test("payload do Next.js: junta os pedaços e acha o detail, com chave e aspas dentro de string", () => {
  const html = paginaCom(DETALHE);
  assert.ok(rscDe(html).includes('"detail":{'));
  assert.deepEqual(detalheDaPagina(html), DETALHE);
  assert.deepEqual(objetoEm('x "a":{"t":"} \\" {","n":{"k":1}} resto', '"a":{'), { t: '} " {', n: { k: 1 } });
  assert.equal(objetoEm("nada aqui", '"detail":{'), null);
  assert.equal(detalheDaPagina("<html>sem payload</html>"), null);
  assert.equal(detalheDaPagina(""), null);
});

test("texto do site: quebra de linha vira espaço e a entidade do losango vira ◇", () => {
  assert.equal(limpa("The Demon in the Snow\n5/5"), "The Demon in the Snow 5/5");
  assert.equal(limpa("&#x25C7;UR"), "◇UR");
  assert.equal(limpa(null), "");
});

test("data: mês e ano da fonte, a mais antiga entre as caixas; o resto fica vazio", () => {
  assert.equal(dataDe("September 2025"), "2025-09");
  assert.equal(dataDe("TBA"), "");
  assert.equal(dataDe(""), "");
  assert.equal(dataDaSerie(DETALHE), "2025-09");
  assert.equal(dataDaSerie({ editions: [] }), "");
});

test("código impresso -> pedaço do id: minúsculas, só ASCII, paralela no fim", () => {
  assert.equal(slugDoCodigo("NRSA01-SE-001L5"), "nrsa01-se-001l5");
  assert.equal(slugDoCodigo("NRSA03-◇UR-001L5"), "nrsa03-ur-001l5-par");
  assert.equal(slugDoCodigo("NRCCNA-&#x25C7;XR-007"), "nrccna-xr-007-par");
  assert.equal(slugDoCodigo("NRSA-01-UR-003L4"), "nrsa-01-ur-003l4");
  assert.equal(slugDoCodigo(""), "");
  // A paralela e a comum do mesmo número não dividem id.
  assert.notEqual(slugDoCodigo("NREA02-◇UR-001L3"), slugDoCodigo("NREA02-UR-001L3"));
});

test("cartasDaSerie: ordem do site, id com a série, sigla de raridade e carta sem código de fora", () => {
  const { cards, semCodigo } = cartasDaSerie(DETALHE, "hs1");
  assert.equal(semCodigo, 1);
  assert.deepEqual(cards.map((c) => c.id), ["nky-hs1-nrsa01-se-001l5", "nky-hs1-nrsa01-ur-001l5-par", "nky-hs1-nrsa01-r-050l1"]);
  const [se, par, cena] = cards;
  assert.equal(se.set, "Heaven Scroll Series 1");
  assert.equal(se.setId, "nky-hs1");
  assert.equal(se.number, "NRSA01-SE-001L5");
  assert.equal(se.rarity, "SE");
  assert.equal(se.setTotal, 3);
  assert.equal(se.setReleaseDate, "2025-09");
  assert.equal(se.language, "en");
  assert.equal(se.image, "https://wsrv.nl/?url=static-sg.kayouofficial.com%2Foverseas%2Fwebsite%2F2026%2F06%2F15%2Fbbb-733-1029.png&w=440&output=webp");
  assert.equal(par.number, "NRSA01-◇UR-001L5");
  assert.equal(par.rarity, "◇UR");
  assert.equal(cena.name, "The Demon in the Snow 5/5");
  // Código repetido dentro da série: o segundo ganha -2.
  const rep = cartasDaSerie({ ...DETALHE, cards: [DETALHE.cards[1], { ...DETALHE.cards[1], sortOrder: 9 }] }, "hs1").cards;
  assert.deepEqual(rep.map((c) => c.id), ["nky-hs1-nrsa01-se-001l5", "nky-hs1-nrsa01-se-001l5-2"]);
  // A mesma carta em outra série tem outro id (o site repete código entre séries).
  assert.equal(cartasDaSerie(DETALHE, "es3").cards[0].id, "nky-es3-nrsa01-se-001l5");
});

test("SERIES: id de página e chave únicos", () => {
  assert.equal(new Set(SERIES.map((s) => s.id)).size, SERIES.length);
  assert.equal(new Set(SERIES.map((s) => s.key)).size, SERIES.length);
  for (const s of SERIES) { assert.match(s.id, /^series-[a-z0-9]{8}$/); assert.match(s.key, /^[a-z0-9]+$/); }
});

test("catálogo versionado: ids únicos e em ASCII, só as séries pinadas, tudo com imagem", () => {
  const cards = catalogo();
  assert.ok(cards.length >= 1188, `${cards.length} cartas`);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, "id repetido");
  const setIds = new Set(SERIES.map((s) => `nky-${s.key}`));
  for (const c of cards) {
    assert.match(c.id, /^nky-[a-z0-9]+-[a-z0-9-]+$/, c.id);
    assert.ok(setIds.has(c.setId), `${c.id}: set ${c.setId} fora do SERIES`);
    assert.ok(c.id.startsWith(c.setId + "-"), `${c.id} sem a série no id`);
    assert.ok(c.image.startsWith("https://wsrv.nl/?url=static-sg.kayouofficial.com"), `${c.id} sem imagem`);
    assert.ok(c.name && c.number && c.rarity, `${c.id}: nome, código ou raridade vazios`);
    assert.match(c.setReleaseDate, /^\d{4}-\d{2}$/, `${c.id}: data ${c.setReleaseDate}`);
    // Paralela: o losango fica no número e na raridade, e o id leva -par.
    assert.equal(/-par(-\d+)?$/.test(c.id), c.number.includes("◇"), c.id);
  }
});
