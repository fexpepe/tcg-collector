// O nome de cada carta no endereço é calculado em DOIS lugares (2026-10-01):
// na borda (functions/_lib/slug-carta.js), que acha a carta pelo endereço, e
// no detail.js, que troca a barra pro endereço da carta quando o popup abre.
// O detail.js é script clássico e não importa módulo, então leva uma cópia
// (entre // <slug-carta> e // </slug-carta>). Se as duas divergirem, o
// endereço que o app mostra, e que a pessoa compartilha, dá 404 na borda —
// sem erro nenhum em lugar nenhum. Este teste roda as duas nas mesmas cartas.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { slugsDasCartas, baseDoSlug, slugify } from "../functions/_lib/slug-carta.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function copiaDoCliente() {
  const fonte = readFileSync(join(raiz, "src/detail.js"), "utf8").replace(/\r\n/g, "\n");
  const i = fonte.indexOf("// <slug-carta>");
  const j = fonte.indexOf("// </slug-carta>");
  assert.ok(i > 0 && j > i, "o bloco <slug-carta> sumiu do detail.js");
  const sandbox = {};
  vm.createContext(sandbox);
  return vm.runInContext(`(function () {\n${fonte.slice(i, j)}\nreturn { slugsDasCartas, baseDoSlug, slugify };\n})()`, sandbox);
}
const cliente = copiaDoCliente();
// O Map do cliente nasce no contexto do vm (outro Array.prototype): compara
// os pares copiados pra cá.
const pares = (mapa) => Array.from(mapa, ([id, slug]) => [String(id), String(slug)]);
const igual = (cartas, rotulo) => {
  assert.deepEqual(pares(cliente.slugsDasCartas(cartas)), pares(slugsDasCartas(cartas)), rotulo);
};

test("as mesmas regras nos casos que cada uma trata", () => {
  const cartas = [
    { id: "base1-4", name: "Charizard", number: "4", setTotal: 102, language: "en" },
    { id: "sv3-9", name: "Nymble", number: "009", setTotal: 94, language: "en" },
    { id: "op05-119", name: "Monkey.D.Luffy", number: "OP05-119", setTotal: 154, language: "en" },
    { id: "sv1-1-pt", name: "Pokémon Ação", number: "1", setTotal: "198", language: "pt" },
    // Nome japonês: o nome em inglês que o catálogo guarda (nameEn ou pokemonName).
    { id: "sv8a-1", name: "ブラッキーex", nameEn: "Umbreon ex", number: "1", setTotal: 187, language: "ja" },
    { id: "sv8a-2", name: "ピカチュウ", pokemonName: "Pikachu", number: "2", language: "ja" },
    { id: "cs1-1", name: "皮卡丘", number: "001", setTotal: "100", language: "zh-tw" },
    { id: "ko-1", name: "피카츄", number: "5", language: "ko" },
    // Empate de nome, número e idioma: -2 na ordem do id.
    { id: "op01-001_p1", name: "Roronoa Zoro", number: "OP01-001", language: "en" },
    { id: "op01-001", name: "Roronoa Zoro", number: "OP01-001", language: "en" },
    // Sem nome, sem número, total que não é número.
    { id: "x-0", name: "", number: "", language: "en" },
    { id: "x-1", name: "Energia", number: "12", setTotal: "?", language: "pt" },
    { id: 7, name: "Id numérico", number: "7" }
  ];
  igual(cartas, "slugs das cartas de exemplo");
  for (const c of cartas) assert.equal(cliente.baseDoSlug(c), baseDoSlug(c), `base de ${c.id}`);
  for (const t of ["Pokémon Ação", "  Ç à é ", "A/B & C", "ブラッキー", "Ümlaut—Dash", ""]) {
    assert.equal(cliente.slugify(t), slugify(t), `slugify(${JSON.stringify(t)})`);
  }
});

test("as mesmas contas em 3 mil cartas geradas (nomes, números e idiomas misturados)", () => {
  let semente = 20261001;
  const sorteia = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  const nomes = ["Charizard", "Pikachu ex", "Monkey.D.Luffy", "Pokémon Ação", "ブラッキーex", "皮卡丘", "Café Olé", "Zoro", "Mewtwo-GX", "Nami (Parallel)"];
  const numeros = ["4", "004", "OP01-001", "TG09", "SV-P 001", "", "100", "0", "12a"];
  const totais = [102, "094", "", "?", 165, undefined];
  const idiomas = ["en", "pt", "ja", "zh-cn", "zh-tw", "ko", "fr", "", undefined];
  const cartas = [];
  for (let i = 0; i < 3000; i++) {
    cartas.push({
      id: `s${sorteia(40)}-${sorteia(300)}${sorteia(3) ? "" : "_p1"}`,
      name: nomes[sorteia(nomes.length)],
      nameEn: sorteia(2) ? "English Name" : undefined,
      number: numeros[sorteia(numeros.length)],
      setTotal: totais[sorteia(totais.length)],
      language: idiomas[sorteia(idiomas.length)]
    });
  }
  igual(cartas, "3 mil cartas geradas");
});

// Com os chunks de verdade na máquina (rodando o sync local), confere também
// nos sets do catálogo. No CI os dados não vêm, e o teste só registra isso.
test("nos chunks do catálogo, quando eles estão na máquina", (t) => {
  const pastas = ["en", "pt", "ja", "zh-cn", "zh-tw"].map((l) => join(raiz, "data", "sets", l)).filter(existsSync);
  if (!pastas.length) { t.skip("sem data/sets local"); return; }
  for (const pasta of pastas) {
    // Os primeiros 40 de cada idioma: os nomes em japonês e chinês são o caso
    // que mais divergiria (a troca pelo nome em inglês).
    for (const f of readdirSync(pasta).filter((n) => n.endsWith(".json")).slice(0, 40)) {
      let cartas;
      try { cartas = JSON.parse(readFileSync(join(pasta, f), "utf8")); } catch { continue; }
      if (Array.isArray(cartas)) igual(cartas, `${pasta.slice(-5)}/${f}`);
    }
  }
});
