// Cápsula da carta — UMA ficha pra toda grade (2026-11-23, docs/CAPSULA.md).
//
// Antes, seis lugares montavam o texto embaixo da imagem cada um do seu jeito
// (o variantTile do shared.js, o slab e o perfil público na Coleção, a pasta,
// a venda e a graduada editável): a graduada não mostrava o código, a pasta
// mostrava a CONDIÇÃO no lugar do tipo ("Normal · NM"), a venda não mostrava
// o set, e nenhuma mostrava a raridade. E o nome vinha como a loja escreve o
// produto — "Master Gundam (LR++)", "Luffy (Alternate Art) (Manga)" —, então
// num tile de 200px o que sobrava cortado era justo o código, que é o que
// separa duas cartas de mesmo nome.
//
// Agora a ficha é uma só, com as faixas sempre na mesma ordem:
//   1. ETIQUETAS  graduação · raridade · tipo · extras   (coladas na imagem)
//   2. TÍTULO     Nome (código)
//   3. ORIGEM     bandeira · set · jogo
//   4. BASE       preço e botões, como já eram
// A página só diz o que é dela (a versão, o selo da graduadora, se a grade
// mistura jogos) e monta a base. Regras de posição e de formatação: CSS
// "Cápsula" no styles.css (classes cap-, folha própria no split-css).
//
// Mora fora do shared.js porque o núcleo está colado no teto do check-size e
// isto só interessa às sete páginas que têm grade de carta — o mesmo arranjo
// do src/ordenar.js. Quem chama shared.variantTile precisa deste arquivo
// carregado (o tests/capsula.test.mjs confere página por página).
(function () {
  const shared = window.TCGShared;
  const { t, escapeHtml, escapeAttribute } = shared;

  // ── NOME LIMPO ────────────────────────────────────────────────────────────
  // Só EXIBIÇÃO: o `name` do catálogo, a busca, o id e os endereços não mudam.
  // Do nome sai o que tem lugar próprio na ficha (o código, a raridade, o
  // acabamento que é a versão do tile) e o que diz QUAL impressão é (arte,
  // tiragem, evento), que vira etiqueta extra. Fica o que diz QUEM é a carta
  // — "(Shippuden)", "(2016)", "(Red)" — e tudo que a regra não reconhece: na
  // dúvida, não mexe. Medido no catálogo inteiro em 2026-11-23: 240 mil
  // cartas, 53 mil nomes mais curtos, nenhum vazio.
  const junta = (s) => String(s || "").toLowerCase().replace(/[\s._\-–—]+/g, "");
  const semMarca = (s) => s.replace(/[+*]+$/, "");
  const iniciais = (s) => String(s).split(/[\s_]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  // Siglas que a loja usa pra raridade que o catálogo guarda por extenso.
  const SIGLA_DA_RARIDADE = {
    specialrare: ["spr", "sp"], specialleaderrare: ["slr"], secretrare: ["scr", "sec"],
    superspecialrare: ["ssp"], triplerare: ["rrr"], doublerare: ["rr"], promo: ["p", "pr"],
    trialdeck: ["td"], collectorpromo: ["cpr"], foilpremium: ["foil"], holoportraitpremium: ["holo"]
  };
  function ehRaridade(g, rar) {
    if (!rar) return false;
    const a = junta(g), b = junta(rar);
    if (!a) return false;
    return a === b || a === iniciais(rar) || iniciais(g) === b || (SIGLA_DA_RARIDADE[b] || []).includes(a);
  }
  function ehCodigo(g, num) {
    if (!num) return false;
    const a = semMarca(junta(g)), b = semMarca(junta(num));
    if (!a) return false;
    // Código curto que é o fim do número ("(020)" em UE01BT/BLC-1-020).
    return a === b || (/^\d{2,}[a-z]?$/.test(a) && b.endsWith(a));
  }
  // Sigla de paralela que NÃO é a raridade da carta ("(SP)" numa L do One
  // Piece): é informação a mais, vira etiqueta. Sigla fora desta lista fica
  // no nome — "(EX)", "(EW)" e "(GQ)" do Gundam são a série, não a tiragem.
  const SIGLA_EXTRA = new Set(["sp", "spr", "ssp", "slr", "scr", "sec", "rrr", "rr", "csr", "cpr", "cur", "osr", "our", "aa", "pr"]);
  const ehSigla = (g) => /^[A-Z]{1,4}[+*]{0,3}$/.test(g);
  // Acabamento, tiragem e evento. Lista fechada, tirada dos sufixos que o
  // catálogo tem de verdade (os ~1.100 distintos da família TCGCSV).
  const TRATAMENTO = new RegExp("\\b(" + [
    "foil", "holo", "holofoil", "reverse", "art", "parallel", "reprint", "promo", "box topper", "textured",
    "stamp", "stamped", "signature", "signed", "serialized", "serial numbered", "hyperspace", "showcase",
    "prestige", "winner", "finalist", "champion", "championship", "top \\d+", "\\d(?:st|nd|rd|th) place", "judge",
    "pack", "tournament", "regionals?", "pre-?release", "exclusive", "anniversary", "fest", "event", "store",
    "league", "starter", "deck", "bundle", "gold", "golden", "silver", "metal", "oversized", "overnumbered",
    "manga", "misprint", "rare", "limited", "version", "edition", "collection", "bonus", "prize", "treasure",
    "marvel", "scrollwork", "expression", "loot", "wanted poster", "sleeves", "kit", "convention", "expo",
    "qualifier", "nationals", "worlds?", "revision", "border", "rainbow", "curio", "pledge", "draft"
  ].join("|") + ")\\b", "i");

  // Grupos FINAIS entre parênteses, respeitando aninhamento
  // ("(Judge Pack (Store Judge))"). Parêntese no meio do nome não é tocado.
  function gruposFinais(nome) {
    let resto = nome.trim();
    const grupos = [];
    while (resto.endsWith(")")) {
      let prof = 0, i = resto.length - 1;
      for (; i >= 0; i--) {
        if (resto[i] === ")") prof++;
        else if (resto[i] === "(" && --prof === 0) break;
      }
      if (i < 0) break;
      grupos.unshift(resto.slice(i + 1, -1).trim());
      resto = resto.slice(0, i).trim();
    }
    return { base: resto, grupos };
  }
  // Código solto no fim: "Koala - OP05-006", "Michelle PR-286EN", "Awakened
  // Feelings - SAO/S26-E083 PR". Só código com cara de código (letra + dígito,
  // 4+ caracteres) e nunca quando o nome É o código ("No. B-086", do FMA).
  function tiraCodigoSolto(base, num, rar) {
    if (!num || num.length < 4 || !/[a-z]/i.test(num) || !/\d/.test(num)) return base;
    const m = new RegExp("^(.*?)\\s*(?:[-–—]\\s*)?" + escRe(num) + "[+*]*(?:\\s+([A-Z]{1,4}))?\\s*$", "i").exec(base);
    if (!m) return base;
    if (m[2] && !ehRaridade(m[2], rar) && !SIGLA_EXTRA.has(m[2].toLowerCase())) return base;
    const resto = m[1].replace(/\s*[-–—]\s*$/, "").trim();
    return resto.length < 2 || /^(no\.?|#)$/i.test(resto) ? base : resto;
  }

  // { nome, extras }. `variant` é a versão do tile: "(Foil)" num tile Foil
  // some, porque a etiqueta de tipo já diz. No tile agrupado (várias versões)
  // passa "" e o acabamento vira extra.
  function nomeLimpo(card, variant) {
    const bruto = String((card && card.name) || "").trim();
    const num = String((card && card.number) || "").trim();
    const rar = String((card && card.rarity) || "").trim();
    const v = junta(variant);
    const semCodigo = tiraCodigoSolto(bruto, num, rar);
    const { base: semGrupos, grupos } = gruposFinais(semCodigo);
    const base = tiraCodigoSolto(semGrupos, num, rar);
    const ficam = [], extras = [];
    for (const g of grupos) {
      if (ehCodigo(g, num) || ehRaridade(g, rar)) continue;
      if (ehSigla(g)) { (SIGLA_EXTRA.has(semMarca(g.toLowerCase())) ? extras : ficam).push(g); continue; }
      // Ano sozinho é a versão do personagem (o Godzilla de 2016), não tiragem.
      if (/^\d{4}$/.test(g) || !TRATAMENTO.test(g)) { ficam.push(g); continue; }
      const n = junta(g);
      if (n === v || (n === "holo" && v === "holofoil")) continue;
      // "Hyperspace Foil" num tile Foil: sobra "Hyperspace".
      const x = variant && new RegExp("\\s+" + escRe(variant) + "$", "i").test(g) ? g.slice(0, -String(variant).length).trim() : g;
      if (!extras.some((e) => junta(e) === junta(x))) extras.push(x);
    }
    const nome = [base].concat(ficam.map((g) => `(${g})`)).join(" ").trim();
    // Nome que era SÓ sufixo fica como veio — nunca um título vazio.
    return nome ? { nome, extras } : { nome: bruto, extras: [] };
  }

  // ── CÓDIGO ────────────────────────────────────────────────────────────────
  // Como está IMPRESSO. O "/total" do cardCode só vale em número puramente
  // numérico (138/103, 009/094): "GD05-033/197" não existe em carta nenhuma, e
  // em jogo de código com prefixo o total só roubava espaço do nome. A
  // numeração corrida do Gundam Carddass segue a regra do próprio cardCode.
  function codigo(card) {
    const number = String((card && card.number) || "").trim();
    return /^\d+$/.test(number) ? shared.cardCode(card) : number;
  }
  // "Nome (código)" em texto puro: o title do título e o que a página lê.
  function titulo(card, variant) {
    const cod = codigo(card);
    const nome = nomeLimpo(card, variant).nome;
    return cod ? `${nome} (${cod})` : nome;
  }

  // ── RARIDADE E ACABAMENTO, POR JOGO (2026-11-24) ─────────────────────────
  // Cada jogo diz como a SUA raridade aparece na tela, e o catálogo continua
  // gravando o que a fonte escreve (id, preço, busca e export não mudam).
  // Dois casos, a pedido do Fernando:
  //   NOMES: o jogo que escreve a raridade em sigla e tem nome por extenso pra
  //   ela. O Naruto japonês (o Card Game de 2002 e o Data Carddass) grava
  //   N/R/SR/UR/P, como o tcg-db e o Suruga-ya — na tela, Normal, Rare… Ficam
  //   em sigla as que não têm nome seguro (NR, NP, WNR, HR do Formation/Cross)
  //   e todo jogo que usa sigla de verdade no próprio sistema (One Piece,
  //   Vanguard, Kayou…).
  //   ACABAMENTO: o Carddass que grava o BRILHO da carta (ノーマル/キラ) no
  //   campo de raridade. "Normal" e "Prism" no filtro de raridade era misturar
  //   acabamento com raridade; agora esses valores são o TIPO da carta (a
  //   etiqueta do tile, o filtro de Acabamento) e saem da raridade. Lista
  //   fechada por jogo, a mesma escada que o detail.js usava pra ordenar.
  //   Valor fora dela (a Promo da HxH, a jumbo Special do Saint Seiya) segue
  //   raridade.
  const NOMES_DA_RARIDADE = {
    naruto: { N: "Normal", R: "Rare", SR: "Super Rare", UR: "Ultra Rare", P: "Promo" }
  };
  const ACABAMENTO_NA_RARIDADE = {
    dbc: ["Normal", "Prism", "Double Prism", "Reverse Prism", "Gold"],
    dbsb: ["Normal", "Prism", "Hidden Prism", "Double Prism", "Metal Hidden Prism"],
    dbva: ["Normal", "Prism", "Laser"],
    dbbw: ["Normal", "Prism"],
    gcd: ["Normal", "Prism", "Prism Pixel", "Double Prism"],
    seiya: ["Normal", "Prism"],
    seiyatc: ["Normal", "Holographic"],
    hxh: ["Normal", "Holo", "Secret Holo"],
    // O Carddass Hyper Battle e o Card Game 2002 dentro do One Piece; o resto
    // do jogo tem Normal/Foil na versão, como todo TCG moderno.
    onepiece: ["Normal", "Holo", "Gold Stamp"],
    // As promos prateadas do Narutimate Formation.
    naruto: ["Silver Holo"]
  };
  const jogoDa = (card) => (card && card.game) || (window.SLEEVU && window.SLEEVU.game) || "";
  const acabamentosDo = (card) => ACABAMENTO_NA_RARIDADE[jogoDa(card)] || [];

  // A raridade da carta com o nome do jogo dela: a CHAVE dos filtros, crua e
  // igual nos três idiomas (dá pra ir no endereço). "" = sem raridade — vazio,
  // "None", "-" e o acabamento gravado como raridade.
  function nomeRaridade(card) {
    const s = String((card && card.rarity) || "").trim();
    if (!s || /^(none|-|n\/a)$/i.test(s) || acabamentosDo(card).includes(s)) return "";
    return (NOMES_DA_RARIDADE[jogoDa(card)] || {})[s] || s;
  }

  // O acabamento que a carta grava como raridade ("Prism"), na versão padrão
  // dela — a única que esses jogos têm. "" no resto: lá o acabamento é a
  // própria versão (Normal, Foil, Holofoil…). O shared.variantDisplayLabel
  // consulta isto, então a etiqueta do tile, o popup e o filtro dizem o mesmo.
  function acabamentoDaRaridade(card, variant) {
    const s = String((card && card.rarity) || "").trim();
    return s && acabamentosDo(card).includes(s) && variant === shared.defaultVariant(card) ? s : "";
  }

  // ── RARIDADE ──────────────────────────────────────────────────────────────
  // Por extenso, como o catálogo traz, só com a caixa acertada: "Super_rare"
  // → "Super Rare", "Special illustration rare" → "Special Illustration Rare".
  // Sigla fica como é. "None", "-" e vazio não viram etiqueta. As do Magic
  // (common, mythic…) têm rótulo traduzido, o mesmo do filtro.
  // rotuloRaridade(valor) é o rótulo de uma chave do nomeRaridade — o que o
  // <option> do filtro mostra.
  function raridade(card) {
    return rotuloRaridade(nomeRaridade(card));
  }
  function rotuloRaridade(valor) {
    let s = String(valor || "").trim();
    if (!s) return "";
    const chave = `mtg.rarity.${s}`;
    const traduzida = t(chave);
    if (traduzida !== chave) return traduzida;
    s = s.replace(/_/g, " ");
    if (/[a-zà-ú]{3,}/.test(s)) s = s.replace(/(^|[\s-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
    return s;
  }
  // Faixa de COR da raridade: 1 comum (cinza), 2 incomum (verde), 3 rara
  // (azul), 4 as de brilho (roxo), 5 o topo (dourado). Sai da escada que já
  // ordena as grades (shared.rarityRank), pra cor e ordenação não discordarem.
  // "d" = raridade que a escada não conhece: fica no cinza em vez de chutar
  // uma cor — a escada é por jogo e ainda tem furo (em 2026-11-23, 13% das
  // cartas com raridade; Sorcery, Vanguard e Naruto Kayou puxam o número).
  // As paralelas marcadas com + ou * (Gundam C+/LR++, Union Arena SR**) sobem
  // um degrau por marca a partir da base.
  function faixa(rarity) {
    let s = String(rarity || "").trim();
    const marcas = (/[+*]+$/.exec(s) || [""])[0].length;
    if (marcas) s = s.slice(0, -marcas);
    const k = shared.rarityRank(s);
    if (!k) return 0;
    if (k === 5) return "d";
    const n = k + marcas * 5;
    return n >= 60 ? 5 : n >= 40 ? 4 : n >= 30 ? 3 : n >= 20 ? 2 : 1;
  }

  // ── FILTROS DE RARIDADE E DE ACABAMENTO ───────────────────────────────────
  // As grades (Cartas, set, Coleção, Desejos, Explorar) montam os dois
  // <select> daqui, pra opção, rótulo e casamento serem a mesma régua em
  // todas. A raridade filtra pela CHAVE (nomeRaridade): no Naruto, "R" do
  // Card Game e "Rare" do CCG americano viram uma opção só.
  function opcoesRaridade(cards) {
    return shared.sortRarities([...new Set(cards.map(nomeRaridade).filter(Boolean))]);
  }
  // O ACABAMENTO do tile é o rótulo da versão (Normal, Foil, Holofoil,
  // Diamond Foil, a Surge Foil do Magic, a Prism do Carddass) — o mesmo
  // texto da etiqueta de tipo. Opções a partir de PARES carta×versão: no
  // catálogo, todas as versões da carta; na Coleção, só as que a pessoa tem.
  // Ordem: Normal primeiro, a escada do jogo (página de um jogo só), o resto
  // em ordem alfabética.
  function opcoesAcabamento(pares, jogo) {
    const escada = ACABAMENTO_NA_RARIDADE[jogo] || [];
    const pos = (v) => (v === "Normal" ? -1 : escada.includes(v) ? escada.indexOf(v) : escada.length);
    return [...new Set(pares.map((p) => shared.variantDisplayLabel(p.card, p.variant)))]
      .sort((a, b) => (pos(a) - pos(b)) || a.localeCompare(b));
  }
  // Tile agrupado (uma carta = um tile) passa se QUALQUER versão dela casa.
  function casaAcabamento(card, variant, alvo, agrupado) {
    if (!alvo) return true;
    return (agrupado ? shared.cardVariants(card) : [variant]).some((v) => shared.variantDisplayLabel(card, v) === alvo);
  }

  // ── SET ───────────────────────────────────────────────────────────────────
  // O nome do set, clicável: leva pra página do set com o MESMO detailUrl do
  // modal da carta (o setId desambigua sets homônimos EN/PT). Na página do
  // próprio set o link levaria pra onde a pessoa já está: lá a página passa
  // o.setAtual (o nome do set aberto) e o nome fica texto. Veio do shared.js
  // (tileSetLink, 2026-11-01); a linha compacta usa o mesmo.
  function setLink(card, o) {
    if (!card || !card.set) return "";
    const nome = escapeHtml(card.set);
    if (o && o.setAtual === card.set) return `<span class="cap-set" title="${nome}">${nome}</span>`;
    const href = shared.detailUrl("set", card.set, "", card.game || (window.SLEEVU && window.SLEEVU.game) || "pokemon", { setId: card.setId });
    return `<a class="cap-set tile-set-link" href="${escapeAttribute(href)}" title="${nome}">${nome}</a>`;
  }

  // A cor da etiqueta de tipo vem da versão gravada (variant-foil…); acabamento
  // com brilho que não é uma dessas (Prism, Diamond Foil, Rainbow Foil…) ganha
  // o is-brilho, a mesma cor das foil.
  function classeDaVersao(v, rotulo) {
    const slug = shared.normalize(v).replace(/\s+/g, "-");
    const brilho = !/^(foil|holo|holofoil)$/.test(slug) && /foil|holo|prism|laser|gold|stamp/i.test(rotulo || "");
    return "variant-" + slug + (brilho ? " is-brilho" : "");
  }

  // ── A FICHA ───────────────────────────────────────────────────────────────
  // Devolve as três faixas de cima (etiquetas, título, origem). `card` pode
  // ser um objeto no formato do catálogo ou o que a página tiver à mão com os
  // mesmos campos (name, number, setTotal, set, setId, rarity, language, game).
  // o = {
  //   variant   versão do tile: decide o que sai do nome e a cor do tipo
  //   tipo      HTML pronto do tipo, quando não é só o rótulo da versão: os
  //             .tile-vn do variantTile (acende a que você tem), "Normal ×2"
  //             do perfil público
  //   grupo     tile agrupado: texto com todas as versões ("Normal · Foil"),
  //             que vira o title. O tipo passa a poder encolher.
  //   graded    { company, grade, pristine }: selo da graduadora, 1ª etiqueta
  //   jogo      true = etiqueta do jogo (só em grade que mistura jogos)
  //   setAtual  nome do set da página (lá o set é texto, não link)
  // }
  function ficha(card, o) {
    o = o || {};
    const variant = o.variant || shared.defaultVariant(card);
    const limpo = nomeLimpo(card, o.grupo ? "" : variant);
    const cod = codigo(card);
    const rar = raridade(card);
    const completo = cod ? `${limpo.nome} (${cod})` : limpo.nome;
    const etqs = [];
    if (o.graded) etqs.push(shared.gradedBadgeHtml(o.graded));
    if (rar) etqs.push(`<span class="cap-etq cap-rar" data-faixa="${faixa(card.rarity)}" title="${escapeAttribute(rar)}">${escapeHtml(rar)}</span>`);
    etqs.push(`<span class="cap-etq cap-tipo ${o.grupo ? "is-grupo" : classeDaVersao(variant, shared.variantDisplayLabel(card, variant))}"${o.grupo ? ` title="${escapeAttribute(o.grupo)}"` : ""}>${o.tipo || escapeHtml(shared.variantDisplayLabel(card, variant))}</span>`);
    if (limpo.extras.length) {
      etqs.push(`<span class="cap-extras">${limpo.extras.map((x) => `<span class="cap-etq cap-extra" title="${escapeAttribute(x)}">${escapeHtml(x)}</span>`).join("")}</span>`);
    }
    return `<p class="cap-etqs">${etqs.join("")}</p>`
      // O espaço entre nome e código é pro texto copiado e pro leitor de
      // tela ("Nome (código)"); no layout, quem separa é o gap do flex.
      + `<h3 class="cap-titulo" title="${escapeAttribute(completo)}"><span class="cap-nome">${escapeHtml(limpo.nome)}</span>${cod ? ` <span class="cap-cod">(${escapeHtml(cod)})</span>` : ""}</h3>`
      + `<p class="cap-origem">${"language" in card ? shared.cardFlag(card.language) : ""}${setLink(card, o)}${o.jogo && card.game ? shared.gameTagHtml(card.game, "tile-game") : ""}</p>`;
  }

  // A BASE: preço em cima, botões embaixo — o que já existia —, separada da
  // ficha por um fio e colada no fundo do tile. Carta sem preço guarda a
  // linha, pros botões e o fio dos vizinhos baterem. Sem preço E sem botão
  // (slab sem valor) não há base.
  function base(preco, acoes) {
    if (!preco && !acoes) return "";
    return `<div class="cap-base">${preco || '<p class="tile-price"></p>'}${acoes ? `<div class="tile-foot">${acoes}</div>` : ""}</div>`;
  }

  // O código do tile JÁ na tela, depois que a carta ganha o total do set (as
  // da borda chegam sem ele): "(063)" vira "(063/165)" sem redesenhar a grade.
  function atualizaCodigo(tile, card) {
    const cod = tile.querySelector(".cap-cod");
    if (!cod) return;
    cod.textContent = `(${codigo(card)})`;
    cod.parentNode.title = `${cod.parentNode.firstChild.textContent} ${cod.textContent}`;
  }

  window.TCGCapsula = {
    nomeLimpo, codigo, titulo, raridade, faixa, setLink, ficha, base, atualizaCodigo,
    nomeRaridade, rotuloRaridade, acabamentoDaRaridade, opcoesRaridade, opcoesAcabamento, casaAcabamento
  };
})();
