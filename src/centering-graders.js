// Tolerâncias de centralização das graduadoras e a regra que transforma a
// medida do Centering Tool em nota (docs/PLANO-CENTERING-V2.md §4).
//
// DADOS NO TOPO, REGRAS EMBAIXO. Os números saíram das páginas oficiais, lidas
// em 2026-10-01 (§4.2/§4.3; onde a fonte é ambígua, o plano diz qual leitura
// vale e por quê — §4.4). Arquivo separado do núcleo de propósito: quando uma
// graduadora mudar a regra, o diff da PR é só a tabela dela, legível, e os
// casos-âncora de tests/centering-graders.test.mjs mudam junto (§4.8).
//
// Puro e global, sem DOM nem dependência: carrega antes do centering-core.js
// e roda num vm do node no teste. Os TEXTOS (rótulos, "não publicado", "lado
// não especificado"…) moram no i18n (src/i18n-centering.js, prefixo "cen.");
// aqui só há números, códigos e URLs.
//
// O `conferido` de cada graduadora é lido por regex pelo scripts/check.mjs
// (scripts/lib/lembrete-centering.mjs): passou de 180 dias, o check imprime o
// lembrete de reconferir. Por isso `code` vem ANTES de `conferido` no objeto.
(function () {
  "use strict";

  // ── Convenção das notas (§4.7) ──────────────────────────────────────────────
  // Cada nota é [nota, frente, verso, extras], da MELHOR pra pior (a ordem do
  // array é a ordem da escala; a nota é TEXTO: "9.5", "10P", "10+").
  //   N           "N/(100−N) ou melhor" no lado MAIOR (55 = 55/45).
  //   null        não publicado. Na frente: a linha não é candidata. No verso:
  //               herda o limite da nota imediatamente inferior que publica
  //               verso (o 10P da CGC herda o 75 do Gem Mint 10); se nenhuma
  //               de baixo publica, não há limite e o painel diz "verso não
  //               publicado". (O rascunho tratava null como "ignora o verso" e
  //               o CGC 10P passava carta que reprova no Gem Mint 10.)
  //   "qualquer"  até 100/0.
  //   "borda"     qualquer coisa, desde que sobre borda dos dois lados (TAG:
  //               "não pode ser miscut nem mostrar parte de outra carta").
  //   "igual"     lado não especificado (SGC, ACE 10): na leitura conservadora
  //               o verso usa o número da frente; na "só frente" o verso desta
  //               nota fica não publicado (herda o de baixo, como o null).
  //   {melhor, pior}  regra cruzada entre os eixos (BGS /grading/scale 9.5:
  //               "50/50 num eixo, 55/45 no outro").
  // Extras: rot = rótulo da graduadora (literal, não traduz); aprox =
  // "aproximadamente"; inter = nota real SEM número entre duas com número
  // (vira "8 (8.5 sem número)"); so = só vale numa categoria (CGC); diamante =
  // tolerância de diamond cut, em código; faixaAte = ponta alta de faixa
  // histórica; publicado = texto literal quando a página tem erro de
  // digitação (o número usado é o 1º do par, o "N" da convenção); <variante> =
  // o que muda na página-variante ({ f, v }, BGS).
  // Nível da graduadora: aprox (todas as notas), estrito ("melhor que", ou
  // seja X < N em vez de X ≤ N), lado: "nao-especificado".

  // PSA — teto por nota; mede no ponto MAIS descentralizado ("at the most
  // off-center part of the card"). Meio ponto (2–9) "depende de qualidades
  // high-end dentro da nota", sem número: NÃO entra aqui como "inter" (§4.4).
  const PSA = {
    code: "psa", nome: "PSA", papel: "teto", medida: "pior-ponto", pais: "US",
    fontes: ["https://www.psacard.com/gradingstandards",
      "https://www.psacard.com/psa/locales/en-US/gradingStandards.json"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [
      // Texto novo desde 24/01/2025 (mudou sem anúncio entre os snapshots
      // 20250112215218 e 20250124105846). A folga de 5% na frente pra notas
      // ≥ 7 é palavra por palavra a mesma de antes: 60/40 cumpre o 9 sozinho,
      // 65/35 "pode" dar 9 com bom eye appeal.
      { desde: "2025-01-24",
        fonte: "https://web.archive.org/web/20250124105846/https://www.psacard.com/gradingstandards",
        folgaFrente: { pontos: 5, notaMin: 7 },
        notas: [
          ["10", 55, 75, { rot: "GEM-MT", aprox: 1 }],
          ["9", 60, 90, { rot: "MINT", aprox: 1 }],
          ["8", 65, 90, { rot: "NM-MT", aprox: 1 }],
          ["7", 70, 90, { rot: "NM", aprox: 1 }],
          ["6", 80, 90, { rot: "EX-MT" }],
          ["5", 85, 90, { rot: "EX" }],
          ["4", 85, 90, { rot: "VG-EX" }],
          ["3", 90, 90, { rot: "VG" }],
          ["2", 90, 90, { rot: "GOOD" }],
          ["1.5", 90, 90, { rot: "FR", aprox: 1 }],   // o concorrente esquece esta linha
          ["1", "qualquer", "qualquer", { rot: "PR" }]  // "sem exigência" (o concorrente põe 90/10)
        ] },
      // Até 12/01/2025 o texto da base era FAIXA ("55/45 to 60/40"); a ponta
      // alta = base + a mesma folga de hoje, então pela letra a tolerância
      // máxima com eye appeal não mudou — mudou a redação. "Aperto na prática"
      // é afirmação do centeringcheck, não da PSA. Do 6 pra baixo, igual à
      // vigência atual. Histórico não se apaga (§4.8).
      { ate: "2025-01-12", historico: true,
        fonte: "https://web.archive.org/web/20250112215218/https://www.psacard.com/gradingstandards",
        folgaFrente: { pontos: 5, notaMin: 7 },
        notas: [
          ["10", 55, 75, { rot: "GEM-MT", faixaAte: 60 }],
          ["9", 60, 90, { rot: "MINT", faixaAte: 65 }],
          ["8", 65, 90, { rot: "NM-MT", faixaAte: 70 }],
          ["7", 70, 90, { rot: "NM", faixaAte: 75 }]
        ] }
    ]
  };

  // BGS — SUBNOTA de centralização (ao lado de Corners, Edges e Surface); o
  // painel nunca diz "BGS 9.5" seco. Confiança MÉDIA: o beckett.com está em
  // manutenção e a Beckett manteve DUAS páginas no ar de 2023 a 2026 com regras
  // diferentes no 9.5 e no verso do Pristine. Nenhuma dá pra chamar de vigente:
  // a nota sai pela leitura mais rígida, com as duas lado a lado (§4.4).
  const BGS = {
    code: "bgs", nome: "BGS", papel: "subnota", padrao: "mais-rigida", pais: "US",
    fontes: ["https://www.beckett.com/grading-standards",
      "https://web.archive.org/web/20251210/https://www.beckett.com/grading-standards"],
    // /grading/scale: capturada até 2026-05-03, já com "Copyright © 2026".
    variantes: { scale: { fontes: ["https://www.beckett.com/grading/scale",
      "https://web.archive.org/web/20260503/https://www.beckett.com/grading/scale"] } },
    conferido: "2026-10-01", confianca: "media",
    vigencias: [{ notas: [
      ["10", 50, 55, { rot: "Pristine", scale: { v: 60 } }],
      ["9.5", 55, 60, { rot: "Gem Mint", scale: { f: { melhor: 50, pior: 55 } } }],
      ["9", 55, 70, { rot: "Mint" }],
      ["8.5", null, null, { inter: 1 }],
      ["8", 60, 80, { rot: "NM-MT" }],
      ["7.5", null, null, { inter: 1 }],
      ["7", 65, 90, { rot: "NM", diamante: "muito-leve" }],
      ["6.5", null, null, { inter: 1 }],
      ["6", 70, 95, { rot: "EX-MT", diamante: "leve" }],
      ["5.5", null, null, { inter: 1 }],
      ["5", 75, 95, { rot: "EX", diamante: "leve" }],          // verso 95/5 (o concorrente põe "Any")
      ["4.5", null, null, { inter: 1 }],
      ["4", 80, "qualquer", { rot: "VG-EX", diamante: "moderado" }],   // verso 100/0
      ["3.5", null, null, { inter: 1 }],
      ["3", 85, "qualquer", { rot: "VG", diamante: "moderado" }],
      ["2.5", null, null, { inter: 1 }],
      ["2", 90, "qualquer", { rot: "Good", diamante: "perceptivel" }],  // verso "100/0 ou offcut"
      ["1.5", null, null, { inter: 1 }],
      ["1", "qualquer", "qualquer", { rot: "Poor", diamante: "forte" }]  // "100/0 ou offcut"
    ] }]
  };

  // CGC — nota única, escala unificada (CGC TC + CSG) desde jul/2023. Do 9 ao
  // 4.5 o texto diz "For sports and non-sports cards": pra TCG só há número no
  // Pristine 10, no Gem Mint 10 e no 3.5 (o texto do 3.5 não tem a ressalva).
  // A CGC põe Carddass ora em non-sports, ora em TCG (o pop report tem as duas
  // rotas), por isso a categoria vem de fora: "tcg" | "nao-esporte" |
  // "depende" (duas leituras). Escala inteira, com null onde não há número
  // (conferido de novo na página ao vivo em 2026-10-01: 5 e 4 não têm número).
  const CGC = {
    code: "cgc", nome: "CGC", papel: "teto", categorias: ["tcg", "nao-esporte"], pais: "US",
    fontes: ["https://www.cgccards.com/card-grading/grading-scale/"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ desde: "2023-07", notas: [
      // "The centering is 50/50". Verso não publicado: herda o 75 do Gem Mint
      // 10, que o texto define como um 10 em que UM critério não chega ao
      // Pristine — então o Pristine cumpre pelo menos o verso do 10.
      ["10P", 50, null, { rot: "Pristine" }],
      ["10", 55, 75, { rot: "Gem Mint", aprox: 1 }],   // "approximately 55/45 … reverse … 75/25"
      // "exceptional centering … can elevate a card to a Mint+ grade": ajuda,
      // sem número — e não é intermediária (como o meio ponto da PSA).
      ["9.5", null, null, { rot: "Mint+" }],
      ["9", 60, 90, { rot: "Mint", so: "nao-esporte" }],
      ["8.5", null, null, { rot: "NM/Mint+", inter: 1, diamante: "muito-leve" }],
      ["8", 65, null, { rot: "NM/Mint", so: "nao-esporte", diamante: "muito-leve" }],
      ["7.5", 65, null, { rot: "Near Mint+", so: "nao-esporte", diamante: "leve" }],  // "65/35 … is allowed"
      ["7", 70, null, { rot: "Near Mint", so: "nao-esporte", diamante: "leve" }],
      ["6.5", null, null, { rot: "Ex/NM+", inter: 1, diamante: "moderado" }],
      ["6", 75, null, { rot: "Ex/NM", so: "nao-esporte", diamante: "moderado" }],
      ["5.5", null, null, { rot: "Excellent+", inter: 1 }],
      ["5", null, null, { rot: "Excellent", inter: 1 }],
      ["4.5", 85, null, { rot: "VG/Ex+", so: "nao-esporte", diamante: "muito-perceptivel" }],
      ["4", null, null, { rot: "VG/Ex", inter: 1, diamante: "muito-perceptivel" }],
      ["3.5", 90, null, { rot: "Very Good+", aprox: 1 }],   // "may have 90/10": vale pra TCG
      ["3", null, null, { rot: "Very Good" }],
      ["2.5", null, null, { rot: "Good+", diamante: "quase-miscut" }],
      ["2", null, null, { rot: "Good", diamante: "quase-miscut" }],
      ["1.5", null, null, { rot: "Fair" }],
      ["1", null, null, { rot: "Poor" }]
    ] }]
  };

  // SGC — teto ("guidelines"). Texto lido no bundle da página (chunk-XZCQGYIQ.js,
  // "LAST UPDATED: 10/30/2025"): "50/50 centering", "55/45 or better
  // centering"… SEM dizer front, reverse ou back. Leitura conservadora = o
  // mesmo número no verso (é a que a Edge Grading atribui à SGC); a "só
  // frente" aparece ao lado quando der nota diferente.
  const SGC = {
    code: "sgc", nome: "SGC", papel: "teto", lado: "nao-especificado", pais: "US",
    fontes: ["https://gosgc.com/card-grading-scale"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [
      ["10P", 50, "igual", { rot: "Pristine" }],
      ["10", 55, "igual", { rot: "Gem Mint" }],
      ["9.5", null, null],        // "appears to be Gem Mint 10": não conta como intermediária
      ["9", 60, "igual"],
      ["8.5", 65, "igual"],
      ["8", 65, "igual"],
      ["7.5", 70, "igual"],
      ["7", 70, "igual", { diamante: "leve" }],
      ["6.5", null, null, { inter: 1 }],
      ["6", 75, "igual"],
      ["5.5", null, null, { inter: 1 }],
      ["5", 80, "igual"],
      ["4.5", null, null, { inter: 1 }],
      ["4", 85, "igual"],
      ["3.5", null, null, { inter: 1 }],
      ["3", 90, "igual"],
      ["2.5", null, null, { inter: 1 }],
      ["2", 90, "igual"],
      ["1.5", 90, "igual"],
      ["1", null, null]           // sem número, abaixo da última que tem
    ] }]
  };

  // TAG — componente medido por visão computacional dentro de 1000 pontos (a
  // fórmula não é publicada). Todos os limites vêm com "~"; coluna de verso
  // TCG. Os DECIMAIS são os oficiais: o concorrente arredondou as meias notas
  // de 8.5 a 2.5 pra cima (mais leniente) e o 1.5 (98,33 → 98) pra baixo. O
  // verso de esporte da rubrica (54,5/45,5 · 70/30 · 90/10 · 95/5) não se
  // aplica ao Sleevu e fica só registrado aqui.
  const TAG = {
    code: "tag", nome: "TAG", papel: "componente", aprox: true, pais: "US",
    fontes: ["https://taggrading.com/pages/rubric"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [
      ["10P", 51, 52, { rot: "Pristine" }],
      ["10", 55, 65, { rot: "Gem Mint" }],
      ["9", 60, 75],
      ["8.5", 62.5, 85],
      ["8", 65, 95],
      ["7.5", 67.5, "borda"],
      ["7", 70, "borda"],
      ["6.5", 72.5, "borda"],
      ["6", 75, "borda"],
      ["5.5", 77.5, "borda"],
      ["5", 80, "borda"],
      ["4.5", 82.5, "borda"],
      ["4", 85, "borda"],
      ["3.5", 87.5, "borda"],
      ["3", 90, "borda"],
      ["2.5", 92.5, "borda"],
      ["2", 95, "borda"],
      ["1.5", 98.33, "borda"],
      ["1", "borda", "borda"]
    ] }]
  };

  // ── Mais graduadoras (§4.3): na F1a só a tabela da página as usa ─────────────

  // ACE (Reino Unido) — mede a 1/1000 mm e dá subnota de centralização: o OC
  // sai quando ela fica 2 ou mais notas abaixo da final. Texto em "melhor que"
  // ("less than a 60/40 split", "greater than 65/35"), por isso estrito. O 10
  // não diz o lado: mesmo tratamento da SGC.
  const ACE = {
    code: "ace", nome: "ACE", papel: "subnota", estrito: true, oc: 2, pais: "GB",
    fontes: ["https://acegrading.com/grading-scale"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [
      ["10", 60, "igual"],
      ["9", 65, 70],
      ["8", 70, 75],
      ["7", 75, 80],
      ["6", 80, 80],
      ["5", 80, 80],
      ["4", 80, 80],
      ["3", 85, 85],
      ["2", 85, 85],
      ["1", 85, 85]
    ] }]
  };

  // PCA (França) — só o 10+ e o 10 têm número: 60/40 na frente e 75/25 no
  // verso, medido pela largura da borda. Do 9.5 pra baixo, sem número (por
  // isso a escala para no 10: abaixo dele, "abaixo de 10 · sem número"). Os
  // blogs dizem 55/45, o que contradiz a página oficial. A página não diz
  // como a centralização entra na nota final: papel null.
  const PCA = {
    code: "pca", nome: "PCA", papel: null, medida: "largura-da-borda", pais: "FR",
    fontes: ["https://pcagrade.com/fr/ressources"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [
      ["10+", 60, 75],
      ["10", 60, 75]
    ] }]
  };

  // ARS (Japão) — a centralização NÃO desconta: só o estado de conservação
  // conta. Sem tabela; a página mostra a frase.
  const ARS = {
    code: "ars", nome: "ARS", papel: "nenhum", pais: "JP",
    fontes: ["https://ars-grading.com/service/reliability"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [] }]
  };

  // Capy Grading (Brasil) — derivada da TAG, com versos próprios; final = a
  // menor subnota + um possível +0,5. COMO PUBLICADO: a página tem erros de
  // digitação ("67,5/29", "72,5/27", "86/13,5", e o 7 igual ao 7,5 na frente).
  // Vale o 1º número de cada par, que é o lado maior da convenção; o texto
  // literal fica em `publicado` pra tabela poder mostrar. Vale avisar a Capy.
  const CAPY = {
    code: "capy", nome: "Capy Grading", papel: "subnota", comoPublicado: true, pais: "BR",
    fontes: ["https://grading.capygames.com.br/escala-de-graduaco"],
    conferido: "2026-10-01", confianca: "alta",
    vigencias: [{ notas: [
      ["10P", 51, 52, { rot: "Pristine", aprox: 1 }],
      ["10", 55, 60, { rot: "Gem Mint", aprox: 1 }],           // "Gem Mint - 10 (9,5)"
      ["9", 60, 62.5, { rot: "Mint", aprox: 1 }],
      ["8.5", 62.5, 65, { rot: "NM MT+", aprox: 1 }],
      ["8", 65, 67.5, { rot: "NM MT", aprox: 1 }],
      ["7.5", 67.5, 67.5, { rot: "NM+", aprox: 1, publicado: { v: "67,5/29" } }],
      ["7", 67.5, 72.5, { rot: "NM", aprox: 1, publicado: { f: "67,5/32,5", v: "72,5/27" } }],
      ["6.5", 72.5, 75, { rot: "EX MT+", aprox: 1 }],
      ["6", 75, 77.5, { rot: "EX MT", aprox: 1 }],
      ["5.5", 77.5, 80, { rot: "EX+", aprox: 1 }],
      ["5", 80, 82.5, { rot: "EX", aprox: 1 }],
      ["4.5", 82.5, 85, { rot: "VG EX+", aprox: 1 }],
      ["4", 85, 86, { rot: "VG EX", aprox: 1, publicado: { v: "86/13,5" } }],
      ["3.5", 87.5, 87.5, { rot: "VG+", aprox: 1 }],
      ["3", 90, 90, { rot: "VG", aprox: 1 }],
      ["2.5", 92.5, 92.5, { rot: "Good+", aprox: 1 }],
      ["2", 95, 95, { rot: "Good", aprox: 1 }],
      ["1.5", 98.33, 98.33, { rot: "Fair", aprox: 1 }],
      ["1", 99, 99, { rot: "Poor" }]                           // "99/01 na frente ou verso"
    ] }]
  };

  // Edge Grading (EUA) — confiança MÉDIA: o texto é da própria Edge, mas num
  // artigo comparativo, não numa escala formal (reconferir se surgir uma).
  // Abaixo do 10 o artigo não dá número; não diz o papel na nota final.
  const EDGE = {
    code: "edge", nome: "Edge Grading", papel: null, pais: "US",
    fontes: ["https://www.edgegrading.com/centering"],
    conferido: "2026-10-01", confianca: "media",
    vigencias: [{ notas: [
      ["10+", 52, 60, { rot: "Ultramint" }],
      ["10", 55, 70]
    ] }]
  };

  // Manafix/MGS e Gradd (Brasil) dão subnota de centralização mas não
  // publicam números: ficam fora até publicarem.

  // Categoria pra CGC por linha do catálogo. Sem contexto de carta (F1a) o
  // padrão é "tcg" com o seletor da página; na F4 isto é montado a partir do
  // GAME_LINES (Carddass e vending ficam "depende"). Mora aqui, e não no
  // shared.js, pra custar 0 B no núcleo.
  const CATEGORIA_POR_LINHA = { "nrt-dc": "depende" };

  const LISTA = [PSA, BGS, CGC, SGC, TAG];
  const MAIS = [ACE, PCA, ARS, CAPY, EDGE];

  // ════════════════════════════════════════════════════════════════════════════
  // Regras (§4.6)
  // ════════════════════════════════════════════════════════════════════════════

  const TODAS = LISTA.concat(MAIS);
  const acha = (code) => TODAS.find((g) => g.code === code) || null;

  const EPS = 1e-9;          // só pra 55,4 + 0,5 não virar 55,900000000000006
  const LIM50 = 50;          // limites de 50/50: regra própria (ver cabe())
  const ehNum = (x) => typeof x === "number" && isFinite(x);
  const arred = (x, casas) => { const k = Math.pow(10, casas); return Math.round(x * k) / k; };
  // O "55" de 55/45, com 1 casa: a medida é DIRECIONAL (esquerda/topo primeiro).
  const maior = (p) => arred(Math.max(p, 100 - p), 1);
  // Folga do "no limite": δ = max(0,5; 2·σ_total) (§4.6).
  const delta = (sigma) => Math.max(0.5, 2 * (ehNum(sigma) ? sigma : 0));

  function vigencia(g, historico) {
    const vs = g.vigencias || [];
    return (historico ? vs.find((v) => v.historico) : vs.find((v) => !v.historico)) || null;
  }
  const brutas = (vig) => ((vig && vig.notas) || []).map((n) => ({ nota: n[0], f: n[1], v: n[2], x: n[3] || {} }));

  // Quantas vezes a nota é calculada, e com o quê (§4.6 "Duas leituras").
  function leiturasDe(g, opts) {
    const cat = opts && opts.categoria;
    if (g.categorias) {
      if (cat === "depende") return [{ origem: "tcg", categoria: "tcg" }, { origem: "nao-esporte", categoria: "nao-esporte" }];
      const c = cat === "nao-esporte" ? "nao-esporte" : "tcg";
      return [{ origem: c, categoria: c }];
    }
    if (g.variantes) return [{ origem: "standards" }].concat(Object.keys(g.variantes).map((k) => ({ origem: k, variante: k })));
    if (brutas(vigencia(g)).some((l) => l.v === "igual")) {
      return [{ origem: "conservadora", igual: "conservadora" }, { origem: "so-frente", igual: "so-frente" }];
    }
    return [{ origem: null }];
  }

  // A escala JÁ RESOLVIDA pra uma leitura: variante aplicada, "igual" trocado,
  // categoria marcada e o null do verso herdado. Tudo o que decide nota lê daqui.
  //   cand   = candidata (frente com número e da categoria);
  //   sombra = régua de OUTRA categoria (CGC non-sports lida em TCG): não dá
  //            nota, mas diz se a carta cairia numa nota "sem número pra TCG".
  function escala(g, leitura, vig) {
    const cat = leitura.categoria || null;
    const ls = brutas(vig || vigencia(g)).map((l) => {
      let f = l.f, v = l.v;
      const o = leitura.variante && l.x[leitura.variante];
      if (o) { if ("f" in o) f = o.f; if ("v" in o) v = o.v; }
      const vBruto = v;
      // "Só frente": o limite não vale pro verso, então o verso desta nota é
      // não publicado e herda o de baixo (senão o ACE 10 aceitaria um verso
      // que o ACE 9 reprova — uma nota maior permitindo mais).
      if (v === "igual") v = leitura.igual === "so-frente" ? null : f;
      const daCat = !l.x.so || !cat || l.x.so === cat;
      return { nota: l.nota, f, v, vBruto, x: l.x, cand: f != null && daCat, sombra: f != null && !daCat, herdaDe: null };
    });
    // Herança do null no verso, de baixo pra cima: cada nota leva o último
    // verso publicado ABAIXO dela. Sem nenhum, fica null = sem limite.
    let herdado = null, de = null;
    for (let i = ls.length - 1; i >= 0; i--) {
      const l = ls[i];
      if (!l.cand && !l.sombra) continue;
      if (l.v == null) { l.v = herdado; l.herdaDe = de; } else { herdado = l.v; de = l.nota; }
    }
    return ls;
  }

  // Um lado medido → os números que as regras usam. Aceita a forma do contrato
  // ({ lr, tb, sigma } com o "usado" de 1 casa) e, de lambuja, a saída do
  // medir() do núcleo ({ lr: { meio, pior, usado, sigma }, …, mm }).
  //   meio (opcional) = { lr, tb } no meio da faixa: decide os limites de
  //   50/50, nunca o pior ponto, cujo viés positivo reprovaria carta perfeita;
  //   mm (opcional)   = { l, r, t, b } em mm, pro "falta ≈ X mm".
  function ladoMedido(m) {
    if (!m) return null;
    const ent = (e) => (e && typeof e === "object" ? e : { usado: e });
    const a = ent(m.lr), b = ent(m.tb);
    // A nota é decidida SEMPRE pela 1 casa (§4.6): o inteiro de uma foto
    // pobre é só exibição, e 55,4 nunca vira "55 → PSA 10".
    const u = { lr: ehNum(a.usado) ? arred(a.usado, 1) : null, tb: ehNum(b.usado) ? arred(b.usado, 1) : null };
    if (u.lr == null && u.tb == null) return null;
    const mm = m.meio || {};
    const meio = {
      lr: ehNum(mm.lr) ? mm.lr : ehNum(a.meio) ? a.meio : u.lr,
      tb: ehNum(mm.tb) ? mm.tb : ehNum(b.meio) ? b.meio : u.tb
    };
    const eixo = (x) => (x == null ? null : maior(x));
    const X = { lr: eixo(u.lr), tb: eixo(u.tb), m50: { lr: eixo(meio.lr), tb: eixo(meio.tb) } };
    const vals = [X.lr, X.tb].filter((x) => x != null);
    const v50 = [X.m50.lr, X.m50.tb].filter((x) => x != null);
    X.pior = Math.max.apply(null, vals);
    X.melhor = Math.min.apply(null, vals);
    X.pior50 = Math.max.apply(null, v50);
    X.melhor50 = Math.min.apply(null, v50);
    const sigma = ehNum(m.sigma) ? m.sigma : Math.max(ehNum(a.sigma) ? a.sigma : 0, ehNum(b.sigma) ? b.sigma : 0);
    X.sigma = sigma;
    X.d = delta(sigma);
    X.mm = m.mm && typeof m.mm === "object" ? m.mm : null;
    return X;
  }

  // Um valor (o "maior" de um eixo) cabe no limite N? modo: "n" nominal,
  // "p" pessimista (valor + δ), "o" otimista (valor − δ).
  // Limites de 50/50 (Pristine, 10P, o "50 num eixo" da /grading/scale) usam
  // ≤ 50 + δ e saem SEMPRE "no limite": nenhuma foto prova 50,0/50,0, então a
  // leitura pessimista nunca os confirma.
  function cabe(valor, N, modo, d, estrito) {
    if (N <= LIM50) return modo !== "p" && valor <= LIM50 + d + EPS;
    const x = modo === "p" ? Math.min(100, valor + d) : modo === "o" ? Math.max(50, valor - d) : valor;
    return estrito ? x < N - EPS : x <= N + EPS;
  }

  // passa(limite, X) da tabela da §4.6.
  function passa(lim, X, modo, estrito) {
    if (lim == null || lim === "qualquer") return true;
    if (lim === "borda") {
      const x = modo === "p" ? X.pior + X.d : modo === "o" ? X.pior - X.d : X.pior;
      return x < 100 - EPS;   // sobrou borda dos dois lados
    }
    if (ehNum(lim)) return cabe(lim <= LIM50 ? X.pior50 : X.pior, lim, modo, X.d, estrito);
    if (typeof lim === "object") {
      return cabe(lim.melhor <= LIM50 ? X.melhor50 : X.melhor, lim.melhor, modo, X.d, estrito) &&
        cabe(lim.pior <= LIM50 ? X.pior50 : X.pior, lim.pior, modo, X.d, estrito);
    }
    return true;
  }
  const passaLinha = (l, F, V, modo, estrito) => passa(l.f, F, modo, estrito) && (!V || passa(l.v, V, modo, estrito));

  // nota(grad, F, V, leitura): da melhor pra pior, a 1ª candidata em que a
  // frente passa e o verso (se medido) passa.
  //  - notas sem número entre a última reprovada e a aprovada viram
  //    semNumero ("8 (8.5 sem número)");
  //  - se nesse intervalo a carta cumpre a régua de OUTRA categoria (CGC
  //    non-sports lida em TCG), a nota real não tem número pra esta categoria:
  //    abaixoSemNumero, "abaixo de 10 · sem número pra TCG". Se reprova a
  //    régua da outra categoria, ela vale como teto e o intervalo recomeça
  //    (é o que faz TCG 89/11 dar 3.5, como diz o caso-âncora);
  //  - se nenhuma passa: "abaixo da última nota com número".
  function notaDaLeitura(ls, F, V, modo, estrito) {
    let ultima = null, gap = [], cat = false;
    const fecha = (i, l) => cat
      ? { nota: null, idx: i, linha: l, prox: ultima, semNumero: gap, abaixoSemNumero: true, abaixoDe: ultima ? ultima.nota : null, piso: l.nota }
      : { nota: l.nota, idx: i, linha: l, prox: ultima, semNumero: gap, abaixoSemNumero: false, abaixoDe: null, piso: null };
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.cand) {
        if (passaLinha(l, F, V, modo, estrito)) return fecha(i, l);
        ultima = l; gap = []; cat = false;
      } else if (l.sombra) {
        if (passaLinha(l, F, V, modo, estrito)) { gap.push(l.nota); cat = true; } else { gap = []; cat = false; }
      } else if (l.x.inter) {
        gap.push(l.nota);
      }
    }
    return { nota: null, idx: ls.length, linha: null, prox: ultima, semNumero: gap, abaixoSemNumero: true, abaixoDe: ultima ? ultima.nota : null, piso: null };
  }

  // Ordem de rigidez (maior = mais rígida). "Abaixo de 10, sem número" com
  // piso 3.5 fica entre o 3.5 e a nota de cima: é pelo menos o piso.
  const rigidez = (r) => r.idx - (r.abaixoSemNumero && r.piso != null ? 0.5 : 0);
  const chave = (r) => `${r.nota}|${r.abaixoSemNumero}|${r.abaixoDe}|${r.piso}`;
  function maisRigida(calc, modo) {
    let m = calc[0];
    for (let i = 1; i < calc.length; i++) if (rigidez(calc[i][modo]) > rigidez(m[modo])) m = calc[i];
    return m;
  }

  // "Falta pro próximo": Δ = maior − limite(próxima), de CADA eixo e de CADA
  // lado que falha, não só do eixo que limita. Em mm: Δ/100 × (mA + mB).
  function faltas(prox, F, V, estrito) {
    const out = [];
    if (!prox) return out;
    const mmDe = (X, eixo, pts) => {
      if (!X.mm || pts == null) return null;
      const s = eixo === "lr" ? X.mm.l + X.mm.r : X.mm.t + X.mm.b;
      return ehNum(s) ? arred((pts / 100) * s, 3) : null;
    };
    const item = (lado, X, eixo, lim, val) => {
      const pts = val == null ? null : arred(val - lim, 2);
      out.push({ nota: prox.nota, lado, eixo, pts, limite: lim, mm: mmDe(X, eixo, pts) });
    };
    [["f", F, prox.f], ["v", V, prox.v]].forEach(([lado, X, lim]) => {
      if (!X || lim == null || lim === "qualquer") return;
      if (lim === "borda") {
        ["lr", "tb"].forEach((e) => { if (X[e] != null && X[e] >= 100 - EPS) out.push({ nota: prox.nota, lado, eixo: e, pts: null, limite: "borda", mm: null }); });
        return;
      }
      if (ehNum(lim)) {
        ["lr", "tb"].forEach((e) => {
          const val = lim <= LIM50 ? X.m50[e] : X[e];
          if (val != null && !cabe(val, lim, "n", X.d, estrito)) item(lado, X, e, lim, val);
        });
        return;
      }
      if (typeof lim === "object") {
        // O eixo mais centrado responde pelo "melhor"; o outro, pelo "pior".
        const [eM, eP] = (X.lr == null || (X.tb != null && X.tb < X.lr)) ? ["tb", "lr"] : ["lr", "tb"];
        const vM = lim.melhor <= LIM50 ? X.m50[eM] : X[eM];
        const vP = lim.pior <= LIM50 ? X.m50[eP] : X[eP];
        if (vM != null && !cabe(vM, lim.melhor, "n", X.d, estrito)) item(lado, X, eM, lim.melhor, vM);
        if (vP != null && !cabe(vP, lim.pior, "n", X.d, estrito)) item(lado, X, eP, lim.pior, vP);
      }
    });
    return out;
  }

  const usa50 = (l, V) => !!l && (
    (ehNum(l.f) && l.f <= LIM50) ||
    (l.f && typeof l.f === "object" && l.f.melhor <= LIM50) ||
    (!!V && ehNum(l.v) && l.v <= LIM50));

  // avaliar(code, medida, opts) → Resultado (o formato está no contrato do
  // plano; os campos a mais são aditivos e estão marcados com "+").
  //   medida = { f: { lr, tb, sigma, meio?, mm? } | null, v: idem | null }
  //   opts   = { categoria: "tcg" | "nao-esporte" | "depende" } (só a CGC usa)
  //
  //   nota        a nota pela leitura MAIS RÍGIDA, decidida pela 1 casa; null
  //               quando não há número (ver abaixoSemNumero).
  //   rot         rótulo da graduadora pra essa nota ("GEM-MT", "Pristine").
  //   semNumero   notas reais sem número entre a reprovada e a aprovada.
  //   abaixoSemNumero  a nota fica abaixo de `abaixoDe` e não tem número
  //               publicado (pra esta categoria, se for o caso). + abaixoDe,
  //               + piso (a nota com número logo abaixo, ou null).
  //   limita      { lado, eixo } que mais falta pra próxima nota (null no topo).
  //   falta       [{ nota, lado, eixo, pts, limite, +mm }] de cada eixo/lado
  //               que reprova a próxima nota com número.
  //   folga       PSA: a maior nota ≥ 7 possível pela folga de 5% da frente.
  //   noLimite    { de, ate } quando a nota com X ± δ muda; de/ate null =
  //               abaixo, sem número.
  //   compat50    a nota foi decidida por um limite de 50/50 (sempre "no limite").
  //   leituras    [{ origem, nota, semNumero, +rot, +abaixoSemNumero, +abaixoDe,
  //               +piso }] quando a nota é calculada duas vezes (SGC/ACE lado,
  //               BGS páginas, CGC "depende"); + divergem; + leitura (origem da
  //               que deu a nota).
  //   verso       "medido" | "nao-medido" | "nao-publicado" | "igual-frente".
  //   + ladoNaoEspecificado, + confianca, + semMedida (sem frente), + naoConta (ARS).
  function avaliar(code, medida, opts) {
    const g = acha(code);
    if (!g) return null;
    opts = opts || {};
    const F = ladoMedido(medida && medida.f);
    const V = ladoMedido(medida && medida.v);
    const vig = vigencia(g);
    const r = {
      code: g.code, nome: g.nome, papel: g.papel, confianca: g.confianca,
      nota: null, rot: null, semNumero: [], abaixoSemNumero: false, abaixoDe: null, piso: null,
      limita: null, falta: [], folga: null, noLimite: null, compat50: false,
      leituras: [], divergem: false, leitura: null,
      verso: V ? "medido" : "nao-medido",
      ladoNaoEspecificado: g.lado === "nao-especificado",
      semMedida: !F, naoConta: g.papel === "nenhum"
    };
    if (!F || !vig || !vig.notas.length) return r;
    const estrito = !!g.estrito;

    const calc = leiturasDe(g, opts).map((lt) => {
      const ls = escala(g, lt, vig);
      return { lt, ls,
        n: notaDaLeitura(ls, F, V, "n", estrito),
        p: notaDaLeitura(ls, F, V, "p", estrito),
        o: notaDaLeitura(ls, F, V, "o", estrito) };
    });
    const main = maisRigida(calc, "n");
    const res = main.n;
    r.nota = res.nota;
    r.rot = res.nota != null && res.linha ? (res.linha.x.rot || null) : null;
    r.semNumero = res.semNumero.slice();
    r.abaixoSemNumero = res.abaixoSemNumero;
    r.abaixoDe = res.abaixoDe;
    r.piso = res.piso;
    r.leitura = main.lt.origem;

    // No limite: a nota com X + δ (pessimista) e com X − δ (otimista), cada
    // uma pela leitura mais rígida. Diferiram, sai "9–10 · no limite".
    const pess = maisRigida(calc, "p").p, otim = maisRigida(calc, "o").o;
    if (chave(pess) !== chave(otim)) r.noLimite = { de: pess.nota, ate: otim.nota };
    r.compat50 = res.nota != null && usa50(res.linha, V);

    r.falta = faltas(res.prox, F, V, estrito);
    if (r.falta.length) {
      const pior = r.falta.reduce((a, b) => ((b.pts == null ? Infinity : b.pts) > (a.pts == null ? Infinity : a.pts) ? b : a));
      r.limita = { lado: pior.lado, eixo: pior.eixo };
    }

    // Folga da PSA: nota estrita N e uma G > N, G ≥ 7, com X.pior da frente ≤
    // limite(G) + 5 e o verso passando — o maior G que cumpre.
    const fg = vig.folgaFrente;
    if (fg && res.nota != null) {
      for (let i = 0; i < res.idx; i++) {
        const l = main.ls[i];
        if (!l.cand || !ehNum(l.f) || !(parseFloat(l.nota) >= fg.notaMin)) continue;
        if (F.pior <= l.f + fg.pontos + EPS && (!V || passa(l.v, V, "n", estrito))) { r.folga = l.nota; break; }
      }
    }

    if (calc.length > 1) {
      r.leituras = calc.map((c) => ({
        origem: c.lt.origem, nota: c.n.nota,
        rot: c.n.nota != null && c.n.linha ? (c.n.linha.x.rot || null) : null,
        semNumero: c.n.semNumero.slice(), abaixoSemNumero: c.n.abaixoSemNumero,
        abaixoDe: c.n.abaixoDe, piso: c.n.piso
      }));
      r.divergem = calc.some((c) => chave(c.n) !== chave(res));
    }

    const decisiva = res.linha || res.prox;
    if (V && decisiva) {
      r.verso = decisiva.vBruto === "igual" ? "igual-frente" : decisiva.v == null ? "nao-publicado" : "medido";
    }
    return r;
  }

  // tabela(code, lado, opts) → linhas da tabela "Critérios das graduadoras".
  //   [{ nota, rot, limite, obs, +limiteEfetivo, +herdaDe, +variantes,
  //      +diamante, +faixaAte, +publicado, +folga }]
  //   limite = cru (número | "qualquer" | "borda" | "igual" | null | {melhor, pior});
  //   limiteEfetivo = depois de herança e "igual" (leitura conservadora, ou a
  //   categoria de opts.categoria na CGC — padrão TCG).
  //   obs = códigos pro i18n: "aprox", "estrito", "inter", "so-nao-esporte",
  //   "nao-publicado", "herda", "lado-nao-especificado", "como-publicado", "faixa".
  //   opts = { categoria, historico: true (vigência histórica, se houver) }.
  function tabela(code, lado, opts) {
    const g = acha(code);
    if (!g) return [];
    opts = opts || {};
    const vig = vigencia(g, !!opts.historico);
    if (!vig) return [];
    const ehV = lado === "v";
    const lt = leiturasDe(g, opts.categoria === "depende" ? { categoria: "tcg" } : opts)[0];
    const ls = escala(g, lt, vig);
    const brs = brutas(vig);
    const fg = vig.folgaFrente;
    return brs.map((b, i) => {
      const l = ls[i];
      const lim = ehV ? b.v : b.f;
      const obs = [];
      if (b.x.aprox || g.aprox) obs.push("aprox");
      if (g.estrito && ehNum(lim)) obs.push("estrito");
      if (b.x.inter) obs.push("inter");
      if (b.x.so) obs.push("so-" + b.x.so);
      if (lim == null && !b.x.inter) obs.push(ehV && l.herdaDe ? "herda" : "nao-publicado");
      if (lim === "igual") obs.push("lado-nao-especificado");
      if (b.x.publicado && b.x.publicado[lado]) obs.push("como-publicado");
      if (!ehV && b.x.faixaAte) obs.push("faixa");
      const row = { nota: b.nota, rot: b.x.rot || null, limite: lim, obs };
      row.limiteEfetivo = ehV ? (l.cand || l.sombra ? l.v : null) : l.f;
      if (ehV && l.herdaDe && lim == null) row.herdaDe = l.herdaDe;
      Object.keys(g.variantes || {}).forEach((k) => {
        const o = b.x[k];
        if (o && (ehV ? "v" : "f") in o) (row.variantes = row.variantes || {})[k] = o[ehV ? "v" : "f"];
      });
      if (!ehV && b.x.diamante) row.diamante = b.x.diamante;
      if (!ehV && b.x.faixaAte) row.faixaAte = b.x.faixaAte;
      if (b.x.publicado && b.x.publicado[lado]) row.publicado = b.x.publicado[lado];
      if (!ehV && fg && ehNum(b.f) && parseFloat(b.nota) >= fg.notaMin) row.folga = fg.pontos;
      return row;
    });
  }

  // As escalas resolvidas de cada leitura (o teste de monotonia lê daqui; a
  // página pode usar pra explicar a herança). Cópia: ninguém mexe nos dados.
  function escalas(code, opts) {
    const g = acha(code);
    if (!g) return [];
    return leiturasDe(g, opts).map((lt) => ({
      origem: lt.origem,
      linhas: escala(g, lt).map((l) => ({ nota: l.nota, f: l.f, v: l.v, cand: l.cand, sombra: l.sombra, herdaDe: l.herdaDe }))
    }));
  }

  window.TCGCenteringGraders = {
    revisado: "2026-10-01",
    lista: LISTA,
    mais: MAIS,
    categoriaPorLinha: CATEGORIA_POR_LINHA,
    acha,
    avaliar,
    tabela,
    escalas,
    delta
  };
})();
