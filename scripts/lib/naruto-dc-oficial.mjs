// Data Carddass NARUTO — as listas OFICIAIS da Bandai, preservadas no Wayback
// Machine: quais páginas ler, em que captura, e como ler cada uma. Lógica pura
// (sem rede e sem fs) pro teste travar: tests/naruto-dc-oficial.test.mjs. Quem
// baixa é o scripts/naruto-dc-oficial-wayback.mjs (à mão); quem usa o snapshot
// (data/vintage/naruto-dc-oficial.json) são os syncs da linha nrt-dc.
//
// POR QUE EXISTE (04/11/2026). A Formation e a Cross vinham só do Suruga-ya,
// que lista o que a loja tem no acervo: o catálogo tinha 91 das 344 cartas da
// Formation (o 第4章 inteiro faltava) e 243 das 344 da Cross. O Card Battle não
// tinha as promos DNP/NA e a Mission não tinha os 疾風クリアカード. Os sites
// oficiais dos quatro títulos saíram do ar, mas o Wayback guardou as listas:
//   - Formation e Cross: fudanin.com (札忍ドットコム), formation/cardlist/*.php
//     e x/cardlist/?search=true&category=…
//   - Card Battle: carddas.com/datacarddas/naruto/cardlist/index.shtml
//   - Mission: carddas.com/naruto/mission/cardlist/cardlist_cc.php
// O Card Battle e a Mission principais já batiam com a lista oficial (nome a
// nome no Card Battle; contagem por capítulo na Mission). Daqui só entra o que
// faltava neles.
//
// As capturas são FIXAS: a história acabou em 2010 e a captura escolhida é a
// mais nova com a lista completa. Trocar de captura = rodar o script de novo e
// conferir o diff do snapshot.

// `serie`: o nome que o sync da Formation/Cross dá ao set das cartas que não
// são de capítulo. É o MESMO texto que o Suruga-ya usa nos sets já publicados
// (a chave do set sai dele, ver chaveDoSet em naruto-dc-capitulos.mjs), então
// as promos e os pocket files continuam no set de hoje. As cartas de capítulo
// (NF-nnn, NX-nnn) vão pelo número, e ali a série não decide nada.
// `familia`: o que a página LISTA como carta dela. As outras linhas são
// relistagem de outra série (a clear_02 traz NF-005再録, a 4msheet traz cartas
// NM da Mission que a máquina lê) e ficam de fora.
const F = "ナルティメットフォーメーション";
const X = "ナルティメットクロス";
export const SERIE = {
  nfm: `${F} 極秘任務`,
  nfc: `${F} 疾風クリアカード2`,
  nff: `${F} 出撃！フォーマンセルシート`,
  nfpf: `ポケットファイルダス ${F}`,
  nfp: `${F} プロモーションカード`,
  nxpf: `ポケットファイルダス ${X}`,
  nxp: `${X} プロモーションカード`,
  nxmac: `${X} マクドナルド限定カード`,
  vjcf2009: `${X} Vジャンプカードフェスタ2009`
};

const FUDANIN = "http://fudanin.com:80";
const FUDANIN_WWW = "http://www.fudanin.com:80";

// Formation: uma página por capítulo, mais as séries à parte. O 第4章 é a
// captura de 03/12/2008 porque é a mais nova com status 200; as outras são de
// jan–fev/2009, depois do 7º e último capítulo (dez/2008).
export const PAGINAS_FORMATION = [
  { ts: "20090204172806", url: `${FUDANIN}/formation/cardlist/1st.php`, familia: /^NFM?-/ },
  { ts: "20090215175233", url: `${FUDANIN}/formation/cardlist/2nd.php`, familia: /^NFM?-/ },
  { ts: "20090215175136", url: `${FUDANIN}/formation/cardlist/3rd.php`, familia: /^NFM?-/ },
  { ts: "20081203134416", url: "http://www.fudanin.com/formation/cardlist/4th.php", familia: /^NFM?-/ },
  { ts: "20090125223925", url: `${FUDANIN}/formation/cardlist/5th.php`, familia: /^NFM?-/ },
  { ts: "20090210052009", url: `${FUDANIN}/formation/cardlist/6th.php`, familia: /^NFM?-/ },
  { ts: "20090122210520", url: `${FUDANIN}/formation/cardlist/7th.php`, familia: /^NFM?-/ },
  { ts: "20090201085749", url: `${FUDANIN}/formation/cardlist/clear_02.php`, familia: /^NFC-/, serie: SERIE.nfc },
  { ts: "20090215175110", url: `${FUDANIN}/formation/cardlist/4msheet.php`, familia: /^NFF-/, serie: SERIE.nff },
  { ts: "20090201063108", url: `${FUDANIN}/formation/cardlist/pocketfile.php`, familia: /^NFPF-/, serie: SERIE.nfpf },
  { ts: "20090125223957", url: `${FUDANIN}/formation/cardlist/prom.php`, familia: /^NFP-/, serie: SERIE.nfp }
];

// Cross: o buscador mostra 30 cartas por página; a 2ª é `&page=30`. As de
// 2017 são o estado final do site (69001–69007 = 第1章–第7章). A 2ª página do
// 第2章 e do 第3章 só foi capturada com o id de categoria de antes (10267 e
// 10281, 2009), que lista as mesmas cartas. A do 第4章 foi capturada em
// 20/07/2009, com o capítulo ainda saindo: faltam NX-172–177, 179 e 191. A do
// 第5章 não foi capturada — as NX-222–241 vêm do PDF de checklist (abaixo).
// Fora daqui: 69010 (カード読み替え表, cartas da Formation que a Cross lê).
export const PAGINAS_CROSS = [
  { ts: "20170326110029", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69001`, familia: /^NX-\d/ },
  { ts: "20090817231430", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=69001`, familia: /^NX-\d/ },
  { ts: "20170326110033", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69002`, familia: /^NX-\d/ },
  { ts: "20090401162507", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=10267`, familia: /^NX-\d/ },
  { ts: "20170326110038", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69003`, familia: /^NX-\d/ },
  { ts: "20090608051802", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=10281`, familia: /^NX-\d/ },
  { ts: "20170326110043", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69004`, familia: /^NX-\d/ },
  { ts: "20090720194123", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=69004`, familia: /^NX-\d/ },
  { ts: "20170326110049", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69005`, familia: /^NX-\d/ },
  { ts: "20170326110054", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69006`, familia: /^NX-\d/ },
  { ts: "20091130032835", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=69006`, familia: /^NX-\d/ },
  { ts: "20150131054047", url: "http://fudanin.com/x/cardlist/?search=true&category=69007", familia: /^NX-\d/ },
  { ts: "20100127025321", url: `${FUDANIN_WWW}/x/cardlist/?page=30&search=true&category=69007`, familia: /^NX-\d/ },
  { ts: "20091112142532", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69011`, familia: /^NXpf-/, serie: SERIE.nxpf },
  { ts: "20170326110240", url: `${FUDANIN_WWW}/x/cardlist/?search=true&category=69901`, familia: /^(NXP-|NX-MAC|VJCF-)/ }
];

// Na página de promos da Cross (69901) a série sai do número.
export function serieDaPromoCross(num) {
  if (/^NX-MAC/.test(num)) return SERIE.nxmac;
  if (/^VJCF-2009$/.test(num)) return SERIE.vjcf2009;
  return SERIE.nxp;
}

// As NX-222–241 (2ª página do 第5章, que o Wayback não guardou), lidas no PDF
// de checklist oficial (x/pdf/cardchecklist_nx_5th.pdf, captura
// 20091122210417). O PDF é uma imagem A4 de 300 dpi sem texto: número, nome e
// estrelas foram lidos na imagem, carta a carta. Estrelas: ★ = R, ★★ = SR,
// ★★★ = NR (a legenda do próprio PDF); sem estrela = N.
export const CROSS_DO_PDF_5 = {
  fonte: { ts: "20091122210417", url: "http://www.fudanin.com:80/x/pdf/cardchecklist_nx_5th.pdf" },
  cartas: [
    ["NX-222", "みたらしアンコ", "N"],
    ["NX-223", "木ノ葉丸軍団（第一部）", "N"],
    ["NX-224", "我愛羅", "N"],
    ["NX-225", "我愛羅", "R"],
    ["NX-226", "うちはイタチ", "N"],
    ["NX-227", "うちはイタチ", "SR"],
    ["NX-228", "干柿鬼鮫", "SR"],
    ["NX-229", "デイダラ", "N"],
    ["NX-230", "デイダラ", "SR"],
    ["NX-231", "サソリ（人傀儡）", "SR"],
    ["NX-232", "トビ（暁服）", "SR"],
    ["NX-233", "飛段（儀式モード）", "R"],
    ["NX-234", "角都（最終形態）", "R"],
    ["NX-235", "大蛇丸", "N"],
    ["NX-236", "大蛇丸", "R"],
    ["NX-237", "君麻呂", "N"],
    ["NX-238", "鬼童丸", "N"],
    ["NX-239", "左近", "N"],
    ["NX-240", "重吾（状態１）", "SR"],
    ["NX-241", "地陸", "N"]
  ]
};

// Card Battle: a lista da captura de 30/07/2009 já é a final (o 第８弾 foi o
// último, dez/2006). Daqui só saem as promos (âncora "p"): as DN já vêm do
// noihjp e batem nome a nome.
export const PAGINA_CARD_BATTLE = { ts: "20090730032032", url: "http://www.carddas.com/datacarddas/naruto/cardlist/index.shtml" };

// Mission: a lista dos 疾風クリアカード (máquina de venda). As NM-xxx que a
// página relista ficam de fora: já estão nos capítulos.
export const PAGINA_CLEAR_MISSION = { ts: "20070830080234", url: "http://www.carddas.com:80/naruto/mission/cardlist/cardlist_cc.php" };

const texto = (s) => String(s || "")
  .replace(/<br\s*\/?>/gi, "")
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, "\"")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ")
  .trim();

// Nome da carta como o catálogo escreve: a Formation e o Suruga-ya põem o
// parêntese e o dígito em meia largura ("奈良シカマル(疾風伝)", "重吾(状態1)") e
// a Cross em largura cheia ("重吾（状態１）"). Só isso vira meia largura — o
// resto do texto (！, ・, aspas) fica como a fonte escreveu.
export const nomeDaCarta = (s) => texto(s)
  .replace(/[（）Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/　/g, " ");

// "NFP-002(DMP-019)" -> { num: "NFP-002", alias: "DMP-019" }; "NF-005再録" e
// "NF-011【再録】" (relistagem) -> null.
export function numeroDaCelula(bruto) {
  const t = texto(bruto).normalize("NFKC").replace(/\s+/g, "");
  if (/再録/.test(t)) return null;
  const m = /^([A-Za-z]+-[A-Za-z]*\d*[A-Za-z]*\d*)(?:\(([A-Z]+-\d+)\))?$/.exec(t);
  if (!m || !/\d|SP/.test(m[1])) return null;
  return { num: m[1], alias: m[2] || "" };
}

// Página de lista da Formation: cada carta abre com a célula do número
// (class "cardNum"), depois o nome, o nível, o 任務名 (colspan="2") e o 収録.
// O nome quase sempre é um link pro popup, mas não sempre (a NF-139 デイダラ
// vem em texto puro): vale o texto da célula. As linhas "wbarcode" que vêm
// depois são o verso da carta (a barcode da Ｗ), não carta nova. Devolve
// { num, alias, name, missao } na ordem da página.
export function parseFormation(html) {
  const out = [];
  const partes = String(html || "").split(/<td[^>]*class="cardNum[^"]*"[^>]*>/i).slice(1);
  for (const parte of partes) {
    const fim = parte.indexOf("</td>");
    const n = numeroDaCelula(parte.slice(0, fim));
    if (!n) continue;
    const resto = parte.slice(fim + 5);
    const name = nomeDaCarta((/<td[^>]*>([\s\S]*?)<\/td>/i.exec(resto) || [])[1]);
    const missao = nomeDaCarta((/<td[^>]*colspan="2"[^>]*>([\s\S]*?)<\/td>/i.exec(resto) || [])[1]);
    if (name) out.push({ ...n, name, missao });
  }
  return out;
}

// Página do buscador da Cross: o número fica na célula class "card_num" (2017)
// ou "card_name_num_xx" (2009) com rowspan, e o nome é o link da célula
// seguinte.
export function parseCross(html) {
  const out = [];
  const re = /<td[^>]*rowspan="\d+"[^>]*class="(?:card_num[^"]*|card_name_num_\w+)"[^>]*>([^<]*)<\/td>\s*<td[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const n = numeroDaCelula(m[1]);
    const name = nomeDaCarta(m[2]);
    if (n && name) out.push({ ...n, name });
  }
  return out;
}

// Linhas do formato antigo da carddas.com (Card Battle e Mission): o número
// fica numa célula class "s_font_wb" e o nome é o primeiro link depois dela.
function linhasSFontWb(html) {
  return String(html || "").split(/<td[^>]*class="s_font_wb"[^>]*>/i).slice(1).map((parte) => {
    const n = numeroDaCelula(parte.slice(0, parte.indexOf("</td>")));
    return n ? { ...n, parte } : null;
  }).filter(Boolean);
}

// Promos do Card Battle: a seção da âncora "p" da lista (DNP-001–030, DNP-030S,
// DNP-030J e NA-001–004). `origem` é a 7ª célula, o "como se ganhava".
export function parsePromosCardBattle(html) {
  const h = String(html || "");
  const i = h.search(/<a name="p"/i);
  if (i < 0) return [];
  return linhasSFontWb(h.slice(i)).map(({ num, parte }) => {
    const celulas = [...parte.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => texto(m[1]));
    const name = nomeDaCarta((/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(parte) || [])[1]);
    return { num, name, origem: celulas[5] || "" };
  }).filter((c) => /^(DNP|NA)-/.test(c.num) && c.name);
}

// 疾風クリアカード da Mission: NC-001–032. `missao` é o 任務名 (colspan="2").
export function parseClearMission(html) {
  return linhasSFontWb(html).map(({ num, parte }) => ({
    num,
    name: nomeDaCarta((/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(parte) || [])[1]),
    missao: nomeDaCarta((/<td[^>]*colspan="2"[^>]*>([\s\S]*?)<\/td>/i.exec(parte) || [])[1])
  })).filter((c) => /^NC-\d{3}$/.test(c.num) && c.name);
}

// Junta as páginas lidas num snapshot. `paginas`: Map(url -> html). Primeira
// ocorrência de cada número vence (a página do capítulo vem antes das séries).
export function montaSnapshot(paginas) {
  const ler = (p) => paginas.get(p.url) || "";
  const formation = [];
  const vistosF = new Set();
  for (const p of PAGINAS_FORMATION) {
    for (const c of parseFormation(ler(p))) {
      if (!p.familia.test(c.num) || vistosF.has(c.num)) continue;
      vistosF.add(c.num);
      // As シークレットミッションカード vêm nas páginas dos capítulos com o nome
      // genérico ("シークレットミッションカード004"); o nome dela é o da missão.
      const nfm = /^NFM-/.test(c.num);
      formation.push({
        num: c.num,
        name: nfm && c.missao ? c.missao : c.name,
        serie: nfm ? SERIE.nfm : p.serie || "",
        ...(c.alias ? { alias: c.alias } : {}),
        captura: p.ts
      });
    }
  }
  const cross = [];
  const vistosX = new Set();
  for (const p of PAGINAS_CROSS) {
    for (const c of parseCross(ler(p))) {
      if (!p.familia.test(c.num) || vistosX.has(c.num)) continue;
      vistosX.add(c.num);
      const promo = /category=69901/.test(p.url);
      cross.push({ num: c.num, name: c.name, serie: promo ? serieDaPromoCross(c.num) : p.serie || "", captura: p.ts });
    }
  }
  for (const [num, nome, rarity] of CROSS_DO_PDF_5.cartas) {
    if (vistosX.has(num)) continue;
    vistosX.add(num);
    cross.push({ num, name: nomeDaCarta(nome), serie: "", rarity, captura: CROSS_DO_PDF_5.fonte.ts });
  }
  const ordem = (a, b) => a.num.localeCompare(b.num, "en", { numeric: true });
  return {
    formation: formation.sort(ordem),
    cross: cross.sort(ordem),
    cardBattlePromos: parsePromosCardBattle(paginas.get(PAGINA_CARD_BATTLE.url)),
    missionClear: parseClearMission(paginas.get(PAGINA_CLEAR_MISSION.url))
  };
}
