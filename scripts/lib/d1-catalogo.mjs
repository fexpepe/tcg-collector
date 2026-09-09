// Leitura do catálogo pro D1 — compartilhada entre o build-d1 (que gera o SQL
// da carga TOTAL, usado no primeiro deploy e nos testes) e o deploy-d1 (que
// compara com o remoto e grava só o que mudou). Um lugar só: se a projeção da
// carta pro banco mudasse num e não no outro, a impressão digital local nunca
// mais bateria com a remota e o deploy reescreveria o catálogo inteiro todo dia.
//
// Não existe segunda fonte de verdade: o banco é uma projeção dos chunks por
// set que o build já monta (manifest.generated.js de cada jogo).
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cardRows } from "../../functions/api/_search-sql.js";

export const RAIZ = new URL("../../", import.meta.url);

// Versão do ESQUEMA: a carga total grava em meta (esquema/esquemaPrecos). O
// deploy-d1 só faz carga incremental quando o remoto está nesta versão — numa
// anterior (sem h/hw, sem idx_words_id) ele faz a total uma última vez. Subir
// o número aqui = forçar uma carga total no próximo deploy.
export const ESQUEMA = "2";

export const JOGOS = [
  ["pokemon", "data/"], ["lorcana", "data/lorcana/"], ["onepiece", "data/onepiece/"],
  ["magic", "data/magic/"], ["fab", "data/fab/"], ["gundam", "data/gundam/"],
  ["dbfw", "data/dbfw/"], ["ygo", "data/ygo/"], ["digimon", "data/digimon/"],
  ["riftbound", "data/riftbound/"], ["unionarena", "data/unionarena/"],
  ["naruto", "data/naruto/"], ["hxh", "data/hxh/"],
  ["jump", "data/jump/"]
];

// Colunas da tabela `cards`, na ordem do INSERT. `h`/`hw` por último: são as
// impressões digitais (ver d1-delta.mjs), não dado da carta.
export const COLUNAS = ["game", "id", "name", "set_name", "number", "card_type", "cost", "rarity",
  "color", "set_id", "artist", "language", "image", "variants", "released", "h", "hw"];

export const aspas = (v) => `'${String(v).replace(/'/g, "''")}'`;

const h16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Impressões digitais (ver d1-delta.mjs): `h` da LINHA (colunas de dado, sem
// h/hw) e `hw` das PALAVRAS. Separadas porque a maioria das mudanças diárias é
// de linha (URL de imagem, variantes, data) e não mexe nas palavras — e
// reescrever as palavras custa 8 escritas por palavra (apagar + inserir, com
// índices). Vivem aqui, e não no d1-delta, porque a projeção da carta pro
// banco e a sua impressão são a MESMA coisa: quem muda uma muda a outra.
// `hwLegado` é a impressão das palavras SEM as `extras` (ver cardRows): quando
// a remota bate com ela, a carta só precisa das extras inseridas — não da
// reescrita de todas as palavras. Só existe quando há extras.
export function impressaoCarta({ linha, words, legado, extras }) {
  const dado = COLUNAS.filter((k) => k !== "h" && k !== "hw").map((k) => linha[k]);
  const h = h16(JSON.stringify(dado));
  const hashPalavras = (ws) => h16(ws.map((w) => w.word).join("\n"));
  const hw = hashPalavras(words);
  const ex = extras || [];
  const hwLegado = ex.length ? hashPalavras(legado || words.slice(0, words.length - ex.length)) : null;
  return { linha: { ...linha, h, hw }, words, extras: ex, h, hw, hwLegado };
}
export function impressaoPreco(p) {
  return { ...p, h: h16(p.j) };
}

async function leGlobal(caminho) {
  try {
    const t = await readFile(new URL(caminho, RAIZ), "utf8");
    return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
  } catch { return null; }
}

// Passeia os jogos um a um e entrega, por jogo, as cartas já projetadas pro
// banco (linha + palavras + impressões digitais) e os preços do monólito. Um
// jogo por vez de propósito: o Magic sozinho são 100 mil cartas e 900 mil
// palavras, e segurar os 13 jogos em memória ao mesmo tempo não é preciso
// nem no build nem no deploy.
export async function* lerCatalogo() {
  for (const [game, dir] of JOGOS) {
    const manifest = await leGlobal(`${dir}manifest.generated.js`);
    if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) continue;
    const vistos = new Set();
    const cards = [];
    for (const entrada of manifest.sets) {
      if (!entrada.file) continue;
      let cartas;
      try { cartas = JSON.parse(await readFile(new URL(entrada.file, RAIZ), "utf8")); } catch { continue; }
      for (const carta of cartas) {
        if (!carta || !carta.id || vistos.has(carta.id)) continue;
        vistos.add(carta.id);
        cards.push(impressaoCarta(cardRows(game, carta)));
      }
    }
    if (!cards.length) continue;
    // Preços: o monólito do jogo, entrada por entrada, guardado como JSON
    // verbatim — o cliente recebe o mesmo objeto que um chunk daria.
    const tabela = (await leGlobal(`${dir}pricing.generated.js`)) || (await leGlobal(`${dir}pricing.js`)) || {};
    const precos = [];
    for (const id of Object.keys(tabela)) {
      if (tabela[id] == null) continue;
      precos.push(impressaoPreco({ game, id, j: JSON.stringify(tabela[id]) }));
    }
    yield { game, cards, precos };
  }
}

// O D1 recusa statement acima de ~100 KB (SQLITE_TOOBIG) — e foi exatamente
// isso que derrubou a primeira carga com os campos novos: um lote fixo de 400
// cartas cabia quando a linha só tinha nome e número, e estourou quando ganhou
// URL de imagem, artista e variantes. Fatiar por BYTES em vez de por contagem
// resolve de uma vez: qualquer campo que cresça no futuro só faz o lote ficar
// menor, nunca inválido.
export const TETO_STATEMENT = 60 * 1024;   // folga generosa sobre o limite do D1
export const LIMITE_D1 = 100 * 1024;

// `INSERT … VALUES (…),(…)` em lotes de até TETO_STATEMENT bytes. `sufixo` é o
// que vai depois dos VALUES (o ON CONFLICT do upsert incremental).
export function insertsEmLotes(prefixo, valores, sufixo = "") {
  const out = [];
  let lote = [], tamanho = 0;
  const fecha = () => {
    if (!lote.length) return;
    out.push(`${prefixo} VALUES\n${lote.join(",\n")}${sufixo};`);
    lote = []; tamanho = 0;
  };
  for (const v of valores) {
    // +2 pela vírgula e quebra de linha entre valores.
    if (tamanho && tamanho + v.length + 2 > TETO_STATEMENT) fecha();
    lote.push(v);
    tamanho += v.length + 2;
  }
  fecha();
  return out;
}

// `<prefixo> (id1,id2,…);` em lotes pelo mesmo teto — pros DELETE … WHERE id IN.
export function listasEmLotes(prefixo, ids) {
  const out = [];
  let lote = [], tamanho = 0;
  const fecha = () => {
    if (!lote.length) return;
    out.push(`${prefixo} (${lote.join(",")});`);
    lote = []; tamanho = 0;
  };
  for (const id of ids) {
    const v = aspas(id);
    if (tamanho && tamanho + v.length + 1 > TETO_STATEMENT) fecha();
    lote.push(v);
    tamanho += v.length + 1;
  }
  fecha();
  return out;
}

export const valoresCarta = (c) => `(${COLUNAS.map((k) => aspas(c.linha[k])).join(",")})`;
export const valoresPalavra = (w) => `(${aspas(w.game)},${aspas(w.word)},${aspas(w.id)})`;
export const valoresPreco = (p) => `(${aspas(p.game)},${aspas(p.id)},${aspas(p.j)},${aspas(p.h)})`;
