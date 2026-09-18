// Passo do deploy: APOSENTA o set que entrou por import (pin `enImport` da
// TCGCSV) depois que a TCGdex publicou o MESMO set com outro setId — e registra
// o de-para de id, pra ninguém perder a carta que marcou nesse meio-tempo.
//
// Por que existe (18/09/2026): o "30th Celebration" entrou em 16/09 como
// `cel30`/`cel30cc`, ids escolhidos à mão na aposta de que a TCGdex usaria os
// mesmos. Ela usou `30th`/`30th-c`, e como a única guarda do pin era o id
// EXATO, os chunks dela nasceram AO LADO dos nossos: a tela de Sets passou a
// mostrar 4 coleções de 30 anos onde existem 2. Quem ganha é sempre a TCGdex —
// o id dela é o canônico (as edições PT/ZH chegam com ele, o de-para do
// pokemontcg.io é indexado por ele) e o dado é melhor (artista, tipo, estágio).
//
//   node scripts/retire-imported-sets.mjs              # aposenta e carimba
//   node scripts/retire-imported-sets.mjs --dry-run    # só diz o que faria
//
// Roda em TODO build (sem rede), DEPOIS do sync-tcgdex — que é quem traz o
// chunk novo — e ANTES do sync da TCGCSV e do merge, senão o pin reimportaria o
// set apagado na mesma rodada. Três coisas num passo só porque são a mesma:
//
//   1. APOSENTADORIA. Chunk importado com um irmão da TCGdex (metade dos nomes
//      de carta em mão dupla — ver lib/set-supersede.mjs) sai de data/sets, e o
//      par de ids vai pro data/card-id-merges.json, que é VERSIONADO (o passo
//      "Versiona snapshot" commita data/ inteiro). Tem que ser versionado: o
//      chunk velho desaparece nesta rodada e nenhum build futuro conseguiria
//      recalcular o de-para.
//   2. ATIVO CURADO. Logo e símbolo curados vivem em
//      data/set-logos/<idioma>/<setId>.webp, indexados pelo setId — o do 30 anos
//      foi enviado à mão justamente porque a TCGdex não tem arte desses sets
//      (c338e5a). Trocar o id sem renomear o arquivo deixava o tile cair no
//      fallback de TEXTO, desfazendo aquele conserto dois dias depois.
//   3. CARIMBO. O de-para acumulado é injetado no src/shared.js (marcador
//      SLEEVU_ID_MERGES, mesmo padrão do apply-img-mirror), pra a migração da
//      conta não custar uma requisição por página. Roda mesmo sem aposentar
//      nada — inclusive no build rápido, que não sincroniza —, então o arquivo
//      versionado é sempre a última carimbada e a fonte da verdade é o JSON.
//
// É só do Pokémon: `enImport` existe só lá, e é o único jogo com chunk por
// idioma (data/sets/<idioma>/<set>.json).
import { readdir, readFile, writeFile, unlink, rename, access } from "node:fs/promises";
import { findSupersededImports, isPrefixSwap } from "./lib/set-supersede.mjs";

const RAIZ = new URL("../", import.meta.url);
const SETS = new URL("data/sets/", RAIZ);
const MERGES = new URL("data/card-id-merges.json", RAIZ);
const DRY = process.argv.includes("--dry-run");

async function leJson(url, padrao) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return padrao; }
}
async function existe(url) {
  try { await access(url); return true; } catch { return false; }
}

// Só o import EN entra na conta. O import JP inteiro usa o CÓDIGO do set que a
// TCGdex também usa ("M6a"), então quando ela publica o set cai no mesmo chunk
// e não há duplicata — o id de lá não é chute, é o código impresso na embalagem.
const pins = await leJson(new URL("data/tcgcsv-set-map.json", RAIZ), {});
const importados = new Set((Array.isArray(pins.enImport) ? pins.enImport : [])
  .filter((e) => e && e.setId).map((e) => e.setId));

const chunks = [];
for (const lang of await readdir(SETS)) {
  let arquivos;
  try { arquivos = (await readdir(new URL(`${lang}/`, SETS))).filter((f) => f.endsWith(".json")); } catch { continue; }
  for (const f of arquivos) {
    const cards = await leJson(new URL(`${lang}/${f}`, SETS), null);
    if (Array.isArray(cards) && cards.length) chunks.push({ lang, setId: f.replace(/\.json$/, ""), cards });
  }
}

const merges = await leJson(MERGES, null) || {
  _: "De-para de cardId de set importado que a TCGdex publicou com OUTRO setId (scripts/retire-imported-sets.mjs). sets: histórico das aposentadorias. prefixes: troca só do prefixo do cardId, quando a numeração bateu inteira (cel30-001 -> 30th-001). cards: par a par, quando a numeração mudou (o Classic Collection é numerado em sequência pela TCGdex e pelo número original no TCGplayer). images: arte que só o chunk importado tinha, carimbada pelo merge-catalogs enquanto a TCGdex não publicar a dela. NADA sai daqui: o id é a única ponte entre a coleção de alguém e uma carta, e conta antiga volta meses depois.",
  sets: [], prefixes: {}, cards: {}, images: {}
};

const achados = findSupersededImports(chunks, importados);
let aposentados = 0;
for (const r of achados) {
  if (r.ambiguous) {
    console.warn(`  retire-imported-sets: ${r.lang}/${r.from} parece o mesmo set que ${r.ambiguous.join(" e ")} — EMPATE, nada apagado (pinar à mão)`);
    continue;
  }
  const pares = Object.keys(r.cards).length;
  const prefixo = isPrefixSwap(r.cards, r.from, r.to);
  console.log(`  retire-imported-sets: ${r.lang}/${r.from} -> ${r.to} (${(r.similarity * 100).toFixed(1)}% dos nomes, ${pares} carta(s)${prefixo ? ", troca de prefixo" : ""}${r.unmatched.length ? `, ${r.unmatched.length} sem par` : ""})`);
  if (r.unmatched.length) console.warn(`    sem par (id perdido pra quem marcou): ${r.unmatched.join(", ")}`);
  if (DRY) continue;
  merges.sets.push({ from: r.from, to: r.to, lang: r.lang, at: new Date().toISOString().slice(0, 10), cards: pares });
  if (prefixo) merges.prefixes[r.from] = r.to;
  else Object.assign(merges.cards, r.cards);
  Object.assign(merges.images, r.images);
  await unlink(new URL(`${r.lang}/${r.from}.json`, SETS));
  for (const pasta of [r.lang, "symbol"]) {
    const de = new URL(`data/set-logos/${pasta}/${r.from}.webp`, RAIZ);
    const para = new URL(`data/set-logos/${pasta}/${r.to}.webp`, RAIZ);
    if (!(await existe(de)) || await existe(para)) continue;
    await rename(de, para);
    console.log(`    ativo curado renomeado: set-logos/${pasta}/${r.from}.webp -> ${r.to}.webp`);
  }
  aposentados++;
}

if (aposentados) {
  await writeFile(MERGES, JSON.stringify(merges, null, 1) + "\n", "utf8");
  console.log(`  retire-imported-sets: ${aposentados} chunk(s) apagado(s); data/card-id-merges.json com ${merges.sets.length} aposentadoria(s)`);
}

// Carimbo no src/shared.js. O payload é enxuto de propósito (a troca de prefixo
// cobre um set inteiro numa linha) porque vai no núcleo, que tem teto de peso.
const arquivo = new URL("src/shared.js", RAIZ);
const src = await readFile(arquivo, "utf8");
const marca = /const ID_MERGES = \{[^;]*\}; \/\* SLEEVU_ID_MERGES \*\//;
if (!marca.test(src)) {
  console.error("retire-imported-sets: marcador SLEEVU_ID_MERGES não encontrado em src/shared.js.");
  process.exit(1);
}
// s: de-para de setId (link de set compartilhado com o id velho); p: troca de
// prefixo de cardId; c: cardId par a par.
const payload = {
  s: Object.fromEntries((merges.sets || []).filter((x) => x && x.from && x.to).map((x) => [x.from, x.to])),
  p: merges.prefixes || {},
  c: merges.cards || {}
};
if (!DRY) await writeFile(arquivo, src.replace(marca, `const ID_MERGES = ${JSON.stringify(payload)}; /* SLEEVU_ID_MERGES */`), "utf8");
console.log(`retire-imported-sets: ${achados.length} set(s) importado(s) já publicado(s) pela TCGdex nesta rodada`
  + ` · de-para no núcleo: ${Object.keys(payload.s).length} set(s), ${Object.keys(payload.p).length} por prefixo,`
  + ` ${Object.keys(payload.c).length} carta(s) par a par${DRY ? " [dry-run]" : ""}`);
