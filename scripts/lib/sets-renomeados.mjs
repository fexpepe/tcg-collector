// Endereço antigo de set renomeado -> endereço de hoje (2026-11-02).
//
// O slug do set em /games/<jogo>/<set> sai do NOME do set (prerender), então
// renomear um set troca o endereço dele e o de todas as cartas abaixo. O
// setRenomeado da borda (functions/_lib/borda.js) só acha o nome que GANHOU um
// prefixo; o que PERDEU o prefixo ou mudou no meio precisa de um de-para.
//
// Em 2026-11-02 os sets vintage perderam o nome do jogo ou da linha que os
// syncs punham na frente ("Naruto CCG — The Path to Hokage" virou "The Path to
// Hokage"; contrato 7 do docs/CATALOGO.md): 194 sets em sete endereços de
// jogo. Nos de nome só em japonês o slug passou a sair do setId
// ("data-carddass-1" virou "nrt-dc-s01-1"), sem relação de texto com o antigo.
//
// scripts/data/sets-renomeados.json guarda, por endereço de jogo, o slug
// ANTIGO -> o setId. O destino é o setId, e não o slug novo, porque o slug de
// hoje depende do nome de hoje: se o set mudar de nome de novo, o 301 continua
// achando a página certa. O prerender chama isto e grava o resultado no mapa
// do jogo (campo `r` de data/game-pages/<jogo>.json, lido pela borda) e no
// legado-sets.json (o 301 do /set/<slug> de antes de 2026-09-30, cujos slugs
// eram os mesmos nesses sets).
//
// Mudança de sync que renomeie set já publicado: rodar o prerender antes e
// depois e acrescentar na tabela os slugs que sumiram (docs/CATALOGO.md, 3.2).

// pages: as páginas de set do prerender ({ url, slug, cards }).
// tabela: { <url do jogo>: { <slug antigo>: <setId> } }.
// Devolve { porUrl: Map(url -> { <slug antigo>: <slug de hoje> }), avisos }.
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
  const avisos = [];
  for (const [url, dePara] of Object.entries(tabela || {})) {
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
  return { porUrl, avisos };
}
