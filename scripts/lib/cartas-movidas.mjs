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
//
// O mesmo registro serve, desde 2026-11-04, pro endereço que mudou DENTRO do
// set e que o cartaParecida resolveria errado: a borda olha o "m" antes de
// procurar parecida, então registrar o antigo -> id basta (ver
// enderecosARegistrar).
import { agrupaPorSet, paginasDoJogo, enderecosDasCartas } from "./paginas-de-set.mjs";
import { jogoDaUrl } from "../../functions/_lib/jogos.js";
import { preparaParecida } from "../../functions/_lib/slug-carta.js";
import { setsSemPagina, registroDosSets } from "./sets-renomeados.mjs";

const SET_DO = (endereco) => endereco.slice(0, endereco.lastIndexOf("/"));
const CARTA_DO = (endereco) => endereco.slice(endereco.lastIndexOf("/") + 1);

// Os endereços antigos de UM jogo que precisam do registro, entre dois
// catálogos: { movidas, erradas, sets }. movidas e erradas são
// { "<url>/<set>/<carta>" antigo: id }; sets é o registro automático dos sets
// que mudaram de endereço ({ "<url>/<set antigo>": [ids] }, ver
// scripts/lib/sets-renomeados.mjs).
//   - movidas: a carta foi pra OUTRA página de set que segue existindo — ou,
//     desde 2026-11-10, o set dela deixou de ter página e ela NÃO foi junto
//     com a maioria (o set se dividiu em dois, ou se espalhou sem maioria e
//     não ganha de-para): o 301 do set a levaria pra página errada, ou não
//     haveria 301 nenhum;
//   - erradas (2026-11-04): a carta mudou de endereço DENTRO do set e o
//     cartaParecida, que é o que a borda roda nesse caso, levaria o endereço
//     antigo pra OUTRA carta, ou pra nenhuma (404). Acontece quando dois
//     números viram o mesmo pedaço de endereço, porque o kanji some (PR忍-17
//     e PR作-17 são "pr-17"; 忍-234 e 作-234, "234", no Naruto Card Game, PR
//     #234), ou quando o total do endereço antigo é lido como desempate
//     ("inevitable-betrayal-1935-2865" no Secret Lair). A conta é a da borda:
//     as cartas de HOJE da página, o mesmo preparaParecida.
// Fica de fora:
//   - carta que mudou dentro do set e o cartaParecida acha: registrar cada
//     troca de total (o Secret Lair muda 2.700 de uma vez) incharia o mapa;
//   - endereço antigo que hoje é de outra carta: a carta de hoje vence (o
//     destinosDasMovidas também tiraria);
//   - carta de set que deixou de ter página e foi com a maioria pro set de
//     hoje: quem leva o endereço é o de-para do SET (`sets`), uma entrada pro
//     set inteiro; registrar carta por carta incharia o mapa.
// `idDeHoje(id)`: o id novo de carta aposentada (data/card-id-merges.json),
// pro set importado que a fonte publicou com outro id e outro nome.
export function enderecosARegistrar(game, antes, depois, idDeHoje) {
  const paginasHoje = paginasDoJogo(game, agrupaPorSet(depois));
  const paginasAntes = paginasDoJogo(game, agrupaPorSet(antes));
  const antigos = enderecosDasCartas(paginasAntes);
  const semPagina = setsSemPagina(paginasAntes, paginasHoje, idDeHoje);
  const hoje = enderecosDasCartas(paginasHoje);
  const vivos = new Set(hoje.values());
  const paginaDe = new Map(paginasHoje.map((p) => [`${p.url}/${p.slug}`, p]));
  // Uma preparação por página, só das páginas que têm carta mudada.
  const resolvedores = new Map();
  const resolve = (pagina, slug) => {
    let r = resolvedores.get(pagina);
    if (!r) {
      const idDoSlug = new Map([...pagina.slugsCartas].map(([id, s]) => [s, id]));
      const acha = preparaParecida(pagina.cards, pagina.slugsCartas);
      r = (pedido) => { const s = acha(pedido); return s ? idDoSlug.get(s) || null : null; };
      resolvedores.set(pagina, r);
    }
    return r(slug);
  };
  const movidas = {};
  const erradas = {};
  for (const [chave, antigo] of antigos) {
    const novo = hoje.get(chave);
    if (!novo || novo === antigo) continue;
    const pagina = paginaDe.get(SET_DO(antigo));
    const id = chave.slice(chave.indexOf("|") + 1);
    if (!pagina) {
      // O set do endereço não tem mais página. Se a carta está no destino do
      // de-para do set, o 301 do set a leva; senão entra aqui, uma a uma.
      const { destino } = semPagina.get(SET_DO(antigo)) || {};
      if (!destino || SET_DO(novo) !== `${destino.url}/${destino.slug}`) movidas[antigo] = id;
      continue;
    }
    if (SET_DO(novo) !== SET_DO(antigo)) { movidas[antigo] = id; continue; }
    if (vivos.has(antigo)) continue;
    if (resolve(pagina, CARTA_DO(antigo)) !== id) erradas[antigo] = id;
  }
  return { movidas, erradas, sets: registroDosSets(semPagina) };
}

// Só as que mudaram de set (o nome de antes de 2026-11-04, que o teste usa).
export function cartasQueMudaramDeSet(game, antes, depois) {
  return enderecosARegistrar(game, antes, depois).movidas;
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
