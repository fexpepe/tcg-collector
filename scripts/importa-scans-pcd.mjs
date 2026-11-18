// Importa os scans das Partes 1 e 2 da Pokémon Carddass (jogo pcd) baixados
// À MÃO do Bulbagarden Archives e vira cada um na imagem curada da carta,
// assets/cards/pcd/<id>.webp, que o sync pega sozinho (curatedImg).
//
// Por que à mão: o Archives devolve o desafio do Cloudflare a acesso
// automatizado, e fonte que recusa robô não entra no sync nem é contornada
// (contrato 4 do docs/CATALOGO.md). Uma pessoa no navegador abre e salva
// normalmente. Os scans estão lá como fair use (a licença é da Nintendo e da
// Bandai, não do Bulbagarden; o CC BY-NC-SA de lá cobre o texto da wiki), o
// mesmo pé de qualquer outra imagem de carta do site. Decisão do Fernando em
// 2026-11-16.
//
// O que faz:
//   1. procura na pasta (padrão: a Downloads do usuário) os arquivos com o
//      nome que o Archives dá, "Bandai_-_Carddass_-_red_25.jpg" (ou com
//      espaços, ou com o " (1)" que o navegador põe numa cópia);
//   2. acha o id da carta pela cor e pelo número: a parte sai das listas de
//      scripts/data/pokemon-carddass.json; o "red 156" do Archives é a
//      タイトルカードEX, que é AZUL (pcd-p2-b-156);
//   3. converte com o ffmpeg para webp de no máximo 440 px de largura (a do
//      scan servido pelo wsrv nos outros vintages), q88, sem metadado. Não
//      sobrescreve arquivo que já existe, a não ser com --forcar;
//   4. escreve <pasta>/pcd-faltam.html com o link de cada scan que ainda não
//      tem imagem, por parte e cor, para a próxima rodada.
//
//   node scripts/importa-scans-pcd.mjs                 # lê a Downloads
//   node scripts/importa-scans-pcd.mjs D:/scans/pcd    # outra pasta
//   node scripts/importa-scans-pcd.mjs --forcar        # refaz os que existem
//
// Depois: node scripts/sync-pokemon-carddass.mjs --no-fetch (o CI também roda
// em todo deploy).
import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cartasDaParte, LISTAS, CORES } from "./sync-pokemon-carddass.mjs";
import { readGlobalVar } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const DESTINO = fileURLToPath(new URL("assets/cards/pcd/", ROOT));
const LARGURA = 440;
const ARCHIVES = "https://archives.bulbagarden.net/wiki/File:";

// "Bandai - Carddass - red 25.jpg", "Bandai_-_Carddass_-_red_25.jpg",
// "Bandai_-_Carddass_-_red_25 (1).jpg". Grupo 1: cor; 2: número; 3: cópia.
const NOME = /^Bandai[ _]-[ _]Carddass[ _]-[ _](green|red)[ _](\d{1,3})( ?\(\d+\))?\.(jpe?g|png|webp|gif)$/i;

// As cartas das Partes 1 e 2 (as que vêm do Archives), na ordem do catálogo.
export const cartasDoArchives = (listas = LISTAS) => cartasDaParte("p1", listas).concat(cartasDaParte("p2", listas));

// O nome do arquivo NO ARCHIVES de uma carta: a cor da moldura e o número sem
// zero à esquerda. A タイトルカードEX (azul) está lá como "red 156".
export const arquivoDoArchives = (c) => `Bandai_-_Carddass_-_${c.cor === "g" ? "green" : "red"}_${Number(c.num)}.jpg`;

// Nome de arquivo baixado -> { id, copia } da carta, ou null (não é scan da
// Carddass, ou é um número que nenhuma das duas partes tem).
export function idDoScan(nome, cartas = cartasDoArchives()) {
  const m = NOME.exec(nome.trim());
  if (!m) return null;
  const cor = m[1].toLowerCase() === "green" ? "g" : "r";
  const num = m[2].padStart(3, "0");
  const carta = cartas.find((c) => c.num === num && (c.cor === cor || (cor === "r" && c.cor === "b")));
  return carta ? { id: carta.id, copia: Boolean(m[3]) } : null;
}

const largura = (arquivo) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", arquivo], { encoding: "utf8" }).trim());

function converte(origem, destino) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", origem, "-frames:v", "1", "-vf", `scale='min(${LARGURA},iw)':-1`, "-c:v", "libwebp", "-quality", "88", "-map_metadata", "-1", destino]);
}

const temImagem = (id) => ["webp", "jpg", "png"].some((ext) => existsSync(join(DESTINO, `${id}.${ext}`)));

// A lista do que falta, para clicar um a um no navegador.
function paginaDoQueFalta(cartas, ingles) {
  const grupos = [];
  for (const parte of ["p1", "p2"]) {
    for (const cor of ["g", "r", "b"]) {
      const lista = cartas.filter((c) => c.id.startsWith(`pcd-${parte}-${cor}-`));
      if (lista.length) grupos.push({ titulo: `Parte ${parte.slice(1)} · ${CORES[cor]}`, lista });
    }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const nome = (c) => (c.esp ? `${c.esp.en} (${c.esp.ja})` : `${ingles[String(c.dex)] || ""} (${LISTAS.pokemon[c.num] || ""})`);
  const total = grupos.reduce((n, g) => n + g.lista.length, 0);
  const corpo = grupos.map((g) => `<h2>${esc(g.titulo)} <small>${g.lista.length}</small></h2>\n<ol>\n${g.lista.map((c) => {
    const arq = arquivoDoArchives(c);
    return `<li><a href="${ARCHIVES}${encodeURI(arq)}" target="_blank" rel="noopener">${esc(c.num)} ${esc(nome(c))}</a> <code>${esc(arq)}</code></li>`;
  }).join("\n")}\n</ol>`).join("\n");
  return `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><title>Pokémon Carddass: faltam ${total}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}li{margin:.15rem 0}a:visited{color:#888}code{font-size:12px;color:#666}small{font-weight:normal;color:#666}</style>
<h1>Pokémon Carddass, Partes 1 e 2: faltam ${total} scans</h1>
<p>Cada link abre a página do arquivo no Bulbagarden Archives. Clique na imagem
(ou em <b>Original file</b>) para abrir o tamanho original e salve com o nome
que o navegador sugere, sem renomear. Link já visitado fica cinza. Depois rode
de novo <code>node scripts/importa-scans-pcd.mjs</code>: esta lista volta só
com o que ainda faltar. Se uma página vier vazia, o arquivo tem outro nome lá:
procure pelo número na busca do Archives.</p>
${corpo}
</html>
`;
}

async function run() {
  const args = process.argv.slice(2);
  const forcar = args.includes("--forcar");
  const pasta = args.find((a) => !a.startsWith("--")) || join(homedir(), "Downloads");
  if (!existsSync(pasta)) { console.error(`Pasta não existe: ${pasta}`); process.exit(1); }
  mkdirSync(DESTINO, { recursive: true });
  const cartas = cartasDoArchives();
  const ingles = (await readGlobalVar(new URL("data/pokemon-names.js", ROOT), "TCG_POKEMON_NAMES")) || {};

  // O original de cada id; a cópia " (1)" só vale se o original não estiver lá.
  const porId = new Map();
  const estranhos = [];
  for (const arq of readdirSync(pasta)) {
    if (!/carddass/i.test(arq)) continue;
    const achado = idDoScan(arq, cartas);
    if (!achado) { estranhos.push(arq); continue; }
    const antes = porId.get(achado.id);
    if (!antes || (antes.copia && !achado.copia)) porId.set(achado.id, { arq, copia: achado.copia });
  }

  let feitos = 0, pulados = 0;
  const pequenos = [];
  for (const [id, { arq }] of porId) {
    const destino = join(DESTINO, `${id}.webp`);
    if (temImagem(id) && !forcar) { pulados++; continue; }
    const origem = join(pasta, arq);
    const w = largura(origem);
    if (w < LARGURA) pequenos.push(`${arq} (${w} px)`);
    converte(origem, destino);
    feitos++;
  }

  const faltam = cartas.filter((c) => !temImagem(c.id));
  const html = join(pasta, "pcd-faltam.html");
  writeFileSync(html, paginaDoQueFalta(faltam, ingles));

  console.log(`Pokémon Carddass, Partes 1 e 2: ${porId.size} scans achados em ${pasta}`);
  console.log(`  ${feitos} convertidos para assets/cards/pcd/${pulados ? `, ${pulados} já existiam (--forcar refaz)` : ""}`);
  if (pequenos.length) console.log(`  ⚠ ${pequenos.length} com menos de ${LARGURA} px (salvou a prévia? pegue o "Original file"):\n    ${pequenos.join("\n    ")}`);
  if (estranhos.length) console.log(`  ⚠ ${estranhos.length} arquivo(s) com "carddass" no nome que não casam com carta nenhuma:\n    ${estranhos.join("\n    ")}`);
  console.log(`  faltam ${faltam.length} de ${cartas.length}: lista em ${html}`);
  if (feitos) console.log("  agora: node scripts/sync-pokemon-carddass.mjs --no-fetch");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
