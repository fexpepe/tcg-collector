// Registro das páginas de ferramentas (2026-10-01): os endereços em inglês
// (/tools, /condition, /centering) e o Centering Tool v2 em página própria
// (docs/PLANO-CENTERING-V2.md §7.6, docs/FERRAMENTAS.md).
//
// Quase tudo aqui falha CALADO se esquecido: página fora do SHELL_ASSETS abre
// sem modo offline; pacote de i18n fora dele ABORTA o deploy (split-i18n), e o
// CI não roda o split-i18n com --write; link pro endereço antigo vira um 301 a
// mais em cada clique; rodapé fora do FOOTER_PAGES some sem erro; e o
// podeRecarregarSozinho sem a guarda do data-ocupado joga fora a foto que só
// existe em memória a cada deploy da main.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (rel) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const existe = (rel) => existsSync(join(RAIZ, rel));

const PAGINAS = ["tools", "condition", "centering"];

test("as páginas novas existem e as antigas sumiram", () => {
  for (const p of PAGINAS) assert.ok(existe(`${p}.html`), `${p}.html não existe`);
  assert.ok(!existe("ferramentas.html"), "ferramentas.html devia ter virado tools.html");
  assert.ok(!existe("condicao.html"), "condicao.html devia ter virado condition.html");
});

test("os endereços antigos respondem 301 pro novo", () => {
  const r = ler("_redirects");
  assert.match(r, /^\/ferramentas\s+\/tools\s+301\s*$/m);
  assert.match(r, /^\/condicao\s+\/condition\s+301\s*$/m);
});

test("canonical, og:url e data-active-page em inglês", (t) => {
  for (const p of PAGINAS) {
    if (!existe(`${p}.html`)) { t.diagnostic(`${p}.html ainda não existe`); continue; }
    const html = ler(`${p}.html`);
    assert.ok(html.includes(`<link rel="canonical" href="https://sleevu.app/${p}">`), `${p}: canonical`);
    assert.ok(html.includes(`<meta property="og:url" content="https://sleevu.app/${p}">`), `${p}: og:url`);
    assert.ok(html.includes(`data-active-page="${p}"`), `${p}: data-active-page`);
  }
});

test("SHELL_ASSETS: as páginas, a ferramenta inteira e o pacote de i18n dela", () => {
  const sw = ler("sw.js");
  const lista = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(lista, "sumiu o SHELL_ASSETS do sw.js");
  const itens = new Set([...lista[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  for (const f of ["tools.html", "condition.html", "centering.html", "src/centering.js",
    "src/centering-core.js", "src/centering-graders.js", "src/i18n-centering.js"]) {
    assert.ok(itens.has(f), `${f} fora do SHELL_ASSETS`);
  }
  assert.ok(!itens.has("ferramentas.html") && !itens.has("condicao.html"), "página antiga no SHELL_ASSETS");
  // Todo pacote de i18n tem de estar lá: sem ele o split-i18n --write aborta
  // o deploy (e o CI não roda o --write). Mesma regra do split-i18n.mjs:38.
  const pacotes = readdirSync(join(RAIZ, "src")).filter((f) => /^i18n.*\.js$/.test(f) && !/\.(pt|en|es)\.js$/.test(f));
  for (const f of pacotes) assert.ok(itens.has(`src/${f}`), `src/${f} fora do SHELL_ASSETS (o deploy aborta)`);
});

test("FOOTER_PAGES tem as três (o rodapé olha o último segmento do caminho)", () => {
  const m = ler("src/shared.js").match(/const FOOTER_PAGES = (\[[^\]]*\]);/);
  assert.ok(m, "sumiu o FOOTER_PAGES");
  const lista = JSON.parse(m[1]);
  for (const p of PAGINAS) assert.ok(lista.includes(p), `${p} fora do FOOTER_PAGES`);
  assert.ok(!lista.includes("ferramentas") && !lista.includes("condicao"));
});

test("menu Mais: o clique vai pra /tools e o Centering Tool é link, não modal", () => {
  const src = ler("src/shared.js");
  assert.match(src, /mega\("tools", "nav\.more"/);
  assert.ok(src.includes('link("centering", "ctr.title", "centering")'), "item do Centering Tool no Mais");
  assert.ok(src.includes('link("condition", "nav.condicao", "condition")'), "item do Guia de condição no Mais");
  const m = src.match(/const moreActive = (\[[^\]]*\])\.includes/);
  const ativos = JSON.parse(m[1]);
  for (const p of PAGINAS) assert.ok(ativos.includes(p), `${p} não acende o Mais`);
  // HUB: link comum pra página, sem depender do script do modal da v1.
  const dash = ler("src/dashboard.js");
  assert.ok(dash.includes('{ href: "centering", icon: "centering", key: "ctr.title"'));
  assert.ok(!/TCGCentering/.test(dash), "o HUB não pode depender do window.TCGCentering");
});

test("nenhum link pro endereço antigo sobrou em HTML/JS", () => {
  // id="condicao" no tools.html é a âncora ANTIGA de propósito (chega pelo
  // 301 com o fragmento), não um link: fica de fora.
  const ANTIGO = /(?<!id=)["'`]\/?(ferramentas|condicao)(\.html)?([#?][^"'`]*)?["'`]/;
  const arquivos = [
    ...readdirSync(RAIZ).filter((f) => f.endsWith(".html")),
    ...readdirSync(join(RAIZ, "src")).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`),
    "sw.js",
    ...readdirSync(join(RAIZ, "functions"), { recursive: true })
      .map((f) => String(f).replace(/\\/g, "/")).filter((f) => f.endsWith(".js")).map((f) => `functions/${f}`)
  ];
  const sobras = [];
  for (const f of arquivos) {
    ler(f).split("\n").forEach((linha, i) => { if (ANTIGO.test(linha)) sobras.push(`${f}:${i + 1}: ${linha.trim()}`); });
  }
  assert.deepEqual(sobras, [], `links antigos:\n${sobras.join("\n")}`);
});

// /ferramentas#medir era o "Medir centralização" do menu Mais da v1 (abria o
// modal), e #condicao/#centralizacao os ids dos cartões. O 301 leva o
// fragmento junto: sem a âncora, a pessoa caía no topo do índice.
test("tools.html: as âncoras antigas (#medir, #centralizacao, #condicao) moram no cartão certo", () => {
  const html = ler("tools.html");
  const cartao = (id) => {
    const i = html.indexOf(`<article class="fer-card fer-tool" id="${id}">`);
    assert.ok(i >= 0, `cartão #${id} sumiu`);
    return html.slice(i, html.indexOf("</article>", i));
  };
  const cen = cartao("centering"), cond = cartao("condition");
  for (const a of ["medir", "centralizacao"]) assert.match(cen, new RegExp(`<div class="fer-tool-b">[\\s\\S]*<span id="${a}"></span>`), `#${a} fora do .fer-tool-b do Centering Tool`);
  assert.match(cond, /<div class="fer-tool-b">[\s\S]*<span id="condicao"><\/span>/, "#condicao fora do .fer-tool-b do Guia de condição");
  // nunca filho direto do <article> nem do .fer-grid (os dois são grid)
  assert.ok(!/<article[^>]*>\s*<span id=/.test(html) && !/<section class="fer-grid">\s*<span id=/.test(html));
});

test("só o centering.html carrega o src/centering.js (o modal da v1 saiu)", () => {
  const com = readdirSync(RAIZ).filter((f) => f.endsWith(".html"))
    .filter((f) => /<script[^>]*\ssrc="\/?src\/centering\.js"/.test(ler(f)));
  assert.deepEqual(com.filter((f) => f !== "centering.html"), []);
});

test("centering.html: par theme+game e scripts na ordem da §6.1", (t) => {
  if (!existe("centering.html")) { t.skip("centering.html ainda não existe"); return; }
  const html = ler("centering.html");
  // O par exato que o bundle-boot funde (scripts/bundle-boot.mjs, PAR): só
  // espaço ou comentário entre as duas tags.
  const par = html.match(/<script src="src\/theme\.js"><\/script>([\s\S]*?)<script src="src\/game\.js"( data-catalog="[^"]*")?><\/script>/);
  assert.ok(par, "sem o par theme.js+game.js no formato do bundle-boot");
  assert.match(par[1], /^(?:\s|<!--[\s\S]*?-->)*$/, "algo além de comentário entre theme.js e game.js");
  const ordem = ["i18n.js", "i18n-centering.js", "shared.js", "centering-graders.js", "centering-core.js", "centering.js"];
  const pos = ordem.map((f) => {
    const m = html.match(new RegExp(`<script[^>]*\\ssrc="src/${f.replace(/[.-]/g, "\\$&")}"`));
    assert.ok(m, `centering.html não carrega src/${f}`);
    return m.index;
  });
  assert.ok(pos[0] > html.indexOf('src="src/game.js"'), "i18n.js antes do par de boot");
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, `ordem errada: ${ordem.join(" → ")}`);
});

test("centering.html: pública, fora da vitrine e na área certa do split-css", async (t) => {
  const { AREAS } = await import(pathToFileURL(join(RAIZ, "scripts/lib/css-areas.mjs")).href);
  const area = (n) => AREAS.find((a) => a.nome === n);
  assert.deepEqual(area("medidor").paginas, ["centering.html"]);
  for (const p of ["tools.html", "condition.html", "sleeves.html", "centering.html"]) {
    assert.ok(area("ferramentas").paginas.includes(p), `${p} fora da área ferramentas`);
  }
  assert.ok(/"centering\.html"/.test(ler("scripts/check.mjs")), "centering.html fora do SEM_VITRINE");
  const auth = JSON.parse(ler("src/shared.js").match(/const AUTH_PAGES = (\[[^\]]*\]);/)[1]);
  assert.ok(!auth.includes("centering"), "o Centering Tool é público");
  if (!existe("centering.html")) { t.diagnostic("centering.html ainda não existe"); return; }
  assert.ok(!/noindex/.test(ler("centering.html")), "o Centering Tool é indexável");
});

// ── Guarda de recarga (§5.3) ─────────────────────────────────────────────
// A função é tirada do shared.js e rodada com um document de mentira: o que
// importa é a regra, não o resto do núcleo.
function podeRecarregar({ ocupado = false, carregando = 0 } = {}) {
  const src = ler("src/shared.js");
  const m = src.match(/function podeRecarregarSozinho\(\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(m, "sumiu o podeRecarregarSozinho do shared.js");
  const attrs = new Set(ocupado ? ["data-ocupado"] : []);
  const documentFalso = {
    activeElement: null,
    querySelectorAll: () => [],
    documentElement: { hasAttribute: (n) => attrs.has(n) }
  };
  const fn = new Function("document", "pageLoadingCount", `${m[0]}\nreturn podeRecarregarSozinho;`)(documentFalso, carregando);
  return fn();
}

test("versão nova não recarrega a página com data-ocupado (a foto do Centering Tool)", () => {
  assert.equal(podeRecarregar(), true, "sem nada em curso, recarrega");
  assert.equal(podeRecarregar({ ocupado: true }), false, "com data-ocupado no <html>, espera");
  assert.equal(podeRecarregar({ carregando: 1 }), false, "com sincronização em curso, espera");
});

// ── Lembrete de 180 dias das tabelas (§4.8) ──────────────────────────────
test("lembrete: tabela conferida há mais de 180 dias vira linha própria, nunca erro", async () => {
  const { lembreteTabelas } = await import(pathToFileURL(join(RAIZ, "scripts/lib/lembrete-centering.mjs")).href);
  const hoje = new Date("2026-10-01T12:00:00Z");
  assert.equal(lembreteTabelas("", hoje), null, "sem arquivo, sem lembrete");
  const dados = `
    { code: "psa", nome: "PSA", conferido: "2026-10-01", confianca: "alta" },
    { code: "bgs", nome: "BGS", conferido: "2026-01-01", confianca: "media" },
    { "code": "tag", "conferido": '2025-12-01' }`;
  const linha = lembreteTabelas(dados, hoje);
  assert.ok(linha && linha.startsWith("⚠ tabelas de centralização conferidas há 304 dias: reconferir"), linha);
  assert.match(linha, /\(bgs, tag;/);
  assert.ok(!/psa/.test(linha), "a conferida hoje não entra");
  assert.equal(lembreteTabelas(`{ code: "psa", conferido: "2026-04-05" }`, hoje), null, "179 dias ainda vale");
  // O check.mjs imprime a linha sempre e anota no Actions, sem virar erro.
  const check = ler("scripts/check.mjs");
  assert.ok(check.includes("lembrete-centering.mjs") && check.includes("::warning file=src/centering-graders.js::"));
  assert.ok(!/fail\([^)]*lembreteCentering/.test(check), "o lembrete não pode falhar o CI");
});
