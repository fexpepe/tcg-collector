// Dragon Ball Z CCG da Score Entertainment (abr/2000 – jun/2006): o jogo
// vintage `dbz`. Três títulos em sequência da mesma editora e do mesmo motor,
// uma seção cada na página de Sets (docs/CATALOGO.md, 4.1):
//   - Dragon Ball Z CCG (2000–2003): 11 sagas, Saiyan → Kid Buu;
//   - Dragon Ball GT TCG (fev/2004 em diante): Baby, Super 17, Shadow Dragon e
//     Lost Episodes;
//   - Dragon Ball Z TCG (o relançamento de jul/2005): Arrival, Showdown e
//     Transformation.
// Não confundir com o DBZ TCG da Panini (2014–2019, que é a categoria 23 da
// TCGCSV) nem com o Fusion World da Bandai (`dbfw`).
//
// Fontes (levantamento de 2026-11-01):
//   retrodbzccg.com — o site da comunidade que mantém o jogo. Uma galeria por
//     set e raridade, lida pela API REST do WordPress
//     (/wp-json/wp/v2/pages/<id>): o título de cada imagem é "<número> <nome>",
//     e a imagem original é o scan (400×550 nas sagas do DBZ, 312×440 no GT,
//     250×350 no relançamento de 2005 — abaixo dos 440 px do contrato, mas é a
//     única fonte com todas as cartas). robots.txt vazio.
//   kizmt/dbz-ccg-data (GitHub, commit pinado em KIZMT_URL) — cópia do banco
//     do dragonballzocg.com (o simulador online, fora do ar). Só completa o NOME
//     quando a galeria tem apenas o número (Trunks, Androids, Cell, Cell Games,
//     World Games, Babidi, Buu e Fusion Saga), casando pelo set e pelo número.
//     Medido na importação: concorda com o retrodbzccg em 527 de 551 cartas que
//     os dois nomeiam; as 24 que discordam são do Kid Buu Saga, onde o kizmt
//     misturou a numeração do subset Bojack Unbound — por isso o Kid Buu fica
//     fora do KIZMT_SET.
//   NOMES_LIDOS — o que nenhuma das duas fontes nomeia (promos e previews das
//     galerias só com número), lido no próprio scan.
// Fontes descartadas: o ccgtrader (robots.txt barra agentes de IA pelo nome);
// o plugin do LackeyCCG (robots Disallow); TCGplayer/TCGCSV não têm o jogo.
// Fora do catálogo: os sets "virtuais" (Virtual Subset 2012–2015 e
// "Revelation", nunca impressos — CATALOGO.md, contrato 3) e o 19Retro do kizmt
// (fan-made).
//
// Sem data por set: com fonte só há o mês de 5 sets (Saiyan abr/2000, Cell
// dez/2001, World Games out/2002, Baby fev/2004, Arrival jul/2005), e a data
// pela metade punha o Arrival como "Último set" no topo da página, à frente do
// Showdown e do Transformation. A ordem vem do setId (groupDbzSets no app.js).
// Sem preço (vintage) e sem variantes: Limited/Unlimited/Foil existem, mas
// nenhuma das fontes diz quais cartas saíram em quais.
//
// O CI só monta data/dbz/ a partir do snapshot versionado
// (data/vintage/dbz-retro.json): o jogo acabou. `--importar` busca de novo e
// regrava o snapshot, se não regredir.
//
// IDs: dbz-<set>-<número em minúsculas, sem zero à esquerda> — "040" do Trunks
// Saga vira dbz-s3-40, o P3 dos promos do Saiyan vira dbz-p1-p3. Carta sem
// número (Earth Dragon Ball Alt Art, The Golden Ticket) leva o nome no id. O
// id fica gravado no snapshot e o re-import reaproveita o da carta já conhecida
// (ids pegajosos, pelo set + número).
//
//   node scripts/sync-dbz.mjs             # build do snapshot (o que o CI roda)
//   node scripts/sync-dbz.mjs --importar  # busca as fontes e regrava o snapshot
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, fetchRetry, sleep, slug } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/dbz-retro.json", ROOT);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sleevu/1.0 (+sleevu.app)" };
const RETRO_API = "https://www.retrodbzccg.com/wp-json/wp/v2/pages/";
const RETRO_UPLOADS = "retrodbzccg.com/wp-content/uploads/";
const KIZMT_URL = "https://raw.githubusercontent.com/kizmt/dbz-ccg-data/cc7ff9ab41aa576d55f9b278093bfe1fabb7ea30/cards.json";
const GAME = "dbz";
const ID_PREFIX = "dbz-";

// Ordem = ordem de lançamento dentro da série. `code` vira o setId
// (dbz-<code>); `pages` são as galerias do retrodbzccg que formam o set, com a
// raridade que a galeria dá (as do GT e do 2005 são o set inteiro, sem
// raridade). Os promos de cada saga (P, os previews PR que saíram antes dela e
// os resgates de embalagem) são um set "<Saga> Promos", que a página de Sets
// mostra como chip no cartão da saga.
const R = (id, rarity = "") => ({ id, rarity });
const SETS = [
  { code: "s1", name: "Saiyan Saga", serie: "z", pages: [R(34, "Common"), R(98, "Uncommon"), R(199, "Rare"), R(264, "Starter"), R(296, "Ultra Rare")] },
  { code: "p1", name: "Saiyan Saga Promos", serie: "z", promo: true, pages: [R(306, "Promo")] },
  { code: "s2", name: "Frieza Saga", serie: "z", pages: [R(317, "Common"), R(357, "Uncommon"), R(413, "Rare"), R(463, "Ultra Rare")] },
  { code: "p2", name: "Frieza Saga Promos", serie: "z", promo: true, pages: [R(468, "Promo"), R(484, "Redemption")] },
  { code: "s3", name: "Trunks Saga", serie: "z", pages: [R(504, "Common"), R(547, "Uncommon"), R(622, "Rare"), R(670, "Starter"), R(713, "Ultra Rare")] },
  { code: "p3", name: "Trunks Saga Promos", serie: "z", promo: true, pages: [R(452, "Preview"), R(729, "Promo")] },
  { code: "s4", name: "Androids Saga", serie: "z", pages: [R(766, "Common"), R(805, "Uncommon"), R(861, "Rare"), R(900, "Ultra Rare")] },
  { code: "p4", name: "Androids Saga Promos", serie: "z", promo: true, pages: [R(720, "Preview"), R(914, "Promo")] },
  { code: "s5", name: "Cell Saga", serie: "z", pages: [R(928, "Common"), R(971, "Uncommon"), R(1045, "Rare"), R(1094, "Starter"), R(1137, "Ultra Rare")] },
  { code: "p5", name: "Cell Saga Promos", serie: "z", promo: true, pages: [R(905, "Preview"), R(1153, "Promo"), R(742, "Redemption")] },
  { code: "s6", name: "Cell Games Saga", serie: "z", pages: [R(1199, "Common"), R(1233, "Uncommon"), R(1297, "Rare"), R(1331, "Ultra Rare")] },
  { code: "p6", name: "Cell Games Saga Promos", serie: "z", promo: true, pages: [R(1144, "Preview"), R(1345, "Promo"), R(1167, "Redemption")] },
  { code: "s7", name: "World Games Saga", serie: "z", pages: [R(1358, "Common"), R(1400, "Uncommon"), R(1482, "Rare"), R(1524, "Starter"), R(1567, "Ultra Rare")] },
  { code: "p7", name: "World Games Saga Promos", serie: "z", promo: true, pages: [R(1336, "Preview"), R(1600, "Promo"), R(2509, "Redemption")] },
  { code: "s8", name: "Babidi Saga", serie: "z", pages: [R(1613, "Common"), R(1647, "Uncommon"), R(1711, "Rare"), R(1743, "Ultra Rare")] },
  { code: "p8", name: "Babidi Saga Promos", serie: "z", promo: true, pages: [R(1574, "Preview"), R(1797, "Promo")] },
  { code: "s9", name: "Buu Saga", serie: "z", pages: [R(1810, "Common"), R(1892, "Uncommon"), R(1973, "Rare"), R(2011, "Starter"), R(2063, "Ultra Rare")] },
  { code: "p9", name: "Buu Saga Promos", serie: "z", promo: true, pages: [R(1748, "Preview"), R(2073, "Promo")] },
  { code: "s10", name: "Fusion Saga", serie: "z", pages: [R(2099, "Common"), R(2133, "Uncommon"), R(2197, "Rare"), R(2231, "Ultra Rare")] },
  { code: "p10", name: "Fusion Saga Promos", serie: "z", promo: true, pages: [R(2089, "Preview"), R(2284, "Promo"), R(2514, "Redemption")] },
  { code: "s11", name: "Kid Buu Saga", serie: "z", pages: [R(2297, "Common"), R(2333, "Uncommon"), R(2443, "Rare"), R(2477, "Ultra Rare")] },
  { code: "p11", name: "Kid Buu Saga Promos", serie: "z", promo: true, pages: [R(2236, "Preview"), R(2491, "Promo")] },
  // Subsets: coleções curtas com numeração própria, vendidas à parte (filmes,
  // caixas especiais).
  { code: "lv", name: "Lost Villains & Puppet Show", serie: "zsub", pages: [R(1584, "Subset")] },
  { code: "m7", name: "Super Android 13", serie: "zsub", pages: [R(1759, "Subset")] },
  { code: "m8", name: "Broly: The Legendary Super Saiyan", serie: "zsub", pages: [R(1851, "Subset")] },
  { code: "ca", name: "Cosmic Anthology", serie: "zsub", pages: [R(2245, "Subset")] },
  { code: "bu", name: "Bojack Unbound", serie: "zsub", pages: [R(2397, "Subset")] },
  { code: "b2", name: "Broly Subset Part II", serie: "zsub", pages: [R(2436, "Subset")] },
  { code: "tf", name: "Tuff Enuff", serie: "zsub", pages: [R(1174, "Subset")] },
  { code: "cc", name: "Capsule Corp Power Pack", serie: "zsub", pages: [R(2636, "Subset")] },
  // Promos fora de saga. Os de liga (Seasons) e os de juiz ficam à parte: o
  // K1 do juiz (King Kai) e o K1 da Kraft são cartas diferentes.
  { code: "pr", name: "Dragon Ball Z Promos", serie: "zsub", promo: true, pages: [R(494, "Promo"), R(2604, "Promo"), R(2597, "Promo"), R(2567, "Promo"), R(2572, "Promo"), R(2578, "Promo"), R(2588, "Promo"), R(2554, "Promo"), R(2542, "Promo"), R(2529, "Promo"), R(2617, "Promo"), R(2684, "Promo")] },
  { code: "lg", name: "Dragon Ball Z League & Judge Promos", serie: "zsub", promo: true, pages: [R(2740, "League"), R(2753, "League"), R(2726, "League"), R(2780, "League"), R(2766, "League"), R(2793, "League"), R(2625, "Judge")] },
  // Dragon Ball GT TCG. As galerias trazem junto os previews e promos da saga
  // ("Preview 1 …", "Promo 1 …"), que vão pro set "<Saga> Promos".
  { code: "g1", name: "Baby Saga", serie: "gt", pages: [R(9940)] },
  { code: "g2", name: "Super 17 Saga", serie: "gt", pages: [R(10469)] },
  { code: "g3", name: "Shadow Dragon Saga", serie: "gt", pages: [R(10805)] },
  { code: "g4", name: "Lost Episodes Saga", serie: "gt", pages: [R(11009)] },
  { code: "gbc", name: "Broly: The Second Coming", serie: "gt", pages: [R(10294, "Subset")] },
  { code: "gvi", name: "Villain Invasion", serie: "gt", pages: [R(10837, "Subset")] },
  { code: "gpr", name: "Dragon Ball GT Promos", serie: "gt", promo: true, pages: [R(2482, "Preview"), R(11075, "Promo"), R(11132, "League"), R(11167, "Promo"), R(10481, "Redemption")] },
  // Dragon Ball Z TCG (2005).
  { code: "t1", name: "Arrival", serie: "tcg", pages: [R(11459)] },
  { code: "t2", name: "Showdown", serie: "tcg", pages: [R(11589)] },
  { code: "t3", name: "Transformation", serie: "tcg", pages: [R(11715)] }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
// Previews e promos embutidos nas galerias do GT → o set de promos da saga.
const PROMOS_DA_SAGA = { g1: "g1p", g2: "g2p", g3: "g3p", g4: "g4p" };
for (const [saga, code] of Object.entries(PROMOS_DA_SAGA)) {
  const pai = SET_BY_CODE.get(saga);
  const def = { code, name: `${pai.name} Promos`, serie: "gt", promo: true, pages: [] };
  SETS.splice(SETS.indexOf(pai) + 1, 0, def);
  SET_BY_CODE.set(code, def);
}

// Set do kizmt de onde vem o nome que a galeria não tem (Kid Buu fora: ver o
// cabeçalho).
const KIZMT_SET = { s1: "Saiyan Saga", s2: "Frieza Saga", s3: "Trunks Saga", s4: "Android Saga", s5: "Cell Saga", s6: "Cell Games Saga", s7: "World Games Saga", s8: "Babidi Saga", s9: "Buu Saga", s10: "Fusion Saga" };

// Nomes lidos no scan (2026-11-01). VENCEM as duas fontes. Servem pra carta que
// nenhuma fonte nomeia (os promos e previews das galerias só com número e as
// 24 cartas das sagas que o kizmt também não tem) e pros erros de digitação da
// galeria conferidos no scan ("Pupper", "Saiyn", "Strugles"). Personagem leva o
// nível do selo ("Lv. N"), como o resto do catálogo; ® e ™ ficam de fora. Os
// oito do Buu Saga Starter de 160 a 200 são as cartas gigantes (800×550) de
// nível 2. Chave: <set>|<número>.
export const NOMES_LIDOS = {
  "s1|192": "Teaching the Unteachable Forces Observation", "s5|162": "Goku, the Saiyan Lv. 2",
  "p6|P2": "A Father Struggles", "lv|LV6": "Cell's Neck Grab",
  "lv|PS1": "Cell, the Puppet Lv. 3", "lv|PS2": "Goku, the Puppet Lv. 1", "lv|PS3": "Piccolo, the Puppet Lv. 1",
  "lv|PS4": "Vegeta, the Puppet Lv. 1", "lv|PS5": "Hercule, the Puppet Lv. 1",
  "s3|2": "Red Kienzan Discs", "s3|74": "Black Energy Deflection Drill", "s3|141": "Black Physical Focus",
  "s5|8": "Black Fatality", "s5|33": "Red Face Strike",
  "s6|2": "Black Fist Lock", "s6|44": "Blue Energy Blast", "s6|98": "Cell Jr. 2 Lv. 1",
  "s7|4": "Black Light Jab",
  "s8|18": "Orange Elbow Smash", "s8|33": "Android 18's Pressure Routine", "s8|86": "Red Tilted Punch", "s8|119": "Risky Maneuver",
  "s9|160": "Goku Lv. 2", "s9|165": "Gohan Lv. 2", "s9|166 Alt": "Kid Trunks Lv. 1", "s9|170": "Kid Trunks Lv. 2",
  "s9|175": "Goten Lv. 2", "s9|188": "Majin Babidi Lv. 2", "s9|193": "Majin Vegeta Lv. 2", "s9|198": "Majin Buu Lv. 2",
  "s9|200": "Majin Buu Lv. 2",
  "s10|72": "Red Cross Slash", "s10|95": "Blue Backhand",
  "m8|13": "Saiyan Cliff Slam",
  "p3|P1": "Trunks' Defensive Crouch", "p3|P2": "Confrontation", "p3|P3": "Concentration Drill", "p3|P4": "Blue Battle Drill",
  "p3|P5": "Tien Stands Ready", "p3|P6": "King Cold's Sword Trick", "p3|P7": "Garlic Jr.'s Revenge", "p3|P8": "Trunks' Power Strike",
  "p3|P9": "Surprise!", "p3|P10": "Showdown",
  "p4|PR1": "Android 20 Absorbing Drill", "p4|PR2": "Android 20 Powers Up", "p4|PR3": "Android Effect",
  "p4|PR4": "Super Saiyan Effect", "p4|PR5": "Too Late", "p4|PR6": "Trunks Finds the Answer",
  "p5|C1": "Cell Smiles", "p5|C2": "Cell's Dark Attack", "p5|C3": "Cell's Energy Blast", "p5|C4": "Cell's Defense",
  "p5|C5": "Awful Abrasions", "p5|C6": "Cell's Threatening Position",
  "p5|P1": "Cell's Self Destruct", "p5|P2": "Cell's Domination Drill", "p5|P3": "Kami's Idea", "p5|P4": "He's Safe",
  "p5|P5": "Just Thinking", "p5|P6": "Land in Pain", "p5|P7": "It's All About Time", "p5|P8": "Trunks Thinking",
  "p5|P9": "Looking Good", "p5|P10": "Piccolo's Fist Block",
  "p6|P3": "Vegeta is Lurking",
  "p6|PR1": "Cell's Draining", "p6|PR2": "Cell's Arena", "p6|PR3": "Cell's Last Strike", "p6|PR4": "They're All There",
  "p6|PR5": "Heroes' Battleground", "p6|PR6": "Cell's Style",
  "p7|P1": "Celestial Battleground", "p7|P2": "Chi-Chi Lv. 1", "p7|P3": "Heroic Block", "p7|P4": "HUH???",
  "p7|P5": "Majin's Perfect Defense", "p7|P6": "Quick Recovery Drill", "p7|P7": "Red Pressured Attack", "p7|P8": "Saiyan Crush",
  "p7|P9": "Tapkar on the Move", "p7|P10": "Videl's Battle Ready",
  "p7|PR1": "Celestial Games Begin", "p7|PR2": "Goku Helping Drill", "p7|PR3": "Gohan Meditates",
  "p7|PR4": "Gathering of Warriors", "p7|PR5": "Brothers in Training", "p7|PR6": "Chi-Chi on the Attack!",
  "p8|P1": "Majin Babidi's Magic", "p8|P2": "Power Through Might", "p8|P3": "Goku's Energy Clash", "p8|P4": "Goku's Energy Explosion",
  "p8|P5": "Jewel Lv. 1", "p8|P6": "Majin Strength Maneuver", "p8|P7": "Master Roshi's Makeshift Background", "p8|P8": "Outer Space",
  "p8|P9": "Gohan's Hidden Power", "p8|P10": "Total Defense Drill",
  "p8|PR1": "Face Off", "p8|PR2": "Righteous Strike", "p8|PR3": "Evil's True Face", "p8|PR4": "Energy Drain",
  "p8|PR5": "Supreme Kai's Power Hold", "p8|PR6": "Supreme Kai Lv. 1", "p8|PR7": "Majin Vegeta, the Dark Prince Lv. 1",
  "p9|P1": "Outburst Drill", "p9|P2": "Goku's Power Strike", "p9|P3": "Majin Buu's Fury", "p9|P4": "Deceptive Moves",
  "p9|P5": "Kid Trunks, the Fighter Lv. 2", "p9|P6": "Red Mouth Shot", "p9|P7": "Black Misguiding Punch", "p9|P8": "Goku's Face Break",
  "p9|P9": "Releasing Untapped Potential", "p9|P10": "Majin Buu's Smooch",
  "p9|PR1": "Orange Headbutt", "p9|PR2": "Saiyan Escape", "p9|PR3": "Blue Buu Blast", "p9|PR4": "Namekian Knowledge Drill",
  "p9|PR5": "Black Choke Hold", "p9|PR6": "Red Torso Chop", "p9|PR7": "Red City Destruction", "p9|PR8": "Red Escape",
  "p10|PR1": "Red Pulverize", "p10|PR2": "Surrounded!", "p10|PR3": "Orange 5-Finger Focus", "p10|PR4": "Watching From Afar",
  "p10|PR5": "Vegeta's Pride Drill", "p10|PR6": "Gohan, Mystic Lv. 4",
  "p11|PR1": "Goku's Flight", "p11|PR2": "Majin Buu's Choke Hold", "p11|PR3": "Majin Bibidi, the Mastermind Lv. 1",
  "p11|PR4": "Peaceful Times", "p11|PR5": "The Power of Porunga", "p11|PR6": "Devastation Drill"
};

// ---------------------------------------------------------------------------
// Das galerias pro snapshot
// ---------------------------------------------------------------------------

const ENTIDADES = { "&amp;": "&", "&quot;": '"', "&nbsp;": " ", "&hellip;": "…" };
const decode = (s) => String(s || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&\w+;/g, (e) => ENTIDADES[e] ?? e);

// Grafia do nível uniforme ("LV4", "Lv.4", "Level 4" → "Lv. 4"), aspas e
// travessão retos, reticências e espaços.
export function limpaNome(s) {
  return decode(s)
    .replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/\b(?:LV|Lv|lv|Level)\.?\s*(\d)/g, "Lv. $1")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–]+|[\s\-–]+$/g, "")
    .trim();
}

// As imagens de uma galeria: título ("<número> <nome>") e o arquivo original.
export function itensDaGaleria(html) {
  const out = [];
  for (const m of String(html).matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const attr = (n) => { const a = tag.match(new RegExp(`\\b${n}="([^"]*)"`)); return a ? decode(a[1]) : ""; };
    const orig = attr("data-orig-file") || attr("src");
    const i = orig.indexOf("/wp-content/uploads/");
    if (i < 0) continue;
    out.push({ titulo: attr("data-image-title") || attr("alt") || attr("title"), img: orig.slice(i + "/wp-content/uploads/".length).split("?")[0] });
  }
  return out;
}

// "60 Blue One-Arm Shoulder Throw" → { num: "60", nome }; "040" → { num: "40",
// nome: "" }; "PR1 …", "GKI-1 …", "L3-0 …", "Preview 2 …" (→ PR2), "Promo 3 …"
// (→ P3, só nas galerias do GT), "166 alt" (→ "166 Alt"). Sem número: num "".
export function numeroENome(titulo) {
  const t = decode(titulo).trim();
  let m = t.match(/^Preview\s+(\d+)\s*(.*)$/i);
  if (m) return { num: `PR${Number(m[1])}`, nome: limpaNome(m[2]), embutido: true };
  m = t.match(/^Promo\s+(\d+)\s*(.*)$/i);
  if (m) return { num: `P${Number(m[1])}`, nome: limpaNome(m[2]), embutido: true };
  // "116b": a segunda carta impressa com o mesmo número (Androids Saga).
  m = t.match(/^(\d+)([a-z]\b)?(\s+alt\b)?\s*(.*)$/i);
  if (m) return { num: String(Number(m[1])) + (m[2] || "") + (m[3] ? " Alt" : ""), nome: limpaNome(m[4]) };
  m = t.match(/^([A-Z]{1,5}-?\d+(?:-\d+)?)\b\s*(.*)$/);
  if (m) return { num: m[1].replace(/^([A-Z]+)0+(\d)/, "$1$2"), nome: limpaNome(m[2]) };
  return { num: "", nome: limpaNome(t) };
}

// O banco só aceita [A-Za-z0-9._-] em id de carta.
export const idDe = (setCode, num, nome) =>
  `${ID_PREFIX}${setCode}-${num ? num.toLowerCase().replace(/\s+/g, "") : slug(nome)}`.replace(/[^a-z0-9._-]/g, "");

// O set de uma imagem da galeria: o preview/promo embutido nas galerias do GT
// vai pro set de promos da saga.
const setDoItem = (def, item) => (item.embutido && PROMOS_DA_SAGA[def.code]) || (!item.num && def.serie === "gt" && PROMOS_DA_SAGA[def.code]) || def.code;

// Monta as cartas do snapshot a partir das galerias baixadas ({ <pageId>: html })
// e do banco do kizmt. Devolve { cards, semNome }.
export function cartasDasGalerias(paginas, kizmt = []) {
  const kz = new Map();
  for (const c of kizmt) if (c && c.number && c.name) kz.set(`${c.set}|${Number(c.number)}`, c.name);
  const cards = [];
  const semNome = [];
  const vistos = new Set();
  for (const def of SETS) {
    for (const pg of def.pages) {
      const html = paginas[pg.id];
      if (html == null) continue;
      for (const it of itensDaGaleria(html)) {
        // Impressão com erro (o Goku com o número do Raditz): fora, como os
        // misprints nos outros jogos.
        if (/\bError Dupe$/i.test(decode(it.titulo))) continue;
        const p = numeroENome(it.titulo);
        // Oito cartas do Saiyan Saga têm só o nome no título; o número está no
        // nome do arquivo ("45-Saiyan-City-Destruction.jpg").
        const doArquivo = !p.num && !def.promo && it.img.split("/").pop().match(/^(\d+)-[A-Za-z]/);
        if (doArquivo) p.num = String(Number(doArquivo[1]));
        const set = setDoItem(def, p);
        const promo = set !== def.code;
        // Os 7 promos de revista do Saiyan Saga também saíram em prata: variante
        // da mesma carta (mesmo número), não carta nova.
        if (/\bSilver$/.test(p.nome)) {
          const irma = cards.find((c) => c.set === set && c.num === p.num);
          if (irma) { irma.variants = ["Normal", "Silver"]; continue; }
        }
        // O título dos promos de revista traz onde a carta saiu ("Goku Level 4
        // – In Power Magazine #3"); o nome é só o da carta.
        let nome = p.nome.replace(/ - (?:In Power|Inquest|Scrye|Wizard|Toyfare)\b.*$/, "");
        // No GT o título do personagem vem depois de vírgula, como no DBZ
        // ("Rage Shenron, Puppeteer"); a galeria escreve com travessão.
        if (def.serie === "gt") nome = nome.replace(/^([^,]+?) - (.+ Lv\. \d+(?: HT)?)$/, "$1, $2");
        let fonte = nome ? "retro" : "";
        if (NOMES_LIDOS[`${set}|${p.num}`]) { nome = NOMES_LIDOS[`${set}|${p.num}`]; fonte = "scan"; }
        if (!nome && KIZMT_SET[set] && /^\d+$/.test(p.num) && kz.has(`${KIZMT_SET[set]}|${p.num}`)) {
          nome = limpaNome(kz.get(`${KIZMT_SET[set]}|${p.num}`));
          fonte = "kizmt";
        }
        const id = idDe(set, p.num, nome);
        if (vistos.has(id)) continue;   // a mesma imagem em duas galerias
        vistos.add(id);
        if (!nome) semNome.push(`${set} ${p.num || "?"} (${it.img})`);
        cards.push({
          id, set, num: p.num, name: nome,
          rarity: promo ? (p.num.startsWith("PR") ? "Preview" : "Promo") : pg.rarity,
          img: it.img, ...(fonte && fonte !== "retro" ? { nameSource: fonte } : {})
        });
      }
    }
  }
  return { cards, semNome };
}

// Reaproveita o id da carta já conhecida (mesmo set + número) e mantém no
// snapshot o que a fonte deixou de listar.
export function mergeSnapshotCards(fresh, known = []) {
  const chave = (c) => `${c.set}|${c.num || c.name}`;
  const byKey = new Map(known.map((c) => [chave(c), c]));
  const out = fresh.map((c) => (byKey.has(chave(c)) ? { ...c, id: byKey.get(chave(c)).id } : c));
  const seen = new Set(out.map(chave));
  for (const k of known) if (!seen.has(chave(k))) out.push(k);
  return out;
}

async function importar(existing) {
  const paginas = {};
  for (const def of SETS) {
    for (const pg of def.pages) {
      try {
        const r = await fetchRetry(`${RETRO_API}${pg.id}?_fields=id,content`, { headers: UA });
        paginas[pg.id] = (await r.json()).content.rendered;
      } catch (e) {
        console.log(`  galeria ${pg.id} inacessível (${e.message}) — snapshot mantido.`);
        return existing;
      }
      await sleep(300);
    }
  }
  let kizmt = [];
  try { kizmt = await (await fetchRetry(KIZMT_URL, { headers: UA })).json(); }
  catch (e) { console.log(`  kizmt inacessível (${e.message}) — só os nomes das galerias.`); }
  const { cards: fresh, semNome } = cartasDasGalerias(paginas, kizmt);
  const known = (existing && existing.sets || []).flatMap((s) => (s.cards || []).map((c) => ({ ...c, set: s.code })));
  const all = mergeSnapshotCards(fresh, known);
  const sets = SETS.map((def) => ({ code: def.code, cards: all.filter((c) => c.set === def.code).map(({ set, ...c }) => c) }))
    .filter((s) => s.cards.length);
  const candidate = { source: RETRO_API, names: KIZMT_URL, importedAt: new Date().toISOString().slice(0, 10), sets };
  const n = snapshotCardCount(candidate);
  const antes = snapshotCardCount(existing);
  console.log(`  galerias: ${fresh.length} cartas, ${fresh.filter((c) => c.nameSource === "kizmt").length} com nome do kizmt (snapshot: ${antes}).`);
  if (semNome.length) console.log(`  ⚠ ${semNome.length} sem nome:\n    ${semNome.join("\n    ")}`);
  if (n < antes) { console.log(`  ⚠ REGRESSÃO (${n} < ${antes}) — snapshot mantido.`); return existing; }
  await writeSnapshot(SNAP, candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Do snapshot pro catálogo
// ---------------------------------------------------------------------------

export const imageUrl = (file) => (file
  ? `https://wsrv.nl/?url=${encodeURIComponent(RETRO_UPLOADS + file)}&w=440&we&output=webp`
  : "");

// Total oficial: o último número, quando o set vai de 1 até ele sem buraco (as
// sagas). Com buraco (o Capsule Corp Power Pack traz reimpressões numeradas 30
// e 42 no meio dos CCPP) ou em set de promo, sem total (a página conta).
export function setTotalOf(cards, def) {
  if (def.promo) return "";
  const nums = new Set(cards.filter((c) => /^\d+$/.test(c.num)).map((c) => Number(c.num)));
  const max = Math.max(0, ...nums);
  return max && nums.size === max ? String(max) : "";
}

async function build(snapshot) {
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = [];
  let comImagem = 0;
  for (const s of snapshot.sets || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    const total = setTotalOf(s.cards, def);
    for (const c of s.cards) {
      if (!c.name) continue;   // carta sem nome não vai pro ar (o log do --importar lista)
      const image = imageUrl(c.img);
      if (image) comImagem++;
      line.push({
        id: c.id,
        name: c.name,
        set: def.name,
        setId: `${ID_PREFIX}${def.code}`,
        number: c.num,
        ...(total ? { setTotal: total } : {}),
        setReleaseDate: "",
        rarity: c.rarity || "",
        artist: "",
        language: "en",
        image,
        variants: c.variants || ["Normal"],
        // Não há logo de saga pra usar (o retrodbzccg não publica, e foto de
        // embalagem não é logo — docs/CATALOGO.md, contrato 3), e só os nomes
        // deixavam a vitrine de Sets crua. Como no LOTR, no WoW e no Naruto,
        // todo set leva o logo do JOGO (pedido do Fernando, 2026-11-02); o
        // nome do set segue embaixo do tile.
        setLogo: "/assets/games/game_dbz.webp",
        vintage: true
      });
    }
  }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  // Carta publicada nunca some (alguém pode tê-la na coleção).
  const have = new Set(line.map((c) => c.id));
  const kept = existing.filter((c) => c && c.id && !have.has(c.id));
  const merged = line.concat(kept);
  await writeGameCatalog(outDir, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`  ${GAME}: ${line.length} cartas (${(snapshot.sets || []).length} sets, ${comImagem} com imagem) -> ${merged.length} totais`);
}

async function run() {
  console.log("Dragon Ball Z CCG (Score 2000–2006, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (process.argv.includes("--importar")) snapshot = await importar(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot — rode com --importar."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
export { SETS };
