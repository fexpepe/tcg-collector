// Ingestão do chinês simplificado pela Bulbapedia (scripts/lib/bulbapedia-zh.mjs)
// sobre FIXTURES de wikitext copiadas das páginas reais em 27/09/2026. O que
// está travado: (1) o código do set sai do SÍMBOLO de cada lista, com o ponto
// dos subsets de volta (CS15 -> CS1.5) e o sufixo C da TCGdex; (2) página com
// várias listas vira um set por lista, e o nome funde página + lista; (3) o
// wiki copia cabeçalho de outro set e isso não vaza pro nome nem pro código
// (Terastal Gathering "Stellar Crystal", Happy Set com símbolo do CSVH3);
// (4) promo de várias páginas vira UM set, com a página oficial mandando;
// (5) a impressão EN/JP é escolhida pela raridade, e sem casar não se chuta;
// (6) a arte vem da impressão no catálogo, EN antes de JA, subset incluso.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitParams, templates, plain, releasePages, dataDe, codigoDoSimbolo, nomeDoSet, numeroDe,
  nomeDaEntrada, parseSetPage, juntarSets, completarDatas, parseCardPage, desambiguacao,
  escolherImpressao, compactarImpressoes, expandirImpressoes, raridadeRegular, categoriaDe, variantesDe, dexDe, normSet, numKey, indiceArte, arteDe, montarCarta, tipoDoSet
} from "../scripts/lib/bulbapedia-zh.mjs";

test("splitParams respeita template e link aninhados", () => {
  assert.deepEqual(splitParams("001/151|B|{{TCG ID|Storming Emergence Radiant|Scyther|1}}|Grass||C"),
    ["001/151", "B", "{{TCG ID|Storming Emergence Radiant|Scyther|1}}", "Grass", "", "C"]);
  assert.deepEqual(splitParams("a|[[P (X 1)|Q]]{{GX}}|b"), ["a", "[[P (X 1)|Q]]{{GX}}", "b"]);
});

test("plain pega o ALVO do {{TCG}} (o nome do set), não o rótulo", () => {
  assert.equal(plain("{{TCG|SVP Black Star Promos|SVP Black Star Promotional}}"), "SVP Black Star Promos");
  assert.equal(plain("{{rar|Double Rare}}"), "Double Rare");
  assert.equal(plain("'''Radiant'''<br>[[Leafeon-GX (X 1)|Leafeon]]"), "Radiant Leafeon");
});

test("releasePages: páginas em ordem, com a era da seção", () => {
  const wt = `{| ! | Simplified Chinese Sun & Moon Series
|-
| {{SCTCG|SM-P Promotional cards}}<br>'''{{ATCG|Storming Emergence}}''': {{ATCG|Storming Emergence GX Starter Deck}}
|}
{| ! | Simplified Chinese Scarlet & Violet Series
|-
| ''{{ATCG|Collection 151|Collection 151: Journey}}'' • ''{{ATCG|Collection 151|Collection 151: Hope}}'' • {{TCG|30th Celebration}}
|}`;
  assert.deepEqual(releasePages(wt), [
    { title: "SM-P Promotional cards (SCTCG)", era: { id: "SM", name: "太阳&月亮" } },
    { title: "Storming Emergence (ATCG)", era: { id: "SM", name: "太阳&月亮" } },
    { title: "Storming Emergence GX Starter Deck (ATCG)", era: { id: "SM", name: "太阳&月亮" } },
    { title: "Collection 151 (ATCG)", era: { id: "SV", name: "朱&紫" } },
    { title: "30th Celebration (TCG)", era: { id: "SV", name: "朱&紫" } }
  ]);
});

test("dataDe: primeira data, e a chinesa numa página de produto japonês", () => {
  assert.equal(dataDe("January 17, 2025 (Journey)<br>April 18, 2025 (Hope)"), "2025-01-17");
  assert.equal(dataDe("'''Japanese:''' December 17, 2021<br>'''Simplified Chinese:''' May 17, 2024"), "2024-05-17");
  assert.equal(dataDe("August 3, 2024 - Present"), "2024-08-03");
  assert.equal(dataDe(""), "");
});

test("codigoDoSimbolo: código oficial, com o ponto dos subsets de volta", () => {
  assert.equal(codigoDoSimbolo("SetSymbolCSM1a.png"), "CSM1a");
  assert.equal(codigoDoSimbolo("SetSymbolCSV9.5.png"), "CSV9.5");
  assert.equal(codigoDoSimbolo("SetSymbolCS15.png"), "CS1.5");
  assert.equal(codigoDoSimbolo("SetSymbolCSM25.png"), "CSM2.5");
  assert.equal(codigoDoSimbolo("SetSymbolCS41.png"), "CS4.1");
  assert.equal(codigoDoSimbolo("SetSymbolCSV10.png"), "CSV10"); // o 10º set, não "1.0"
  assert.equal(codigoDoSimbolo("SetSymbolCollection 151.png"), "151");
  assert.equal(codigoDoSimbolo("SetSymbol30th Celebration SC.png"), "30th");
  assert.equal(codigoDoSimbolo("SetSymbol SMPromo.png"), "");
  assert.equal(codigoDoSimbolo("SetSymbolStart Deck 100.png"), "");
  assert.equal(codigoDoSimbolo(""), "");
});

test("nomeDoSet: lista única usa a página; várias fundem página e lista", () => {
  assert.equal(nomeDoSet("Terastal Gathering", "Stellar Crystal", 1), "Terastal Gathering");
  assert.equal(nomeDoSet("Storming Emergence", "Radiant", 3), "Storming Emergence Radiant");
  assert.equal(nomeDoSet("Battle Party Set", "Battle Party Set Reward Pack", 9), "Battle Party Set Reward Pack");
  assert.equal(nomeDoSet("Battle Party Set", "Grass Modification Pack", 9), "Battle Party Set Grass Modification Pack");
  // Nome longo: a parte que distingue vem primeiro (o tile corta o fim).
  assert.equal(nomeDoSet("Altaria & Latios & Infernape & Maushold Happy Set", "Happy Set Reward Pack", 3), "Happy Set Reward Pack (Altaria & Latios & Infernape & Maushold)");
  assert.equal(nomeDoSet("Altaria & Latios & Infernape & Maushold Happy Set", "Happy Set", 3), "Altaria & Latios & Infernape & Maushold Happy Set");
  assert.equal(nomeDoSet("Battle Party: Shared Dream", "Battle King Reward Pack", 2), "Battle King Reward Pack (Battle Party: Shared Dream)");
  assert.equal(nomeDoSet("Master Strategy Deck Building Sets", "Charizard ex Master Strategy Deck Building Set", 6), "Charizard ex Master Strategy Deck Building Set");
  assert.equal(nomeDoSet("Start Deck 100", "Start Deck 100 (Simplified Chinese)", 1), "Start Deck 100");
});

test("numeroDe: formatos das listas chinesas", () => {
  assert.deepEqual(numeroDe("001/151"), { number: "001", total: 151, promo: "" });
  assert.deepEqual(numeroDe("01 01/07"), { number: "01-01", total: 0, promo: "" });
  assert.deepEqual(numeroDe("001/SV-P"), { number: "001", total: 0, promo: "SV-P" });
  assert.deepEqual(numeroDe("012/30th-P"), { number: "012", total: 0, promo: "30th-P" });
  assert.deepEqual(numeroDe("SV-P"), { number: "", total: 0, promo: "SV-P" });
  assert.deepEqual(numeroDe("WAT"), { number: "WAT", total: 0, promo: "" });
  assert.equal(numeroDe("—").number, "");
});

test("nomeDaEntrada: TCG ID, link cru e energia básica", () => {
  assert.deepEqual(nomeDaEntrada("{{TCG ID|Collection 151|Mew ex|191|Mew}}{{ex}}"), { name: "Mew ex", page: "Mew ex (Collection 151 191)" });
  assert.deepEqual(nomeDaEntrada("[[Leafeon-GX (Battle Party Set Reward 1)|Leafeon]]{{GX}}"), { name: "Leafeon-GX", page: "Leafeon-GX (Battle Party Set Reward 1)" });
  assert.deepEqual(nomeDaEntrada("{{TCG|Basic Water Energy}}"), { name: "Basic Water Energy", page: "" });
  assert.deepEqual(nomeDaEntrada("{{TCG ID|Happy Set Happy Pack|Professor's Research|48}} <small>'''[Professor Juniper]'''</small>"), { name: "Professor's Research", page: "Professor's Research (Happy Set Happy Pack 48)" });
});

const STORMING = `{{TCGExpansionInfobox
|setname=Storming Emergence<br><small>横空出世</small>
|setsymbol=no <!--|setlogo=Velho Logo.png-->
|setlogo=CSM1 Logo A SC.png
|release=October 28, 2022
}}
==Set list==
{{Setlist/header|title=Radiant|tablecol=E85E29|rarity=yes|symbol=yes|image=SetSymbolCSM1a.png}}
{{Setlist/entry|001/151|B|{{TCG ID|Storming Emergence Radiant|Scyther|1}}|Grass||C}}
{{Setlist/entry|006/151|B|{{TCG ID|Storming Emergence Radiant|Moltres|6}}|Fire||U}}
{{Setlist/footer|tablecol=E85E29}}
{{Setlist/header|title=Abundant|tablecol=0390BC|rarity=yes|symbol=yes|image=SetSymbolCSM1c.png}}
{{Setlist/entry|211/151|A|{{TCG ID|Storming Emergence Abundant|Brooklet Hill|211}}|Stadium||UR}}
{{Setlist/entry|212/151|A|{{TCG ID|Storming Emergence Abundant|Double Colorless Energy|212}}|Energy|Colorless|UR}}
{{Setlist/footer}}`;

test("parseSetPage: um set por lista, código do símbolo, data e logo sem comentário", () => {
  const r = parseSetPage(STORMING, "Storming Emergence (ATCG)");
  assert.equal(r.release, "2022-10-28");
  assert.equal(r.logo, "CSM1 Logo A SC.png");
  assert.deepEqual(r.listas.map((s) => [s.setId, s.name, s.total, s.entries.length]), [
    ["CSM1aC", "Storming Emergence Radiant", 151, 2],
    ["CSM1cC", "Storming Emergence Abundant", 151, 2]
  ]);
  assert.deepEqual(r.listas[1].entries[1], { number: "212", total: 151, promo: "", name: "Double Colorless Energy", page: "Double Colorless Energy (Storming Emergence Abundant 212)", type: "Energy", subtype: "Colorless", rarity: "UR", mark: "A" });
});

test("parseSetPage: Gem Pack, cabeçalho copiado e Happy Set com símbolo de outro set", () => {
  const gem = parseSetPage(`{{TCGExpansionInfobox
| setname = Gem Pack Vol. 5
| setlogo = CBB5 Logo.png
| alt = CBB5
| release = April 24, 2026
}}
{{setlist/header|title=Gem Pack Vol. 5|rarity=yes|symbol=yes|image=SetSymbolCBB5.png}}
{{setlist/entry|01 01/07|H|{{TCG ID|Gem Pack Vol. 5|Captain Pikachu|1}}|Lightning||Gem C}}
{{setlist/entry|01 07/07|H|{{TCG ID|Gem Pack Vol. 5|Captain Pikachu|7}}|Lightning||Gem RRR}}
{{setlist/footer}}`, "Gem Pack Vol. 5 (ATCG)");
  assert.deepEqual(gem.listas.map((s) => [s.setId, s.name, s.entries.map((e) => e.number)]), [["CBB5C", "Gem Pack Vol. 5", ["01-01", "01-07"]]]);

  const tera = parseSetPage(`{{TCGExpansionInfobox|alt = CSV9.5|release = June 12, 2026}}
{{setlist/header|title=Stellar Crystal|image=SetSymbolCSV9.5.png}}
{{setlist/entry|001/208|H|{{TCG ID|Terastal Gathering|Exeggcute|1}}|Grass||C}}`, "Terastal Gathering (ATCG)");
  assert.equal(tera.listas[0].setId, "CSV9.5C");
  assert.equal(tera.listas[0].name, "Terastal Gathering");

  // A página do CSVH4 usa os símbolos de reward/modification do CSVH3.
  const happy = parseSetPage(`{{DeckInfobox|release=April 10, 2026}}
{{Setlist/header|title=Happy Set|image=SetSymbolCSVH4.png}}{{setlist/entry|001/059|H|{{TCG ID|Happy Set|Rowlet|1}}|Grass}}
{{Setlist/header|title=Happy Set Reward Pack|image=SetSymbolCSVH3p.png}}
{{setlist/entry|001/006|H|{{TCG ID|Happy Set Reward Pack|Decidueye ex|1}}|Grass}}
{{Setlist/header|title=Happy Set Happy Pack|image=SetSymbolCSVH3p.png}}
{{setlist/entry|001/049|H|{{TCG ID|Happy Set Happy Pack|Petilil|1}}|Grass}}`, "Decidueye & Melmetal & Koraidon & Miraidon Happy Set (ATCG)");
  assert.deepEqual(happy.listas.map((s) => s.setId), ["CSVH4C", "CSVH4pC", "CSVH4eC"]);
  assert.equal(happy.release, "2026-04-10");
});

test("parseSetPage: página (TCG) só com a lista chinesa; código fixo quando o wiki não tem símbolo", () => {
  const r = parseSetPage(`{{TCGExpansionInfobox|setlogo=Start Deck 100 Logo.png|release='''Japanese:''' December 17, 2021<br>'''Simplified Chinese:''' May 17, 2024}}
{{Setlist/header|title=Start Deck 100|symbol=yes|image=SetSymbolStart Deck 100.png}}
{{Setlist/entry|001/414|E|{{TCG ID|Start Deck 100|Caterpie|2}}|Grass||}}
{{Setlist/header|title=Start Deck 100 (Simplified Chinese)|symbol=no|image=}}
{{Setlist/entry|001/414|E|[[Venusaur V (Start Deck 100 1)|Venusaur]]{{TCGV}}|Grass||}}`, "Start Deck 100 (TCG)");
  assert.deepEqual(r.listas.map((s) => [s.setId, s.name, s.entries[0].name]), [["CS4DaC", "Start Deck 100", "Venusaur V"]]);
  assert.equal(r.release, "2024-05-17");
  assert.equal(r.logo, ""); // o logo da página (TCG) é o japonês
  const sem = parseSetPage(`{{setlist/header|title=Algum Deck|symbol=no}}
{{setlist/entry|001/010|H|{{TCG ID|Algum Deck|Pikachu|1}}|Lightning}}
{{setlist/header|title=Outro Deck|symbol=no}}
{{setlist/entry|001/010|H|{{TCG ID|Outro Deck|Eevee|1}}|Colorless}}`, "Decks Sem Símbolo (ATCG)");
  assert.deepEqual(sem.listas, []);
  assert.deepEqual(sem.semCodigo, ["Algum Deck", "Outro Deck"]);
});

test("juntarSets: promo espalhada em várias páginas vira um set, a oficial manda", () => {
  const vol = parseSetPage(`{{TCGPromoInfobox|date=March 20, 2026}}
{{Setlist/header|title=Vol. 1|image=SetSymbol SMPromo.png}}
{{Setlist/entry|001/30th-P|J|{{TCG ID|MEP Promo|Bulbasaur|37}}|Grass}}
{{Setlist/entry|021/30th-P|J|{{TCG ID|MEP Promo|Squirtle|40}}|Water}}`, "30th Celebration: First Partner Vol. 1 (ATCG)").listas;
  const oficial = parseSetPage(`{{TCGPromoInfobox|period=March 20, 2026 - Present}}
{{Setlist/header|title=30th-P Promotional cards|image=SetSymbol MPromo.png}}
{{Setlist/entry|001/30th-P|J|{{TCG ID|30th-P Promo|Bulbasaur|1}}|Grass}}
{{Setlist/entry|002/30th-P|J|{{TCG ID|30th-P Promo|Ivysaur|2}}|Grass}}`, "30th-P Promotional cards (SCTCG)").listas;
  const [s] = juntarSets([...vol, ...oficial]);
  assert.equal(s.setId, "30th-PC");
  assert.equal(s.name, "30th-P Promotional Cards");
  assert.equal(s.oficial, true);
  assert.deepEqual(s.entries.map((e) => [e.number, e.page]), [
    ["001", "Bulbasaur (30th-P Promo 1)"], ["002", "Ivysaur (30th-P Promo 2)"], ["021", "Squirtle (MEP Promo 40)"]
  ]);
});

test("completarDatas: set sem data herda a do anterior da mesma era", () => {
  const sets = completarDatas([
    { setId: "A", serieId: "SM", release: "2022-10-28" },
    { setId: "B", serieId: "SM", release: "" },
    { setId: "C", serieId: "S", release: "" },
    { setId: "D", serieId: "S", release: "2023-05-19" }
  ]);
  assert.deepEqual(sets.map((s) => [s.setId, s.release, !!s.releaseAprox]), [["A", "2022-10-28", false], ["B", "2022-10-28", true], ["C", "", false], ["D", "2023-05-19", false]]);
});

const MOLTRES = `{{PokémoncardInfobox
|cardname=Moltres
|image=MoltresLostThunder38.jpg
|caption=Illus. [[Misa Tsutsui]]
|species=Moltres
|evostage=Basic
|type=Fire
}}
{{PokémoncardInfobox/Expansion|type=Fire|expansion={{TCG|Lost Thunder}}|rarity={{rar|Rare}}|cardno=38/214|jpexpansion={{TCG|Thunderclap Spark}}|jprarity={{rar|U}}|jpcardno=010/060}}
{{PokémoncardInfobox/Expansion|type=Fire|jpdeck={{TCG|Flareon-GX Starter Set Fire}}|jpcardno=002/038}}
{{Carddex|ndex=146}}`;
const LEAFEON = `{{PokémoncardInfobox
|cardname=Leafeon
|caption=Regular print<br>Illus. [[5ban Graphics]]
|recaption1={{TCG|Special illustration rare}} print<br>Illus. [[Jiro Sasumo]]
|species=Leafeon
|evostage=Stage 1
}}
{{PokémoncardInfobox/Expansion|type=Grass|expansion={{TCG|Prismatic Evolutions}}|rarity={{rar|Double Rare}}|cardno=006/131|jpexpansion={{TCG|Terastal Fest ex}}|jprarity={{rar|RR}}|jpcardno=003/187}}
{{PokémoncardInfobox/Expansion|type=Grass|expansion={{TCG|Prismatic Evolutions}}|rarity={{rar|Special Illustration Rare}}|cardno=144/131|jpexpansion={{TCG|Terastal Fest ex}}|jprarity={{rar|SAR}}|jpcardno=200/187}}`;

test("parseCardPage: espécie, estágio, dex, ilustrador único e impressões (só as com set+número)", () => {
  const m = parseCardPage(MOLTRES);
  assert.deepEqual({ ...m, prints: m.prints.length }, { species: "Moltres", stage: "Basic", dexId: 146, artist: "Misa Tsutsui", prints: 1 });
  const l = parseCardPage(LEAFEON);
  assert.equal(l.artist, ""); // dois ilustradores na página: não se chuta
  assert.equal(l.prints.length, 2);
  const t = parseCardPage(`{{TCGTrainerCardInfobox|cardname=Brooklet Hill|caption=Illus. [[5ban Graphics]]}}
{{TCGTrainerCardInfobox/Expansion|class=Stadium|expansion={{TCG|Guardians Rising}}|rarity={{rar|Uncommon}}|cardno=120/145|jpexpansion={{TCG|Alolan Moonlight}}|jprarity={{rar|U}}|jpcardno=050/050}}`);
  assert.equal(t.prints.length, 1);
  assert.equal(t.species, "");
});

test("desambiguacao de promo aponta a cópia chinesa", () => {
  assert.equal(desambiguacao(`SV-P promotional card number 1 is assigned to different {{TCG|Pikachu}} cards in the following languages:
* For the Japanese or Traditional Chinese copy, see [[Pikachu (SVP Promo 27)]].
* For the Simplified Chinese copy, see [[Pikachu (SVP Promo 190)]].
{{tcgdisambig}}`), "Pikachu (SVP Promo 190)");
  assert.equal(desambiguacao(MOLTRES), "");
});

test("escolherImpressao: pela raridade japonesa; especial sem casar, nada", () => {
  const l = parseCardPage(LEAFEON).prints;
  assert.deepEqual(escolherImpressao(l, "RR"), { en: { set: "Prismatic Evolutions", number: "006" }, ja: { set: "Terastal Fest ex", number: "003" } });
  assert.deepEqual(escolherImpressao(l, "SAR"), { en: { set: "Prismatic Evolutions", number: "144" }, ja: { set: "Terastal Fest ex", number: "200" } });
  assert.equal(escolherImpressao(l, "UR"), null); // a SAR no lugar da UR seria arte errada
  assert.equal(escolherImpressao(l, "Gem RR"), null); // Gem Pack tem arte própria
  // Uma impressão só: a página é daquela carta.
  assert.deepEqual(escolherImpressao(parseCardPage(MOLTRES).prints, "C"), { en: { set: "Lost Thunder", number: "38" }, ja: { set: "Thunderclap Spark", number: "010" } });
  assert.equal(escolherImpressao([], "C"), null);
});

test("escolherImpressao: regular sem casar cai na primeira impressão regular", () => {
  const P = (expansion, rarity, cardno, jpexpansion, jprarity, jpcardno) => ({ expansion, rarity, cardno, jpexpansion, jprarity, jpcardno });
  // Japonês "high class" não imprime C/U: a linha regular vem sem jprarity.
  const budew = [P("Prismatic Evolutions", "Common", "004/131", "Terastal Fest ex", "", "001/187"),
    P("Ascended Heroes", "Illustration Rare", "221/217", "MEGA Dream ex", "AR", "196/193")];
  assert.equal(escolherImpressao(budew, "C").en.number, "004");
  // VMAX de linha: só a linha EN, sem raridade japonesa; a outra é shiny.
  const grimm = [P("Darkness Ablaze", "Rare VMAX", "115/189", "", "", "007/020"),
    P("Shining Fates", "Rare Shiny GX", "SV117/SV122", "Shiny Star V", "SSR", "322/190")];
  assert.deepEqual(escolherImpressao(grimm, "RRR").en, { set: "Darkness Ablaze", number: "115" });
  // Deck/caixa sem raridade na lista: a regular.
  const lapras = [P("Sword & Shield", "Rare", "048/202", "", "", "005/023"), P("SWSH Black Star Promos", "", "SWSH051", "", "", "")];
  assert.equal(escolherImpressao(lapras, "").en.set, "Sword & Shield");
  // Set de promo: a impressão promo vem antes.
  assert.equal(escolherImpressao(lapras, "", { promo: true }).en.set, "SWSH Black Star Promos");
  // Linha sem set+número não conta.
  assert.equal(escolherImpressao([P("", "", "", "VMAX Climax", "", "")], "C"), null);
});

test("impressões compactas ida e volta", () => {
  const ps = parseCardPage(LEAFEON).prints;
  assert.deepEqual(compactarImpressoes(ps)[0], ["Prismatic Evolutions", "Double Rare", "006/131", "Terastal Fest ex", "RR", "003/187"]);
  assert.deepEqual(expandirImpressoes(compactarImpressoes(ps)), ps);
  assert.equal(raridadeRegular(""), true);
  assert.equal(raridadeRegular("RRR"), true);
  assert.equal(raridadeRegular("SAR"), false);
  assert.equal(raridadeRegular("Gem C"), false);
});

test("categoriaDe e variantesDe", () => {
  assert.deepEqual(categoriaDe({ type: "Fire" }), { category: "Pokemon", types: "Fire" });
  assert.deepEqual(categoriaDe({ type: "Item", subtype: "Pokémon Tool" }), { category: "Trainer", trainerType: "Tool" });
  assert.deepEqual(categoriaDe({ type: "Supporter" }), { category: "Trainer", trainerType: "Supporter" });
  assert.deepEqual(categoriaDe({ type: "Energy", subtype: "Water", name: "Basic Water Energy" }), { category: "Energy", energyType: "Normal" });
  assert.deepEqual(categoriaDe({ type: "Energy", subtype: "Colorless", name: "Double Colorless Energy" }), { category: "Energy", energyType: "Special" });
  assert.deepEqual(variantesDe("C"), ["Normal"]);
  assert.deepEqual(variantesDe(""), ["Normal"]);
  assert.deepEqual(variantesDe("R"), ["Holo"]);
  assert.deepEqual(variantesDe("Gem C"), ["Holo"]);
});

test("dexDe: espécie da página, senão o nome sem mecânica e sem o que vem na frente", () => {
  const rev = { pikachu: 25, growlithe: 58, bellibolt: 939, moltres: 146 };
  assert.equal(dexDe({ species: "Moltres", name: "Moltres" }, rev), 146);
  assert.equal(dexDe({ name: "Captain Pikachu" }, rev), 25);
  assert.equal(dexDe({ name: "Hisuian Growlithe" }, rev), 58);
  assert.equal(dexDe({ name: "Iono's Bellibolt ex" }, rev), 939);
  assert.equal(dexDe({ name: "Pikachu", category: "Trainer" }, rev), 0);
  assert.equal(dexDe({ name: "Nada Aqui" }, rev), 0);
});

test("arteDe: EN primeiro, subset pelo prefixo, JA quando o EN não tem", () => {
  const idx = indiceArte({
    en: [
      { name: "Lost Thunder", cards: [{ number: "38", image: "https://assets.tcgdex.net/en/sm/sm8/38/high.png", artist: "Misa Tsutsui" }] },
      { name: "Hidden Fates", cards: [{ number: "1", image: "x" }] },
      { name: "Hidden Fates Shiny Vault", cards: [{ number: "SV88", image: "https://assets.tcgdex.net/en/sm/sma/SV88/high.png", artist: "5ban Graphics" }] },
      { name: "Prismatic Evolutions", cards: [{ number: "006", image: "" }] }
    ],
    ja: [{ name: "Terastal Fest ex", cards: [{ number: "003", image: "https://assets.tcgdex.net/ja/SV/SV8a/003/high.png", artist: "5ban Graphics" }] }]
  });
  assert.equal(normSet("Pokémon Card 151"), "pokemon card 151");
  assert.equal(numKey("006"), "6");
  assert.deepEqual(arteDe({ en: { set: "Lost Thunder", number: "38" } }, idx), { image: "https://assets.tcgdex.net/en/sm/sm8/38/high.png", artist: "Misa Tsutsui", de: "en" });
  assert.equal(arteDe({ en: { set: "Hidden Fates", number: "SV88" } }, idx).image, "https://assets.tcgdex.net/en/sm/sma/SV88/high.png");
  // A EN existe mas sem imagem: cai na JA.
  assert.equal(arteDe({ en: { set: "Prismatic Evolutions", number: "006" }, ja: { set: "Terastal Fest ex", number: "003" } }, idx).de, "ja");
  assert.equal(arteDe({ en: { set: "Set Que Não Existe", number: "1" } }, idx), null);
  assert.equal(arteDe({}, idx), null);
});

test("montarCarta: id com o código e o número impresso, campos do set e arte", () => {
  const set = { id: "CSM1aC", name: "Storming Emergence Radiant", total: 151, release: "2022-10-28", serieId: "SM", serieName: "太阳&月亮", logo: "data/set-logos/zh-cn/CSM1aC.webp" };
  const c = montarCarta({ number: "006", name: "Moltres", type: "Fire", rarity: "U", species: "Moltres", stage: "Basic", dexId: 146, artist: "Wiki" }, set,
    { arte: { image: "https://assets.tcgdex.net/en/sm/sm8/38/high.png", artist: "Misa Tsutsui" }, revNames: {} });
  assert.equal(c.id, "CSM1aC-006-zh-cn");
  assert.equal(c.language, "zh-cn");
  assert.equal(c.category, "Pokemon");
  assert.equal(c.types, "Fire");
  assert.equal(c.stage, "Basic");
  assert.equal(c.dexId, 146);
  assert.equal(c.generation, 1);
  assert.equal(c.artist, "Misa Tsutsui");
  assert.equal(c.image, "https://assets.tcgdex.net/en/sm/sm8/38/high.png");
  assert.equal(c.setLogo, "data/set-logos/zh-cn/CSM1aC.webp");
  assert.equal(c.setSerieName, "太阳&月亮");
  assert.deepEqual(c.variants, ["Normal"]);
  const gem = montarCarta({ number: "01-02", name: "Captain Pikachu", type: "Lightning", rarity: "Gem C" }, { id: "CBB5C", name: "Gem Pack Vol. 5" }, { revNames: { pikachu: 25 } });
  assert.equal(gem.id, "CBB5C-01-02-zh-cn");
  assert.equal(gem.dexId, 25);
  assert.equal(gem.image, "");
  assert.deepEqual(gem.variants, ["Holo"]);
  const dup = montarCarta({ number: "001", name: "X", type: "Grass" }, { id: "A" }, { sufixo: "2" });
  assert.equal(dup.id, "A-001-2-zh-cn");
});

test("templates acha o infobox mesmo com template dentro do valor", () => {
  const [t] = templates("{{TCGExpansionInfobox|setname=X<br><small>Y</small>|cards={{tt|627|211 in A}}|release=May 1, 2024}}", /^TCGExpansionInfobox$/);
  assert.equal(t.named.release, "May 1, 2024");
  assert.equal(plain(t.named.cards), "627");
});

test("tipoDoSet: deck, kit e caixa viram \"deck\"; expansão, subset, Gem Pack e promo não", () => {
  for (const p of ["Storming Emergence GX Starter Deck (ATCG)", "Battle Party Set (ATCG)", "Dragonite & Mewtwo & Camerupt & Sinistcha Happy Set (ATCG)",
    "Master Strategy Deck Building Sets (ATCG)", "Start Deck 100 (TCG)", "Eevee-GX Gift Box Sets (ATCG)", "Peripheral Collection Gift Box: Variety Treasure Box (ATCG)",
    "Battle Party: Shared Dream (ATCG)"]) assert.equal(tipoDoSet(p), "deck", p);
  for (const p of ["Storming Emergence (ATCG)", "Terastal Gathering (ATCG)", "Gem Pack Vol. 6 (ATCG)", "Collection 151 (ATCG)", "Golden Energy (ATCG)",
    "Journey Theme Pack (ATCG)", "SV-P Promotional cards (SCTCG)", "30th Celebration (TCG)", "Dragon Resurgence (ATCG)"]) assert.equal(tipoDoSet(p), "", p);
  const c = montarCarta({ number: "001", name: "Rowlet", type: "Grass" }, { id: "CSVH4C", kind: "deck" });
  assert.equal(c.setKind, "deck");
  assert.equal(montarCarta({ number: "001", name: "Rowlet", type: "Grass" }, { id: "CSV7C" }).setKind, undefined);
});
