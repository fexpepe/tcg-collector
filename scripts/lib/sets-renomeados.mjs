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

// pages: as páginas de set do prerender ({ url, slug, cards }).
// Devolve { porUrl: Map(url -> { <slug antigo>: <slug de hoje> }),
//           legado: { <slug do /set/>: "<url>/<slug de hoje>" }, avisos }.
export function enderecosRenomeados(pages, tabela) {
  const slugDoSetId = new Map();
  const vivos = new Set();
  for (const p of pages || []) {
    vivos.add(`${p.url}\t${p.slug}`);
    for (const c of p.cards || []) {
      const k = `${p.url}\t${c.setId}`;
      if (c.setId && !slugDoSetId.has(k)) slugDoSetId.set(k, p.slug);
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
  for (const [antigo, destino] of Object.entries((tabela && tabela.set) || {})) {
    const corte = String(destino).indexOf("/");
    const url = String(destino).slice(0, corte), setId = String(destino).slice(corte + 1);
    const hoje = slugDoSetId.get(`${url}\t${setId}`);
    if (!hoje) { avisos.push(`/set/${antigo}: o set ${setId} não está mais em /games/${url}`); continue; }
    legado[antigo] = `${url}/${hoje}`;
  }
  return { porUrl, legado, avisos };
}
