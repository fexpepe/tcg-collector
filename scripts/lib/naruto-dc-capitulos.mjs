// Data Carddass NARUTO — Formation (nrt-nf) e Cross (nrt-nx): capítulo oficial
// de cada carta, data de cada capítulo e setId pegajoso. Lógica pura (sem rede
// e sem fs) pra o teste travar: tests/naruto-dc-capitulos.test.mjs. Quem usa é
// o scripts/sync-naruto-dc-cross-formation.mjs.
//
// POR QUE EXISTE (30/09/2026). O snapshot do Suruga-ya agrupa pela "série" do
// anúncio da loja, e o sync montava um set por série. Três defeitos saíam daí:
//   1. Capítulo partido em dois sets: "第2章" e "第2章 再会！共鳴する宿命の二人編"
//      são o mesmo capítulo, com e sem o subtítulo (idem o 第5章 da Formation e
//      o 第4章 do Cross — "第４章 ～1億枚突破記念弾～" é o nome OFICIAL dele no
//      catálogo da Bandai, não um produto à parte).
//   2. Carta no capítulo errado: NF-297 [NP] estava no 第6章, mas é do
//      火の意志伝承の章 (o 7º, onde até a normal brilha — daí o NP); NX-192..201
//      estavam no 第4章 e são do 第5章 (o 10周年SP弾, idem).
//   3. Data inventada: o Suruga-ya escreve "AAAA/01/01" quando só sabe o ano, e
//      a data do set era a menor entre os itens. O 第1章 da Formation caía em
//      2007-01-01 (o jogo estreou em dez/2007) e o 第2章/第3章 do Cross ficavam
//      antes do 第1章.
// A régua do capítulo agora é o site oficial (fudanin.com, no Wayback): cada
// capítulo tem uma faixa FECHADA de numeração, publicada na lista de cartas
// dele. A série do Suruga-ya só decide o que não tem número de capítulo
// (promo, campanha, pocket file).

// Capítulos oficiais. `faixa`: números NF-/NX- que estrearam no capítulo, pelas
// listas do site oficial (formation/cardlist/<n>th.php e x/cardlist/?category=…
// do fudanin.com). `data`: estreia no arcade — o dia quando uma fonte oficial
// dá o dia; o "旬" do catálogo da Bandai vira dia 15 no 中旬 (a régua do
// sync-naruto-vintage: 下旬 = 25); só o mês = dia 1, que serve pra ordenar e
// não pra citar. `nome`: o do capítulo com o subtítulo oficial, quando há.
export const CAPITULOS = {
  nf: [
    // 稼働開始 2007年12月14日 (Wikipedia ja, "NARUTO -ナルト- (ゲーム)").
    { cap: 1, nome: "第1章", data: "2007-12-14", faixa: [1, 50] },
    // "2008/02/14 第2章順次稼働開始！" (log de novidades do site oficial).
    { cap: 2, nome: "第2章 再会！共鳴する宿命の二人編", data: "2008-02-14", faixa: [51, 100] },
    // Só o mês: o Suruga-ya diz abril, e a lista oficial saiu em 25/04.
    { cap: 3, nome: "第3章 奪還！砂漠に眠る友の魂編", data: "2008-04-01", faixa: [101, 150] },
    // "2008/06/05 第４章稼働開始！" (Bandai: 6月上旬). Nenhuma carta dele no
    // snapshot ainda — a linha fica pronta pra re-coleta.
    { cap: 4, nome: "第4章 結集！漆黒に浮かぶ紅き野望編", data: "2008-06-05", faixa: [151, 197] },
    // "7月下旬より稼働予定"; contagem regressiva em 24/07, lista em 30/07, e o
    // Suruga-ya diz 31/07.
    { cap: 5, nome: "第5章 激突！闇を穿つ火の意志編", data: "2008-07-31", faixa: [198, 245] },
    // "10月上旬稼働予定" ainda no ar em 06/10; a lista oficial saiu em 09/10.
    { cap: 6, nome: "第6章 集結！英雄たちの慟哭編", data: "2008-10-09", faixa: [246, 294] },
    // "～火の意志伝承の章～ 12月中旬より順次稼働開始", e "好評稼働中" já em 12/12.
    { cap: 7, nome: "第7章 火の意志伝承の章", data: "2008-12-11", faixa: [295, 344] }
  ],
  nx: [
    // 稼働日 2009年1月29日 (Wikipedia ja); Bandai: 1月下旬; a lista N/R saiu no dia.
    { cap: 1, nome: "第1章", data: "2009-01-29", faixa: [1, 50] },
    // Só o mês: a página do capítulo já estava no ar em 12/03, a lista em 17/03.
    { cap: 2, nome: "第2章", data: "2009-03-01", faixa: [51, 100] },
    // Só o mês: página do capítulo em 23/05, lista em 08/06.
    { cap: 3, nome: "第3章", data: "2009-05-01", faixa: [101, 141] },
    // Bandai: 7月中旬 (daqui pra baixo o catálogo da Bandai tem todos).
    { cap: 4, nome: "第4章 ～1億枚突破記念弾～", data: "2009-07-15", faixa: [142, 191] },
    { cap: 5, nome: "第5章 ～10周年SP弾～", data: "2009-09-15", faixa: [192, 241] },
    { cap: 6, nome: "第6章", data: "2009-11-15", faixa: [242, 293] },
    { cap: 7, nome: "第7章", data: "2010-01-15", faixa: [294, 344] }
  ]
};

// Série sem capítulo cuja data o snapshot não tem (ou só tem o ano).
export const DATAS_DE_SERIE = {
  // シークレットミッションカード: estrearam com o 第4章 (NFM-001..003 na lista
  // oficial dele; a explicação saiu no site em 04/06/2008).
  "nf:極秘任務": "2008-06-05",
  // Bandai: 2008年5月中旬 (o Suruga-ya não tem data).
  "nf:ポケットファイルダス": "2008-05-15",
  // As duas séries de máquina de venda da Formation, pelo log de novidades do
  // site oficial (formation/topics.html, captura 20090215175129). Só o mês:
  // o log dá quando a página do produto entrou, não o dia da máquina.
  //   "2008/01/18 関連商品に「突撃！フォーマンセルシート」を追加！" e a lista
  //   em 22/01.
  // (A chave é a da série em NFKC, como a chaveDoSet monta: "！" vira "!".)
  "nf:出撃!フォーマンセルシート": "2008-01",
  //   "2008/09/11 関連商品に「疾風クリアカード2」を追加！" e "2008/10/01 待望の
  //   疾風クリアカード2カードリストを公開！".
  "nf:疾風クリアカード2": "2008-10"
};

// Chave de set PUBLICADO que não sai do nome dele. O nrt-nf-s03 chamava só
// "ナルティメットフォーメーション": o Suruga-ya anuncia a NFC-016 e a NFF-008 sem
// a série. Pela lista oficial elas são do 疾風クリアカード2 e do 出撃！フォーマン
// セルシート (04/11/2026); o set fica sendo o da folha (a NFF-008 não muda de
// endereço) e a NFC-016 vai pro set novo do clear card.
const CHAVE_PUBLICADA = {
  "nrt-nf-s03": "nf:出撃!フォーマンセルシート"
};

// setIds que deixaram de existir quando o capítulo partido virou um só
// (30/09/2026). O de-para (link de set compartilhado com o id velho) mora no
// data/card-id-merges.json; aqui eles só não voltam a ser distribuídos.
export const SETIDS_APOSENTADOS = {
  "nrt-nf-s09": "nrt-nf-s06", // 第2章 再会！共鳴する宿命の二人編 -> 第2章
  "nrt-nf-s11": "nrt-nf-s07", // 第5章 激突！闇を穿つ火の意志編 -> 第5章
  "nrt-nx-s20": "nrt-nx-s21", // 第4章 ～1億枚突破記念弾～ (NX-CAM004) -> 第4章
  // キャンペーンカード (só a CAN-001), que era da Mission: foi pras promos
  // dela (04/11/2026, ver NAO_E_FORMATION).
  "nrt-nf-s02": "nrt-dc-s16"
};

// Números que o Suruga-ya anuncia numa série da Formation/Cross mas são de
// outro título do arcade — o sync daqui pula, e quem monta a carta é o dono
// do título. A CAN-001 ("ナルティメットフォーメーション キャンペーンカード",
// 2007/02/01 no anúncio) é a troca da campanha de estreia da Mission
// (究極任務スタート！キャンペーン), na lista oficial de promos dela: a imagem
// curada bate com a lista (奥義 ナルト忍法帖 5700, 全封じ, 無限ジャンケン) e a
// data é de dez meses antes da Formation. Hoje é a nrt-dc-can-001, montada pelo
// sync-naruto-datacarddass.mjs; o id velho (nrt-nf-can-001) tem de-para no
// data/card-id-merges.json.
export const NAO_E_FORMATION = new Set(["CAN-001"]);

const TITULO = { nf: "ナルティメットフォーメーション", nx: "ナルティメットクロス" };

// NFKC: fullwidth vira ASCII (ＮＦ, ０-９), espaço ideográfico vira espaço.
// Só pra COMPARAR — o nome exibido segue o texto da fonte.
const nfkc = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();

// Capítulo da carta. Com número NF-nnn/NX-nnn, pela faixa oficial (vale mais
// que a série do anúncio); sem ele, pelo "第N章" da série (NX-CAM004 do
// 第4章, NX-SP I do 第5章). 0 = fora dos capítulos.
export function capituloDaCarta(linha, numero, serie) {
  const m = nfkc(numero).match(/^(N[FX])-(\d+)$/i);
  if (m && m[1].toLowerCase() === linha) {
    const n = Number(m[2]);
    const cap = (CAPITULOS[linha] || []).find(({ faixa: [de, ate] }) => n >= de && n <= ate);
    if (cap) return cap.cap;
  }
  const s = nfkc(serie).match(/第(\d+)章/);
  return s ? Number(s[1]) : 0;
}

// Chave do set: "nf:cap2" pra capítulo; fora dele, a série sem o título do
// jogo ("nf:プロモーションカード", "nx:ポケットファイルダス"; "nf:" = só o título).
export function chaveDoSet(linha, cap, serie) {
  if (cap) return `${linha}:cap${cap}`;
  return `${linha}:${nfkc(serie).replace(/ナルティメット(フォーメーション|クロス)/g, "").replace(/\s+/g, " ").trim()}`;
}

function capituloDaChave(chave) {
  const m = /^(nf|nx):cap(\d+)$/.exec(chave);
  return m ? (CAPITULOS[m[1]] || []).find((c) => c.cap === Number(m[2])) || null : null;
}

// Nome do set: capítulo pelo nome oficial; série, pelo texto do anúncio. Sem
// "Data Carddass — " na frente desde 2026-11-02 (contrato 7 do
// docs/CATALOGO.md: a linha já está no cabeçalho e no endereço).
export function nomeDoSet(chave, serie) {
  const cap = capituloDaChave(chave);
  return cap ? `${TITULO[chave.slice(0, 2)]} ${cap.nome}` : serie;
}

// Data do set (AAAA-MM-DD, "" = sem data): a curada do capítulo/série; senão
// a menor dos itens, com "AAAA-01-01" (só o ano, no Suruga-ya) valendo só
// quando não há data melhor.
export function dataDoSet(chave, datasDosItens) {
  const cap = capituloDaChave(chave);
  if (cap) return cap.data;
  if (DATAS_DE_SERIE[chave]) return DATAS_DE_SERIE[chave];
  const datas = (datasDosItens || []).filter(Boolean).sort();
  return datas.find((d) => !/-01-01$/.test(d)) || datas[0] || "";
}

// Total do set (setTotal). Capítulo: a faixa oficial inteira, mais as cartas do
// set fora dela (a NX-CAM004 do 第4章, as NX-SP do 第5章). Assim o progresso é
// honesto mesmo onde a lista capturada tem buraco: o 第4章 da Cross mostra
// 49/51, porque a NX-172 e a NX-191 não têm fonte. Fora de capítulo, as cartas
// que o set tem.
export function totalDoSet(chave, cartas) {
  const cap = capituloDaChave(chave);
  if (!cap) return (cartas || []).length;
  const [de, ate] = cap.faixa;
  const linha = chave.slice(0, 2);
  const fora = (cartas || []).filter((c) => {
    const m = nfkc(c.num).match(/^(N[FX])-(\d+)$/i);
    return !(m && m[1].toLowerCase() === linha && Number(m[2]) >= de && Number(m[2]) <= ate);
  }).length;
  return ate - de + 1 + fora;
}

// Chave de um set JÁ publicado, pelo nome dele (o prefixo do setId diz a linha).
export function chaveDoPublicado(setId, nome) {
  if (CHAVE_PUBLICADA[setId]) return CHAVE_PUBLICADA[setId];
  const linha = String(setId).startsWith("nrt-nx-") ? "nx" : "nf";
  // O catálogo publicado antes de 2026-11-02 ainda traz o prefixo da linha.
  const serie = String(nome || "").replace(/^Data Carddass — /, "");
  return chaveDoSet(linha, capituloDaCarta(linha, "", serie), serie);
}

// setId PEGAJOSO. Era a POSIÇÃO do set na ordem por data (`s${i + 1}`), então
// corrigir uma data renumerava metade dos sets — e o setId é link de set
// (?setId=), chave do nome em inglês (VINTAGE_SET_EN em src/nomes-sets.js) e nome do
// chunk. Agora cada chave herda o setId que já tem no catálogo publicado; se
// duas viraram uma, fica o do set com mais cartas (o outro vai pro log, pra
// registrar o de-para). Chave nova ganha o próximo número livre, acima de todo
// id que já existiu — a numeração é uma só pras duas linhas, como sempre foi.
//   chaves:     [{ chave, linha }] dos sets novos
//   publicados: [{ setId, set }], uma entrada por carta nf/nx do catálogo atual
// Devolve { ids: Map(chave -> setId), juntados: [{ de, para, chave }] }.
export function atribuiSetIds(chaves, publicados) {
  const porChave = new Map(); // chave -> Map(setId -> nº de cartas)
  let maior = 0;
  const numeroDe = (id) => Number((/-s(\d+)$/.exec(id) || [])[1] || 0);
  for (const id of Object.keys(SETIDS_APOSENTADOS)) maior = Math.max(maior, numeroDe(id));
  for (const { setId, set } of publicados || []) {
    if (!setId) continue;
    maior = Math.max(maior, numeroDe(setId));
    const chave = chaveDoPublicado(setId, set);
    if (!porChave.has(chave)) porChave.set(chave, new Map());
    const conta = porChave.get(chave);
    conta.set(setId, (conta.get(setId) || 0) + 1);
  }
  const ids = new Map();
  const juntados = [];
  for (const { chave, linha } of chaves) {
    const conta = porChave.get(chave);
    if (conta) {
      const [vencedor, ...outros] = [...conta].sort((a, b) => b[1] - a[1] || numeroDe(a[0]) - numeroDe(b[0])).map(([id]) => id);
      ids.set(chave, vencedor);
      for (const de of outros) juntados.push({ de, para: vencedor, chave });
    } else {
      ids.set(chave, `nrt-${linha}-s${String(++maior).padStart(2, "0")}`);
    }
  }
  return { ids, juntados };
}
