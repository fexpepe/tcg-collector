// Gera um logo (de jogo, de set ou símbolo de set) no padrão do site
// (docs/LOGOS.md): WebP recortado na tinta, sem véu de alfa, encaixado no teto
// do tipo e no menor peso que cabe. Diz em seguida como fica a nitidez em cada
// lugar do site e o que o check-logos acha do arquivo.
//
//   SHARP_DIR=<…>/node_modules/sharp node scripts/normaliza-logo.mjs <fonte> <destino>
//     --tipo jogo|set|simbolo   (padrão: sai do caminho do destino)
//     --vintage                 logo de jogo vintage (tem o "Sobre", teto maior;
//                               sai sozinho do functions/_lib/jogos.js quando o
//                               destino já está lá)
//     --amplia                  amplia fonte menor que o teto (não cria detalhe:
//                               só use com bitmap de traço limpo, e registre)
//
// A fonte pode ser PNG, WebP, JPEG com alfa (não tem), AVIF, TIFF ou SVG (o SVG
// é rasterizado a 600 dpi antes de reduzir). A fonte tem de ter fundo
// transparente: tirar fundo é decisão de arte (chroma, luminância), feita
// antes, à mão — ver os casos no assets/games/README.md.
//
// O sharp fica FORA do repositório (o site não tem package.json), como no
// caçador de logos:
//   mkdir -p /tmp/sharp && cd /tmp/sharp && npm init -y && npm i sharp@0.33.5
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { normaliza, avalia, lerCabecalho, medePixels, densidades, tipoDoArquivo, padraoDo, ALVO_DENSIDADE, PISO_DENSIDADE } from "./lib/logo-padrao.mjs";
import { JOGOS_URL } from "../functions/_lib/jogos.js";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const [fonte, destino] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--tipo");
if (!fonte || !destino) {
  console.error("uso: SHARP_DIR=<…>/node_modules/sharp node scripts/normaliza-logo.mjs <fonte> <destino> [--tipo jogo|set|simbolo] [--vintage] [--amplia]");
  process.exit(2);
}
if (!process.env.SHARP_DIR) {
  console.error("Falta o SHARP_DIR (pasta do pacote sharp, fora do repositório). Ver o cabeçalho deste script.");
  process.exit(2);
}
const sharp = (await import(pathToFileURL(join(process.env.SHARP_DIR, "lib", "index.js")).href)).default;

const relDestino = relative(RAIZ, resolve(destino)).replace(/\\/g, "/");
const tipo = opcao("--tipo") || tipoDoArquivo(relDestino);
if (!["jogo", "set", "simbolo"].includes(tipo)) {
  console.error(`Não sei o tipo de "${relDestino}". Use --tipo jogo|set|simbolo (ou grave em assets/games/game_*.webp, data/<jogo>/set-logos/ ou data/set-logos/symbol/).`);
  process.exit(2);
}
if (!/\.webp$/i.test(destino)) {
  console.error("O destino tem de ser .webp (o padrão é WebP).");
  process.exit(2);
}
const vintage = args.includes("--vintage") || JOGOS_URL.some((j) => j.vintage && j.logo === relDestino);

const r = await normaliza(sharp, readFileSync(fonte), { tipo, vintage, amplia: args.includes("--amplia") });
mkdirSync(dirname(resolve(destino)), { recursive: true });
writeFileSync(destino, r.buf);

const pad = padraoDo(tipo, { vintage });
console.log(`${relDestino}: ${r.largura}×${r.altura}, ${(r.buf.length / 1024).toFixed(1)} KB (${r.modo})`);
console.log(`  fonte ${r.origem.largura}×${r.origem.altura}, recorte ${r.origem.recorte}; teto do tipo ${pad.teto.join("×")} e ${pad.pesoKB} KB${r.ampliado ? "; AMPLIADO (--amplia)" : ""}`);
if (r.limpeza.veu || r.limpeza.manchas) console.log(`  limpeza: ${r.limpeza.veu} px de véu, ${r.limpeza.manchas} mancha(s) solta(s)`);
console.log(`  alternativas: com perda q90 ${(r.alternativa.comPerdaQ90 / 1024).toFixed(1)} KB, sem perda ${(r.alternativa.semPerda / 1024).toFixed(1)} KB`);
console.log("  nitidez por lugar (px do arquivo por px CSS):");
for (const d of densidades(tipo, r.largura, r.altura, { vintage })) {
  const marca = d.densidade >= ALVO_DENSIDADE ? "nítido" : d.densidade >= PISO_DENSIDADE ? "macio" : "BORRADO";
  console.log(`    ${d.densidade.toFixed(2).padStart(5)}×  ${marca.padEnd(7)}  ${d.lugar} (${d.css})`);
}
const { data, info } = await sharp(r.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const problemas = avalia({ tipo, vintage, bytes: r.buf.length, cabecalho: lerCabecalho(r.buf), pixels: medePixels(data, info.width, info.height) });
if (!problemas.length) console.log("  check-logos: no padrão.");
else for (const p of problemas) console.log(`  check-logos ${p.nivel}: ${p.regra} — ${p.msg}`);
if (problemas.some((p) => p.regra === "nitidez")) {
  console.log("  → a fonte é pequena demais: procure uma maior. Se não existe, registre a exceção com o motivo em scripts/data/logos-excecoes.json.");
}
