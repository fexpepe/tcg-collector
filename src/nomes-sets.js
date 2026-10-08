// Nomes em INGLÊS dos sets vintage e japoneses, exibidos no lugar do nome
// original do catálogo (que segue sendo a chave de link e busca).
//
// Moravam no src/shared.js e saíram em 2026-10-08 pra abrir espaço no
// orçamento do núcleo (scripts/check-size.mjs): são ~4 KB comprimidos que
// viajavam em TODA página, e só três telas mostram nome de set traduzido —
// Sets (app.js, também em Artistas/Treinadores/Pokédex), o set (detail.js) e
// a Coleção (collection.js). As páginas delas carregam este arquivo antes do
// shared.js. Os getters (setEnName, setDisplayName, setOriginalName,
// setSerieDisplayName) continuam no shared.js e leem daqui na HORA da
// chamada: numa página sem este arquivo, ou se ele não chegar, aparece o
// nome original, como antes de haver tradução.
//
// O scripts/sync-bulbapedia-ja.mjs lê o JA_SET_EN DESTE arquivo pelo texto
// (`const JA_SET_EN = {` … `\n  };`): mantenha a indentação de dois espaços.
(function () {
  const VINTAGE_SET_EN = {
    // ---- Miracle Battle Carddass (jogo mbc, sync-miracle-battle.mjs). As
    // séries dividem o jogo desde 2026-10-01, então o nome leva a franquia: só
    // "Promotional Cards" eram três sets. Tradução nossa, no padrão do One
    // Piece (o primeiro traduzido); os ids op-mb-/nrt-mb-/hxh-mb- são os de
    // antes de virar jogo, e os mb- são as séries que entraram com ele.
    "mb-dbs01": "Dragon Ball Kai Starter Deck 1",
    "mb-dbs02": "Dragon Ball Kai Starter Deck 2 — The Dragon Generation",
    "mb-dbs04": "Dragon Ball Kai Starter Deck — Instant Limit Break",
    "mb-db01": "Dragon Ball Kai Booster Pack 1",
    "mb-db02": "Dragon Ball Kai Booster Pack 2 — A New Battle",
    "mb-db03": "Dragon Ball Kai Booster Pack 3 — Power Beyond the Limit",
    "mb-db04": "Dragon Ball Kai Booster Pack 4 — Birth of the Super Warriors!!",
    "mb-db05": "Dragon Ball Kai Super Fierce Battle — Booster 1: The Ultimate Fusion Warrior",
    "mb-db06": "Dragon Ball Kai Super Fierce Battle — Booster 2: Shining Super Warriors",
    "mb-db07": "Dragon Ball Kai Super Fierce Battle — Booster 3: Limit Break",
    "mb-db08": "Dragon Ball Kai Super Fierce Battle — Booster 4: Warrior Race",
    "mb-db09": "Dragon Ball Kai Super Fierce Battle — Booster 5: Explosive Fusion",
    "mb-db10": "Dragon Ball Kai Booster Pack — Extreme Struggle",
    "mb-db11": "Dragon Ball Kai Booster Pack — Pride of the Prince",
    "mb-db12": "Dragon Ball Kai Booster Pack — Under the Red Ribbon Flag",
    "mb-db13": "Dragon Ball Kai Booster Pack — MIRACLE OF GOD",
    "mb-db14": "Dragon Ball Kai Booster Pack — Evolution Alliance",
    "mb-db16": "Dragon Ball Kai Character Booster — Showdown!! The World Martial Arts Tournament!!",
    "mb-db17": "Dragon Ball Kai Character Booster — The Ultimate Golden Warrior",
    "mb-db": "Dragon Ball Kai Promotional Cards",
    "op-mb-ops01": "One Piece Starter Deck — Battle Begins! Luffy Pirates!!",
    "op-mb-ops02": "One Piece Starter Deck — Seaquake \"Grand Line\"!!",
    "op-mb-ops03": "One Piece Super Miracle Heroes Deck — Fierce Battle at Marineford!!",
    "op-mb-ops04": "One Piece Super Fierce Battle — Starter Deck: New World",
    "op-mb-op01": "One Piece Booster Pack 1",
    "op-mb-op02": "One Piece Booster Pack 2 — Threat of the Logia",
    "op-mb-op03": "One Piece Booster Pack 3 — Dawn of a New Era",
    "op-mb-op04": "One Piece Booster Pack 4 — Summit War",
    "op-mb-op05": "One Piece Super Fierce Battle — Booster 1: Powerhouses of the New World",
    "op-mb-op06": "One Piece Super Fierce Battle — Booster 2: Heirs of D's Will",
    "op-mb-op07": "One Piece Super Fierce Battle — Booster 3: Awakening of Haki",
    "op-mb-op08": "One Piece Super Fierce Battle — Booster 4: ROMANCE DAWN ~for the new world~",
    "op-mb-op09": "One Piece Super Fierce Battle — Booster 5: Fish-Man Island Adventure",
    "op-mb-op10": "One Piece Booster Pack — Ryugu Palace Occupied",
    "op-mb-op11": "One Piece Booster Pack — Young Pirates Worth Over 100 Million",
    "op-mb-op12": "One Piece Booster Pack — Blast!! Fire Fist Pistol",
    "op-mb-op13": "One Piece Booster Pack — The Threat of Z",
    "op-mb-op14": "One Piece Booster Pack — Raging New World",
    "op-mb-op15": "One Piece Booster Pack — Haki vs Devil Fruit Users",
    "op-mb-op16": "One Piece Booster Pack — Fighting Alliance",
    "op-mb-op17": "One Piece Character Booster — To the New Era of Heroes",
    "op-mb-op18": "One Piece Character Booster — Fierce Battle! Dressrosa",
    "op-mb-opc01": "One Piece Gigant Pack",
    "op-mb-op": "One Piece Promotional Cards",
    "mb-tr01": "Toriko Super Fierce Battle — Booster 1: Gourmet Era of Fierce Battles",
    "mb-tr02": "Toriko Super Fierce Battle — Booster 2: The Battle for the Jewel Meat",
    "mb-tr03": "Toriko Super Fierce Battle — Booster 3: The Legendary Century Soup",
    "mb-tr04": "Toriko Super Fierce Battle — Booster 4: The Sky's Ozone Herb",
    "mb-tr05": "Toriko Super Fierce Battle — Booster 5: Melk Stardust",
    "mb-tr06": "Toriko Super Fierce Battle — Booster 6: Heavenly King Zebra",
    "mb-tr": "Toriko Promotional Cards",
    "hxh-mb-hhs01": "Hunter × Hunter Preconstructed Deck — Four Challengers",
    "hxh-mb-hh01": "Hunter × Hunter Booster Pack — Hunter Exam",
    "hxh-mb-hh02": "Hunter × Hunter Booster Pack — Nen Users",
    "hxh-mb-hh03": "Hunter × Hunter Booster Pack — Phantom Troupe",
    "hxh-mb-hhex01": "Hunter × Hunter Phantom Booster",
    "hxh-mb-hh": "Hunter × Hunter Promotional Cards",
    "nrt-mb-nrs01": "Naruto Shippuden Starter Deck — Bonds of the Leaf",
    "nrt-mb-nr01": "Naruto Shippuden Booster Pack 1 — Great Ninja War",
    "nrt-mb-nr02": "Naruto Shippuden Booster Pack 2 — Will of the Hokage",
    "nrt-mb-nr03": "Naruto Shippuden Booster Pack 3 — Those Who Control the Tailed Beasts",
    "nrt-mb-nr04": "Naruto Shippuden Booster Pack 4 — The One Who Bears the Shadow",
    "nrt-mb-nr05": "Naruto Shippuden Booster Pack 5 — Uchiha Awakening",
    "nrt-mb-nr": "Naruto Shippuden Promotional Cards",
    "mb-das02": "J-Heroes Deck — Heroes Assemble!",
    "mb-as01": "J-Heroes Booster 1",
    "mb-as02": "J-Heroes Booster 2",
    "mb-as03": "J-Heroes Booster 3",
    "mb-js01": "J-Heroes MiraBat Jump Hero Deck (Saikyo Jump, January 2013)",
    "mb-js02": "J-Heroes Dragon Team Assemble Deck (Saikyo Jump, 2014 issue 8)",
    "mb-as": "J-Heroes Promotional Cards",
    "mb-kb01": "Kuroko's Basketball Booster Pack 1 — Tip-Off! Battle of Miracles",
    // ---- Naruto · Card Game (2002–2006), o jogo principal
    "nrt-s01": "Vol. 1",
    "nrt-s02": "Vol. 2 — Demon! Zabuza",
    "nrt-s03": "Vol. 3 — Challengers Assemble!",
    "nrt-s04": "Vol. 4 — Test of the Forest of Death!",
    "nrt-s05": "Vol. 5 — Evenly Matched! Preliminary Death Match",
    "nrt-s06": "Vol. 6 — Each to Their Own Test!",
    "nrt-s07": "Vol. 7 — Clash! Chunin Final Exam",
    "nrt-s08": "Vol. 8 — Assault! Konoha Crush",
    "nrt-s09": "Vol. 9 — Akatsuki, Star of Ill Omen",
    "nrt-s10": "Vol. 10 — What Is Inherited and Entrusted",
    "nrt-s11": "Vol. 11 — Formed! The Konoha Squad",
    "nrt-s12": "Vol. 12 — The Chilling Cursed Seal",
    "nrt-s13": "Vol. 13 — Two Rivals Clash! Valley of the End",
    "nrt-s14": "Vol. 14 — Splendid! The Great Ninja Gathering",
    "nrt-s15": "Vol. 15 — Legend of the Young Days",
    "nrt-s16": "Vol. 16 — Heir of the Fire",
    "nrt-s17": "Vol. 17 — Island of the Mighty Beasts",
    "nrt-promo": "Promotional Cards",
    "nrt-extra": "Expansions & Specials",
    "nrt-atari": "\"Atari\" Winner Cards",
    // ---- Naruto · Data Carddass (Narutimate Card Battle / Mission)
    "nrt-dc-s01": "Narutimate Card Battle — Vol. 1",
    "nrt-dc-s02": "Narutimate Card Battle — Vol. 2",
    "nrt-dc-s03": "Narutimate Card Battle — Vol. 3",
    "nrt-dc-s05": "Narutimate Card Battle — Vol. 4",
    "nrt-dc-s06": "Narutimate Card Battle — Vol. 5",
    "nrt-dc-s07": "Narutimate Card Battle — Special Combo Sheet 2",
    "nrt-dc-s08": "Narutimate Card Battle — Vol. 6",
    "nrt-dc-s09": "Narutimate Card Battle — Vol. 7",
    "nrt-dc-s10": "Narutimate Card Battle — Vol. 8: Narutimate SP!",
    "nrt-dc-s11": "Narutimate Mission — Ch. 1: Blue Sky! A New Departure",
    "nrt-dc-s12": "Narutimate Mission — Ch. 2: Reign! Wind Dancing in the Yellow Sand",
    "nrt-dc-s13": "Narutimate Mission — Ch. 3: Assault! Fangs of Red Despair",
    "nrt-dc-s14": "Narutimate Mission — Ch. 4: Fierce Battle! Dark Clouds Bearing Gloom",
    "nrt-dc-s15": "Narutimate Mission — Special Mission Chapter",
    // ---- Naruto · Data Carddass Narutimate Formation
    "nrt-nf-s01": "Narutimate Formation — Ch. 1",
    "nrt-nf-s02": "Narutimate Formation — Campaign Cards",
    "nrt-nf-s03": "Narutimate Formation",
    "nrt-nf-s04": "Narutimate Formation — Promotional Cards",
    "nrt-nf-s05": "Narutimate Formation — Top Secret Mission",
    "nrt-nf-s06": "Narutimate Formation — Ch. 2: Reunion! Two Bound by Destiny",
    "nrt-nf-s07": "Narutimate Formation — Ch. 5: Clash! The Will of Fire Piercing the Dark",
    "nrt-nf-s08": "Narutimate Formation — Ch. 7: The Will of Fire Passed On",
    "nrt-nf-s10": "Narutimate Formation — Ch. 3: Rescue! The Soul of a Friend Asleep in the Desert",
    "nrt-nf-s12": "V Jump Card Festa 2008",
    "nrt-nf-s13": "Narutimate Formation — Ch. 6: Gathering! The Heroes' Lament",
    "nrt-nf-s26": "Pocket File Dass — Narutimate Formation",
    // ---- Naruto · Data Carddass Narutimate Cross
    "nrt-nx-s14": "Narutimate Cross — Ch. 2",
    "nrt-nx-s15": "Narutimate Cross — Ch. 3",
    "nrt-nx-s16": "Narutimate Cross — McDonald's Exclusive",
    "nrt-nx-s17": "Narutimate Cross — Promotional Cards",
    "nrt-nx-s18": "Narutimate Cross — Ch. 1",
    "nrt-nx-s19": "Pocket File Dass — Narutimate Cross",
    "nrt-nx-s21": "Narutimate Cross — Ch. 4: 100 Million Cards Commemorative",
    "nrt-nx-s22": "V Jump Card Festa 2009",
    "nrt-nx-s23": "Narutimate Cross — Ch. 5: 10th Anniversary SP",
    "nrt-nx-s24": "Narutimate Cross — Ch. 6",
    "nrt-nx-s25": "Narutimate Cross — Ch. 7",
    // ---- Hunter × Hunter · Carddass Hyper Battle
    "hxh-hb-p1": "Part 1 — Hunter Exam",
    "hxh-hb-p2": "Part 2 — Finished! × Passed? × Hunter Exam",
    "hxh-hb-p3": "Part 3 — Ten × Zetsu × Ren × Hatsu × Nen Special",
    "hxh-hb-p4": "Part 4 — Auction? × Secret Maneuvers × Phantom Troupe!!!",
    "hxh-hb-p5": "Part 5 — Yorknew × Phantom Troupe × Requiem",
    "hxh-hb-p6": "Part 6 — September 4th × G・I × Hatsu Training",
    "hxh-hb-gb": "Game Boy — Hunter's Genealogy bonus",
    "hxh-hb-jf00": "Jump Festa 2000 limited card",
    "hxh-hb-jf02": "Jump Festa 2002 Edition pack",
    // ---- Dragon Ball Carddass (sync-dbc-carddass.mjs): as 31 partes do Hondan,
    // inclusive as que o 80storage ainda não publicou (o sync pega sozinho quando
    // sair). Super Battle, Visual Adventure e Super Barcode Wars ficam de fora de
    // propósito: nenhuma fonte acessível lista essas séries carta a carta, então
    // elas não geram set nenhum, e 32 nomes mortos aqui estouravam o teto do
    // check-size (2026-09-30). Os nomes delas continuam no SETS do sync
    // (setNameEn); entram aqui junto com a fonte, se um dia houver.
    "dbc-h01": "Hondan Part 1 — Great Martial Arts Showdown",
    "dbc-h02": "Hondan Part 2 — World Martial Arts Tournament",
    "dbc-h03": "Hondan Part 3 — Fierce Battle! The Saiyans",
    "dbc-h04": "Hondan Part 4 — Great Battle!! Planet Namek",
    "dbc-h05": "Hondan Part 5 — Sortie! The Ginyu Force",
    "dbc-h06": "Hondan Part 6 — Heated!! Goku vs. Ginyu",
    "dbc-h07": "Hondan Part 7 — Terror!! Frieza's Super Transformation!!",
    "dbc-h08": "Hondan Part 8 — Upheaval!! Super Saiyan",
    "dbc-h09": "Hondan Part 9 — Magnificent!! Strongest vs. Strongest",
    "dbc-h10": "Hondan Part 10 — Terror!! The Androids Awaken",
    "dbc-h11": "Hondan Part 11 — Rampage! Warriors of Steel",
    "dbc-h12": "Hondan Part 12 — Counterattack!! The Three Super Saiyans",
    "dbc-h13": "Hondan Part 13 — Terror!! The Cell Games Begin",
    "dbc-h14": "Hondan Part 14 — Showdown! The Ultimate Super Saiyan Awakens",
    "dbc-h15": "Hondan Part 15 — Victory! Birth of the Golden Warrior!!",
    "dbc-h16": "Hondan Part 16 — Rise Up!! The New Z Fighters",
    "dbc-h17": "Hondan Part 17 — Launch! The New Gohan Chapter",
    "dbc-h18": "Hondan Part 18 — Revival! The Legendary Majin",
    "dbc-h19": "Hondan Part 19 — Melee! The King of Destruction Appears",
    "dbc-h20": "Hondan Part 20 — Tremor! Ultimate Power Unleashed",
    "dbc-h21": "Hondan Part 21 — Complete! Super Fusion",
    "dbc-h22": "Hondan Part 22 — Deadly!! The Strongest Fusion Ever",
    "dbc-h23": "Hondan Part 23 — Ultimate Merge! Super Vegito Arrives",
    "dbc-h24": "Hondan Part 24 — And On to a Distant Battle (Part 1)",
    "dbc-h25": "Hondan Part 25 — And On to a Distant Battle (Part 2)",
    "dbc-h26": "Hondan Part 26",
    "dbc-h27": "Hondan Part 27",
    "dbc-h28": "Hondan Part 28",
    "dbc-h29": "Hondan Part 29",
    "dbc-h30": "Hondan Part 30",
    "dbc-h31": "Hondan Part 31"
  };

  // Sets JAPONESES do Pokémon: mesma regra dos vintages acima, mas aqui o mapa
  // PRECISA do idioma pra ser consultado — estes setIds NÃO são exclusivos do
  // catálogo ja. `neo1`..`neo4` existem em en (Neo Genesis, Neo Discovery…) e
  // meia dúzia de SV são compartilhados com o chinês; sem o corte por idioma,
  // traduzir o japonês renomearia o set inglês junto.
  // Fonte: a coluna "Translated name" do "List of Japanese Pokémon Trading Card
  // Game expansions" da Bulbapedia — uma fonte só, verbatim, de propósito. Ela
  // diverge em alguns casos do apelido que a comunidade usa ("Rocket Gang" e
  // não "Team Rocket", "Terastal Fest ex" e não "…Festival ex"): preferir o
  // apelido caso a caso criaria um nome sem procedência, que é justamente o que
  // o comentário acima evita.
  // Fora do mapa de propósito: MBG e svpj, que a TCGdex já entrega em inglês.
  const JA_SET_EN = {
    // ---- Acrescentados em 21/09/2026 a partir da lista de expansões da Bulbapedia
    // (data/ja-enrich/_set-names.json, coluna "Translated name", verbatim),
    // casados pelo nome japonês do chunk.
    CP2: "Legendary Shine Collection",
    S10P: "Space Juggler",
    S10a: "Dark Phantasma",
    S11: "Lost Abyss",
    S11a: "Incandescent Arcana",
    S5I: "Single Strike Master",
    S6H: "Silver Lance",
    S6K: "Jet-Black Spirit",
    S7D: "Skyscraping Perfection",
    S8: "Fusion Arts",
    SM10a: "GG End",
    SM10b: "Sky Legend",
    SM11: "Miracle Twin",
    SM11a: "Remix Bout",
    SM1M: "Collection Moon",
    SM1S: "Collection Sun",
    SM1p: "Sun & Moon",
    SM2K: "Islands Await You",
    SM2L: "Alolan Moonlight",
    SM2p: "Facing a New Trial",
    SM3H: "To Have Seen the Battle Rainbow",
    SM3N: "Darkness that Consumes Light",
    SM3p: "Shining Legends",
    SM4A: "Ultradimensional Beasts",
    SM4S: "Awakened Heroes",
    SM5M: "Ultra Moon",
    SM5S: "Ultra Sun",
    SM5p: "Ultra Force",
    SM6: "Forbidden Light",
    SM6a: "Dragon Storm",
    SM6b: "Champion Road",
    SM7: "Sky-Splitting Charisma",
    SM7a: "Thunderclap Spark",
    SM7b: "Fairy Rise",
    SM8: "Super-Burst Impact",
    SM8a: "Dark Order",
    SM9: "Tag Bolt",
    SM9a: "Night Unison",
    SM9b: "Full Metal Wall",
    SV5M: "Cyber Judge",
    SV6a: "Night Wanderer",
    // ---- ポケットモンスターカードゲーム (1996-1999)
    PMCG1: "Expansion Pack",
    PMCG2: "Pokémon Jungle",
    PMCG3: "Mystery of the Fossils",
    PMCG4: "Rocket Gang",
    PMCG5: "Leaders' Stadium",
    PMCG6: "Challenge from the Darkness",
    // ---- neo (2000-2001)
    neo1: "Gold, Silver, to a New World...",
    neo2: "Crossing the Ruins...",
    neo3: "Awakening Legends",
    neo4: "Darkness, and to Light...",
    // ---- VS / web (2001)
    VS1: "Pokémon VS",
    web1: "Pokémon Web",
    // ---- ポケモンカードe (2001-2002)
    E1: "Base Expansion Pack",
    E2: "The Town on No Map",
    E3: "Wind from the Sea",
    E4: "Split Earth",
    E5: "Mysterious Mountains",
    // ---- PCG (2004-2006)
    PCG1: "Flight of Legends",
    PCG2: "Clash of the Blue Sky",
    PCG3: "Rocket Gang Strikes Back",
    PCG4: "Golden Sky, Silvery Ocean",
    PCG5: "Mirage Forest",
    PCG6: "Holon Research Tower",
    PCG7: "Holon Phantom",
    PCG8: "Miracle Crystal",
    PCG9: "Offense and Defense of the Furthest Ends",
    // ---- Concept Pack (2015)
    CP1: "Magma Gang VS Aqua Gang: Double Crisis",
    // ---- サン＆ムーン (2019)
    SM10: "Double Blaze",
    SM11b: "Dream League",
    SM12: "Alter Genesis",
    SM12a: "Tag All Stars",
    // ---- 剣と盾 (2022)
    S9: "Star Birth",
    S9a: "Battle Region",
    S12: "Paradigm Trigger",
    S12a: "VSTAR Universe",
    // ---- スカーレット&バイオレット (2023-2025)
    SV1S: "Scarlet ex",
    SV1V: "Violet ex",
    SV1a: "Triplet Beat",
    SV2D: "Clay Burst",
    SV2P: "Snow Hazard",
    SV2a: "Pokémon Card 151",
    SV3: "Ruler of the Black Flame",
    SV3a: "Raging Surf",
    SV4K: "Ancient Roar",
    SV4M: "Future Flash",
    // A TCGdex manda SV4a com o nome do SV3a (レイジングサーフ) — bug da fonte.
    // Aqui o certo já aparece; o dia em que eles corrigirem, nada muda.
    SV4a: "Shiny Treasure ex",
    SV5K: "Wild Force",
    SV5a: "Crimson Haze",
    SV6: "Transformation Mask",
    SV7: "Stellar Miracle",
    SV7a: "Paradise Dragona",
    SV8: "Super Electric Breaker",
    SV8a: "Terastal Fest ex",
    SV9: "Battle Partners",
    SV9a: "Hot Wind Arena",
    SV10: "Glory of the Rocket Gang",
    SV11B: "Black Bolt",
    SV11W: "White Flare",
    SVK: "Stellar Miracle Deck Build Box",
    SVLN: "Starter Set Tera Type: Stellar Sylveon ex",
    SVLS: "Starter Set Tera Type: Stellar Ceruledge ex",
    // ---- ポケモンカードゲーム MEGA (2025-2026)
    "M-P": "Mega Promo Card",
    M1S: "Mega Symphonia",
    M1L: "Mega Brave",
    M2: "Inferno X",
    M2a: "MEGA Dream ex",
    M3: "Nihil Zero",
    M4: "Ninja Spinner",
    M5: "Abyss Eye",
    M6: "Storm Emeralda",
    M6a: "30th Celebration",
    MC: "Start Deck 100 Battle Collection"
  };

  // Nome da SÉRIE, pelo original japonês (não pelo id: `neo`/`SV` colidem com o
  // en igual aos sets). Sem isto o cabeçalho de grupo da tela de Sets continuava
  // em japonês por cima de uma lista já traduzida. As séries que a TCGdex já
  // entrega em latim (PCG, VS, web) não precisam de entrada.
  const JA_SERIE_EN = {
    "ポケットモンスターカードゲーム": "Pocket Monsters Card Game",
    "ポケモンカード★neo": "Pokémon Card Neo",
    "ポケモンカードe": "Pokémon Card e",
    "サン＆ムーン": "Sun & Moon",
    "剣と盾": "Sword & Shield",
    "ポケモンカードゲーム スカーレット&バイオレット": "Scarlet & Violet",
    "ポケモンカードゲーム MEGA": "MEGA"
  };

  window.SLEEVU_NOMES_SETS = { vintage: VINTAGE_SET_EN, ja: JA_SET_EN, serieJa: JA_SERIE_EN };
})();
