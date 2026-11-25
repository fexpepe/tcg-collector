// A cápsula de toda carta em grade (src/capsula.js, 2026-11-23). Antes eram
// seis lugares montando a ficha cada um do seu jeito; agora é uma função só, e
// este teste é o que segura as regras que ela junta:
//   - "Nome (código)": do nome sai o código repetido, a raridade e o
//     acabamento; fica quem a carta É; na dúvida, não mexe;
//   - o código como está impresso (o "/total" só em número puro);
//   - a ordem fixa das etiquetas (graduação, raridade, tipo, extras) e das
//     faixas (etiquetas, título, origem);
//   - condição (NM, SP…) não é tipo e não entra na ficha;
//   - toda página com grade de carta carrega o arquivo, e só elas levam a
//     folha de CSS da cápsula.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { AREAS } from "../scripts/lib/css-areas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ler = (rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

// O capsula.js roda em cima do shared.js DE VERDADE (cardCode, rarityRank,
// bandeira, etiqueta do jogo, selo da graduadora), no mesmo sandbox.
const sb = loadShared("");
vm.runInContext(ler("src/capsula.js"), sb);
const C = sb.window.TCGCapsula;
const limpa = (card, variant) => { const r = C.nomeLimpo(card, variant); return [r.nome, Array.from(r.extras)]; };

test("do nome sai o que tem lugar próprio na ficha: código, raridade e a versão do tile", () => {
  // Raridade em sigla igual à do catálogo, por extenso na sigla da loja, e a inicial.
  assert.deepEqual(limpa({ name: "Master Gundam (LR++)", number: "GD05-033", rarity: "LR++" }, "Holofoil"), ["Master Gundam", []]);
  assert.deepEqual(limpa({ name: "Lightning-fast Hit (SPR)", number: "BT1-011", rarity: "Special Rare" }, "Normal"), ["Lightning-fast Hit", []]);
  assert.deepEqual(limpa({ name: "Amane Kanata (C) (hBP01-009)", number: "hBP01-009", rarity: "Common" }, "Normal"), ["Amane Kanata", []]);
  // Código solto no fim, com e sem travessão, e seguido da sigla da raridade.
  assert.deepEqual(limpa({ name: "Koala - OP05-006", number: "OP05-006", rarity: "R" }, "Normal"), ["Koala", []]);
  assert.deepEqual(limpa({ name: "Awakened Feelings - SAO/S26-E083 PR", number: "SAO/S26-E083", rarity: "Promo" }, "Normal"), ["Awakened Feelings", []]);
  // Código curto que é o fim do número.
  assert.deepEqual(limpa({ name: "Jugram Haschwalth (020) (SR**)", number: "UE01BT/BLC-1-020", rarity: "SR**" }, "Foil"), ["Jugram Haschwalth", []]);
  // "(Foil)" num tile Foil: a etiqueta de tipo já diz.
  assert.deepEqual(limpa({ name: "Bludger (Foil)", number: "1/80", rarity: "Foil Premium" }, "Foil"), ["Bludger", []]);
});

test("o que diz QUAL impressão é sai do nome e vira etiqueta extra", () => {
  assert.deepEqual(limpa({ name: "Monkey.D.Luffy (Alternate Art) (Manga)", number: "OP05-119", rarity: "SEC" }, "Foil"), ["Monkey.D.Luffy", ["Alternate Art", "Manga"]]);
  assert.deepEqual(limpa({ name: "Impmon - BT2-068 (Alternate Art)", number: "BT2-068", rarity: "Common" }, "Foil"), ["Impmon", ["Alternate Art"]]);
  // Sigla de paralela que NÃO é a raridade da carta.
  assert.deepEqual(limpa({ name: "Kouzuki Oden (SP)", number: "EB01-001", rarity: "L" }, "Foil"), ["Kouzuki Oden", ["SP"]]);
  // "Hyperspace Foil" num tile Foil: sobra o que a versão não diz.
  assert.deepEqual(limpa({ name: "Colossus (Hyperspace Foil)", number: "761", rarity: "Rare" }, "Foil"), ["Colossus", ["Hyperspace"]]);
  // Aninhado, com o código no meio dos sufixos.
  assert.deepEqual(limpa({ name: "Godzilla (2016) 4th Form (EBP02-007++) (Promotion Pack Vol.5)", number: "EBP02-007+", rarity: "PRP" }, "Foil"), ["Godzilla (2016) 4th Form", ["Promotion Pack Vol.5"]]);
  assert.deepEqual(limpa({ name: "Son Goku (Judge Pack (Store Judge))", number: "FB01-001", rarity: "PR" }, "Normal"), ["Son Goku", ["Judge Pack (Store Judge)"]]);
  // No tile AGRUPADO não há uma versão só: o acabamento do nome vira extra.
  assert.deepEqual(limpa({ name: "Bludger (Foil)", number: "1/80", rarity: "Rare" }, ""), ["Bludger", ["Foil"]]);
});

test("fica no nome quem a carta É, e tudo que a regra não reconhece", () => {
  for (const name of ["Naruto Uzumaki (Shippuden)", "Godzilla (2004)", "Agumon (X Antibody)", "Archer (Evolved)", "Gundam (EX)", "Heavyarms (EW)", "Char's Zaku (Refit)"]) {
    assert.deepEqual(limpa({ name, number: "N-001", rarity: "Common" }, "Normal"), [name, []], name);
  }
  // O pitch do Flesh and Blood fica; a tiragem e o código saem.
  assert.deepEqual(limpa({ name: "Wartune Herald (Red) (Extended Art) - FAB035", number: "FAB035", rarity: "Promo" }, "Rainbow Foil"), ["Wartune Herald (Red)", ["Extended Art"]]);
  // Carta cujo NOME é o código (FMA) e nome que termina em número curto.
  assert.deepEqual(limpa({ name: "No. B-086", number: "B-086", rarity: "Common" }, "Normal"), ["No. B-086", []]);
  assert.deepEqual(limpa({ name: "No. 37", number: "37", rarity: "Normal" }, "Normal"), ["No. 37", []]);
  // Nome que é SÓ sufixo nunca vira título vazio.
  assert.deepEqual(limpa({ name: "(Foil)", number: "1", rarity: "" }, "Foil"), ["(Foil)", []]);
  assert.deepEqual(limpa({ name: "", number: "1" }, "Normal"), ["", []]);
});

test("código como está impresso: o /total só entra em número puramente numérico", () => {
  assert.equal(C.codigo({ number: "138", setTotal: 103 }), "138/103");
  assert.equal(C.codigo({ number: "009", setTotal: 94 }), "009/094");
  assert.equal(C.codigo({ number: "4/102", setTotal: 102 }), "4/102");
  assert.equal(C.codigo({ number: "GD05-033", setTotal: 197 }), "GD05-033");
  assert.equal(C.codigo({ number: "OP05-119", setTotal: 154 }), "OP05-119");
  assert.equal(C.codigo({ number: "忍-2", setTotal: 70 }), "忍-2");
  assert.equal(C.codigo({ number: "TG12", setTotal: 195 }), "TG12");
  assert.equal(C.codigo({ number: "229" }), "229");
  assert.equal(C.codigo({ number: "" }), "");
  // Numeração corrida do Gundam Carddass: a regra do cardCode continua valendo.
  assert.equal(C.codigo({ id: "gcd-83", number: "83", setTotal: 41 }), "83");
  assert.equal(C.titulo({ name: "Master Gundam (LR++)", number: "GD05-033", setTotal: 197, rarity: "LR++" }, "Holofoil"), "Master Gundam (GD05-033)");
  assert.equal(C.titulo({ name: "Sem Número" }, "Normal"), "Sem Número");
});

test("raridade: por extenso com a caixa acertada; vazio, None e - não viram etiqueta", () => {
  assert.equal(C.raridade({ rarity: "Super_rare" }), "Super Rare");
  assert.equal(C.raridade({ rarity: "Special illustration rare" }), "Special Illustration Rare");
  assert.equal(C.raridade({ rarity: "Rare Holo" }), "Rare Holo");
  assert.equal(C.raridade({ rarity: "LR++" }), "LR++");
  assert.equal(C.raridade({ rarity: "☆☆" }), "☆☆");
  for (const r of ["", "None", "none", "-", undefined]) assert.equal(C.raridade({ rarity: r }), "", String(r));
});

test("faixa de cor da raridade sai da escada que ordena as grades", () => {
  assert.equal(C.faixa("Common"), 1);
  assert.equal(C.faixa("Uncommon"), 2);
  assert.equal(C.faixa("Rare"), 3);
  assert.equal(C.faixa("Promo"), 3);
  assert.equal(C.faixa("Double rare"), 4);
  assert.equal(C.faixa("Super_rare"), 4);
  assert.equal(C.faixa("Special illustration rare"), 5);
  assert.equal(C.faixa("Enchanted"), 5);
  assert.equal(C.faixa("SEC"), 5);
  // Paralelas com marca sobem um degrau por marca (Gundam, Union Arena).
  assert.equal(C.faixa("C+"), 1);
  assert.equal(C.faixa("U+"), 2);
  assert.equal(C.faixa("R+"), 3);
  assert.equal(C.faixa("LR+"), 5);
  assert.equal(C.faixa("LR++"), 5);
  assert.equal(C.faixa("SR*"), 4);
  assert.equal(C.faixa("SR**"), 5);
  // Sem raridade não há faixa; raridade fora da escada fica no neutro.
  assert.equal(C.faixa(""), 0);
  assert.equal(C.faixa("None"), 0);
  assert.equal(C.faixa("Ordinary"), "d");
});

const gundam = { id: "gcg-707602", name: "Master Gundam (LR++)", number: "GD05-033", setTotal: 197, set: "Freedom Ascension", setId: "GD05", rarity: "LR++", language: "en", game: "gundam", variants: ["Holofoil"] };
const ordem = (html, ...trechos) => trechos.map((x) => { const i = html.indexOf(x); assert.ok(i >= 0, `falta ${x}`); return i; });
const crescente = (is) => is.every((v, i) => i === 0 || v > is[i - 1]);

test("a ficha: etiquetas, título e origem, sempre nessa ordem", () => {
  const html = C.ficha(gundam, { variant: "Holofoil", jogo: true });
  assert.ok(crescente(ordem(html, 'class="cap-etqs"', 'class="cap-titulo"', 'class="cap-origem"')), html);
  // Título: nome limpo e o código à parte, que é quem não pode ser cortado.
  assert.match(html, /<span class="cap-nome">Master Gundam<\/span> <span class="cap-cod">\(GD05-033\)<\/span>/);
  assert.equal(html.match(/<h3[^>]*>(.*?)<\/h3>/)[1].replace(/<[^>]+>/g, ""), "Master Gundam (GD05-033)");
  assert.match(html, /<h3 class="cap-titulo" title="Master Gundam \(GD05-033\)">/);
  // Raridade com a faixa e o tipo com a classe do acabamento.
  assert.match(html, /class="cap-etq cap-rar" data-faixa="5"[^>]*>LR\+\+</);
  assert.match(html, /class="cap-etq cap-tipo variant-holofoil">Holofoil</);
  // Origem: bandeira, set (link pro set, com o setId) e o jogo no fim.
  assert.ok(crescente(ordem(html, 'class="card-flag"', 'class="cap-set tile-set-link"', "tile-game")), html);
  assert.match(html, /href="[^"]*setId=GD05[^"]*"/);
});

test("etiquetas em ordem fixa: graduação, raridade, torneio, tipo, extras", () => {
  const luffy = { name: "Monkey.D.Luffy (Alternate Art) (Manga)", number: "OP05-119", set: "Awakening of the New Era", rarity: "SEC", language: "en", game: "onepiece" };
  const html = C.ficha(luffy, { variant: "Foil", graded: { company: "psa", grade: "9" } });
  assert.ok(crescente(ordem(html, "graded-badge", "cap-rar", "cap-tipo", "cap-extras")), html);
  assert.match(html, /graded-badge[^>]*>PSA 9</);
  // Cada extra vem depois de um espaço de largura zero (onde a linha quebra)
  // e leva o "+N" dela em diante: +2 na primeira, +1 na segunda.
  const extras = html.match(/<span class="cap-extras">(.*?)<\/span><\/p>/)[1];
  assert.deepEqual(Array.from(extras.split("\u200B").filter(Boolean), (x) => x.replace(/<span class="cap-mais"[^>]*>\+\d+<\/span>/, "").replace(/<[^>]+>/g, "")), ["Alternate Art", "Manga"]);
  assert.deepEqual(Array.from(html.matchAll(/class="cap-mais" style="z-index:(\d+)" title="([^"]*)" aria-hidden="true">\+(\d+)</g), (m) => [m[1], m[2], m[3]]),
    [["2", "Alternate Art · Manga", "2"], ["1", "Manga", "1"]]);
  // Sem raridade não há etiqueta de raridade — e nenhum espaço reservado em texto.
  const semRar = C.ficha({ name: "Naruto Uzumaki", number: "NM-003", set: "Narutimate Mission", rarity: "", language: "ja", game: "naruto" }, { variant: "Normal" });
  assert.ok(!semRar.includes("cap-rar"), semRar);
  assert.match(semRar, /cap-tipo variant-normal">Normal</);
});

test("sem jogo na grade de um jogo só; set da própria página é texto, não link", () => {
  const html = C.ficha(gundam, { variant: "Holofoil", setAtual: "Freedom Ascension" });
  assert.ok(!html.includes("tile-game"), "etiqueta do jogo só em grade que mistura jogos");
  assert.match(html, /<span class="cap-set" title="Freedom Ascension">Freedom Ascension<\/span>/);
  assert.ok(!html.includes("<a "), html);
});

test("tile agrupado e tipo pronto: a página manda o HTML, a ficha não escapa de novo", () => {
  const tipo = '<span class="tile-vn">Normal</span><span class="tile-vn-sep"> · </span><span class="tile-vn is-have">Foil</span>';
  const html = C.ficha({ ...gundam, name: "Bludger (Foil)", rarity: "Rare" }, { variant: "Normal", tipo, grupo: "Normal · Foil" });
  assert.ok(html.includes(`class="cap-etq cap-tipo is-grupo" title="Normal · Foil">${tipo}</span>`), html);
  // Agrupado: o "(Foil)" do nome não some (não há UMA versão), vira extra.
  assert.match(html, /cap-extra"[^>]*><span class="cap-mais"[^>]*>\+1<\/span>Foil</);
});

test("condição não é tipo: NM/SP nunca aparecem na ficha", () => {
  const html = C.ficha(gundam, { variant: "Holofoil" });
  assert.ok(!/\b(NM|SP|MP|HP)\b/.test(html.replace(/<[^>]+>/g, " ")), html);
  // E quem monta os tiles não cola mais a condição na versão.
  for (const f of ["src/pastas.js", "src/collection.js", "src/sales.js", "src/graded-ui.js"]) {
    const js = ler(f);
    assert.ok(!/tile-variant/.test(js), `${f} ainda monta a linha antiga da versão`);
    assert.ok(!/varLabel\)\}\$\{entry\.c/.test(js), `${f} ainda cola a condição na versão`);
  }
});

test("carta que saiu do catálogo (só o id): ficha sem bandeira e sem set, sem quebrar", () => {
  const html = C.ficha({ name: "nrt-dc-nm-003" }, { variant: "Normal" });
  assert.match(html, /<span class="cap-nome">nrt-dc-nm-003<\/span><\/h3>/);
  assert.match(html, /<p class="cap-origem"><\/p>/);
});

test("a base guarda a linha do preço e some quando não há nem preço nem botão", () => {
  assert.equal(C.base("", ""), "");
  assert.equal(C.base("", "<b>+</b>"), '<div class="cap-base"><p class="tile-price"></p><div class="tile-foot"><b>+</b></div></div>');
  assert.equal(C.base('<p class="tile-price">R$ 1</p>'), '<div class="cap-base"><p class="tile-price">R$ 1</p></div>');
});

test("o que entra no HTML é escapado", () => {
  const html = C.ficha({ name: 'A <b>"x"</b> (Promo & Co)', number: "X-<1>", set: "S <i>", rarity: "<R>", language: "en", game: "pokemon" }, { variant: "Normal" });
  assert.ok(!/<b>|<i>|<R>|X-<1>/.test(html), html);
});

// ── Raridade e acabamento por jogo (2026-11-24) ───────────────────────────
// O Naruto japonês grava N/R/SR/UR/P e a tela mostra o nome; o Carddass grava
// o brilho (Normal/Prism) como raridade, e ele vira o acabamento do tile.
const nrt = (rarity, extra) => ({ name: "うずまきナルト", number: "忍-1", set: "Vol. 1", rarity, language: "ja", game: "naruto", variants: ["Normal"], ...extra });
const dbcCard = (rarity) => ({ name: "Son Goku", number: "1", set: "Part 1", rarity, language: "ja", game: "dbc", variants: ["Normal"] });

test("Naruto: a sigla da raridade aparece pelo nome; o que não tem nome seguro fica em sigla", () => {
  for (const [sigla, nome] of [["N", "Normal"], ["R", "Rare"], ["SR", "Super Rare"], ["UR", "Ultra Rare"], ["P", "Promo"], ["Memorial", "Memorial"], ["NR", "NR"]]) {
    assert.equal(C.nomeRaridade(nrt(sigla)), nome, sigla);
    assert.equal(C.raridade(nrt(sigla)), nome, sigla);
  }
  // A ficha mostra o nome, e a cor continua vindo da escada da sigla.
  assert.match(C.ficha(nrt("UR"), { variant: "Normal" }), /class="cap-etq cap-rar" data-faixa="5"[^>]*>Ultra Rare</);
  // Outro jogo com a MESMA sigla não muda: no One Piece "R" é R.
  assert.equal(C.raridade({ rarity: "R", game: "onepiece" }), "R");
  assert.equal(C.raridade({ rarity: "L", game: "onepiece" }), "L");
});

test("filtro de raridade: chave pelo nome, na escada; R do Card Game e Rare do CCG viram uma opção", () => {
  const cartas = [nrt("UR"), nrt("N"), nrt("R"), nrt("Rare"), nrt("Memorial"), nrt("P"), nrt(""), nrt("None"), nrt("Silver Holo")];
  assert.deepEqual(Array.from(C.opcoesRaridade(cartas)), ["Normal", "Rare", "Promo", "Ultra Rare", "Memorial"]);
  assert.equal(C.rotuloRaridade("Super_rare"), "Super Rare");
});

test("Carddass: o brilho gravado como raridade é o acabamento do tile, não raridade", () => {
  const prism = dbcCard("Prism");
  assert.equal(C.nomeRaridade(prism), "");
  assert.equal(C.raridade(prism), "");
  assert.equal(C.acabamentoDaRaridade(prism, "Normal"), "Prism");
  // O shared.variantDisplayLabel consulta a tabela: tile, popup e filtro dizem o mesmo.
  assert.equal(sb.window.TCGShared.variantDisplayLabel(prism, "Normal"), "Prism");
  const html = C.ficha(prism, { variant: "Normal" });
  assert.ok(!html.includes("cap-rar"), html);
  assert.match(html, /class="cap-etq cap-tipo variant-normal is-brilho">Prism</);
  // Valor fora da lista do jogo segue raridade (a Promo da HxH).
  assert.equal(C.raridade({ rarity: "Promo", game: "hxh", variants: ["Normal"] }), "Promo");
  assert.equal(C.acabamentoDaRaridade({ rarity: "Holo", game: "hxh", variants: ["Normal"] }, "Normal"), "Holo");
  // Jogo sem a tabela: "Normal" na raridade (o Carddass Masters) segue raridade.
  assert.equal(C.raridade({ rarity: "Normal", game: "cdm" }), "Normal");
  assert.equal(C.acabamentoDaRaridade({ rarity: "Normal", game: "cdm", variants: ["Normal"] }, "Normal"), "");
});

test("filtro de acabamento: as versões do tile, Normal primeiro e a escada do jogo", () => {
  const pares = [dbcCard("Gold"), dbcCard("Prism"), dbcCard("Normal"), dbcCard("Double Prism")].map((card) => ({ card, variant: "Normal" }));
  assert.deepEqual(Array.from(C.opcoesAcabamento(pares, "dbc")), ["Normal", "Prism", "Double Prism", "Gold"]);
  // TCG moderno: o acabamento é a versão (Normal/Foil/Diamond Foil…), a raridade fica como é.
  const ccg = { name: "Naruto", rarity: "Rare", game: "naruto", variants: ["Normal", "Diamond Foil", "Wavy Foil"] };
  const paresCcg = ccg.variants.map((variant) => ({ card: ccg, variant }));
  assert.deepEqual(Array.from(C.opcoesAcabamento(paresCcg, "")), ["Normal", "Diamond Foil", "Wavy Foil"]);
  assert.ok(C.casaAcabamento(ccg, "Wavy Foil", "Wavy Foil"));
  assert.ok(!C.casaAcabamento(ccg, "Normal", "Wavy Foil"));
  assert.ok(C.casaAcabamento(ccg, "Normal", ""), "sem filtro passa tudo");
  // Tile agrupado (uma carta = um tile): passa se alguma versão casa.
  assert.ok(C.casaAcabamento(ccg, "Normal", "Diamond Foil", true));
  assert.ok(!C.casaAcabamento(ccg, "Normal", "Foil", true));
  // A Prism do Carddass casa pelo acabamento, não pela chave "Normal".
  assert.ok(C.casaAcabamento(dbcCard("Prism"), "Normal", "Prism"));
  assert.ok(!C.casaAcabamento(dbcCard("Prism"), "Normal", "Normal"));
});

test("toda grade com filtro de raridade tem o de acabamento, e as duas réguas vêm do capsula.js", () => {
  for (const [html, js] of [["cards.html", "src/cards.js"], ["collection.html", "src/collection.js"], ["detail.html", "src/detail.js"], ["wishlist.html", "src/wishlist.js"], ["explore.html", "src/explore.js"]]) {
    assert.match(ler(html), /<select id="(explore)?[fF]inishFilter">/, `${html} sem o campo de acabamento`);
    assert.match(ler(html), /data-i18n="toolbar\.finish"/, html);
    const src = ler(js);
    assert.ok(/opcoesAcabamento\(/.test(src) && /casaAcabamento\(/.test(src), `${js} não usa a régua de acabamento`);
    assert.ok(/nomeRaridade/.test(src) && !/card\.rarity (===|!==) rarityValue/.test(src), `${js} filtra a raridade crua`);
  }
});

// ── Torneio (2026-11-24) ─────────────────────────────────────────────────
const tor = (name, extra) => C.torneio({ name, number: "X-001", set: "Booster", rarity: "R", ...extra });

test("torneio: prêmio de participação, de colocação, de juiz, de liga e packs de campeonato", () => {
  for (const name of [
    "Mace Windu - Party Crasher (Champion)", "Mace Windu - Party Crasher (Finalist)", "Long Sword (Top 8)",
    "Anakin Skywalker - Protect Her At All Costs (Prize Wall)", "Kid & Killer (Offline Regional Champion Card Set 2025 Vol.2)",
    "MetalGreymon - BT1-021 (2023 Regionals Participant)", "Edward Weevil (Judge Pack Vol. 4)", "Jegan (Store Tournament Winner Pack 01)",
    "Power Burst (Masters Cup 2024) (Winner Gold Stamped)", "Soul - ESOUL-015 (Masters League 1st Place)", "Godzilla (2023) (EBP01-010++) (Champion Prize)",
    "Blazing Throw (Wildcard Nationals Qualifier)", "Sakura: Still Slumber (2018 World Finals)", "\"Running Through\" Megumin & Yunyun (Shop League 2020)",
    "Diffindo (League Foil)", "Zidane (Road to World Championship)", "Action Point Card (AP04) (25-26 Finals Participation)", "Day of Judgment (Judge Promo)"
  ]) assert.equal(tor(name), true, name);
  // Pelo set inteiro, sem marca no nome.
  for (const set of ["Tournament Promotion Cards", "Judge Promotion Cards", "Tournament and Championship Promos", "Store Championships", "Duelist League Promo",
    "Tournament Pack 1", "Tournament Pack Cards", "Sector and Regional Promos: Season 1", "Galactic Championship 2026", "Friday Night Magic 2004",
    "Magic Player Rewards 2008", "Arena League 2001", "Organized Play Promos", "Organized Play Promotional Cards", "Homeworlds: Weekly Play Promos",
    "Awakening of the New Era: 1st Anniversary Tournament Cards", "League & Judge Promos", "\"Atari\" Winner Cards"
  ]) assert.equal(C.torneio({ name: "Carta", set }), true, set);
  // Pela raridade, onde o catálogo guarda assim (DBZ).
  assert.equal(C.torneio({ name: "Gohan Season Wild Card", set: "Promos", rarity: "League" }), true);
  assert.equal(C.torneio({ name: "Carta", set: "Promos", rarity: "Judge" }), true);
});

test("torneio: o campo tournament do catálogo marca o que nome, set e raridade não dizem", () => {
  // A PR忍-1-R do Naruto 2002 (25/11/2026): prêmio de torneio no set de
  // promos de sempre, com raridade Promo.
  const pr1r = { name: "Naruto Uzumaki (Foil)", number: "PR忍-1-R", set: "Promotion Cards", rarity: "Promo" };
  assert.equal(C.torneio(pr1r), false);
  assert.equal(C.torneio({ ...pr1r, tournament: true }), true);
  // Só o booleano: texto ou número vindo de dado torto não liga a etiqueta.
  assert.equal(C.torneio({ ...pr1r, tournament: "true" }), false);
  assert.equal(C.torneio({ ...pr1r, tournament: 1 }), false);
  const html = C.ficha({ ...pr1r, id: "nrt-PRN-001R", tournament: true, variants: ["Foil"] }, { variant: "Foil" });
  assert.ok(html.includes("cap-torneio"), html);
});

test("torneio: produto vendido com Tournament/Champion no nome NÃO conta, nem nome de carta", () => {
  for (const set of ["Tournament of Power", "World Martial Arts Tournament", "Champions of Kamigawa", "Champion's Path", "Premium Champion Pack",
    "World Championship Decks 1997", "World Champion Decks 2024", "Champions of the Asia Circuit", "Battle Pack 3: Monster League", "T1 2025 Worlds Champion Bundles",
    "Worlds Bundle 2025", "Champion of the East Blue", "Magic Premiere Shop 2005", "Trial Deck 16: Divine Judgement of the Bluish Flames"
  ]) assert.equal(C.torneio({ name: "Carta", set }), false, set);
  for (const name of ["Robin Hood - Champion of Sherwood", "Judge", "Elvish Champion", "Prized Galea", "Power Burst (Power Booster: World Martial Arts Tournament)",
    "Upamon (Gundam Base Pop-Up World Tour)", "Annie (T1 Worlds Champion Signature Edition Bundle)", "Rengar (Best Of)", "Agumon (Tamer's Selection Box Ver. Championship 2023)",
    "Monkey.D.Luffy (Alternate Art) (Manga)", "Pikachu (Box Topper)"
  ]) assert.equal(tor(name), false, name);
  assert.equal(C.torneio(null), false);
});

test("torneio: a etiqueta vem entre a raridade e o tipo, e o detalhe segue como extra", () => {
  const html = C.ficha({ name: "Mace Windu - Party Crasher (Champion)", number: "2/2", set: "Organized Play Promos", rarity: "Legendary", language: "en", game: "swu" },
    { variant: "Foil", graded: { company: "psa", grade: "10" } });
  assert.ok(crescente(ordem(html, "graded-badge", "cap-rar", "cap-torneio", "cap-tipo", "cap-extras")), html);
  assert.match(html, /<span class="cap-etq cap-torneio" title="cap\.tournamentHint"><svg[^>]*aria-hidden="true">.*<\/svg><span>cap\.tournament<\/span><\/span>/);
  assert.match(html, /cap-extra"[^>]*><span class="cap-mais"[^>]*>\+1<\/span>Champion</);
  assert.equal(html.match(/<h3[^>]*>(.*?)<\/h3>/)[1].replace(/<[^>]+>/g, ""), "Mace Windu - Party Crasher (2/2)");
  // Sem torneio, nenhuma etiqueta no lugar.
  assert.ok(!C.ficha(gundam, { variant: "Holofoil" }).includes("cap-torneio"));
});

test("sufixo de torneio sai do nome mesmo sem palavra da lista de tiragem", () => {
  assert.deepEqual(limpa({ name: "Power Burst (Masters Cup 2024) (Winner Gold Stamped)", number: "BT5-115", rarity: "Promo" }, "Foil"), ["Power Burst", ["Masters Cup 2024", "Winner Gold Stamped"]]);
});

test("código com a raridade colada no número (Digimon) também sai do nome", () => {
  assert.deepEqual(limpa({ name: "MetalGreymon - BT1-021 (2023 Regionals Champion)", number: "BT1-021 U", rarity: "Promo" }, "Normal"), ["MetalGreymon", ["2023 Regionals Champion"]]);
  assert.deepEqual(limpa({ name: "Impmon - BT2-068 (Alternate Art)", number: "BT2-068 R", rarity: "Rare" }, "Foil"), ["Impmon", ["Alternate Art"]]);
});

test("linha compacta: o troféu vem antes da raridade, só na carta de torneio", () => {
  assert.match(C.colunaRaridade({ name: "Carta (Winner)", rarity: "Promo" }), /^<span class="cap-trofeu" title="cap\.tournamentHint"><svg[^]*<\/span>Promo$/);
  assert.equal(C.colunaRaridade({ name: "Carta", rarity: "Super_rare" }), "Super Rare");
});

test("i18n: as chaves da etiqueta de torneio existem nos três idiomas", () => {
  const sbi = { window: {} };
  vm.runInNewContext(ler("src/i18n.js"), sbi);
  const M = sbi.window.TCG_MESSAGES;
  for (const lang of ["pt", "en", "es"]) {
    assert.equal(M[lang]["cap.tournament"], "Tournament", lang);
    assert.ok(M[lang]["cap.tournamentHint"], lang);
  }
});

// ── Ligação com as páginas ────────────────────────────────────────────────
const paginas = readdirSync(root).filter((f) => f.endsWith(".html"));
const carregam = paginas.filter((f) => ler(f).includes('src="src/capsula.js"')).sort();

test("toda página com grade de carta carrega o src/capsula.js: depois do shared.js e ANTES do script dela", () => {
  // Quem desenha tile: chama o variantTile do shared.js (que depende da
  // cápsula) ou usa a ficha direto.
  const usam = readdirSync(join(root, "src")).filter((f) => f.endsWith(".js") && f !== "capsula.js" && f !== "shared.js"
    && /TCGCapsula|\.variantTile\(/.test(ler(`src/${f}`)));
  assert.ok(usam.length >= 8, `só ${usam.length} scripts usam a cápsula: ${usam.join(", ")}`);
  for (const f of paginas) {
    const html = ler(f);
    const tag = html.indexOf('src="src/capsula.js"');
    for (const js of usam) {
      const i = html.indexOf(`src="src/${js}"`);
      if (i < 0) continue;
      assert.ok(tag >= 0 && tag < i, `${f}: src/capsula.js precisa vir antes de src/${js}`);
      assert.ok(html.indexOf('src="src/shared.js"') < tag, `${f}: src/capsula.js lê o TCGShared ao carregar — vem depois do shared.js`);
    }
  }
  assert.ok(carregam.length >= 7, carregam.join(", "));
});

test("a folha de CSS da cápsula vai pras MESMAS páginas que carregam o script, e o shell guarda o arquivo", () => {
  const area = AREAS.find((a) => a.nome === "capsula");
  assert.ok(area, 'falta a área "capsula" no scripts/lib/css-areas.mjs');
  assert.deepEqual([...area.paginas].sort(), carregam);
  assert.ok(ler("sw.js").includes('"src/capsula.js"'), "sem o capsula.js no shell, a grade não desenha offline");
  // As classes cap- só podem ser escritas por quem essas páginas carregam: o
  // shared.js viaja em todas e chama a ficha, não escreve a classe.
  assert.ok(!/["'`.\s]cap-[a-z]/.test(ler("src/shared.js").replace(/\/\/.*$/gm, "")), "shared.js não pode desenhar classe cap-");
});
