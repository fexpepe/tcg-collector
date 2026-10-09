// Página de SET no endereço /games/<jogo>/<set> (2026-10-01).
//
// O endereço é a tela do set do APP (detail.html), servida pela borda em
// functions/games/[[path]].js: é o que a pessoa vê navegando no site, o que
// ela copia da barra e o que o Google indexa, tudo no mesmo lugar. Daqui sai o
// que precisa estar no HTML antes de qualquer JS: título, descrição,
// canonical, hreflang, Open Graph, JSON-LD e o índice das cartas (os links pras
// páginas de carta, que o robô sem JS segue).
//
// A variante em inglês (/games/<jogo>/<set>-en) continua estática, gerada pelo
// prerender com os MESMOS textos: por isso o SET_L10N e as réguas de título,
// data e lista moram aqui e o prerender importa daqui.
import { cardCode } from "./card-code.js";
import { ORIGEM, escapeHtml, escapeAttr, absUrl } from "./pagina-carta.js";

// ORÇAMENTO DE TÍTULO. O Google mostra ~60-65 caracteres e corta o resto com
// "…". O NOME do set nunca é truncado (é o que a pessoa digitou); quem sai são
// as partes descritivas, da menos importante pra mais.
const TITULO_MAX = 65;
// Recebe as variantes da parte descritiva em ordem decrescente de informação e
// devolve a primeira que couber; se nenhuma couber, fica só o nome + a marca.
export function tituloSet(nome, variantes) {
  const sufixo = " | Sleevu";
  for (const v of variantes) {
    const t = `${nome} — ${v}${sufixo}`;
    if (t.length <= TITULO_MAX) return t;
  }
  return nome + sufixo;
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function fmtDatePt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${Number(m[3])} de ${MONTHS_PT[Number(m[2]) - 1]} de ${m[1]}`;
}
export function fmtDateEn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${MONTHS_EN[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Textos da página de set nos DOIS idiomas (pt = padrão/x-default, en = a
// variante hreflang).
export const SET_L10N = {
  pt: {
    htmlLang: "pt-BR",
    fmtDate: fmtDatePt,
    title: (name, gameLabel) => tituloSet(name, [`cartas do set ${gameLabel}`, gameLabel]),
    desc: (n, name, gameLabel, dateHuman) => `Lista completa das ${n} cartas do set ${name} de ${gameLabel}${dateHuman ? `, lançado em ${dateHuman}` : ""}. Veja imagens, números e raridades e monte sua coleção no Sleevu.`,
    sub: (gameLabel, total, dateHuman, n) => `${gameLabel} · ${total} cartas oficiais${dateHuman ? ` · lançado em ${dateHuman}` : ""} · ${n} no catálogo do Sleevu`,
    cta: "Abrir o set no Sleevu",
    othersAria: "Outros sets",
    others: (gameLabel) => `Outros sets de ${gameLabel}`,
    navAria: "Páginas",
    // Mesmo rótulo do menu do app (nav.collection). O "Minha Coleção" de antes
    // não cabia ao lado de Sets e Pokédex numa linha de celular de 360px.
    navCollection: "Coleção"
  },
  en: {
    htmlLang: "en",
    fmtDate: fmtDateEn,
    title: (name, gameLabel) => tituloSet(name, [`${gameLabel} card list`, gameLabel]),
    desc: (n, name, gameLabel, dateHuman) => `Complete list of all ${n} cards in the ${name} set of ${gameLabel}${dateHuman ? `, released on ${dateHuman}` : ""}. See images, numbers and rarities and build your collection on Sleevu.`,
    sub: (gameLabel, total, dateHuman, n) => `${gameLabel} · ${total} official cards${dateHuman ? ` · released ${dateHuman}` : ""} · ${n} in Sleevu's catalog`,
    cta: "Open this set on Sleevu",
    othersAria: "Other sets",
    others: (gameLabel) => `Other ${gameLabel} sets`,
    navAria: "Pages",
    navCollection: "Collection"
  }
};

// Ordena "4/102" < "10/102" pelo primeiro inteiro (localeCompare erraria).
export function cmpNumber(a, b) {
  const na = parseInt(String(a || "").match(/\d+/), 10);
  const nb = parseInt(String(b || "").match(/\d+/), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

// Uma carta por NÚMERO, na língua da variante da página. Os chunks do Pokémon
// são por idioma e a página junta as edições pelo NOME do set, então "151"
// chega com as 207 cartas em inglês MAIS as 207 em português: sem isto a lista
// repetia cada carta e anunciava "415 cartas" num set de 207.
// Preferência: a língua da página → inglês → o que houver.
export function cardsForLang(cards, lang) {
  const porNumero = new Map();
  const peso = (c) => (c.language === lang ? 0 : c.language === "en" ? 1 : 2);
  for (const c of cards) {
    // Sem número não dá pra parear impressões: entra sempre (chave própria).
    const chave = c.number ? `${c.setId || ""}|${c.number}` : `id|${c.id}`;
    const atual = porNumero.get(chave);
    if (!atual || peso(c) < peso(atual)) porNumero.set(chave, c);
  }
  return [...porNumero.values()];
}

// A carta que representa o set (logo, data, total): a primeira com logo, senão
// a primeira com data, senão a primeira. As cartas vêm em ordem de número.
export function repDoSet(cards) {
  return cards.find((c) => c.setLogo) || cards.find((c) => c.setReleaseDate) || cards[0] || {};
}

// As peças da página pt do set, pra borda pôr na tela do app.
// jogo: a entrada do registro (functions/_lib/jogos.js); slug: o do set no
// endereço; cartas: todas as da página (as do mapa, fora as aposentadas);
// slugs: Map id -> nome da carta no endereço (slugsDasCartas).
export const MAX_ITENS_LD = 300; // cartas no ItemList do JSON-LD (ver `colecao`)
export function pecasDoSet({ jogo, slug, nome, cartas, slugs }) {
  const L = SET_L10N.pt;
  const ordenadas = [...(cartas || [])].sort((a, b) => cmpNumber(a.number, b.number));
  const lista = cardsForLang(ordenadas, "pt");
  const rep = repDoSet(ordenadas);
  const total = rep.setTotal || lista.length;
  const quando = L.fmtDate(rep.setReleaseDate);
  const base = `/games/${jogo.url}/${slug}`;
  const canonical = `${ORIGEM}${base}`;
  const titulo = L.title(nome, jogo.nome);
  const desc = L.desc(lista.length, nome, jogo.nome, quando);
  const urlDaCarta = (c) => `${base}/${slugs.get(String(c.id))}`;
  const codigo = (c) => (c.number ? cardCode({ number: c.number, setTotal: c.setTotal || total }) : "");
  const rotulo = (c) => `${c.name}${codigo(c) ? ` ${codigo(c)}` : ""}`;

  // CollectionPage com a lista (nome + endereço de cada carta). Sem a imagem de
  // cada uma, que a página estática antiga levava: aqui o JSON-LD viaja dentro
  // da tela do app, e 300 URLs de imagem pesavam no HTML de quem só quer usar.
  // As primeiras MAX_ITENS_LD cartas (2026-10-08): o JSON-LD mora no <head>, e
  // o "The List" do Magic (5,6 mil cartas) saía com 1,5 MB de HTML (176 KB em
  // brotli) antes de o navegador chegar ao corpo. O numberOfItems segue com o
  // total, e o caminho do robô até TODAS as páginas de carta é o índice no pé
  // da tela (corpoHtml, abaixo), que continua completo.
  const colecao = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${nome} — ${jogo.nome}`,
    url: canonical,
    description: desc,
    isPartOf: { "@type": "WebSite", "@id": ORIGEM + "/#website", name: "Sleevu", url: ORIGEM + "/" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: lista.length,
      itemListElement: lista.slice(0, MAX_ITENS_LD).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: rotulo(c), url: `${ORIGEM}${urlDaCarta(c)}` }))
    }
  };
  // Trilha Jogos > jogo > set: o Google troca a URL crua do resultado por ela.
  const trilha = [
    { nome: "Jogos", url: `${ORIGEM}/games` },
    { nome: jogo.nome, url: `${ORIGEM}/games/${jogo.url}` },
    { nome, url: canonical }
  ];
  const trilhaLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trilha.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.nome, item: t.url }))
  };

  // Com JS, ele espera a grade (html[data-game] + grade vazia = escondido) —
  // antes dela ficava na primeira dobra e descia quando as cartas chegavam
  // (CLS, 2026-10-03, docs/PLANO-TECNICO.md S3); o robô sem JS vê como sempre.
  // Índice das cartas, recolhido num <details> no pé da tela: é o caminho do
  // robô que não roda JS até as páginas de carta (a grade do app é desenhada
  // no navegador). data-indice-set deixa o detail.js tirar o índice de uma
  // cópia guardada que chegue pra OUTRO set.
  const corpoHtml = lista.length ? `<section class="set-indice" data-indice-set="${escapeAttr(base)}">
        <style>html[data-game] #detailGrid:empty~.set-indice{display:none}.set-indice{margin:40px 0 8px}.set-indice h2{font-size:1.05rem;margin:0 0 8px}.set-indice summary{cursor:pointer;color:var(--muted,#9aa0aa);min-height:44px;display:flex;align-items:center}.set-indice ul{list-style:none;padding:0;margin:12px 0 0;columns:3 220px;column-gap:24px}.set-indice li{margin:0 0 6px;break-inside:avoid}.set-indice a{color:var(--accent,#e63946);text-decoration:none}.set-indice small{color:var(--muted,#9aa0aa)}</style>
        <h2>Todas as cartas de ${escapeHtml(nome)}</h2>
        <details><summary>Ver a lista (${lista.length})</summary><ul>${lista.map((c) =>
          `<li><a href="${escapeAttr(urlDaCarta(c))}">${escapeHtml(c.name)}</a>${codigo(c) ? ` <small>${escapeHtml(codigo(c))}</small>` : ""}</li>`).join("")}</ul></details>
      </section>` : "";

  return {
    titulo,
    desc,
    canonical,
    h1: nome,
    ogTitulo: `${nome} — ${jogo.nome}`,
    ogImagem: absUrl(rep.setLogo) || "",
    alternates: [
      { hreflang: "pt-BR", href: canonical },
      { hreflang: "en", href: `${canonical}-en` },
      { hreflang: "x-default", href: canonical }
    ],
    jsonLds: [colecao, trilhaLd],
    corpoHtml
  };
}
