// Espelha os LOGOS de set do Star Wars: Unlimited localmente, a partir do site
// OFICIAL da FFG (starwarsunlimited.com). A TCGCSV não tem logo de set; o CMS
// do site (Strapi em admin.starwarsunlimited.com, leitura pública) tem, por
// PRODUTO, o campo `logo` — PNG transparente no cdn.starwarsunlimited.com.
//
// Casamento produto -> set do catálogo: pelo código da expansão do produto
// (SOR, SHD, TWI… = abreviação do grupo na TCGCSV = setId do sync-swu) e, quando
// o produto não traz expansão ligada (Ashes of the Empire, Icons 2027 Edition),
// pelo NOME exato do grupo. Secrets of Power (conferido em 2026-09-30) não tem
// o campo `logo` preenchido: o logo está só no HTML da página do produto, então
// o fallback caça um PNG "…Logo_EN…" nos blocos de conteúdo.
//
// Tratamento (2026-09-30), pelos dois defeitos que o README de assets/games já
// documenta nos logos de jogo, mais um próprio do Star Wars:
//   1. margem dentro do arquivo -> recorte no conteúdo (+2px), senão o
//      object-fit: contain do .set-logo encolhe o logo junto;
//   2. véu de alfa (pixels de fundo com alfa 1–11) -> zerado, senão escurece o
//      chip branco num retângulo;
//   3. vários logos oficiais são PRATA/BRANCOS (Spark of Rebellion, Ashes,
//      Legends of the Force, Twilight, Twin Suns): foram feitos pro fundo
//      escuro do site da FFG e sumiam no chip branco FIXO do .set-art. Todo
//      logo ganha uma sombra escura suave embutida (a silhueta do próprio
//      logo, desfocada) — igual em todos, pra nenhum set destoar do vizinho.
// Saída: data/swu/set-logos/<setId>.webp, até 600px de largura.
//
// Precisa do sharp FORA do repositório (o site não tem package.json), como o
// mirror-r2.mjs: SHARP_DIR aponta a pasta do pacote.
//   mkdir /tmp/sharp && cd /tmp/sharp && npm init -y && npm i sharp@0.33.5
//   SHARP_DIR=/tmp/sharp/node_modules/sharp node scripts/mirror-swu-set-logos.mjs [--force]
// Idempotente (skip-if-exists). Rodar LOCAL e COMMITAR os arquivos novos; o
// sync-swu.mjs prefere o logo local quando existe.
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchRetry, winSafeName } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/swu/set-logos/", ROOT);
const CMS = "https://admin.starwarsunlimited.com/api";
const TCGCSV_GROUPS = "https://tcgcsv.com/tcgplayer/79/groups";
const UA = { "User-Agent": "Sleevu (sleevu.app) set logo mirror" };
const FORCE = process.argv.includes("--force");
const LARGURA = 600, SOMBRA = 3; // px de desfoque da sombra (e da folga em volta)

const dir = process.env.SHARP_DIR;
if (!dir) { console.log("mirror-swu-set-logos: sem SHARP_DIR (pasta do pacote sharp) — ver o cabeçalho."); process.exit(0); }
const sharp = (await import(pathToFileURL(join(dir, "lib", "index.js")).href)).default;

const getJson = async (url) => (await fetchRetry(url, { headers: UA })).json();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Logo de um produto: o campo `logo`; senão o primeiro PNG "Logo" (original,
// sem o prefixo de tamanho do Strapi) no conteúdo da página do produto.
async function logoDoProduto(p) {
  const direto = p.attributes.logo && p.attributes.logo.data && p.attributes.logo.data.attributes.url;
  if (direto) return direto;
  const q = `${CMS}/products?locale=en&filters[id][$eq]=${p.id}&populate=deep`;
  const txt = JSON.stringify(await getJson(q));
  const achados = txt.match(/https:\/\/cdn\.starwarsunlimited\.com\/+[A-Za-z0-9_.-]*Logo[A-Za-z0-9_.-]*\.png/g) || [];
  const originais = achados.filter((u) => !/\/(?:thumbnail|xxxsmall|xxsmall|xsmall|small|medium|large|xlarge|card)_/.test(u));
  return originais.find((u) => /_EN_/i.test(u)) || originais[0] || "";
}

// PNG oficial -> webp recortado, sem véu, com sombra embutida.
async function trata(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (data[i] < 12) { data[i] = 0; continue; }
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("logo vazio");
  const left = Math.max(0, x0 - 2), top = Math.max(0, y0 - 2);
  const cw = Math.min(w, x1 + 3) - left, ch = Math.min(h, y1 + 3) - top;
  const escala = Math.min(1, (LARGURA - 2 * SOMBRA) / cw);
  const logo = await sharp(data, { raw: info }).extract({ left, top, width: cw, height: ch })
    .resize({ width: Math.round(cw * escala) }).png().toBuffer();
  const meta = await sharp(logo).metadata();
  const lw = meta.width, lh = meta.height;
  const fw = lw + 2 * SOMBRA, fh = lh + 2 * SOMBRA;
  const { data: la } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Logo CLARO (luminância média da tinta ≥ 176: Spark, Ashes, Legends,
  // Twilight, Twin Suns, Icons) ganha CONTORNO — a silhueta dilatada 2px, quase
  // opaca. A sombra desfocada sozinha não bastava pro prata/branco (conferido
  // no chip em 2026-09-30). Os coloridos ficam só com a sombra suave.
  let soma = 0, n = 0;
  for (let i = 0; i < lw * lh; i++) {
    if (la[i * 4 + 3] < 128) continue;
    soma += 0.3 * la[i * 4] + 0.59 * la[i * 4 + 1] + 0.11 * la[i * 4 + 2]; n++;
  }
  const claro = n > 0 && soma / n >= 176;
  const raio = claro ? 2 : 0, forca = claro ? 0.9 : 0.55;
  const alfa = (x, y) => (x >= 0 && y >= 0 && x < lw && y < lh ? la[(y * lw + x) * 4 + 3] : 0);
  const sil = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let a = 0;
      for (let dy = -raio; dy <= raio; dy++) {
        for (let dx = -raio; dx <= raio; dx++) {
          if (dx * dx + dy * dy > raio * raio + 1) continue;
          const v = alfa(x - SOMBRA + dx, y - SOMBRA + dy);
          if (v > a) a = v;
        }
      }
      const i = (y * fw + x) * 4;
      sil[i] = 20; sil[i + 1] = 20; sil[i + 2] = 24; // quase preto
      sil[i + 3] = Math.round(a * forca);
    }
  }
  const sombra = await sharp(sil, { raw: { width: fw, height: fh, channels: 4 } })
    .blur(claro ? 0.8 : SOMBRA / 2 + 0.5).png().toBuffer();
  return sharp(sombra).composite([{ input: logo, left: SOMBRA, top: SOMBRA }]).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
}

async function run() {
  console.log("Star Wars: Unlimited: buscando logos no site oficial…");
  const grupos = (await getJson(TCGCSV_GROUPS)).results || [];
  const porAbrev = new Map(grupos.filter((g) => g.abbreviation).map((g) => [String(g.abbreviation).trim(), g]));
  const porNome = new Map(grupos.map((g) => [norm(g.name), g]));
  const produtos = (await getJson(`${CMS}/products?locale=en&populate=*&pagination[pageSize]=100`)).data || [];
  console.log(`  ${produtos.length} produtos no site oficial.`);

  await mkdir(OUT, { recursive: true });
  let ok = 0, skip = 0, fail = 0;
  for (const p of produtos) {
    const nome = p.attributes.name;
    const codigos = ((p.attributes.expansions && p.attributes.expansions.data) || []).map((e) => e.attributes.code);
    const g = codigos.map((c) => porAbrev.get(c)).find(Boolean) || porNome.get(norm(nome));
    if (!g) { console.log(`  ${nome}: sem set correspondente na TCGCSV (pulado)`); continue; }
    // setId igual ao do sync-swu: a abreviação (os grupos com logo nunca caem
    // no caso de abreviação repetida/vazia).
    const setId = String(g.abbreviation).trim();
    const dest = new URL(`${winSafeName(setId)}.webp`, OUT);
    if (!FORCE && existsSync(dest)) { skip++; continue; }
    try {
      const url = await logoDoProduto(p);
      if (!url) { console.log(`  ${setId} ${nome}: sem logo publicado`); continue; }
      const buf = Buffer.from(await (await fetchRetry(url, { headers: UA, timeoutMs: 30000 })).arrayBuffer());
      await writeFile(dest, await trata(buf));
      console.log(`  ${setId} ${nome}: ok`);
      ok++;
    } catch (e) { console.warn(`  ${setId} ${nome}: falhou (${e.message})`); fail++; }
  }
  console.log(`  baixados: ${ok} · já existiam: ${skip} · falharam: ${fail}`);
  console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos e rodar o sync-swu.`);
}

await run();
