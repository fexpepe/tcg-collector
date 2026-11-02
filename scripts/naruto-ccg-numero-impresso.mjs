// Naruto CCG americano: o NÚMERO IMPRESSO e o scan do N-CCG-DB de cada carta
// do narutocards.ca (2026-11-02).
//
// O narutocards (fonte do sync-naruto-ccg.mjs) não usa o número impresso nas
// missões do Broken Promises (set 16) e em tudo do Will of Fire (17) em
// diante, nos Tournament Packs e nas tins: lá ele renumerou em sequência, sem
// pular as faixas dos Tournament Packs e dando número novo às reimpressões. O
// que ele chama de N-880 tem "883" impresso; M-585 tem "620"; J-1000 tem
// "1023"; a tin 2 "N-1850" é a PR-063. Eram ~1.800 cartas com o número errado
// na tela. E o scan dele (214×300) é REPETIDO entre cartas de mesmo nome no
// set: os três "Naruto Uzumaki" do Will of Fire mostram a arte da reimpressão
// N-187, e o Neji Rare do Fangs of the Snake mostra o Neji Common.
//
// O id NÃO muda: nrt-ccg-<código do narutocards> já está em coleções
// (docs/CATALOGO.md §1). Este script grava o de-para "código do narutocards →
// número impresso + scan do N-CCG-DB" em
// data/vintage/naruto-ccg-numero-impresso.json, e o sync troca só o `number` e
// a imagem. O de-para é EXPLÍCITO de propósito: casar pelo número no sync
// faria a carta impressa N-880 (Yamato, do TP1) roubar o id da carta que o
// narutocards chama de N-880 (Neji, impressa 883).
//
// Fonte do número: o N-CCG-DB (o mesmo commit do naruto-ccg-complemento.mjs),
// que tem o código impresso e scans 750×1050. Duas correções no código dele:
//   - o sufixo A/B que ele usa pra separar reimpressões (N-019B, J-696A,
//     N-1272B) NÃO está impresso: a carta diz "019 TP1", "696", "1272 S23";
//   - "NUS-006B", "JUS-065", "PRUS-010B" viram N-US006, J-US065, PR-US010,
//     a grafia do catálogo (e do verso da carta: "US006 TP1").
//
// COMO CASA, por set e por tipo de carta (N, J, M, C, PR):
//   0. FIXO: os casos que nenhum nome resolve, cada um conferido por imagem
//      (tins, grafias diferentes entre as fontes, os números trocados);
//   1. nos sets em que o narutocards usa o número impresso (1–16 e promos):
//      código igual com nome parecido;
//   2. nome que aparece UMA vez no set, nas duas fontes, casa direto (âncora);
//   3. nome repetido casa pelo DESLOCAMENTO da numeração das âncoras vizinhas:
//      o narutocards renumera em bloco (no Fangs of the Snake, todo número
//      dele é o impresso − 3), então dos três "Sasuke Uchiha" do Path of Pain
//      fica com o N-1005 o que está no bloco das Super Rare (que o narutocards
//      pôs no começo do set) e com o N-963 o que está entre os de −4.
// O que sobra fica sem par e o sync usa o que o narutocards tem.
//
// Conferência de 2026-11-02 (fora do repo, Python + PIL, nas 4.235 cartas):
// cada scan do narutocards comparado com todos do mesmo set e tipo no N-CCG-DB
// (arte em cinza 24×30, cosseno). Onde o scan dele é único no set, a imagem
// casou com o mesmo par deste script em todas; onde ele repete o scan, a
// imagem caiu em carta de mesmo nome. E o canto com o número impresso foi
// lido à mão no scan do N-CCG-DB numa amostra de cada set (o do narutocards
// também dá pra ler ampliado: o "N-099" dele no Quest for Power diz "244").
//
// Roda à mão (padrão dos snapshots manuais); o sync só lê o resultado.
//   node scripts/naruto-ccg-numero-impresso.mjs            # baixa o N-CCG-DB (cache) e grava
//   node scripts/naruto-ccg-numero-impresso.mjs --sem-rede # só com o cache
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FAN_SHA, FAN_IMG, baixaFan, codigoCanonico, semelhanca } from "./naruto-ccg-complemento.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/naruto-ccg.json", ROOT);
const OUT = new URL("data/vintage/naruto-ccg-numero-impresso.json", ROOT);

// Chave do SETS do sync → set do N-CCG-DB. As tins não existem lá como set:
// as cartas delas estão no "Promo Cards" (reimpressões com o número original
// e as PR-0xx). O Shinobi's Dream (s29) fica fora do catálogo.
export const FAN_SET = {
  s01: "01 Path to Hokage", s02: "02 Coils of the Snake", s03: "03 Curse of the Sand",
  s04: "04 Revenge and Rebirth", s05: "05 Dream Legacy", s06: "06 Eternal Rivalry",
  s07: "07 Quest for Power", s08: "08 Battle of Destiny", s09: "09 The Chosen",
  s10: "10 Lineage of Legends", s11: "11 Approaching Wind", s12: "12 A New Chronicle",
  s13: "13 Fateful Reunion", s14: "14 Emerging Alliance", s15: "15 Foretold Prophecy",
  s16: "16 Broken Promise", s17: "17 Will of Fire", s18: "18 Fangs of the Snake",
  s19: "19 Path of Pain", s20: "20 Tales of the Gallant Sage", s21: "21 Shattered Truth",
  s22: "22 Weapons of War", s23: "23 Invasion", s24: "24 Sage's Legacy",
  s25: "25 Kage Summit", s26: "26 Avenger's Wrath", s27: "Set 27 Hero's Ascension",
  s28: "28 Ultimate Ninja Storm 3",
  tp1: "17.5 Tournament Pack 1", tp2: "19.5 Tournament Pack 2", tp3: "21.5 Tournament Pack 3", tp4: "23.5 Tournament Pack 4",
  tin1: "Promo Cards", tin2: "Promo Cards", tin3: "Promo Cards", tin4: "Promo Cards", promo: "Promo Cards"
};

// Sets em que o código do narutocards É o impresso (passo 1). No 16 só as
// missões estão erradas, e elas não passam no "nome parecido" do código igual
// (o M-585 dele é o "Reconnoitering Party"; o M-585 impresso, o "Succeeded
// Will of Fire").
const CODIGO_IMPRESSO = /^(s(0\d|1[0-6])|promo)$/;

// FIXO: código do narutocards → scan do N-CCG-DB (o caminho identifica a carta;
// o código lá se repete: há duas "N-480 Deidara" no Promo Cards). Tudo
// conferido por imagem em 2026-11-02.
export const FIXO = {
  // Número trocado com o da vizinha no narutocards (o scan dele mostra "274" e
  // "525"). A carta verdadeira do número dele (M-275 "Riot in High-Security
  // Facility", J-526 "Thunder Funeral: Feast of Lightning") falta no catálogo.
  s09: { "M-275": "set_9_the_chosen/m274.webp" },
  s14: {
    "J-526": "set_14_emerging_alliance/j525.webp",
    // Grafias diferentes entre as fontes, mesma carta (imagem ≥ 0,99).
    "M-477": "set_14_emerging_alliance/m477.webp", // Super Bushy - Brow × Super Bushy Eyebrows
    "N-621": "set_14_emerging_alliance/n621.webp" // "…, Zaku Abumi & Kin Tsuchi" × "…, Zaku & Kin Tsuchi"
  },
  s02: { "M-079": "set_2_coils_of_the_snake/m079.webp" }, // The Fastest Finisher × The Fastest Ones
  s04: {
    "M-133": "set_4_revenge_and_rebirth/m133.webp", // Secret Byway × Secret Path
    "M-146": "set_4_revenge_and_rebirth/m146.webp" // The Official Exam Begins! × The Final Competition Begins
  },
  s06: { "N-US013": "set_6_eternal_rivalry/nus013e.webp" }, // Ino Nakayama × Ino Yamanaka
  s07: { "J-217": "set_7_quest_for_power/j217.webp" }, // String Manipulation Jutsu × String Control Jutsu
  s23: { "N-1203": "set_23_invasion/n1272.webp" }, // o N-CCG-DB tem duas Shiho 1272 (variante)
  s25: {
    "J-899": "set_25_kage_summit/j922.webp", // Wood Style: Four Pillar Prison × … House Jutsu
    "J-916": "set_25_kage_summit/j939.webp", // Hiramekarei Unleash × Twin Sword Hiramekarei
    "J-920": "set_25_kage_summit/j943.webp" // Secret Red Move × Secret Red Technique
  },
  tp1: { "J-1038": "set_175_tournament_pack_1/j704e.webp" }, // Medical Jutsu: Reanimation × Reanimation Ninjutsu
  tp2: { "J-1048": "set_195_tournament_pack_2/j704e.webp" },
  // A Sakura promo do TP4 é a PR-US010 (o narutocards dá o scan da N-1355).
  tp4: { "N-1830": "set_235_tournament_pack_4/prus010be.webp" },
  // Tins: reimpressões com o número original (a carta diz "N-086", "145") e
  // as PR-0xx. A da tin 2 tem fundo diferente da original, e o scan do
  // narutocards é o da original.
  tin1: {
    "N-1831": "promos/n145.webp", "N-1832": "promos/n370.webp", "N-1833": "promos/n372.webp",
    "N-1834": "promos/n453.webp", "N-1835": "promos/n461e.webp", "N-1836": "promos/n473.webp",
    "N-1837": "promos/n480.webp", "N-1838": "promos/n495.webp", "N-1839": "promos/nus020.webp",
    "N-1840": "promos/nus040.webp"
  },
  tin2: {
    "N-1841": "promos/n086ae.webp", "N-1842": "promos/n146.webp", "N-1843": "promos/n168.webp",
    "N-1844": "promos/n224.webp", "N-1845": "promos/n311.webp", "N-1846": "promos/n324.webp",
    "N-1847": "promos/n531a.webp", "N-1848": "promos/n567a.webp", "N-1849": "promos/nus005e.webp",
    "N-1850": "promos/pr063.webp", "N-1851": "promos/pr064e.webp", "N-1852": "promos/pr065.webp"
  },
  tin3: {
    "N-1853": "promos/pr069.webp", "N-1854": "promos/pr070e.webp", "N-1855": "promos/pr071.webp",
    "N-1856": "promos/pr072e.webp", "N-1857": "promos/pr073.webp", "N-1858": "promos/pr074.webp"
  },
  tin4: {
    "M-992": "promos/pr080.webp", "M-993": "promos/pr081.webp", "M-994": "promos/pr082.webp",
    "N-1859": "promos/pr077.webp", "N-1860": "promos/pr078.webp", "N-1861": "promos/pr079e.webp"
  },
  // O Promo Cards tem duas PR-018 (a outra é a reimpressão "a").
  promo: { "PR-018": "promos/pr018.webp" }
};

// Scan do N-CCG-DB que é de OUTRA carta: o par vale (código e nome batem), mas
// a imagem fica a do narutocards. O j470 de lá é o "Body Manipulation".
export const SCAN_ERRADO = { s13: ["J-470"] };

// Carta que o narutocards põe no SET errado: vai pro set certo com o MESMO id
// (decisão de 2026-11-02, na conversa da PR). O N-099 Raido Namiashi dele está
// no Quest for Power com o scan do N-244 (o Raido de lá, que já existe); o
// N-099 impresso é do Curse of the Sand, carta de Starter Deck (ponto vermelho
// no scan; "ST" no ccgtrader). Sai daqui como { set, raridade, img } no de-para,
// e o sync tira a carta de um set e põe no outro.
export const MUDA_DE_SET = {
  s07: { "N-099": { set: "s03", raridade: "Starter Deck", img: "set_3_curse_of_the_sand/n099.webp" } }
};

// Código do N-CCG-DB → número impresso, na grafia do catálogo.
export function numeroImpresso(code) {
  return String(code || "").toUpperCase().trim()
    .replace(/^([A-Z]+)US-(\d+)/, "$1-US$2") // NUS-006B → N-US006B
    .replace(/(\d)[AB]$/, "$1"); // sufixo de reimpressão que não está impresso
}

// Tipo da carta (N, J, M, C, PR) e o número, pra deslocamento.
const tipoDe = (code) => (String(code).toUpperCase().match(/^([A-Z]+?)(?:US)?-/) || [, "?"])[1];
const numDe = (code) => { const m = String(code).match(/(\d+)[A-Z]?$/); return m ? Number(m[1]) : NaN; };

// Nome comparável: palavras em ordem alfabética, sem "the", com os ordinais por
// extenso ("The 4th Hokage" = "The Fourth Hokage", "Tortoise Ninja" = "Ninja
// Tortoise").
const ORDINAL = { "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth" };
// Acentos combinantes (U+0300–U+036F) montados por código: "Ūhei" = "Uhei".
const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
export function chaveNome(nome) {
  return String(nome || "").replace(/&#x27;|&#39;/g, "'").normalize("NFKD").replace(ACENTOS, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .map((w) => ORDINAL[w] || w).filter((w) => w && w !== "the").sort().join(" ");
}
const parecido = (a, b) => chaveNome(a) === chaveNome(b) || semelhanca(a, b) > 0;

// Permutações de um vetor pequeno (grupo de homônimos: até 4 no mesmo set).
function permutacoes(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => { for (const p of permutacoes(arr.filter((_, j) => j !== i))) out.push([x, ...p]); });
  return out;
}

// Casa as cartas de UM set. `nc`: [{ code, name }] do narutocards; `fan`:
// [{ code, name, img }] do N-CCG-DB; `fixo`: { código nc: img }. Devolve
// Map(código nc → carta do fan) e a lista do que ficou sem par.
export function casaSet(nc, fan, { codigoImpresso = false, fixo = {} } = {}) {
  const par = new Map();
  const usado = new Set();
  const usa = (c, j) => { par.set(c.code, fan[j]); usado.add(j); };
  for (const [code, img] of Object.entries(fixo)) {
    const c = nc.find((x) => x.code === code);
    const j = fan.findIndex((f) => f.img === img);
    if (!c || j < 0) throw new Error(`FIXO ${code} → ${img}: ${!c ? "código não está no set" : "scan não está no N-CCG-DB"}`);
    usa(c, j);
  }
  if (codigoImpresso) {
    for (const c of nc) {
      if (par.has(c.code)) continue;
      const j = fan.findIndex((f, j) => !usado.has(j) && codigoCanonico(f.code) === codigoCanonico(c.code) && parecido(f.name, c.name));
      if (j >= 0) usa(c, j);
    }
  }
  const tipos = new Set(nc.map((c) => tipoDe(c.code)));
  for (const t of tipos) {
    const restoNc = nc.filter((c) => !par.has(c.code) && tipoDe(c.code) === t);
    const restoFan = fan.map((f, j) => j).filter((j) => !usado.has(j) && tipoDe(fan[j].code) === t);
    const grupos = new Map();
    const grupo = (k) => grupos.get(k) || grupos.set(k, { nc: [], fan: [] }).get(k);
    for (const c of restoNc) grupo(chaveNome(c.name)).nc.push(c);
    for (const j of restoFan) grupo(chaveNome(fan[j].name)).fan.push(j);
    // Âncoras: nome único dos dois lados.
    for (const g of grupos.values()) if (g.nc.length === 1 && g.fan.length === 1) usa(g.nc[0], g.fan[0]);
    // Deslocamento (impresso − narutocards) de cada par do tipo, em ordem.
    const ancoras = nc.filter((c) => tipoDe(c.code) === t && par.has(c.code))
      .map((c) => ({ n: numDe(c.code), d: numDe(par.get(c.code).code) - numDe(c.code) }))
      .sort((a, b) => a.n - b.n);
    const custo = (c, j) => {
      const n = numDe(c.code);
      const d = numDe(fan[j].code) - n;
      const antes = ancoras.filter((a) => a.n < n).pop();
      const depois = ancoras.find((a) => a.n > n);
      const viz = [antes, depois].filter(Boolean).map((a) => Math.abs(d - a.d));
      return viz.length ? Math.min(...viz) : 0;
    };
    for (const g of grupos.values()) {
      if (g.nc.length < 2 || g.nc.length !== g.fan.length) continue;
      const ncs = [...g.nc].sort((a, b) => numDe(a.code) - numDe(b.code));
      const fans = [...g.fan].sort((a, b) => numDe(fan[a].code) - numDe(fan[b].code));
      let melhor = null;
      for (const p of (ncs.length <= 5 ? permutacoes(fans) : [fans])) {
        const total = ncs.reduce((s, c, i) => s + custo(c, p[i]), 0);
        if (!melhor || total < melhor.total) melhor = { total, p };
      }
      ncs.forEach((c, i) => usa(c, melhor.p[i]));
    }
    // Sobra: grafia diferente ("Masters of Weapons" × "Master of Weapons",
    // "Io" × "Iou") ou nome trocado no narutocards (o TP2 dele tem dois
    // "Shikamaru Nara", e o segundo está no lugar do "Shikaku Nara"). Casa só
    // com nome parecido E o deslocamento exato de uma âncora vizinha, e só se
    // houver um candidato.
    const ancoras2 = nc.filter((c) => tipoDe(c.code) === t && par.has(c.code))
      .map((c) => ({ n: numDe(c.code), d: numDe(par.get(c.code).code) - numDe(c.code) }))
      .sort((a, b) => a.n - b.n);
    for (const c of restoNc) {
      if (par.has(c.code)) continue;
      const n = numDe(c.code);
      const viz = [ancoras2.filter((a) => a.n < n).pop(), ancoras2.find((a) => a.n > n)].filter(Boolean).map((a) => a.d);
      const cands = restoFan.filter((j) => !usado.has(j) && parecido(fan[j].name, c.name) && viz.includes(numDe(fan[j].code) - n));
      if (cands.length === 1) usa(c, cands[0]);
    }
  }
  return { par, semPar: nc.filter((c) => !par.has(c.code)).map((c) => c.code) };
}

async function run() {
  const fan = await baixaFan();
  const snap = JSON.parse(await readFile(SNAP, "utf8"));
  const sets = {};
  const relatorio = [];
  let mudam = 0, scans = 0;
  for (const s of snap.sets) {
    const nome = FAN_SET[s.key];
    if (!nome) continue;
    const doFan = (fan[nome] || []).filter((c) => c.image_path)
      .map((c) => ({ code: String(c["Collector Number"]), name: c["Printed Name"], img: c.image_path }));
    const { par, semPar } = casaSet(s.cards, doFan, { codigoImpresso: CODIGO_IMPRESSO.test(s.key), fixo: FIXO[s.key] });
    const cartas = {};
    let n = 0;
    for (const c of s.cards) {
      const muda = (MUDA_DE_SET[s.key] || {})[c.code];
      if (muda) {
        if (par.has(c.code)) throw new Error(`${s.key} ${c.code}: em MUDA_DE_SET e casada no próprio set`);
        cartas[c.code] = { ...muda };
        continue;
      }
      const f = par.get(c.code);
      if (!f) continue;
      const numero = numeroImpresso(f.code);
      const x = {};
      if (codigoCanonico(numero) !== codigoCanonico(c.code)) x.numero = numero;
      if (!(SCAN_ERRADO[s.key] || []).includes(c.code)) x.img = f.img;
      if (!Object.keys(x).length) continue;
      cartas[c.code] = x;
      if (x.numero) n++;
    }
    // Dois códigos do narutocards nunca viram o mesmo número no set.
    const vistos = new Map();
    for (const [code, x] of Object.entries(cartas)) {
      const k = codigoCanonico(x.numero || code);
      if (vistos.has(k)) throw new Error(`${s.key}: ${vistos.get(k)} e ${code} viram ${x.numero || code}`);
      vistos.set(k, code);
    }
    sets[s.key] = cartas;
    mudam += n;
    scans += Object.keys(cartas).length;
    const movidas = Object.entries(MUDA_DE_SET[s.key] || {}).map(([code, m]) => `${code} → ${m.set}`);
    const faltam = semPar.filter((code) => !(MUDA_DE_SET[s.key] || {})[code]);
    relatorio.push(`  ${s.key}: ${String(s.cards.length).padStart(3)} cartas, ${String(n).padStart(3)} com número novo, ${String(Object.keys(cartas).length).padStart(3)} com scan do N-CCG-DB`
      + (movidas.length ? ` — muda de set: ${movidas.join(", ")}` : "")
      + (faltam.length ? ` — sem par: ${faltam.join(", ")}` : ""));
  }
  const out = {
    fontes: {
      numero: `https://github.com/N-CCG-DB/naruto-ccg-deckbuilder/blob/${FAN_SHA}/narutoccgdatabase.json`,
      scans: `https://${FAN_IMG}`
    },
    conferencia: "2026-11-02: todos os pares comparados por imagem (scan do narutocards × N-CCG-DB) e o número impresso lido no canto de uma amostra de cada set",
    updatedAt: new Date().toISOString().slice(0, 10),
    sets
  };
  // Uma carta por linha: o diff de uma rodada nova mostra só o que mudou.
  const texto = JSON.stringify(out, null, 1).replace(/\{\n\s+("numero"|"img"|"set")([^{}]*?)\n\s+\}/g,
    (_, k, resto) => `{ ${k}${resto.replace(/\n\s+/g, " ")} }`);
  await writeFile(OUT, texto + "\n", "utf8");
  console.log(relatorio.join("\n"));
  console.log(`De-para: ${mudam} cartas com número novo, ${scans} com scan do N-CCG-DB.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
