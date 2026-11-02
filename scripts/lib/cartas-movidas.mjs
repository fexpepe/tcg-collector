// Carta que mudou de SET: o endereço antigo leva 301 pro de hoje (2026-11-02).
//
// O endereço da carta é /games/<jogo>/<set>/<carta>. Quando a carta pedida não
// está no set do endereço, a borda procura uma parecida DENTRO do mesmo set
// (cartaParecida: total que mudou, nome que mudou). Carta que foi pra OUTRO set
// — mesmo id, outra página — dava 404: a PR #224 trocou 39 cartas do Data
// Carddass entre o 第1弾 e o 第2弾, e o TCGplayer tira produto de um grupo e põe
// noutro depois do lançamento (os "movidos" do lint-catalog).
//
// Procurar nos outros sets na hora não serve: cada set é um chunk a mais lido
// na borda, e robô pedindo endereço inventado multiplicaria o custo (toda
// visita a /games é Function, Workers Paid). O que vale é um REGISTRO pequeno,
// versionado em data/cartas-movidas.json:
//   { "<url>/<set antigo>/<carta antiga>": "<id>" }
// - quem escreve é o scripts/registra-cartas-movidas.mjs, que compara o
//   catálogo publicado (HEAD) com o recém-gerado — no deploy, logo depois do
//   lint, e o registro vai junto no commit do snapshot; à mão, na PR que muda
//   carta de set;
// - quem lê é o prerender, que resolve cada id no endereço de HOJE e grava no
//   mapa do jogo (data/game-pages/<jogo>.json, campo "m"), que a borda já lê
//   em todo pedido de carta. O 301 não custa leitura nenhuma a mais.
// Guarda o id, e não o destino, de propósito: a carta pode mudar de novo (de
// set, de total, de nome), e o destino sai do catálogo de cada build.
import { agrupaPorSet, paginasDoJogo, enderecosDasCartas } from "./paginas-de-set.mjs";
import { jogoDaUrl } from "../../functions/_lib/jogos.js";

const SET_DO = (endereco) => endereco.slice(0, endereco.lastIndexOf("/"));

// As cartas de UM jogo que mudaram de página de set entre dois catálogos:
// { "<url>/<set>/<carta>" antigo: id }. Fica de fora:
//   - carta que só mudou de endereço DENTRO do set: o cartaParecida resolve, e
//     registrar cada troca de total (o Secret Lair muda 2.600 de uma vez)
//     incharia o mapa;
//   - carta de set que deixou de existir: é set renomeado (setRenomeado) ou
//     incorporado (os ids aposentados do card-id-merges), não carta movida, e
//     registraria o set inteiro.
export function cartasQueMudaramDeSet(game, antes, depois) {
  const paginasHoje = paginasDoJogo(game, agrupaPorSet(depois));
  const antigos = enderecosDasCartas(paginasDoJogo(game, agrupaPorSet(antes)));
  const hoje = enderecosDasCartas(paginasHoje);
  const setsHoje = new Set(paginasHoje.map((p) => `${p.url}/${p.slug}`));
  const movidas = {};
  for (const [chave, antigo] of antigos) {
    const novo = hoje.get(chave);
    if (!novo || novo === antigo || SET_DO(novo) === SET_DO(antigo)) continue;
    if (!setsHoje.has(SET_DO(antigo))) continue;
    movidas[antigo] = chave.slice(chave.indexOf("|") + 1);
  }
  return movidas;
}

// Junta as movidas de agora no registro. Mesmo endereço antigo registrado de
// novo fica com a carta mais recente (foi a última a morar lá). Chaves em
// ordem: o diff do snapshot mostra só o que entrou.
export function juntaNoRegistro(registro, novas) {
  const tudo = { ...(registro || {}), ...(novas || {}) };
  return Object.fromEntries(Object.keys(tudo).sort().map((k) => [k, tudo[k]]));
}

// O registro resolvido no catálogo de hoje, pro mapa de cada jogo: Map url ->
// { "<set>/<carta>": "<url>/<set>/<carta>" }. Some do mapa a entrada cujo
// endereço antigo voltou a ser de uma carta (a carta de hoje vence: o 301
// roubaria a página dela), a do id que saiu do catálogo e a que já está no
// lugar.
export function destinosDasMovidas(registro, paginas) {
  const atual = enderecosDasCartas(paginas);
  const vivos = new Set(atual.values());
  const porUrl = new Map();
  for (const [antigo, id] of Object.entries(registro || {})) {
    const partes = antigo.split("/");
    if (partes.length !== 3 || vivos.has(antigo)) continue;
    const jogo = jogoDaUrl(partes[0]);
    const destino = jogo && atual.get(`${jogo.game}|${id}`);
    if (!destino || destino === antigo) continue;
    if (!porUrl.has(partes[0])) porUrl.set(partes[0], {});
    porUrl.get(partes[0])[`${partes[1]}/${partes[2]}`] = destino;
  }
  return porUrl;
}
