// Matriz alternativa do espelho (scripts/lib/mesma-carta.mjs): a _hires da
// pokemontcg.io no lugar do png de 256 cores da TCGdex, só nas cartas EN e só
// quando é a MESMA carta. A parte que decodifica imagem precisa do sharp (que
// o CI não instala); aqui vai a parte pura — a URL e a decisão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ASSINATURA_H, ASSINATURA_W, CORRELACAO_MINIMA, FAIXA_ARTE, aceitaAlternativa, alternativaDe, correlacao } from "../scripts/lib/mesma-carta.mjs";

const MAPA = { me02: "me2", "sv03.5": "sv3pt5" };
const linha = (o) => ({ language: "en", set_id: "me02", number: "001", ...o });
const TCGDEX_EN = "https://assets.tcgdex.net/en/me/me02/001/high.png";

test("alternativa: só carta EN com imagem da TCGdex EN, pelo set-id-map e sem zeros à esquerda", () => {
  assert.equal(alternativaDe(linha(), TCGDEX_EN, MAPA), "https://images.pokemontcg.io/me2/1_hires.png");
  assert.equal(alternativaDe(linha({ set_id: "sv03.5", number: "006" }), "https://assets.tcgdex.net/en/sv/sv03.5/006/high.png", MAPA),
    "https://images.pokemontcg.io/sv3pt5/6_hires.png");
  // PT divide a numeração e a arte com a EN, mas o texto é outro: carta errada.
  assert.equal(alternativaDe(linha({ language: "pt" }), "https://assets.tcgdex.net/pt/me/me02/001/high.png", MAPA), "");
  assert.equal(alternativaDe(linha({ language: "ja" }), TCGDEX_EN, MAPA), "");
  // Carta EN cuja imagem já é de outro host (a própria pokemontcg.io, TCGplayer…).
  assert.equal(alternativaDe(linha(), "https://images.pokemontcg.io/me2/1.png", MAPA), "");
  assert.equal(alternativaDe(null, TCGDEX_EN, MAPA), "");
  assert.equal(alternativaDe(linha({ number: "" }), TCGDEX_EN, MAPA), "");
});

// Grade de cinza sintética: `arte(x, y)` só na faixa da arte; o resto (moldura,
// texto) igual em todas — o caso difícil, duas cartas do mesmo set.
function grade(arte) {
  const g = new Uint8Array(ASSINATURA_W * ASSINATURA_H);
  for (let y = 0; y < ASSINATURA_H; y++) for (let x = 0; x < ASSINATURA_W; x++) {
    // Mesmas linhas que a correlacao() lê (floor do início, ceil do fim).
    const naArte = y >= Math.floor(FAIXA_ARTE[0] * ASSINATURA_H) && y < Math.ceil(FAIXA_ARTE[1] * ASSINATURA_H);
    g[y * ASSINATURA_W + x] = naArte ? arte(x, y) : (y % 3 ? 200 : 40);
  }
  return g;
}
const corr = (a, b) => correlacao(a, b, ASSINATURA_W, ASSINATURA_H, FAIXA_ARTE[0], FAIXA_ARTE[1]);

test("correlação da arte: mesma arte com ruído passa; outra arte na mesma moldura não", () => {
  const a = grade((x, y) => (x * 9 + y * 5) % 256);
  const ruido = grade((x, y) => Math.min(255, ((x * 9 + y * 5) % 256) + ((x * 7 + y * 3) % 11)));
  const outra = grade((x, y) => (x * 3 + y * 17 + 90) % 256);
  assert.ok(corr(a, a) > 0.999);
  assert.ok(corr(a, ruido) >= CORRELACAO_MINIMA, `ruído: ${corr(a, ruido)}`);
  assert.ok(corr(a, outra) < CORRELACAO_MINIMA, `outra: ${corr(a, outra)}`);
  // Região lisa nas duas: sem variância não dá pra afirmar nada.
  const lisa = grade(() => 128);
  assert.equal(corr(lisa, lisa), 0);
});

test("decisão: aceita só a mesma carta, do mesmo formato e pelo menos do tamanho da TCGdex", () => {
  const base = { w: 600, h: 825 };
  assert.deepEqual(aceitaAlternativa({ base, alt: { w: 734, h: 1024 }, corr: 0.99 }), { ok: true, motivo: "" });
  assert.equal(aceitaAlternativa({ base, alt: { w: 600, h: 825 }, corr: 0.95 }).ok, true);    // sets antigos: mesmo tamanho, cor cheia
  assert.equal(aceitaAlternativa({ base, alt: { w: 400, h: 550 }, corr: 0.99 }).motivo, "menor");
  assert.equal(aceitaAlternativa({ base, alt: { w: 1024, h: 734 }, corr: 0.99 }).motivo, "proporção");
  assert.equal(aceitaAlternativa({ base, alt: { w: 734, h: 1024 }, corr: 0.69 }).motivo, "outra carta");
  assert.equal(aceitaAlternativa({ base, alt: { w: 734, h: 1024 }, corr: NaN }).motivo, "outra carta");
  assert.equal(aceitaAlternativa({ base, alt: null, corr: 1 }).ok, false);
});

test("job: carta EN da TCGdex leva a alternativa, e o índice guarda de onde a matriz saiu", () => {
  const job = readFileSync(new URL("../scripts/mirror-r2.mjs", import.meta.url), "utf8");
  assert.ok(job.includes('const alt = game === "pokemon" ? alternativaDe(c.linha, u, setIdMap) : "";'));
  assert.ok(job.includes("const GERACAO = geracaoDoHost(host);"), "geração por host, não a global");
  assert.ok(job.includes('if (o.alt && tem[4] === "t" && tem[2] < diasAtras(FALTANDO_DIAS))'), "a que ficou na TCGdex tenta de novo");
  // 5º campo: a fonte ("" sem alternativa); 6º: a 450 saiu junto (14/11/2026).
  assert.ok(job.includes('idx.objetos[base] = [matriz.length, o.versao, HOJE, GERACAO, fonte, 1];'));
});
