// Gera a IMAGEM DE COMPARTILHAMENTO (og-image.png, 1200x630) a partir de um
// template HTML — o mesmo caminho que o resto do site: HTML + CSS, sem build.
//
// Por que existe: até 2026-09 o og-image.png era um bitmap solto no repo, sem
// fonte nenhuma. Editar a chamada ("Pokémon · Lorcana · One Piece · Naruto",
// de quando o site tinha 4 jogos) exigia abrir um editor de imagem e refazer a
// arte no olho. Agora o texto mora no scripts/og/og-image.html e a arte se
// regenera com um comando.
//
//   node scripts/build-og-image.mjs                  # regrava og-image.png
//   node scripts/build-og-image.mjs --keep-html      # deixa o HTML renderizado
//   node scripts/build-og-image.mjs --src a.html --out b.png
//
// Precisa de um Chrome/Chromium instalado (é ele quem desenha). O script acha o
// binário sozinho nos caminhos usuais; se não achar, aponte com CHROME_PATH.
// Roda FORA do CI de propósito: o PNG é versionado, e comparar bytes de
// renderização entre versões do Chromium daria falso positivo em todo bump.
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
function arg(nome, padrao) {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
}
const SRC = resolve(ROOT, arg("src", "scripts/og/og-image.html"));
const OUT = resolve(ROOT, arg("out", "og-image.png"));
const KEEP = argv.includes("--keep-html");
const LARGURA = 1200;
const ALTURA = 630;

// O binário do Chrome. Cobre Linux (repo e snap), macOS e o Chromium que o
// Playwright baixa (PLAYWRIGHT_BROWSERS_PATH), que é o caso do agente.
function achaChrome() {
  const pwDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidatos = [
    process.env.CHROME_PATH,
    pwDir && join(pwDir, "chromium"),
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  for (const c of candidatos) if (existsSync(c)) return c;
  return null;
}

const chrome = achaChrome();
if (!chrome) {
  console.error(
    "Não achei um Chrome/Chromium pra renderizar.\n" +
      "Instale o Chrome ou aponte o binário:  CHROME_PATH=/caminho/do/chrome node scripts/build-og-image.mjs"
  );
  process.exit(1);
}

// O wordmark NÃO é copiado pro template: ele é splicado aqui do
// assets/brand/sleevu-wordmark.svg, o mesmo arquivo que o site usa. Assim a
// marca tem uma fonte só — se o logo mudar, a imagem de compartilhamento
// acompanha na próxima geração em vez de ficar com a arte velha.
// (Inline e não <img>: o SVG pinta com fill="currentColor", que dentro de um
// <img> não vê a cor do CSS de fora e sairia preto no fundo preto.)
const wordmark = readFileSync(join(ROOT, "assets/brand/sleevu-wordmark.svg"), "utf8")
  .replace(/<\?xml[^>]*\?>\s*/i, "")
  .trim();

let html = readFileSync(SRC, "utf8");
// Regex com contagem, e não um replace de string: o replace trocava a PRIMEIRA
// ocorrência, e bastava o comentário do topo do template citar o marcador pra
// que o SVG fosse splicado lá dentro (invisível) e o lugar certo ficasse vazio.
const marcador = /<!--\s*WORDMARK\s*-->/g;
const achados = html.match(marcador);
if (!achados || achados.length !== 1) {
  console.error(`${SRC}: esperava 1 marcador de wordmark, achei ${achados ? achados.length : 0}.`);
  process.exit(1);
}
html = html.replace(marcador, () => wordmark);

// O HTML renderizado vai PARA O LADO do template, não pro /tmp: o template
// referencia assets por caminho relativo (../../assets/...) e mudar de pasta
// quebraria a fonte e os logos.
const tmpHtml = join(dirname(SRC), ".render.html");
writeFileSync(tmpHtml, html);

// O headless do Chrome PINTA apenas o viewport, mas grava o PNG do tamanho da
// JANELA — e o viewport sai menor que a janela (141: 87px de barra fantasma).
// Com --window-size=1200,630 o rodapé da arte saía em branco, pintado com a cor
// de fundo. Então: mede a folga, abre a janela desse tanto MAIOR (viewport =
// 630 exatos, tudo pintado) e corta as linhas sobrando do PNG.
function medeFolga(alturaJanela) {
  const probe = join(dirname(SRC), ".probe.html");
  writeFileSync(
    probe,
    "<!doctype html><html><body><pre id=o></pre><script>" +
      "document.getElementById('o').textContent='ALTURA_VIEWPORT='+innerHeight" +
      "<\/script></body></html>"
  );
  const r = spawnSync(
    chrome,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
     "--force-device-scale-factor=1", `--window-size=800,${alturaJanela}`,
     "--virtual-time-budget=1500", "--dump-dom", `file://${probe}`],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  try { unlinkSync(probe); } catch {}
  const m = (r.stdout || "").match(/ALTURA_VIEWPORT=(\d+)/);
  if (!m) return 0; // sem medida, segue sem compensar (e o corte acusa)
  return Math.max(0, alturaJanela - Number(m[1]));
}

// Corta o PNG na altura pedida jogando fora as SCANLINES do fim. Não precisa
// decodificar pixel: cada linha só depende da ANTERIOR (filtro do PNG), então
// as primeiras `altura` linhas continuam válidas sozinhas.
function cortaAltura(buf, altura) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");
  let pos = 8, ihdr = null, idat = [], outros = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString("ascii", pos + 4, pos + 8);
    const dados = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === "IHDR") ihdr = Buffer.from(dados);
    else if (tipo === "IDAT") idat.push(dados);
    else if (tipo !== "IEND") outros.push([tipo, Buffer.from(dados)]);
    pos += 12 + len;
  }
  if (!ihdr) throw new Error("PNG sem IHDR");
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const prof = ihdr[8], cor = ihdr[9], entrelaçado = ihdr[12];
  if (h === altura) return buf;
  if (h < altura) throw new Error(`PNG de ${h}px, menor que os ${altura}px pedidos`);
  if (entrelaçado) throw new Error("PNG entrelaçado não suportado");
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[cor];
  if (!canais) throw new Error(`tipo de cor ${cor} não suportado`);
  const stride = Math.ceil((w * canais * prof) / 8);
  const cru = inflateSync(Buffer.concat(idat));
  const mantem = cru.subarray(0, altura * (1 + stride));
  ihdr.writeUInt32BE(altura, 4);
  const chunk = (tipo, dados) => {
    const c = Buffer.alloc(12 + dados.length);
    c.writeUInt32BE(dados.length, 0);
    c.write(tipo, 4, "ascii");
    dados.copy(c, 8);
    c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, "ascii"), dados])) >>> 0, 8 + dados.length);
    return c;
  };
  return Buffer.concat([
    buf.subarray(0, 8),
    chunk("IHDR", ihdr),
    ...outros.map(([t, d]) => chunk(t, d)),
    chunk("IDAT", deflateSync(mantem, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const folga = medeFolga(ALTURA);
const flags = [
  "--headless=new",
  "--no-sandbox", // em container não há usuário pra sandbox
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  // Sem hinting: o texto sai igual em Linux e macOS. É o mesmo ajuste que o
  // Playwright faz por padrão nos screenshots dele.
  "--font-render-hinting=none",
  "--allow-file-access-from-files", // a fonte .woff2 vem por file://
  // Dá tempo da fonte carregar antes do clique do obturador. Sem isto o
  // screenshot sai com a fonte de fallback (métrica diferente, texto torto).
  "--virtual-time-budget=4000",
  `--window-size=${LARGURA},${ALTURA + folga}`,
  `--screenshot=${OUT}`,
  `file://${tmpHtml}`,
];

const r = spawnSync(chrome, flags, { encoding: "utf8" });
if (!KEEP) try { unlinkSync(tmpHtml); } catch {}

if (r.status !== 0 || !existsSync(OUT)) {
  console.error(`Chromium falhou (status ${r.status}).`);
  if (r.stderr) console.error(r.stderr.split("\n").slice(0, 12).join("\n"));
  process.exit(1);
}

writeFileSync(OUT, cortaAltura(readFileSync(OUT), ALTURA));

// Confere no ARQUIVO, não nas constantes: já saiu PNG de 830px de altura com o
// log jurando 630.
const png = readFileSync(OUT);
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
if (w !== LARGURA || h !== ALTURA) {
  console.error(`Saiu ${w}x${h}, esperava ${LARGURA}x${ALTURA}.`);
  process.exit(1);
}
const kb = (statSync(OUT).size / 1024).toFixed(1);
console.log(`${OUT.replace(ROOT + "/", "")} — ${w}x${h}, ${kb} KB (folga de viewport: ${folga}px)`);
if (KEEP) console.log(`HTML renderizado: ${tmpHtml.replace(ROOT + "/", "")}`);
