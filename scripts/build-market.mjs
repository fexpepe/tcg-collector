// "Mercado do jogo": recorte PÚBLICO e já hidratado das altas/quedas do dia e do
// índice de 30 dias, um arquivo por jogo:
//   data/<jogo>/market.generated.json
//
// Os dois insumos já existiam e eram publicados a cada build pelo
// sync-price-history.mjs — price-movers.generated.json (30 altas + 30 quedas) e
// market-index.generated.json (índice equal-weighted base 1000). O único
// consumidor era o Portfólio, que exige login.
//
// Por que HIDRATAR aqui e não no navegador: os movers guardam só `id` e `pct`.
// O Portfólio resolve isso baixando o CHUNK INTEIRO do set de cada carta — o
// que é aceitável numa página financeira que a pessoa abriu de propósito, e não
// numa página pública que tem que aparecer rápido pra quem vem do Google. Aqui
// o join sai no build: a página faz UMA requisição de alguns KB e desenha.
//
// Por que o índice entra no MESMO arquivo: são duas requisições pra um bloco só
// de tela. Junto, é uma.
//
// Roda em TODO deploy (mesma razão do enrich-manifest): no build rápido os
// syncs são pulados e os insumos vêm do cache. Sem insumo, o jogo simplesmente
// não ganha arquivo — e a página tem estado vazio próprio.
//
// Uso: node scripts/build-market.mjs
import { readFile, writeFile } from "node:fs/promises";

const RAIZ = new URL("../", import.meta.url);

const JOGOS = [
  ["pokemon", "data/"], ["lorcana", "data/lorcana/"], ["onepiece", "data/onepiece/"],
  ["magic", "data/magic/"], ["fab", "data/fab/"], ["gundam", "data/gundam/"],
  ["dbfw", "data/dbfw/"], ["ygo", "data/ygo/"], ["digimon", "data/digimon/"],
  ["riftbound", "data/riftbound/"], ["unionarena", "data/unionarena/"],
  ["naruto", "data/naruto/"], ["hxh", "data/hxh/"]
];

// 6 de cada lado: o trilho é uma fileira que rola, não uma tabela. Mais que isso
// vira lista, e lista de preço numa página de catálogo é justamente o que a
// decisão de produto ("a visão financeira fica no Portfólio") quer evitar.
const POR_LADO = 6;
// 30 pontos do índice: "o mercado nos últimos 30 dias" é a leitura que o
// sparkline promete. O arquivo tem ~60; os mais antigos não entram.
const PONTOS = 30;

function leGlobal(texto) {
  const igual = texto.indexOf("=");
  if (igual < 0) throw new Error("sem atribuição");
  return JSON.parse(texto.slice(igual + 1).trim().replace(/;\s*$/, ""));
}
async function leJson(caminho) {
  return JSON.parse(await readFile(new URL(caminho, RAIZ), "utf8"));
}

let jogosComArquivo = 0;
const resumo = [];
const comMercado = new Set();

for (const [slug, dir] of JOGOS) {
  let movers = null;
  try { movers = await leJson(`${dir}price-movers.generated.json`); } catch { /* sem movers neste build */ }

  let indice = null;
  try {
    const bruto = await leJson(`${dir}market-index.generated.json`);
    if (bruto && Array.isArray(bruto.d) && Array.isArray(bruto.i)) {
      indice = { d: bruto.d.slice(-PONTOS), i: bruto.i.slice(-PONTOS), n: bruto.n || 0 };
    }
  } catch { /* sem índice neste build */ }

  const alvos = new Map(); // id -> lado
  const pega = (lista, lado) => (lista || []).slice(0, POR_LADO).forEach((m) => alvos.set(m.id, lado));
  if (movers) { pega(movers.up, "up"); pega(movers.down, "down"); }

  // Sem nada pra publicar: não escreve arquivo (a página trata a ausência).
  if (!alvos.size && !indice) continue;

  // Join com o catálogo. Varre os chunks do manifest UMA vez e para assim que
  // achou todas as cartas procuradas — 12 ids num catálogo de centenas de
  // milhares, mas a varredura é de build e o corte antecipado a torna barata.
  const achadas = new Map();
  if (alvos.size) {
    let manifest = null;
    try { manifest = leGlobal(await readFile(new URL(`${dir}manifest.generated.js`, RAIZ), "utf8")); }
    catch { /* sem manifest: publica só o índice */ }
    for (const entrada of (manifest && manifest.sets) || []) {
      if (achadas.size >= alvos.size) break;
      if (!entrada || !entrada.file) continue;
      let cartas;
      try { cartas = await leJson(entrada.file); } catch { continue; }
      for (const c of cartas) {
        if (!c || !alvos.has(c.id) || achadas.has(c.id)) continue;
        achadas.set(c.id, {
          id: c.id, n: c.name || c.id, s: c.set || "", sid: c.setId || "",
          num: c.number || "", img: c.image || "", v: (c.variants && c.variants[0]) || ""
        });
      }
    }
  }

  // Carta que o join não achou fica de fora: linha sem nome nem imagem num
  // trilho público é pior que uma linha a menos.
  const monta = (lista) => (lista || []).slice(0, POR_LADO)
    .map((m) => { const c = achadas.get(m.id); return c ? { ...c, pct: m.pct, val: m.v } : null; })
    .filter(Boolean);

  const saida = {
    v: 1,
    from: (movers && movers.from) || null,
    to: (movers && movers.to) || null,
    up: movers ? monta(movers.up) : [],
    down: movers ? monta(movers.down) : [],
    idx: indice
  };
  await writeFile(new URL(`${dir}market.generated.json`, RAIZ), JSON.stringify(saida), "utf8");
  jogosComArquivo++;
  comMercado.add(slug);
  resumo.push(`${slug} +${saida.up.length}/-${saida.down.length}${indice ? ` idx${indice.i.length}` : ""}`);
}

// Carimba `mkt` no manifest de cada jogo — mesmo contrato do `pc` que o
// split-pricing já usa. É o que deixa o botão "Mercado" da página de Sets nascer
// SEM pedir nada à rede: o manifest já desceu com o catálogo, e o botão só
// aparece pra jogo que de fato tem cotação. Sem esta flag o botão teria que
// adivinhar — e um botão que abre pra "não há dados" é pior que botão nenhum.
//
// Roda ANTES do split-pricing e do build-set-trends, que releem e reescrevem o
// manifest inteiro: a chave sobrevive aos dois. E APAGA quando o jogo perde a
// cotação, senão um build ruim deixaria a flag mentindo pra sempre.
for (const [slug, dir] of JOGOS) {
  const url = new URL(`${dir}manifest.generated.js`, RAIZ);
  let manifest = null;
  try { manifest = leGlobal(await readFile(url, "utf8")); } catch { continue; }
  if (!manifest || typeof manifest !== "object") continue;
  const tem = comMercado.has(slug);
  if (tem === !!manifest.mkt) continue; // já está como deveria: não reescreve
  if (tem) manifest.mkt = 1; else delete manifest.mkt;
  await writeFile(url, `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
}

console.log(`Mercado: ${jogosComArquivo} jogo(s) com arquivo — ${resumo.join(" · ") || "nenhum"}`);
