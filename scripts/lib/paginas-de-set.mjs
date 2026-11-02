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
    let base = slugify(name) || slugify(rep.setId) || "set";
    // Nome quase todo CJK (sobra só um dígito, ex.: ※確認中1 -> "1"): slug
    // curto demais colide — prefixa o setId.
    if (base.length < 4) base = slugify(rep.setId) ? `${slugify(rep.setId)}-${base}` : `set-${base}`;
    const antigo = slugAntigo ? slugAntigo(base) : undefined;
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
