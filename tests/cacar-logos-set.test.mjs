// Testes do caçador de logos de set (scripts/cacar-logos-set.mjs), sem rede e
// sem sharp: o que decide QUAL imagem vira logo (alt do OP-17, "<Set> Logo" do
// Lorcana, arquivo com o nome na Fandom, código/nome no the-fab-cube), a
// limpeza do alfa, o remendo do cards.js e — o que mais importa — que o
// caçador e os syncs concordam no nome do arquivo e na guarda "logo local
// vence". Se um sync mudar a regra, isto quebra antes de a PR semanal propor
// um logo que o build completo apagaria.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  norm, lerCatalogo, setsDoCatalogo, remendaCatalogo, codigoOnePiece, JOGOS, temGuarda, PROMO,
  alvosDoJogo, imagensDaPagina, metaRefresh, slugsDeProduto, slugsParaTentar, logoDaPaginaLorcana,
  logosDaFandom, logosDaPaginaBandai, logoDoFabCube, limpaAlfa, encaixa, mesmaArte
} from "../scripts/lib/logos-set.mjs";

const fonte = (nome) => readFileSync(new URL(`../scripts/${nome}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const catalogo = (cards, fim = ";\n") => `window.TCG_CARDS = ${JSON.stringify(cards)}${fim}`;
const carta = (id, setId, set, setLogo = "", extra = {}) => ({ id, name: id, set, setId, setReleaseDate: "2026-10-01", setLogo, ...extra });

// ── O caçador e os syncs falam a mesma língua ───────────────────────────────
test("guarda: os syncs do Lorcana e do FAB deixam o logo local vencer", () => {
  assert.ok(temGuarda(fonte("sync-lorcana.mjs"), "lorcana"));
  assert.ok(temGuarda(fonte("sync-fab.mjs"), "fab"));
  // Sync sem a guarda (o do Gundam zera o setLogo) não passa.
  assert.ok(!temGuarda(fonte("sync-gundam.mjs"), "fab"));
  // A forma da guarda que a PR #199 deu ao sync-onepiece.
  assert.ok(temGuarda("const local = await localLogo(code); // data/onepiece/set-logos/", "onepiece"));
});

test("arquivo: o nome que o caçador grava é o que cada sync procura", () => {
  assert.match(fonte("sync-lorcana.mjs"), /hasLocal\(`\$\{code\}\.png`\)/);
  assert.equal(JOGOS.lorcana.arquivo("14"), "14.png");
  assert.match(fonte("sync-fab.mjs"), /winSafeName\(String\(setId\)\.toUpperCase\(\)\)/);
  assert.equal(JOGOS.fab.arquivo("24266"), "24266.webp");
  assert.equal(JOGOS.fab.arquivo("con"), "CON_.webp"); // nome reservado do Windows, como no sync
  assert.equal(JOGOS.fab.arquivo("RVD/DVR"), null);    // barra viraria pasta
  // O código base do One Piece é o MESMO regex do sync (RE/PRE herdam).
  assert.ok(fonte("sync-onepiece.mjs").includes(".match(/^(OP|EB|PRB|ST)(\\d+)/)"));
  assert.equal(codigoOnePiece("OP17 RE"), "op17");
  assert.equal(codigoOnePiece("ST-30"), "st30");
  assert.equal(codigoOnePiece("PRB-02"), "prb02");
  assert.equal(codigoOnePiece("SD01"), null);
  assert.equal(codigoOnePiece("OP-PR"), null);
});

test("lista de exclusão: JSON válido e cada setId do One Piece tem código", () => {
  const ign = JSON.parse(readFileSync(new URL("../scripts/data/logos-set-ignorar.json", import.meta.url), "utf8"));
  for (const jogo of Object.keys(ign).filter((k) => !k.startsWith("_"))) assert.ok(JOGOS[jogo], `jogo desconhecido: ${jogo}`);
  for (const setId of Object.keys(ign.onepiece)) assert.ok(codigoOnePiece(setId), setId);
});

// ── Catálogo ────────────────────────────────────────────────────────────────
test("remendo: só o setLogo vazio do set, e o delta é cartas × caminho", () => {
  const texto = catalogo([carta("a1", "14", "Hyperia City"), carta("a2", "14", "Hyperia City"), carta("b1", "13", "Attack", "data/lorcana/set-logos/13.png")]);
  const r = remendaCatalogo(texto, ["14"], "data/lorcana/set-logos/14.png");
  assert.equal(r.cartas, 2);
  assert.equal(r.delta, 2 * "data/lorcana/set-logos/14.png".length);
  const depois = lerCatalogo(r.texto).cards;
  assert.deepEqual(depois.map((c) => c.setLogo), ["data/lorcana/set-logos/14.png", "data/lorcana/set-logos/14.png", "data/lorcana/set-logos/13.png"]);
});

test("remendo: aceita o fim CRLF do checkout do Windows e recusa arquivo formatado à mão", () => {
  const crlf = catalogo([carta("a1", "14", "X")], ";\r\n");
  assert.ok(remendaCatalogo(crlf, ["14"], "p.png").texto.endsWith(";\r\n"));
  const formatado = `window.TCG_CARDS = ${JSON.stringify([carta("a1", "14", "X")], null, 2)};\n`;
  assert.throws(() => lerCatalogo(formatado), /JSON compacto/);
});

test("sets: agrupa por setId e conta as cartas sem logo", () => {
  const sets = setsDoCatalogo([carta("a", "1", "Um"), carta("b", "1", "Um"), carta("c", "2", "Dois", "x.png")]);
  assert.equal(sets.get("1").semLogo, 2);
  assert.equal(sets.get("2").semLogo, 0);
});

// ── Quem é procurado ────────────────────────────────────────────────────────
test("alvos do One Piece: OP17 e OP17 RE dividem o op17.webp; linhas vintage e promo ficam de fora", () => {
  const cards = [
    carta("op-1", "OP17", "The World's Strongest Warriors"),
    carta("op-2", "OP17 RE", "The World's Strongest Warriors Release Event Cards"),
    carta("op-3", "OP-PR", "One Piece Promotion Cards"),
    carta("op-4", "OP01", "Romance Dawn"),
    carta("op-5", "ST-36", "Starter", ""),
    carta("op2002-1", "op2002-promos", "OP 2002 — Promos")
  ];
  const { alvos, pulados } = alvosDoJogo("onepiece", cards, { ignorar: { OP01: "auditado" }, existe: (a) => a === "st36.webp" });
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0].arquivo, "op17.webp");
  assert.equal(alvos[0].principal.setId, "OP17");
  assert.deepEqual(alvos[0].setIds, ["OP17", "OP17 RE"]);
  const motivo = (id) => pulados.find((p) => p.setId === id).motivo;
  assert.match(motivo("OP-PR"), /não liga logo local/);
  assert.match(motivo("OP01"), /lista de exclusão: auditado/);
  assert.match(motivo("ST-36"), /já existe/);
  assert.match(motivo("op2002-promos"), /linha à parte/);
});

test("alvos: grupo só de promo não é procurado", () => {
  const { alvos, pulados } = alvosDoJogo("lorcana", [carta("p", "P4", "Promo Set 4")]);
  assert.equal(alvos.length, 0);
  assert.equal(pulados[0].motivo, "promo");
});

test("promo pelo nome, sem pegar set de verdade", () => {
  for (const n of ["Promo Set 4", "Challenge Promo", "One Piece Promotion Cards", "Two Legends Pre-Release Cards", "Legacy of the Master Release Event Cards", "Judge Promos", "2025 Gift Box", "Box Toppers - Retail", "Galactic Championship 2026", "A Lawless Time: Weekly Play Promos"]) {
    assert.ok(PROMO.test(n), n);
  }
  for (const n of ["Hyperia City", "High Seas", "The World's Strongest Warriors", "Armory Deck: Ira", "Premium Booster -The Best-"]) {
    assert.ok(!PROMO.test(n), n);
  }
});

// ── One Piece: a página especial do OP-17 ───────────────────────────────────
// Recorte da estrutura real (2026-10-17): o selo do aniversário é "logo", o
// título do set é "title" com o nome no alt, e a versão pc vem no <source>.
const PAGINA_OP17 = `
<header><img src="/renewal/images/common/logo_op.png" alt="ONE PIECE CARD GAME"></header>
<nav><img src="images/nav/4th_logo.webp" alt=""><img src="images/nav/logo.webp" alt=""></nav>
<picture><source srcset="images/mv/pc/logo.webp" media="(min-width: 1001px)"><img src="images/mv/logo.webp" alt="4th ANNIVERSARY"></picture>
<picture><source srcset="images/mv/pc/title.webp" media="(min-width: 1001px)"><img src="images/mv/title.webp" alt="THE WORLD&rsquo;S STRONGEST WARRIORS"></picture>
<img src="images/newyonko/4thanv_title.webp" alt="4th ANNIVERSARY CELEBRATION">
<img src="images/cards/OP17-040.webp" alt="">`;

test("Bandai: no OP-17 vence o título com o nome no alt, não o selo do aniversário", () => {
  const c = logosDaPaginaBandai(PAGINA_OP17, { codigo: "op17", nome: "The World's Strongest Warriors" });
  assert.equal(c[0].url, "images/mv/pc/title.webp");
  assert.ok(c[0].pontos >= 100);
  assert.ok(!c.some((x) => /4th|nav\/|logo_op/.test(x.url)));
  // O "logo" do mv sem o alt certo não passa sozinho.
  assert.ok(!c.some((x) => x.url === "images/mv/pc/logo.webp"));
});

test("Bandai: página de produto nova casa pelo código do alt", () => {
  const html = `<img src="/x/2026/03/26/abc/logo.webp" alt="BOOSTER PACK -THE TIME OF BATTLE- [OP-16]"><img src="/x/img_item01.webp" alt="BOOSTER PACK -THE TIME OF BATTLE- [OP-16]">`;
  const c = logosDaPaginaBandai(html, { codigo: "op16", nome: "Outro nome no TCGplayer" });
  assert.equal(c.length, 1);
  assert.equal(c[0].url, "/x/2026/03/26/abc/logo.webp");
  // [OP-1] não é o OP-16.
  assert.equal(logosDaPaginaBandai(html, { codigo: "op1", nome: "x" }).length, 0);
});

test("meta refresh da página especial", () => {
  assert.equal(metaRefresh(`<meta http-equiv="refresh" content="0; URL=./boosters/op17/">`), "./boosters/op17/");
  assert.equal(metaRefresh("<p>sem</p>"), null);
});

test("imagens: o <img> do <picture> carrega as variantes dos <source>", () => {
  const [img] = imagensDaPagina(`<picture><source srcset="a/pc.webp 1x, a/pc@2x.webp 2x" media="(min-width: 1001px)"><img src="a/sp.webp" alt="X"></picture>`);
  assert.equal(img.src, "a/sp.webp");
  assert.equal(img.variantes[0].url, "a/pc@2x.webp");
});

// ── Lorcana ─────────────────────────────────────────────────────────────────
test("Lorcana: o logo é a imagem com alt \"<Set> Logo\", não a marca do jogo", () => {
  const html = `<img alt="Lorcana logo" src="/_nuxt/logo-br.png"><img src="https://ravensburger.cloud/x/s14-hyperia-city/en/abc_en.png" alt="Hyperia City Logo" loading="lazy">`;
  assert.equal(logoDaPaginaLorcana(html, "Hyperia City").url, "https://ravensburger.cloud/x/s14-hyperia-city/en/abc_en.png");
  assert.equal(logoDaPaginaLorcana(html, "Attack of the Vine!"), null);
});

test("Lorcana: slug do produto pelo nome, ou pelo menu quando o nome é outro", () => {
  assert.deepEqual(slugsParaTentar("Hyperia City"), ["hyperia-city"]);
  const menu = slugsDeProduto(`<a href="/en-US/product/great-hunny-rescue">x</a><a href="/en-US/product/hyperia-city">y</a>`);
  assert.deepEqual(slugsParaTentar("Hunny Rescue – Illumineer's Quest", menu), ["hunny-rescue-illumineer-s-quest", "great-hunny-rescue"]);
});

test("Fandom: só o arquivo com o nome do set (caixa, mapa e pôster não)", () => {
  const json = { query: { allimages: [
    { name: "Hyperia_City.png", width: 639, height: 493, url: "https://static/a1/Hyperia_City.png" },
    { name: "Hyperia_City_Map.jpeg", width: 3375, height: 4050, url: "m" },
    { name: "Hyperia_City_Background.webp", width: 1080, height: 1350, url: "b" },
    { name: "Hyperia_City_Booster_Box.jpeg", width: 1200, height: 1200, url: "c" }
  ] } };
  assert.deepEqual(logosDaFandom(json, "Hyperia City").map((c) => c.nome), ["Hyperia_City.png"]);
  assert.deepEqual(logosDaFandom(json, "Attack of the Vine!"), []);
});

// ── FAB ─────────────────────────────────────────────────────────────────────
test("FAB: casa pelo código e, sem abreviação no TCGplayer, pelo nome exato", () => {
  const sets = [
    { id: "SEA", name: "High Seas", printings: [{ set_logo: "https://cdn/high_seas.png" }] },
    { id: "AGB", name: "Armory Deck - Gravy Bones", printings: [{ set_logo: "https://cdn/gb.png" }] },
    { id: "AOL", name: "Armory Deck - Olympia", printings: [{}] },
    { id: "RVD", name: "Classic Battles", printings: [{ set_logo: "https://cdn/cb.png" }] },
    { id: "DVR", name: "Classic Battles", printings: [{ set_logo: "https://cdn/cb.png" }] }
  ];
  assert.deepEqual(logoDoFabCube(sets, { setId: "SEA", nome: "x" }), { codigo: "SEA", nome: "High Seas", url: "https://cdn/high_seas.png", por: "código" });
  assert.equal(logoDoFabCube(sets, { setId: "24266", nome: "High Seas" }).codigo, "SEA");
  assert.equal(logoDoFabCube(sets, { setId: "24268", nome: "Armory Deck: Gravy Bones" }).codigo, "AGB");
  assert.equal(logoDoFabCube(sets, { setId: "AOL", nome: "Armory Deck: Olympia" }), null); // sem set_logo
  assert.equal(logoDoFabCube(sets, { setId: "1", nome: "Classic Battles" }), null);       // ambíguo
});

// ── Imagem ──────────────────────────────────────────────────────────────────
// 60×20: um "logo" de três palavras separadas (blocos), pontinhos soltos e véu.
function imagemDeTeste() {
  const L = 60, A = 20, px = new Uint8ClampedArray(L * A * 4);
  const pinta = (x0, y0, x1, y1, a = 255) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * L + x) * 4; px[i] = 200; px[i + 3] = a; } };
  pinta(10, 5, 29, 14);   // palavra grande (200 px)
  pinta(32, 8, 40, 14);   // palavra média (63 px)
  pinta(43, 10, 47, 14);  // palavra pequena (25 px)
  pinta(2, 2, 2, 2);      // pontinho solto
  pinta(57, 18, 57, 18);  // outro
  pinta(0, 19, 59, 19, 5); // véu (alfa 5) na base inteira
  return { px, L, A };
}

test("alfa: tira véu e pontinho, mantém as palavras separadas e recorta", () => {
  const { px, L, A } = imagemDeTeste();
  const r = limpaAlfa(px, L, A, { fracaoMancha: 0.02 });
  assert.equal(r.veu, 60);
  assert.equal(r.manchas, 2);
  assert.deepEqual(r.caixa, { x0: 10, y0: 5, x1: 47, y1: 14, largura: 38, altura: 10 });
  assert.equal(px[(2 * L + 2) * 4 + 3], 0);   // pontinho apagado
  assert.equal(px[(10 * L + 45) * 4 + 3], 255); // palavra pequena intacta
});

test("alfa: o limiar padrão (0,05% da maior) não come a menor palavra", () => {
  const { px, L, A } = imagemDeTeste();
  const r = limpaAlfa(px, L, A);
  assert.equal(r.manchas, 0); // 1 px de 200 px = 0,5% > 0,05%: aqui nada é mancha
  assert.equal(r.caixa.x0, 2);
});

test("encaixe e mesma arte", () => {
  assert.deepEqual(encaixa(375, 244, 970, 470, { aumenta: true }), { largura: 722, altura: 470 });
  assert.deepEqual(encaixa(815, 189, 1000, 100000), { largura: 815, altura: 189 });
  assert.ok(mesmaArte({ largura: 375, altura: 244 }, { largura: 638, altura: 414 }));
  assert.ok(!mesmaArte({ largura: 375, altura: 244 }, { largura: 600, altura: 600 }));
});

test("nomes: apóstrofo curvo, acento e caixa não importam", () => {
  assert.equal(norm("THE WORLD’S STRONGEST WARRIORS"), norm("The World's Strongest Warriors"));
  assert.equal(norm("Armory Deck Origins - Jarl Vetreiði"), "armory deck origins jarl vetreidi");
});
