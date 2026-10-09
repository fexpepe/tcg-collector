// Monta o pacote web do app (mobile/www) a partir do código do site.
//   cd mobile && npm run app:web          (o que o CI, o Codemagic e a porta
//                                          do live update rodam)
//   node scripts/app-web.mjs [--origem http://localhost:8790] [--saida DIR] [--sem-rede]
//
// --origem: pra onde vão os pedidos ao servidor (padrão https://sleevu.app).
//           http só em localhost — é pra testar o pacote contra um servidor
//           local; build de loja e live update usam sempre o padrão.
// --sem-rede: não consulta o espelho de imagens (lista vazia = imagens da
//           origem, como o site sem espelho). Pros testes.
//
// O que entra, o que fica de fora e o que muda em cada arquivo — e o porquê —
// estão em scripts/lib/app-web.mjs. Aqui é só a cópia. Nunca mexe no site: lê
// da raiz do repositório e escreve só na saída.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  ORIGEM_PADRAO, ARQUIVOS_DA_RAIZ, paginaDoApp, assetDoApp,
  transformaGameJs, transformaHtml, transformaCss, preenchePonte, supabaseDoSite, confereOrigem
} from "./lib/app-web.mjs";
import { ESPELHO, ESQUEMA_ESPELHO, ORDEM } from "./lib/img-mirror.mjs";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const PONTE = join(RAIZ, "mobile/web/app-nativo.js");

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// Hosts de imagem já espelhados por completo no R2 — a mesma pergunta do
// scripts/apply-img-mirror.mjs no deploy. Sem rede ou espelho fora do ar =
// lista vazia = toda imagem vem da origem (o site igual ao de sempre).
async function hostsDoEspelho() {
  try {
    const r = await fetch(`${ESPELHO}_index/status.json`, { signal: AbortSignal.timeout(15000), headers: { "cache-control": "no-cache" } });
    if (!r.ok) return [];
    const j = await r.json();
    return ORDEM.filter((h) => j && j.hosts && j.hosts[h] && j.hosts[h].completo && j.hosts[h].esquema === ESQUEMA_ESPELHO);
  } catch { return []; }
}

function copiaPasta(de, para, filtro, base = de) {
  let n = 0;
  for (const nome of readdirSync(de)) {
    const origem = join(de, nome);
    const rel = relative(base, origem).split("\\").join("/");
    if (statSync(origem).isDirectory()) { n += copiaPasta(origem, join(para, nome), filtro, base); continue; }
    if (!filtro(rel)) continue;
    mkdirSync(para, { recursive: true });
    copyFileSync(origem, join(para, nome));
    n++;
  }
  return n;
}

export async function montar({ saida = join(RAIZ, "mobile/www"), origem = ORIGEM_PADRAO, semRede = false } = {}) {
  origem = confereOrigem(origem);
  rmSync(saida, { recursive: true, force: true });
  mkdirSync(join(saida, "src"), { recursive: true });

  // De onde saiu este pacote: vai no app-build.json e no <meta name="sleevu-build">
  // de cada página (o `v` do rastreio de erro).
  let commit = "";
  try { commit = execSync("git rev-parse --short=8 HEAD", { cwd: RAIZ, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* sem git */ }

  // Páginas: os .html da raiz, menos os que são só do navegador.
  const paginas = readdirSync(RAIZ).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter(paginaDoApp).sort();
  if (!paginas.includes("index")) throw new Error("app-web: sem index.html na raiz — é ele que o Capacitor serve primeiro");
  for (const p of paginas) {
    writeFileSync(join(saida, `${p}.html`), transformaHtml(readFileSync(join(RAIZ, `${p}.html`), "utf8"), { pagina: p, origem, build: `app-${commit || "dev"}` }));
  }

  // Código: src/*.js como está no repositório (o mesmo modo "sem build" do
  // desenvolvimento local), com o game.js no modo de produção.
  const js = readdirSync(join(RAIZ, "src")).filter((f) => f.endsWith(".js"));
  for (const f of js) copyFileSync(join(RAIZ, "src", f), join(saida, "src", f));
  const hostsEspelho = semRede ? [] : await hostsDoEspelho();
  const game = transformaGameJs(readFileSync(join(RAIZ, "src/game.js"), "utf8"), { origem, hostsEspelho });
  writeFileSync(join(saida, "src/game.js"), game.texto);
  const supabase = supabaseDoSite(readFileSync(join(RAIZ, "src/shared.js"), "utf8"));
  writeFileSync(join(saida, "src/app-nativo.js"), preenchePonte(readFileSync(PONTE, "utf8"), { origem, paginas, supabase }));

  for (const f of ARQUIVOS_DA_RAIZ) {
    if (!existsSync(join(RAIZ, f))) throw new Error(`app-web: ${f} sumiu da raiz`);
    copyFileSync(join(RAIZ, f), join(saida, f));
  }
  writeFileSync(join(saida, "styles.css"), transformaCss(readFileSync(join(RAIZ, "styles.css"), "utf8")));
  const assets = copiaPasta(join(RAIZ, "assets"), join(saida, "assets"), assetDoApp);

  const resumo = { origem, commit, montadoEm: new Date().toISOString(), paginas: paginas.length, js: js.length + 1, assets, jogos: game.jogos, hostsEspelho };
  writeFileSync(join(saida, "app-build.json"), JSON.stringify(resumo, null, 2) + "\n");
  return resumo;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const r = await montar({
      saida: arg("--saida") || undefined,
      origem: arg("--origem") || ORIGEM_PADRAO,
      semRede: process.argv.includes("--sem-rede")
    });
    console.log(`app-web: ${r.paginas} páginas, ${r.js} JS, ${r.assets} assets, ${r.jogos} jogos -> ${r.origem}` +
      (r.hostsEspelho.length ? ` (espelho: ${r.hostsEspelho.join(", ")})` : " (sem espelho de imagens)"));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
