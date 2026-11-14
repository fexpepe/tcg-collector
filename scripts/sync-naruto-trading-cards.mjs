// NARUTO-ナルト- · cartas de coleção da Amada e da Ensky (2004–2005): o jogo
// vintage `narutotc` ("Naruto Trading Cards"), em data/narutotc/. NÃO é jogo
// de mesa: são trading cards de pacote, pra colecionar, da 天田印刷加工
// (Amada), que em 2005 passou a se chamar エンスカイ (Ensky; a página oficial
// da 忍術大全 assina "発売：エンスカイ（旧天田印刷加工）"). Entrou em
// 2026-11-13, a pedido do Fernando (a linha do tempo das cartas do Naruto).
//
// JOGO PRÓPRIO, e não linha do `naruto`: o Fernando definiu em 2026-11-13 que
// cada jogo antigo do Naruto é um jogo, como os outros do site, e que no mesmo
// jogo fica só o que é parte dele (docs/CATALOGO.md 4.1). Na primeira versão
// desta PR era a linha nrt-tc; nada foi publicado com ela, então o id trocou
// de prefixo sem de-para. É UM jogo com uma seção por produto: é o mesmo
// fabricante e o mesmo formato (pacote de cartas de coleção), como os títulos
// do arcade no Data Carddass. O agrupador é o groupNarutoTradingSets do app.js.
//
// O QUE ENTRA (255 cartas, 4 sets):
//   エッチングカードコレクション (2004)   45 normais, No.1–45
//   エッチングカードコレクション2 (2005)  45 normais (No.46–90), 18 paralelas
//                                         (Pa.01–18) e 9 especiais (SP.01–09)
//   エッチングカードコレクション3 (2005)  45 normais (No.91–135), 18
//                                         "variety" (V.01–18) e 9 especiais
//   トレーディングコレクション 忍術大全 (2005)  56 normais (No.01–56) e 10
//                                         especiais (SP.01–10)
// A numeração das normais do Etching é contínua nos três; a fonte numera as 9
// especiais do 3 como SP.10 e SP.12–SP.19 (pula o SP.11): fica como a fonte
// escreve, sem renumerar. As Pa.01–18 do 2 repetem, na ordem, os nomes das
// No.73–90 (são a versão paralela delas).
//
// FONTES (conferidas em 2026-11-13):
//   LISTA — 火の国庵, hinokunian.konohashigure.com/cardetting1.html, …2, …3 e
//           cardninjutsutaizen.html (site de fã, parado desde 2006; o formato
//           está no scripts/lib/hinokunian-lista.mjs): número, nome e, na
//           忍術大全, quem usa o jutsu. O sync só aceita a página quando a
//           contagem por raridade bate com o resumo que ela mesma traz.
//   FICHA — o site oficial do anime na TV Tokyo, pelo Wayback
//           (tv-tokyo.co.jp/anime/naruto2002/goods/amd_echg2.html,
//           amd_echg3.html e amd_ntz.html): fabricante, preço, cartas por
//           pacote e a composição (45 + 18 + 9 nos Etching 2 e 3; 56 + 10 na
//           忍術大全), que bate com a lista. E o Card Check Box
//           (cardcheckbox.com/a01a-amada-3/ecc-naruto.html e
//           a01d-ensky/trc-naruto-nt.html), que dá data e numeração.
//   Não há imagem por carta em fonte aberta: TCDB, Mandarake, Suruga-ya,
//   Coleka e eBay barram acesso automatizado (contrato 4 do CATALOGO.md).
//   Todas entram sem imagem; assets/cards/narutotc/<id>.* vence, se um dia
//   houver scan nosso.
//
// DATAS: o dia quando uma fonte dá e nenhuma contradiz; só o ano quando as
// fontes não concordam no mês.
//   Etching 1: "2004". O 火の国庵 só diz 2004; o Card Check Box, "(2004年9月
//              00日)" entre parênteses (a marca dele de data não confirmada);
//              um blog de colecionador, "2004年8月頃". Sem mês escolhido.
//   Etching 2: 2005-01-31 (火の国庵; o Card Check Box confirma janeiro).
//   Etching 3: 2005-06-03 (Card Check Box; a TV Tokyo diz "6月上旬").
//   忍術大全:  2005-08-17 (Card Check Box, "2005年8月17日 確認"; a TV Tokyo
//              diz "8月中旬").
//
// NOMES: o do Etching 1 e o da 忍術大全 vêm em japonês, e o inglês sai do
// mapa do Naruto (scripts/data/naruto-names-en.json), aqui mesmo: o jogo fica
// fora do catálogo do `naruto`, que é o que o translate-naruto-names.mjs
// traduz. Na 忍術大全 a carta é um JUTSU, e a fonte diz quem o usa: o nome é
// "jutsu (quem usa)", porque o mesmo jutsu aparece em mais de uma carta
// (写輪眼 três vezes, 口寄せの術 três). Os do Etching 2 e 3 a fonte dá em
// ROMAJI, em maiúsculas ("ITACHI KAKASHI", "SHODAI HOKAGE"): ficam como estão,
// sem separar personagens (o espaço separa nomes e também palavras do mesmo
// nome) e sem o japonês, que a fonte não tem.
//
// FICA DE FORA, sem lista carta a carta achada: o Etching 4 (Ensky, 04/2006;
// a página do 火の国庵 só tem a numeração, sem nomes), a 忍術大全 弐号 (Ensky,
// 07/2006) e o トレーディングコレクション da Amada (03/2003).
//
// SEM PREÇO, como os outros vintage.
//
// Padrão-snapshot: o build parte de data/vintage/naruto-trading-cards.json; o
// fetch só regrava quando responde, confere e não regride. A lista é história
// encerrada, então o deploy roda com --no-fetch. O catálogo é só deste sync;
// carta que sair do snapshot fica congelada (id publicado nunca some).
//
//   node scripts/sync-naruto-trading-cards.mjs             # fetch + build
//   node scripts/sync-naruto-trading-cards.mjs --no-fetch  # só build (o do deploy)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, preserveMissingCards, sleep } from "./lib/sync-common.mjs";
import { baixaLista, HINOKUNIAN } from "./lib/hinokunian-lista.mjs";
import { nomeEn } from "./lib/naruto-nomes.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "narutotc";
const OUT = new URL(`data/${GAME}/`, ROOT);
const SNAP = new URL("data/vintage/naruto-trading-cards.json", ROOT);
const NO_FETCH = process.argv.includes("--no-fetch");
// Nenhum dos produtos tem logo próprio recortado: vale o do Naruto, a marca
// impressa em todos (a exceção dos vintage na política de logo, contrato 3).
const LOGO = "/assets/games/game_naruto-v2.webp";

// Os produtos, na ordem de lançamento. Nome sem "NARUTO-ナルト-" na frente
// (contrato 7); o inglês de exibição mora no src/nomes-sets.js. `romaji`: a
// fonte dá o nome em romaji, não em japonês. `usuario`: a 3ª coluna da página
// é quem usa o jutsu.
export const PRODUTOS = [
  { key: "ecc1", pagina: "cardetting1", nome: "エッチングカードコレクション", data: "2004" },
  { key: "ecc2", pagina: "cardetting2", nome: "エッチングカードコレクション2", data: "2005-01-31", romaji: true },
  { key: "ecc3", pagina: "cardetting3", nome: "エッチングカードコレクション3", data: "2005-06-03", romaji: true },
  { key: "ntz1", pagina: "cardninjutsutaizen", nome: "トレーディングコレクション 忍術大全", data: "2005-08-17", usuario: true }
];

// Prefixo do número na fonte -> raridade. "バラエティ" (variety) é o nome que
// a Amada deu às 18 do Etching 3, no lugar das paralelas do 2.
export const RARIDADE = { No: "Normal", Pa: "Parallel", V: "Variety", SP: "Special" };

// Número como a fonte escreve: a normal só com o número ("46", "01"), as
// outras com o prefixo ("Pa.01", "V.01", "SP.10").
export const numeroDaCarta = (c) => (c.prefixo === "No" ? c.num : `${c.prefixo}.${c.num}`);

// Id estável: o número vira inteiro (o 火の国庵 escreve "No.1" e o Card Check
// Box "No.01" pra mesma carta; o id não depende de quantos zeros a fonte põe).
//   No.46 do Etching 2 -> ntc-ecc2-46     Pa.01 -> ntc-ecc2-pa1
//   V.01 do Etching 3  -> ntc-ecc3-v1     SP.10 -> ntc-ecc3-sp10
export const idDaCarta = (key, c) => `ntc-${key}-${c.prefixo === "No" ? "" : c.prefixo.toLowerCase()}${Number(c.num)}`;

// Nome que a fonte digitou errado, por "<set>:<número>". O SP.17 do Etching 3
// está como "KAKASHU" na página: não existe esse personagem, e a mesma página
// escreve KAKASHI nas outras sete cartas dele.
export const NOME_CORRIGIDO = { "ecc3:SP.17": "KAKASHI" };

// Nome da carta nos dois idiomas: { name, nameJp? }.
export function nomeDaCarta(def, c) {
  const corrigido = NOME_CORRIGIDO[`${def.key}:${numeroDaCarta(c)}`];
  if (def.romaji) return { name: corrigido || c.nome };
  const ja = corrigido || c.nome;
  if (!def.usuario || !c.extra) {
    const en = nomeEn(ja);
    return en ? { name: en, nameJp: ja } : { name: ja };
  }
  // 忍術大全: "jutsu (quem usa)". Parte sem tradução fica em japonês, e o
  // nome inteiro só ganha nameJp quando as duas têm inglês.
  const jutsu = nomeEn(ja), quem = nomeEn(c.extra);
  const nameJp = `${ja} (${c.extra})`;
  return jutsu && quem ? { name: `${jutsu} (${quem})`, nameJp } : { name: nameJp };
}

// Imagem CURADA do dono: assets/cards/narutotc/<id>.* (mesmo mecanismo dos
// outros syncs vintage).
function curatedImg(id) {
  for (const e of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${e}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${e}`;
  }
  return "";
}

// O catálogo do jogo, sem disco (os testes chamam com fixture).
export function montaCatalogo(snap, { imagemCurada = () => "" } = {}) {
  const porKey = new Map(((snap && snap.sets) || []).map((s) => [s.key, s]));
  const cards = [];
  for (const def of PRODUTOS) {
    const cartas = (porKey.get(def.key) || {}).cards || [];
    for (const c of cartas) {
      const id = idDaCarta(def.key, c);
      cards.push({
        id,
        ...nomeDaCarta(def, c),
        set: def.nome,
        setId: `ntc-${def.key}`,
        number: numeroDaCarta(c),
        setTotal: cartas.length,
        setReleaseDate: def.data,
        rarity: RARIDADE[c.prefixo] || "",
        artist: "",
        language: "ja",
        image: imagemCurada(id),
        variants: ["Normal"],
        setLogo: LOGO,
        vintage: true
      });
    }
  }
  return cards;
}

async function refreshSnapshot(existing) {
  const sets = [];
  for (const def of PRODUTOS) {
    const lista = await baixaLista(def.pagina);
    if (lista) {
      sets.push({
        key: def.key, pagina: def.pagina, dataNaFonte: lista.data,
        cards: lista.cartas.map(({ prefixo, num, nome, extra }) => ({ prefixo, num, nome, ...(extra ? { extra } : {}) }))
      });
    }
    await sleep(800); // gentileza com o site
  }
  if (!sets.length) { console.log("  火の国庵 inacessível — segue com o snapshot versionado."); return existing; }
  // Página que falhou fica com o que o snapshot anterior tinha.
  const antes = new Map(((existing && existing.sets) || []).map((s) => [s.key, s]));
  const novos = new Map(sets.map((s) => [s.key, s]));
  const merged = PRODUTOS.map((d) => novos.get(d.key) || antes.get(d.key)).filter(Boolean);
  const candidate = { source: `${HINOKUNIAN}cardseal.html`, updatedAt: new Date().toISOString().slice(0, 10), sets: merged };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  火の国庵: ${sets.length} de ${PRODUTOS.length} listas, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (JSON.stringify({ ...candidate, updatedAt: "" }) !== JSON.stringify({ ...(existing || {}), updatedAt: "" })) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("NARUTO TRADING CARDS (Amada/Ensky 2004–2005, vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  const cards = montaCatalogo(snap, { imagemCurada: curatedImg });
  const semIngles = cards.filter((c) => /[぀-ヿ一-鿿]/.test(c.name)).length;
  console.log(`  build: ${cards.length} cartas em ${new Set(cards.map((c) => c.setId)).size} sets (${cards.filter((c) => c.image).length} com imagem; ${semIngles} sem nome em inglês).`);

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas.`);
}

// Importável pelos testes sem rodar o sync (ver tests/naruto-trading-cards-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
