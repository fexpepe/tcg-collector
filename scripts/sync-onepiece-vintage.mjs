// Catálogo VINTAGE do One Piece: "Carddass Hyper Battle" (Bandai, 1999–2002) —
// as primeiras cartas de One Piece, japonesas, de máquina Carddass. NÃO tem API
// nem preço aberto; a fonte é o Grand Line Wiki (grandlinewiki.net), um wiki de
// fã com a checklist completa (número, nome EN/JP, tipo, mark, power e a era/set).
//
// Sem preço (decisão do produto): é um SET VINTAGE de exibição dentro do jogo
// One Piece. As cartas entram com `vintage: true` e o front agrupa numa categoria
// "Vintage (Carddass)" na página de Sets.
//
// Imagens: os scans do wiki são PNG de ~7 MB — inviável servir direto. Passam
// pelo proxy wsrv.nl (já liberado na CSP/SW), que redimensiona pra ~440px webp
// (~60 KB). Path previsível cards/<num>.png cobre as séries C e S (o grosso);
// FP/RS/algumas H não seguem o padrão e caem no placeholder do site (refina
// depois — não vale marretar 785 requisições no wiki de fã por imagem).
//
// Roda DEPOIS do sync-onepiece (TCGCSV): lê o data/onepiece/cards.js existente,
// ANEXA as cartas vintage e reescreve cards/indexes/pricing + .generated. Assim
// o catálogo do One Piece passa a ter o moderno (TCGCSV) + o vintage (Carddass).
//
//   node scripts/sync-onepiece-vintage.mjs
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/onepiece/", ROOT);
const CACHE = new URL("data/.cache/onepiece-vintage.html", ROOT);
const OVERVIEW = "https://grandlinewiki.net/tcg/carddasshyper.html";
const IMG_BASE = "grandlinewiki.net/images/tcg/hyperbattle/cards"; // sem https:// (wsrv aceita assim)
// O wiki bloqueia UA não-navegador; usa um UA de navegador. Baixamos 1x e
// cacheamos (respeitoso — o conteúdo de 1999 nunca muda).
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Imagem via wsrv.nl: redimensiona o scan gigante do wiki pra thumbnail webp.
function cardImage(num) {
  const file = String(num).toLowerCase() + ".png";
  return `https://wsrv.nl/?url=${IMG_BASE}/${file}&w=440&output=webp`;
}

const MONTHS = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function toISO(dateText) {
  const m = /([A-Za-z]+),?\s*(\d{4})/.exec(dateText || "");
  if (!m) return "";
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : m[2];
}
function slug(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const decode = (s) => String(s || "")
  .replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&#8211;|&#8212;/g, "-")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function fetchOverview() {
  // Cache em disco: o wiki é estático (cartas de 1999). Baixa 1x, reusa sempre —
  // educado com o servidor de fã.
  try { return await readFile(CACHE, "utf8"); } catch { /* sem cache: baixa */ }
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(OVERVIEW, { headers: UA });
      if (r.ok) { const html = await r.text(); await mkdir(new URL("data/.cache/", ROOT), { recursive: true }); await writeFile(CACHE, html, "utf8"); return html; }
    } catch (e) { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  throw new Error("não consegui baixar a overview do Grand Line Wiki");
}

// Extrai as cartas de um bloco HTML de um set. Cada linha tem número, nome EN,
// nome JP, tipo, mark (letra/cor) e power (valor de JOGO, não preço). A célula do
// nome é capturada inteira e destrinchada depois: assim linhas SEM link <a> ou
// SEM o <i> do nome JP (que existem em alguns sets) também entram — antes o regex
// rígido as pulava.
function cardsIn(block) {
  const out = [];
  const re = /HBcardNum">([A-Z0-9]+)<\/td>\s*<td id="HBcardName">([\s\S]*?)<\/td>\s*<td id="HBcardType">([^<]*)<\/td>\s*<td id="HBcardMark">([^<]*)<\/td>\s*<td id="HBcardValue">([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(block))) {
    const nameCell = m[2];
    const nameJp = (nameCell.match(/「([^」]*)」/) || [])[1] || "";
    // EN: o texto da célula sem o <i> do nome JP (e sem as demais tags).
    const nameEn = decode(nameCell.replace(/<i id="HBcardNameJP">[\s\S]*?<\/i>/, ""));
    out.push({ num: m[1].trim(), nameEn, nameJp: nameJp.trim(), type: decode(m[3]), mark: decode(m[4]), power: decode(m[5]) });
  }
  return out;
}

async function run() {
  console.log("One Piece Vintage: baixando/lendo a checklist (Grand Line Wiki)…");
  const html = await fetchOverview();

  // Cada set começa numa tabela HBSetImageLogo (logo) seguida de HBSetDetails
  // (nome no HBStageHead, data no HBsetDate) e da tabela de cartas. Divido o
  // documento nos limites de HBSetImageLogo pra isolar cada set.
  const segs = html.split(/<table id="HBSetImageLogo">/).slice(1);
  console.log(`  ${segs.length} seções de set encontradas.`);

  const vintage = [];
  let order = 0;
  for (const seg of segs) {
    order++;
    const name = decode((seg.match(/id="HBStageHead"[^>]*>([\s\S]*?)<\/th>/) || [])[1] || `Set ${order}`);
    const date = toISO((seg.match(/id="HBsetDate">([^<]+)</) || [])[1] || "");
    const official = Number((seg.match(/id="HBsetCC">(\d+)</) || [])[1] || 0);
    const cards = cardsIn(seg);
    if (!cards.length) { console.log(`  ${name}: 0 cartas (pulado)`); continue; }
    const setId = "opcd-" + slug(name);
    for (const c of cards) {
      vintage.push({
        id: "opcd-" + c.num,
        name: c.nameEn || c.num,
        set: `Carddass — ${name}`,
        setId,
        number: c.num,
        setTotal: official || cards.length,
        setReleaseDate: date,
        rarity: c.mark || "",
        artist: "",
        language: "ja", // produto japonês (1999–2002)
        image: cardImage(c.num),
        variants: ["Normal"],
        setLogo: "", // preenchido abaixo (arte da 1ª carta) — o wiki não tem logo limpo
        opColor: null,
        cardType: c.type || null,
        cost: null,
        power: c.power || null,
        vintage: true,
        nameJp: c.nameJp || null
      });
    }
    console.log(`  ${name} (${date}): ${cards.length} cartas`);
  }
  console.log(`Total vintage: ${vintage.length} cartas em ${new Set(vintage.map((c) => c.setId)).size} sets.`);

  // setLogo: o wiki não tem logo transparente por set — usa a arte da 1ª carta do
  // set como capa (mesmo fallback do resto do One Piece).
  const cover = {};
  for (const c of vintage) { if (!cover[c.setId]) cover[c.setId] = c.image; }
  for (const c of vintage) { c.setLogo = cover[c.setId]; }

  // Anexa ao catálogo do One Piece existente (moderno, do TCGCSV). Dedupe por id.
  const readGlobal = async (file, varName) => {
    try { const t = await readFile(new URL(file, OUT), "utf8"); global.window = {}; eval(t); return global.window[varName]; }
    catch { return null; }
  };
  const modern = (await readGlobal("cards.js", "TCG_CARDS")) || [];
  const have = new Set(modern.map((c) => c.id));
  const merged = modern.concat(vintage.filter((c) => !have.has(c.id)));
  merged.sort((a, b) => String(a.setId).localeCompare(String(b.setId)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  // Índices (sets/artists) — mesmo formato do sync-onepiece.
  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };
  const pricing = (await readGlobal("pricing.js", "TCG_PRICING")) || {}; // vintage não tem preço

  await mkdir(OUT, { recursive: true });
  const w = async (name, varName, value) => writeFile(new URL(name, OUT), `window.${varName} = ${JSON.stringify(value)};\n`, "utf8");
  await w("cards.js", "TCG_CARDS", merged);
  await w("manifest.generated.js", "TCG_CARDS", merged);
  await w("indexes.js", "TCG_INDEXES", indexes);
  await w("indexes.generated.js", "TCG_INDEXES", indexes);
  await w("pricing.js", "TCG_PRICING", pricing);
  await w("pricing.generated.js", "TCG_PRICING", pricing);
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais (moderno + vintage).`);
}

await run();
