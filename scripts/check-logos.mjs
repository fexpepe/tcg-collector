// Confere logos de jogo e de set contra o padrão (docs/LOGOS.md; os números
// estão em scripts/lib/logo-padrao.mjs).
//
//   node scripts/check-logos.mjs --base <commit>   só os logos que mudaram desde
//                                                  <commit>; sai 1 se algum está
//                                                  fora do padrão sem exceção (CI)
//   node scripts/check-logos.mjs <arquivo>...      só estes; sai 1 se fora
//   node scripts/check-logos.mjs --todos           relatório de TODOS (sai 0)
//     --json                                       saída em JSON
//
// Por que só o que mudou, no CI: o build completo espelha logo de set sozinho
// (Pokémon, Magic, FAB, Star Wars) e commita com [skip ci]. Conferir tudo em
// toda PR culparia a PR errada pelo arquivo que o espelho trouxe. O --todos
// mostra a situação geral.
//
// Sem dependência: formato, tamanho, alfa, peso e nitidez saem do cabeçalho.
// Com o sharp (SHARP_DIR=<…>/node_modules/sharp, como no caçador), confere
// também os pixels: margem dentro do arquivo (recorte), véu de alfa no fundo e
// fundo transparente de verdade. O CI instala o sharp quando algum logo mudou.
//
// Exceção consciente (a fonte não existe maior, fundo branco decidido...) vai
// em scripts/data/logos-excecoes.json: { "<caminho>": { "regras": [...],
// "motivo": "..." } }. Ela cala SÓ aquelas regras daquele arquivo. Exceção que
// não precisa mais (a regra passou) é erro também: a lista é o registro do
// que está fora do padrão e por quê, não pode mentir.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tipoDoArquivo, lerCabecalho, avalia, medePixels, densidades, padraoDo } from "./lib/logo-padrao.mjs";
import { JOGOS_URL } from "../functions/_lib/jogos.js";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const TODOS = args.includes("--todos");
const JSON_SAIDA = args.includes("--json");
const BASE = opcao("--base");
const avulsos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");

const VINTAGE = new Set(JOGOS_URL.filter((j) => j.vintage && j.logo).map((j) => j.logo));
const EXCECOES_ARQ = join(RAIZ, "scripts/data/logos-excecoes.json");
const EXCECOES = existsSync(EXCECOES_ARQ) ? JSON.parse(readFileSync(EXCECOES_ARQ, "utf8")) : {};

let sharp = null;
if (process.env.SHARP_DIR) sharp = (await import(pathToFileURL(join(process.env.SHARP_DIR, "lib", "index.js")).href)).default;

// ── Quais arquivos ──────────────────────────────────────────────────────────
function todosOsLogos() {
  const out = [];
  const anda = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) anda(p);
      else {
        const rel = relative(RAIZ, p).replace(/\\/g, "/");
        if (tipoDoArquivo(rel)) out.push(rel);
      }
    }
  };
  anda(join(RAIZ, "assets/games"));
  anda(join(RAIZ, "data/set-logos"));
  for (const d of readdirSync(join(RAIZ, "data"))) {
    const p = join(RAIZ, "data", d, "set-logos");
    if (d !== "set-logos" && existsSync(p)) anda(p);
  }
  return out.sort();
}

function mudaramDesde(base) {
  const saida = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", base, "HEAD"], { cwd: RAIZ, encoding: "utf8" });
  return saida.split("\n").map((s) => s.trim()).filter((p) => p && tipoDoArquivo(p)).sort();
}

const arquivos = BASE ? mudaramDesde(BASE) : avulsos.length ? avulsos.map((a) => a.replace(/\\/g, "/")) : todosOsLogos();
const modo = BASE ? `mudaram desde ${BASE.slice(0, 12)}` : avulsos.length ? "arquivos pedidos" : "todos";
if (!arquivos.length) {
  console.log(`Logos (${modo}): nenhum logo mudou.`);
  process.exit(0);
}

// ── Confere ─────────────────────────────────────────────────────────────────
const resultados = [];
for (const rel of arquivos) {
  const tipo = tipoDoArquivo(rel);
  const caminho = join(RAIZ, rel);
  if (!tipo) { resultados.push({ rel, erro: "não é um caminho de logo (assets/games/game_*, assets/games/set_*, data/**/set-logos/)" }); continue; }
  if (!existsSync(caminho)) { resultados.push({ rel, erro: "arquivo não existe" }); continue; }
  const buf = readFileSync(caminho);
  const cabecalho = lerCabecalho(buf);
  const vintage = VINTAGE.has(rel);
  let pixels = null;
  if (sharp && cabecalho.formato !== "svg" && cabecalho.formato !== "?") {
    try {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      pixels = medePixels(data, info.width, info.height);
    } catch (e) { resultados.push({ rel, erro: `sharp não leu: ${e.message}` }); continue; }
  }
  const svgTexto = cabecalho.formato === "svg" ? buf.toString("utf8") : null;
  const problemas = avalia({ tipo, vintage, bytes: buf.length, cabecalho, pixels, svgTexto });
  const exc = EXCECOES[rel];
  const calados = new Set(exc ? exc.regras : []);
  const abertos = problemas.filter((p) => p.nivel === "erro" && !calados.has(p.regra));
  const sobrando = exc ? exc.regras.filter((r) => !problemas.some((p) => p.regra === r) && (pixels || !["recorte", "veu"].includes(r))) : [];
  const pior = cabecalho.largura && cabecalho.altura ? densidades(tipo, cabecalho.largura, cabecalho.altura, { vintage })[0] : null;
  resultados.push({
    rel, tipo: vintage ? "jogo vintage" : tipo,
    tamanho: cabecalho.largura ? `${cabecalho.largura}×${cabecalho.altura}` : "vetor",
    kb: +(buf.length / 1024).toFixed(1), formato: cabecalho.formato, perda: cabecalho.perda,
    teto: padraoDo(tipo, { vintage }).teto.join("×"),
    piorDensidade: pior ? +pior.densidade.toFixed(2) : null, piorLugar: pior ? pior.lugar : null,
    problemas, abertos, excecao: exc || null, sobrando
  });
}

const rotulo = (r, p) => (p.nivel === "aviso" ? "aviso:" : r.abertos.includes(p) ? "ERRO:" : "(exceção)");
const falhas = resultados.filter((r) => r.erro || r.abertos.length || r.sobrando.length);

if (JSON_SAIDA) {
  console.log(JSON.stringify({ modo, pixels: Boolean(sharp), resultados }, null, 1));
} else if (TODOS) {
  // Relatório geral: por pasta e por regra, e a lista de quem está fora.
  const grupo = (rel) => rel.replace(/\/[^/]+$/, "");
  const porGrupo = {};
  for (const r of resultados) {
    const g = (porGrupo[grupo(r.rel)] ||= { n: 0, ok: 0, kb: 0, regras: {} });
    g.n++; g.kb += r.kb || 0;
    if (!r.erro && !r.problemas.some((p) => p.nivel === "erro")) g.ok++;
    for (const p of r.problemas || []) g.regras[p.regra] = (g.regras[p.regra] || 0) + 1;
  }
  console.log(`Logos: ${resultados.length} arquivos (${modo})${sharp ? "" : " — sem SHARP_DIR: recorte e véu não conferidos"}\n`);
  for (const [g, v] of Object.entries(porGrupo)) {
    const regras = Object.entries(v.regras).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ");
    console.log(`${g.padEnd(30)} ${String(v.ok).padStart(4)}/${String(v.n).padEnd(4)} no padrão  ${(v.kb / 1024).toFixed(1).padStart(5)} MB  ${regras}`);
  }
  console.log("");
  for (const r of resultados.filter((x) => x.erro || x.problemas.length)) {
    if (r.erro) { console.log(`✗ ${r.rel}: ${r.erro}`); continue; }
    const marca = r.abertos.length ? "✗" : "~"; // ~ = só aviso ou exceção
    console.log(`${marca} ${r.rel} (${r.tipo}, ${r.tamanho}, ${r.kb} KB)`);
    for (const p of r.problemas) console.log(`    ${rotulo(r, p)} ${p.regra}: ${p.msg}`);
  }
} else {
  console.log(`Logos (${modo}): ${resultados.length} arquivo(s)${sharp ? "" : " — sem SHARP_DIR: recorte e véu não conferidos"}`);
  for (const r of resultados) {
    if (r.erro) { console.log(`✗ ${r.rel}: ${r.erro}`); continue; }
    const ok = !r.abertos.length && !r.sobrando.length;
    console.log(`${ok ? "✓" : "✗"} ${r.rel} (${r.tipo}, ${r.tamanho}, ${r.kb} KB, ${r.formato} ${r.perda}; pior lugar ${r.piorDensidade ?? "—"}× em ${r.piorLugar ?? "—"})`);
    for (const p of r.problemas) console.log(`    ${rotulo(r, p)} ${p.regra}: ${p.msg}`);
    if (r.excecao && r.problemas.some((p) => p.nivel === "erro" && !r.abertos.includes(p))) console.log(`      motivo da exceção: ${r.excecao.motivo}`);
    for (const s of r.sobrando) console.log(`    - exceção "${s}" não precisa mais: tire do scripts/data/logos-excecoes.json`);
  }
  if (falhas.length) {
    console.log(`\n${falhas.length} logo(s) fora do padrão. Gere no padrão com scripts/normaliza-logo.mjs, ou, se a fonte não existe melhor, registre a exceção com o motivo em scripts/data/logos-excecoes.json (ver docs/LOGOS.md).`);
  }
}

process.exit(!TODOS && falhas.length ? 1 : 0);
