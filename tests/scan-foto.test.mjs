// Conferência pela IMAGEM do scanner (src/scan.js): quando o código impresso
// casa com mais de uma carta — o One Piece imprime o MESMO "EB01-006" na
// comum, na Alternate Art e na Manga —, a foto decide qual vem primeiro.
//
// O que se trava aqui é a matemática e a regra de decisão, com imagens
// sintéticas (a calibração com cartas reais está no docs/PLANO-SCANNER.md):
//   - a assinatura ignora brilho e tom de lâmpada, e distingue arte diferente;
//   - a busca por recortes acha a carta dentro do quadro, fora de esquadro;
//   - a ordem só muda com diferença CLARA — empate (mesma arte, foil ou
//     carimbo diferente) deixa a ordem da busca, e a foto nunca tira do
//     primeiro lugar uma carta que ela não consegue julgar.
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
// Arrays do outro realm do vm: copiar antes do deepEqual (ver ferramentas.test).
const arr = (x) => JSON.parse(JSON.stringify(x));

// Imagem RGBA sintética: `cor(x, y)` devolve [r, g, b] em coordenadas 0-1.
function imagem(w, h, cor) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = cor(x / w, y / h);
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  return { px, w, h };
}
// Duas "cartas" com a mesma moldura e arte diferente no meio (o caso da
// comum × Alternate Art): a moldura vermelha e a caixa de texto clara são
// iguais; muda o que está na janela da arte.
const moldura = (arte) => (x, y) => {
  if (x < 0.06 || x > 0.94 || y < 0.05 || y > 0.95) return [200, 30, 40];
  if (y > 0.62) return [235, 230, 220];
  return arte(x, y);
};
const comum = moldura((x, y) => [240, 150 + 80 * y, 190]); // fundo rosa, degradê suave
const alternativa = moldura((x, y) => [60 + 120 * x, 170, 80 + 60 * Math.sin(y * 9)]); // verde com faixas
const manga = moldura((x, y) => { const v = 128 + 110 * Math.sin(x * 40) * Math.sin(y * 30); return [v, v, v]; }); // quadrinho cinza

const assinaturaInteira = (im) => {
  const ii = S.integral(im.px, im.w, im.h);
  return S.assinatura(ii, 0, 0, ii.w, ii.h);
};

test("assinatura: a mesma carta com outro brilho e outro tom de lâmpada continua a mesma", () => {
  const ref = assinaturaInteira(imagem(112, 156, comum));
  const escura = assinaturaInteira(imagem(112, 156, (x, y) => comum(x, y).map((v) => v * 0.7)));
  const amarelada = assinaturaInteira(imagem(112, 156, (x, y) => { const [r, g, b] = comum(x, y); return [r * 1.08 + 10, g + 6, b * 0.85]; }));
  assert.ok(S.semelhanca(ref, ref) > 0.999, "a carta tem de ser igual a ela mesma");
  assert.ok(S.semelhanca(ref, escura) > 0.97, "brilho não pode mudar a assinatura");
  assert.ok(S.semelhanca(ref, amarelada) > 0.9, "o tom da lâmpada não pode mudar a assinatura");
});

test("assinatura: arte diferente na mesma moldura fica longe; imagem lisa não tem assinatura", () => {
  const a = assinaturaInteira(imagem(112, 156, comum));
  const b = assinaturaInteira(imagem(112, 156, alternativa));
  const c = assinaturaInteira(imagem(112, 156, manga));
  assert.ok(S.semelhanca(a, b) < 0.85, `comum × alternativa parecidas demais: ${S.semelhanca(a, b)}`);
  assert.ok(S.semelhanca(a, c) < 0.85, `comum × manga parecidas demais: ${S.semelhanca(a, c)}`);
  // Parede, tela preta: nada a comparar — e não um vetor de zeros que empata com tudo.
  assert.equal(assinaturaInteira(imagem(112, 156, () => [90, 90, 90])), null);
  // Retângulo fora da imagem também não vira assinatura.
  const ii = S.integral(imagem(40, 56, comum).px, 40, 56);
  assert.equal(S.assinatura(ii, 10, 10, 40, 56), null);
});

// A carta dentro do recorte da moldura: menor que o quadro, deslocada, sobre
// uma mesa. É o que a câmera entrega (a carta fica ENTRE as duas molduras).
function fotoNoQuadro(carta, escala, dx, dy) {
  const W = 128, H = Math.round((128 * 88) / 63);
  const cw = W * escala, ch = (cw * 88) / 63;
  const x0 = (W - cw) / 2 + dx * W, y0 = (H - ch) / 2 + dy * H;
  return imagem(W, H, (x, y) => {
    const u = (x * W - x0) / cw, v = (y * H - y0) / ch;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return [70 + 30 * Math.sin(x * 50), 55, 40]; // madeira
    return carta(u, v);
  });
}

test("recortes: acham a carta fora de esquadro e escolhem a arte certa", () => {
  const refs = [comum, alternativa, manga].map((c) => assinaturaInteira(imagem(112, 156, c)));
  const RECORTES = { escalas: [0.78, 0.84, 0.9, 0.96], passos: [-0.03, 0, 0.03] };
  for (const [verdade, carta] of [[0, comum], [1, alternativa], [2, manga]]) {
    for (const [escala, dx, dy] of [[0.86, 0, 0], [0.8, 0.02, -0.02], [0.92, -0.025, 0.02]]) {
      const im = fotoNoQuadro(carta, escala, dx, dy);
      const fotos = S.assinaturasDoQuadro(S.integral(im.px, im.w, im.h), RECORTES);
      assert.ok(fotos.length > 20, "a grade de recortes sumiu");
      const sims = refs.map((r) => Math.max.apply(null, fotos.map((f) => S.semelhanca(f, r))));
      const melhor = sims.indexOf(Math.max.apply(null, sims));
      assert.equal(melhor, verdade, `escala ${escala}: esperava ${verdade}, deu ${melhor} (${sims.map((s) => s.toFixed(2))})`);
      assert.ok(sims[verdade] > 0.8, `a própria carta ficou pouco parecida: ${sims[verdade].toFixed(2)}`);
    }
  }
});

test("ordem: a foto só troca o 1º com diferença clara", () => {
  // A Manga (índice 2) é bem mais parecida: vai pra frente, o resto por semelhança.
  let o = S.ordemPelaFoto([0.55, 0.3, 0.82]);
  assert.deepEqual(arr(o), { ordem: [2, 0, 1], mudou: true, claro: true });
  // Diferença pequena (abaixo da margem): o 1º da busca fica.
  o = S.ordemPelaFoto([0.8, 0.84, 0.4]);
  assert.equal(o.mudou, false);
  assert.equal(o.claro, false, "0,8 contra 0,84 não é decisão da foto");
  assert.equal(o.ordem[0], 0);
  // Mesmo sem mudar o 1º, a folha "+N opções" sai por semelhança.
  assert.deepEqual(arr(o.ordem), [0, 1, 2]);
  assert.deepEqual(arr(S.ordemPelaFoto([0.8, 0.4, 0.78]).ordem), [0, 2, 1]);
});

test("ordem: empate entre os mais parecidos fica com quem vinha antes na busca", () => {
  // Comum (0) errada; a Alternate Art (1) e a reimpressão dela (3), mesma
  // arte, empatam: vence a 1, que a busca pôs antes.
  const o = S.ordemPelaFoto([0.4, 0.86, 0.3, 0.87]);
  assert.equal(o.mudou, true);
  assert.equal(o.ordem[0], 1);
  // A foto tirou a comum, mas não separa as duas de mesma arte: não é "claro".
  assert.equal(o.claro, false);
  // O 1º da busca confirmado com folga sobre todos: claro, sem mudar.
  assert.deepEqual(arr(S.ordemPelaFoto([0.9, 0.5, 0.4])), { ordem: [0, 1, 2], mudou: false, claro: true });
});

test("ordem: sem como julgar, a ordem da busca fica inteira", () => {
  const id = (sims) => arr(S.ordemPelaFoto(sims));
  // A imagem do 1º não chegou: a foto não pode tirá-lo do lugar.
  assert.deepEqual(id([null, 0.9, 0.2]), { ordem: [0, 1, 2], mudou: false, claro: false });
  // Só uma nota: nada a comparar.
  assert.deepEqual(id([0.9, null, null]), { ordem: [0, 1, 2], mudou: false, claro: false });
  // A foto não se parece com nenhuma (parede, dedo na frente): abaixo do piso.
  assert.deepEqual(id([0.1, 0.25, 0.05]), { ordem: [0, 1, 2], mudou: false, claro: false });
  // Um candidato só.
  assert.deepEqual(id([0.9]), { ordem: [0], mudou: false, claro: false });
  // Quem ficou sem nota vai pro fim, na ordem da busca.
  assert.deepEqual(id([0.3, null, 0.9, null, 0.5]).ordem, [2, 4, 0, 1, 3]);
});

test("o scanner confere pela foto ANTES de mostrar e conta o que a pessoa corrige", () => {
  // A conferência roda entre a busca e o entregar (a carta não troca depois
  // de aparecer) e só com mais de um candidato.
  assert.match(scanSrc, /achados\.length > 1\) \{[\s\S]{0,200}?conferirPelaFoto\(fonte, rec, achados\)[\s\S]{0,300}?entregar\(codigo, achados, foto/);
  // A galeria procura a carta num leque maior de posições.
  assert.match(scanSrc, /ler\(img, \{[^}]*galeria: true/);
  // O resumo da sessão leva a precisão, e os contadores são somados onde a
  // pessoa age: trocar o 1º (uma vez por leitura) e buscar digitando.
  const m = /logEvento\("scan_done",\s*\{([\s\S]{0,240}?)\}\)/.exec(scanSrc);
  assert.ok(m, "não achei o payload do scan_done");
  for (const campo of ["amb", "vis", "troca", "dig"]) assert.match(m[1], new RegExp(`\\b${campo}:`), `scan_done sem "${campo}"`);
  assert.match(scanSrc, /if \(i !== primario && trocaConta\) \{ funil\.troca \+= 1; trocaConta = false; \}/);
  assert.match(scanSrc, /preventDefault\(\);\s*funil\.dig \+= 1;/);
});

test("a migração 20260928b recria a admin_funnel sem perder nada e fechada pra fora", () => {
  const raiz = join(here, "..");
  const nova = readFileSync(join(raiz, "supabase/migrations/20260928b_scanner_precisao.sql"), "utf8");
  const velha = readFileSync(join(raiz, "supabase/migrations/20260923a_analytics_v2.sql"), "utf8");
  const fn = (sql) => /create or replace function public\.admin_funnel[\s\S]*?end \$\$;/.exec(sql)[0];
  // Toda chave do jsonb de antes continua (o admin.js lê todas).
  const chaves = (s) => new Set((s.match(/'[a-z_0-9]+',\s/g) || []).map((k) => k.trim().replace(/,$/, "")));
  for (const k of chaves(fn(velha))) assert.ok(chaves(fn(nova)).has(k), `a admin_funnel nova perdeu ${k}`);
  for (const k of ["'ambiguas'", "'pela_foto'", "'trocou'", "'digitou'"]) assert.ok(fn(nova).includes(k), `sem ${k}`);
  // Mesmo gate e mesma porta fechada.
  assert.match(nova, /where user_id = auth\.uid\(\) and is_admin/);
  assert.match(nova, /revoke all on function public\.admin_funnel\(int\) from public, anon;/);
  assert.match(nova, /grant execute on function public\.admin_funnel\(int\) to authenticated;/);
  // Número vindo do navegador só entra se for número (o resto conta zero).
  for (const p of ["amb", "vis", "troca", "dig"]) {
    assert.match(nova, new RegExp(`props->>'${p}'\\s*~ '\\^\\[0-9\\]\\{1,7\\}\\\\Z' then \\(props->>'${p}'\\)::int`));
  }
});
