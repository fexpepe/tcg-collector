// COBERTURA do scanner por jogo (2026-11-10). O scanner lê o CÓDIGO impresso,
// e cada jogo imprime o código de um jeito. Quando um jogo entra no catálogo
// sem o `extrair`/`detectarJogo` do src/scan.js conhecerem o formato dele, nada
// quebra: a carta só "não é achada", ou é achada no jogo errado, e ninguém vê.
// Foi o que a medição de 2026-11-10 mostrou — 89 % do Weiss (31,6 mil cartas)
// e 48 % do Union Arena não viravam candidato, SWU e Harry Potter iam pra busca
// filtrados pra Pokémon/Lorcana/Riftbound, e 11 dos 24 jogos não tinham pista
// nenhuma.
//
// Este teste passa o catálogo VERSIONADO de cada jogo pelo scanner como se o
// OCR lesse perfeito (o texto que a carta imprime, montado do número guardado)
// e cobra duas coisas de cada carta: (1) algum candidato casa com ela e (2) a
// detecção não a filtra pra OUTRO jogo. Cada jogo declara aqui a taxa mínima
// — ou que não tem código legível, com o motivo. JOGO NOVO SEM DECLARAÇÃO
// QUEBRA O TESTE: é o item do checklist 4.2 do docs/CATALOGO.md que o CI
// passa a cobrar.
//
// Não mede o OCR (foto, luz, fonte): mede o que vem DEPOIS dele. A bancada
// com foto simulada fica fora do CI (ver docs/PLANO-SCANNER.md).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(raiz, "src", "scan.js"), "utf8"), sandbox);
  return sandbox.window.TCGScan;
}
const S = load();

// ── O que cada jogo imprime, e quanto o scanner tem de ler ──────────────────
// `min`: fração mínima das cartas que viram candidato certo sem cair no jogo
// errado. Os números são os medidos em 2026-11-10 com ~2 pontos de folga —
// subir é bem-vindo, descer pede explicação no commit.
// `impresso(card)`: o texto do rodapé, quando não é só o número guardado.
// `semCodigo`: jogo cujo código impresso não identifica a carta sem saber o
// set (número solto) ou que nem tem número no catálogo. Esses dependem da
// trava de set e do reconhecimento pela arte.
const pad = (n, w) => String(n).padStart(w, "0");
const JOGOS = {
  onepiece: { min: 0.76, nota: "o resto é o Carddass de 2002 (BA-C01, C111), que entra em semCodigo na prática" },
  // A promo do Digimon está guardada como "P - 196"; a carta imprime "P-196".
  digimon: { min: 0.97, impresso: (c) => String(c.number).replace(/\s*-\s*/, "-") },
  gundam: { min: 0.98, origem: "topo" },
  dbfw: { min: 0.98 },
  unionarena: { min: 0.98 },
  weiss: { min: 0.96 },
  fab: { min: 0.95, nota: "sobram as cartas de duas faces (JDG058 // JDG059)" },
  ygo: { min: 0.88, nota: "sobram as promos de prefixo numérico (2019-EN003)" },
  riftbound: { min: 0.88, impresso: (c) => `${c.setId} ${c.number} EN` },
  swu: { min: 0.88, impresso: (c) => `${c.setId} EN C ${c.number}`, nota: "sobram as fichas (T01 // T03)" },
  lorcana: { min: 0.97, impresso: (c) => `${c.number}/204 EN ${c.setId}` },
  // Só os sets que imprimem a linha "SET • EN" (do Magic 2015 em diante);
  // antes disso a carta não diz de que set é.
  magic: {
    min: 0.9, filtro: (c) => String(c.setReleaseDate || "") >= "2014-07-01" && /^\d+$/.test(String(c.number)),
    impresso: (c) => `${pad(c.number, 4)}/${pad(c.setTotal || 280, 4)} R\n${String(c.setId).toUpperCase()} EN ARTISTA`
  },
  pokemon: { min: 0.87, impresso: (c) => (String(c.number).indexOf("/") >= 0 ? String(c.number) : `${c.number}/${c.setTotal || 100}`), nota: "sobram as subcoleções (RC1, TG05)" },
  harrypotter: { min: 0.96 },
  naruto: { min: 0.79, nota: "o vintage japonês usa kanji no prefixo (作-100), que o modelo inglês não lê" },
  wow: { semCodigo: "o catálogo não guarda o número da carta" },
  sorcery: { semCodigo: "o catálogo não guarda o número da carta" },
  dbz: { semCodigo: "número solto (60), repetido em todo set" },
  lotr: { semCodigo: "número solto (15), repetido em todo set" },
  dbc: { semCodigo: "Carddass: número solto, sem set impresso" },
  cdm: { semCodigo: "Carddass Masters: número solto, sem set impresso" },
  mbc: { semCodigo: "Miracle Battle Carddass: número solto" },
  hxh: { semCodigo: "número curto (C01), repetido entre os sets" },
  cyberpunk: { semCodigo: "número solto (001), repetido em todo set" }
};

// Catálogo versionado de um jogo: cards.js inteiro, ou os chunks por set
// (Pokémon, Magic e Yu-Gi-Oh guardam só os chunks). Amostra de 1 em `passo`.
function catalogo(jogo) {
  const arq = join(raiz, "data", jogo, "cards.js");
  if (jogo !== "pokemon" && existsSync(arq)) {
    const d = { window: {} };
    vm.createContext(d);
    vm.runInContext(readFileSync(arq, "utf8"), d);
    return d.window.TCG_CARDS || [];
  }
  const dir = jogo === "pokemon" ? join(raiz, "data", "sets", "en") : join(raiz, "data", jogo, "sets");
  if (!existsSync(dir)) return [];
  const out = [];
  readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f, i) => {
    if (i % 6) return; // um set em cada seis: são 200-650 arquivos
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    (Array.isArray(j) ? j : j.cards || []).forEach((c) => out.push(c));
  });
  return out;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// O candidato aponta pra ESTA carta? Código inteiro; código sem a raridade
// grudada ("BT1-003" de "BT1-003 R", "E001" de "E001S"); "SET NÚMERO"; fração.
function casa(cand, card) {
  const num = norm(card.number), c = norm(cand);
  if (!c) return false;
  if (c === num) return true;
  if (/[a-z]/.test(c) && c.length >= 4 && num.indexOf(c) === 0 && /^[a-z]*$/.test(num.slice(c.length))) return true;
  const sn = /^(\S+) (\d+)$/.exec(cand);
  if (sn) return norm(sn[1]) === norm(card.setId) && S.numeroDe(card.number) === Number(sn[2]);
  const fr = /^(\d+)[A-D]?\/(\d+)$/.exec(cand);
  return !!fr && S.numeroDe(card.number) === Number(fr[1]);
}
function medir(jogo, cfg) {
  const cartas = catalogo(jogo).filter((c) => c && c.number && (!cfg.filtro || cfg.filtro(c)));
  let ok = 0;
  const falhas = [];
  for (const c of cartas) {
    const texto = cfg.impresso ? cfg.impresso(c) : String(c.number);
    const cands = S.extrair(texto);
    const certo = cands.find((x) => casa(x.codigo, c));
    const origens = {};
    cands.forEach((x) => { origens[x.codigo] = cfg.origem || "base"; });
    const d = S.detectarJogo(texto, cands.map((x) => x.codigo), "hub", origens);
    const jogoOk = !d.restritos.length || d.restritos.includes(jogo);
    if (certo && jogoOk) ok++;
    else if (falhas.length < 5) falhas.push(`${c.number} -> ${cands.map((x) => x.codigo).join(", ") || "nada"}${jogoOk ? "" : ` [${d.restritos.join(",")}]`}`);
  }
  return { n: cartas.length, taxa: cartas.length ? ok / cartas.length : 0, falhas };
}

// Jogos do site, lidos de onde o front os declara (DATA_GAMES do shared.js).
function jogosDoSite() {
  const tx = readFileSync(join(raiz, "src", "shared.js"), "utf8");
  const ini = tx.indexOf("const DATA_GAMES");
  assert.ok(ini > 0, "DATA_GAMES não achado no shared.js");
  const bloco = tx.slice(ini, tx.indexOf("];", ini));
  return Array.from(bloco.matchAll(/game:\s*"([a-z0-9]+)"/g), (m) => m[1]);
}

test("todo jogo do site está declarado: lê o código, ou diz por que não", () => {
  const site = jogosDoSite();
  assert.ok(site.length >= 24, `só ${site.length} jogos lidos do shared.js`);
  const faltam = site.filter((g) => !JOGOS[g]);
  assert.deepEqual(faltam, [], `jogo novo sem declaração no scanner: ${faltam.join(", ")} — ensine o formato em src/scan.js (extrair, FORMATOS, PISTAS) ou declare semCodigo aqui, com o motivo`);
  const sobram = Object.keys(JOGOS).filter((g) => !site.includes(g));
  assert.deepEqual(sobram, [], `declarado aqui e fora do site: ${sobram.join(", ")}`);
});

for (const [jogo, cfg] of Object.entries(JOGOS)) {
  if (cfg.semCodigo) continue;
  test(`${jogo}: o código impresso vira candidato certo (>= ${Math.round(cfg.min * 100)} %)`, () => {
    const r = medir(jogo, cfg);
    assert.ok(r.n > 0, `catálogo de ${jogo} não encontrado no repositório`);
    assert.ok(r.taxa >= cfg.min,
      `${jogo}: ${(r.taxa * 100).toFixed(1)} % de ${r.n} cartas (mínimo ${Math.round(cfg.min * 100)} %). Exemplos que falham:\n  ${r.falhas.join("\n  ")}`);
  });
}

test("jogo sem código legível: nenhum formato de OUTRO jogo o captura", () => {
  // O número solto não pode virar candidato forte de outro jogo — senão a
  // carta de Dragon Ball Z "acha" uma de Pokémon.
  for (const [jogo, cfg] of Object.entries(JOGOS)) {
    if (!cfg.semCodigo) continue;
    const cartas = catalogo(jogo).filter((c) => c && c.number);
    const fortes = cartas.filter((c) => S.extrair(String(c.number)).some((x) => x.peso >= 2));
    assert.ok(fortes.length <= cartas.length * 0.02,
      `${jogo}: ${fortes.length} de ${cartas.length} números viram candidato forte (ex.: ${fortes.slice(0, 3).map((c) => c.number).join(", ")})`);
  }
});
