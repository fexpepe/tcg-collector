// Régua do lint-catalog: o `setLogo` de um set nunca é a ilustração de uma
// carta dele (contrato 3 do docs/CATALOGO.md: dado que falta não se inventa).
//
// Set sem logo próprio fica com `setLogo: ""` e a tela mostra o NOME. Até
// 2026-11-28 o One Piece Carddass (opcd-) gravava a imagem da 1ª carta de cada
// set como logo, e o chip do set aparecia como uma carta cortada em vez do
// nome; a decisão do Fernando (D6) é que arte de carta como logo é o que a
// regra proíbe, então o lint barra o padrão em qualquer jogo.
//
// Só o mesmo setId conta: é onde o padrão nasce ("a arte da 1ª carta do set").
// Sem rede e sem fs de propósito (testes em tests/logo-de-carta.test.mjs).

// Devolve [{ setId, set, logo, cartas }]: um item por set cujo setLogo é igual
// à imagem de alguma carta do próprio set. `cartas` = quantas cartas do set
// têm esse setLogo. Lista vazia = catálogo em ordem.
export function setsComLogoDeCarta(cards) {
  const imagens = new Map();   // setId -> Set de imagens das cartas do set
  for (const c of cards || []) {
    if (!c || !c.image) continue;
    const k = String(c.setId ?? "");
    if (!imagens.has(k)) imagens.set(k, new Set());
    imagens.get(k).add(c.image);
  }
  const achados = new Map();
  for (const c of cards || []) {
    if (!c || !c.setLogo) continue;
    const k = String(c.setId ?? "");
    if (!imagens.get(k)?.has(c.setLogo)) continue;
    if (!achados.has(k)) achados.set(k, { setId: k, set: c.set || "", logo: c.setLogo, cartas: 0 });
    achados.get(k).cartas++;
  }
  return [...achados.values()];
}
