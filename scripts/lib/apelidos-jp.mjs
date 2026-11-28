// Apelidos em romaji das cartas japonesas ("sasuke" acha うちはサスケ).
//
// Até 2026-11-28 isto morava no src/shared.js (JP_NAME_ALIASES + jpNameAliases,
// ~1,8 KB comprimido) e o cardSearchHaystack varria a tabela inteira em TODA
// carta de TODO jogo, em toda página. O teto do núcleo estava a 100% e isso é
// dado de catálogo, não código de tela: agora a tabela vive aqui, o build
// calcula o texto UMA vez por carta e o grava no campo `apelidos` (termos em
// romaji separados por espaço, só nas cartas que casam). O cardSearchHaystack
// só junta `card.apelidos` ao resto do texto.
//
// Regra do campo: é função do `name` + `nameJp` da carta e nada mais. Por isso
// o escritor comum (sync-common.mjs#writeGameCatalog e o merge-catalogs do
// Pokémon) recalcula em toda gravação: carta que ganhou ou perdeu o nome em
// japonês ganha ou perde o campo sozinha, sem ninguém lembrar de tocá-lo.
//
// A busca da borda (functions/api/_search-sql.js, D1) NUNCA teve os apelidos e
// segue sem eles: o banco não tem a coluna.
//
// Os dois blocos abaixo (tabela e função) são os do shared.js, sem mudar uma
// entrada: o tests/apelidos-jp.test.mjs trava a tabela.

export const JP_NAME_ALIASES = [
  // NARUTO
  ["naruto", ["ナルト"]], ["sasuke", ["サスケ"]], ["sakura", ["サクラ", "春野"]],
  ["kakashi", ["カカシ"]], ["lee", ["リー"]], ["rock", ["ロック"]],
  ["neji", ["ネジ"]], ["hinata", ["ヒナタ"]], ["gaara", ["我愛羅"]],
  ["shikamaru", ["シカマル"]], ["ino", ["山中いの"]], ["choji", ["チョウジ"]], ["chouji", ["チョウジ"]],
  ["kiba", ["キバ", "犬塚"]], ["shino", ["油女", "シノ"]], ["temari", ["テマリ"]],
  ["kankuro", ["カンクロウ"]], ["tsunade", ["綱手"]], ["jiraiya", ["自来也"]],
  ["orochimaru", ["大蛇丸"]], ["itachi", ["イタチ"]], ["kisame", ["鬼鮫", "干柿"]],
  ["zabuza", ["再不斬", "桃地"]], ["haku", ["白"]], ["guy", ["マイト", "ガイ"]], ["gai", ["ガイ"]],
  ["kabuto", ["薬師", "カブト"]], ["anko", ["アンコ", "みたらし"]], ["shizune", ["シズネ"]],
  ["kimimaro", ["君麻呂"]], ["tayuya", ["多由也"]], ["asuma", ["アスマ", "猿飛"]],
  ["tenten", ["テンテン"]], ["hokage", ["火影"]], ["akatsuki", ["暁"]],
  ["rasengan", ["螺旋丸"]], ["chidori", ["千鳥"]], ["sharingan", ["写輪眼"]], ["byakugan", ["白眼"]],
  ["kyuubi", ["九尾"]], ["deidara", ["デイダラ"]], ["sai", ["サイ"]], ["yamato", ["ヤマト"]],
  // ONE PIECE
  ["luffy", ["ルフィ"]], ["zoro", ["ゾロ", "ロロノア"]], ["nami", ["ナミ"]],
  ["usopp", ["ウソップ"]], ["sanji", ["サンジ"]], ["chopper", ["チョッパー"]],
  ["robin", ["ロビン"]], ["franky", ["フランキー"]], ["brook", ["ブルック"]],
  ["jinbe", ["ジンベエ"]], ["ace", ["エース", "ポートガス"]], ["shanks", ["シャンクス"]],
  ["buggy", ["バギー"]], ["crocodile", ["クロコダイル"]], ["mihawk", ["ミホーク"]],
  ["hancock", ["ハンコック"]], ["blackbeard", ["ティーチ", "黒ひげ"]], ["teach", ["ティーチ"]],
  ["whitebeard", ["白ひげ", "ニューゲート"]], ["marco", ["マルコ"]], ["garp", ["ガープ"]],
  ["sengoku", ["センゴク"]], ["ivankov", ["イワンコフ"]], ["bonney", ["ボニー"]],
  ["kidd", ["キッド"]], ["kid", ["キッド"]], ["drake", ["ドレーク"]], ["law", ["トラファルガー", "ロー"]],
  ["vivi", ["ビビ"]], ["smoker", ["スモーカー"]], ["arlong", ["アーロン"]], ["sabo", ["サボ"]],
  ["monkey", ["モンキー"]], ["gomu", ["ゴムゴム"]], ["merry", ["メリー"]], ["sunny", ["サニー"]],
  // HUNTER×HUNTER
  ["gon", ["ゴン"]], ["freecss", ["フリークス"]], ["killua", ["キルア"]], ["zoldyck", ["ゾルディック"]],
  ["kurapika", ["クラピカ"]], ["leorio", ["レオリオ"]], ["hisoka", ["ヒソカ"]], ["kuroro", ["クロロ"]],
  ["chrollo", ["クロロ"]], ["lucilfer", ["ルシルフル"]], ["biscuit", ["ビスケット"]], ["bisky", ["ビスケット"]],
  ["kruger", ["クルーガー"]], ["shizuku", ["シズク"]], ["shalnark", ["シャルナーク"]], ["feitan", ["フェイタン"]],
  ["machi", ["マチ"]], ["nobunaga", ["ノブナガ"]], ["uvogin", ["ウボォー"]], ["pakunoda", ["パクノダ"]],
  ["netero", ["ネテロ"]], ["zushi", ["ズシ"]], ["wing", ["ウイング"]], ["kite", ["カイト"]],
  ["ging", ["ジン"]], ["illumi", ["イルミ"]], ["genthru", ["ゲンスルー"]], ["meruem", ["メルエム"]],
  ["nen", ["念"]], ["kurta", ["クルタ"]], ["ryodan", ["旅団"]], ["phantom", ["幻影旅団"]]
];
export const JP_CHARS = /[぀-ヿ一-鿿]/;
export function jpNameAliases(jpName) {
  if (!JP_CHARS.test(jpName)) return "";
  let out = "";
  for (const [en, jps] of JP_NAME_ALIASES) {
    for (const jp of jps) { if (jpName.includes(jp)) { out += " " + en; break; } }
  }
  return out;
}

// Texto de apelidos de UMA carta: os termos em romaji na ordem da tabela,
// separados por espaço, ou "" quando nenhum casa. Lê o mesmo que o cliente lia
// (name + nameJp) — nameEn e pokemonName ficam de fora de propósito, já são
// latinos e entram no texto de busca por conta própria.
export function apelidosDaCarta(card) {
  const c = card || {};
  return jpNameAliases(`${c.name || ""} ${c.nameJp || ""}`).trim();
}

// Grava (ou tira) o campo `apelidos` de UMA carta, no lugar. Devolve true se a
// carta mudou — quem escreve usa isso pra decidir se regrava o arquivo.
export function carimbaApelido(card) {
  if (!card || typeof card !== "object") return false;
  const texto = apelidosDaCarta(card);
  if (texto) {
    if (card.apelidos === texto) return false;
    card.apelidos = texto;
    return true;
  }
  if (!("apelidos" in card)) return false;
  delete card.apelidos;
  return true;
}

// O mesmo pra uma lista. Devolve quantas cartas MUDARAM.
export function carimbaApelidos(cards) {
  let mudou = 0;
  for (const card of cards || []) if (carimbaApelido(card)) mudou++;
  return mudou;
}
