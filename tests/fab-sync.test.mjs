// Logo de set do sync do Flesh and Blood (scripts/sync-fab.mjs), sem rede.
// Os arquivos de data/fab/set-logos/ levam o código IMPRESSO do set ("1HB",
// "AIO"), mas o setId do TCGplayer é o número do grupo ("23760") ou uma sigla
// própria ("ADD"): só o setId deixava nove sets sem logo com o arquivo no disco
// (conferido em 2026-11-22). Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { arquivoDoLogo } from "../scripts/sync-fab.mjs";

const cartas = (prefixo, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ number: `${prefixo}${String(i).padStart(3, "0")}`, ...extra }));
const comArquivos = (...codigos) => (arquivo) => codigos.includes(arquivo);

test("logo do FAB: o setId continua valendo primeiro", () => {
  assert.equal(arquivoDoLogo("WTR", cartas("WTR", 200), comArquivos("WTR")), "data/fab/set-logos/WTR.webp");
  // Mesmo com o set pequeno: é o caminho de sempre, sem a trava.
  assert.equal(arquivoDoLogo("WTR", cartas("WTR", 2), comArquivos("WTR")), "data/fab/set-logos/WTR.webp");
});

test("logo do FAB: sem achar pelo setId, tenta o código impresso nos números", () => {
  // setId = número do grupo do TCGplayer; o arquivo leva o código impresso.
  assert.equal(arquivoDoLogo("23760", cartas("1HB", 27), comArquivos("1HB")), "data/fab/set-logos/1HB.webp");
  // setId = sigla do TCGplayer diferente da impressa (ADD x AIO).
  assert.equal(arquivoDoLogo("ADD", cartas("AIO", 27), comArquivos("AIO")), "data/fab/set-logos/AIO.webp");
});

test("logo do FAB: as travas — mais de 5 cartas, arquivo existente, prefixo dominante", () => {
  // 5 cartas ou menos: sem logo (um set pequeno pegaria o prefixo de outro).
  assert.equal(arquivoDoLogo("24915", cartas("OUT", 5), comArquivos("OUT")), null);
  assert.equal(arquivoDoLogo("24915", cartas("OUT", 6), comArquivos("OUT")), "data/fab/set-logos/OUT.webp");
  // Código impresso sem arquivo: sem logo, nada inventado.
  assert.equal(arquivoDoLogo("22898", cartas("ARA", 29), comArquivos()), null);
  // Set misturado (nenhum prefixo em 60% das cartas): sem logo. É o caso das promos.
  const mistas = [...cartas("WTR", 10), ...cartas("ARC", 10), ...cartas("CRU", 10)];
  assert.equal(arquivoDoLogo("PR", mistas, comArquivos("WTR", "ARC", "CRU")), null);
  // Número que não é do padrão do FAB (ex.: o código do grupo): sem logo.
  assert.equal(arquivoDoLogo("24000", Array.from({ length: 20 }, (_, i) => ({ number: String(i) })), comArquivos("000")), null);
});

test("logo do FAB: no catálogo de hoje os nove sets ganham logo", () => {
  const s = readFileSync(new URL("../data/fab/cards.js", import.meta.url), "utf8");
  const todas = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
  const porSet = new Map();
  for (const c of todas) { if (!porSet.has(c.setId)) porSet.set(c.setId, []); porSet.get(c.setId).push(c); }
  const existe = (arquivo) => existsSync(new URL(`../data/fab/set-logos/${arquivo}.webp`, import.meta.url));
  const novos = {};
  for (const [setId, cs] of porSet) {
    const novo = arquivoDoLogo(setId, cs, existe);
    const velho = existe(setId) ? `data/fab/set-logos/${setId}.webp` : null;
    if (novo && !velho) novos[cs[0].set] = novo.replace(/^data\/fab\/set-logos\/|\.webp$/g, "");
  }
  const esperados = {
    "Historic Pack 1 Blitz Deck: Bravo": "1HB",
    "Historic Pack 1 Blitz Deck: Dash": "1HD",
    "Historic Pack 1 Blitz Deck: Dorinthea": "1HT",
    "Historic Pack 1 Blitz Deck: Kano": "1HK",
    "Historic Pack 1 Blitz Deck: Rhinar": "1HR",
    "Historic Pack 1 Blitz Deck: Viserai": "1HV",
    "Armory Deck: Dash": "AIO",
    "Armory Deck: Jarl Vetreidi": "AJV",
    "Armory Deck: Maxx Nitro": "AMX"
  };
  // Inclusão, e não igualdade: set novo com logo espelhado depois pode entrar
  // legitimamente; o que não pode é sumir um destes nove.
  for (const [nome, arquivo] of Object.entries(esperados)) assert.equal(novos[nome], arquivo, nome);
});
