// Página de set de cada jogo e o endereço /games/<jogo>/<set>/<carta> de cada
// carta, com a régua do prerender (2026-11-02).
//
// Morava solta no main() do prerender-catalog.mjs. Saiu pra cá porque o
// registro das cartas que mudaram de set (scripts/lib/cartas-movidas.mjs)
// precisa calcular o endereço que a carta TINHA no catálogo publicado — e um
// cálculo copiado divergiria do prerender no primeiro ajuste, gravando 301 de
// endereço que nunca existiu.
//
// Sem fs de propósito: quem lê o catálogo (do disco ou do git) é quem chama.
import { urlDoSet } from "../../functions/_lib/jogos.js";
import { slugify, slugsDasCartas } from "../../functions/_lib/slug-carta.js";
import { cmpNumber } from "../../functions/_lib/pagina-set.js";

// Cartas agrupadas por NOME de set, como o app (cards.filter(c => c.set ===
// nome)), na ordem em que aparecem no catálogo. Carta aposentada fica de fora:
// set incorporado a outro fica congelado no chunk e não forma página.
export function agrupaPorSet(cards) {
  const byName = new Map();
  for (const card of cards || []) {
    const name = card && card.set;
    if (!name || card.retired) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(card);
  }
  return byName;
}

// Kana (U+3040–U+30FF) e kanji (U+3400–U+4DBF, U+4E00–U+9FFF), montados por
// código e não escritos como escape: as ferramentas de edição já trocaram
// escape unicode pelo caractere literal sem avisar (ver slug-carta.js).
const KANA_KANJI = new RegExp("[" + String.fromCharCode(0x3040) + "-" + String.fromCharCode(0x30ff) +
  String.fromCharCode(0x3400) + "-" + String.fromCharCode(0x4dbf) +
  String.fromCharCode(0x4e00) + "-" + String.fromCharCode(0x9fff) + "]");
// Sobra do nome que já traz um código no endereço ("as01-j-1", "db01", "op13-z"):
// trocar pelo setId não ganha leitura, só endereço novo pra indexar.
const CODIGO_NO_ENDERECO = /(^|-)[a-z]{2,}[0-9]{2,}(-|$)/;
// Base do endereço de um set: { base, legado }.
//   legado: a régua de sempre — o slug do NOME e, quando sobra pouco (menos de
//     4 caracteres, ex.: ※確認中1 -> "1", que colidiria), `<setId>-<resto>`.
//     Alimenta só o slug do /set/ antigo.
//   base: a de hoje. Nome em japonês cujas letras que sobram NÃO formam
//     nenhuma palavra (nenhuma sequência de 3 letras: "30-db", "29-4", "16-z",
//     "9-vs", "2000", "20th", "3-qx") vira o setId puro. A sobra de "本弾
//     第30弾「出現！究極の敵DB！？」" é ruído do título; o "本弾 特別弾" vizinho
//     (nome só em japonês) já era "dbc-h31" desde 2026-11-02, e "dbc-h30" é o
//     mesmo padrão. Sobra com palavra
//     ("naruto", "seed-destiny", "act-1", "vstar", "ver-1") fica como está.
//     Sobra com código ("as01-j-1") também: já tem o que o setId diria.
//   Só vale com 4 ou mais caracteres sobrando: abaixo disso `legado` já
//   levava o setId na frente ("dbc-h10-10"), e esses endereços não mudam.
export function baseDoEnderecoDoSet(name, setId) {
  const nome = slugify(name);
  const id = slugify(setId);
  let legado = nome || id || "set";
  if (legado.length < 4) legado = id ? `${id}-${legado}` : `set-${legado}`;
  if (id && nome.length >= 4 && KANA_KANJI.test(String(name)) && !/[a-z]{3,}/.test(nome) &&
    !CODIGO_NO_ENDERECO.test(nome)) return { base: id, legado };
  return { base: legado, legado };
}

// Páginas de set de UM jogo, na ordem do byName. Dois slugs por set: o NOVO,
// único dentro do seu /games/<jogo>/ (usadosPorJogo, por endereço do jogo), e
// o ANTIGO do diretório plano /set/, que só o prerender usa — ele passa
// `slugAntigo(base)`, chamado pra todo set (inclusive o pulado sem endereço,
// como sempre foi: a ordem dos -2 antigos não pode mudar).
// Ordena as cartas de cada set por número (o representante sai daí).
export function paginasDoJogo(game, byName, { usadosPorJogo = new Map(), slugAntigo = null, aoPular = null } = {}) {
  const paginas = [];
  for (const [name, cards] of byName) {
    cards.sort((a, b) => cmpNumber(a.number, b.number));
    const rep = cards.find((c) => c.setLogo) || cards.find((c) => c.setReleaseDate) || cards[0];
    const { base, legado } = baseDoEnderecoDoSet(name, rep.setId);
    // O slug do /set/ antigo segue a régua de ANTES de 2026-11-28 (`legado`):
    // trocar a base mudaria as chaves de legado-sets.json e a ordem dos -2.
    const antigo = slugAntigo ? slugAntigo(legado) : undefined;
    const url = urlDoSet(game, rep.setId);
    if (!url) {
      if (aoPular) aoPular(name);
      continue;
    }
    let usados = usadosPorJogo.get(url);
    if (!usados) usadosPorJogo.set(url, (usados = new Set()));
    // O -en é a variante em inglês DESTE set: um set cujo nome já termine em
    // "-en" não pode tomar o arquivo da variante de outro.
    let s = base, j = 2;
    while (usados.has(s) || usados.has(`${s}-en`)) s = `${base}-${j++}`;
    usados.add(s);
    usados.add(`${s}-en`);
    paginas.push({ name, slug: s, slugAntigo: antigo, cards, rep, game, url, slugsCartas: slugsDasCartas(cards) });
  }
  return paginas;
}

// Endereço de cada carta (sem o /games/ da frente): Map "<jogo>|<id>" ->
// "<url>/<set>/<carta>". A chave leva o jogo porque o id só é único dentro
// dele.
export function enderecosDasCartas(paginas) {
  const mapa = new Map();
  for (const p of paginas || []) {
    for (const [id, carta] of p.slugsCartas) {
      const k = `${p.game}|${id}`;
      if (!mapa.has(k)) mapa.set(k, `${p.url}/${p.slug}/${carta}`);
    }
  }
  return mapa;
}
