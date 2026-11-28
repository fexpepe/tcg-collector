// Coleção guardada no aparelho (2026-11-27): Coleção, Painel e Explorar
// desenham na hora a partir da ÚLTIMA resposta da borda, e a rede atualiza por
// trás. Em 2026-11-28 entraram Portfólio, Desejos, Badges e os preços dos
// Fichários.
//
// Por quê: nessas telas o conteúdo dependia de um POST /api/collection a
// cada abertura, que só saía depois de o JS subir, e nada ficava no aparelho
// (a resposta é `no-store`). Medido em produção em 23/11, com 1.464 cartas: a
// página pronta aos 0,09 s e em esqueleto até 0,65–0,92 s no desktop, ~2 s num
// celular lento. As telas de set não têm essa espera porque o dado delas é
// arquivo que o service worker já guarda.
//
// Como:
//  - a cópia mora no Cache Storage (cabe 1 MB sem disputar a cota de 5 MB do
//    localStorage, onde vive a coleção em si). O sw.js mantém este cache entre
//    deploys (CACHES) e o "apagar conta e dados" do shared.js o apaga;
//  - o pedido à rede sai JÁ, junto com a leitura da cópia: a cópia nunca
//    atrasa a resposta de verdade, só chega antes dela;
//  - a cópia vai pra tela marcada `guardado` e `parcial`: quem grava o ponto do
//    dia do patrimônio ou republica o perfil público espera a rede (preço de
//    ontem não vira patrimônio de hoje);
//  - a rede respondeu IGUAL à cópia (o caso comum: preço muda uma vez por dia)
//    → `repetido`, e a página não redesenha nada;
//  - respondeu diferente (preço novo, carta nova) → a página redesenha e a
//    cópia é trocada;
//  - sem rede, com cópia: a tela fica com a cópia, em vez de erro.
//
// Fica FORA do shared.js de propósito: só as telas que mostram as cartas da
// pessoa usam, e o núcleo está no teto de peso (scripts/check-size.mjs).
//
// As cópias (uma por NOME; tela que divide o nome faz o mesmo pedido, senão
// uma pinta só um pedaço da cópia da outra e a regrava a cada abertura):
//   "colecao"  possuídas + as que estão em slab: Coleção, Painel e Badges;
//   "desejos"  as de cima + as desejadas: Portfólio e Lista de Desejos;
//   "explorar" as mais vistas do Explorar;
//   "fichario" as cartas do último fichário aberto (só os preços dependem
//              dela: os bolsos já desenham do aparelho).
(function () {
  const shared = window.TCGShared;
  // O MESMO nome está no CACHES do sw.js e no deleteAccountFlow do shared.js
  // (tests/colecao-guardada.test.mjs confere os três).
  const CACHE = "tcg-colecao-v1";
  // Endereço sintético: é só a chave da cópia, nunca vai à rede.
  const chave = (nome) => "/guardado/" + nome + ".json";

  function le(nome) {
    try {
      return caches.open(CACHE).then((c) => c.match(chave(nome))).then((r) => (r ? r.text() : "")).catch(() => "");
    } catch (e) { return Promise.resolve(""); } // sem Cache Storage (http, WebView antiga)
  }
  function grava(nome, texto) {
    try {
      caches.open(CACHE)
        .then((c) => c.put(chave(nome), new Response(texto, { headers: { "Content-Type": "application/json" } })))
        .catch(() => { /* cota cheia: a próxima abertura só não ganha o atalho */ });
    } catch (e) { /* sem Cache Storage */ }
  }

  // Da cópia, só as cartas que o pedido de AGORA quer: carta que saiu da
  // coleção (ou do ranking) desde a última visita não volta pra tela.
  // <do-pedido>
  function doPedido(cartas, pedido) {
    const quer = {};
    Object.keys(pedido || {}).forEach((g) => { quer[g] = new Set(pedido[g] || []); });
    return (cartas || []).filter((c) => c && quer[c.game] && quer[c.game].has(c.id));
  }
  // </do-pedido>

  // carrega(idsByGame, nome, pinta, espera)
  //   nome   — qual cópia (a lista está no cabeçalho deste arquivo);
  //   pinta(resultado, repetido) — chamada uma vez com a cópia (se houver) e
  //            outra com a resposta da rede. `resultado` tem o contrato do
  //            loadOwnedFast, mais `guardado: true` quando é a cópia;
  //   espera — promessa que precisa estar pronta antes de cada pintura (o
  //            câmbio), sem segurar o pedido à rede.
  // Resolve com a resposta da rede (null se ela falhou e a cópia ficou na
  // tela); rejeita só quando não há nem rede nem cópia.
  async function carrega(idsByGame, nome, pinta, espera) {
    const pedido = idsByGame || {};
    let chegou = false;
    const rede = shared.loadOwnedFast(pedido);
    const fimDaRede = rede.then(() => { chegou = true; }, () => { chegou = true; });
    const texto = await Promise.race([le(nome), fimDaRede.then(() => "")]);
    let pintado = null;
    if (texto && !chegou) {
      let copia = null;
      try { copia = JSON.parse(texto); } catch (e) { /* cópia torta: segue pela rede */ }
      const cartas = copia ? doPedido(copia.cards, pedido) : [];
      if (cartas.length) {
        const precos = copia.pricing || {};
        // Mesmo efeito do loadOwnedFast: o cardValue procura o preço aqui.
        Object.assign(window.TCG_PRICING = window.TCG_PRICING || {}, precos);
        // `texto` só serve de comparação se a cópia foi pra tela INTEIRA.
        pintado = { texto: cartas.length === copia.cards.length ? texto : "", precos };
        await espera;
        pinta({ cards: cartas, indexesByGame: {}, viaApi: true, parcial: true, guardado: true }, false);
      }
    }
    let fresco;
    try { fresco = await rede; } catch (e) {
      if (pintado) return null;
      throw e;
    }
    // A borda caiu, os chunks assumiram e vieram incompletos (rede ruim): a
    // cópia que está na tela vale mais do que meia coleção.
    if (pintado && !fresco.viaApi && fresco.parcial) return null;
    let repetido = false;
    // Só vira cópia a resposta da BORDA e com a tabela de preços dela: carta
    // guardada sem preço pintaria a coleção valendo zero na próxima abertura.
    if (fresco.viaApi && fresco.cards.length && fresco.pricing) {
      // Serializa ANTES de entregar: a página acrescenta campo na carta
      // (setTotal, por exemplo) e a cópia tem de ser o que a borda mandou.
      const novo = JSON.stringify({ cards: fresco.cards, pricing: fresco.pricing });
      repetido = !!pintado && pintado.texto === novo;
      if (!repetido) grava(nome, novo);
      // Preço que saiu da tabela não sobrevive só porque estava na cópia.
      if (pintado && !repetido) {
        Object.keys(pintado.precos).forEach((id) => { if (!(id in fresco.pricing)) delete window.TCG_PRICING[id]; });
      }
    }
    await espera;
    pinta(fresco, repetido);
    return fresco;
  }

  window.TCGGuardada = { carrega };
})();
