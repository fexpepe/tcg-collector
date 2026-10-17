// Textos das telas de Artistas e Treinadores (artists.html / trainers.html),
// redesenhadas em 2026-10-17 — quem desenha é o src/entidades.js. Pacote
// SEPARADO do i18n.js pelo mesmo motivo do lore e das pastas: só duas páginas
// usam. Merge por IDIOMA, como os outros pacotes: a ordem de carga não importa.
(function () {
  const M = (window.TCG_MESSAGES = window.TCG_MESSAGES || {});

  M.pt = Object.assign(M.pt || {}, {
    "ent.summaryAria": "Resumo e ordem",
    "ent.sort": "Ordenar",
    "ent.sort.cartas": "Mais cartas",
    "ent.sort.az": "A–Z",
    "ent.sort.minhas": "Na minha coleção",
    "ent.lbl.artists.one": "artista",
    "ent.lbl.artists.other": "artistas",
    "ent.lbl.trainers.one": "Treinador",
    "ent.lbl.trainers.other": "Treinadores",
    "ent.lbl.cards.one": "carta",
    "ent.lbl.cards.other": "cartas",
    "ent.lbl.withYours.artists": "com cartas suas",
    "ent.lbl.withYours.trainers": "com cartas suas",
    "ent.lbl.complete.one": "completo",
    "ent.lbl.complete.other": "completos",
    "ent.owned": "{o} de {t} na coleção",
    "ent.unknown.one": "{n} carta do catálogo não tem ilustrador identificado.",
    "ent.unknown.other": "{n} cartas do catálogo não têm ilustrador identificado.",
    "ent.unknownSee": "Ver as cartas",
    "ent.top.artists": "Quem mais desenhou · Top {n}",
    "ent.top.trainers": "Os mais impressos · Top {n}",
    "ent.rest.artists": "Todos os outros",
    "ent.rest.trainers": "Todos os outros",
    "ent.topCard": "Destaque:"
  });

  M.en = Object.assign(M.en || {}, {
    "ent.summaryAria": "Summary and sort",
    "ent.sort": "Sort",
    "ent.sort.cartas": "Most cards",
    "ent.sort.az": "A–Z",
    "ent.sort.minhas": "In my collection",
    "ent.lbl.artists.one": "artist",
    "ent.lbl.artists.other": "artists",
    "ent.lbl.trainers.one": "Trainer",
    "ent.lbl.trainers.other": "Trainers",
    "ent.lbl.cards.one": "card",
    "ent.lbl.cards.other": "cards",
    "ent.lbl.withYours.artists": "with your cards",
    "ent.lbl.withYours.trainers": "with your cards",
    "ent.lbl.complete.one": "complete",
    "ent.lbl.complete.other": "complete",
    "ent.owned": "{o} of {t} owned",
    "ent.unknown.one": "{n} card in the catalog has no credited illustrator.",
    "ent.unknown.other": "{n} cards in the catalog have no credited illustrator.",
    "ent.unknownSee": "See the cards",
    "ent.top.artists": "Most cards drawn · Top {n}",
    "ent.top.trainers": "Most printed · Top {n}",
    "ent.rest.artists": "Everyone else",
    "ent.rest.trainers": "Everyone else",
    "ent.topCard": "Featured:"
  });

  M.es = Object.assign(M.es || {}, {
    "ent.summaryAria": "Resumen y orden",
    "ent.sort": "Ordenar",
    "ent.sort.cartas": "Más cartas",
    "ent.sort.az": "A–Z",
    "ent.sort.minhas": "En mi colección",
    "ent.lbl.artists.one": "artista",
    "ent.lbl.artists.other": "artistas",
    "ent.lbl.trainers.one": "Entrenador",
    "ent.lbl.trainers.other": "Entrenadores",
    "ent.lbl.cards.one": "carta",
    "ent.lbl.cards.other": "cartas",
    "ent.lbl.withYours.artists": "con cartas tuyas",
    "ent.lbl.withYours.trainers": "con cartas tuyas",
    "ent.lbl.complete.one": "completo",
    "ent.lbl.complete.other": "completos",
    "ent.owned": "{o} de {t} en tu colección",
    "ent.unknown.one": "{n} carta del catálogo no tiene ilustrador identificado.",
    "ent.unknown.other": "{n} cartas del catálogo no tienen ilustrador identificado.",
    "ent.unknownSee": "Ver las cartas",
    "ent.top.artists": "Quién más dibujó · Top {n}",
    "ent.top.trainers": "Los más impresos · Top {n}",
    "ent.rest.artists": "Todos los demás",
    "ent.rest.trainers": "Todos los demás",
    "ent.topCard": "Destacada:"
  });
})();
