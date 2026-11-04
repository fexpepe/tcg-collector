// Data Carddass NARUTO — Card Battle (DN-) e Mission (NM-): as páginas da
// fonte em ordem cronológica, a faixa OFICIAL de estreia de cada uma e a regra
// "a carta é do set em que estreou". Lógica pura (sem rede e sem fs) pra o
// teste travar: tests/naruto-datacarddass.test.mjs. Quem usa é o
// scripts/sync-naruto-datacarddass.mjs.
//
// POR QUE EXISTE (02/11/2026). O noihjp troca o 第1弾 e o 第2弾 do Card Battle:
// a página 01.php, de título "第１弾", lista o 第2弾 (as estreias DN-051–065 e
// relistagens) e a 02.php, "第２弾", lista o 第1弾 inteiro (DN-001–050). O sync
// confiava no título, e como a carta pertence ao set em que ESTREOU, o 第１弾
// publicado tinha 41 cartas (26 do 001–050 + as 15 do 051–065) e o 第２弾 só as
// 24 sobras do 001–050. Duas fontes confirmam a troca:
//   - cardcheckbox.com (a06a-bandai-3/dcd-naruto-ncb.html): 第1弾 de out/2005,
//     全50種類, DN-001T〜DN-050T; 第2弾 de dez/2005, 新規15種類＋再録,
//     DN-051T〜DN-065T.
//   - hinokunian.konohashigure.com: cardbattle1.html (第一弾, 2005.10) tem
//     DN-001T–050T; cardbattle2.html (第二弾, 2005.12) tem as mesmas cartas da
//     01.php do noihjp, com "再録" nas antigas.
// Os setIds seguem com o NOME (nrt-dc-s01 = 第１弾, s02 = 第２弾): o link de
// set e o nome em inglês (VINTAGE_SET_EN) continuam certos, e só as cartas
// trocam de set — id de carta nenhum muda.

// As 15 páginas da fonte, em ordem CRONOLÓGICA (folhas combo entre os 弾 em que
// saíram); `seq` vira o setId (nrt-dc-s01…). História encerrada — a lista é
// fixa; só as cartas de cada página podem crescer (o acervo confirma cartas
// aos poucos). `estreia`: a faixa de numeração que estreou no set, pelo
// cardcheckbox (dcd-naruto-ncb.html e dcd-narutospd-nm.html); null = só
// relistagem. O 第1弾 e o 第2弾 vão pela página do CONTEÚDO, não pelo título
// que o noihjp dá a ela (ver acima).
//
// `data`: estreia na máquina (AAAA-MM-DD), pelo 発売日 das mesmas duas páginas
// do cardcheckbox (conferidas em 02/11/2026; o texto da fonte vai no fim de
// cada linha). Até aqui o sync gravava "" e a tela dizia "N/A". A régua do 旬
// é a do naruto-dc-capitulos.mjs — 中旬 = 15, 下旬 = 25, só o mês = dia 1 — e
// o 上旬 (dias 1–10), que ela não tinha, vira dia 5: o meio da dezena, como o
// 15 e o 25 são o das outras duas. Serve pra ordenar, não pra citar o dia.
// Quando a fonte dá o dia, vale o dia: o 第4章 e o 特別任務の章 têm o 発売日
// exato, e o 第1章–第3章 trazem "(… 確認)", o dia em que o cardcheckbox viu a
// máquina já com o 章. Esse dia é o TETO da estreia e vence o 旬: o 下旬 = 25
// do 第1章 cairia depois do 23/02 confirmado, e o 中旬 = 15 do 第3章, depois
// do 14/06.
export const PAGES = [
  { seq: 1,  page: "02.php",                    name: "ナルティメットカードバトル 第１弾", estreia: ["DN-001", "DN-050"], data: "2005-10-25" }, // 2005年10月下旬
  { seq: 2,  page: "01.php",                    name: "ナルティメットカードバトル 第２弾", estreia: ["DN-051", "DN-065"], data: "2005-12-15" }, // 2005年12月中旬
  { seq: 3,  page: "03.php",                    name: "ナルティメットカードバトル 第３弾", estreia: ["DN-066", "DN-082"], data: "2006-02-25" }, // 2006年2月下旬
  // "すべて再録カードです" (cardcheckbox). Sem estreia, o set não chega ao
  // catálogo; a data fica pela checklist completa.
  { seq: 4,  page: "Special-Combo-Sheet.php",   name: "ナルティメットカードバトル スペシャルコンボシート", estreia: null, data: "2006-03-25" }, // 2006年3月下旬
  { seq: 5,  page: "04.php",                    name: "ナルティメットカードバトル 第４弾", estreia: ["DN-083", "DN-107"], data: "2006-04-15" }, // 2006年4月中旬
  { seq: 6,  page: "05.php",                    name: "ナルティメットカードバトル 第５弾", estreia: ["DN-108", "DN-135"], data: "2006-06-25" }, // 2006年6月下旬
  // No cardcheckbox é a "ナルティメットコンボシート 2" (a mesma DN-136–140; a
  // "ナルティメットコンボシート" sem número de lá é o brinde da Vジャンプ,
  // DNP-021–023, que o noihjp não lista).
  { seq: 7,  page: "Special-Combo-Sheet_2.php", name: "ナルティメットカードバトル スペシャルコンボシート２", estreia: ["DN-136", "DN-140"], data: "2006-07-15" }, // 2006年7月中旬
  { seq: 8,  page: "06.php",                    name: "ナルティメットカードバトル 第６弾", estreia: ["DN-141", "DN-171"], data: "2006-08-05" }, // 2006年8月上旬
  // O cardcheckbox conta DN-173–209 como novas e o DN-172 como relistagem do
  // brinde do guia (ナルティメットガイド 巻ノ二); na máquina, ele sai aqui.
  { seq: 9,  page: "07.php",                    name: "ナルティメットカードバトル 第７弾", estreia: ["DN-172", "DN-209"], data: "2006-10-25" }, // 2006年10月下旬
  { seq: 10, page: "08.php",                    name: "ナルティメットカードバトル 第８弾 ナルティメットSP！", estreia: ["DN-210", "DN-249"], data: "2006-12-15" }, // 2006年12月中旬
  // O "2003年" do 確認 é erro de digitação da fonte: o 第1章 é de 2007年2月
  // (o 発売日 dela e a Wikipedia ja).
  { seq: 11, page: "Shippuden/NarutimateMission/01.php",      name: "究極任務 ナルティメットミッション 第１章 蒼天！新たなる旅立ち編", estreia: ["NM-001", "NM-050"], data: "2007-02-23" }, // 2007年2月下旬(2003年2月23日 確認)
  { seq: 12, page: "Shippuden/NarutimateMission/02.php",      name: "究極任務 ナルティメットミッション 第２章 君臨！黄砂に舞う風編", estreia: ["NM-051", "NM-092"], data: "2007-04-27" }, // 2007年4月下旬(2007年4月27日 確認)
  { seq: 13, page: "Shippuden/NarutimateMission/03.php",      name: "究極任務 ナルティメットミッション 第３章 強襲！赤き絶望の毒牙編", estreia: ["NM-093", "NM-136"], data: "2007-06-14" }, // 2007年6月中旬(2007年6月14日 確認)
  { seq: 14, page: "Shippuden/NarutimateMission/04.php",      name: "究極任務 ナルティメットミッション 第４章 激闘！闇を運ぶ暗雲編", estreia: ["NM-137", "NM-187"], data: "2007-08-03" }, // 2007年8月3日
  { seq: 15, page: "Shippuden/NarutimateMission/Tokunin.php", name: "究極任務 ナルティメットミッション 特別任務の章", estreia: ["NM-188", "NM-237"], data: "2007-10-11" }  // 2007年10月11日
];

// Data de estreia do set (AAAA-MM-DD) pelo seq da página — ou a das promos da
// Mission (só o mês, ver PROMO_MISSION); "" = seq fora das duas (não acontece
// hoje — a lista é fixa).
export function dataDoSet(seq) {
  if (seq === PROMO_MISSION.seq) return PROMO_MISSION.data;
  if (seq === PROMO_CARD_BATTLE.seq) return PROMO_CARD_BATTLE.data;
  if (seq === CLEAR_MISSION.seq) return CLEAR_MISSION.data;
  const pagina = PAGES.find((p) => p.seq === seq);
  return pagina ? pagina.data : "";
}

// A numeração é GLOBAL na série (DN-001… / NM-001…) e os 弾 seguintes
// relistam cartas antigas (re-impressões pra máquina). Mesmo código = mesma
// carta: ela pertence ao set em que ESTREOU; relistagem não vira carta nova.
// Devolve, na ordem de seq, { set, estreias } com as cartas que aparecem pela
// primeira vez naquele set.
export function estreias(sets) {
  const vistos = new Set();
  return [...(sets || [])].sort((a, b) => a.seq - b.seq).map((set) => {
    const novas = (set.cards || []).filter((c) => !vistos.has(c.code));
    novas.forEach((c) => vistos.add(c.code));
    return { set, estreias: novas };
  });
}

// "DN-051" -> ["DN", 51].
const partes = (code) => {
  const m = /^([A-Z]+)-(\d+)$/.exec(String(code || ""));
  return m ? [m[1], Number(m[2])] : [null, NaN];
};

// ── Promos da Mission (04/11/2026) ───────────────────────────────────────────
// As cartas DMP (e a CAN-001 da campanha de estreia) não estão no noihjp: saem
// da lista OFICIAL da Bandai, a promocard.shtml do site da Mission, que saiu do
// ar e ficou no Wayback Machine (captura fixa abaixo, Shift-JIS). Foi o PSA do
// Fernando ("2006 DCD NARUTO SHIPPUDEN #000 ... PR-TNMT PARTICIPATION") que
// mostrou o buraco: é a DMP-000, prêmio de participação em torneio.
//
// Set à parte, como o Formation e o Cross já têm o deles. O nome é o título da
// série + "プロモーションカード", sem "Data Carddass" na frente (contrato 7): o
// nome é a chave do set no catálogo do Naruto e "プロモーションカード" sozinho
// já é o do Card Game de 2002. `seq` 16 = nrt-dc-s16, depois do 特別任務の章.
//
// `data`: a promo mais antiga da lista é a DMP-000, da ジャンプフェスタ2007 —
// que, como toda Jump Festa, foi em dezembro do ano anterior (a de 2008 foi em
// 22–23/12/2007). Fica só o mês, porque o dia não foi conferido em fonte.
//
// A DMP-000J e a DMP-000S viram cartas PRÓPRIAS, não variante da DMP-000: cada
// uma tem o código impresso dela e uma página dela no site oficial (mesmos
// números de ataque, defesa e vida), e quem tem a J precisa marcar a J. O
// "variants" do catálogo é acabamento (Normal/Foil), não carta com outro número.
//
// A CAN-001 já estava no catálogo, como `nrt-nf-can-001` num set de uma carta
// só ("ナルティメットフォーメーション キャンペーンカード", nrt-nf-s02): o
// Suruga-ya a anuncia como Formation. Mas é da Mission — a imagem curada dela
// tem o 奥義 ナルト忍法帖 5700, o 全封じ e o 無限ジャンケン da lista oficial, e a
// data do anúncio (2007/02/01) é anterior à Formation (dez/2007). O id novo é
// nrt-dc-can-001 e o de-para mora no data/card-id-merges.json (o app migra a
// conta de quem marcou); o sync da Formation pula o número (NAO_E_FORMATION em
// naruto-dc-capitulos.mjs).
export const PROMO_MISSION = {
  seq: 16,
  name: "究極任務 ナルティメットミッション プロモーションカード",
  data: "2006-12",
  url: "http://www.carddas.com/naruto/mission/cardlist/promocard.shtml",
  captura: "20110707175237"
};

// ── Promos do Card Battle e 疾風クリアカード da Mission (04/11/2026) ─────────
// Os dois saem do snapshot das listas oficiais (data/vintage/naruto-dc-oficial.json,
// ver scripts/lib/naruto-dc-oficial.mjs), não do noihjp, que não lista nenhum.
//
// Promos do Card Battle: DNP-001 a DNP-030, mais a DNP-030S e a DNP-030J (cartas
// próprias, como a DMP-000J/S da Mission: cada uma tem o código impresso e a
// página dela na lista oficial) e as NA-001 a NA-004 (campanha da Namco, na
// mesma seção "プロモーションカード" da lista). `data`: a mais antiga é a
// DNP-001, do 巻ノ十三 初回生産限定 do Card Game de 2002 — saiu com ele, antes da
// máquina (a data é a do nrt-s13 no catálogo).
export const PROMO_CARD_BATTLE = {
  seq: 17,
  name: "ナルティメットカードバトル プロモーションカード",
  data: "2005-09-06"
};

// 疾風クリアカード da Mission: NC-001 a NC-032, de máquina de venda (自販機).
// `data`: só o mês. A lista (cardlist_cc.php) foi capturada pela primeira vez em
// 30/08/2007, e o site oficial a marcava como "NEW!!" nessa captura; o dia da
// máquina não está em fonte achada. O "2" do nome do clear card da Formation
// (疾風クリアカード2, 2008) é a continuação deste.
export const CLEAR_MISSION = {
  seq: 18,
  name: "究極任務 ナルティメットミッション 疾風クリアカード",
  data: "2007-08"
};

const decodifica = (s) => String(s || "")
  .replace(/<br\s*\/?>/gi, "")
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ")
  .trim();

// Lista da promocard.shtml: cada carta abre com a célula do código (fundo azul,
// class s_font_wb) e traz, até a próxima, o nome (o primeiro link), o nível e o
// nome da missão (a célula colspan="2") e o "入手方法" (a primeira s_font, vazia
// nas variantes J e S). O verso (a carta da "Ｗ", com o próprio nome) fica de
// fora: é a mesma carta física.
export function parsePromoMission(html) {
  const partes = String(html || "").split(/<td[^>]*class="s_font_wb"[^>]*>/i).slice(1);
  const cartas = [];
  for (const parte of partes) {
    const code = (/^\s*([A-Z]{2,4}-\d{3}[A-Z]?)\s*<\/td>/.exec(parte) || [])[1];
    if (!code) continue;
    const name = decodifica((/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(parte) || [])[1]);
    const nivel = decodifica((/>\s*(Lv\d)\s*</.exec(parte) || [])[1]);
    const missao = decodifica((/<td[^>]*colspan="2"[^>]*>([\s\S]*?)<\/td>/i.exec(parte) || [])[1]);
    const origem = decodifica((/<td[^>]*class="s_font"[^>]*>([\s\S]*?)<\/td>/i.exec(parte) || [])[1]);
    if (name) cartas.push({ code, name, missao: [nivel, missao].filter(Boolean).join(" "), origem });
  }
  return cartas;
}

// Estreias fora da faixa oficial da página ([] = tudo certo). É o que pega
// título trocado na fonte: com a 01.php como 第1弾, ele estreava DN-051–065.
export function estreiasForaDaFaixa(sets) {
  const porSeq = new Map(PAGES.map((p) => [p.seq, p]));
  const fora = [];
  for (const { set, estreias: novas } of estreias(sets)) {
    const pagina = porSeq.get(set.seq);
    if (!pagina) continue;
    const [prefixo, de] = pagina.estreia ? partes(pagina.estreia[0]) : [null, NaN];
    const ate = pagina.estreia ? partes(pagina.estreia[1])[1] : NaN;
    for (const c of novas) {
      const [p, n] = partes(c.code);
      if (p !== prefixo || !(n >= de && n <= ate)) fora.push(`${pagina.name}: ${c.code}`);
    }
  }
  return fora;
}
