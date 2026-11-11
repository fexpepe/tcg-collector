// Endereço antigo de set renomeado -> endereço de hoje (2026-11-02).
//
// O slug do set em /games/<jogo>/<set> sai do NOME do set (prerender), então
// renomear um set troca o endereço dele e o de todas as cartas abaixo. O
// setRenomeado da borda (functions/_lib/borda.js) só acha o nome que GANHOU um
// prefixo; o que PERDEU o prefixo ou mudou no meio precisa de um de-para.
//
// Em 2026-11-02 os sets perderam o nome do jogo ou da linha na frente
// (contrato 7 do docs/CATALOGO.md): 197 vintage, que os syncs montavam
// ("Naruto CCG — The Path to Hokage" virou "The Path to Hokage"), e 16
// grupos genéricos do TCGplayer nos modernos ("One Piece Promotion Cards"
// virou "Promotion Cards"). Nos de nome só em japonês o slug passou a sair do
// setId ("data-carddass-1" virou "nrt-dc-s01-1"), sem relação de texto com o
// antigo.
//
// scripts/data/sets-renomeados.json tem duas partes:
//   games: { <url do jogo>: { <slug antigo>: <setId> } } — o 301 de
//     /games/<jogo>/<set> (campo `r` de data/game-pages/<jogo>.json). Vale
//     também pro /set/<slug> de antes de 2026-09-30, que nesses sets tinha o
//     mesmo slug, quando a chave está livre no legado-sets.json.
//   set: { <slug do /set/ antigo>: "<url do jogo>/<setId>" } — chave do
//     legado que o nome novo de OUTRO set tomaria. O legado-sets.json é
//     refeito a cada build com os nomes de hoje e único entre todos os jogos
//     (o primeiro da lista leva o slug sem -2): com o One Piece virando
//     "Promotion Cards", o /set/promotion-cards (os promos do Naruto) passaria
//     a levar pro One Piece. A fixação segura o destino de antes.
// O destino é o setId, e não o slug novo, porque o slug de hoje depende do
// nome de hoje: se o set mudar de nome de novo, o 301 continua achando a
// página certa.
//
// Mudança de sync que renomeie set já publicado: rodar o prerender sem rede
// antes e depois, acrescentar em `games` os slugs que sumiram e, em `set`, as
// chaves do legado-sets.json que passaram a levar a outro set
// (docs/CATALOGO.md, 3.2).
//
// ── Registro automático (2026-11-10) ────────────────────────────────────────
// A tabela acima é escrita à mão, na PR que renomeia o set. O nome que muda NA
// FONTE, no sync diário, não passa por PR nenhuma: em 08/11/2026 três sets
// japoneses do Pokémon trocaram de nome ("Rapid Strike Master" virou
// "連撃マスター", "MEGA Expansion 30th Celebration" virou "30th CELEBRATION"…) e
// os 322 endereços deles (set, -en e cartas) passaram a responder 404. O
// registro das cartas movidas pulava o set que deixou de existir, contando com
// um de-para que ninguém escreveu (relatório de Páginas de 10/11, docs/SEO.md).
// Agora o deploy registra sozinho, no mesmo passo e com a mesma comparação
// (scripts/registra-cartas-movidas.mjs, disco × HEAD), em
// data/sets-renomeados-auto.json:
//   { "<url do jogo>/<slug antigo>": ["<id de carta>", …] }
// O destino são IDS DE CARTA, e não o setId da tabela à mão, porque no Pokémon
// o setId não diz qual página é: o mesmo id serve a mais de uma edição (o S5R
// japonês e o chinês são páginas diferentes) e a página é o NOME do set, que
// junta chunks de setId diferente. O id da carta é o que não muda. O prerender
// leva o endereço antigo pra página de hoje onde está a maioria dos ids
// guardados (até 3, pra uma carta que troque de set depois não levar o
// endereço do set inteiro com ela).
import { agrupaPorSet, paginasDoJogo } from "./paginas-de-set.mjs";

// Ids guardados por endereço: o primeiro, o do meio e o último, em ordem.
const AMOSTRA = 3;
function amostraDeIds(ids) {
  const ordem = [...new Set(ids.map(String))].sort();
  if (ordem.length <= AMOSTRA) return ordem;
  return [ordem[0], ordem[ordem.length >> 1], ordem[ordem.length - 1]];
}

// Página de set que existia e hoje não tem mais aquele endereço, e pra onde as
// cartas dela foram: Map "<url>/<slug antigo>" -> { destino, ids }.
//   destino: a página de hoje, no MESMO /games/<jogo> (o de-para da borda é
//     por jogo), com mais da metade das cartas da antiga; null quando o set
//     saiu do catálogo ou se espalhou sem maioria (redirecionar o set pra onde
//     foi uma carta só diria que ele ainda existe);
//   ids: as cartas da antiga que estão no destino, com o id de hoje.
// `idDeHoje(id)` traduz o id aposentado (set importado que a fonte publicou
// com outro id, data/card-id-merges.json): sem ele a carta parece ter sumido.
export function setsSemPagina(paginasAntes, paginasHoje, idDeHoje) {
  const vivos = new Set((paginasHoje || []).map((p) => `${p.url}/${p.slug}`));
  const paginaDoId = new Map();
  for (const p of paginasHoje || []) for (const id of p.slugsCartas.keys()) if (!paginaDoId.has(id)) paginaDoId.set(id, p);
  const semPagina = new Map();
  for (const p of paginasAntes || []) {
    const chave = `${p.url}/${p.slug}`;
    if (vivos.has(chave) || semPagina.has(chave)) continue;
    const total = p.slugsCartas.size;
    const porPagina = new Map();
    for (const antigo of p.slugsCartas.keys()) {
      const id = paginaDoId.has(antigo) ? antigo : String((idDeHoje && idDeHoje(antigo)) || "");
      const pagina = id && paginaDoId.get(id);
      if (!pagina || pagina.url !== p.url) continue;
      if (!porPagina.has(pagina)) porPagina.set(pagina, []);
      porPagina.get(pagina).push(id);
    }
    let destino = null, ids = [];
    for (const [pagina, lista] of porPagina) if (lista.length > ids.length) { destino = pagina; ids = lista; }
    if (ids.length * 2 <= total) { destino = null; ids = []; }
    semPagina.set(chave, { destino, ids });
  }
  return semPagina;
}

// O que entra no registro automático entre dois catálogos de UM jogo:
// { "<url>/<slug antigo>": [ids] }, só dos sets que têm destino.
export function setsARegistrar(game, antes, depois, idDeHoje) {
  const semPagina = setsSemPagina(paginasDoJogo(game, agrupaPorSet(antes)), paginasDoJogo(game, agrupaPorSet(depois)), idDeHoje);
  return registroDosSets(semPagina);
}
export function registroDosSets(semPagina) {
  const novos = {};
  for (const [chave, { destino, ids }] of semPagina) if (destino) novos[chave] = amostraDeIds(ids);
  return novos;
}

// O arquivo do registro: chaves em ordem (o diff do snapshot mostra só o que
// entrou) e uma entrada por linha.
export function textoDoRegistroDeSets(registro) {
  const chaves = Object.keys(registro || {}).sort();
  return "{\n" + chaves.map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(registro[k])}`).join(",\n") + "\n}\n";
}

// pages: as páginas de set do prerender ({ url, slug, cards }).
// registro: o automático ({ "<url>/<slug antigo>": [ids] }), opcional.
// idDeHoje(id): o id novo de carta aposentada (data/card-id-merges.json),
//   opcional — o id guardado no registro pode ser aposentado depois, quando a
//   fonte publica o set importado com outro id, e o 301 não pode cair junto.
// Devolve { porUrl: Map(url -> { <slug antigo>: <slug de hoje> }),
//           legado: { <slug do /set/>: "<url>/<slug de hoje>" }, avisos }.
export function enderecosRenomeados(pages, tabela, registro, idDeHoje) {
  const slugDoSetId = new Map();
  const slugDoId = new Map();
  const vivos = new Set();
  for (const p of pages || []) {
    vivos.add(`${p.url}\t${p.slug}`);
    for (const c of p.cards || []) {
      const k = `${p.url}\t${c.setId}`;
      if (c.setId && !slugDoSetId.has(k)) slugDoSetId.set(k, p.slug);
      const ki = `${p.url}\t${c.id}`;
      if (c.id != null && !slugDoId.has(ki)) slugDoId.set(ki, p.slug);
    }
  }
  const porUrl = new Map();
  const legado = {};
  const avisos = [];
  for (const [url, dePara] of Object.entries((tabela && tabela.games) || {})) {
    const r = {};
    for (const [antigo, setId] of Object.entries(dePara || {})) {
      // Um set de hoje com o slug antigo é dono do endereço: o de-para não
      // passa por cima de página que existe.
      if (vivos.has(`${url}\t${antigo}`)) continue;
      const hoje = slugDoSetId.get(`${url}\t${setId}`);
      if (!hoje) { avisos.push(`${url}/${antigo}: o set ${setId} não está mais em /games/${url}`); continue; }
      r[antigo] = hoje;
    }
    if (Object.keys(r).length) porUrl.set(url, r);
  }
  // O registro automático, depois da tabela: endereço que a tabela já resolve
  // fica com ela (foi escrito por quem sabia o destino). Vale a página onde
  // está a MAIORIA dos ids guardados; id que saiu do catálogo não vota.
  for (const [chave, ids] of Object.entries(registro || {})) {
    const corte = chave.indexOf("/");
    const url = chave.slice(0, corte), antigo = chave.slice(corte + 1);
    if (corte < 1 || !antigo || antigo.includes("/") || !Array.isArray(ids)) { avisos.push(`${chave}: entrada torta no registro automático`); continue; }
    if (vivos.has(`${url}\t${antigo}`)) continue;
    const r = porUrl.get(url) || {};
    if (Object.prototype.hasOwnProperty.call(r, antigo)) continue;
    const votos = new Map();
    for (const id of ids) {
      const slug = slugDoId.get(`${url}\t${id}`) || slugDoId.get(`${url}\t${(idDeHoje && idDeHoje(id)) || ""}`);
      if (slug) votos.set(slug, (votos.get(slug) || 0) + 1);
    }
    let hoje = null, n = 0;
    for (const [slug, v] of votos) if (v > n) { hoje = slug; n = v; }
    if (!hoje) { avisos.push(`${url}/${antigo}: nenhuma carta do registro automático está mais em /games/${url}`); continue; }
    r[antigo] = hoje;
    porUrl.set(url, r);
  }
  for (const [antigo, destino] of Object.entries((tabela && tabela.set) || {})) {
    const corte = String(destino).indexOf("/");
    const url = String(destino).slice(0, corte), setId = String(destino).slice(corte + 1);
    const hoje = slugDoSetId.get(`${url}\t${setId}`);
    if (!hoje) { avisos.push(`/set/${antigo}: o set ${setId} não está mais em /games/${url}`); continue; }
    legado[antigo] = `${url}/${hoje}`;
  }
  return { porUrl, legado, avisos };
}
