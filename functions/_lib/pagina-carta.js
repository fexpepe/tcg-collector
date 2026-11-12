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
import { rotuloDoDesempate } from "./desempate-carta.js";

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

// Imagem que serve de PRÉVIA (og:image, twitter:image). SVG fica de fora: o
// Facebook, o X, o WhatsApp e o Discord não desenham SVG, e os logos de set do
// Magic são todos SVG — o link colado saía sem imagem nenhuma. Sem prévia
// própria, a página fica com o og-image.png genérico (e as dimensões dele).
export function imagemDePrevia(u) {
  const s = absUrl(u);
  return /\.svgz?(?:[?#]|$)/i.test(s) ? "" : s;
}

// Preço de referência em US$: o `u` do preço (mercado americano) ou, sem ele,
// o do Cardmarket (EUR) com a margem que o ranqueamento antigo já usava. Só
// serve pra ORDENAR; o que a página mostra é o precoDeReferencia.
export function precoUSD(entrada) {
  if (!entrada) return 0;
  if (entrada.u > 0) return entrada.u;
  if (entrada.e > 0) return entrada.e * 1.1;
  return 0;
}

// O preço que a página MOSTRA, na moeda em que ele foi cotado: o `u` em US$
// ou, sem ele, o do Cardmarket em €. Até 2026-10-13 a página exibia o euro
// convertido (× 1,1) com "US$" na frente, e o JSON-LD anunciava esse número
// como USD: um preço que não existe em mercado nenhum (o build já avisava
// "não exibimos convertido"). É a mesma régua do precoTexto do blog.
export function precoDeReferencia(entrada) {
  if (!entrada) return null;
  if (entrada.u > 0) return { valor: Number(entrada.u), moeda: "USD" };
  if (entrada.e > 0) return { valor: Number(entrada.e), moeda: "EUR" };
  return null;
}
const SIMBOLO = { USD: "US$", EUR: "€" };
// "US$ 1.234,50": o texto da página é em português (o JSON-LD segue com ponto).
function precoPtBr(valor, moeda) {
  const [inteiro, centavos] = valor.toFixed(2).split(".");
  return `${SIMBOLO[moeda] || moeda} ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function dataPtBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : "";
}

const MESES_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function dataNaLingua(iso, lang) {
  if (lang === "pt") return dataPtBr(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  const i = m ? Number(m[2]) - 1 : -1;
  if (i < 0 || i > 11) return "";
  return lang === "es" ? `${Number(m[3])} de ${MESES_ES[i]} de ${m[1]}` : `${MESES_EN[i]} ${Number(m[3])}, ${m[1]}`;
}

// ── O que a carta é, nas três línguas (2026-11-11) ──────────────────────────
// O relatório de Páginas de 10/11 (docs/SEO.md) tinha 9.626 cartas
// "rastreadas, mas não indexadas": na mediana, só uns 20% do parágrafo eram
// próprios da carta, e pesavam mais as ~42 mil japonesas e chinesas do
// Pokémon. A página delas não dizia em lugar nenhum que a carta é japonesa ou
// chinesa (só a ficha, com "Idioma"), e a ficha saía com o que o catálogo
// guarda em inglês ou em japonês ("Tipo: Pokemon", "Estágio: Basic",
// "Série: 剣と盾") no meio do texto em português. As tabelas abaixo dão
// nome, nas três línguas do site, ao que o catálogo já sabe da carta (a
// série, só na ficha, que é em português).

// Edição (o idioma impresso). Chave: o `language` do catálogo, com zh-cn e
// zh-tw separados (simplificado na China, tradicional em Taiwan e Hong Kong:
// são impressões diferentes, e o colecionador procura por elas assim).
const EDICAO = {
  ja: { pt: "japonesa", en: "Japanese", es: "japonesa" },
  "zh-cn": { pt: "em chinês simplificado", en: "Simplified Chinese", es: "en chino simplificado" },
  "zh-tw": { pt: "em chinês tradicional", en: "Traditional Chinese", es: "en chino tradicional" },
  zh: { pt: "em chinês", en: "Chinese", es: "en chino" },
  ko: { pt: "coreana", en: "Korean", es: "coreana" },
  pt: { pt: "em português", en: "Portuguese", es: "en portugués" },
  fr: { pt: "em francês", en: "French", es: "en francés" },
  de: { pt: "em alemão", en: "German", es: "en alemán" },
  it: { pt: "em italiano", en: "Italian", es: "en italiano" },
  es: { pt: "em espanhol", en: "Spanish", es: "en español" }
};
export function edicaoDaCarta(card) {
  const l = String((card && card.language) || "en").toLowerCase();
  if (/^zh-(tw|hk)/.test(l)) return "zh-tw";
  if (l.startsWith("zh-cn")) return "zh-cn";
  const k = l.slice(0, 2);
  return k === "en" || !EDICAO[k] ? "" : k;
}

// Pokémon: categoria, estágio, tipo de energia, tipo de treinador e de
// energia. O catálogo guarda em inglês (TCGdex en e ja, TCGCSV) ou em
// português (TCGdex pt); os dois lados viram a mesma chave. O pt de saída é o
// da TCGdex pt, o mesmo que as cartas brasileiras já mostram no site; o es,
// o da TCGdex es (api.tcgdex.net/v2/es/types, stages, trainer-types).
const TERMOS = {
  pokemon: { de: ["Pokemon", "Pokémon"], pt: "Pokémon", en: "Pokémon", es: "Pokémon" },
  trainer: { de: ["Trainer", "Treinador"], pt: "Treinador", en: "Trainer", es: "Entrenador" },
  energy: { de: ["Energy", "Energia"], pt: "Energia", en: "Energy", es: "Energía" },
  basic: { de: ["Basic", "Básico"], pt: "Básico", en: "Basic", es: "Básico" },
  stage1: { de: ["Stage1", "Stage 1", "Estágio 1"], pt: "Estágio 1", en: "Stage 1", es: "Fase 1" },
  stage2: { de: ["Stage2", "Stage 2", "Estágio 2"], pt: "Estágio 2", en: "Stage 2", es: "Fase 2" },
  baby: { de: ["Baby"], pt: "Bebê", en: "Baby", es: "Bebé" },
  restored: { de: ["RESTORED", "RESTAURADO", "RECREADO"], pt: "Restaurado", en: "Restored", es: "Recreado" },
  // Mecânicas: o nome é o mesmo, menos o VSTAR, que a TCGdex pt e es chama de
  // V-ASTRO (é o que as cartas brasileiras do site já mostram).
  vmax: { de: ["VMAX"], pt: "VMAX", en: "VMAX", es: "VMAX" },
  vstar: { de: ["VSTAR", "V-ASTRO"], pt: "V-ASTRO", en: "VSTAR", es: "V-ASTRO" },
  vunion: { de: ["V-UNION", "V-UNIÓN"], pt: "V-UNION", en: "V-UNION", es: "V-UNIÓN" },
  break: { de: ["BREAK"], pt: "BREAK", en: "BREAK", es: "BREAK" },
  lvx: { de: ["LV.X"], pt: "LV.X", en: "LV.X", es: "LV.X" },
  grass: { de: ["Grass", "Planta"], pt: "Planta", en: "Grass", es: "Planta" },
  fire: { de: ["Fire", "Fogo"], pt: "Fogo", en: "Fire", es: "Fuego" },
  water: { de: ["Water", "Água"], pt: "Água", en: "Water", es: "Agua" },
  lightning: { de: ["Lightning", "Elétrico"], pt: "Elétrico", en: "Lightning", es: "Rayo" },
  psychic: { de: ["Psychic", "Psíquico"], pt: "Psíquico", en: "Psychic", es: "Psíquico" },
  fighting: { de: ["Fighting", "Lutador"], pt: "Lutador", en: "Fighting", es: "Lucha" },
  darkness: { de: ["Darkness", "Sombrio"], pt: "Sombrio", en: "Darkness", es: "Oscura" },
  metal: { de: ["Metal"], pt: "Metal", en: "Metal", es: "Metálica" },
  dragon: { de: ["Dragon", "Dragão"], pt: "Dragão", en: "Dragon", es: "Dragón" },
  fairy: { de: ["Fairy", "Fada"], pt: "Fada", en: "Fairy", es: "Hada" },
  colorless: { de: ["Colorless", "Incolor"], pt: "Incolor", en: "Colorless", es: "Incolora" },
  supporter: { de: ["Supporter", "Apoiador"], pt: "Apoiador", en: "Supporter", es: "Partidario" },
  item: { de: ["Item"], pt: "Item", en: "Item", es: "Objeto" },
  tool: { de: ["Tool", "Ferramenta"], pt: "Ferramenta", en: "Pokémon Tool", es: "Herramienta" },
  stadium: { de: ["Stadium", "Estádio"], pt: "Estádio", en: "Stadium", es: "Estadio" },
  tm: { de: ["Technical Machine"], pt: "Máquina Técnica", en: "Technical Machine", es: "Máquina Técnica" },
  normal: { de: ["Normal"], pt: "Básica", en: "Basic", es: "Básica" },
  special: { de: ["Special", "Especial"], pt: "Especial", en: "Special", es: "Especial" }
};
const CHAVE_DO_TERMO = new Map();
for (const [k, v] of Object.entries(TERMOS)) for (const d of v.de) CHAVE_DO_TERMO.set(d.toLowerCase(), k);
const chaveDoTermo = (s) => CHAVE_DO_TERMO.get(String(s == null ? "" : s).trim().toLowerCase()) || "";
const termo = (k, lang) => (TERMOS[k] ? TERMOS[k][lang] || TERMOS[k].pt : "");
// "Darkness;Metal", "Psychic, Metal" ou array: os tipos conhecidos, sem repetir.
const TIPOS_DE_ENERGIA = new Set(["grass", "fire", "water", "lightning", "psychic", "fighting", "darkness", "metal", "dragon", "fairy", "colorless"]);
function chavesDosTipos(v) {
  const lista = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[;,]/);
  return [...new Set(lista.map(chaveDoTermo).filter((k) => TIPOS_DE_ENERGIA.has(k)))];
}

// Kana, CJK e formas de largura cheia, montado por código como no
// slug-carta.js (as ferramentas de edição trocam o escape unicode pelo
// caractere literal sem avisar).
const faixa = (a, b) => String.fromCharCode(a) + "-" + String.fromCharCode(b);
const CJK_NOME = new RegExp("[" + faixa(0x3040, 0x30ff) + faixa(0x3400, 0x9fff) + faixa(0xff00, 0xffef) + "]");

// Série (a era do Pokémon TCG) na ficha, pelo id que o catálogo guarda:
// minúsculo nos sets da TCGdex en/pt ("swsh"), maiúsculo nos japoneses e
// chineses ("S", "SV"). Na ficha das japonesas saía "Série: 剣と盾"; agora sai
// "Espada e Escudo (剣と盾)": o original fica, que é como ela vem impressa e
// como o colecionador de lá procura.
const SERIES = {
  sv: "Escarlate e Violeta", swsh: "Espada e Escudo", s: "Espada e Escudo", sm: "Sol e Lua",
  xy: "XY", bw: "Preto e Branco", dp: "Diamante e Pérola", pl: "Platina", pt: "Platina", dpt: "Platina",
  hgss: "HeartGold e SoulSilver", me: "Megaevolução", m: "Megaevolução", ex: "EX", neo: "Neo",
  ecard: "e-Card", e: "e-Card", pmcg: "Pocket Monsters Card Game"
};
export function serieDaCarta(card) {
  const id = String((card && card.setSerieId) || "").trim().toLowerCase();
  const original = String((card && card.setSerieName) || "").trim();
  const nome = SERIES[id] || "";
  if (!nome) return original;
  return CJK_NOME.test(original) ? `${nome} (${original})` : nome;
}

// O que a carta é no jogo, só no Pokémon (os outros jogos guardam outra
// coisa nesses campos): { cat, estagio, tipos, sub, dex, especie }.
export function especieDaCarta(card, game) {
  if (game !== "pokemon" || !card) return null;
  const cat = chaveDoTermo(card.category);
  if (cat === "pokemon") {
    const estagio = chaveDoTermo(card.stage);
    return {
      cat,
      estagio: ["basic", "stage1", "stage2", "baby", "restored", "vmax", "vstar", "vunion", "break", "lvx"].includes(estagio) ? estagio : "",
      tipos: chavesDosTipos(card.types),
      dex: Number(card.dexId) > 0 ? Number(card.dexId) : 0,
      especie: String(card.pokemonName || "").trim()
    };
  }
  if (cat === "trainer") {
    const sub = chaveDoTermo(card.trainerType);
    return { cat, sub: ["supporter", "item", "tool", "stadium", "tm"].includes(sub) ? sub : "" };
  }
  if (cat === "energy") {
    const sub = chaveDoTermo(card.energyType);
    return { cat, sub: ["normal", "special"].includes(sub) ? sub : "" };
  }
  return null;
}

// Carta secreta: o número impresso passa do total do set ("201/173"). É o
// que o colecionador de Pokémon chama de secret rare; nos outros jogos o
// número além do total quer dizer outra coisa (no Magic, as variantes de
// colecionador), por isso só no Pokémon.
export function eSecreta(card, game) {
  if (game !== "pokemon" || !card) return false;
  const n = String(card.number || "").trim();
  const t = String(card.setTotal || "").trim();
  return /^\d+$/.test(n) && /^\d+$/.test(t) && Number(t) > 0 && Number(n) > Number(t);
}

// "Psíquico", "Sombrio e Metal".
function listaNaLingua(nomes, lang) {
  if (nomes.length < 2) return nomes.join("");
  const e = lang === "en" ? " and " : lang === "es" ? " y " : " e ";
  return nomes.slice(0, -1).join(", ") + e + nomes[nomes.length - 1];
}

// A frase "é um Pokémon Básico do tipo Psíquico, o nº 716 da Pokédex".
// A espécie entra entre parênteses quando o nome da carta não a traz
// ("Rocket's Mewtwo" traz; "Here Comes Team Rocket!" não é Pokémon).
function fraseDaEspecie(lang, e, nomesDaCarta) {
  if (!e) return "";
  if (e.cat === "pokemon") {
    // "É um Pokémon." sozinho não diz nada.
    if (!e.estagio && !e.tipos.length && !e.dex) return "";
    const est = e.estagio ? termo(e.estagio, lang) : "";
    const tipos = listaNaLingua(e.tipos.map((k) => termo(k, lang)), lang);
    const plural = e.tipos.length > 1;
    const traz = e.especie && nomesDaCarta.some((n) => n.toLowerCase().includes(e.especie.toLowerCase()));
    const esp = e.especie && !traz && !CJK_NOME.test(e.especie) ? ` (${e.especie})` : "";
    if (lang === "en") {
      const tipoBit = tipos ? ` ${tipos}-type` : "";
      return `It is a${/^[AEIOU]/i.test(est || tipos || "P") ? "n" : ""}${est ? ` ${est}` : ""}${tipoBit} Pokémon${e.dex ? `, No. ${e.dex} in the Pokédex${esp}` : ""}.`;
    }
    if (lang === "es") {
      return `Es un Pokémon${est ? ` ${est}` : ""}${tipos ? ` de tipo${plural ? "s" : ""} ${tipos}` : ""}${e.dex ? `, el n.º ${e.dex} de la Pokédex${esp}` : ""}.`;
    }
    return `É um Pokémon${est ? ` ${est}` : ""}${tipos ? ` do${plural ? "s" : ""} tipo${plural ? "s" : ""} ${tipos}` : ""}${e.dex ? `, o nº ${e.dex} da Pokédex${esp}` : ""}.`;
  }
  const cat = termo(e.cat, lang);
  const sub = e.sub ? termo(e.sub, lang) : "";
  if (e.cat === "energy") {
    if (lang === "en") return `It is a${sub ? ` ${sub}` : "n"} Energy card.`;
    if (lang === "es") return `Es una carta de Energía${sub ? ` ${sub}` : ""}.`;
    return `É uma carta de Energia${sub ? ` ${sub}` : ""}.`;
  }
  if (lang === "en") return `It is a ${cat} card${sub ? ` (${sub})` : ""}.`;
  if (lang === "es") return `Es una carta de ${cat}${sub ? ` de tipo ${sub}` : ""}.`;
  return `É uma carta de ${cat}${sub ? ` do tipo ${sub}` : ""}.`;
}

function fraseDaSecreta(lang, f) {
  if (!f.secreta) return "";
  if (lang === "en") return `Its number (${f.numero}) is above the set's printed total (${f.total}): it is a secret rare, outside the regular numbering.`;
  if (lang === "es") return `Su número (${f.numero}) supera el total impreso del set (${f.total}): es una carta secreta, fuera de la numeración regular.`;
  return `O número dela (${f.numero}) passa do total impresso do set (${f.total}): é uma carta secreta, fora da numeração regular.`;
}

// ── O mercado DA carta (2026-11-11) ─────────────────────────────────────────
// A frase do preço era molde ("o preço de referência é apurado no mercado
// americano; no Sleevu ele aparece convertido em reais…"), igual nas 340 mil
// páginas. O chunk de preço que a borda já lê pra achar o preço traz mais:
// o valor de cada acabamento (`v`), as vendas graduadas PSA (`g`) e o preço
// das outras cartas do set, que dá a posição desta no set. São números da
// carta, que nenhuma outra página repete.

// Valor em texto: "US$ 1.234,50" (pt e es) e "US$1,234.50" (en).
function precoNaLingua(valor, moeda, lang) {
  if (lang !== "en") return precoPtBr(valor, moeda);
  const [inteiro, centavos] = Number(valor).toFixed(2).split(".");
  return `${SIMBOLO[moeda] || moeda}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${centavos}`;
}

// Acabamento do preço por variante, na ordem em que o colecionador lista.
const ACABAMENTO = {
  Normal: { pt: "Normal", en: "Normal", es: "Normal" },
  Holo: { pt: "Holo", en: "Holo", es: "Holo" },
  Reverse: { pt: "Reverse Holo", en: "Reverse Holo", es: "Reverse Holo" },
  "1st Edition": { pt: "1ª Edição", en: "1st Edition", es: "1.ª Edición" }
};

// Edição no plural, pra "entre as 30 cartas japonesas do set" quando a página
// do set mistura idiomas (o 151 inglês traz as impressões em português).
const EDICAO_PLURAL = {
  "": { pt: "em inglês", en: "English", es: "en inglés" },
  ja: { pt: "japonesas", en: "Japanese", es: "japonesas" },
  ko: { pt: "coreanas", en: "Korean", es: "coreanas" }
};
function edicaoNoPlural(ed, lang) {
  if (EDICAO_PLURAL[ed]) return EDICAO_PLURAL[ed][lang];
  return EDICAO[ed] ? EDICAO[ed][lang] : "";
}

// { valor, moeda, posicao, comPreco, edicaoDoRanking, topo, variantes, psa }
// precoDe(carta) devolve a entrada do chunk de preço ({ u, e, v, g }) ou null.
export function mercadoDaCarta(card, cartas, precoDe, nomeDaCarta) {
  if (typeof precoDe !== "function") return null;
  const entrada = precoDe(card);
  const ref = precoDeReferencia(entrada);
  if (!ref) return null;
  // Posição no set, entre as cartas da MESMA edição: a impressão em
  // português não tem preço próprio e herda o da inglesa (basePricingId), e
  // contaria a mesma carta duas vezes. Ordena por precoUSD (o euro com a
  // margem), como o resto do site.
  const ed = edicaoDaCarta(card);
  const mesmaEdicao = (cartas || []).filter((c) => edicaoDaCarta(c) === ed);
  const comPreco = mesmaEdicao.map((c) => ({ c, usd: precoUSD(precoDe(c)) })).filter((x) => x.usd > 0)
    .sort((a, b) => b.usd - a.usd || String(a.c.id).localeCompare(String(b.c.id)));
  const i = comPreco.findIndex((x) => x.c.id === card.id);
  const topoRef = comPreco.length && i > 0 ? precoDeReferencia(precoDe(comPreco[0].c)) : null;
  const variantes = entrada.v && typeof entrada.v === "object"
    ? Object.keys(ACABAMENTO).filter((k) => Number(entrada.v[k]) > 0).map((k) => [k, Number(entrada.v[k])])
    : [];
  const psa = entrada.g && typeof entrada.g === "object"
    ? Object.keys(entrada.g).filter((k) => entrada.g[k] && Number(entrada.g[k].s) > 0)
      .sort((a, b) => parseFloat(b) - parseFloat(a)).slice(0, 2)
      .map((k) => ({ nota: k, valor: Number(entrada.g[k].s), vendas: Number(entrada.g[k].n) || 0 }))
    : [];
  const multiIdioma = new Set((cartas || []).map(edicaoDaCarta)).size > 1;
  return {
    valor: ref.valor,
    moeda: ref.moeda,
    posicao: i >= 0 && comPreco.length > 1 ? i + 1 : 0,
    comPreco: comPreco.length,
    edicaoDoRanking: multiIdioma ? ed : null,
    topo: topoRef ? { nome: nomeDaCarta(comPreco[0].c), valor: topoRef.valor, moeda: topoRef.moeda } : null,
    variantes: variantes.length > 1 ? variantes : [],
    psa
  };
}

const ordinalEn = (n) => {
  const d = n % 100;
  const suf = d >= 11 && d <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${suf}`;
};

// As frases do preço: o valor e a posição no set, os acabamentos com preço e
// as vendas graduadas. Sem preço, nada (não há o que dizer de mercado).
function frasesDoMercado(lang, m) {
  if (!m) return [];
  const frases = [];
  const p = (v, moeda) => precoNaLingua(v, moeda, lang);
  const eur = m.moeda === "EUR";
  const quantas = m.comPreco;
  const deQuem = m.edicaoDoRanking == null ? "" : edicaoNoPlural(m.edicaoDoRanking, lang);
  if (lang === "en") {
    frases.push(`Its reference price is ${p(m.valor, m.moeda)} on the ${eur ? "European market (Cardmarket)" : "US market"}.`);
    if (m.posicao === 1) frases.push(`It is the most valuable of the ${quantas}${deQuem ? ` ${deQuem}` : ""} cards in the set with a price.`);
    else if (m.posicao > 1) frases.push(`Among the ${quantas}${deQuem ? ` ${deQuem}` : ""} cards in the set with a price, it ranks ${ordinalEn(m.posicao)}; the most valuable is ${m.topo.nome} (${p(m.topo.valor, m.topo.moeda)}).`);
    if (m.variantes.length) frases.push(`By finish: ${listaNaLingua(m.variantes.map(([k, v]) => `${ACABAMENTO[k].en} ${p(v, "USD")}`), "en")}.`);
    if (m.psa.length) frases.push(`Graded by PSA, its last recorded eBay sale was ${listaNaLingua(m.psa.map((g) => `${p(g.valor, "USD")} in grade ${g.nota}${g.vendas ? ` (${g.vendas} ${g.vendas === 1 ? "sale" : "sales"})` : ""}`), "en")}.`);
  } else if (lang === "es") {
    frases.push(`Su precio de referencia es ${p(m.valor, m.moeda)}, en el mercado ${eur ? "europeo (Cardmarket)" : "estadounidense"}.`);
    if (m.posicao === 1) frases.push(`Es la más valiosa de las ${quantas} cartas${deQuem ? ` ${deQuem}` : ""} del set con precio.`);
    else if (m.posicao > 1) frases.push(`Entre las ${quantas} cartas${deQuem ? ` ${deQuem}` : ""} del set con precio, es la ${m.posicao}.ª más valiosa; la primera es ${m.topo.nome} (${p(m.topo.valor, m.topo.moeda)}).`);
    if (m.variantes.length) frases.push(`Por acabado: ${listaNaLingua(m.variantes.map(([k, v]) => `${ACABAMENTO[k].es} ${p(v, "USD")}`), "es")}.`);
    if (m.psa.length) frases.push(`Graduada por PSA, su última venta registrada en eBay fue de ${listaNaLingua(m.psa.map((g) => `${p(g.valor, "USD")} con nota ${g.nota}${g.vendas ? ` (${g.vendas} ${g.vendas === 1 ? "venta" : "ventas"})` : ""}`), "es")}.`);
  } else {
    frases.push(`O preço de referência dela é ${p(m.valor, m.moeda)}, no mercado ${eur ? "europeu (Cardmarket)" : "americano"}.`);
    if (m.posicao === 1) frases.push(`É a mais valiosa das ${quantas} cartas${deQuem ? ` ${deQuem}` : ""} do set com preço.`);
    else if (m.posicao > 1) frases.push(`Entre as ${quantas} cartas${deQuem ? ` ${deQuem}` : ""} do set com preço, é a ${m.posicao}ª mais valiosa; a primeira é ${m.topo.nome} (${p(m.topo.valor, m.topo.moeda)}).`);
    if (m.variantes.length) frases.push(`Por acabamento: ${listaNaLingua(m.variantes.map(([k, v]) => `${ACABAMENTO[k].pt} ${p(v, "USD")}`), "pt")}.`);
    if (m.psa.length) frases.push(`Graduada pela PSA, a última venda registrada no eBay foi de ${listaNaLingua(m.psa.map((g) => `${p(g.valor, "USD")} na nota ${g.nota}${g.vendas ? ` (${g.vendas} ${g.vendas === 1 ? "venda" : "vendas"})` : ""}`), "pt")}.`);
  }
  return frases;
}

// O parágrafo "Sobre esta carta" num idioma (pt, en ou es). Frases curtas, só
// com o que a carta tem: cada fato varia por carta, e é isso que separa a
// página de um texto de molde. O pt é o que o robô lê (theme.js); en e es vão
// em <template> pro popup de quem usa o site nesses idiomas (detail.js,
// textoDaCartaNoPopup). Até 2026-10-13 só o pt existia, e quem abria a carta
// em inglês via só a tela de ação (Não tenho, +, preço): o que fez o AdSense
// reprovar o site por "Low value content".
// f: { nome, nomes, rar, edicao, setBit, setNome, jogo, code, alt, artista, acab,
//      iso, total, numero, secreta, especie, nImpressoes, mercado,
//      valor, moeda (só quando não há mercado: quem chama sem o chunk de preço) }
export function textoDaCarta(lang, f) {
  const frases = [];
  const dt = dataNaLingua(f.iso, lang);
  const t = f.total;
  const eur = f.moeda === "EUR";
  const ed = f.edicao && EDICAO[f.edicao] ? EDICAO[f.edicao][lang] : "";
  const especie = fraseDaEspecie(lang, f.especie, f.nomes || [f.nome]);
  const secreta = fraseDaSecreta(lang, f);
  const mercado = frasesDoMercado(lang, f.mercado);
  // Os acabamentos sem preço por acabamento (o preço por acabamento, quando
  // existe, sai nas frases do mercado).
  const acab = f.acab.length > 1 && !(f.mercado && f.mercado.variantes.length);
  if (lang === "en") {
    // "the Base Set set": set cujo nome já termina em "Set" não ganha outro.
    const jaDizSet = /\bset$/i.test(f.setNome);
    frases.push(`${f.nome} is a card from the ${ed ? `${ed} edition of the ` : ""}${f.setBit}${jaDizSet ? "" : " set"} of ${f.jogo}${f.rar ? `, rarity ${f.rar}` : ""}${f.code ? `, numbered ${f.code}${f.alt.length ? ` (also written ${f.alt.join(" or ")})` : ""}` : ""}.`);
    if (especie) frases.push(especie);
    if (secreta) frases.push(secreta);
    if (f.artista) frases.push(`The illustration is by ${f.artista}.`);
    if (acab) frases.push(`It comes in ${f.acab.length} finishes (${f.acab.join(", ")}), each priced separately on the market.`);
    if (dt || t) frases.push(`The ${f.setNome}${jaDizSet ? "" : " set"}${dt ? ` was released on ${dt}` : ""}${dt && t ? " and" : ""}${t ? ` has ${t} cards` : ""}.`);
    if (f.nImpressoes) frases.push(`This card also appears ${f.nImpressoes === 1 ? "in another print" : `in ${f.nImpressoes} other prints`} in this set.`);
    if (mercado.length) frases.push(...mercado);
    else if (f.valor > 0) frases.push(`The reference price comes from the ${eur ? "European market (Cardmarket)" : "US market"}; on Sleevu it is shown in your currency, along with its price history.`);
    frases.push(`Add the card to your collection to track its price and see how much is left to complete ${f.setNome}.`);
  } else if (lang === "es") {
    frases.push(`${f.nome} es una carta ${ed ? `de la edición ${ed} ` : ""}del set ${f.setBit}, de ${f.jogo}${f.rar ? `, de rareza ${f.rar}` : ""}${f.code ? `, numerada ${f.code}${f.alt.length ? ` (también escrita ${f.alt.join(" o ")})` : ""}` : ""}.`);
    if (especie) frases.push(especie);
    if (secreta) frases.push(secreta);
    if (f.artista) frases.push(`La ilustración es de ${f.artista}.`);
    if (acab) frases.push(`Sale en ${f.acab.length} acabados (${f.acab.join(", ")}), que se cotizan por separado en el mercado.`);
    if (dt || t) frases.push(`El set ${f.setNome}${dt ? ` salió el ${dt}` : ""}${dt && t ? " y" : ""}${t ? ` reúne ${t} cartas` : ""}.`);
    if (f.nImpressoes) frases.push(`Esta carta también aparece ${f.nImpressoes === 1 ? "en otra impresión" : `en otras ${f.nImpressoes} impresiones`} en este set.`);
    if (mercado.length) frases.push(...mercado);
    else if (f.valor > 0) frases.push(`El precio de referencia viene del mercado ${eur ? "europeo (Cardmarket)" : "estadounidense"}; en Sleevu aparece convertido a tu moneda, junto con su historial de precios.`);
    frases.push(`Marca la carta en tu colección para seguir su precio y ver cuánto te falta para completar ${f.setNome}.`);
  } else {
    frases.push(`${f.nome} é uma carta${f.rar ? ` de raridade ${f.rar}` : ""}${ed ? ` da edição ${ed}` : ""} do set ${f.setBit}, de ${f.jogo}${f.code ? `, numerada ${f.code}${f.alt.length ? ` (também escrita ${f.alt.join(" ou ")})` : ""}` : ""}.`);
    if (especie) frases.push(especie);
    if (secreta) frases.push(secreta);
    if (f.artista) frases.push(`A ilustração é de ${f.artista}.`);
    if (acab) frases.push(`Sai em ${f.acab.length} acabamentos (${f.acab.join(", ")}), que são cotados separadamente no mercado.`);
    if (dt || t) frases.push(`O set ${f.setNome}${dt ? ` foi lançado em ${dt}` : ""}${dt && t ? " e" : ""}${t ? ` reúne ${t} cartas` : ""}.`);
    if (f.nImpressoes) frases.push(`Esta carta também aparece ${f.nImpressoes === 1 ? "em outra impressão" : `em outras ${f.nImpressoes} impressões`} neste set.`);
    if (mercado.length) frases.push(...mercado);
    else if (f.valor > 0) frases.push(`O preço de referência é apurado no mercado ${eur ? "europeu (Cardmarket)" : "americano"}; no Sleevu ele aparece convertido em reais, junto do histórico de variação.`);
    frases.push(`Marque a carta na sua coleção para acompanhar o preço e ver quanto falta para completar ${f.setNome}.`);
  }
  return frases.join(" ");
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

// Chinês simplificado e tradicional separados desde 2026-11-11 (ver EDICAO).
const IDIOMA = { pt: "Português", ja: "Japonês", zh: "Chinês", "zh-cn": "Chinês simplificado", "zh-tw": "Chinês tradicional", ko: "Coreano", fr: "Francês", de: "Alemão", it: "Italiano", es: "Espanhol" };
function rotuloDoIdioma(card) {
  const l = String(card.language || "en").toLowerCase().slice(0, 2);
  if (l === "en") return "";
  return IDIOMA[edicaoDaCarta(card)] || IDIOMA[l] || l.toUpperCase();
}

// Os valores do Pokémon na ficha em português (2026-11-11): o catálogo guarda
// "Pokemon", "Basic", "Psychic" (e "剣と盾" na série das japonesas). Termo que
// a tabela não conhece sai como veio.
function emPortugues(valor) {
  const k = chaveDoTermo(valor);
  return k ? termo(k, "pt") : String(valor == null ? "" : valor).trim();
}
function tiposEmPortugues(v) {
  const lista = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[;,]/);
  return lista.map((s) => emPortugues(s)).filter(Boolean).join(", ");
}

// Ficha técnica: só as linhas que a carta TEM (cada jogo traz um subconjunto:
// Magic tem custo de mana, Pokémon tem HP, One Piece tem cor).
function fichaTecnica(card, jogo, set, sCode) {
  const poke = jogo.game === "pokemon";
  const tipoDaCarta = (() => {
    if (!poke || card.cardType) return card.cardType || card.category;
    const sub = card.trainerType || card.energyType;
    return `${emPortugues(card.category)}${sub && card.category ? ` (${emPortugues(sub)})` : ""}`;
  })();
  const linhas = [
    ["Jogo", jogo.nome],
    ["Set", sCode ? `${set.nome} (${sCode})` : set.nome],
    ["Número", cardCode(card)],
    ["Idioma", rotuloDoIdioma(card)],
    ["Raridade", card.rarity && card.rarity !== "None" ? card.rarity : ""],
    ["Ilustrador", card.artist],
    ["Tipo", tipoDaCarta],
    ["Estágio", poke ? emPortugues(card.stage) : card.stage],
    ["Tipos", poke ? tiposEmPortugues(card.types) : (Array.isArray(card.types) ? card.types.join(", ") : card.types)],
    ["Custo", card.manaCost || (card.cost != null && card.cost !== "" ? String(card.cost) : "")],
    ["Poder", card.power],
    ["Cor", card.color || card.colorId || card.ink || card.opColor],
    ["HP", card.hp],
    ["Série", poke ? serieDaCarta(card) : card.setSerieName],
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

// "ゼルネアス (Xerneas) 012/028": como a carta aparece citada no texto de
// outra (a mais valiosa do set), com o nome em inglês quando o dela é em
// japonês ou chinês.
function rotuloDaCarta(c) {
  const en = c.nameEn || c.pokemonName;
  const enBit = en && CJK_NOME.test(String(c.name || "")) && !CJK_NOME.test(en) ? ` (${en})` : "";
  return `${c.name}${enBit} ${cardCode(c)}`.trim();
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
        .seo-carta summary h2 { font: inherit; margin: 0; }
        .seo-carta h3 { font-size: 1rem; margin: 22px 0 8px; }
        .seo-carta-img { float: right; width: min(180px, 38vw); height: auto; margin: 0 0 12px 16px; border-radius: 10px; }
        .seo-carta-sub { color: var(--muted, #9aa0aa); }
        .seo-carta-preco { font-weight: 800; }
        .seo-carta dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 20px; margin: 0; }
        .seo-carta dl div { display: flex; gap: 8px; border-bottom: 1px solid var(--line, #2d333f); padding-bottom: 6px; }
        .seo-carta dt { color: var(--muted, #9aa0aa); flex: none; }
        .seo-carta dd { margin: 0; font-weight: 600; }
        .seo-carta ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 20px; }
        .seo-carta a { color: var(--accent, #e63946); text-decoration: none; }
      </style>`;

// As peças da página da carta, pra borda pôr na casca do app (detail.html). Desde
// 2026-10-13 o endereço da carta mostra a CARTA como página (a tela da carta no
// fluxo, ver createCardPreview no shared.js); antes era a tela do set com o
// popup dela aberto, como era o &card=.
// jogo: a entrada do registro (functions/_lib/jogos.js). set: { slug, nome }.
// cartas: todas as cartas da página do set; slugs: Map id -> nome no endereço.
// preco: o valor (número) na `moeda` ("USD" ou "EUR", ver precoDeReferencia).
// precoDe (opcional): carta -> entrada do chunk de preço ({ u, e, v, g }), pra
// posição no set, preço por acabamento e PSA (ver mercadoDaCarta).
export function pecasDaCarta({ card, jogo, set, cartas, slugs, preco, moeda = "USD", precoDe = null }) {
  const baseDoSet = `/games/${jogo.url}/${set.slug}`;
  const caminho = `${baseDoSet}/${slugs.get(String(card.id))}`;
  const canonical = `${ORIGEM}${caminho}`;
  const code = cardCode(card);
  // Carta com o mesmo nome e número de outra do set (edição chinesa,
  // raridade): o que a separa vai junto do número, no título, no h1, na
  // descrição e no Product (ver desempate-carta.js).
  const desempate = rotuloDoDesempate(card, cartas);
  const codeBit = `${code ? ` ${code}` : ""}${desempate ? ` (${desempate})` : ""}`;
  const altCodes = alternateCodes(card);
  const altBit = altCodes.length ? ` (${altCodes.join(", ")})` : "";
  // Nome japonês/chinês ganha o nome em inglês entre parênteses (a busca em
  // pt/en acha igual).
  const nomeEn = card.nameEn || card.pokemonName;
  const enBit = nomeEn && !/^[\x00-\x7F]/.test(card.name) ? ` (${nomeEn})` : "";
  const sCode = codigoDoSet(card);
  const titulo = tituloDaCarta(`${card.name}${enBit}`, code, [sCode, desempate && `(${desempate})`].filter(Boolean).join(" "), set.nome);
  const valor = Number(preco) || 0;
  const moedaOk = SIMBOLO[moeda] ? moeda : "USD";
  const precoTxt = valor > 0 ? precoPtBr(valor, moedaOk) : "";
  const priceBit = valor > 0 ? ` Preço de referência: ${precoTxt}.` : "";
  const codeBitDesc = sCode ? ` (${sCode})` : "";
  // A edição na descrição (2026-11-11): o resultado da busca dizia "Xerneas
  // 012/028 (S8a) do set 25th Anniversary Collection" sem dizer que a carta
  // é a japonesa.
  const edicao = edicaoDaCarta(card);
  const edicaoBit = edicao ? ` da edição ${EDICAO[edicao].pt}` : "";
  const desc = `${card.name}${enBit}${codeBit}${altBit}${codeBitDesc}${edicaoBit} do set ${set.nome} de ${jogo.nome}.${priceBit} Veja a imagem, acompanhe o preço e marque na sua coleção grátis no Sleevu.`;
  const img = absUrl(card.image) || "";
  const { impressoes, irmas } = vizinhas(card, cartas, slugs, baseDoSet);

  // Parágrafo de abertura (ver textoDaCarta): o pt no corpo, en e es em
  // <template> pro popup.
  const rarOk = card.rarity && card.rarity !== "None" &&
    !/[^\x00-\x7F]/.test(card.rarity) && String(card.rarity).length <= 24;
  // Carta com nome em japonês/chinês leva o inglês junto, como no título
  // ("ゼルネアス (Xerneas)"): é por ele que a maioria procura.
  const fatos = {
    nome: `${card.name}${enBit}`,
    nomes: [card.name, nomeEn].filter(Boolean).map(String),
    rar: rarOk ? card.rarity : "",
    edicao,
    numero: String(card.number || "").trim(),
    secreta: eSecreta(card, jogo.game),
    especie: especieDaCarta(card, jogo.game),
    setBit: sCode ? `${set.nome} (${sCode})` : set.nome,
    setNome: set.nome,
    jogo: jogo.nome,
    code,
    alt: altCodes,
    artista: card.artist || "",
    acab: Array.isArray(card.variants) ? card.variants.filter(Boolean) : [],
    iso: card.setReleaseDate,
    total: Number(card.setTotal) || 0,
    nImpressoes: impressoes.length,
    mercado: mercadoDaCarta(card, cartas, precoDe, rotuloDaCarta),
    valor,
    moeda: moedaOk
  };
  const textoPt = textoDaCarta("pt", fatos);
  const outrasLinguas = ["en", "es"]
    .map((l) => `<template data-texto-carta="${l}">${escapeHtml(textoDaCarta(l, fatos))}</template>`).join("");

  // Product SÓ com preço. O Google exige offers, review ou aggregateRating
  // num Product, e o item sem nenhum dos três conta como INVÁLIDO no Search
  // Console ("Especifique offers, review ou aggregateRating", 2026-10-02, em
  // carta JP e promo sem cotação). Avaliação nós não temos e inventar oferta
  // seria mentir; então carta sem preço fica só com a trilha.
  const produto = valor > 0 ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${card.name}${codeBit} — ${set.nome}`,
    alternateName: altCodes.length ? altCodes.map((c) => `${card.name} ${c} — ${set.nome}`) : undefined,
    sku: code || undefined,
    image: img || undefined,
    description: desc,
    brand: { "@type": "Brand", name: jogo.nome },
    url: canonical,
    offers: { "@type": "AggregateOffer", priceCurrency: moedaOk, lowPrice: valor.toFixed(2), offerCount: 1, availability: "https://schema.org/InStock" }
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
  // página da carta (desenhada pelo JS, que esconde este bloco); o robô que não
  // roda JS lê daqui. data-seo-carta deixa o detail.js tirar o bloco de uma
  // cópia guardada que chegue pra OUTRA carta. O .seo-carta-texto também
  // aparece DENTRO da tela da carta, como "Sobre esta carta" (o detail.js
  // copia, ver textoDaCartaNoPopup). O preço vem sem a nota "Preço de
  // referência de mercado. No Sleevu você vê em reais…" (até 2026-11-11):
  // repetia a frase-molde do parágrafo, que hoje diz de onde vem o preço.
  const nomeCompleto = `${card.name}${codeBit}${codeBitDesc}`;
  const corpoHtml = `<details class="seo-carta" data-seo-carta="${escapeAttr(caminho)}">
        ${ESTILO}
        <summary><h2>Sobre esta carta: ${escapeHtml(nomeCompleto)}</h2></summary>
        ${img ? `<img class="seo-carta-img" src="${escapeAttr(img)}" alt="${escapeAttr(`${nomeCompleto} — ${set.nome}`)}" loading="lazy" decoding="async" width="180" height="251">` : ""}
        <p class="seo-carta-sub">${escapeHtml(`${jogo.nome} · ${set.nome}${card.rarity && card.rarity !== "None" ? ` · ${card.rarity}` : ""}`)}</p>
        ${valor > 0 ? `<p class="seo-carta-preco">${escapeHtml(precoTxt)}</p>` : ""}
        <p class="seo-carta-texto">${escapeHtml(textoPt)}</p>${outrasLinguas}
        ${fichaTecnica(card, jogo, set, sCode)}
        ${listaDeCartas("Outras impressões desta carta", impressoes)}
        ${listaDeCartas(`Mais cartas de ${set.nome}`, irmas)}
        <p>Ver o set completo: <a href="${escapeAttr(baseDoSet)}">${escapeHtml(set.nome)}</a></p>
      </details>`;

  return {
    titulo,
    desc,
    canonical,
    // O h1 é o da CARTA desde que o endereço dela mostra a carta como página
    // (2026-10-13); antes era o do set, que era a tela por baixo do popup.
    h1: `${card.name}${codeBit}`,
    ogTitulo: `${nomeCompleto} — ${set.nome}`,
    ogImagem: img,
    alternates: [],
    jsonLds: produto ? [produto, trilhaLd] : [trilhaLd],
    corpoHtml
  };
}
