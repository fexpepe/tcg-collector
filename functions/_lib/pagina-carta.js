// Página de CARTA (/games/<jogo>/<set>/<carta>), montada na borda por
// functions/games/[[path]].js (2026-09-30).
//
// Até aqui ela era gerada no build pras ~1.500 cartas mais caras e mais vistas,
// em /card/<slug>. O teto de 20.000 arquivos do Cloudflare Pages não deixava ir
// além, e a TCGplayer aparece pra "nome da carta + número" justamente porque tem
// uma página por produto. Na borda não há teto: toda carta do catálogo tem
// página, montada na primeira visita e guardada no cache da borda.
//
// O texto é o mesmo molde da página estática antiga (título no orçamento do
// Google, parágrafo com os fatos da carta, ficha técnica, JSON-LD Product), com
// os endereços novos. Função pura: recebe os dados já resolvidos e devolve o
// HTML. Quem busca chunk, preço e casca é a Function, e o
// tests/pagina-carta.test.mjs testa daqui sem precisar da borda.
import { cardCode, alternateCodes } from "./card-code.js";
import { jsonLdSeguro } from "./json-ld.js";

export const ORIGEM = "https://sleevu.app";
// Mesmo orçamento de título das páginas de set (ver o prerender): o Google
// mostra ~60-65 caracteres. O nome da carta nunca é cortado.
const TITULO_MAX = 65;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
// og:image e o `image` do JSON-LD precisam de URL absoluta (os crawlers
// ignoram relativa); imagem de catálogo pode vir como caminho do site.
export function absUrl(u) {
  const s = String(u || "");
  if (!s) return s;
  return /^https?:\/\//.test(s) ? s : `${ORIGEM}/` + s.replace(/^\/+/, "");
}

// Preço de referência em US$: o `u` do preço (mercado americano) ou, sem ele,
// o do Cardmarket (EUR) com a margem que o ranqueamento antigo já usava.
export function precoUSD(entrada) {
  if (!entrada) return 0;
  if (entrada.u > 0) return entrada.u;
  if (entrada.e > 0) return entrada.e * 1.1;
  return 0;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function dataPtBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : "";
}

// CÓDIGO DO SET como o jogador digita ("Ms. All Sunday OP16"): só quando o
// fabricante escreve em caixa alta (OP16, EB-01), e sem repetir o que já está
// no número da carta (em OP01-079 o "OP01" já aparece).
export function codigoDoSet(card) {
  const bruto = String(card.setId || "").trim();
  if (!/[A-Z]/.test(bruto)) return "";
  const code = bruto.replace(/_.*$/, "");
  const semTraco = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (semTraco(String(card.number || "")).includes(semTraco(code))) return "";
  return code;
}

// Título: nome > número > código do set > nome do set, e o nome do set é o
// primeiro a cair quando não cabe.
export function tituloDaCarta(nome, numero, code, nomeDoSet) {
  const base = [nome, numero, code].filter(Boolean).join(" ");
  const sufixo = " | Sleevu";
  const comSet = nomeDoSet ? `${base} · ${nomeDoSet}` : base;
  return ((comSet + sufixo).length <= TITULO_MAX ? comSet : base) + sufixo;
}

// Ordena "4/102" < "10/102" pelo primeiro inteiro.
function cmpNumero(a, b) {
  const na = parseInt(String(a || "").match(/\d+/), 10);
  const nb = parseInt(String(b || "").match(/\d+/), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

const IDIOMA = { pt: "Português", ja: "Japonês", zh: "Chinês", ko: "Coreano", fr: "Francês", de: "Alemão", it: "Italiano", es: "Espanhol" };
function rotuloDoIdioma(card) {
  const l = String(card.language || "en").toLowerCase().slice(0, 2);
  return l === "en" ? "" : (IDIOMA[l] || l.toUpperCase());
}

// Ficha técnica: só as linhas que a carta TEM (cada jogo traz um subconjunto:
// Magic tem custo de mana, Pokémon tem HP, One Piece tem cor).
function fichaTecnica(card, jogo, set, sCode) {
  const linhas = [
    ["Jogo", jogo.nome],
    ["Set", sCode ? `${set.nome} (${sCode})` : set.nome],
    ["Número", cardCode(card)],
    ["Idioma", rotuloDoIdioma(card)],
    ["Raridade", card.rarity && card.rarity !== "None" ? card.rarity : ""],
    ["Ilustrador", card.artist],
    ["Tipo", card.cardType || card.category],
    ["Estágio", card.stage],
    ["Tipos", Array.isArray(card.types) ? card.types.join(", ") : card.types],
    ["Custo", card.manaCost || (card.cost != null && card.cost !== "" ? String(card.cost) : "")],
    ["Poder", card.power],
    ["Cor", card.color || card.colorId || card.ink || card.opColor],
    ["HP", card.hp],
    ["Série", card.setSerieName],
    ["Nº na Pokédex", card.dexId],
    ["Acabamentos", Array.isArray(card.variants) ? card.variants.join(", ") : ""],
    ["Lançamento do set", dataPtBr(card.setReleaseDate)],
    ["Cartas no set", card.setTotal ? String(card.setTotal) : ""]
  ].filter(([, v]) => v != null && String(v).trim() !== "");
  if (!linhas.length) return "";
  return `<h2>Ficha técnica</h2>
      <dl class="prc-ficha">${linhas.map(([k, v]) =>
    `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join("")}</dl>`;
}

function listaDeCartas(titulo, itens) {
  if (!itens || !itens.length) return "";
  return `<h2>${escapeHtml(titulo)}</h2>
      <ul class="prc-lista">${itens.map((it) =>
    `<li><a href="${escapeAttr(it.href)}">${escapeHtml(it.rotulo)}</a></li>`).join("")}</ul>`;
}

// Link do APP com a carta aberta: o detail.js reabre o popup (openFromUrl), e
// quem chegou pelo Google cai direto na carta pra marcar na coleção.
// Nome fora do ASCII com setId conhecido vai só com o id + região (a mesma
// régua do appSetUrl do prerender e do detailUrl do shared.js).
function linkDoApp(card, game, nomeDoSet) {
  const regiao = (() => {
    const l = String(card.language || "en").toLowerCase();
    if (l.startsWith("ja")) return "japanese";
    if (l.startsWith("zh")) return "chinese";
    if (l.startsWith("pt")) return "portuguese";
    return "english";
  })();
  const semNome = Boolean(card.setId) && /[^ -~]/.test(nomeDoSet);
  const ident = semNome
    ? `setId=${encodeURIComponent(card.setId)}&region=${regiao}`
    : `name=${encodeURIComponent(nomeDoSet)}${card.setId ? `&setId=${encodeURIComponent(card.setId)}` : ""}`;
  return `/detail?type=set&${ident}&game=${game}&card=${encodeURIComponent(card.id)}`;
}

// As outras cartas da página que valem link: as outras IMPRESSÕES da mesma
// carta (outro idioma, arte paralela) e as vizinhas de número no mesmo idioma.
// Tudo sai da própria página do set, que é o que a borda tem em mão.
function vizinhas(card, cartas, slugs, base) {
  const nome = String(card.name || "").toLowerCase();
  const impressoes = cartas.filter((o) => o.id !== card.id && String(o.name || "").toLowerCase() === nome).slice(0, 12);
  const jaListadas = new Set(impressoes.map((o) => o.id));
  const mesmoIdioma = cartas.filter((o) => (o.language || "en") === (card.language || "en"))
    .sort((a, b) => cmpNumero(a.number, b.number));
  const i = mesmoIdioma.findIndex((o) => o.id === card.id);
  const janela = mesmoIdioma.slice(Math.max(0, i - 6), i + 7)
    .filter((o) => o.id !== card.id && !jaListadas.has(o.id)).slice(0, 12);
  const href = (o) => `${base}/${slugs.get(String(o.id))}`;
  const idiomaBit = (o) => (rotuloDoIdioma(o) ? ` (${rotuloDoIdioma(o)})` : "");
  return {
    impressoes: impressoes.map((o) => ({ href: href(o), rotulo: `${o.name} ${cardCode(o)}${idiomaBit(o)}`.trim() })),
    irmas: janela.map((o) => ({ href: href(o), rotulo: `${o.name} ${cardCode(o)}`.trim() }))
  };
}

const ESTILO = `    <style>
      .prc-wrap { max-width: 900px; margin: 0 auto; padding: 0 20px 48px; }
      .prc-hero { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 26px; }
      .prc-img { width: min(320px, 80vw); height: auto; border-radius: 12px; background: var(--panel, #1a1c22); }
      .prc-info h1 { margin: 0 0 6px; font-size: 1.5rem; }
      .prc-sub { color: var(--muted, #9aa0aa); margin: 0 0 12px; }
      .prc-price { font-size: 1.25rem; font-weight: 800; margin: 8px 0 2px; }
      .prc-price-note { color: var(--muted, #9aa0aa); font-size: 12.5px; margin: 0 0 14px; }
      .prc-cta { display: inline-block; margin-top: 8px; padding: 10px 18px; border-radius: 10px; background: var(--accent, #e63946); color: var(--on-accent, #fff); font-weight: 600; text-decoration: none; }
      .prc-setlink { margin-top: 22px; }
      .prc-setlink a { color: var(--accent, #e63946); }
      .prc-trilha { margin-top: 18px; font-size: 13px; color: var(--muted, #9aa0aa); }
      .prc-trilha a { color: var(--muted, #9aa0aa); text-decoration: none; }
      .prc-trilha a:hover { text-decoration: underline; }
      .prc-corpo { margin-top: 34px; max-width: 720px; line-height: 1.7; }
      .prc-corpo h2 { font-size: 1.05rem; margin: 30px 0 10px; }
      .prc-ficha { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 20px; margin: 0; }
      .prc-ficha div { display: flex; gap: 8px; border-bottom: 1px solid var(--line, #2d333f); padding-bottom: 6px; }
      .prc-ficha dt { color: var(--muted, #9aa0aa); flex: none; }
      .prc-ficha dd { margin: 0; font-weight: 600; }
      .prc-lista { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 20px; }
      .prc-lista a { color: var(--accent, #e63946); text-decoration: none; }
      .prc-lista a:hover { text-decoration: underline; }
    </style>`;

// jogo: a entrada do registro (functions/_lib/jogos.js). set: { slug, nome }.
// cartas: todas as cartas da página do set; slugs: Map id -> nome no endereço.
// assets: o que a casca carimbada pelo deploy aponta (build, css, js).
export function paginaDaCarta({ card, jogo, set, cartas, slugs, preco, assets }) {
  const baseDoSet = `/games/${jogo.url}/${set.slug}`;
  const canonical = `${ORIGEM}${baseDoSet}/${slugs.get(String(card.id))}`;
  const code = cardCode(card);
  const codeBit = code ? ` ${code}` : "";
  const altCodes = alternateCodes(card);
  const altBit = altCodes.length ? ` (${altCodes.join(", ")})` : "";
  // Nome japonês/chinês ganha o nome em inglês entre parênteses (a busca em
  // pt/en acha igual).
  const nomeEn = card.nameEn || card.pokemonName;
  const enBit = nomeEn && !/^[\x00-\x7F]/.test(card.name) ? ` (${nomeEn})` : "";
  const sCode = codigoDoSet(card);
  const title = tituloDaCarta(`${card.name}${enBit}`, code, sCode, set.nome);
  const usd = Number(preco) || 0;
  const priceBit = usd > 0 ? ` Preço de referência: US$ ${usd.toFixed(2)}.` : "";
  const codeBitDesc = sCode ? ` (${sCode})` : "";
  const desc = `${card.name}${codeBit}${altBit}${codeBitDesc} do set ${set.nome} de ${jogo.nome}.${priceBit} Veja a imagem, acompanhe o preço e marque na sua coleção grátis no Sleevu.`;
  const img = absUrl(card.image) || "";
  const appUrl = linkDoApp(card, jogo.game, set.nome);
  const { impressoes, irmas } = vizinhas(card, cartas, slugs, baseDoSet);

  // Parágrafo de abertura: frases curtas, só com o que a carta tem. Cada fato
  // varia por carta, e é isso que separa a página de um texto de molde.
  const frases = [];
  const rarOk = card.rarity && card.rarity !== "None" &&
    !/[^\x00-\x7F]/.test(card.rarity) && String(card.rarity).length <= 24;
  const rarBit = rarOk ? ` de raridade ${card.rarity}` : "";
  const setBit = sCode ? `${set.nome} (${sCode})` : set.nome;
  frases.push(`${card.name} é uma carta${rarBit} do set ${setBit}, de ${jogo.nome}${code ? `, numerada ${code}${altCodes.length ? ` (também escrita ${altCodes.join(" ou ")})` : ""}` : ""}.`);
  if (card.artist) frases.push(`A ilustração é de ${card.artist}.`);
  const acab = Array.isArray(card.variants) ? card.variants.filter(Boolean) : [];
  if (acab.length > 1) frases.push(`Sai em ${acab.length} acabamentos (${acab.join(", ")}), que são cotados separadamente no mercado.`);
  const dtSet = dataPtBr(card.setReleaseDate);
  const totalSet = Number(card.setTotal) || 0;
  if (dtSet || totalSet) {
    frases.push(`O set ${set.nome}${dtSet ? ` foi lançado em ${dtSet}` : ""}${dtSet && totalSet ? " e" : ""}${totalSet ? ` reúne ${totalSet} cartas` : ""}.`);
  }
  if (impressoes.length) {
    frases.push(`Esta carta também aparece ${impressoes.length === 1 ? "em outra impressão" : `em outras ${impressoes.length} impressões`} neste set, e cada uma tem o seu valor de mercado.`);
  }
  if (usd > 0) frases.push("O preço de referência acima é apurado no mercado internacional; no Sleevu ele aparece convertido em reais, junto do histórico de variação.");
  frases.push(`Marque a carta na sua coleção para acompanhar o preço e ver quanto falta para completar ${set.nome}.`);

  const produto = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${card.name}${codeBit} — ${set.nome}`,
    alternateName: altCodes.length ? altCodes.map((c) => `${card.name} ${c} — ${set.nome}`) : undefined,
    sku: code || undefined,
    image: img || undefined,
    description: desc,
    brand: { "@type": "Brand", name: jogo.nome },
    url: canonical
  };
  if (usd > 0) {
    produto.offers = { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: usd.toFixed(2), offerCount: 1, availability: "https://schema.org/InStock" };
  }
  // Trilha Sleevu > Jogos > jogo > set > carta. O BreadcrumbList faz o Google
  // mostrar o caminho no lugar da URL crua, que é mais clicável.
  const trilha = [
    { nome: "Jogos", url: `${ORIGEM}/games` },
    { nome: jogo.nome, url: `${ORIGEM}/games/${jogo.url}` },
    { nome: set.nome, url: `${ORIGEM}${baseDoSet}` },
    { nome: `${card.name}${codeBit}`, url: canonical }
  ];
  const trilhaLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trilha.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.nome, item: t.url }))
  };
  const a = assets || {};
  const buildMeta = a.build ? `\n    <meta name="sleevu-build" content="${escapeAttr(a.build)}">` : "";

  return `<!doctype html>
<html lang="pt-BR" data-idioma-fixo>
  <head>
    <meta charset="utf-8">${buildMeta}
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`${card.name}${codeBit}${codeBitDesc} — ${set.nome}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    ${img ? `<meta property="og:image" content="${escapeAttr(img)}">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#e8ecf1" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#101218" media="(prefers-color-scheme: dark)">
    <script type="application/ld+json">${jsonLdSeguro(produto)}</script>
    <script type="application/ld+json">${jsonLdSeguro(trilhaLd)}</script>
    <script src="${escapeAttr(a.js || "/src/theme.js")}"></script>
    <link rel="stylesheet" href="${escapeAttr(a.css || "/styles.css")}">
${ESTILO}
  </head>
  <body>
    <header class="app-header">
      <div class="app-header-inner">
        <a class="brand" href="/">Sleevu</a>
        <nav class="page-nav" aria-label="Páginas">
          <a href="/games/${escapeAttr(jogo.url)}">Sets</a>
          <a href="/collection">Minha Coleção</a>
        </nav>
      </div>
    </header>
    <main class="prc-wrap">
      <nav class="prc-trilha" aria-label="Trilha de navegação">${trilha.map((t, i) =>
        i === trilha.length - 1
          ? `<span aria-current="page">${escapeHtml(t.nome)}</span>`
          : `<a href="${escapeAttr(t.url)}">${escapeHtml(t.nome)}</a> <span aria-hidden="true">›</span> `).join("")}</nav>
      <div class="prc-hero">
        ${img ? `<img class="prc-img" src="${escapeAttr(img)}" alt="${escapeAttr(`${card.name}${codeBit}${codeBitDesc} — ${set.nome}`)}" loading="eager" fetchpriority="high" width="320" height="447">` : ""}
        <div class="prc-info">
          <h1>${escapeHtml(card.name)}${codeBit ? ` <small>${escapeHtml(code)}${sCode ? ` · ${escapeHtml(sCode)}` : ""}</small>` : ""}</h1>
          <p class="prc-sub">${escapeHtml(`${jogo.nome} · ${set.nome}${card.rarity && card.rarity !== "None" ? ` · ${card.rarity}` : ""}`)}</p>
          ${usd > 0 ? `<p class="prc-price">US$ ${usd.toFixed(2)}</p><p class="prc-price-note">Preço de referência de mercado. No Sleevu você vê em reais e acompanha o histórico.</p>` : ""}
          <a class="prc-cta" href="${escapeAttr(appUrl)}">Marcar na minha coleção</a>
          <p class="prc-setlink">Ver o set completo: <a href="${escapeAttr(baseDoSet)}">${escapeHtml(set.nome)}</a></p>
        </div>
      </div>
      <section class="prc-corpo">
        <p>${escapeHtml(frases.join(" "))}</p>
        ${fichaTecnica(card, jogo, set, sCode)}
        ${listaDeCartas("Outras impressões desta carta", impressoes)}
        ${listaDeCartas(`Mais cartas de ${set.nome}`, irmas)}
      </section>
    </main>
  </body>
</html>
`;
}
