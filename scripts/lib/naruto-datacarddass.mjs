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
export const PAGES = [
  { seq: 1,  page: "02.php",                    name: "ナルティメットカードバトル 第１弾", estreia: ["DN-001", "DN-050"] },
  { seq: 2,  page: "01.php",                    name: "ナルティメットカードバトル 第２弾", estreia: ["DN-051", "DN-065"] },
  { seq: 3,  page: "03.php",                    name: "ナルティメットカードバトル 第３弾", estreia: ["DN-066", "DN-082"] },
  // "すべて再録カードです" (cardcheckbox).
  { seq: 4,  page: "Special-Combo-Sheet.php",   name: "ナルティメットカードバトル スペシャルコンボシート", estreia: null },
  { seq: 5,  page: "04.php",                    name: "ナルティメットカードバトル 第４弾", estreia: ["DN-083", "DN-107"] },
  { seq: 6,  page: "05.php",                    name: "ナルティメットカードバトル 第５弾", estreia: ["DN-108", "DN-135"] },
  { seq: 7,  page: "Special-Combo-Sheet_2.php", name: "ナルティメットカードバトル スペシャルコンボシート２", estreia: ["DN-136", "DN-140"] },
  { seq: 8,  page: "06.php",                    name: "ナルティメットカードバトル 第６弾", estreia: ["DN-141", "DN-171"] },
  // O cardcheckbox conta DN-173–209 como novas e o DN-172 como relistagem do
  // brinde do guia (ナルティメットガイド 巻ノ二); na máquina, ele sai aqui.
  { seq: 9,  page: "07.php",                    name: "ナルティメットカードバトル 第７弾", estreia: ["DN-172", "DN-209"] },
  { seq: 10, page: "08.php",                    name: "ナルティメットカードバトル 第８弾 ナルティメットSP！", estreia: ["DN-210", "DN-249"] },
  { seq: 11, page: "Shippuden/NarutimateMission/01.php",      name: "究極任務 ナルティメットミッション 第１章 蒼天！新たなる旅立ち編", estreia: ["NM-001", "NM-050"] },
  { seq: 12, page: "Shippuden/NarutimateMission/02.php",      name: "究極任務 ナルティメットミッション 第２章 君臨！黄砂に舞う風編", estreia: ["NM-051", "NM-092"] },
  { seq: 13, page: "Shippuden/NarutimateMission/03.php",      name: "究極任務 ナルティメットミッション 第３章 強襲！赤き絶望の毒牙編", estreia: ["NM-093", "NM-136"] },
  { seq: 14, page: "Shippuden/NarutimateMission/04.php",      name: "究極任務 ナルティメットミッション 第４章 激闘！闇を運ぶ暗雲編", estreia: ["NM-137", "NM-187"] },
  { seq: 15, page: "Shippuden/NarutimateMission/Tokunin.php", name: "究極任務 ナルティメットミッション 特別任務の章", estreia: ["NM-188", "NM-237"] }
];

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
