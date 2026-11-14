// Poda do deploy: tira da árvore do build o que o site não pede, antes do
// passo "Conta arquivos" do deploy.yml (o Pages recusa mais de 20.000
// arquivos; a guarda falha acima de 19.000). O que sai e por quê está em
// scripts/lib/poda-deploy.mjs:
//   1. os arquivos crus do modo dev de cada jogo (o deploy só liga os gerados);
//   2. os logos de set que nenhum arquivo de texto da árvore cita.
//
// Roda na raiz do build (cwd), DEPOIS de tudo que lê data/ (prerender,
// split-pricing, hash-assets...) e ANTES do "Remove arquivos", que apaga
// scripts/. Só mexe na árvore do runner: o repositório não perde nada, e o
// cache do build rápido já foi salvo lá atrás com os arquivos inteiros.
//
//   node scripts/poda-deploy.mjs [--dry-run]
//
// --dry-run conta e lista sem apagar (pra medir no checkout local).
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crusDoModoDev, juntaReferencias, logosSemUso, novasReferencias } from "./lib/poda-deploy.mjs";

const RAIZ = process.cwd();
const ENSAIO = process.argv.includes("--dry-run");
// O que não é do site e pesa na varredura (o git, as dependências e o cache
// das fontes, que o "Remove arquivos" apaga de qualquer jeito).
const FORA_DA_VARREDURA = new Set([".git", "node_modules", ".cache"]);
const TEXTO = /\.(?:js|mjs|json|html|css|xml|txt|webmanifest)$/i;
const IMAGEM = /\.(?:svg|png|webp|jpe?g|gif|avif)$/i;

const rel = (p) => relative(RAIZ, p).split(sep).join("/");
const apaga = (p) => { if (!ENSAIO) rmSync(p, { force: true }); };

// ── 1. Crus do modo dev ─────────────────────────────────────────────────────
let crus = 0;
const jogosComCru = [];
const pastasDeDados = [join(RAIZ, "data")];
try {
  for (const nome of readdirSync(join(RAIZ, "data"))) {
    const p = join(RAIZ, "data", nome);
    if (!FORA_DA_VARREDURA.has(nome) && statSync(p).isDirectory()) pastasDeDados.push(p);
  }
} catch { /* sem data/: nada a podar */ }
for (const pasta of pastasDeDados) {
  let nomes;
  try { nomes = readdirSync(pasta).filter((n) => statSync(join(pasta, n)).isFile()); } catch { continue; }
  const sai = crusDoModoDev(nomes);
  if (!sai.length) continue;
  for (const n of sai) apaga(join(pasta, n));
  crus += sai.length;
  jogosComCru.push(rel(pasta) || "data");
}

// ── 2. Logos de set sem referência ──────────────────────────────────────────
const textos = [];
const logos = [];
(function anda(dir, dentroDeLogos) {
  let nomes;
  try { nomes = readdirSync(dir); } catch { return; }
  for (const nome of nomes) {
    if (FORA_DA_VARREDURA.has(nome)) continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) anda(p, dentroDeLogos || nome === "set-logos");
    else if (dentroDeLogos && IMAGEM.test(nome) && rel(p).startsWith("data/")) logos.push(rel(p));
    else if (TEXTO.test(nome)) textos.push(p);
  }
})(RAIZ, false);

const refs = novasReferencias();
let bytes = 0;
for (const p of textos) {
  const t = readFileSync(p, "utf8");
  bytes += t.length;
  juntaReferencias(t, refs);
}
const { sai: logosQueSaem, resumo } = logosSemUso(logos, refs);
for (const caminho of logosQueSaem) apaga(join(RAIZ, caminho));

// ── Relatório ───────────────────────────────────────────────────────────────
const porPasta = resumo.filter((r) => !r.segurou).map((r) => `${r.pasta} ${r.sai}/${r.total}`).join(" · ");
const seguradas = resumo.filter((r) => r.segurou).map((r) => `${r.pasta} (${r.total})`).join(" · ");
console.log(`poda-deploy${ENSAIO ? " (ensaio, nada apagado)" : ""}: ${crus} arquivo(s) crus do modo dev em ${jogosComCru.length} pasta(s) de jogo`
  + ` + ${logosQueSaem.length} logo(s) de set sem referência de ${logos.length}`
  + ` (varridos ${textos.length} arquivos de texto, ${(bytes / 1e6).toFixed(0)} MB) = −${crus + logosQueSaem.length} arquivos.`);
if (porPasta) console.log(`  logos por pasta: ${porPasta}`);
if (seguradas) console.log(`::warning::poda-deploy: pasta(s) de logo que perderiam TODOS os arquivos ficaram inteiras (o caminho no catálogo mudou de formato?): ${seguradas}`);
if (ENSAIO && process.argv.includes("--lista")) for (const c of logosQueSaem) console.log(`  - ${c}`);
