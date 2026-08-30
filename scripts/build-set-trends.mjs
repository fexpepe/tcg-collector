// Tendência por SET: "▲ 3,2% na semana" no card do set.
//
// O dado já existia inteiro e ninguém agregava: o price-history.generated.json
// guarda a série diária de preço POR CARTA (60 pontos), e os chunks dizem a que
// set cada carta pertence. Faltava juntar os dois.
//
// Escreve dv7 / dv30 / dvn direto na entrada do manifest — que é o arquivo que
// a tela de Sets JÁ baixa. Zero requisição nova no navegador.
//
// MÉTODO: média equal-weighted das variações RELATIVAS, a mesma do índice de
// mercado. Somar os preços faria uma Charizard de US$ 900 mandar sozinha no set
// inteiro, e o "set subiu" viraria "aquela carta subiu".
//
// PISO de cartas (MIN_CARTAS): num set com três cotações, uma carta oscilando
// 40% vira "o set subiu 13%" — número que parece preciso e não é. Sem o piso, o
// chip mentiria justamente nos sets pequenos, que são muitos.
//
// FONTE MISTA: a série já recomeça quando a fonte da carta muda (o
// sync-price-history zera o histórico ao trocar de BR/USD/EUR), então comparar
// dois pontos da mesma série é sempre a mesma moeda. Nada a fazer aqui.
//
// Roda DEPOIS do enrich-manifest (que reescreve o manifest) e em todo deploy —
// no build rápido o histórico vem do cache, como os outros insumos de preço.
//
// Uso: node scripts/build-set-trends.mjs
import { readFile, writeFile } from "node:fs/promises";

const RAIZ = new URL("../", import.meta.url);

const DIRS = [
  "data/", "data/lorcana/", "data/onepiece/", "data/magic/", "data/fab/",
  "data/gundam/", "data/dbfw/", "data/ygo/", "data/digimon/", "data/riftbound/",
  "data/unionarena/", "data/naruto/", "data/hxh/"
];

const JANELAS = [7, 30];
// 8 cartas com cotação nas DUAS pontas da janela. Abaixo disso o número é
// ruído com cara de precisão.
const MIN_CARTAS = 8;
// Variação abaixo de 0,5% não vira chip: "▲ 0,1%" é barulho, não notícia.
const MIN_PCT = 0.5;

function leGlobal(texto) {
  const igual = texto.indexOf("=");
  if (igual < 0) throw new Error("sem atribuição");
  return JSON.parse(texto.slice(igual + 1).trim().replace(/;\s*$/, ""));
}

// Índice do ponto mais recente com data <= alvo. Ancora por DATA e não por
// contagem: um dia sem build (cron atrasado, deploy que falhou) não pode
// encolher a janela em silêncio — é a mesma regra da janela de 7d do
// sync-price-history.
function indiceNaData(datas, alvo) {
  for (let i = datas.length - 2; i >= 0; i--) if (datas[i] <= alvo) return i;
  return -1;
}

let jogos = 0, setsComChip = 0;
const resumo = [];

for (const dir of DIRS) {
  let manifest, hist;
  try { manifest = leGlobal(await readFile(new URL(`${dir}manifest.generated.js`, RAIZ), "utf8")); }
  catch { continue; }
  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) continue;
  try { hist = JSON.parse(await readFile(new URL(`${dir}price-history.generated.json`, RAIZ), "utf8")); }
  catch { continue; } // jogo sem histórico ainda (Naruto/HxH não têm preço)
  if (!hist || !Array.isArray(hist.d) || hist.d.length < 2 || !hist.c) continue;

  const hoje = hist.d[hist.d.length - 1];
  const base = {};
  for (const dias of JANELAS) {
    const alvo = new Date(Date.parse(hoje + "T00:00:00Z") - dias * 86400000).toISOString().slice(0, 10);
    base[dias] = indiceNaData(hist.d, alvo);
  }
  // Nenhuma janela tem ponto velho o bastante (histórico recém-nascido).
  if (JANELAS.every((d) => base[d] < 0)) continue;

  let comChip = 0;
  for (const entrada of manifest.sets) {
    delete entrada.dv7; delete entrada.dv30; delete entrada.dvn; // idempotente
    if (!entrada || !entrada.file) continue;
    let cartas;
    try { cartas = JSON.parse(await readFile(new URL(entrada.file, RAIZ), "utf8")); }
    catch { continue; }

    let n = 0;
    const soma = {};
    const conta = {};
    for (const c of cartas) {
      const serie = c && hist.c[c.id];
      if (!serie || !Array.isArray(serie.p)) continue;
      const agora = serie.p[serie.p.length - 1];
      if (agora == null || !(agora > 0)) continue;
      n++;
      for (const dias of JANELAS) {
        const i = base[dias];
        if (i < 0) continue;
        // Ponto exato pode ser null (carta sem preço naquele dia): anda pra trás
        // até achar um, dentro da janela.
        let antes = null;
        for (let k = i; k >= 0; k--) { if (serie.p[k] != null) { antes = serie.p[k]; break; } }
        if (!(antes > 0)) continue;
        soma[dias] = (soma[dias] || 0) + (agora / antes - 1);
        conta[dias] = (conta[dias] || 0) + 1;
      }
    }
    if (n < MIN_CARTAS) continue;

    let pos = false;
    for (const dias of JANELAS) {
      if ((conta[dias] || 0) < MIN_CARTAS) continue;
      const pct = Math.round((soma[dias] / conta[dias]) * 1000) / 10; // uma casa
      if (Math.abs(pct) < MIN_PCT) continue;
      entrada[`dv${dias}`] = pct;
      pos = true;
    }
    if (pos) { entrada.dvn = n; comChip++; }
  }

  await writeFile(new URL(`${dir}manifest.generated.js`, RAIZ),
    `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
  jogos++; setsComChip += comChip;
  resumo.push(`${dir.replace(/^data\/?/, "") || "pokemon"} ${comChip}/${manifest.sets.length}`);
}

console.log(`Tendência por set: ${setsComChip} set(s) com chip em ${jogos} jogo(s) — ${resumo.join(" · ") || "nenhum"}`);
