// Resgate do ?card=<id> órfão — a parte que fala com a borda. O shared.js
// decide SÍNCRONO se a carta é da pessoa (rescueSharedCard); quando não é, injeta
// este arquivo, que descobre jogo e set do id em duas ondas de sonda e manda pro
// destino canônico. Saiu do shared.js em 2026-09-14: só roda quando um link com
// ?card= chega numa página pessoal, e pesava em toda página.
(function () {
  const S = window.TCGShared;
  if (!S || !S._nucleo) return;
  const { GAME_SLUGS, cardShareUrl } = S;
  const { currentGame, fetchCollectionApi } = S._nucleo;

  // Onde procurar o id, em DUAS ONDAS. O prefixo resolve o jogo na maioria dos
  // casos (mtg-, ygo-, op-…), mas não em todos: Pokémon usa <set>-<número>, que
  // é uma lista ABERTA de 163 prefixos, e Lorcana usa número puro ("1-1") — o
  // comentário do migrateTags já dizia que prefixo de id não serve como regra.
  // Então isto é ATALHO, não regra: a 1ª onda vai nos candidatos e a 2ª no
  // resto. O jogo novo (o 15º) continua resolvendo — só gasta as duas ondas —
  // em vez de virar link morto quando este mapa envelhecer. Auditado: nenhum
  // dos 163 prefixos do Pokémon colide com um destes.
  const ID_PREFIX_GAME = {
    mtg: "magic", fab: "fab", gcg: "gundam", dbfw: "dbfw", ygo: "ygo",
    dgm: "digimon", rb: "riftbound", ua: "unionarena", nrt: "naruto",
    hxh: "hxh", op: "onepiece", opcd: "onepiece", op2002: "onepiece", cp: "lorcana"
  };
  function cardIdProbeWaves(cardId) {
    const certo = ID_PREFIX_GAME[String(cardId).split("-")[0]];
    const primeiros = certo ? [certo] : ["pokemon", "lorcana"];
    const onda1 = primeiros.filter((g) => GAME_SLUGS.includes(g));
    return [onda1, GAME_SLUGS.filter((g) => !onda1.includes(g))];
  }

  // Descobre o jogo e o set do id pela BORDA e redireciona. Cada jogo pedido é
  // uma busca por PK (não varredura), porque a PK de `cards` é (game, id) e não
  // existe índice de id sozinho. O endpoint percorre os jogos do pedido em
  // SÉRIE (~140 ms cada), e é por isso que as ondas importam: 1 jogo ≈ 150 ms e
  // os 14 de uma vez ≈ 2 s — tempo em que esta página fica parada.
  function goToCanonicalCard(cardId) {
    // Não deu: segue pra própria página SEM o ?card=. Não vira laço (o param
    // que dispara o resgate deixou de existir) e a pessoa cai onde cairia antes.
    const desiste = () => {
      try {
        const u = new URL(location.href);
        u.searchParams.delete("card");
        window.location.replace(u.href);
      } catch (e) { window.location.reload(); }
    };
    let acabou = false;
    let timer = 0;
    const fim = (fn) => { if (acabou) return; acabou = true; clearTimeout(timer); fn(); };
    // Teto de espera: a página está PARADA esperando isto (o return do
    // rescueSharedCard impede o resto de montar). Borda pendurada não pode
    // deixar o visitante numa tela em branco pra sempre; estourando, ele cai
    // onde cairia antes desta função existir.
    timer = setTimeout(() => fim(desiste), 5000);
    const sonda = (games) => (games.length
      ? fetchCollectionApi(Object.fromEntries(games.map((g) => [g, [cardId]])))
      : Promise.resolve(null));
    const [onda1, onda2] = cardIdProbeWaves(cardId);
    // Id igual em dois jogos é possível (Pokémon e Lorcana são ambos sem
    // prefixo de jogo): o da sessão ganha, senão o primeiro que voltou.
    const escolher = (r) => {
      const achadas = (r && r.cards) || [];
      const atual = currentGame();
      return achadas.find((c) => c.game === atual) || achadas[0] || null;
    };
    sonda(onda1)
      .then((r) => escolher(r) || (acabou ? null : sonda(onda2).then(escolher)))
      .then((card) => fim(() => {
        if (!card || !card.set) { desiste(); return; }
        window.location.replace(cardShareUrl(card));
      }))
      .catch(() => fim(desiste));
  }

  window.TCGCardRescue = goToCanonicalCard;
})();
