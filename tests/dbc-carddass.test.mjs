// Testes do sync do Dragon Ball Carddass (scripts/sync-dbc-carddass.mjs): o
// parser da tabela do 80storage, a regra de id estável e a tradução dos nomes.
// A numeração do Carddass tem pegadinhas de propósito (dois No.215 no 第6弾,
// No.216 escondido no 第7弾, E-1..9 no 第16弾) — é isso que fica travado aqui.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parse80storage, assignIds, nameEn, SETS, SERIES, setName, setNameEn,
  parseDbzCollection, assignIdsDz, raridadeDbc, scanDe, IMG, cartasDoJogo, FACE_DE, JOGO_DA_SERIE, jogoDaCarta
} from "../scripts/sync-dbc-carddass.mjs";
import { chaveBase } from "../scripts/lib/img-mirror.mjs";
import { jogoNovoDoSet, jogoDaUrl } from "../functions/_lib/jogos.js";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNAP80 = JSON.parse(ler("data/vintage/dbc-carddass.json"));
const SNAPDZ = JSON.parse(ler("data/vintage/dbc-dbzcollection.json"));
const LIDOS = JSON.parse(ler("scripts/data/dbc-nomes-lidos.json"));

const TABELA = `<figure><table><thead>
<tr><th>カードNo</th><th>名前</th><th>BP</th><th>スカウター</th><th>箔</th></tr></thead><tbody>
<tr><td>No.214</td><td>孫悟空</td><td>24000</td><td>ヒキワケ</td><td>悟</td></tr>
<tr><td>No.215</td><td>孫悟空</td><td>24000</td><td>ニセモノ</td><td>惑</td></tr>
<tr><td>No.215</td><td>孫悟空</td><td>80000</td><td>ホンモノ</td><td>悟</td></tr>
<tr><td>No.235</td><td>ギニュー</td><td>45000</td><td>SDB×7</td><td><img src="x.webp" alt="ギニュー特戦隊"></td></tr>
<tr><td>E-9</td><td>ビーデル</td><td>&#8211;</td><td>ー</td><td>武</td></tr>
</tbody></table></figure>`;

test("parser: número sem o 'No.', stats crus e ícone do 箔 pelo alt", () => {
  const cards = parse80storage(TABELA);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((c) => c.num), ["214", "215", "215", "235", "E-9"]);
  assert.equal(cards[3].stats["箔"], "[ギニュー特戦隊]");
  assert.equal(cards[4].stats.BP, "-");
  assert.equal(parse80storage("<p>sem tabela</p>").length, 0);
});

test("parser: 'Total No.' do 第17弾 em diante vira `total`, fora dos stats", () => {
  const [c] = parse80storage(`<table><tr><th>カードNo</th><th>Total No.</th><th>名前</th><th>DP</th></tr>
    <tr><td>No.1</td><td>No.647</td><td>新三大超サイヤ人</td><td>2000</td></tr></table>`);
  assert.deepEqual(c, { num: "1", total: "647", name: "新三大超サイヤ人", stats: { DP: "2000" } });
});

test("id: número repetido na parte ganha sufixo pela ordem da fonte", () => {
  const ids = assignIds("h06", parse80storage(TABELA)).map((c) => c.id);
  assert.deepEqual(ids, ["dbc-h06-214", "dbc-h06-215", "dbc-h06-215b", "dbc-h06-235", "dbc-h06-e-9"]);
});

test("id: refresh reaproveita o id conhecido e nunca derruba carta que sumiu", () => {
  const primeira = assignIds("h06", parse80storage(TABELA));
  // Fonte corrigiu um BP, reordenou e deixou de listar a E-9.
  const nova = parse80storage(TABELA).filter((c) => c.num !== "E-9").reverse();
  nova[0].stats.BP = "46000";
  const segunda = assignIds("h06", nova, primeira);
  const porId = new Map(segunda.map((c) => [c.id, c]));
  assert.equal(segunda.length, 5);                          // a E-9 continua
  assert.equal(porId.get("dbc-h06-235").stats.BP, "46000"); // correção entra no mesmo id
  assert.ok(porId.has("dbc-h06-e-9"));
  assert.deepEqual(new Set(segunda.map((c) => c.id)), new Set(primeira.map((c) => c.id)));
});

test("nome EN: personagem, composição por separador e fallback pro japonês", () => {
  assert.equal(nameEn("孫悟空"), "Goku");
  assert.equal(nameEn("悟空＆ベジータ"), "Goku & Vegeta");
  assert.equal(nameEn("天津飯・餃子・ヤムチャ"), "Tien & Chiaotzu & Yamcha");
  assert.equal(nameEn("孫悟飯VSセルJr."), "Gohan vs. Cell Jr.");
  assert.equal(nameEn("孫悟空対ピッコロ（マジュニア）"), "Goku vs. Piccolo (Jr.)");
  assert.equal(nameEn("チチ＆父"), "Chi-Chi & Ox-King");            // frase inteira ganha da composição
  assert.equal(nameEn("ライチとザークロ"), "");                       // meia tradução não: fica o japonês
});

test("SETS: códigos únicos, Hondan h01–h31 (30 partes + 特別弾) e o 第1弾 em nov/1988", () => {
  const codes = SETS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(SETS.filter((s) => s.series === "h").length, 31);
  assert.equal(SETS[0].code, "h01");
  assert.equal(SETS[0].date, "1988-11");
});

test("SETS: o h31 é o 特別弾 de set/1997, não um 第31弾", () => {
  // A Bandai conta 30 partes; o 第31弾 oficial é uma caixa de 2015/16. O
  // código h31 é o setId gravado e não muda.
  const h31 = SETS.find((s) => s.code === "h31");
  assert.equal(setName(h31), "本弾 特別弾");
  assert.equal(setNameEn(h31), "Hondan Special Part");
  assert.equal(h31.date, "1997-09");
  assert.equal(h31.total, 83);
  assert.ok(!SETS.some((s) => /第31弾|Part 31/.test(`${s.ja} ${s.en}`)));
});

test("snapshot versionado: ids únicos, no formato e só de sets conhecidos", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/dbc-carddass.json", import.meta.url), "utf8"));
  const conhecidos = new Set(SETS.map((s) => s.code));
  const ids = [];
  for (const s of snap.sets) {
    assert.ok(conhecidos.has(s.code), s.code);
    for (const c of s.cards) {
      assert.match(c.id, new RegExp(`^dbc-${s.code}-[a-z0-9-]+$`));
      ids.push(c.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 758);
});

// ---- dbzcollection.fr (2026-11-12) -----------------------------------------

// Recorte fiel da página de uma parte: o bloco da EMBALAGEM (abre com
// afficher_detail_pack), a folha de checklist sem número e cartas com os
// números que a fonte escreve ("n°", "646=0", "BH-1").
const carta = (raridade, numero, id, dir) => `
<td class="bloc_carte"><a name="c${id}"></a>
<div class="bc_cadre" style="padding-bottom:1px;">
	<div class="bc_cadre_numero" title="${raridade}" style="background:transparent url(images/titres_cartes/rouge.jpg) repeat-x;"><div class="bc_texte_numero">${numero}</div></div>
	<div class="bc_cadre_carte"><table><tr><td class="bc_zone_carte">
		<table class="table_carte"><tr><td class="cadre_carte1"><img id="img_${id}" onclick="afficher_detail('${id}','${dir}/h400_${id}');" src="cartes/${dir}/h100_${id}_carte.jpg" border="0" class="cadre_carte" /></td></tr></table>
	</td></tr></table></div>
</div>
</td>`;
const PAGINA = `
<div class="bc_cadre"><div class="bc_cadre_numero" title="" style=""><div class="bc_texte_numero">Display</div></div>
<img id="img_pack_55" onclick="afficher_detail_pack('55','18/99/h400_55');" src="packagings/18/99/h100_55_packaging.jpg" /></div>
<table><tr>${carta("Regular", "Extrait Book", 7000, "34/146")}${carta("Prism", "n°1", 7557, "34/146")}${carta("dedoublable", "n°6", 7562, "34/146")}${carta("dedoublable", "n°6", 7563, "34/146")}${carta("dedoublable", "646=0", 7794, "18/89")}${carta("Regular", "BH-1", 4300, "18/88")}${carta("Regular", "n° 41", 7600, "34/146")}</tr></table>`;

test("dbzcollection: número, raridade, id na fonte e pasta do scan; embalagem e folha sem número ficam de fora", () => {
  assert.deepEqual(parseDbzCollection(PAGINA), [
    { src: 7557, num: "1", rar: "Prism", dir: "34/146" },
    { src: 7562, num: "6", rar: "dedoublable", dir: "34/146" },
    { src: 7563, num: "6", rar: "dedoublable", dir: "34/146" },
    { src: 7794, num: "646=0", rar: "dedoublable", dir: "18/89" },
    { src: 4300, num: "BH-1", rar: "Regular", dir: "18/88" },
    { src: 7600, num: "41", rar: "Regular", dir: "34/146" }
  ]);
  assert.deepEqual(parseDbzCollection("<html>fora do ar</html>"), []);
});

test("carta de duas camadas: as duas faces viram UMA carta, menos onde o 80storage lista as duas", () => {
  const sb = [{ src: 1, num: "5", rar: "Regular", dir: "x" }, { src: 2, num: "6", rar: "dedoublable", dir: "x" }, { src: 3, num: "6", rar: "dedoublable", dir: "x" }];
  const ids = assignIdsDz("sb01", sb);
  assert.deepEqual(ids.map((c) => [c.src, c.id, c.face || 1]), [[1, "dbc-sb01-5", 1], [2, "dbc-sb01-6", 1], [3, "dbc-sb01-6", 2]]);
  // No.500 do 第12弾: o 80storage tem as duas faces como cartas, e a ordem da
  // fonte é a inversa (FACE_DE manda).
  const c80 = [{ id: "dbc-h12-500", num: "500" }, { id: "dbc-h12-500b", num: "500" }];
  const h12 = assignIdsDz("h12", [{ src: 4155, num: "500", rar: "dedoublable", dir: "18/84" }, { src: 7798, num: "500", rar: "dedoublable", dir: "18/84" }], [], c80);
  assert.deepEqual(h12.map((c) => [c.src, c.id, c.face || 1]), [[4155, "dbc-h12-500b", 1], [7798, "dbc-h12-500", 1]]);
  assert.equal(FACE_DE[7794], "dbc-h16-0");
  // A reversa do 第20弾: o 80storage tem uma carta, a fonte as duas faces.
  const h20 = assignIdsDz("h20", [{ src: 4535, num: "154", rar: "dedoublable", dir: "18/93" }, { src: 7795, num: "154", rar: "dedoublable", dir: "18/93" }], [], [{ id: "dbc-h20-154", num: "154" }]);
  assert.deepEqual(h20.map((c) => [c.id, c.face || 1]), [["dbc-h20-154", 1], ["dbc-h20-154", 2]]);
});

test("id do dbzcollection GRUDA no src: reordenar a página não troca id, e carta que some fica", () => {
  const pagina = [{ src: 10, num: "37", rar: "Prism", dir: "56/254" }, { src: 11, num: "37", rar: "Laser", dir: "56/254" }, { src: 12, num: "38", rar: "Regular", dir: "56/254" }];
  const primeira = assignIdsDz("va06", pagina);
  assert.deepEqual(primeira.map((c) => c.id), ["dbc-va06-37", "dbc-va06-37b", "dbc-va06-38"]); // prisma e laser: duas cartas
  const depois = assignIdsDz("va06", [pagina[2], pagina[1]], primeira);
  assert.deepEqual(depois.map((c) => [c.src, c.id]), [[12, "dbc-va06-38"], [11, "dbc-va06-37b"], [10, "dbc-va06-37"]]);
});

test("parte nova do 80storage herda o id que o dbzcollection já deu (pelo número), sem duplicar", () => {
  const dz = [{ id: "dbc-h21-169", num: "169", name: "孫悟空" }, { id: "dbc-h21-170", num: "170", name: "ベジータ" }];
  const fresh = [{ num: "169", name: "孫悟空（超サイヤ人）" }, { num: "170", name: "ベジータ" }, { num: "171", name: "トランクス" }];
  assert.deepEqual(assignIds("h21", fresh, [], dz).map((c) => c.id), ["dbc-h21-169", "dbc-h21-170", "dbc-h21-171"]);
});

test("raridade: a do dbzcollection, com a de duas camadas pela composição da Bandai", () => {
  const f = (rar) => ({ rar });
  assert.equal(raridadeDbc("h01", f("Regular")), "Normal");
  assert.equal(raridadeDbc("h07", f("Holo")), "Prism");                 // uma das 6 prismas do 第7弾
  assert.equal(raridadeDbc("h12", f("dedoublable")), "Double Prism");   // Wプリズム
  assert.equal(raridadeDbc("h13", f("dedoublable")), "Normal");         // No.542/543: comuns
  assert.equal(raridadeDbc("h20", f("dedoublable")), "Reverse Prism");  // リバースプリズム
  assert.equal(raridadeDbc("sb05", f("dedoublable"), "Hidden Prism"), "Hidden Prism"); // a leitura do scan manda
  assert.equal(raridadeDbc("h28", f("Gold")), "Gold");
  assert.equal(raridadeDbc("h01", undefined), "");
});

test("imagem: o scan h3000 pelo wsrv, e o espelho do R2 guarda pela URL de origem", () => {
  const c = { src: 7557, dir: "34/146" };
  assert.equal(scanDe(c), "www.dbzcollection.fr/2v2/cartes/34/146/h3000_7557_carte.jpg");
  assert.equal(IMG(scanDe(c)), "https://wsrv.nl/?url=www.dbzcollection.fr%2F2v2%2Fcartes%2F34%2F146%2Fh3000_7557_carte.jpg&w=440&output=webp");
  assert.equal(chaveBase(IMG(scanDe(c))), "wsrv.nl/www.dbzcollection.fr/2v2/cartes/34/146/h3000_7557_carte.jpg");
});

test("SETS: toda parte tem página no dbzcollection e mês de lançamento", () => {
  for (const s of SETS) {
    assert.match(s.dz || "", /^\d+\/\d+$/, s.code);
    assert.match(s.date, /^\d{4}-\d{2}$/, s.code);
  }
  assert.equal(new Set(SETS.map((s) => s.dz)).size, SETS.length);
  // subtítulos do 26–30 (display da Bandai) e o 第11弾 de maio
  assert.equal(setName(SETS.find((s) => s.code === "h29")), "本弾 第29弾「超サイヤ人4発動！！」");
  assert.equal(SETS.find((s) => s.code === "h11").date, "1992-05");
  assert.equal(setName(SETS.find((s) => s.code === "va06")), "スペシャル");
});

test("snapshot do dbzcollection: ids no formato, de sets conhecidos, e cada parte com o total da Bandai", () => {
  const conhecidos = new Map(SETS.map((s) => [s.code, s]));
  const ids = new Set();
  for (const s of SNAPDZ.sets) {
    const def = conhecidos.get(s.code);
    assert.ok(def, s.code);
    const cartas = new Set();
    for (const c of s.cards) {
      assert.match(c.id, new RegExp(`^dbc-${s.code}-[a-z0-9-]+$`));
      if (c.face !== 2) { assert.ok(!cartas.has(c.id), `${c.id} repetido`); cartas.add(c.id); }
      else assert.ok(cartas.has(c.id), `${c.id}: 2ª face sem a 1ª`);
      assert.ok(!ids.has(c.src), `src ${c.src} em duas partes`);
      ids.add(c.src);
    }
    // a carta de duas camadas é uma; o 80storage contou as duas faces no 12 e
    // no 16; a Especial da VA tem as 6 prismas também em laser; e os 83 do
    // 特別弾 incluem as 2 cartas da campanha, que não saíram na máquina
    const esperado = { h12: 43, h16: 43, va06: 48, h31: 81 }[s.code] || def.total;
    assert.equal(cartas.size, esperado, s.code);
  }
  assert.equal(SNAPDZ.sets.length, SETS.length);
});

test("as 842 cartas do 80storage casam com uma carta do dbzcollection (raridade e imagem)", () => {
  const dz = new Set(SNAPDZ.sets.flatMap((s) => s.cards.map((c) => c.id)));
  const sem = SNAP80.sets.flatMap((s) => s.cards.map((c) => c.id)).filter((id) => !dz.has(id));
  assert.deepEqual(sem, []);
});

test("nomes lidos: toda carta que o 80storage não tem ganhou nome, e todo nome é de uma carta só do dbzcollection", () => {
  const de80 = new Set(SNAP80.sets.flatMap((s) => s.cards.map((c) => c.id)));
  const soDz = new Set(SNAPDZ.sets.flatMap((s) => s.cards.filter((c) => c.face !== 2 && !de80.has(c.id)).map((c) => c.id)));
  // Só as 12 prismas/laser da VA Especial, arte nova sem título impresso, ficam sem nome.
  const semNome = [...soDz].filter((id) => !LIDOS.nomes[id]);
  assert.deepEqual(semNome, LIDOS.sem_nome, `${semNome.length} carta(s) sem nome lido`);
  assert.ok(LIDOS.sem_nome.length <= 12 && LIDOS.sem_nome.every((id) => /^dbc-va06-(3[7-9]|4[0-2])b?$/.test(id)));
  const orfaos = Object.keys(LIDOS.nomes).filter((id) => !soDz.has(id));
  assert.deepEqual(orfaos, [], "nome de carta que não está no snapshot (ou que o 80storage já nomeia)");
  for (const [id, nome] of Object.entries(LIDOS.nomes)) {
    assert.equal(nome, nome.trim(), id);
    assert.ok(!/[|]/.test(nome), `${id}: "${nome}" ficou com marca de transcrição`);
  }
  // VA Especial: sem título na frente, leva o da carta do 第1–5集 com a mesma arte
  for (const [id, orig] of Object.entries(LIDOS.arte_de || {})) {
    assert.match(id, /^dbc-va06-/);
    assert.match(orig, /^dbc-va0[1-5]-/);
    assert.equal(LIDOS.nomes[id], LIDOS.nomes[orig], id);
  }
  const rotulos = new Set(["Hidden Prism", "Double Prism", "Metal Hidden Prism"]);
  for (const [id, r] of Object.entries(LIDOS.raridade)) {
    assert.ok(rotulos.has(r), `${id}: raridade "${r}"`);
    assert.ok(soDz.has(id), `${id}: raridade lida de carta que não está no snapshot`);
  }
});

test("cartas: as 80storage mantêm o nome dele; as outras levam o lido; ninguém fica sem imagem", () => {
  const cartas = cartasDoJogo(SNAP80, SNAPDZ);
  const porId = new Map(cartas.map((c) => [c.id, c]));
  assert.equal(porId.size, cartas.length);
  assert.equal(porId.get("dbc-h12-500b").nameJp, "三大超サイヤ人");
  assert.equal(porId.get("dbc-h12-500b").rarity, "Double Prism");
  assert.equal(porId.get("dbc-h20-154").rarity, "Reverse Prism");
  assert.equal(porId.get("dbc-sb01-1").setId, "dbc-sb01");
  assert.equal(porId.get("dbc-sb01-1").vintageLine, "sb");
  assert.deepEqual(cartas.filter((c) => !c.image).map((c) => c.id), []);
  assert.deepEqual(cartas.filter((c) => /^No\. /.test(c.name)).map((c) => c.id), LIDOS.sem_nome);
});

test("nome em inglês dos sets (src/nomes-sets.js) é o setNameEn do sync, e o agrupador tira o prefixo da série", () => {
  const fonte = ler("src/nomes-sets.js");
  const noArquivo = Object.fromEntries([...fonte.matchAll(/^\s*"(dbc-[a-z0-9]+)": ("(?:[^"\\]|\\.)*"),?$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
  const esperado = Object.fromEntries(SETS.map((s) => [`dbc-${s.code}`, setNameEn(s)]));
  assert.deepEqual(noArquivo, esperado);
  const app = ler("src/app.js");
  assert.ok(app.includes(`"${SERIES.h.en} "`), `groupDbcSets sem o prefixo "${SERIES.h.en} "`);
});

// ---- Um jogo por série (2026-11-13) ----------------------------------------

test("cada série é um jogo: o dbc fica com o Hondan e o 特別弾, e as outras três vão pra dbsb, dbva e dbbw", () => {
  assert.deepEqual(JOGO_DA_SERIE, { h: "dbc", sb: "dbsb", va: "dbva", bw: "dbbw" });
  assert.equal(jogoDaCarta({ setId: "dbc-h31" }), "dbc");
  assert.equal(jogoDaCarta({ setId: "dbc-sb19" }), "dbsb");
  assert.equal(jogoDaCarta({ setId: "dbc-va06" }), "dbva");
  assert.equal(jogoDaCarta({ setId: "dbc-bw04" }), "dbbw");
  // O nome do set não repete o jogo (contrato 7); o do dbc segue com o 本弾.
  assert.equal(setName(SETS.find((s) => s.code === "sb01")), "第1弾");
  assert.equal(setNameEn(SETS.find((s) => s.code === "bw04")), "Part 4");
  assert.equal(setName(SETS.find((s) => s.code === "h01")), "本弾 第1弾「格闘技大決戦」");
});

test("os quatro catálogos versionados: cada carta no jogo da série dela, e nenhuma em dois", () => {
  const ids = new Map();
  for (const jogo of Object.values(JOGO_DA_SERIE)) {
    const texto = ler(`data/${jogo}/cards.js`);
    const cartas = JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1));
    assert.ok(cartas.length > 100, `${jogo}: ${cartas.length} cartas`);
    for (const c of cartas) {
      assert.equal(jogoDaCarta(c), jogo, `${c.id} no catálogo do ${jogo}`);
      assert.ok(!ids.has(c.id), `${c.id} em ${ids.get(c.id)} e em ${jogo}`);
      ids.set(c.id, jogo);
      // Só o dbc tem logo; os três novos mostram o nome no cartão do set.
      assert.equal(Boolean(c.setLogo), jogo === "dbc", `${c.id}: setLogo`);
    }
  }
  assert.equal(ids.size, 2737);
});

test("endereço de set publicado no dbc (12/11) leva pro jogo novo, com o mesmo slug; os do Hondan ficam", () => {
  // Os slugs que estavam no ar no mapa do dbc (data/game-pages, 2026-11-13).
  const casos = { "dbc-sb10-10": "dragon-ball-super-battle", "dbc-sb01-1-en": "dragon-ball-super-battle",
    "dbc-va06": "dragon-ball-visual-adventure", "dbc-va07-95": "dragon-ball-visual-adventure", "95ex": "dragon-ball-visual-adventure",
    "dbc-bw04-4": "dragon-ball-super-barcode-wars" };
  for (const [slug, url] of Object.entries(casos)) {
    assert.equal(jogoNovoDoSet("dragon-ball-carddass", slug), url, slug);
    assert.ok(jogoDaUrl(url), `${url} fora do registro`);
  }
  for (const slug of ["dbc-h01-1", "12-3", "16-z", "dbc-h31", "30-db"]) assert.equal(jogoNovoDoSet("dragon-ball-carddass", slug), null, slug);
  assert.equal(jogoNovoDoSet("gundam-carddass", "dbc-sb01-1"), null);
});
