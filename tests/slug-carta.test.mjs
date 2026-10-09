// Nome da carta no endereço (functions/_lib/slug-carta.js, 2026-09-30). O
// build escreve os links da página do set com ele e a borda acha a carta
// recalculando: os dois TÊM que chegar no mesmo nome. O que se trava aqui:
//   - a régua (nome, número impresso, idioma) nos formatos de cada jogo;
//   - o empate (-2, -3) sai na ordem do id, não na ordem de leitura: o build
//     lê os chunks numa ordem e a borda em outra;
//   - numa página de set de verdade (chunks do repositório), todo nome é
//     único e válido de endereço;
//   - o slugify é o mesmo de antes (os slugs de set não podem mudar).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { slugify, baseDoSlug, slugsDasCartas, cartasDoSet, cartaParecida } from "../functions/_lib/slug-carta.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test("slugify: acento sai, pontuação vira hífen, nada nas pontas", () => {
  assert.equal(slugify("Pokémon GO"), "pokemon-go");
  assert.equal(slugify("Flabébé"), "flabebe");
  assert.equal(slugify("Sword & Shield—Base"), "sword-shield-base");
  assert.equal(slugify("  ~x~  "), "x");
  assert.equal(slugify("ロケット団の栄光"), "");
  assert.equal(slugify(null), "");
});

test("número: total junto quando é só dígito, como impresso quando tem letra", () => {
  assert.equal(baseDoSlug({ name: "Charizard", number: "4", setTotal: 102 }), "charizard-4-102");
  assert.equal(baseDoSlug({ name: "Nymble", number: "009", setTotal: 94 }), "nymble-009-094");
  assert.equal(baseDoSlug({ name: "Marshall.D.Teach", number: "OP16-119", setTotal: 154 }), "marshall-d-teach-op16-119");
  assert.equal(baseDoSlug({ name: "Pikachu", number: "4/102" }), "pikachu-4-102");
  assert.equal(baseDoSlug({ name: "Lightning Bolt", number: "161" }), "lightning-bolt-161");
  assert.equal(baseDoSlug({ name: "Sem Número" }), "sem-numero");
});

test("idioma: nada pro inglês, sufixo pros outros (jp, não ja; zh pros dois chineses)", () => {
  assert.equal(baseDoSlug({ name: "Pikachu", number: "25", setTotal: 165, language: "en" }), "pikachu-25-165");
  assert.equal(baseDoSlug({ name: "Pikachu", number: "25", setTotal: 165, language: "pt" }), "pikachu-25-165-pt");
  assert.equal(baseDoSlug({ name: "Pikachu", number: "25", language: "zh-tw", pokemonName: "Pikachu" }), "pikachu-25-zh");
});

test("nome em japonês/chinês usa o nome em inglês do catálogo", () => {
  assert.equal(baseDoSlug({ name: "ニンフィア", nameEn: "Sylveon", number: "009", setTotal: 94, language: "ja" }), "sylveon-009-094-jp");
  assert.equal(baseDoSlug({ name: "ブラッキーex", pokemonName: "Umbreon", number: "217", language: "ja" }), "umbreon-217-jp");
  // Sem nome em inglês, sobra o que o slugify salvar; sem nada, "card".
  assert.equal(baseDoSlug({ name: "ブラッキーex", number: "", language: "ja" }), "ex-jp");
  assert.equal(baseDoSlug({ name: "無", number: "" }), "card");
});

test("empate: -2, -3 na ordem do id, qualquer que seja a ordem de leitura", () => {
  const cartas = [
    { id: "op-3", name: "Luffy", number: "OP01-001" },
    { id: "op-1", name: "Luffy", number: "OP01-001" },
    { id: "op-2", name: "Luffy", number: "OP01-001" }
  ];
  const esperado = [["op-1", "luffy-op01-001"], ["op-2", "luffy-op01-001-2"], ["op-3", "luffy-op01-001-3"]];
  assert.deepEqual([...slugsDasCartas(cartas)].sort(), esperado);
  assert.deepEqual([...slugsDasCartas([...cartas].reverse())].sort(), esperado);
  // A mesma impressão lida duas vezes não gasta um -2.
  assert.equal(slugsDasCartas([...cartas, cartas[1]]).size, 3);
});

// Endereço que deixou de existir: o total do set cresceu (Secret Lair, set em
// pré-venda), o nome da carta mudou, o desempate andou. A borda manda pro
// endereço de hoje em vez do 404 (functions/games/).
test("carta parecida: total que mudou, nome que mudou, desempate e idioma", () => {
  const cartas = [
    { id: "sld-1", name: "Snow-Covered Plains", number: "1", setTotal: 2822, language: "en" },
    { id: "sld-2", name: "Snow-Covered Island", number: "2", setTotal: 2822, language: "en" },
    { id: "rb-178", name: "K'Sante, Courageous (Overnumbered)", number: "178", setTotal: 167, language: "en" },
    { id: "op-1", name: "Luffy", number: "OP01-001" },
    { id: "op-2", name: "Luffy", number: "OP01-001" },
    { id: "pt-67", name: "Toxel", number: "067", setTotal: 94, language: "pt" },
    { id: "zh-91a", name: "ピカチュウ", number: "091", setTotal: 98, language: "zh-cn" },
    { id: "zh-91b", name: "ピカチュウ", number: "091", setTotal: 98, language: "zh-cn", nameEn: "Pikachu" }
  ];
  const slugs = slugsDasCartas(cartas);
  const acha = (pedido) => cartaParecida(cartas, slugs, pedido);
  // O total do set mudou (ou o endereço vinha sem ele).
  assert.equal(acha("snow-covered-plains-1-2821"), "snow-covered-plains-1-2822");
  assert.equal(acha("snow-covered-island-2-2774"), "snow-covered-island-2-2822");
  assert.equal(acha("snow-covered-plains-1"), "snow-covered-plains-1-2822");
  // O nome mudou: o número e o total dizem qual é.
  assert.equal(acha("k-sante-courageous-showcase-178-167"), "k-sante-courageous-overnumbered-178-167");
  // Arte paralela com o mesmo nome e número: o -2 do pedido escolhe a 2ª.
  assert.equal(acha("luffy-op01-001-3"), "luffy-op01-001");
  assert.equal(acha("monkey-d-luffy-op01-001-2"), "luffy-op01-001-2");
  // Idioma é parte da carta: a portuguesa não vira a inglesa nem o contrário.
  assert.equal(acha("toxel-067-095-pt"), "toxel-067-094-pt");
  assert.equal(acha("toxel-067-094"), null);
  // Carta chinesa que ganhou nome em inglês: o -2 do endereço sem nome acha a 2ª.
  assert.equal(acha("091-098-zh-2"), "pikachu-091-098-zh");
  // Número que não existe, número parecido e endereço vazio: nada.
  assert.equal(acha("snow-covered-plains-3-2821"), null);
  assert.equal(acha("snow-covered-plains-11-2822"), null);
  assert.equal(acha("raichu-14-102"), null);
  assert.equal(acha(""), null);
  assert.equal(cartaParecida(cartas, null, "snow-covered-plains-1-2821"), null);
});

test("a página do set é a das cartas com aquele nome, fora as aposentadas", () => {
  const cartas = [
    { id: "a", set: "151" }, { id: "b", set: "151", retired: true }, { id: "c", set: "Outro" }, null
  ];
  assert.deepEqual(cartasDoSet(cartas, "151").map((c) => c.id), ["a"]);
});

// Chunks reais do repositório (Pokémon: versionados). 151 junta o inglês e o
// português pelo nome, que é exatamente o caso de dois idiomas na mesma página.
test("página de set de verdade: todo nome é único e válido de endereço", () => {
  const arquivos = ["data/sets/en/sv03.5.json", "data/sets/pt/sv03.5.json", "data/sets/en/base1.json"];
  for (const grupo of [["data/sets/en/sv03.5.json", "data/sets/pt/sv03.5.json"], ["data/sets/en/base1.json"]]) {
    if (!grupo.every((a) => existsSync(join(raiz, a)))) continue;
    const todas = grupo.flatMap((a) => JSON.parse(readFileSync(join(raiz, a), "utf8")));
    const nome = todas[0].set;
    const cartas = cartasDoSet(todas, nome);
    const slugs = slugsDasCartas(cartas);
    assert.equal(slugs.size, cartas.length, `${nome}: carta sem nome`);
    const nomes = [...slugs.values()];
    assert.equal(new Set(nomes).size, nomes.length, `${nome}: nome repetido`);
    for (const s of nomes) assert.match(s, SLUG, `${nome}: ${s}`);
  }
  assert.ok(arquivos.some((a) => existsSync(join(raiz, a))), "nenhum chunk de exemplo no repositório");
});
