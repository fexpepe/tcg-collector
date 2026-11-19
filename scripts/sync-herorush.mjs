// Marvel Hero Rush (2026–): o TCG licenciado da Marvel feito na China, pra
// dois jogadores. Saiu em junho de 2026 na China e em agosto de 2026 em
// inglês, no Sudeste Asiático e em Hong Kong; o site oficial lista China,
// Hong Kong, Taiwan, Macau, Singapura, Tailândia e Indonésia. Jogo próprio
// (`herorush`), a pedido do Fernando em 2026-11-19, na seção "Outros TCGs" do
// hub.
//
// FONTE: a API pública do site oficial (scripts/lib/herorush-fonte.mjs), a
// mesma que a lista de cartas do site chama, sem login. O site não publica
// robots.txt (404). Conferido em 2026-11-19: 667 cartas em inglês, todas com
// imagem, em 14 produtos. A API também serve indonésio; o chinês não sai por
// ela. O catálogo é o inglês.
//
// ID: "mhr-<número>-<raridade>", em minúsculas (BP01-001 MR -> mhr-bp01-001-mr).
// O número sozinho não serve de chave: a mesma carta sai em várias raridades
// com arte própria (a BP01-001 é UR, MR e SEC), e a API lista cada uma como uma
// entrada. Em 5 casos até número e raridade repetem (as HR de Era of Spiders,
// numeradas em ouro e em prata; as três TR do Treasure Booster; uma ER do
// Event Pack), e nada no dado diz qual é qual: a segunda e a terceira levam
// "-2" e "-3", na ordem do `id` interno da API. Esse `id` é um ObjectId, que
// cresce com a data de criação do registro — não é a ordem da listagem, que
// pode mudar. O `id` interno não entra no id da carta porque troca se a editora
// recriar o registro; número e raridade são o que a carta imprime.
//
// SETS: um por produto (`product_series`), com o nome e a data que a página de
// produtos do site mostra ("Release Date"). Regras do nome (contrato 7 do
// docs/CATALOGO.md):
//   - Starter Deck: o site dá só "REALITY", "MIND"… na categoria "Starter
//     Deck"; o set é "Starter Deck REALITY".
//   - Categoria "Others" (Promotion Pack, Event Pack, Treasure Booster) e o
//     Lite Pack: nomes genéricos, que repetem entre produtos (há três
//     "Promotion Pack"). Levam o código na frente, "PB01-A — Promotion Pack",
//     como o Miracle Battle. Vale pra todos eles, e não só pros que já
//     repetem, pra o endereço do primeiro não mudar quando sair o segundo.
//   - O resto é o nome do set: "The Avengers", "Era of Spiders".
// Produto novo entra sozinho, pelas mesmas regras; se mesmo assim dois sets
// ficarem com o mesmo nome, o de código maior ganha o código e o log avisa.
//
// IMAGEM: a URL da fonte é assinada e vence em um dia, então o catálogo guarda
// a chave do arquivo e a imagem vem só do nosso espelho (ver a lib). Carta
// nova fica com o verso até a rodada seguinte do espelho (diária).
//
// NOME: a fonte escreve "「Antimatter」Iron Man" (o título entre colchetes
// japoneses, depois o personagem). Vira "Iron Man - Antimatter", o formato do
// Lorcana e do Naruto Mythos: há dezenas de "Iron Man", e é o título que
// separa um do outro na busca e na coleção.
//
// SEM PREÇO: o TCGplayer não tem o jogo (conferido na TCGCSV em 2026-11-19,
// 94 categorias) e não achei outra fonte de preço com acesso automatizado.
//
// Padrão FAB: o data/herorush/cards.js é versionado, o sync roda no build
// completo, e carta que a fonte tirar fica congelada (contrato 2). Fonte fora
// do ar = segue com o que está versionado.
//
//   node scripts/sync-herorush.mjs
import { fileURLToPath } from "node:url";
import { readGlobalVar, writeGameCatalog, preserveMissingCards } from "./lib/sync-common.mjs";
import { listaCartas, listaProdutos, urlDoCatalogo } from "./lib/herorush-fonte.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "herorush";
const OUT = new URL(`data/${GAME}/`, ROOT);

// Código do produto -> nome e data, do site oficial em 2026-11-19. É a reserva
// pra quando a lista de produtos não responde (a de cartas não traz nome nem
// data) e o que fixa o nome dos sets já publicados.
export const SETS = {
  SD01: { nome: "Starter Deck REALITY", data: "2026-08-03" },
  SD02: { nome: "Starter Deck MIND", data: "2026-08-03" },
  SD03: { nome: "Starter Deck SPACE", data: "2026-08-03" },
  SD04: { nome: "Starter Deck TIME", data: "2026-08-03" },
  BP01: { nome: "The Avengers", data: "2026-08-03" },
  EB01: { nome: "EB01 — Event Pack", data: "2026-09-02" },
  "PB01-A": { nome: "PB01-A — Promotion Pack", data: "2026-09-03" },
  "PB01-B": { nome: "PB01-B — Promotion Pack", data: "2026-09-03" },
  TB01: { nome: "TB01 — Treasure Booster", data: "2026-09-03" },
  SP01: { nome: "Era of Spiders", data: "2026-09-08" },
  LP01: { nome: "LP01 — Lite Pack", data: "2026-11-11" },
  SD05: { nome: "Starter Deck SOUL", data: "2026-11-14" },
  SD06: { nome: "Starter Deck POWER", data: "2026-11-14" },
  PB02: { nome: "PB02 — Promotion Pack", data: "2026-11-14" }
};

const limpa = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const codigoDe = (s) => limpa(s).toUpperCase();
export const setIdDe = (codigo) => `mhr-${codigoDe(codigo).toLowerCase()}`;

// Nome do set de um produto que o SETS não conhece, pelas regras do topo.
const GENERICO = /^(?:lite|promotion|event|treasure)\b.*\b(?:pack|booster)$/i;
export function nomeDoProduto(codigo, nome, categoria) {
  const c = codigoDe(codigo), n = limpa(nome);
  if (!n) return c;
  if (categoria === "base") return /^starter deck\b/i.test(n) ? n : `Starter Deck ${n}`;
  if (categoria === "other" || GENERICO.test(n)) return `${c} — ${n}`;
  return n;
}

// A data do produto (ms desde 1970, no fuso da China) -> "AAAA-MM-DD". O dia é
// o de Pequim (UTC+8): a editora publica nesse fuso.
export function dataDoProduto(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n + 8 * 3600000).toISOString().slice(0, 10) : "";
}

// Produtos da API -> código -> { setId, nome, data }. O SETS vence no nome e na
// data (set publicado não muda de endereço porque a fonte mexeu no nome).
export function montaSets(produtos) {
  const sets = new Map();
  for (const [codigo, s] of Object.entries(SETS)) sets.set(codigo, { setId: setIdDe(codigo), nome: s.nome, data: s.data });
  for (const p of produtos || []) {
    const codigo = codigoDe(p && p.series);
    if (!codigo || sets.has(codigo)) continue;
    sets.set(codigo, { setId: setIdDe(codigo), nome: nomeDoProduto(codigo, p.name, p.category), data: dataDoProduto(p.start_time), novo: true });
  }
  return sets;
}

// "「Antimatter」Iron Man" -> "Iron Man - Antimatter"; sem título, o nome como vem.
export function nomeDaCarta(nome) {
  const n = limpa(nome);
  const m = /^「([^」]*)」\s*(.+)$/.exec(n);
  if (!m) return n;
  const titulo = limpa(m[1]), personagem = limpa(m[2]);
  return titulo ? `${personagem} - ${titulo}` : personagem;
}

const TIPO = { character: "Character", impact: "Impact" };
const numero = (v) => (/^\d+$/.test(limpa(v)) ? Number(limpa(v)) : null);
// Cor: as cartas RUSH POINT vêm sem cor ("", " " ou "-").
const corDe = (v) => { const c = limpa(v); return c && c !== "-" ? c : null; };

// Registro da API -> carta do catálogo, ainda sem o id final e sem o setTotal.
export function cardOf(c, sets) {
  const num = codigoDe(c && c.card_no), raridade = codigoDe(c && c.rarity);
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+[A-Z]?$/.test(num) || !raridade) return null;
  const codigo = codigoDe(c.product_series) || num.replace(/-\d+[A-Z]?$/, "");
  const set = sets.get(codigo) || { setId: setIdDe(codigo), nome: codigo, data: "", novo: true };
  return {
    base: `mhr-${num}-${raridade}`.toLowerCase(),
    interno: String(c.id || ""),
    setNovo: set.novo ? `${codigo} -> "${set.nome}"${set.data ? ` (${set.data})` : " (sem data)"}` : "",
    card: {
      id: "",
      name: nomeDaCarta(c.name),
      set: set.nome,
      setId: set.setId,
      number: num,
      setTotal: 0,
      setReleaseDate: set.data,
      rarity: raridade,
      artist: "",
      language: "en",
      image: urlDoCatalogo(c.image && c.image.key),
      variants: ["Normal"],
      setLogo: "",
      cardType: TIPO[limpa(c.card_type).toLowerCase()] || limpa(c.card_type) || null,
      color: corDe(c.attribute),
      level: numero(c.level),
      power: numero(c.power),
      traits: limpa(c.feature) || null
    }
  };
}

// A lista da API -> { cards, avisos }. Dentro do set, a ordem é a do número e,
// no mesmo número, a do registro interno (as raridades na ordem em que a
// editora as cadastrou).
export function montaCatalogo(registros, produtos) {
  const sets = montaSets(produtos);
  const avisos = new Set();
  // Dois sets com o mesmo nome: o de código maior ganha o código na frente.
  const porNome = new Map();
  for (const [codigo, s] of [...sets].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dono = porNome.get(s.nome);
    if (dono) { avisos.add(`sets com o mesmo nome "${s.nome}": ${dono} e ${codigo} — o ${codigo} ganhou o código na frente (fixar no SETS)`); s.nome = `${codigo} — ${s.nome}`; }
    porNome.set(s.nome, codigo);
  }
  const vistos = new Set();
  const linhas = [];
  let foraDoFormato = 0;
  for (const r of registros || []) {
    const interno = String((r && r.id) || "");
    if (interno && vistos.has(interno)) continue;   // a mesma entrada em duas páginas
    if (interno) vistos.add(interno);
    const x = cardOf(r, sets);
    if (!x) { foraDoFormato++; continue; }
    if (x.setNovo) avisos.add(`set fora do SETS: ${x.setNovo} (conferir o nome e fixar)`);
    linhas.push(x);
  }
  if (foraDoFormato) avisos.add(`${foraDoFormato} registro(s) sem número ou sem raridade ficaram de fora`);
  // Número e raridade repetidos: "-2", "-3" na ordem do registro interno.
  linhas.sort((a, b) => a.base.localeCompare(b.base) || a.interno.localeCompare(b.interno));
  const usados = new Map();
  for (const x of linhas) {
    const n = (usados.get(x.base) || 0) + 1;
    usados.set(x.base, n);
    x.card.id = n === 1 ? x.base : `${x.base}-${n}`;
  }
  linhas.sort((a, b) => a.card.setId.localeCompare(b.card.setId) || a.card.number.localeCompare(b.card.number) || a.interno.localeCompare(b.interno));
  const total = new Map();
  for (const { card } of linhas) total.set(card.setId, (total.get(card.setId) || 0) + 1);
  const cards = linhas.map(({ card }) => ({ ...card, setTotal: total.get(card.setId) }));
  return { cards, avisos: [...avisos] };
}

async function run() {
  console.log("Marvel Hero Rush: buscando a lista oficial de cartas…");
  let registros = null, produtos = null;
  try { registros = await listaCartas({ idioma: "en" }); }
  catch (e) { console.log(`  fonte inacessível (${e.message}).`); }
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  if (!registros || !registros.length) {
    console.log(`  sem resposta da lista — segue com o catálogo versionado (${prev.length} cartas).`);
    return;
  }
  // Sem a lista de produtos, os sets conhecidos seguem pelo SETS; um set novo
  // entraria com o código no lugar do nome e sem data, e o aviso sai no log.
  try { produtos = await listaProdutos({ idioma: "en" }); }
  catch (e) { console.warn(`  AVISO: lista de produtos inacessível (${e.message}) — nome e data só dos sets do SETS.`); }
  const { cards, avisos } = montaCatalogo(registros, produtos);
  for (const a of avisos) console.warn(`  AVISO: ${a}`);
  // Carta que a fonte tirar fica (id publicado nunca some).
  const congeladas = preserveMissingCards(prev, cards);
  const merged = cards.concat(congeladas);
  const porSet = new Map();
  for (const c of merged) porSet.set(c.set, (porSet.get(c.set) || 0) + 1);
  for (const [nome, n] of porSet) console.log(`  ${nome}: ${n} cartas`);
  console.log(`Total: ${merged.length} cartas (${merged.filter((c) => c.image).length} com imagem${congeladas.length ? `; ${congeladas.length} congeladas` : ""}).`);
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`Gravado em ${fileURLToPath(OUT)}.`);
}

// Importável pelos testes sem rodar o sync (ver tests/herorush-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
