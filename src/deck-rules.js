// Regras de deck por jogo ("rule packs"). O construtor (decks.js) NÃO conhece
// nenhum jogo: ele lê estes pacotes declarativos. Jogo sem pacote cai no MODO
// LIVRE — zona única, sem limite — então os 12 jogos funcionam desde já.
//
// Por que a validação só AVISA (nunca bloqueia salvar), ver docs/DECKS.md §5:
// regras mudam (bans/formatos), catálogo pode vir incompleto e brew pela metade
// é o estado normal de quem está montando.
//
// FORMATOS: um jogo pode ter vários (Magic: Standard × Commander), cada um com
// zonas e limites próprios. O formato herda os campos do pacote base e
// sobrescreve o que precisar. deck.format guarda o slug.
//
// Campos:
//   zones      [{ key, min, max, filter(card), manual, copyLimit }] — `filter` diz se a
//              carta PODE entrar; `manual: true` tira a zona do roteamento
//              automático (Sideboard/Side/Commander são escolha do usuário, não
//              destino padrão — senão TODO lendário viraria comandante).
//   copyLimit  máximo de cópias da "mesma carta" (1 = singleton). A zona pode
//              ter o seu, menor (Riftbound: 3 campos de batalha DIFERENTES;
//              Grand Archive: deck de material singleton).
//   copyKey    o que é "a mesma carta" (One Piece limita por NÚMERO, não nome).
//   exempt     isentas do limite (energia básica / terreno básico).
//   identity   limite de cores próprias do deck (Lorcana: máx. 2 inks).
//              `code` troca o texto do aviso (Union Arena: "séries", não cores);
//              `ignore` lista valores que não contam (Vanguard: "Other").
//   identityFrom  cores herdadas de uma zona (One Piece: Líder; Commander).
//              `code` idem (Riftbound: "domínios da Legend").
//   limits     [{ key, filter(card), min, max }] — quantas cartas de um GRUPO
//              o deck pode ter (Vanguard: 16 gatilhos, no máx. 4 de cura). O
//              rótulo do grupo é `decks.limit.<key>` no i18n.
//   facets     campos que viram filtro na busca do editor.
//   curve      campo numérico do histograma de custo.
//   dist       campo categórico da distribuição (cor/tinta).
(function () {
  "use strict";

  // Multi-valor no catálogo NÃO tem separador único: One Piece/Magic usam ";"
  // ("Green;Red"), Lorcana usa "/" na tinta dupla ("Amber/Steel"). Quebrar só em
  // ";" faria "Amber/Steel" contar como UMA tinta e o limite de 2 nunca pegaria.
  function multi(value) {
    return String(value == null ? "" : value).split(/[;/]/).map((s) => s.trim()).filter(Boolean);
  }

  // Extra Deck do Yu-Gi-Oh! sai do cardType: Fusion/Synchro/Xyz/Link. Ritual e
  // Pendulum ficam no main (conferido nos 110 tipos do catálogo) — e
  // "Xyz/Pendulum/Effect Monster" cai no Extra, como manda a regra.
  const YGO_EXTRA = /Fusion|Synchro|Xyz|Link/i;
  // Terreno básico do Magic: type_line começa com "Basic Land".
  const isBasicLand = (c) => /^Basic Land/i.test(c.cardType || "");
  // Energia BÁSICA do Pokémon: category "Energy" + energyType "Normal".
  // Confirmado na TCGdex: a básica vem como Normal (NÃO existe "Basic");
  // "Special" é a energia especial, que obedece o limite de 4.
  const isBasicEnergy = (c) => c.category === "Energy" && c.energyType === "Normal";

  // "A mesma carta" pelo NOME, sem o que o TCGplayer (TCGCSV) pendura na
  // impressão: "Darth Vader - Dark Lord of the Sith (Hyperspace)", "Cloud
  // (Full Art)", "Snatch (Red) - FAB331", "Rose Queen (SL)". Sem isso a versão
  // Hyperspace contaria como outra carta e o limite de cópias nunca pegaria
  // quem mistura arte normal e alternativa — o caso mais comum de deck real.
  // Só tira parêntese do FIM e o " - <número>" quando é o número da própria
  // carta: o " - " do meio é parte do nome no SWU ("Título - Subtítulo").
  function nomeBase(card) {
    const nome = String((card && card.name) || "").trim();
    const num = card && card.number ? String(card.number).trim() : "";
    let s = nome;
    for (;;) {
      let t = s;
      if (num && t.endsWith(" - " + num)) t = t.slice(0, -(num.length + 3)).trim();
      t = t.replace(/\s*\([^()]*\)\s*$/, "").trim();
      if (t === s) break;
      s = t;
    }
    return s || nome;
  }

  // Zonas dos formatos CONSTRUÍDOS do Magic (Standard/Pioneer/Modern/Legacy/
  // Vintage/Pauper): 60+ no deck, sideboard de 15, e o MAYBEBOARD — rascunho de
  // "penso em jogar" que não conta pra tamanho nem pra limite de cópias
  // (scratch), como no Moxfield. Função, e não constante compartilhada, porque
  // cada formato tem de receber o SEU array (objeto compartilhado entre packs
  // viraria estado cruzado no dia em que alguma regra mudar um campo).
  const BUILT_ZONES = () => [
    { key: "main", min: 60, max: null },
    { key: "side", min: 0, max: 15, manual: true },
    { key: "maybe", min: 0, max: null, manual: true, scratch: true }
  ];

  // ── Lote 1 de 2026-11-14 (item 3 do ROADMAP) ─────────────────────────────
  // Regras conferidas nas fontes oficiais do jogo em 14/11/2026; a URL e a
  // versão de cada uma estão no comentário do pacote e em docs/DECKS.md. Toda
  // zona chama `main` o deck principal: é a zona do modo livre, então o deck
  // montado antes do pacote existir abre com as cartas no lugar.
  const tipo = (c) => String((c && c.cardType) || "");
  // "A mesma carta" pelo NÚMERO impresso (Gundam, Union Arena, FFTCG): a arte
  // alternativa repete o número. O que vem antes da "/" é o produto ou a promo
  // ("UE10BT/AOT-1-026", "PR-043/8-015H") e fica de fora, pra reimpressão
  // contar junto. Sem número, cai no nome-base.
  const porNumero = (card) => {
    const n = String((card && card.number) || "").trim();
    return n ? n.split("/").pop() : nomeBase(card);
  };
  // Gatilho pelo campo `trigger` do catálogo, sem caixa ("Final" e "FINAL").
  const gatilho = (nome) => (c) => String(c.trigger || "").toLowerCase() === nome;

  // Flesh and Blood: herói, arena (equipamento e arma) e o resto do deck.
  const fabHeroi = (c) => /\bHero\b/.test(tipo(c)) && !/Token/.test(tipo(c));
  const fabArena = (c) => /Equipment|Weapon/.test(tipo(c)) && !/Hero|Token/.test(tipo(c));
  const fabDeck = (c) => !/Hero|Equipment|Weapon|Token|Macro/.test(tipo(c));
  // `deck`/`deckMax`: 60+ no Classic Constructed, exatamente 40 no Blitz.
  const FAB_ZONES = (deck, deckMax) => [
    { key: "hero", min: 1, max: 1, filter: fabHeroi },
    { key: "main", min: deck, max: deckMax, filter: fabDeck },
    { key: "equipment", min: 0, max: null, filter: fabArena }
  ];
  // O card-pool (deck + arena; o herói fica fora) tem teto próprio.
  const fabPool = (max) => ({ key: "pool", filter: (c) => !fabHeroi(c), max: max });

  // Riftbound: o que vai no deck de 40 (unidade, campeão, feitiço, equipamento
  // e as Signature), sem ficha.
  const riftDeck = (c) => /Unit|Spell|Gear/.test(tipo(c)) && !/Token/.test(tipo(c));

  // Vanguard: deck de 50 (unidades e ordens), ride deck (graus 0–3 e o crest)
  // e o deck G (G Unit, G Guardian). Marcador, ficha, Energy e afins não
  // entram em deck nenhum.
  const vgDeck = (c) => /^(Normal Unit|Trigger Unit|Normal Order|Blitz Order|Set Order|Trigger Order)$/.test(tipo(c));
  const vgRide = (c) => tipo(c) === "Crest" || (/^(Normal Unit|Trigger Unit)$/.test(tipo(c)) && Number(c.grade) <= 3);
  const vgG = (c) => /^G (Unit|Guardian)$/.test(tipo(c));
  const VG_ZONES = (rideMin) => [
    { key: "main", min: 50, max: 50, filter: vgDeck },
    // manual: a unidade de grau 0–3 vai pro deck por padrão; o ride deck é
    // escolha (o botão aparece no resultado da busca).
    { key: "ride", min: rideMin, max: 5, manual: true, filter: vgRide },
    { key: "gdeck", min: 0, max: 16, filter: vgG }
  ];
  // CR 8.1.5–8.1.8: 16 gatilhos entre deck e ride deck, até 4 de cura e 1 Over.
  const VG_LIMITS = () => [
    { key: "trigger", filter: (c) => !!c.trigger, min: 16, max: 16 },
    { key: "heal", filter: gatilho("heal"), max: 4 },
    { key: "over", filter: gatilho("over"), max: 1 }
  ];

  // FFTCG: as Limit Break saem com " LB" no nome ("Cloud LB").
  const ffLB = (c) => /\sLB$/.test(nomeBase(c));

  // Grand Archive: campeão e regalia vão pro deck de material; ficha, Boon e
  // Mastery não entram em deck nenhum.
  const gaFicha = (c) => /Token|Boon|Mastery/.test(tipo(c));
  const gaMaterial = (c) => /Champion|Regalia/.test(tipo(c)) && !gaFicha(c);

  const RULES = {
    lorcana: {
      // Mao inicial do goldfish (src/goldfish.js). Lorcana: 7 cartas, e o mulligan e "coloque quantas quiser no fundo
      // e compre o mesmo tanto" — aqui o botao re-embaralha e compra 7 de novo,
      // que e o que interessa pra sentir a consistencia do deck.
      hand: 7,
      zones: [{ key: "main", min: 60, max: null }],
      copyLimit: 4,
      copyKey: (card) => card.name,
      // O nome do Lorcana já inclui a versão ("Ariel - On Human Legs"), então
      // dois cards diferentes nunca colidem na chave.
      identity: { field: "ink", max: 2 },
      facets: ["ink", "cost", "cardType"],
      curve: "cost", dist: "ink"
    },

    onepiece: {
      // Mao inicial do goldfish (src/goldfish.js). One Piece: 5 cartas (o Leader nao conta — ele comeca em jogo).
      hand: 5,
      zones: [
        { key: "leader", min: 1, max: 1, filter: (c) => c.cardType === "Leader" },
        { key: "main", min: 50, max: 50, filter: (c) => c.cardType !== "Leader" }
      ],
      copyLimit: 4,
      // Regra oficial: 4 cópias do mesmo NÚMERO (arte alternativa conta junto).
      copyKey: (card) => card.number || card.name,
      identityFrom: { zone: "leader", field: "opColor" },
      facets: ["opColor", "cost", "cardType"],
      curve: "cost", dist: "opColor"
    },

    digimon: {
      // Mao inicial do goldfish (src/goldfish.js). Digimon: 5 cartas (o Digi-Egg fica na pilha de ovos, fora da mao).
      hand: 5,
      zones: [
        { key: "egg", min: 0, max: 5, filter: (c) => c.cardType === "Digi-Egg" },
        { key: "main", min: 50, max: 50, filter: (c) => c.cardType !== "Digi-Egg" }
      ],
      copyLimit: 4,
      copyKey: (card) => card.number || card.name,
      facets: ["color", "cost", "cardType", "level"],
      curve: "cost", dist: "color"
    },

    dbfw: {
      // Mao inicial do goldfish (src/goldfish.js). Dragon Ball Fusion World: 6 cartas (o Leader comeca em jogo).
      hand: 6,
      zones: [
        { key: "leader", min: 1, max: 1, filter: (c) => /Leader/i.test(c.cardType || "") },
        { key: "main", min: 50, max: 50, filter: (c) => !/Leader/i.test(c.cardType || "") }
      ],
      copyLimit: 4,
      copyKey: (card) => card.number || card.name,
      facets: ["color", "cost", "cardType"],
      curve: "cost", dist: "color"
    },

    gundam: {
      // Comprehensive Rules Ver. 1.10.0 (16/10/2026), 6-1 — gundam-gcg.com.
      // Deck de 50 (Unit, Pilot, Command, Base) e deck de recursos de 10, à
      // parte. EX Base e EX Resource são fichas: não entram em deck nenhum.
      hand: 5,
      zones: [
        { key: "main", min: 50, max: 50, filter: (c) => /^(Unit|Pilot|Command|Base)$/.test(tipo(c)) },
        { key: "resource", min: 10, max: 10, filter: (c) => tipo(c) === "Resource" },
        // Melhor de 3: side de 10, que divide com o deck o limite de 4 e o de 2 cores.
        { key: "side", min: 0, max: 10, manual: true, filter: (c) => /^(Unit|Pilot|Command|Base)$/.test(tipo(c)) }
      ],
      copyLimit: 4,
      copyKey: porNumero,                       // 2-1-1: mesmo número = mesma carta
      exempt: (c) => tipo(c) === "Resource",   // 6-1-1-5: recurso não tem limite
      identity: { field: "color", max: 2 },    // 6-1-1-2: 1 ou 2 cores
      facets: ["color", "cost", "cardType", "level"],
      curve: "cost", dist: "color"
    },

    swu: {
      // Comprehensive Rules v8.0 (08/07/2026), 9.2 e 12.2 — starwarsunlimited.com.
      // Mão de 6. A cor de aspecto fora da do líder/base só encarece a carta
      // (1.5.6b): não é ilegal, então não tem identidade aqui.
      hand: 6,
      formats: [
        {
          slug: "premier",
          zones: [
            { key: "leader", min: 1, max: 1, filter: (c) => tipo(c) === "Leader" },
            { key: "base", min: 1, max: 1, filter: (c) => tipo(c) === "Base" },
            { key: "main", min: 50, max: null, filter: (c) => /^(Unit|Event|Upgrade)$/.test(tipo(c)) },
            { key: "side", min: 0, max: 10, manual: true }
          ],
          copyLimit: 3
        },
        {
          // Multijogador: dois líderes diferentes, 80+ e singleton (líder incluso).
          slug: "twinsuns",
          zones: [
            { key: "leader", min: 2, max: 2, filter: (c) => tipo(c) === "Leader" },
            { key: "base", min: 1, max: 1, filter: (c) => tipo(c) === "Base" },
            { key: "main", min: 80, max: null, filter: (c) => /^(Unit|Event|Upgrade)$/.test(tipo(c)) }
          ],
          copyLimit: 1
        }
      ],
      // 8.5.1: cópia é a carta com TODOS os atributos impressos iguais — na
      // prática, título e subtítulo ("Luke Skywalker - Faithful Friend"); a
      // Hyperspace e a Showcase são a mesma carta.
      copyKey: nomeBase,
      facets: ["color", "cost", "cardType", "arena"],
      curve: "cost", dist: "color"
    },

    fab: {
      // Tournament Rules & Policy, seção 7, e Comprehensive Rules (05/11/2026)
      // — rules.fabtcg.com. Mão = intelecto do herói, quase sempre 4.
      hand: 4,
      formats: [
        // Classic Constructed: herói + card-pool de até 80 (deck + arena), deck 60+.
        { slug: "cc", zones: FAB_ZONES(60, null), copyLimit: 3, limits: [fabPool(80)] },
        // Blitz: herói jovem + card-pool de até 52, deck de 40, singleton.
        { slug: "blitz", zones: FAB_ZONES(40, 40), copyLimit: 1, limits: [fabPool(52)] }
      ],
      // CR 1.3.4: a mesma carta é mesmo NOME e mesmo PITCH — "Snatch (Red)" e
      // "Snatch (Blue)" são cartas diferentes. A cor sai do nome pelo
      // nome-base e volta pelo pitch.
      copyKey: (c) => nomeBase(c) + "|" + String(c.pitch || "").trim(),
      // Classe do herói (1.1.3) e a palavra Legendary não estão no catálogo:
      // ficam sem checagem.
      facets: ["pitch", "cardType", "talent"],
      curve: null, dist: "pitch"
    },

    riftbound: {
      // Core Rules e Tournament Rules (09/10/2026) — playriftbound.com.
      hand: 4,
      zones: [
        { key: "legend", min: 1, max: 1, filter: (c) => tipo(c) === "Legend" },
        // Exatamente 40 no torneio (TR 402.1), com o campeão escolhido dentro.
        { key: "main", min: 40, max: 40, filter: riftDeck },
        { key: "rune", min: 12, max: 12, filter: (c) => /^Rune/.test(tipo(c)) },
        // Três campos de batalha, cada um com um nome.
        { key: "battlefield", min: 3, max: 3, copyLimit: 1, filter: (c) => tipo(c) === "Battlefield" },
        { key: "side", min: 0, max: 10, manual: true, filter: riftDeck }
      ],
      copyLimit: 3,                             // 103.3.b: por nome
      copyKey: nomeBase,
      exempt: (c) => /^Rune/.test(tipo(c)),    // runa não tem limite de cópia
      limits: [{ key: "signature", filter: (c) => /Signature/.test(tipo(c)), max: 3 }],   // 103.3.d
      // Domínio da Legend: carta de domínio só entra se TODOS os domínios dela
      // estão nos da Legend; "None" (campo de batalha) vai em qualquer deck.
      identityFrom: { zone: "legend", field: "domain", code: "domainMismatch", ignore: ["None"] },
      facets: ["domain", "cardType"],
      curve: null, dist: "domain"
    },

    unionarena: {
      // Rule Manual Ver1.1 (30/08/2024) e Tournament Rules Manual (19/05/2025)
      // — unionarena-tcg.com. As 3 cartas de AP ficam fora do deck.
      hand: 7,
      zones: [{ key: "main", min: 50, max: 50, filter: (c) => tipo(c) !== "Action Point" }],
      copyLimit: 4,
      copyKey: porNumero,
      limits: [
        { key: "special", filter: gatilho("special"), max: 4 },
        { key: "colorTrigger", filter: gatilho("color"), max: 4 },
        { key: "final", filter: gatilho("final"), max: 4 }
      ],
      // Todas as cartas da mesma obra (o código antes do número, "HTR").
      identity: { field: "series", max: 1, code: "seriesMax" },
      facets: ["color", "cost", "cardType", "series"],
      curve: "cost", dist: "color"
    },

    vanguard: {
      // Comprehensive Rules 4.52 (20/03/2026), Deck Construction Rules e
      // Fighter's Rules (05/11/2026) — en.cf-vanguard.com.
      hand: 5,
      formats: [
        {
          // Standard (Nation Fight): uma nação; ride deck de 5 (graus 0–3 e o
          // crest; 4 sem o crest); até 8 de crítico, de compra e de Front.
          slug: "standard",
          zones: VG_ZONES(4),
          identity: { field: "color", max: 1, code: "nationMax", ignore: ["Other"] },
          limits: VG_LIMITS().concat([
            { key: "critical", filter: gatilho("critical"), max: 8 },
            { key: "draw", filter: gatilho("draw"), max: 8 },
            { key: "front", filter: gatilho("front"), max: 8 }
          ])
        },
        {
          // Premium (Clan Fight): todas as cartas em inglês, um clã só.
          slug: "premium",
          zones: VG_ZONES(0),
          identity: { field: "clan", max: 1, code: "clanMax" },
          limits: VG_LIMITS()
        }
      ],
      copyLimit: 4,                             // por nome, deck + ride deck
      copyKey: nomeBase,
      // O grau é o "custo" do Vanguard (é o que sobe a cada ride).
      facets: ["color", "grade", "cardType", "clan"],
      curve: "grade", dist: "color"
    },

    fftcg: {
      // Comprehensive Rules ver. 3.0 (12/03/2024) e floor rules 2.1 —
      // fftcg.square-enix-games.com. Elemento não restringe o deck.
      hand: 5,
      zones: [
        { key: "main", min: 50, max: 50, filter: (c) => !ffLB(c) },
        { key: "lb", min: 0, max: 8, filter: ffLB }
      ],
      copyLimit: 3,
      copyKey: porNumero,                       // 5.2.5.1: mesmo número = mesma carta
      facets: ["color", "cost", "cardType"],
      curve: "cost", dist: "color"
    },

    grandarchive: {
      // Comprehensive Rules (rules.gatcg.com) e Standard Constructed
      // (trg.gatcg.com, 16/10/2026). A mão sai do campeão de nível 0: os
      // Spirits compram 7. Elemento não restringe o deck.
      hand: 7,
      zones: [
        { key: "main", min: 60, max: null, filter: (c) => !gaMaterial(c) && !gaFicha(c) },
        // Até 12, singleton, com pelo menos um campeão de nível 0.
        { key: "material", min: 0, max: 12, copyLimit: 1, filter: gaMaterial },
        { key: "side", min: 0, max: 15, manual: true, filter: (c) => !gaFicha(c) }
      ],
      copyLimit: 4,                             // por nome
      copyKey: nomeBase,
      // O custo do campeão é o nível dele.
      limits: [{ key: "champion0", filter: (c) => /Champion/.test(tipo(c)) && Number(c.cost) === 0, min: 1 }],
      facets: ["color", "cost", "cardType", "cardClass"],
      curve: "cost", dist: "color"
    },

    pokemon: {
      // Mao inicial do goldfish (src/goldfish.js). Pokemon: 7 cartas.
      hand: 7,
      // Deck de Pokémon é EXATAMENTE 60 cartas.
      zones: [{ key: "main", min: 60, max: 60 }],
      copyLimit: 4,
      copyKey: (card) => card.name,   // limite é por NOME
      exempt: isBasicEnergy,          // energia básica é ilimitada
      facets: ["category", "types", "stage", "trainerType"],
      curve: null, dist: "types"      // Pokémon não tem custo numérico
    },

    ygo: {
      // Mao inicial do goldfish (src/goldfish.js). Yu-Gi-Oh!: 5 cartas pra quem comeca (o Extra Deck fica de fora).
      hand: 5,
      zones: [
        { key: "main", min: 40, max: 60, filter: (c) => !YGO_EXTRA.test(c.cardType || "") },
        { key: "extra", min: 0, max: 15, filter: (c) => YGO_EXTRA.test(c.cardType || "") },
        // Side é escolha do usuário: aceita qualquer carta, mas não é destino
        // automático (senão toda carta cairia nele em vez do main).
        { key: "side", min: 0, max: 15, manual: true }
      ],
      copyLimit: 3,
      copyKey: (card) => card.name,
      facets: ["cardType", "attribute", "monsterType"],
      curve: null, dist: "attribute"
    },

    magic: {
      // Mao inicial do goldfish (src/goldfish.js). Magic: 7 cartas.
      hand: 7,
      // Os formatos de mesa mais jogados. Os cinco "construídos" (60 cartas, 4
      // cópias, sideboard de 15) só diferem na lista de sets legais — que a
      // gente NÃO valida (exigiria a legalidade por carta do Scryfall, que não
      // gravamos): o que muda aqui é o nome que a pessoa escolhe, e os limites
      // de tamanho/cópia, que valem pra todos. Pauper acrescenta a regra que dá
      // pra checar com o nosso dado: só cartas comuns.
      formats: [
        { slug: "standard", zones: BUILT_ZONES(), copyLimit: 4 },
        { slug: "pioneer", zones: BUILT_ZONES(), copyLimit: 4 },
        { slug: "modern", zones: BUILT_ZONES(), copyLimit: 4 },
        { slug: "legacy", zones: BUILT_ZONES(), copyLimit: 4 },
        { slug: "vintage", zones: BUILT_ZONES(), copyLimit: 4 },
        { slug: "pauper", zones: BUILT_ZONES(), copyLimit: 4, onlyRarity: ["common"] },
        {
          slug: "commander",
          zones: [
            // manual: quase toda carta lendária serviria de filtro — deixar
            // automático mandaria todo lendário pro comando em vez do deck.
            // max 2: Partner / Friends forever / Background / Doctor's companion
            // fazem DOIS comandantes — e o cEDH vive disso (Rograkh+Thrasios).
            { key: "commander", min: 1, max: 2, manual: true, filter: (c) => /Legendary/i.test(c.cardType || "") },
            // 100 no total, comandantes inclusos: com 1 são 99 no deck, com 2 são 98.
            { key: "main", sizeWith: { zone: "commander", total: 100 } },
            { key: "side", min: 0, max: null, manual: true, scratch: true },
            { key: "maybe", min: 0, max: null, manual: true, scratch: true }
          ],
          copyLimit: 1,                                  // singleton
          identityFrom: { zone: "commander", field: "colorId" }
        },
        {
          slug: "brawl",
          zones: [
            { key: "commander", min: 1, max: 1, manual: true, filter: (c) => /Legendary/i.test(c.cardType || "") },
            { key: "main", sizeWith: { zone: "commander", total: 60 } },
            { key: "maybe", min: 0, max: null, manual: true, scratch: true }
          ],
          copyLimit: 1,
          identityFrom: { zone: "commander", field: "colorId" }
        }
      ],
      copyKey: (card) => card.name,
      exempt: isBasicLand,             // terreno básico é ilimitado em todo formato
      facets: ["cardType", "color", "cost", "rarity"],
      curve: "cost", dist: "color",
      // Campo com os símbolos de mana ("{2}{G}{U}") — liga a conta de pips.
      pips: "manaCost"
    }
  };

  // Modo livre: o que vale pros jogos sem pacote (e pros vintage, que não têm
  // formato competitivo). Sem mínimo, sem máximo, sem limite de cópias.
  // `hand: 7` no modo livre nao e regra de jogo nenhum: e o numero mais comum
  // entre os TCGs modernos, e o goldfish precisa de ALGUM ponto de partida
  // pros jogos sem pacote (e pros vintage). O botao de comprar cobre o resto.
  const FREE = { zones: [{ key: "main", min: 0, max: null }], free: true, hand: 7, facets: [], curve: null, dist: null };

  // Resolve o pacote do jogo + formato. O formato herda a base e sobrescreve.
  function packFor(game, formatSlug) {
    const base = RULES[game];
    if (!base) return FREE;
    if (!base.formats) return base;
    const fmt = base.formats.find((f) => f.slug === formatSlug) || base.formats[0];
    return Object.assign({}, base, fmt, { formats: base.formats, format: fmt.slug });
  }
  // Formatos disponíveis (vazio = jogo de formato único).
  function formatsOf(game) {
    const base = RULES[game];
    return (base && base.formats) ? base.formats.map((f) => f.slug) : [];
  }

  // TODAS as zonas que aceitam esta carta (pro editor oferecer escolha quando
  // houver mais de uma: main × side, ou main × commander).
  function zonesForCard(pack, card) {
    return (pack.zones || []).filter((z) => !z.filter || z.filter(card)).map((z) => z.key);
  }
  // Zona PADRÃO do "+": a primeira que aceita e não é manual.
  function zoneForCard(pack, card) {
    const zone = (pack.zones || []).find((z) => !z.manual && (!z.filter || z.filter(card)));
    return zone ? zone.key : null;
  }

  function countIn(deck, zoneKey) {
    return ((deck.zones && deck.zones[zoneKey]) || []).reduce((sum, e) => sum + (e.qty || 0), 0);
  }

  // Checagem PRÉVIA do "+" — que NÃO BARRA MAIS NADA. Devolve
  // { ok: true, warn?: { code, vals } }: o editor sempre adiciona e, quando vem
  // `warn`, mostra o aviso.
  //
  // Por que deixou de barrar (pedido do Fernando, 2026-08-03): a regra escrita
  // no pacote é a do caso GERAL, e o Magic vive de cartas que a rompem —
  // Partner faz DOIS comandantes, e Relentless Rats / Nazgûl / Shadowborn
  // Apostle pedem CÓPIAS num formato singleton. Cada exceção dessas viraria uma
  // lista pra manter (e um bug pra quem monta o deck certo). Melhor deixar
  // montar e sinalizar: o `validate` já descreve o deck pronto, e o aviso do
  // clique diz na hora o que está fora do comum.
  // O vocabulário de código é o MESMO do validate, pra reaproveitar as
  // traduções `decks.issue.<code>`.
  // Zona `scratch` (maybeboard) não avisa nada: é rascunho.
  function canAdd(deck, zoneKey, card, cardById) {
    const pack = packFor(deck.game, deck.format);
    if (pack.free) return { ok: true };

    const zone = (pack.zones || []).find((z) => z.key === zoneKey);
    if (zone && zone.scratch) return { ok: true };
    if (zone && zone.max && countIn(deck, zoneKey) >= zone.max) {
      return { ok: true, warn: { code: "zoneMax", vals: { zone: zoneKey, n: countIn(deck, zoneKey) + 1, max: zone.max } } };
    }

    // Grupo cheio (o 5º gatilho de cura do Vanguard, a 4ª Signature do
    // Riftbound): avisa no clique, como a zona cheia.
    if (card) {
      const lookup = (id) => (id === card.id ? card : cardById && cardById[id]);
      for (const l of (pack.limits || [])) {
        if (l.max == null || !l.filter(card)) continue;
        const n = countGroup(deck, pack, l, lookup);
        if (n >= l.max) return { ok: true, warn: { code: "limitMax", vals: { what: l.key, n: n + 1, max: l.max } } };
      }
    }

    if (pack.copyLimit && card && !(pack.exempt && pack.exempt(card))) {
      const key = pack.copyKey ? pack.copyKey(card) : card.name;
      let qty = 0;
      (pack.zones || []).filter((z) => !z.scratch).forEach((z) => {
        ((deck.zones && deck.zones[z.key]) || []).forEach((e) => {
          const c = e.id === card.id ? card : (cardById && cardById[e.id]);
          if (!c) return;                                  // fora do catálogo carregado
          if (pack.exempt && pack.exempt(c)) return;
          if ((pack.copyKey ? pack.copyKey(c) : c.name) === key) qty += (e.qty || 0);
        });
      });
      const daZona = !!(zone && zone.copyLimit && zone.copyLimit < pack.copyLimit);
      const max = daZona ? zone.copyLimit : pack.copyLimit;
      if (qty >= max) {
        return {
          ok: true,
          warn: {
            code: daZona ? "zoneSingleton" : max === 1 ? "singleton" : "copyLimit",
            vals: { name: card.name, qty: qty + 1, max: max, zone: daZona ? zone.key : undefined }
          }
        };
      }
    }
    return { ok: true };
  }

  // Valida o deck. Devolve [{ level, code, vals, cardId }] — decks.js traduz por
  // `decks.issue.<code>`. NUNCA lança: catálogo incompleto vira deck sem aviso,
  // não página quebrada.
  function validate(deck, cardById) {
    const pack = packFor(deck.game, deck.format);
    const issues = [];
    if (pack.free) return issues;

    const entries = (zoneKey) => ((deck.zones && deck.zones[zoneKey]) || []);
    const cardOf = (entry) => cardById && cardById[entry.id];

    // 1) Tamanho de cada zona. `sizeWith` = tamanho que depende de OUTRA zona:
    // no Commander o deck é 100 no total, então 1 comandante pede 99 e dois
    // comandantes (Partner) pedem 98 — número fixo acusaria erro em deck legal.
    (pack.zones || []).forEach((z) => {
      const n = countIn(deck, z.key);
      let min = z.min, max = z.max;
      if (z.sizeWith) {
        const alvo = Math.max(0, z.sizeWith.total - countIn(deck, z.sizeWith.zone));
        min = alvo; max = alvo;
      }
      if (min && n < min) issues.push({ level: "error", code: "zoneMin", vals: { zone: z.key, n: n, min: min } });
      if (max && n > max) issues.push({ level: "error", code: "zoneMax", vals: { zone: z.key, n: n, max: max } });
    });

    // 2) Limite de cópias — soma as zonas que CONTAM (maybeboard fica fora: é
    // rascunho, e ter lá a 5ª cópia de um Bolt não é ilegalidade nenhuma).
    if (pack.copyLimit) {
      const byKey = new Map();
      (pack.zones || []).filter((z) => !z.scratch).forEach((z) => entries(z.key).forEach((e) => {
        const card = cardOf(e);
        if (!card) return;                       // carta fora do catálogo carregado
        if (pack.exempt && pack.exempt(card)) return;
        const key = pack.copyKey ? pack.copyKey(card) : card.name;
        const prev = byKey.get(key);
        // O teto é o MENOR entre o do jogo e o das zonas onde a carta está; a
        // zona que baixou o teto vai junto, pro aviso dizer onde vale o 1 de
        // cada ("Campos de batalha"), e não que o formato é singleton.
        const daZona = z.copyLimit && z.copyLimit < (prev ? prev.max : pack.copyLimit);
        const max = daZona ? z.copyLimit : (prev ? prev.max : pack.copyLimit);
        byKey.set(key, { qty: (prev ? prev.qty : 0) + (e.qty || 0), name: card.name, id: card.id, max: max, zona: daZona ? z.key : (prev && prev.zona) });
      }));
      byKey.forEach((v) => {
        if (v.qty > v.max) {
          const code = v.zona ? "zoneSingleton" : v.max === 1 ? "singleton" : "copyLimit";
          issues.push({ level: "error", code: code, cardId: v.id, vals: { name: v.name, qty: v.qty, max: v.max, zone: v.zona } });
        }
      });
    }

    // 2b) Pauper: só cartas comuns. É a única restrição de "lista legal" que o
    // nosso dado permite conferir — `rarity` vem em 100% das cartas do Magic.
    if (pack.onlyRarity) {
      const permitido = new Set(pack.onlyRarity);
      const fora = new Map();
      (pack.zones || []).filter((z) => !z.scratch).forEach((z) => entries(z.key).forEach((e) => {
        const card = cardOf(e);
        if (!card || !card.rarity) return;      // sem raridade no catálogo: não acusa
        if (!permitido.has(String(card.rarity))) fora.set(card.id, card.name);
      }));
      fora.forEach((name, id) => issues.push({ level: "error", code: "rarityNotAllowed", cardId: id, vals: { name: name } }));
    }

    // 3) Identidade PRÓPRIA do deck (Lorcana: no máximo 2 tintas).
    if (pack.identity) {
      const set = new Set();
      (pack.zones || []).forEach((z) => entries(z.key).forEach((e) => {
        const card = cardOf(e);
        const ignora = pack.identity.ignore || [];
        if (card) multi(card[pack.identity.field]).forEach((v) => { if (!ignora.includes(v)) set.add(v); });
      }));
      if (set.size > pack.identity.max) {
        issues.push({ level: "error", code: pack.identity.code || "identityMax", vals: { n: set.size, max: pack.identity.max, list: [...set].join(", ") } });
      }
    }

    // 4) Identidade HERDADA de uma zona (One Piece: cores ⊆ Líder; Commander:
    //    color identity ⊆ comandante).
    if (pack.identityFrom) {
      const src = entries(pack.identityFrom.zone).map(cardOf).filter(Boolean);
      if (src.length) {
        const ignora = pack.identityFrom.ignore || [];
        const valores = (c) => multi(c[pack.identityFrom.field]).filter((v) => !ignora.includes(v));
        const allowed = new Set();
        src.forEach((c) => valores(c).forEach((v) => allowed.add(v)));
        const bad = new Map();
        (pack.zones || []).forEach((z) => {
          if (z.key === pack.identityFrom.zone) return;
          entries(z.key).forEach((e) => {
            const card = cardOf(e);
            if (!card) return;
            const cols = valores(card);
            // Carta sem cor no catálogo não vira erro (dado incompleto ≠ deck
            // ilegal) — e incolor/terreno básico é legal em qualquer Commander.
            if (cols.length && !cols.every((c) => allowed.has(c))) bad.set(card.id, card.name);
          });
        });
        bad.forEach((name, id) => issues.push({ level: "error", code: pack.identityFrom.code || "identityMismatch", cardId: id, vals: { name: name, list: [...allowed].join(", ") } }));
      }
    }

    // 5) Limites por GRUPO de carta (Vanguard: 16 gatilhos, no máximo 4 de
    //    cura; Riftbound: no máximo 3 Signature). Soma as zonas que contam — o
    //    maybeboard fica fora, como no limite de cópias.
    (pack.limits || []).forEach((lim) => {
      const n = countGroup(deck, pack, lim, (id) => cardById && cardById[id]);
      if (lim.min != null && n < lim.min) issues.push({ level: "error", code: "limitMin", vals: { what: lim.key, n: n, min: lim.min } });
      if (lim.max != null && n > lim.max) issues.push({ level: "error", code: "limitMax", vals: { what: lim.key, n: n, max: lim.max } });
    });

    return issues;
  }

  // `lookup(id)` em vez do mapa: o canAdd precisa enxergar a carta que está
  // entrando sem copiar o catálogo inteiro (26 mil cartas no Vanguard) a cada
  // clique.
  function countGroup(deck, pack, lim, lookup) {
    let n = 0;
    (pack.zones || []).filter((z) => !z.scratch).forEach((z) => {
      ((deck.zones && deck.zones[z.key]) || []).forEach((e) => {
        const card = lookup(e.id);
        if (card && lim.filter(card)) n += e.qty || 0;   // fora do catálogo: não conta
      });
    });
    return n;
  }

  // ---------------------------------------------------------------------------
  // Análise: curva de custo, distribuição por cor e mix de raridade.
  // Devolve null nos eixos que o jogo não tem dado (Pokémon não tem custo).
  // ---------------------------------------------------------------------------
  function analyze(deck, cardById) {
    const pack = packFor(deck.game, deck.format);
    const rows = [];
    Object.keys(deck.zones || {}).forEach((k) => (deck.zones[k] || []).forEach((e) => {
      const card = cardById && cardById[e.id];
      if (card) rows.push({ card: card, qty: e.qty || 0 });
    }));

    function tally(fn) {
      const map = new Map();
      rows.forEach(({ card, qty }) => fn(card).forEach((key) => map.set(key, (map.get(key) || 0) + qty)));
      return [...map.entries()].map(([label, n]) => ({ label, n }));
    }

    // Curva: agrupa por custo, com "7+" no topo (padrão dos deck builders). Cada
    // coluna vem QUEBRADA POR COR (`parts`), pra virar barra empilhada — é assim
    // que Dreamborn/Archidekt mostram, e é o que dá leitura de verdade: 4 cartas
    // de custo 2 numa cor só ≠ 4 espalhadas em quatro cores.
    let curve = null;
    if (pack.curve) {
      const buckets = new Map();   // custo -> Map(cor -> n)
      rows.forEach(({ card, qty }) => {
        const raw = card[pack.curve];
        if (raw == null || raw === "") return;
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        const key = v >= 7 ? "7+" : String(v);
        // Carta multicor conta UMA vez, num balde "multi" — somar em cada cor
        // inflaria o total da coluna e a curva mentiria.
        const cols = pack.dist ? multi(card[pack.dist]) : [];
        const colorKey = cols.length > 1 ? "multi" : (cols[0] || "none");
        if (!buckets.has(key)) buckets.set(key, new Map());
        const inner = buckets.get(key);
        inner.set(colorKey, (inner.get(colorKey) || 0) + qty);
      });
      if (buckets.size) {
        // Mostra a faixa CONTÍNUA de 0/1 até o maior custo — buraco no meio
        // (custo 3 vazio) é informação, não motivo pra sumir com a coluna.
        const order = ["0", "1", "2", "3", "4", "5", "6", "7+"];
        const present = order.filter((k) => buckets.has(k));
        const from = order.indexOf(present[0]);
        const to = order.indexOf(present[present.length - 1]);
        curve = order.slice(from, to + 1).map((k) => {
          const inner = buckets.get(k) || new Map();
          const parts = [...inner.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
          return { label: k, n: parts.reduce((s, p) => s + p.n, 0), parts };
        });
      }
    }

    // Valor que a identidade ignora ("None" do campo de batalha do Riftbound,
    // "Other" do Vanguard) também não vira barra: não é cor nem domínio.
    const ignoraDist = ((pack.identityFrom || pack.identity || {}).ignore) || [];
    const dist = pack.dist ? tally((c) => multi(c[pack.dist]).filter((v) => !ignoraDist.includes(v))).sort((a, b) => b.n - a.n) : null;
    const rarity = tally((c) => (c.rarity ? [String(c.rarity)] : [])).sort((a, b) => b.n - a.n);

    // Custo médio (padrão dos deck builders — Piltover Archive mostra "Avg.
    // cost: 1.8"): média ponderada pela quantidade, só das cartas com custo
    // numérico. null quando o jogo não tem curva (vintage etc.).
    let avgCost = null;
    if (pack.curve) {
      let soma = 0, n = 0;
      rows.forEach(({ card, qty }) => {
        const v = Number(card[pack.curve]);
        if (Number.isFinite(v)) { soma += v * qty; n += qty; }
      });
      if (n) avgCost = Math.round((soma / n) * 10) / 10;
    }

    // ── Símbolos de mana (Magic) ────────────────────────────────────────────
    // Não é a mesma coisa que a distribuição por cor, e é por isso que os deck
    // builders mostram as duas: um deck pode ter 20 cartas verdes e mesmo assim
    // apertar no azul, porque o que trava a mão é o SÍMBOLO, não a carta.
    //
    // Conta cada pip COLORIDO do custo × quantidade. Genérico ({3}, {X}) fica
    // de fora de propósito: qualquer terreno paga, então não diz nada sobre
    // cor. Híbrido conta pros DOIS lados ({G/U} pode ser pago por qualquer um);
    // monocolor híbrido ({2/W}) e phyrexiano ({U/P}) contam só pra letra, que é
    // a única cor envolvida.
    //
    // `lands`/`landPct` são o outro lado da conta: quantos terrenos do deck
    // produzem aquela cor (colorId do terreno, que no Scryfall é justamente o
    // que ele adiciona). Junto, a leitura vira "o que o deck PEDE × o que ele
    // TEM pra pagar" — que é a pergunta real de quem monta a base de mana.
    let pips = null;
    if (pack.pips) {
      const pede = new Map(), produz = new Map();
      let totalPips = 0, totalLands = 0;
      rows.forEach(({ card, qty }) => {
        if (/\bland\b/i.test(String(card.cardType || ""))) {
          totalLands += qty;
          multi(card.colorId).forEach((c) => {
            const k = c.toUpperCase();
            if (/^[WUBRGC]$/.test(k)) produz.set(k, (produz.get(k) || 0) + qty);
          });
        }
        String(card[pack.pips] || "").replace(/\{([^}]+)\}/g, (_, token) => {
          token.split("/").forEach((parte) => {
            const k = parte.trim().toUpperCase();
            if (!/^[WUBRGC]$/.test(k)) return;
            pede.set(k, (pede.get(k) || 0) + qty);
            totalPips += qty;
          });
          return "";
        });
      });
      const ORDEM = ["W", "U", "B", "R", "G", "C"];
      const linhas = ORDEM
        .filter((c) => (pede.get(c) || 0) > 0 || (produz.get(c) || 0) > 0)
        .map((c) => ({
          key: c,
          n: pede.get(c) || 0,
          pct: totalPips ? Math.round(((pede.get(c) || 0) / totalPips) * 100) : 0,
          lands: produz.get(c) || 0,
          landPct: totalLands ? Math.round(((produz.get(c) || 0) / totalLands) * 100) : 0
        }));
      if (linhas.length) pips = { rows: linhas, total: totalPips, lands: totalLands };
    }

    return {
      curve: curve,
      dist: (dist && dist.length) ? dist : null,
      rarity: rarity.length ? rarity : null,
      distField: pack.dist || null,
      avgCost: avgCost,
      pips: pips
    };
  }

  window.TCGDeckRules = { packFor, formatsOf, zoneForCard, zonesForCard, countIn, canAdd, validate, analyze, multi, nomeBase, FREE_PACK: FREE };
})();
