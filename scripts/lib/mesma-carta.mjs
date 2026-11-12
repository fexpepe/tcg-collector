// Matriz alternativa do espelho de imagens: a _hires da pokemontcg.io pras
// cartas EN que o catálogo mostra pela TCGdex — e a checagem de que as duas
// imagens são a MESMA carta antes de trocar uma pela outra.
//
// Por quê (12/11/2026, geração 3 da TCGdex — ver scripts/lib/img-mirror.mjs):
// o high.png da TCGdex é uma paleta de 256 cores em 600×825; a pokemontcg.io
// publica a imagem oficial em cor cheia, 733×1024 nos sets modernos (600×825
// em RGB nos antigos). É a que o Collectr usa.
//
// Por que conferir: a URL da pokemontcg.io sai de um de-para (set-id-map +
// número impresso) que até hoje só servia de FALLBACK, quando a TCGdex não tem
// a imagem. Como matriz, um de-para errado (subset TG/GG, promo, numeração
// própria) poria a arte de OUTRA carta no lugar, em silêncio. Então o job
// compara as duas imagens numa grade de cinza 24×33 e só aceita a
// alternativa quando a região da arte (10% a 50% da altura) bate.
//
// Calibração (80 cartas EN sorteadas, uma por set, do Base Set ao Mega
// Evolution): mesma carta deu correlação da arte entre 0,932 e 1,000; a carta
// VIZINHA do mesmo set (mesma moldura, arte diferente) deu no máximo 0,692. A
// carta inteira não separa (0,877 × 0,877: a moldura e a caixa de texto pesam
// mais que a arte). O corte fica em 0,85, no meio do vão. Na mesma amostra 2
// imagens da pokemontcg.io eram MENORES que a da TCGdex (400×550) — por isso
// a alternativa também precisa ter pelo menos a largura da TCGdex.
//
// A parte pura (correlacao, aceitaAlternativa, alternativaDe) é testada em
// tests/mesma-carta.test.mjs; a que decodifica imagem recebe o sharp de quem
// chama (o job instala o sharp fora do repositório).
import { pokemontcgImageUrl } from "./pokemontcg-image.mjs";

export const ASSINATURA_W = 24;
export const ASSINATURA_H = 33;
export const FAIXA_ARTE = [0.1, 0.5];
export const CORRELACAO_MINIMA = 0.85;
// Proporção (largura/altura) das duas imagens: a TCGdex é 600/825 = 0,727 e a
// pokemontcg.io 734/1024 = 0,717 (1,4%). 5% de folga separa isso de um scan
// recortado diferente ou de carta deitada.
export const PROPORCAO_TOLERANCIA = 0.05;

// URL da alternativa pra uma carta do catálogo (a `linha` do D1: language,
// set_id, number) cuja imagem `url` é da TCGdex em inglês. Só EN: a PT
// compartilha a numeração e a arte, mas o texto da carta é em português — a
// imagem EN no lugar seria carta errada. "" = sem alternativa.
export function alternativaDe(linha, url, setIdMap) {
  if (!linha || linha.language !== "en") return "";
  if (!/^https:\/\/assets\.tcgdex\.net\/en\//.test(String(url || ""))) return "";
  return pokemontcgImageUrl({ language: "en", setId: linha.set_id, number: linha.number }, setIdMap, true);
}

// Correlação de Pearson entre duas grades de cinza W×H (Uint8Array/Buffer),
// nas linhas da faixa [y0, y1) (frações da altura) e sem a primeira e a
// última coluna (canto arredondado e borda de scan).
export function correlacao(a, b, W, H, y0, y1) {
  const ini = Math.floor(y0 * H), fim = Math.ceil(y1 * H);
  let n = 0, sa = 0, sb = 0;
  for (let y = ini; y < fim; y++) for (let x = 1; x < W - 1; x++) { sa += a[y * W + x]; sb += b[y * W + x]; n++; }
  if (!n) return 0;
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let y = ini; y < fim; y++) for (let x = 1; x < W - 1; x++) {
    const da = a[y * W + x] - ma, db = b[y * W + x] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  // Região lisa nas duas (variância zero): não há como dizer que é a mesma.
  return va && vb ? cov / Math.sqrt(va * vb) : 0;
}

// Decisão, dada a medida das duas imagens: { ok, motivo }.
export function aceitaAlternativa({ base, alt, corr }) {
  if (!base || !alt || !base.w || !base.h || !alt.w || !alt.h) return { ok: false, motivo: "sem dimensão" };
  if (alt.w < base.w) return { ok: false, motivo: "menor" };
  const pb = base.w / base.h, pa = alt.w / alt.h;
  if (Math.abs(pa - pb) / pb > PROPORCAO_TOLERANCIA) return { ok: false, motivo: "proporção" };
  if (!(corr >= CORRELACAO_MINIMA)) return { ok: false, motivo: "outra carta" };
  return { ok: true, motivo: "" };
}

// Dimensões e grade de cinza de uma imagem (fundo branco no lugar do alfa).
export async function assinatura(sharp, buf) {
  const img = sharp(buf);
  const { width: w, height: h } = await img.metadata();
  const cinza = await sharp(buf).flatten({ background: "#ffffff" })
    .resize(ASSINATURA_W, ASSINATURA_H, { fit: "fill" }).greyscale().raw().toBuffer();
  return { w, h, cinza };
}

// A alternativa serve no lugar da base? { ok, motivo, corr }.
export async function comparaAlternativa(sharp, bufBase, bufAlt) {
  const [base, alt] = await Promise.all([assinatura(sharp, bufBase), assinatura(sharp, bufAlt)]);
  const corr = correlacao(base.cinza, alt.cinza, ASSINATURA_W, ASSINATURA_H, FAIXA_ARTE[0], FAIXA_ARTE[1]);
  return { ...aceitaAlternativa({ base, alt, corr }), corr };
}
