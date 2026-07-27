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
//   zones      [{ key, min, max, filter(card), manual }] — `filter` diz se a
//              carta PODE entrar; `manual: true` tira a zona do roteamento
//              automático (Sideboard/Side/Commander são escolha do usuário, não
//              destino padrão — senão TODO lendário viraria comandante).
//   copyLimit  máximo de cópias da "mesma carta" (1 = singleton).
//   copyKey    o que é "a mesma carta" (One Piece limita por NÚMERO, não nome).
//   exempt     isentas do limite (energia básica / terreno básico).
//   identity   limite de cores próprias do deck (Lorcana: máx. 2 inks).
//   identityFrom  cores herdadas de uma zona (One Piece: Líder; Commander).
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

  const RULES = {
    lorcana: {
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
      zones: [
        { key: "leader", min: 1, max: 1, filter: (c) => /Leader/i.test(c.cardType || "") },
        { key: "main", min: 50, max: 50, filter: (c) => !/Leader/i.test(c.cardType || "") }
      ],
      copyLimit: 4,
      copyKey: (card) => card.number || card.name,
      facets: ["color", "cost", "cardType"],
      curve: "cost", dist: "color"
    },

    pokemon: {
      // Deck de Pokémon é EXATAMENTE 60 cartas.
      zones: [{ key: "main", min: 60, max: 60 }],
      copyLimit: 4,
      copyKey: (card) => card.name,   // limite é por NOME
      exempt: isBasicEnergy,          // energia básica é ilimitada
      facets: ["category", "types", "stage", "trainerType"],
      curve: null, dist: "types"      // Pokémon não tem custo numérico
    },

    ygo: {
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
      formats: [
        {
          slug: "standard",
          zones: [
            { key: "main", min: 60, max: null },
            { key: "side", min: 0, max: 15, manual: true }
          ],
          copyLimit: 4
        },
        {
          slug: "commander",
          zones: [
            // manual: quase toda carta lendária serviria de filtro — deixar
            // automático mandaria todo lendário pro comando em vez do deck.
            { key: "commander", min: 1, max: 1, manual: true, filter: (c) => /Legendary/i.test(c.cardType || "") },
            { key: "main", min: 99, max: 99 }
          ],
          copyLimit: 1,                                  // singleton
          identityFrom: { zone: "commander", field: "colorId" }
        }
      ],
      copyKey: (card) => card.name,
      exempt: isBasicLand,             // terreno básico é ilimitado nos dois formatos
      facets: ["cardType", "color", "cost", "rarity"],
      curve: "cost", dist: "color"
    }
  };

  // Modo livre: o que vale pros jogos sem pacote (e pros vintage, que não têm
  // formato competitivo). Sem mínimo, sem máximo, sem limite de cópias.
  const FREE = { zones: [{ key: "main", min: 0, max: null }], free: true, facets: [], curve: null, dist: null };

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

  // Pode somar mais UMA cópia desta carta nesta zona? É a checagem PRÉVIA que o
  // editor usa pra barrar o clique — o `validate` continua avaliando o deck
  // pronto (deck importado/antigo pode estar fora da regra, e aí o aviso é dele).
  // Devolve { ok, code, vals } com o mesmo vocabulário de código do validate,
  // pra reaproveitar as traduções `decks.issue.<code>`.
  //
  // Barra os dois limites que são "cheios de verdade":
  //   zoneMax   — a zona atingiu o máximo (é o "59/60" do cabeçalho);
  //   copyLimit — já tem o máximo de cópias da mesma carta (4, ou 1 no
  //               singleton do Commander). Conta em TODAS as zonas, porque o
  //               limite é do deck inteiro, e respeita as isenções (energia
  //               básica, terreno básico) e o copyKey de cada jogo.
  // Regras de identidade (tinta/cor) NÃO barram: elas dependem do conjunto e o
  // usuário pode estar trocando o líder/comandante no meio da montagem.
  function canAdd(deck, zoneKey, card, cardById) {
    const pack = packFor(deck.game, deck.format);
    if (pack.free) return { ok: true };

    const zone = (pack.zones || []).find((z) => z.key === zoneKey);
    if (zone && zone.max && countIn(deck, zoneKey) >= zone.max) {
      return { ok: false, code: "zoneMax", vals: { zone: zoneKey, n: countIn(deck, zoneKey), max: zone.max } };
    }

    if (pack.copyLimit && card && !(pack.exempt && pack.exempt(card))) {
      const key = pack.copyKey ? pack.copyKey(card) : card.name;
      let qty = 0;
      (pack.zones || []).forEach((z) => {
        ((deck.zones && deck.zones[z.key]) || []).forEach((e) => {
          const c = e.id === card.id ? card : (cardById && cardById[e.id]);
          if (!c) return;                                  // fora do catálogo carregado
          if (pack.exempt && pack.exempt(c)) return;
          if ((pack.copyKey ? pack.copyKey(c) : c.name) === key) qty += (e.qty || 0);
        });
      });
      if (qty >= pack.copyLimit) {
        return {
          ok: false,
          code: pack.copyLimit === 1 ? "singleton" : "copyLimit",
          vals: { name: card.name, qty: qty, max: pack.copyLimit }
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

    // 1) Tamanho de cada zona.
    (pack.zones || []).forEach((z) => {
      const n = countIn(deck, z.key);
      if (z.min && n < z.min) issues.push({ level: "error", code: "zoneMin", vals: { zone: z.key, n: n, min: z.min } });
      if (z.max && n > z.max) issues.push({ level: "error", code: "zoneMax", vals: { zone: z.key, n: n, max: z.max } });
    });

    // 2) Limite de cópias — soma TODAS as zonas (o limite é do deck inteiro).
    if (pack.copyLimit) {
      const byKey = new Map();
      (pack.zones || []).forEach((z) => entries(z.key).forEach((e) => {
        const card = cardOf(e);
        if (!card) return;                       // carta fora do catálogo carregado
        if (pack.exempt && pack.exempt(card)) return;
        const key = pack.copyKey ? pack.copyKey(card) : card.name;
        const prev = byKey.get(key);
        byKey.set(key, { qty: (prev ? prev.qty : 0) + (e.qty || 0), name: card.name, id: card.id });
      }));
      byKey.forEach((v) => {
        if (v.qty > pack.copyLimit) {
          const code = pack.copyLimit === 1 ? "singleton" : "copyLimit";
          issues.push({ level: "error", code: code, cardId: v.id, vals: { name: v.name, qty: v.qty, max: pack.copyLimit } });
        }
      });
    }

    // 3) Identidade PRÓPRIA do deck (Lorcana: no máximo 2 tintas).
    if (pack.identity) {
      const set = new Set();
      (pack.zones || []).forEach((z) => entries(z.key).forEach((e) => {
        const card = cardOf(e);
        if (card) multi(card[pack.identity.field]).forEach((v) => set.add(v));
      }));
      if (set.size > pack.identity.max) {
        issues.push({ level: "error", code: "identityMax", vals: { n: set.size, max: pack.identity.max, list: [...set].join(", ") } });
      }
    }

    // 4) Identidade HERDADA de uma zona (One Piece: cores ⊆ Líder; Commander:
    //    color identity ⊆ comandante).
    if (pack.identityFrom) {
      const src = entries(pack.identityFrom.zone).map(cardOf).filter(Boolean);
      if (src.length) {
        const allowed = new Set();
        src.forEach((c) => multi(c[pack.identityFrom.field]).forEach((v) => allowed.add(v)));
        const bad = new Map();
        (pack.zones || []).forEach((z) => {
          if (z.key === pack.identityFrom.zone) return;
          entries(z.key).forEach((e) => {
            const card = cardOf(e);
            if (!card) return;
            const cols = multi(card[pack.identityFrom.field]);
            // Carta sem cor no catálogo não vira erro (dado incompleto ≠ deck
            // ilegal) — e incolor/terreno básico é legal em qualquer Commander.
            if (cols.length && !cols.every((c) => allowed.has(c))) bad.set(card.id, card.name);
          });
        });
        bad.forEach((name, id) => issues.push({ level: "error", code: "identityMismatch", cardId: id, vals: { name: name, list: [...allowed].join(", ") } }));
      }
    }

    return issues;
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

    const dist = pack.dist ? tally((c) => multi(c[pack.dist])).sort((a, b) => b.n - a.n) : null;
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

    return {
      curve: curve,
      dist: (dist && dist.length) ? dist : null,
      rarity: rarity.length ? rarity : null,
      distField: pack.dist || null,
      avgCost: avgCost
    };
  }

  window.TCGDeckRules = { packFor, formatsOf, zoneForCard, zonesForCard, countIn, canAdd, validate, analyze, multi, FREE_PACK: FREE };
})();
