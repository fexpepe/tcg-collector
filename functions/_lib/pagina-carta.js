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
  return `<h3>Ficha técnica</h3>
      <dl>${linhas.map(([k, v]) =>
    `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join("")}</dl>`;
}

function listaDeCartas(titulo, itens) {
  if (!itens || !itens.length) return "";
  return `<h3>${escapeHtml(titulo)}</h3>
      <ul>${itens.map((it) =>
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

// Estilo do bloco da carta no pé da tela do app. Inline porque só existe
// nesta página (o styles.css do núcleo está no teto do orçamento de peso).
// Com JS, o bloco espera a grade do app: antes dela ele ficava na primeira
// dobra e descia quando as cartas chegavam — boa parte do CLS de 0,8 da tela
// da carta no celular (2026-10-03, docs/PLANO-TECNICO.md S3). Sem JS (o robô
// que lê este texto), o html não tem data-game e o bloco aparece como sempre.
const ESTILO = `<style>
        html[data-game] #detailGrid:empty ~ .seo-carta { display: none; }
        .seo-carta { margin: 40px 0 8px; max-width: 760px; line-height: 1.65; }
        .seo-carta summary { cursor: pointer; color: var(--muted, #9aa0aa); min-height: 44px; display: flex; align-items: center; }
        .seo-carta h3 { font-size: 1rem; margin: 22px 0 8px; }
        .seo-carta-img { float: right; width: min(180px, 38vw); height: auto; margin: 0 0 12px 16px; border-radius: 10px; }
        .seo-carta-sub, .seo-carta-nota { color: var(--muted, #9aa0aa); }
        .seo-carta-preco { font-weight: 800; }
        .seo-carta dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 20px; margin: 0; }
        .seo-carta dl div { display: flex; gap: 8px; border-bottom: 1px solid var(--line, #2d333f); padding-bottom: 6px; }
        .seo-carta dt { color: var(--muted, #9aa0aa); flex: none; }
        .seo-carta dd { margin: 0; font-weight: 600; }
        .seo-carta ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 20px; }
        .seo-carta a { color: var(--accent, #e63946); text-decoration: none; }
      </style>`;

// As peças da página da carta, pra borda pôr na tela do set do app (o endereço
// da carta é a tela do set com o popup dela aberto, como era o &card=).
// jogo: a entrada do registro (functions/_lib/jogos.js). set: { slug, nome }.
// cartas: todas as cartas da página do set; slugs: Map id -> nome no endereço.
export function pecasDaCarta({ card, jogo, set, cartas, slugs, preco }) {
  const baseDoSet = `/games/${jogo.url}/${set.slug}`;
  const caminho = `${baseDoSet}/${slugs.get(String(card.id))}`;
  const canonical = `${ORIGEM}${caminho}`;
  const code = cardCode(card);
  const codeBit = code ? ` ${code}` : "";
  const altCodes = alternateCodes(card);
  const altBit = altCodes.length ? ` (${altCodes.join(", ")})` : "";
  // Nome japonês/chinês ganha o nome em inglês entre parênteses (a busca em
  // pt/en acha igual).
  const nomeEn = card.nameEn || card.pokemonName;
  const enBit = nomeEn && !/^[\x00-\x7F]/.test(card.name) ? ` (${nomeEn})` : "";
  const sCode = codigoDoSet(card);
  const titulo = tituloDaCarta(`${card.name}${enBit}`, code, sCode, set.nome);
  const usd = Number(preco) || 0;
  const priceBit = usd > 0 ? ` Preço de referência: US$ ${usd.toFixed(2)}.` : "";
  const codeBitDesc = sCode ? ` (${sCode})` : "";
  const desc = `${card.name}${codeBit}${altBit}${codeBitDesc} do set ${set.nome} de ${jogo.nome}.${priceBit} Veja a imagem, acompanhe o preço e marque na sua coleção grátis no Sleevu.`;
  const img = absUrl(card.image) || "";
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
  if (usd > 0) frases.push("O preço de referência é apurado no mercado internacional; no Sleevu ele aparece convertido em reais, junto do histórico de variação.");
  frases.push(`Marque a carta na sua coleção para acompanhar o preço e ver quanto falta para completar ${set.nome}.`);

  // Product SÓ com preço. O Google exige offers, review ou aggregateRating
  // num Product, e o item sem nenhum dos três conta como INVÁLIDO no Search
  // Console ("Especifique offers, review ou aggregateRating", 2026-10-02, em
  // carta JP e promo sem cotação). Avaliação nós não temos e inventar oferta
  // seria mentir; então carta sem preço fica só com a trilha.
  const produto = usd > 0 ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${card.name}${codeBit} — ${set.nome}`,
    alternateName: altCodes.length ? altCodes.map((c) => `${card.name} ${c} — ${set.nome}`) : undefined,
    sku: code || undefined,
    image: img || undefined,
    description: desc,
    brand: { "@type": "Brand", name: jogo.nome },
    url: canonical,
    offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: usd.toFixed(2), offerCount: 1, availability: "https://schema.org/InStock" }
  } : null;
  // Trilha Jogos > jogo > set > carta. O BreadcrumbList faz o Google mostrar o
  // caminho no lugar da URL crua, que é mais clicável.
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

  // O texto da carta, recolhido no pé da tela: quem abre o endereço vê a
  // carta no popup (desenhado pelo JS); o robô que não roda JS lê daqui.
  // data-seo-carta deixa o detail.js tirar o bloco de uma cópia guardada que
  // chegue pra OUTRA carta. O .seo-carta-texto também aparece DENTRO do popup
  // (o detail.js copia, ver textoDaCartaNoPopup): no pé da tela, atrás da
  // grade inteira do set, nem o revisor do AdSense nem quem chegou pela busca
  // o via.
  const nomeCompleto = `${card.name}${codeBit}${codeBitDesc}`;
  const corpoHtml = `<details class="seo-carta" data-seo-carta="${escapeAttr(caminho)}">
        ${ESTILO}
        <summary>Sobre esta carta: ${escapeHtml(nomeCompleto)}</summary>
        ${img ? `<img class="seo-carta-img" src="${escapeAttr(img)}" alt="${escapeAttr(`${nomeCompleto} — ${set.nome}`)}" loading="lazy" decoding="async" width="180" height="251">` : ""}
        <p class="seo-carta-sub">${escapeHtml(`${jogo.nome} · ${set.nome}${card.rarity && card.rarity !== "None" ? ` · ${card.rarity}` : ""}`)}</p>
        ${usd > 0 ? `<p class="seo-carta-preco">US$ ${usd.toFixed(2)}</p><p class="seo-carta-nota">Preço de referência de mercado. No Sleevu você vê em reais e acompanha o histórico.</p>` : ""}
        <p class="seo-carta-texto">${escapeHtml(frases.join(" "))}</p>
        ${fichaTecnica(card, jogo, set, sCode)}
        ${listaDeCartas("Outras impressões desta carta", impressoes)}
        ${listaDeCartas(`Mais cartas de ${set.nome}`, irmas)}
        <p>Ver o set completo: <a href="${escapeAttr(baseDoSet)}">${escapeHtml(set.nome)}</a></p>
      </details>`;

  return {
    titulo,
    desc,
    canonical,
    h1: set.nome,
    ogTitulo: `${nomeCompleto} — ${set.nome}`,
    ogImagem: img,
    alternates: [],
    jsonLds: produto ? [produto, trilhaLd] : [trilhaLd],
    corpoHtml
  };
}
