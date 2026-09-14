// Facetas da página de SET e o TIPO principal da carta, por jogo — usados só
// pelo detalhe do set (detail.js) e pelo construtor de decks (decks.js). Saiu do
// shared.js em 2026-09-14: ~200 linhas de tabela que as outras 30 páginas
// baixavam sem usar. Carregado estático por detail.html, decks.html e
// my-decks.html, depois do shared.js; treatLabel/TREAT_NOISE ficaram no núcleo
// porque o popup da carta (que abre em qualquer página) também os usa.
(function () {
  const S = window.TCGShared;
  if (!S) return;
  const { TREAT_NOISE, t, treatLabel } = S;

  // ── Facetas da página de SET, por jogo ─────────────────────────────────────
  // Configurado UMA vez por jogo e valendo pra todo set dele — presente e
  // futuro: a lista de opções de cada faceta sai das cartas que a página
  // carregou, não de uma lista fixa. Set novo do Magic já nasce filtrável, e
  // uma raridade/cor/tratamento inédito aparece sozinho.
  //
  // Contrato de cada faceta:
  //   key      identificador (vai pro estado da página)
  //   labelKey chave i18n do título do grupo
  //   of(card) valores DA CARTA nessa faceta (array; várias = a carta conta em
  //            todas — ex.: "Artifact Creature" é Artefato E Criatura)
  //   label(v) rótulo de uma opção
  //   order    ordem fixa das opções conhecidas; o que não está aqui vai pro
  //            fim, em ordem alfabética (é o que faz token novo aparecer)
  //
  // Magic: os quatro campos abaixo existem no catálogo (sync-magic.mjs) —
  // rarity/cardType em 100% das cartas, color ausente = incolor, e `treat`
  // (tratamento) só nas impressões especiais. "Impressões"
  // (lançamento/relançamento) NÃO entra: o Scryfall tem `reprint`, mas a gente
  // não grava, e o Fernando dispensou.
  const MTG_COLOR = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
  function mtgColorBucket(card) {
    const cores = String(card.color || "").split(";").filter(Boolean);
    if (cores.length > 1) return "multi";
    if (cores.length === 1) return MTG_COLOR[cores[0]] || "colorless";
    // Sem cor: terreno é categoria própria (é o que o jogador procura), o resto
    // é incolor (artefatos, Eldrazi…).
    return /\bland\b/i.test(String(card.cardType || "")) ? "land" : "colorless";
  }
  // Tipos de carta do Magic, em ordem canônica (os oito primeiros são o que
  // aparece num deck de verdade; o resto existe em produto de brincadeira/
  // suplemento e entra só pra não sobrar type_line crua na lista).
  const MTG_TYPES = [
    "creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "battle",
    "kindred", "tribal", "conspiracy", "dungeon", "phenomenon", "plane", "scheme", "vanguard", "emblem"
  ];
  function mtgTypeBuckets(card) {
    const linha = String(card.cardType || "").toLowerCase();
    // Uma carta pode ser vários tipos ("Artifact Creature", "Land Creature").
    const achados = MTG_TYPES.filter((tipo) => new RegExp(`\\b${tipo}\\b`).test(linha));
    if (achados.length) return achados;
    // "Summon — Dinosaur" / "Summon Wolf": grafia dos anos 90 (Legends/The Dark)
    // pro que hoje é Creature. Sem isto cada Summon virava um tipo só dele.
    if (/^summon\b/.test(linha)) return ["creature"];
    return [];
  }
  // Helpers das facetas fora do Magic. Valor multi vira uma opção POR PARTE
  // ("Green;Red" do One Piece/Digimon, "Amber/Steel" dos dual-ink do Lorcana):
  // quem procura "as verdes" espera achar a Green;Red lá dentro. Os RÓTULOS
  // ficam no inglês da fonte de propósito (Amber, Leader, Digi-Egg…) — é o
  // texto impresso na carta, como os tratamentos do Magic.
  const facetSplit = (v, sep) => String(v || "").split(sep).map((s) => s.trim()).filter(Boolean);
  const FACET_COLOR_ORDER = ["Red", "Green", "Blue", "Purple", "Black", "Yellow", "White"];
  const facetColor = (field) => ({
    key: "color", labelKey: "facet.color",
    of: (c) => facetSplit(c[field], ";"),
    label: (v) => v,
    order: FACET_COLOR_ORDER
  });
  const facetType = (order) => ({
    key: "type", labelKey: "facet.cardType",
    of: (c) => (c.cardType ? [String(c.cardType)] : []),
    label: (v) => v,
    order: order || []
  });
  // Nível (Digimon/Gundam): só dígito limpo — a fonte deixa passar "—"/"-".
  const facetLevel = {
    key: "level", labelKey: "facet.level",
    of: (c) => (/^\d+$/.test(String(c.level)) ? [String(c.level)] : []),
    label: (v) => v,
    order: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
  };

  // Facetas por jogo, derivadas dos campos que o sync já grava — as guardas do
  // renderFacets fazem o resto (faceta sem dado não aparece; opção presente em
  // 100% das cartas é descartada). Raridade fica FORA de propósito nos jogos
  // novos: o select de raridade deles já funciona e tem tratamento próprio
  // (rarityAsFacet só esconde o select de quem declara a faceta, como o Magic).
  // Pokémon segue fora: o types/stage só existe no catálogo de produção, que
  // este ambiente não alcança pra conferir — ligar às cegas é contra a regra.
  const GAME_FACETS = {
    lorcana: [
      {
        key: "ink", labelKey: "facet.ink",
        of: (c) => facetSplit(c.ink, "/"),
        label: (v) => v,
        order: ["Amber", "Amethyst", "Emerald", "Ruby", "Sapphire", "Steel"]
      },
      facetType(["Character", "Action", "Action/Song", "Item", "Location"])
    ],
    onepiece: [
      facetColor("opColor"),
      facetType(["Leader", "Character", "Event", "Stage"])
    ],
    digimon: [
      facetColor("color"),
      facetLevel,
      facetType(["Digi-Egg", "Digimon", "Tamer", "Option"])
    ],
    gundam: [
      facetColor("color"),
      facetLevel,
      facetType(["Unit", "Pilot", "Command", "Base", "Resource", "EX Base", "EX Resource"])
    ],
    dbfw: [
      facetColor("color"),
      facetType(["Leader", "Battle", "Extra"])
    ],
    fab: [
      {
        key: "pitch", labelKey: "facet.pitch",
        of: (c) => (/^\d+$/.test(String(c.pitch)) ? [String(c.pitch)] : []),
        label: (v) => v,
        order: ["0", "1", "2", "3", "4"]
      },
      {
        key: "talent", labelKey: "facet.talent",
        of: (c) => facetSplit(c.talent, ";"),
        label: (v) => v,
        order: []
      },
      facetType(["Hero", "Weapon", "Equipment", "Action", "Attack Reaction", "Defense Reaction", "Instant"])
    ],
    magic: [
      {
        key: "rarity", labelKey: "toolbar.rarity",
        of: (c) => (c.rarity ? [String(c.rarity)] : []),
        label: (v) => { const k = `mtg.rarity.${v}`; const r = t(k); return r === k ? v : r; },
        order: ["common", "uncommon", "rare", "mythic", "special", "bonus"]
      },
      {
        key: "color", labelKey: "facet.color",
        of: (c) => [mtgColorBucket(c)],
        label: (v) => t(`mtg.color.${v}`),
        order: ["white", "blue", "black", "red", "green", "multi", "colorless", "land"]
      },
      {
        key: "type", labelKey: "facet.cardType",
        of: mtgTypeBuckets,
        label: (v) => t(`mtg.type.${v}`),
        order: MTG_TYPES
      },
      {
        key: "treat", labelKey: "facet.treatment",
        // Filtra o RUÍDO que o sync deixou passar. Medido no LTR:
        // `universesbeyond` marcava as 854 cartas do set (opção que não filtra
        // nada), `legendary` (398) é MOLDURA e não tratamento, e bundle/
        // playpromo/storechampionship/tourney são marcas de EVENTO. Sobram os
        // que a pessoa procura: showcase, scroll, silverfoil, borderless,
        // fullart, extendedart, surgefoil, inverted, poster…
        // Aqui no CLIENTE de propósito: mexer na denylist do sync exigiria
        // rebuild completo do Magic (648 sets no Scryfall) a cada ajuste.
        of: (c) => String(c.treat || "").split(";").filter((tk) => tk && !TREAT_NOISE.has(tk)),
        label: treatLabel,
        order: ["borderless", "extendedart", "showcase", "fullart", "etched", "inverted", "surgefoil"]
      }
    ]
  };
  function gameFacets(game) { return GAME_FACETS[game] || []; }

  // TIPO PRINCIPAL da carta, pra AGRUPAR (lista do deck, facetas…). No Magic o
  // `cardType` é a type_line INTEIRA ("Artifact Creature — Golem"), então
  // agrupar pelo campo cru separava cada subtipo num grupo: Golem de um lado,
  // Goblin Sorcerer de outro, e a lista virava uma escada. Aqui volta o tipo de
  // verdade (Criatura), com o mesmo vocabulário da faceta.
  // Carta de vários tipos entra no PRIMEIRO da ordem canônica — a lista precisa
  // de um grupo só por carta (diferente da faceta, onde ela conta em todos).
  // Jogos sem regra própria seguem com o campo cru, que já é o tipo deles.
  function cardTypeGroup(game, card) {
    if (!card) return { key: "", label: "" };
    if (game === "magic") {
      const b = mtgTypeBuckets(card);
      // Rótulo tolerante: tipo sem tradução (os de suplemento) mostra o próprio
      // token capitalizado, então dá pra estender MTG_TYPES sem 3 traduções.
      if (b.length) {
        const chave = `mtg.type.${b[0]}`;
        const rot = t(chave);
        return { key: b[0], label: rot === chave ? b[0].charAt(0).toUpperCase() + b[0].slice(1) : rot };
      }
      return { key: "", label: "" };
    }
    const cru = String(card.cardType || card.category || "");
    return { key: cru, label: cru };
  }

  Object.assign(S, { gameFacets, cardTypeGroup });
})();
