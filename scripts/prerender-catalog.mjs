// Pré-renderização de SEO do catálogo (páginas de set de TODOS os jogos).
//
// O app é uma SPA/MPA: /sets e detail.html montam tudo no cliente, então o
// Googlebot vê uma casca vazia e não indexa "Base Set", "OP-01" etc. Este script
// gera, no build (CI, depois dos syncs), UMA página HTML ESTÁTICA por set
// em /games/<jogo>/<set>.html — com <title>, meta description, Open Graph, JSON-LD e a
// lista de cartas (nome, número, imagem) já no HTML. É a "porta do Google": a
// pessoa cai numa página real e legível e clica pra abrir o app interativo
// (detail.html?game=<slug>, que grava a sessão do jogo). Também (re)gera o
// sitemap.xml com todas essas URLs, a página /games (todos os jogos), a casca
// da página de carta (montada na borda, ver functions/games/) e os mapas que a
// borda lê (data/game-pages/).
//
// Fontes de dados:
//   pokemon  -> chunks por set gerados pelo sync: data/sets/<lang>/<id>.json
//   lorcana  -> data/lorcana/cards.js  (window.TCG_CARDS)
//   onepiece -> data/onepiece/cards.js (window.TCG_CARDS, inclui os vintage)
//
// Roda com: node scripts/prerender-catalog.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readGlobalVar, slug as slugDoChunk, winSafeName } from "./lib/sync-common.mjs";
// Código IMPRESSO da carta ("009/094", "4/102"), a mesma régua do cardCode do
// site. É o que vai pro <title>/description/JSON-LD: quem procura no Google
// digita "nome + código impresso", e o número cru do catálogo ("9") não casa.
import { cardCode } from "./lib/card-code.mjs";
// Todo JSON-LD daqui passa por este helper, nunca pelo JSON.stringify cru: um
// nome de deck com "</script>" fechava o bloco e injetava HTML no <head> (ver
// o porquê em scripts/lib/json-ld.mjs; tests/json-ld.test.mjs confere).
import { jsonLdSeguro } from "./lib/json-ld.mjs";
import { montaSitemaps } from "./lib/sitemap.mjs";
// Endereço de cada jogo (/games/<url>) e o nome de cada carta no endereço:
// moram em functions/_lib porque a borda usa a mesma régua (ver lá).
import { JOGOS_URL, jogoDaUrl, urlDoSet } from "../functions/_lib/jogos.js";
import { slugify, slugsDasCartas } from "../functions/_lib/slug-carta.js";
// Cabeçalho das páginas estáticas (marcação + CSS do celular).
import { ESTILO_DO_CABECALHO, cabecalhoEstatico } from "../functions/_lib/cabecalho-estatico.js";
// Textos e réguas da página de set (título, data, uma carta por número): a
// página pt é a tela do app decorada NA BORDA (functions/games/) e a -en sai
// daqui, então os dois lados leem o mesmo módulo.
import { SET_L10N, cardsForLang, cmpNumber } from "../functions/_lib/pagina-set.js";

const ORIGIN = "https://sleevu.app";
const SETS_DIR = "data/sets";
// Páginas de set em /games/<jogo>/<set> desde 2026-09-30 (antes, /set/<slug>,
// um diretório só pra todos os jogos). O endereço antigo responde 301
// (functions/set/[slug].js, com o mapa legado-sets.json daqui).
const GAMES_DIR = "games";
// Mapas que a borda lê (functions/games/, functions/set/, functions/card/).
const MAPAS_DIR = join("data", "game-pages");

// Jogos prerenderizados, na ordem (a ordem fixa mantém os slugs estáveis entre
// builds quando dois sets de jogos diferentes têm o mesmo nome).
// TODOS os jogos com catálogo entram. O app (detail.html) é `noindex` de
// propósito — quem indexa é a página estática daqui, com o conteúdo já no HTML.
// Só que ela existia para 5 jogos: pra Magic, YGO, Digimon, FAB, Gundam, DBFW,
// Riftbound e Union Arena o catálogo inteiro do site era invisível pro Google,
// justamente os jogos onde "lista de cartas do set X" é a busca mais comum.
// O loadGameSets é genérico (lê data/<slug>/cards.js), então cada linha aqui é
// literalmente o jogo ganhando SEO.
const GAMES = [
  { slug: "pokemon", label: "Pokémon TCG" },
  { slug: "magic", label: "Magic: The Gathering" },
  { slug: "lorcana", label: "Disney Lorcana" },
  { slug: "onepiece", label: "One Piece Card Game" },
  { slug: "ygo", label: "Yu-Gi-Oh!" },
  { slug: "digimon", label: "Digimon Card Game" },
  { slug: "fab", label: "Flesh and Blood" },
  { slug: "unionarena", label: "Union Arena" },
  { slug: "dbfw", label: "Dragon Ball Fusion World" },
  { slug: "gundam", label: "Gundam Card Game" },
  { slug: "swu", label: "Star Wars: Unlimited" },
  { slug: "cyberpunk", label: "Cyberpunk TCG" },
  { slug: "sorcery", label: "Sorcery: Contested Realm" },
  { slug: "riftbound", label: "Riftbound" },
  { slug: "naruto", label: "Naruto Card Game (2002~2006)" },
  { slug: "hxh", label: "Hunter × Hunter Carddass" },
  { slug: "dbc", label: "Dragon Ball Carddass" },
  { slug: "wow", label: "World of Warcraft TCG" },
  { slug: "lotr", label: "The Lord of the Rings TCG" },
  { slug: "harrypotter", label: "Harry Potter Trading Card Game" },
  { slug: "weiss", label: "Weiß Schwarz" },
  { slug: "mbc", label: "Miracle Battle Carddass" }
];

// SEM piso de cartas por set, de propósito. Um piso (mesmo baixo, tipo 3)
// tiraria a página de ~20 sets promo do Pokémon e do One Piece que já estão no
// ar há meses — URL indexada que some vira 404, e isso custa mais do que
// ganharia evitando página fina. Set de 2 cartas é conteúdo legítimo pra quem
// procura por ele pelo nome.

// A CSP vem do header em _headers (política única do site inteiro) — estas
// páginas não levam <meta> de CSP, como as demais.

// Páginas estáticas do site (base do sitemap), extensionless como o CF Pages serve.
// Só páginas PÚBLICAS e indexáveis. As telas pessoais (dashboard, collection,
// wishlist, portfolio, binders, sales, graded, my-decks…) saíram: todas exigem
// sessão e redirecionam pro login, então o buscador indexava um redirecionamento
// — página fina, zero valor de busca. Elas agora estão no Disallow do
// robots.txt, e sitemap × robots precisam concordar: anunciar no sitemap uma URL
// bloqueada no robots vira erro no Search Console.
// /decks é a galeria PÚBLICA da comunidade e fica.
// /games (todos os jogos) entrou no lugar de /sets em 2026-09-30: a tela de Sets
// sem jogo abre no jogo da sessão e leva noindex (functions/sets.js); cada
// jogo tem a sua, em /games/<jogo> (sitemap-games.xml).
const STATIC_URLS = [
  "/", "/hub", "/explore", "/search", "/cards", "/pokedex", "/lore", "/games", "/artists", "/trainers",
  "/decks", "/blog",
  // Ferramentas (2026-10-01): o índice e o Guia de condição, que são públicos.
  // Sleeves e Troca exigem login e ficam de fora, como as telas pessoais.
  "/ferramentas", "/condicao",
  "/about", "/novidades", "/lancamentos", "/comparar", "/faq", "/help", "/privacy", "/terms"
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
// Imagens/logos podem ser URL absoluta (CDNs) ou caminho relativo à raiz do site
// (ex.: data/onepiece/set-logos/x.png). A página vive em /games/<jogo>/, então
// caminho relativo precisa virar absoluto pra não resolver dentro dela.
function absUrl(u) {
  const s = String(u || "");
  if (!s) return s;
  // ABSOLUTA de verdade (com origem), não só root-relative: og:image e o campo
  // `image` do JSON-LD são IGNORADOS pelos crawlers quando relativos — a prévia
  // de compartilhamento (WhatsApp/Facebook/Slack) sumia em ~685 páginas e o
  // Product perdia o rich result. Em <img src> a URL absoluta funciona igual.
  return /^https?:\/\//.test(s) ? s : `${ORIGIN}/` + s.replace(/^\/+/, "");
}
// Miniatura da GRADE. O catálogo guarda a URL do scan grande — no Pokémon é o
// `high.png`, que tem 288 KB por carta. Numa página de set com 200 cartas isso
// é ~57 MB pra desenhar quadradinhos. A carta em tamanho grande continua no
// high.png — quem abre a página da CARTA (prc-img) recebe o scan bom.
// Só a TCGdex expõe esse esquema de qualidade no caminho; as outras fontes
// (TCGplayer, Scryfall, Lorcast) passam direto, sem alteração.
//
// São DUAS variantes, num srcset, porque uma só não serve as duas telas:
// low.webp tem 245x337 (14 KB) e high.webp tem 600x825 (48 KB). No desktop a
// coluna da grade tem ~150-245 px em tela 1x, e o low é exatamente do tamanho;
// no celular a coluna fica em ~150 px mas com DPR 3, então o low apareceria
// esticado (foi o que a medição em produção mostrou: 3,8x de escala, borrado).
// Com o srcset quem escolhe é o navegador, pela largura real e pela densidade.
const QUALIDADE_RE = /(?:\/(?:low|high))?\.(?:png|webp|jpg)$/;
const daTcgdex = (u) => String(u || "").includes("assets.tcgdex.net");
function thumbUrl(u) {
  const s = String(u || "");
  return daTcgdex(s) ? s.replace(QUALIDADE_RE, "/low.webp") : s;
}
// srcset/sizes do thumb. Fora da TCGdex devolve vazio (a fonte não tem
// variantes) e o <img> fica só com o src, como antes.
function thumbSrcset(u) {
  const s = String(u || "");
  if (!daTcgdex(s)) return "";
  const low = s.replace(QUALIDADE_RE, "/low.webp");
  const high = s.replace(QUALIDADE_RE, "/high.webp");
  return `${escapeAttr(low)} 245w, ${escapeAttr(high)} 600w`;
}
// De qual chunk (data/…/<set>.json) veio cada carta. A página da carta é
// montada na borda a partir dos MESMOS chunks que o app baixa, e o mapa de
// cada jogo (data/game-pages/<jogo>.json) diz quais chunks formam cada página
// de set. WeakMap e não um campo na carta: a carta segue igual pro resto do
// script (artistas, ranking).
const ARQUIVO_DA_CARTA = new WeakMap();

// Pokémon: lê todos os chunks data/sets/<lang>/<id>.json e agrupa as cartas por
// NOME de set (exatamente como o app: cards.filter(c => c.set === nome)).
function loadPokemonSets() {
  const byName = new Map();
  if (!existsSync(SETS_DIR)) return byName;
  for (const lang of readdirSync(SETS_DIR)) {
    const dir = join(SETS_DIR, lang);
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
    for (const file of files) {
      let cards;
      try { cards = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { continue; }
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        const name = card.set;
        if (!name) continue;
        if (card.retired) continue; // chunk congelado de set aposentado: não entra na página do set
        ARQUIVO_DA_CARTA.set(card, `${SETS_DIR}/${lang}/${file}`);
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(card);
      }
    }
  }
  return byName;
}

// Onde mora o chunk de cada set de um jogo: o `file` do manifest do jogo (o
// nome do chunk leva sufixo quando dois setIds dão o mesmo nome de arquivo, então
// não dá pra deduzir do setId). O manifest só existe no build; sem ele (rodando
// local) o nome é deduzido sem o sufixo, o que basta pra testar.
async function arquivosDosSets(game) {
  const manifest = await readGlobalVar(new URL(`../data/${game}/manifest.generated.js`, import.meta.url), "TCG_MANIFEST");
  const porSet = new Map();
  for (const e of (manifest && Array.isArray(manifest.sets) ? manifest.sets : [])) {
    if (e && e.id != null && e.file) porSet.set(String(e.id), e.file);
  }
  return (chave) => porSet.get(chave) || `data/${game}/sets/${winSafeName(slugDoChunk(chave) || "set")}.json`;
}

// Demais jogos: catálogo inteiro num cards.js (window.TCG_CARDS). Carta
// aposentada fica de fora, como no Pokémon: é a mesma régua que a borda usa
// pra reconstruir a página do set (functions/_lib/slug-carta.js).
async function loadGameSets(slug) {
  const byName = new Map();
  const cards = await readGlobalVar(new URL(`../data/${slug}/cards.js`, import.meta.url), "TCG_CARDS");
  if (!Array.isArray(cards)) return byName;
  const arquivoDo = await arquivosDosSets(slug);
  for (const card of cards) {
    const name = card.set;
    if (!name) continue;
    if (card.retired) continue;
    // Mesma chave do chunk do writeGameCatalog (sync-common): setId, senão o nome.
    ARQUIVO_DA_CARTA.set(card, arquivoDo(String(card.setId || card.set || "sem-set")));
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(card);
  }
  return byName;
}

// CSS das páginas pré-renderizadas. Inline de propósito: são páginas de
// ENTRADA (a pessoa chega do Google), e um request bloqueante a mais antes do
// primeiro paint custa mais que os 2 KB daqui. Compartilhado entre a página de
// set e a de artista — separadas, elas divergiriam no primeiro ajuste. O
// cabeçalho do celular vem de functions/_lib/cabecalho-estatico.js, pela mesma
// razão.
const PR_STYLE = `    <style>
${ESTILO_DO_CABECALHO}
      .pr-wrap { max-width: 1100px; margin: 0 auto; padding: 0 20px 48px; }
      .pr-hero { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin: 24px 0 8px; }
      .pr-hero-logo { max-height: 96px; max-width: 260px; width: auto; height: auto; }
      .pr-hero-name { font-size: 1.6rem; }
      .pr-hero h1 { margin: 0 0 4px; font-size: 1.7rem; }
      .pr-sub { color: var(--muted, #9aa0aa); margin: 0; }
      /* 44px de alvo de toque no celular (era 40: 10px de padding + a linha). */
      .pr-cta { display: inline-flex; align-items: center; min-height: 44px; box-sizing: border-box; margin: 14px 0 4px; padding: 10px 18px; border-radius: 10px; background: var(--accent, #e63946); color: var(--on-accent, #fff); font-weight: 600; text-decoration: none; }
      /* minmax de 120px, não 150 nem 130. O 130 foi calculado pra 390px, mas a
         medição em 360px (iPhone SE, Galaxy A) mostrou a grade com 265px úteis:
         130+16+130 = 276 estourava por ONZE pixels e a página caía pra UMA
         carta por linha, gigante e esticada — o mesmo defeito que o 130 tinha
         vindo consertar, uma faixa de tela abaixo. Com 120 cabem duas em 265px,
         e no desktop o número de colunas não muda. */
      .pr-grid { list-style: none; padding: 0; margin: 24px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
      /* Mesma razão do .card-tile no styles.css: são 200+ cartas numa página só
         e o navegador não precisa diagramar as que estão fora da tela. Aqui o
         palpite de altura é firme (a imagem é 245x342 numa coluna de ~150px,
         mais a linha do nome), então a rolagem não estica nem encolhe. */
      .pr-card { content-visibility: auto; contain-intrinsic-size: auto 240px; }
      .pr-card a { text-decoration: none; color: inherit; display: block; }
      /* Fundo de quem ainda está carregando: --panel, como o .prc-img da página
         de carta. Era --surface-2, que não existe no styles.css — valia sempre o
         fallback escuro, e no tema claro a grade virava uma parede de quadrados
         pretos até as imagens chegarem. Ninguém via porque o theme.js dava 404
         em produção e estas páginas nunca saíam do escuro (29/09/2026). */
      .pr-card-img { width: 100%; height: auto; border-radius: 8px; display: block; background: var(--panel, #1a1c22); }
      .pr-card-noimg { display: block; padding: 20px 8px; text-align: center; }
      .pr-card-meta { display: block; margin-top: 6px; font-size: 0.85rem; }
      .pr-card-num { color: var(--muted, #9aa0aa); }
      /* Trilha Jogos > jogo > set (páginas de set, desde 2026-09-30). */
      .pr-trilha { margin-top: 18px; font-size: 13px; color: var(--muted, #9aa0aa); }
      .pr-trilha a { color: var(--muted, #9aa0aa); text-decoration: none; }
      .pr-trilha a:hover { text-decoration: underline; }
      .pr-others { margin-top: 40px; }
      .pr-others ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .pr-others a { color: var(--accent, #e63946); text-decoration: none; }
      /* Página de ARTISTA: só o que ela tem além da de set. */
      .pr-more { margin: 20px 0 0; color: var(--muted, #9aa0aa); }
      .pr-more a { color: var(--accent, #e63946); }
      .pr-hero-meta { color: var(--muted, #9aa0aa); margin: 0; }
    </style>`;

function setPageHtml(page, canonical, otherSets, lang) {
  const L = SET_L10N[lang] || SET_L10N.pt;
  const isEn = L === SET_L10N.en;
  const { name, rep, game, gameLabel } = page;
  // A LISTA da página é uma carta por número, na língua desta variante (ver
  // cardsForLang). O page.cards cru segue intacto pro resto do script — o
  // ranking de cartas top precisa de cada impressão, que tem página própria.
  const cards = cardsForLang(page.cards, isEn ? "en" : "pt");
  const total = rep.setTotal || cards.length;
  const dateHuman = L.fmtDate(rep.setReleaseDate);
  const title = L.title(name, gameLabel);
  const desc = L.desc(cards.length, name, gameLabel, dateHuman);
  const ogImage = absUrl(rep.setLogo) || `${ORIGIN}/og-image.png`;
  const baseDoJogo = `/games/${page.url}`;
  const baseDoSet = `${baseDoJogo}/${page.slug}`;
  // hreflang: cada variante aponta pra si e pra irmã; pt é o x-default.
  const altPt = `${ORIGIN}${baseDoSet}`;
  const altEn = `${ORIGIN}${baseDoSet}-en`;
  // Cada miniatura leva pra página da CARTA (montada na borda, uma pra cada
  // carta do catálogo). Antes todas iam pro mesmo link do app, e o Google não
  // tinha caminho do set pras cartas.
  const urlDaCarta = (c) => `${baseDoSet}/${page.slugsCartas.get(String(c.id))}`;
  const hreflangs = `
    <link rel="alternate" hreflang="pt-BR" href="${escapeAttr(altPt)}">
    <link rel="alternate" hreflang="en" href="${escapeAttr(altEn)}">
    <link rel="alternate" hreflang="x-default" href="${escapeAttr(altPt)}">`;
  // O botão leva pra tela do set no app, que mora no endereço pt do set desde
  // 2026-10-01 (o jogo e o set saem do próprio endereço).
  const appUrl = baseDoSet;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${name} — ${gameLabel}`,
    url: canonical,
    description: desc,
    isPartOf: { "@type": "WebSite", "@id": ORIGIN + "/#website", name: "Sleevu", url: ORIGIN + "/" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${c.name}${c.number ? ` ${cardCode({ number: c.number, setTotal: c.setTotal || total })}` : ""}`,
        url: `${ORIGIN}${urlDaCarta(c)}`,
        image: absUrl(c.image) || undefined
      }))
    }
  };
  // Trilha Jogos > jogo > set: o Google troca a URL crua do resultado por ela.
  const trilha = [
    { nome: isEn ? "Games" : "Jogos", url: `${ORIGIN}/games` },
    { nome: gameLabel, url: `${ORIGIN}${baseDoJogo}` },
    { nome: name, url: canonical }
  ];
  const trilhaLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trilha.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.nome, item: t.url }))
  };

  // As primeiras cartas são as que aparecem sem rolar — e uma delas costuma ser
  // o LCP desta página. `lazy` nelas atrasa a descoberta pro fim do parse do
  // HTML (medido: 244 ms de load delay no LCP em 4G); daqui pra frente elas
  // nascem `eager`, e a primeira ainda pede prioridade alta. O resto da grade
  // segue lazy — são 200+ imagens que ninguém vê de imediato.
  const ACIMA_DA_DOBRA = 6;
  const cardsHtml = cards.map((c, i) => {
    // Rótulo visível com o código IMPRESSO ("009/094"), não "#009": é o texto
    // que a busca do Google casa quando a carta não tem página própria (só as
    // 1.500 mais valiosas têm) — a página do set é onde "Nymble 009/094" existe.
    const code = c.number ? cardCode({ number: c.number, setTotal: c.setTotal || total }) : "";
    const num = code ? escapeHtml(code) : "";
    const alt = `${c.name}${code ? ` ${code}` : ""} — ${name}`;
    const prioridade = i < ACIMA_DA_DOBRA
      ? ` loading="eager"${i === 0 ? ' fetchpriority="high"' : ""}`
      : ` loading="lazy"`;
    // sizes casa com a grade (ver .pr-grid no CSS): uma coluna de ~50vw no
    // celular, ~150px de largura fixa a partir do tablet.
    const srcset = thumbSrcset(c.image);
    const srcsetAttr = srcset ? ` srcset="${srcset}" sizes="(max-width: 640px) 50vw, 150px"` : "";
    const img = c.image
      ? `<img class="pr-card-img" src="${escapeAttr(absUrl(thumbUrl(c.image)))}"${srcsetAttr} alt="${escapeAttr(alt)}"${prioridade} decoding="async" width="245" height="342">`
      : `<span class="pr-card-noimg">${escapeHtml(c.name)}</span>`;
    return `<li class="pr-card"><a href="${escapeAttr(urlDaCarta(c))}">${img}<span class="pr-card-meta"><span class="pr-card-num">${num}</span> <span class="pr-card-name">${escapeHtml(c.name)}</span></span></a></li>`;
  }).join("");

  const enSuffix = isEn ? "-en" : "";
  const othersHtml = otherSets.length
    ? `<nav class="pr-others" aria-label="${escapeAttr(L.othersAria)}"><h2>${escapeHtml(L.others(gameLabel))}</h2><ul>${otherSets.map((s) => `<li><a href="${baseDoJogo}/${escapeAttr(s.slug)}${enSuffix}">${escapeHtml(s.name)}</a></li>`).join("")}</ul></nav>`
    : "";

  const logoHtml = rep.setLogo
    ? `<img class="pr-hero-logo" src="${escapeAttr(absUrl(rep.setLogo))}" alt="${escapeAttr(name)}" loading="eager">`
    : `<strong class="pr-hero-name">${escapeHtml(name)}</strong>`;

  const cabecalho = cabecalhoEstatico([
    [baseDoJogo, "Sets"],
    game === "pokemon" ? ["/pokedex", "Pokédex"] : null,
    ["/collection", L.navCollection]
  ].filter(Boolean), L.navAria);
  const trilhaHtml = `<nav class="pr-trilha" aria-label="${escapeAttr(isEn ? "Breadcrumb" : "Trilha de navegação")}">${trilha.slice(0, -1)
    .map((t) => `<a href="${escapeAttr(t.url.replace(ORIGIN, ""))}">${escapeHtml(t.nome)}</a> <span aria-hidden="true">›</span> `).join("")}<span aria-current="page">${escapeHtml(name)}</span></nav>`;

  // data-idioma-fixo (também nas páginas de carta e de artista): nada traduz
  // este texto no cliente, então o theme.js deixa o <html lang> como está em
  // vez de trocá-lo pelo idioma do navegador. Sem isso, a página em português
  // anunciava "en" pro Googlebot (ver o theme.js).
  return `<!doctype html>
<html lang="${L.htmlLang}" data-idioma-fixo>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">${hreflangs}
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`${name} — ${gameLabel}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <meta property="og:image" content="${escapeAttr(ogImage)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(`${name} — ${gameLabel}`)}">
    <meta name="twitter:description" content="${escapeAttr(desc)}">
    <meta name="twitter:image" content="${escapeAttr(ogImage)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="preconnect" href="https://assets.tcgdex.net">
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="theme-color" content="#e8ecf1" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#101218" media="(prefers-color-scheme: dark)">
    <script type="application/ld+json">${jsonLdSeguro(jsonLd)}</script>
    <script type="application/ld+json">${jsonLdSeguro(trilhaLd)}</script>
    <script src="/src/theme.js"></script>
    <link rel="stylesheet" href="/styles.css">
${PR_STYLE}
  </head>
  <body>
    ${cabecalho}
    <main class="pr-wrap">
      ${trilhaHtml}
      <div class="pr-hero">
        <div class="pr-hero-art">${logoHtml}</div>
        <div>
          <h1>${escapeHtml(name)}</h1>
          <p class="pr-sub">${escapeHtml(L.sub(gameLabel, total, dateHuman, cards.length))}</p>
          <a class="pr-cta" href="${escapeAttr(appUrl)}">${escapeHtml(L.cta)}</a>
        </div>
      </div>
      <ul class="pr-grid">${cardsHtml}</ul>
      ${othersHtml}
    </main>
  </body>
</html>
`;
}

// ── Páginas de ARTISTA ──────────────────────────────────────────────────────
// "Mitsuhiro Arita cards" é busca de volume real, e o site tinha a tela
// /artists sem nenhuma página indexável por trás.
//
// TETO, e a razão dele: o deploy publica 13.791 arquivos de um limite de 20.000
// no Cloudflare Pages, e a guarda do próprio workflow falha acima de 18.000.
// Uma página por artista dos três jogos com dado (Pokémon, Magic e Lorcana —
// os demais têm indexes-artists VAZIO) seria alguns milhares de arquivos e
// comeria quase toda a folga que sobrou. O plano não tinha visto isso.
//
// Então: os ARTIST_PAGES artistas com mais cartas no catálogo. Card count é
// proxy razoável de interesse de busca — quem ilustrou 400 cartas é procurado,
// quem ilustrou 2 não é. E o número é ajustável num lugar só.
//
// Só UMA variante de idioma (pt, o padrão do site), diferente das páginas de
// set: nome de artista é nome próprio e o título casa com a busca em qualquer
// idioma, então a variante en dobraria o custo de arquivo sem dobrar o alcance.
const ARTIST_PAGES = 900;
const ARTIST_OUT_DIR = "artist";
// Grade da página: 120 cartas cobrem a obra da maioria e mantêm o HTML leve.
const ARTIST_CARDS = 120;
// Artista com uma carta só não sustenta página própria (conteúdo fino é o que o
// Google penaliza) — e são a maior parte da cauda.
const ARTIST_MIN_CARDS = 3;

function artistPageHtml(ap) {
  const { name, slug, cards, porJogo } = ap;
  const total = cards.length;
  const mostra = cards.slice(0, ARTIST_CARDS);
  const jogos = porJogo.map((x) => x.label).join(", ");
  const title = `Cartas ilustradas por ${name} — Sleevu`;
  const desc = `${total} carta${total === 1 ? "" : "s"} ilustrada${total === 1 ? "" : "s"} por ${name} em ${jogos}. Veja a arte, o set de cada uma e marque as que você tem.`;
  const canonical = `${ORIGIN}/${ARTIST_OUT_DIR}/${slug}`;
  const ogImage = absUrl(mostra[0] && mostra[0].image) || `${ORIGIN}/og-image.png`;
  const appUrl = (c) => `/detail?type=artist&name=${encodeURIComponent(name)}&game=${c.game}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Cartas ilustradas por ${name}`,
    url: canonical,
    description: desc,
    isPartOf: { "@type": "WebSite", "@id": ORIGIN + "/#website", name: "Sleevu", url: ORIGIN + "/" },
    about: { "@type": "Person", name },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: mostra.length,
      itemListElement: mostra.map((c, i) => ({
        "@type": "ListItem", position: i + 1,
        name: `${c.name}${c.number ? ` ${cardCode(c)}` : ""}`,
        image: absUrl(c.image) || undefined
      }))
    }
  };

  const ACIMA_DA_DOBRA = 6;
  const cardsHtml = mostra.map((c, i) => {
    const num = c.number ? escapeHtml(cardCode(c)) : "";
    const prioridade = i < ACIMA_DA_DOBRA
      ? ` loading="eager"${i === 0 ? ' fetchpriority="high"' : ""}`
      : ` loading="lazy"`;
    const srcset = thumbSrcset(c.image);
    const srcsetAttr = srcset ? ` srcset="${srcset}" sizes="(max-width: 640px) 50vw, 150px"` : "";
    const alt = `${c.name}${c.set ? ` — ${c.set}` : ""}, arte de ${name}`;
    const img = c.image
      ? `<img class="pr-card-img" src="${escapeAttr(absUrl(thumbUrl(c.image)))}"${srcsetAttr} alt="${escapeAttr(alt)}"${prioridade} decoding="async" width="245" height="342">`
      : `<span class="pr-card-noimg">${escapeHtml(c.name)}</span>`;
    return `<li class="pr-card"><a href="${escapeAttr(appUrl(c))}">${img}<span class="pr-card-meta"><span class="pr-card-num">${num}</span> <span class="pr-card-name">${escapeHtml(c.name)}</span></span></a></li>`;
  }).join("");

  const restante = total - mostra.length;
  const maisHtml = restante > 0
    ? `<p class="pr-more">E mais ${restante} carta${restante === 1 ? "" : "s"} — <a href="${escapeAttr(appUrl(mostra[0] || { game: porJogo[0].game }))}">ver todas no Sleevu</a>.</p>`
    : "";

  const jogosHtml = porJogo
    .map((x) => `<li><a href="/artists?game=${escapeAttr(x.game)}">${escapeHtml(x.label)} · ${x.n} carta${x.n === 1 ? "" : "s"}</a></li>`).join("");

  return `<!doctype html>
<html lang="pt-BR" data-idioma-fixo>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`Cartas ilustradas por ${name}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <meta property="og:image" content="${escapeAttr(ogImage)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <script type="application/ld+json">${jsonLdSeguro(jsonLd)}</script>
    <script src="/src/theme.js"></script>
    <link rel="stylesheet" href="/styles.css">
${PR_STYLE}
  </head>
  <body>
    ${cabecalhoEstatico([["/artists", "Artistas"], ["/games", "Sets"], ["/collection", "Coleção"]])}
    <main class="pr-wrap">
      <div class="pr-hero">
        <div>
          <h1>Cartas ilustradas por ${escapeHtml(name)}</h1>
          <p class="pr-hero-meta">${escapeHtml(`${total} carta${total === 1 ? "" : "s"} · ${jogos}`)}</p>
          <a class="pr-cta" href="${escapeAttr(appUrl(mostra[0] || { game: porJogo[0].game }))}">Ver no Sleevu</a>
        </div>
      </div>
      <ul class="pr-grid">${cardsHtml}</ul>
      ${maisHtml}
      <nav class="pr-others" aria-label="Onde este artista aparece">
        <h2>Onde ${escapeHtml(name)} aparece</h2>
        <ul>${jogosHtml}</ul>
      </nav>
    </main>
  </body>
</html>
`;
}

// Sitemap em ÍNDICE, um arquivo por tipo de página (2026-09-30). O Search
// Console mostra a cobertura POR SITEMAP: com tudo num arquivo só, o relatório
// dizia "7.809 enviadas, N indexadas" sem dizer QUAIS. Separado, dá pra ver se
// o que não entra é carta, set em inglês ou artista, e mexer no tipo certo. O
// endereço do robots.txt (sitemap.xml) não muda: agora ele é o índice, e quem
// já o enviou no Search Console não precisa reenviar. Tipo sem página (galeria
// de decks fora do ar, blog sem post) sai do índice em vez de virar um arquivo
// vazio. Nomes em inglês, como os endereços do site.
//
// Cartas: um arquivo por jogo, e jogo com mais de CARTAS_POR_SITEMAP cartas em
// vários (-2, -3): o protocolo aceita até 50.000 URLs por arquivo, e o Magic
// sozinho tem ~100 mil cartas.
// Devolve { nomeDoArquivo: conteúdo }, com o sitemap.xml (índice) incluído.
const CARTAS_POR_SITEMAP = 45000;
function buildSitemaps(setPages, deckPages, artistPages, blogPosts) {
  const jogos = JOGOS_URL.map((j) => j.url).filter((url) => setPages.some((p) => p.url === url));
  const cartasPorJogo = new Map();
  for (const p of setPages) {
    const lista = cartasPorJogo.get(p.url) || [];
    for (const slug of p.slugsCartas.values()) lista.push(`${ORIGIN}/games/${p.url}/${p.slug}/${slug}`);
    cartasPorJogo.set(p.url, lista);
  }
  const gruposDeCartas = [];
  for (const url of jogos) {
    const lista = cartasPorJogo.get(url) || [];
    for (let i = 0, parte = 1; i < lista.length; i += CARTAS_POR_SITEMAP, parte++) {
      gruposDeCartas.push([`sitemap-cards-${url}${parte > 1 ? `-${parte}` : ""}.xml`, lista.slice(i, i + CARTAS_POR_SITEMAP)]);
    }
  }
  return montaSitemaps(ORIGIN, [
    ["sitemap-pages.xml", STATIC_URLS.map((p) => ORIGIN + p)],
    ["sitemap-games.xml", jogos.map((url) => `${ORIGIN}/games/${url}`)],
    ["sitemap-sets.xml", setPages.map((s) => `${ORIGIN}/games/${s.url}/${s.slug}`)],
    ["sitemap-sets-en.xml", setPages.map((s) => `${ORIGIN}/games/${s.url}/${s.slug}-en`)],
    ...gruposDeCartas,
    ["sitemap-artists.xml", (artistPages || []).map((a) => `${ORIGIN}/artist/${a.slug}`)],
    ["sitemap-decks.xml", (deckPages || []).map((d) => `${ORIGIN}/deck/${d.slug}`)],
    // Posts do blog levam a data da última edição: é o que diz ao Google que
    // um guia atualizado merece ser relido (as outras páginas mudam a cada build).
    ["sitemap-blog.xml", (blogPosts || []).map((p) => ({
      loc: `${ORIGIN}/blog/${p.slug}`,
      lastmod: p.updated_at ? String(p.updated_at).slice(0, 10) : ""
    }))]
  ]);
}

// ── Posts do BLOG (/blog/<slug>) ─────────────────────────────────────────────
// As páginas são montadas na borda (functions/blog/[slug].js), então aqui só
// entram no sitemap. Leitura anônima: a RLS entrega só o publicado com data
// passada (agendado entra no build seguinte ao dia dele). Tabela ainda não
// criada (migração 20260930b pendente) ou Supabase fora = lista vazia; nunca
// derruba o build.
async function fetchBlogPosts() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/posts?select=slug,updated_at&order=published_at.desc&limit=1000`, {
      headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
    });
    const lista = r.ok ? await r.json() : [];
    return Array.isArray(lista) ? lista.filter((p) => p && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(p.slug || ""))) : [];
  } catch { return []; }
}

// ── Páginas de DECK da comunidade (/deck/<slug>.html) ────────────────────────
// Busca de deck ("mickey minnie deck lorcana", "dragapult ex deck list") é o
// tráfego mais recorrente de TCG — Limitless e Dreamborn vivem disso. A galeria
// da comunidade (tabela shares, kind=deck, SELECT anônimo) é dinâmica, mas o
// Google não roda a SPA: aqui viram páginas estáticas com a LISTA DE CARTAS em
// HTML (qtd × nome, o texto que as buscas casam), meta/OG e JSON-LD, apontando
// pro viewer interativo (/decks?s=<id>). Regeradas a cada build — deck novo
// entra no próximo deploy (cron 2×/semana + todo push), removido some junto.
const DECK_OUT_DIR = "deck";
const MAX_DECK_PAGES = 500;
const DECK_GAME_LABELS = {
  pokemon: "Pokémon TCG", lorcana: "Disney Lorcana", onepiece: "One Piece Card Game",
  magic: "Magic: The Gathering", fab: "Flesh and Blood", gundam: "Gundam Card Game", swu: "Star Wars: Unlimited", cyberpunk: "Cyberpunk TCG", sorcery: "Sorcery: Contested Realm",
  dbfw: "Dragon Ball Fusion World", ygo: "Yu-Gi-Oh!", digimon: "Digimon Card Game",
  riftbound: "Riftbound", unionarena: "Union Arena", naruto: "Naruto Card Game",
  hxh: "Hunter × Hunter", dbc: "Dragon Ball Carddass", wow: "World of Warcraft TCG", lotr: "The Lord of the Rings TCG", harrypotter: "Harry Potter TCG", weiss: "Weiß Schwarz", mbc: "Miracle Battle Carddass"
};

async function fetchPublicDecks() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shares?kind=eq.deck&select=id,game,title,created_at,data&order=created_at.desc&limit=${MAX_DECK_PAGES}`, {
      headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
    });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// id -> nome, por jogo, a partir dos chunks que o build já tem no disco (data/
// sets/<lang>/*.json no Pokémon; data/<jogo>/sets/*.json nos demais). Carregado
// UMA vez por jogo que realmente aparece nos decks.
const deckNameCache = {};
function cardNamesFor(game) {
  if (deckNameCache[game]) return deckNameCache[game];
  const map = new Map();
  const dirs = game === "pokemon"
    ? (existsSync(SETS_DIR) ? readdirSync(SETS_DIR).map((l) => join(SETS_DIR, l)) : [])
    : [join("data", game, "sets")];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        for (const c of JSON.parse(readFileSync(join(dir, f), "utf8"))) {
          if (c && c.id && !map.has(c.id)) map.set(c.id, c);
        }
      } catch { /* chunk corrompido: segue */ }
    }
  }
  deckNameCache[game] = map;
  return map;
}

function deckPageHtml(dp) {
  const { deck, slug, cardsList, total, priceUSD } = dp;
  const gameLabel = DECK_GAME_LABELS[deck.game] || deck.game;
  const canonical = `${ORIGIN}/deck/${slug}`;
  const priceBit = priceUSD > 0 ? ` — US$ ${priceUSD.toFixed(2)}` : "";
  const title = `${deck.name} — deck de ${gameLabel} (${total} cartas)${priceBit} | Sleevu`;
  const topNames = cardsList.slice(0, 6).map((c) => c.name).join(", ");
  const desc = `Lista completa do deck "${deck.name}" de ${gameLabel}: ${topNames}${cardsList.length > 6 ? "…" : ""}${priceUSD > 0 ? ` Custo de referência: US$ ${priceUSD.toFixed(2)}.` : ""} Veja a curva, o que falta na sua coleção e copie pra sua conta no Sleevu.`;
  const appUrl = `/decks?s=${encodeURIComponent(deck.shareId)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${deck.name} — deck de ${gameLabel}`,
    datePublished: deck.createdAt || undefined,
    author: deck.author ? { "@type": "Person", name: deck.author } : undefined,
    publisher: { "@type": "Organization", "@id": ORIGIN + "/#organization", name: "Sleevu" },
    url: canonical
  };
  const rows = cardsList.map((c) => `<li>${c.qty}× ${escapeHtml(c.name)}${c.meta ? ` <small>${escapeHtml(c.meta)}</small>` : ""}${c.usd > 0 ? ` <b>US$ ${(c.usd * c.qty).toFixed(2)}</b>` : ""}</li>`).join("\n            ");
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <script type="application/ld+json">${jsonLdSeguro(jsonLd)}</script>
    <style>
      body { font-family: system-ui, sans-serif; background: #101218; color: #e8eaf0; margin: 0; padding: 24px 16px; }
      main { max-width: 720px; margin: 0 auto; }
      a { color: #ff6b6b; }
      .cta { display: inline-block; background: #e23030; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 22px; margin: 14px 0; }
      ul { columns: 2; gap: 32px; padding-left: 20px; } li { margin: 3px 0; break-inside: avoid; }
      small { color: #9aa3b2; }
      @media (max-width: 560px) { ul { columns: 1; } }
    </style>
  </head>
  <body>
    <main>
      <p><a href="/decks">← Decks da comunidade</a></p>
      <h1>${escapeHtml(deck.name)}</h1>
      <p>Deck de <strong>${escapeHtml(gameLabel)}</strong> · ${total} cartas${deck.author ? ` · por @${escapeHtml(deck.author)}` : ""}${priceUSD > 0 ? ` · custo de referência <strong>US$ ${priceUSD.toFixed(2)}</strong>` : ""}</p>
      <a class="cta" href="${escapeAttr(appUrl)}">Abrir no Sleevu — valor, curva de custo e copiar o deck</a>
      <h2>Lista de cartas</h2>
      <ul>
            ${rows}
      </ul>
      <p><a href="${escapeAttr(appUrl)}">Ver este deck com preços e análise no Sleevu →</a></p>
    </main>
  </body>
</html>
`;
}

// Tabela de preços por jogo, carregada sob demanda (só dos jogos que aparecem
// nos decks). Pokémon mora em data/, os demais em data/<jogo>/.
const deckPriceCache = {};
async function pricingFor(game) {
  if (deckPriceCache[game]) return deckPriceCache[game];
  const dir = game === "pokemon" ? "data/" : `data/${game}/`;
  let table = {};
  try { table = await loadPricingTable(dir); } catch { /* jogo sem pricing */ }
  // O .generated é artefato de build: vazio no dev e em build cujo sync do jogo
  // falhou. Cai no pricing.js versionado pra a página não sair sem preço.
  if (!Object.keys(table).length) {
    try { table = (await readGlobalVar(new URL(`../${dir}pricing.js`, import.meta.url), "TCG_PRICING")) || {}; } catch { /* sem preço mesmo */ }
  }
  deckPriceCache[game] = table;
  return table;
}

async function buildDeckPages() {
  const rowsRaw = await fetchPublicDecks();
  if (existsSync(DECK_OUT_DIR)) rmSync(DECK_OUT_DIR, { recursive: true, force: true });
  mkdirSync(DECK_OUT_DIR, { recursive: true });
  const used = new Set();
  const out = [];
  for (const row of rowsRaw) {
    const d = row && row.data;
    if (!d || d.v !== 1 || !d.zones || !DECK_GAME_LABELS[d.game]) continue;
    const names = cardNamesFor(d.game);
    const precos = await pricingFor(d.game);
    const cardsList = [];
    let total = 0, priceUSD = 0;
    Object.values(d.zones).forEach((list) => (Array.isArray(list) ? list : []).forEach((e) => {
      if (!e || !e.id) return;
      const qty = Math.max(1, Math.min(99, Number(e.qty) || 1));
      total += qty;
      const c = names.get(String(e.id));
      // Preço de REFERÊNCIA em USD (o mesmo campo que as páginas de carta usam):
      // é o número que aparece na busca — "quanto custa montar este deck" é a
      // pergunta que traz o clique.
      const usd = refPriceUSD(precos[String(e.id)]);
      priceUSD += usd * qty;
      cardsList.push({ qty, usd, name: c ? c.name : String(e.id), meta: c ? `${c.set || ""} ${c.number || ""}`.trim() : "" });
    }));
    if (!total) continue;
    priceUSD = Math.round(priceUSD * 100) / 100;
    const deck = {
      shareId: row.id, game: d.game, author: d.author ? String(d.author).slice(0, 30) : null,
      name: String(d.name || row.title || "Deck").slice(0, 60), createdAt: row.created_at || null
    };
    let base = slugify(`${deck.name}-${d.game}`) || "deck";
    // Sufixo curto do id: dois decks "Mickey Aggro" não podem disputar o slug.
    base = `${base}-${String(row.id).slice(0, 8)}`;
    let s = base, i = 2;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);
    writeFileSync(join(DECK_OUT_DIR, `${s}.html`), deckPageHtml({ deck, slug: s, cardsList, total, priceUSD }), "utf8");
    out.push({ slug: s });
  }
  return out;
}

// ── Cartas que tinham página estática (/card/<slug>) até 2026-09-30 ─────────
// Eram as ~1.500 mais valiosas (pricing do build) + as mais vistas (card_views
// do Supabase). Hoje toda carta tem página na borda, em /games/<jogo>/<set>/
// <carta> (functions/games/). O ranking continua aqui SÓ pra gerar o mapa
// slug antigo -> endereço novo (legado-cartas.json), que o functions/card/
// [slug].js usa pro 301: a régua dos slugs antigos não pode mudar.
const MAX_CARD_PAGES = 1500;
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const SUPABASE_ANON = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública

async function loadPricingTable(dir) {
  const v = await readGlobalVar(new URL(`../${dir}pricing.generated.js`, import.meta.url), "TCG_PRICING");
  return v || {};
}
function refPriceUSD(entry) {
  if (!entry) return 0;
  if (entry.u > 0) return entry.u;
  if (entry.e > 0) return entry.e * 1.1; // EUR ~ USD pra RANQUEAR (não exibimos convertido)
  return 0;
}
async function fetchTopViews() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/card_views?select=game,card_id,views&order=views.desc&limit=600`, {
      headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
    });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// ── Mapa set -> página estática (data/set-pages/<jogo>.json) ────────────────
// Quem consome é a Function da borda (functions/detail.js): o link do APP
// (/detail?type=set&...) é uma casca sem conteúdo — colado no WhatsApp não
// mostra prévia nenhuma, e é `noindex`, então todo link que alguém compartilha
// nasce sem valor de busca. Com este mapa a borda injeta título/descrição/
// imagem do set e o <link rel="canonical"> apontando pra ESTA página estática,
// que é a indexável. Um arquivo por jogo pra a borda ler só o que precisa.
//
// Formato enxuto (array, não objeto) porque isto é baixado na borda a cada
// link compartilhado: [caminho, nome, imagem, nº de cartas, lançamento], com o
// caminho dentro de /games/ ("pokemon/base-set").
function escreveMapaDeSets(pages) {
  const porJogo = new Map();
  for (const page of pages) {
    let mapa = porJogo.get(page.game);
    if (!mapa) porJogo.set(page.game, (mapa = {}));
    const img = absUrl(page.rep.setLogo || page.rep.image || "");
    const data = page.rep.setReleaseDate || "";
    const linha = [`${page.url}/${page.slug}`, page.name, img, page.cards.length, data];
    // Uma entrada por setId do grupo: a página junta os chunks do mesmo set
    // (edições/línguas), e o link do app carrega UM desses ids.
    for (const id of new Set(page.cards.map((c) => c.setId).filter(Boolean))) mapa[id] = linha;
  }
  const dir = join("data", "set-pages");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [game, mapa] of porJogo) {
    writeFileSync(join(dir, `${game}.json`), JSON.stringify(mapa), "utf8");
    total += Object.keys(mapa).length;
  }
  console.log(`prerender-catalog: mapa de sets em data/set-pages/ (${porJogo.size} jogos, ${total} ids).`);
}

// ── Mapas da árvore /games (data/game-pages/) ───────────────────────────────
// <jogo>.json é o que a borda (functions/games/) precisa de cada jogo: a lista
// de sets da tela do jogo e, pra montar a página de uma carta, de quais chunks
// sai cada página de set:
//   { g: chave do jogo, l?: linha, n: nome, s: { <set>: { n: nome do set,
//     f: [chunks], c: nº de cartas, d: lançamento } } }
// Um arquivo por jogo, e não por set: o deploy está perto do teto de arquivos
// do Pages, e 2.700 mapas a mais não caberiam.
//
// legado-sets.json e legado-cartas.json levam os endereços ANTIGOS (/set/ e
// /card/) pros novos: são eles que o 301 de functions/set/ e functions/card/ lê.
function escreveMapasDosJogos(pages, legadoCartas) {
  if (existsSync(MAPAS_DIR)) rmSync(MAPAS_DIR, { recursive: true, force: true });
  mkdirSync(MAPAS_DIR, { recursive: true });
  const porUrl = new Map();
  const legadoSets = {};
  for (const page of pages) {
    let m = porUrl.get(page.url);
    if (!m) {
      const jogo = jogoDaUrl(page.url);
      m = { g: jogo.game, n: jogo.nome, s: {} };
      if (jogo.linha) m.l = jogo.linha;
      porUrl.set(page.url, m);
    }
    const arquivos = [...new Set(page.cards.map((c) => ARQUIVO_DA_CARTA.get(c)).filter(Boolean))].sort();
    m.s[page.slug] = { n: page.name, f: arquivos, c: cardsForLang(page.cards, "pt").length, d: page.rep.setReleaseDate || "" };
    legadoSets[page.slugAntigo] = `${page.url}/${page.slug}`;
  }
  for (const [url, m] of porUrl) writeFileSync(join(MAPAS_DIR, `${url}.json`), JSON.stringify(m), "utf8");
  writeFileSync(join(MAPAS_DIR, "legado-sets.json"), JSON.stringify(legadoSets), "utf8");
  writeFileSync(join(MAPAS_DIR, "legado-cartas.json"), JSON.stringify(legadoCartas), "utf8");
  console.log(`prerender-catalog: mapas de ${porUrl.size} jogos em ${MAPAS_DIR}/ + ${Object.keys(legadoSets).length} sets e ${Object.keys(legadoCartas).length} cartas com endereço antigo.`);
}

// Slug antigo -> endereço novo das cartas que tinham página estática. Mesmo
// ranking e mesma régua de slug de antes (ver o comentário da seção), pra que
// cada /card/<slug> que existia ache o seu destino.
async function mapaDasCartasAntigas(pages) {
  const pricingByGame = {
    pokemon: await loadPricingTable("data/"),
    lorcana: await loadPricingTable("data/lorcana/"),
    onepiece: await loadPricingTable("data/onepiece/")
  };
  const candidates = new Map();
  for (const p of pages) {
    const pricing = pricingByGame[p.game] || {};
    for (const card of p.cards) {
      const usd = refPriceUSD(pricing[card.id]);
      if (usd <= 0) continue;
      const k = `${p.game}|${card.id}`;
      if (!candidates.has(k) || candidates.get(k).score < usd) candidates.set(k, { card, setPage: p, score: usd });
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CARD_PAGES - 300);
  const views = await fetchTopViews();
  const have = new Set(ranked.map((r) => `${r.setPage.game}|${r.card.id}`));
  for (const v of views) {
    if (ranked.length >= MAX_CARD_PAGES) break;
    const k = `${v.game}|${v.card_id}`;
    if (have.has(k)) continue;
    for (const p of pages) {
      if (p.game !== v.game) continue;
      const card = p.cards.find((c) => c.id === v.card_id);
      if (card) { ranked.push({ card, setPage: p, score: 0 }); have.add(k); break; }
    }
  }
  const usados = new Set();
  const mapa = {};
  for (const cp of ranked) {
    const hasCjk = /[^\x00-\x7F]/.test(cp.card.name);
    let nameSlug = hasCjk ? slugify(`${cp.card.pokemonName || ""}-${cp.card.name}`) : slugify(cp.card.name);
    if (hasCjk && nameSlug.length < 4) nameSlug = slugify(`${cp.card.setId || ""}-${nameSlug}`) || nameSlug;
    const base = slugify(`${nameSlug}-${cp.card.number || cp.card.id}`) || slugify(cp.card.id) || "carta";
    let s = base, i = 2;
    while (usados.has(s)) s = `${base}-${i++}`;
    usados.add(s);
    const p = cp.setPage;
    mapa[s] = `${p.url}/${p.slug}/${p.slugsCartas.get(String(cp.card.id))}`;
  }
  return mapa;
}

// ── Página /games (todos os jogos) ──────────────────────────────────────────
// O topo da árvore: é pra onde a trilha das páginas de set e de carta aponta
// ("Jogos"), e é por ela que o robô chega em cada /games/<jogo>. Na ordem do
// hub, modernos primeiro e vintage por ano. Jogo sem nenhum set no catálogo
// (ainda "em breve") fica de fora.
function milhar(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function paginaDosJogos(pages) {
  const porUrl = new Map();
  for (const p of pages) {
    const e = porUrl.get(p.url) || { sets: 0, cartas: 0 };
    e.sets++;
    e.cartas += cardsForLang(p.cards, "pt").length;
    porUrl.set(p.url, e);
  }
  const jogos = JOGOS_URL.filter((j) => porUrl.has(j.url));
  const canonical = `${ORIGIN}/games`;
  const title = "Jogos de cartas colecionáveis: sets e cartas | Sleevu";
  const desc = `Pokémon, Magic, Lorcana, One Piece e mais: ${jogos.length} jogos de cartas colecionáveis, modernos e vintage, com todos os sets e cartas no Sleevu.`;
  const item = (j) => {
    const e = porUrl.get(j.url);
    // Caixa branca atrás do logo, como no hub: vários logos são escuros (One
    // Piece, Gundam) e sumiam no fundo do cartão no tema escuro.
    const logo = j.logo ? `<span class="pj-logo-box"><img class="pj-logo" src="/${escapeAttr(j.logo)}" alt="" loading="lazy" decoding="async"></span>` : "";
    return `<li><a class="pj-jogo" href="/games/${escapeAttr(j.url)}">${logo}<span class="pj-nome">${escapeHtml(j.nome)}</span><span class="pj-meta">${e.sets} sets · ${milhar(e.cartas)} cartas${j.vintage ? ` · ${escapeHtml(j.vintage)}` : ""}</span></a></li>`;
  };
  const modernos = jogos.filter((j) => !j.vintage);
  const vintage = jogos.filter((j) => j.vintage);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Jogos de cartas colecionáveis no Sleevu",
    url: canonical,
    description: desc,
    isPartOf: { "@type": "WebSite", "@id": ORIGIN + "/#website", name: "Sleevu", url: ORIGIN + "/" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: jogos.length,
      itemListElement: jogos.map((j, i) => ({ "@type": "ListItem", position: i + 1, name: j.nome, url: `${ORIGIN}/games/${j.url}` }))
    }
  };
  return `<!doctype html>
<html lang="pt-BR" data-idioma-fixo>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${canonical}">
    <meta property="og:title" content="${escapeAttr(title.replace(" | Sleevu", ""))}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <meta property="og:image" content="${ORIGIN}/og-image.png">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="theme-color" content="#e8ecf1" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#101218" media="(prefers-color-scheme: dark)">
    <!-- A página mora na RAIZ (games.html), então passa pelas guardas do
         check.mjs e do check-mobile.mjs como as do app. -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <script type="application/ld+json">${jsonLdSeguro(jsonLd)}</script>
    <script src="/src/theme.js"></script>
    <link rel="stylesheet" href="/styles.css">
${PR_STYLE}
    <style>
      .pj-grade { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
      .pj-jogo { display: flex; flex-direction: column; gap: 6px; min-height: 44px; padding: 14px; border: 1px solid var(--line, #2d333f); border-radius: 12px; color: inherit; text-decoration: none; background: var(--panel, #1a1c22); }
      .pj-jogo:hover { border-color: var(--accent, #e63946); }
      .pj-logo-box { display: flex; align-items: center; justify-content: center; height: 76px; padding: 10px; border-radius: 8px; background: #fff; box-sizing: border-box; }
      .pj-logo { max-width: 100%; max-height: 100%; object-fit: contain; }
      .pj-nome { font-weight: 700; }
      .pj-meta { color: var(--muted, #9aa0aa); font-size: 0.85rem; }
      .pj-secao { margin-top: 36px; font-size: 1.15rem; }
    </style>
  </head>
  <body>
    ${cabecalhoEstatico([["/explore", "Explorar"], ["/collection", "Coleção"]])}
    <main class="pr-wrap">
      <div class="pr-hero">
        <div>
          <h1>Jogos</h1>
          <p class="pr-sub">${escapeHtml(`${jogos.length} jogos de cartas colecionáveis, com todos os sets e cartas. Escolha um pra ver a coleção completa.`)}</p>
        </div>
      </div>
      <ul class="pj-grade">${modernos.map(item).join("")}</ul>
      ${vintage.length ? `<h2 class="pj-secao">Vintage</h2>
      <ul class="pj-grade">${vintage.map(item).join("")}</ul>` : ""}
    </main>
  </body>
</html>
`;
}

async function main() {
  // Dois slugs por set. O ANTIGO segue a régua do diretório plano /set/ (único
  // entre TODOS os jogos, -2 pra quem colidia, na ordem fixa de GAMES): serve
  // só pro mapa do 301. O NOVO é único dentro do seu /games/<jogo>/, então
  // os -2 entre jogos somem (o "Unleashed" do Riftbound deixa de ser
  // unleashed-2 por causa do Pokémon). A base é a mesma nas duas réguas.
  const usedAntigo = new Set();
  const usadosPorJogo = new Map();
  const pages = [];
  for (const { slug: game } of GAMES) {
    const byName = game === "pokemon" ? loadPokemonSets() : await loadGameSets(game);
    if (!byName.size) {
      console.log(`prerender-catalog: sem catálogo de ${game} — pulando.`);
      continue;
    }
    const gamePages = [];
    for (const [name, cards] of byName) {
      cards.sort((a, b) => cmpNumber(a.number, b.number));
      const rep = cards.find((c) => c.setLogo) || cards.find((c) => c.setReleaseDate) || cards[0];
      let base = slugify(name) || slugify(rep.setId) || "set";
      // Nome quase todo CJK (sobra só um dígito, ex.: ※確認中1 -> "1"): slug
      // curto demais colide — prefixa o setId.
      if (base.length < 4) base = slugify(rep.setId) ? `${slugify(rep.setId)}-${base}` : `set-${base}`;
      let antigo = base, i = 2;
      while (usedAntigo.has(antigo)) antigo = `${base}-${i++}`;
      usedAntigo.add(antigo);
      const url = urlDoSet(game, rep.setId);
      if (!url) {
        console.warn(`prerender-catalog: ${game} sem endereço em functions/_lib/jogos.js — set "${name}" pulado.`);
        continue;
      }
      let usados = usadosPorJogo.get(url);
      if (!usados) usadosPorJogo.set(url, (usados = new Set()));
      // O -en é a variante em inglês DESTE set: um set cujo nome já termine em
      // "-en" não pode tomar o arquivo da variante de outro.
      let s = base, j = 2;
      while (usados.has(s) || usados.has(`${s}-en`)) s = `${base}-${j++}`;
      usados.add(s);
      usados.add(`${s}-en`);
      gamePages.push({
        name, slug: s, slugAntigo: antigo, cards, rep, game, url,
        gameLabel: jogoDaUrl(url).nome,
        slugsCartas: slugsDasCartas(cards)
      });
    }
    gamePages.sort((a, b) => a.name.localeCompare(b.name));
    pages.push(...gamePages);
  }

  if (!pages.length) {
    console.log("prerender-catalog: nenhum catálogo encontrado — nada a fazer.");
    return;
  }

  // Recria a árvore de saída do zero (evita páginas órfãs de sets removidos).
  if (existsSync(GAMES_DIR)) rmSync(GAMES_DIR, { recursive: true, force: true });
  mkdirSync(GAMES_DIR, { recursive: true });
  for (const page of pages) {
    const dir = join(GAMES_DIR, page.url);
    mkdirSync(dir, { recursive: true });
    // "Outros sets" só do MESMO /games/<jogo> (linkar 700 sets de outro jogo
    // em cada página viraria ruído pro leitor e pro crawler).
    const others = pages.filter((p) => p.url === page.url && p.slug !== page.slug).map((p) => ({ name: p.name, slug: p.slug }));
    // Só a variante en (hreflang) é arquivo: a pt (padrão/x-default) é a tela
    // do set do app, decorada na borda com os mesmos textos (functions/games/
    // e functions/_lib/pagina-set.js). As duas se referenciam via
    // <link rel=alternate>.
    const base = `${ORIGIN}/games/${page.url}/${page.slug}`;
    writeFileSync(join(dir, `${page.slug}-en.html`), setPageHtml(page, `${base}-en`, others, "en"), "utf8");
  }
  writeFileSync("games.html", paginaDosJogos(pages), "utf8");

  escreveMapaDeSets(pages);
  escreveMapasDosJogos(pages, await mapaDasCartasAntigas(pages));

  // ── Artistas ──────────────────────────────────────────────────────────────
  // Agrupa pelo NOME do ilustrador, cruzando os jogos: o mesmo artista pode
  // aparecer em mais de um catálogo, e uma página por (artista, jogo) partiria
  // a autoridade da URL no meio.
  const porArtista = new Map();
  for (const page of pages) {
    for (const c of page.cards) {
      const nome = String((c && c.artist) || "").trim();
      // "Artista desconhecido" é o rótulo que o índice usa pra carta SEM
      // ilustrador — não é uma pessoa e não pode virar página.
      if (!nome || /^artista desconhecido$/i.test(nome) || /^unknown/i.test(nome)) continue;
      let e = porArtista.get(nome);
      if (!e) { e = { name: nome, cards: [], jogos: new Map() }; porArtista.set(nome, e); }
      // O jogo vive na PÁGINA, não na carta do chunk: sem carimbar aqui, o link
      // pro app saía com `game=undefined` e caía no jogo errado da sessão.
      e.cards.push({ ...c, game: page.game });
      const j = e.jogos.get(page.game) || { game: page.game, label: page.gameLabel, n: 0 };
      j.n++; e.jogos.set(page.game, j);
    }
  }

  const artistPages = [];
  const artistSlugs = new Set();
  const candidatos = [...porArtista.values()]
    .filter((a) => a.cards.length >= ARTIST_MIN_CARDS)
    .sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name))
    .slice(0, ARTIST_PAGES);
  for (const a of candidatos) {
    // Nome que sluga pra nada (só CJK) não vira URL legível — fica de fora, em
    // vez de gerar /artist/2 e /artist/2-3.
    const base = slugify(a.name);
    if (base.length < 3) continue;
    let slug = base, i = 2;
    while (artistSlugs.has(slug)) slug = `${base}-${i++}`;
    artistSlugs.add(slug);
    // Mais valiosas primeiro não dá pra saber aqui (o preço vive noutro passo),
    // então: mais recentes primeiro, que é a obra que a pessoa procura.
    a.cards.sort((x, y) => String(y.setReleaseDate || "").localeCompare(String(x.setReleaseDate || "")));
    artistPages.push({ name: a.name, slug, cards: a.cards, porJogo: [...a.jogos.values()].sort((x, y) => y.n - x.n) });
  }

  if (existsSync(ARTIST_OUT_DIR)) rmSync(ARTIST_OUT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIST_OUT_DIR, { recursive: true });
  for (const ap of artistPages) {
    writeFileSync(join(ARTIST_OUT_DIR, `${ap.slug}.html`), artistPageHtml(ap), "utf8");
  }

  // Decks da comunidade: nunca derruba o build (galeria fora do ar = 0 páginas).
  let deckPages = [];
  try { deckPages = await buildDeckPages(); } catch (e) { console.warn(`decks: pulado (${e.message})`); }

  const blogPosts = await fetchBlogPosts();
  // Os sitemap-*.xml de uma rodada anterior saem antes: tipo que ficou sem
  // página não pode deixar arquivo órfão fora do índice.
  for (const f of readdirSync(".")) if (/^sitemap-[a-z0-9-]+\.xml$/.test(f)) rmSync(f);
  const sitemaps = buildSitemaps(pages, deckPages, artistPages, blogPosts);
  for (const [nome, conteudo] of Object.entries(sitemaps)) writeFileSync(nome, conteudo, "utf8");
  const nUrls = Object.entries(sitemaps).filter(([nome]) => nome !== "sitemap.xml")
    .reduce((n, [, xml]) => n + (xml.match(/<loc>/g) || []).length, 0);
  console.log(`prerender-catalog: ${blogPosts.length} posts do blog no sitemap.`);
  const perGame = GAMES.map((g) => `${g.slug} ${pages.filter((p) => p.game === g.slug).length}`).join(" · ");
  console.log(`prerender-catalog: ${pages.length} páginas de set em /${GAMES_DIR}/ (${perGame}) + ${artistPages.length} páginas de artista em /${ARTIST_OUT_DIR}/ (de ${porArtista.size} artistas no catálogo, teto ${ARTIST_PAGES}) + ${deckPages.length} páginas de deck em /${DECK_OUT_DIR}/ + sitemap.xml (índice de ${Object.keys(sitemaps).length - 1} arquivos, ${nUrls} URLs).`);
}

await main();
