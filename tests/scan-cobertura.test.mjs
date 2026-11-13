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
// `linhaSemCodigo`: o mesmo, pra uma LINHA dentro de um jogo que tem código
// (o vintage que divide o jogo com o moderno): { prefixo do id, motivo }. As
// cartas dela saem da taxa do jogo e entram na guarda dos sem código. Linha
// nova num jogo derruba a taxa dele — e o teste pede a declaração.
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
  // 0.93 desde 2026-11-11: a amostra passou a ser sorteada pelo nome do
  // arquivo (ver catalogo) e mediu 94,8 %; o catálogo inteiro mede 91,3 %.
  pokemon: { min: 0.93, impresso: (c) => (String(c.number).indexOf("/") >= 0 ? String(c.number) : `${c.number}/${c.setTotal || 100}`), nota: "sobram as subcoleções (RC1, TG05)" },
  harrypotter: { min: 0.96 },
  // O 疾風伝 Card Game (2007–2008, ids "nrt-scg-") imprime o tipo só em kanji
  // (忍伝-037, 術伝-025, 作伝-011): nenhum dos 573 números vira candidato, e a
  // taxa do jogo caía de 81 % pra 75 %. A numeração é única no jogo, então a
  // carta seria achável se o OCR lesse kanji; até lá, depende da arte.
  naruto: {
    min: 0.79, nota: "o vintage japonês usa kanji no prefixo (作-100), que o modelo inglês não lê",
    linhaSemCodigo: { prefixo: "nrt-scg-", motivo: "疾風伝 Card Game: tipo só em kanji (術伝-025), que o OCR inglês não lê" }
  },
  // NARUTO CARD GAME de 2027 (2026-11-11): 100 % das 2 promos (CP-001).
  narutocg: { min: 0.98 },
  // Godzilla Card Game (2026-11-11): o código do set (EBP01-001, ESD01-,
  // ESC01-, EPR-) e as Rage EGZ07. O TCGplayer grava as Rage do Booster Set 1
  // com o tipo na frente ("Rage-EGZ01"), que a carta não imprime.
  godzilla: { min: 0.91, impresso: (c) => String(c.number).replace(/^Rage-/, ""), nota: "sobram as Rage de número curto (E06) e os tokens (EBP02-T01)" },
  // Palworld (2026-11-11): o rodapé é "<OSR> EBP01-001OSR" e "©PALWORLD". As
  // Prototype Cards e o Soul SSS não têm número (ficam fora da conta).
  palworld: { min: 0.98, impresso: (c) => `<${c.rarity || "PR"}> ${c.number}  ©PALWORLD` },
  // Final Fantasy TCG (2026-11-11): 1-001H dos Opus e o número duplo das
  // séries fora do Opus (PR-004/1-027H, Re-001H/12-002H). Mediu 99,2 %.
  fftcg: { min: 0.97, nota: "sobram os números que a fonte grava torto (PR--161/16-058R, PR071/007H)" },
  // Cardfight!! Vanguard (2026-11-13): SET/NÚMERO + EN, com a raridade da
  // paralela antes do número (DZ-BT16/001EN, V-BT02/SP01EN).
  vanguard: { min: 0.95, nota: "sobram os números sem o EN no fim ou com ano (VG-2020/TOYOU, V-PR/0209EN 2022)" },
  // Naruto Mythos TCG (2026-11-12): o rodapé é "C 3/130  1° EDITION NARUTO
  // MYTHOS TCG", com o número sem os zeros da frente.
  narutomythos: { min: 0.93, impresso: (c) => `${String(c.number).replace(/^0+(?=\d)/, "")}  1° EDITION NARUTO MYTHOS TCG`, nota: "sobram as Mission (MSS 05), que não numeram em fração" },
  // Naruto Kayou (2026-11-12): o código inteiro no canto ("NRSA01-SE-001L5").
  // O losango da paralela não é lido: o texto vai sem ele.
  narutokayou: { min: 0.98, impresso: (c) => String(c.number).replace(/◇/g, "") },
  wow: { semCodigo: "o catálogo não guarda o número da carta" },
  sorcery: { semCodigo: "o catálogo não guarda o número da carta" },
  dbz: { semCodigo: "número solto (60), repetido em todo set" },
  lotr: { semCodigo: "número solto (15), repetido em todo set" },
  dbc: { semCodigo: "Carddass: número solto, sem set impresso" },
  dbsb: { semCodigo: "Carddass Super Battle: número solto, sem set impresso" },
  dbva: { semCodigo: "Carddass Visual Adventure: número solto, sem set impresso" },
  dbbw: { semCodigo: "Super Barcode Wars: número solto, sem set impresso" },
  cdm: { semCodigo: "Carddass Masters: número solto, sem set impresso" },
  gcd: { semCodigo: "Gundam Carddass: número solto, sem set impresso" },
  gw: { semCodigo: "Gundam War: número por cor (cada cor tem seu U-1), sem set impresso" },
  // Naruto Boruto Card Game (2026-11-13): o código impresso é "NB02-48-EB"
  // (set, número e tipo). A carta de torneio e a da caixa imprimem o MESMO.
  narutoboruto: { min: 0.98, impresso: (c) => `©2002 MASASHI KISHIMOTO / 2017 BORUTO All Rights Reserved. ©BANDAI NOT FOR SALE ${c.number}` },
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
  readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f) => {
    // Um set em cada seis (são 200-650 arquivos), sorteado pelo NOME do
    // arquivo e não pela posição na pasta (2026-11-11): com a posição, apagar
    // ou criar um chunk qualquer deslizava a janela e trocava a amostra
    // inteira. A aposentadoria das quatro Trainer Galleries em dobro do
    // Pokémon (swsh9.5tg…) derrubou a taxa de 89,4 % pra 86,0 % assim, com o
    // catálogo inteiro SUBINDO de 90,8 % pra 91,3 %.
    if ([...f].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 6) return;
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
  const daLinha = (c) => !!cfg.linhaSemCodigo && String(c.id).indexOf(cfg.linhaSemCodigo.prefixo) === 0;
  const cartas = catalogo(jogo).filter((c) => c && c.number && !daLinha(c) && (!cfg.filtro || cfg.filtro(c)));
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
  // Desde 2026-11-11 é uma lista de slugs (o dataDir sai do slug): o bloco
  // vai até o "]" que fecha a lista.
  const bloco = tx.slice(ini, tx.indexOf("]", ini));
  return Array.from(bloco.matchAll(/"([a-z0-9]+)"/g), (m) => m[1]);
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
    if (!cfg.semCodigo && !cfg.linhaSemCodigo) continue;
    const cartas = catalogo(jogo).filter((c) => c && c.number && (cfg.semCodigo || String(c.id).indexOf(cfg.linhaSemCodigo.prefixo) === 0));
    // (WoW e Sorcery nem têm número no catálogo: ali não há o que capturar.)
    if (cfg.linhaSemCodigo) assert.ok(cartas.length > 0, `${jogo}: nenhuma carta da linha "${cfg.linhaSemCodigo.prefixo}" no catálogo (a declaração ficou velha?)`);
    const fortes = cartas.filter((c) => S.extrair(String(c.number)).some((x) => x.peso >= 2));
    assert.ok(fortes.length <= cartas.length * 0.02,
      `${jogo}: ${fortes.length} de ${cartas.length} números viram candidato forte (ex.: ${fortes.slice(0, 3).map((c) => c.number).join(", ")})`);
  }
});
