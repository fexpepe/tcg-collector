// Referência órfã no build: bundle-boot → hash-assets numa raiz de mentira.
//
// O teste existe por causa de 29/09/2026: as páginas pré-renderizadas de SEO
// (set/, card/, artist/) carregam /src/theme.js SOZINHO, e o bundle-boot, que
// só reescreve os HTML da raiz, apagava esse arquivo ao fundi-lo no boot.js.
// Desde 30/08 toda visita a essas páginas — que é onde o Google entrega o
// tráfego — pagava um 404 e abria sem o tema salvo. O hash-assets tinha uma
// guarda de "sobrou nome sem hash", mas ela só enxerga o que ainda está no
// disco; a guarda nova confere pelo DESTINO.
//
// As tags das páginas pré-renderizadas saem do PRÓPRIO template do
// prerender-catalog.mjs: se alguém trocar o script de lá por um que o build
// apaga (o game.js, por exemplo), isto quebra no CI, antes do deploy.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = (nome) => join(raiz, "scripts", nome);

// Tags do <head> que o prerender escreve (sem as interpoladas, ${...}).
const TEMPLATE = readFileSync(script("prerender-catalog.mjs"), "utf8");
const TAGS_DO_PRERENDER = [...new Set([
  ...(TEMPLATE.match(/<script src="[^"$]+"><\/script>/g) || []),
  ...(TEMPLATE.match(/<link rel="stylesheet" href="[^"$]+">/g) || [])
])];

const PAGINA_DA_RAIZ = `<!doctype html>
<html lang="pt-BR"><head>
    <meta charset="utf-8">
    <!-- <script src="src/sumiu.js"></script> tag comentada não é pedida -->
    <script src="src/theme.js"></script>
    <script src="src/game.js" data-catalog="cards"></script>
    <link rel="stylesheet" href="styles.css">
</head><body><script defer src="src/shared.js"></script></body></html>
`;

const preRenderizada = (cabeca) => `<!doctype html>
<html lang="pt-BR"><head>
    <meta charset="utf-8">
    <script type="application/ld+json">{"@type":"CollectionPage"}</script>
    ${cabeca}
</head><body><main></main></body></html>
`;

// Raiz mínima com o que os dois scripts leem: páginas, src/, CSS e o sw.js
// (o bundle-boot troca o par no SHELL_ASSETS; o hash-assets exige o
// SHELL_CACHE e o HASHED_ASSETS virado).
function montaRaiz(extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-refs-"));
  const arquivos = {
    "index.html": PAGINA_DA_RAIZ,
    "src/theme.js": "(function () { document.documentElement.setAttribute(\"data-theme\", \"light\"); })();\n",
    "src/game.js": "(function () { window.SLEEVU = { game: \"pokemon\" }; })();\n",
    "src/shared.js": "window.TCGShared = {};\n",
    "styles.css": "body { color: #111; }\n",
    "sw.js": 'const SHELL_CACHE = "sleevu-shell-v1";\nconst HASHED_ASSETS = true;\n'
      + 'const SHELL_ASSETS = ["./", "index.html", "styles.css", "src/theme.js", "src/game.js", "src/shared.js"];\n',
    "set/surging-sparks.html": preRenderizada(TAGS_DO_PRERENDER.join("\n    ")),
    "card/umbreon-ex-161.html": preRenderizada(TAGS_DO_PRERENDER.join("\n    ")),
    "artist/mitsuhiro-arita.html": preRenderizada(TAGS_DO_PRERENDER.join("\n    ")),
    ...extras
  };
  for (const [nome, corpo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(dir, nome)), { recursive: true });
    writeFileSync(join(dir, nome), corpo, "utf8");
  }
  return dir;
}

function roda(nome, dir) {
  try {
    return { ok: true, saida: execFileSync(process.execPath, [script(nome)], { cwd: dir, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { ok: false, saida: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

const srcDasTags = (html) => [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);

test("o template do prerender carrega o theme.js (e é daqui que as tags do teste saem)", () => {
  // Se o formato das tags mudar, o teste tem de reclamar — e não passar vazio.
  assert.ok(TAGS_DO_PRERENDER.includes('<script src="/src/theme.js"></script>'),
    `tags achadas no prerender-catalog.mjs: ${TAGS_DO_PRERENDER.join(" | ") || "(nenhuma)"}`);
});

test("depois do build, a página pré-renderizada aponta pra um theme que EXISTE", () => {
  const dir = montaRaiz({
    // <base href="/"> (collection.html e 404.html usam): o relativo resolve na raiz.
    "sub/com-base.html": `<!doctype html><html><head><base href="/"><script src="src/theme.js"></script></head></html>\n`
  });
  try {
    const boot = roda("bundle-boot.mjs", dir);
    assert.equal(boot.ok, true, boot.saida);
    assert.equal(existsSync(join(dir, "src/theme.js")), true, "o bundle-boot não pode apagar o theme.js: as pré-renderizadas o usam");
    assert.equal(existsSync(join(dir, "src/game.js")), false, "o game.js foi fundido no boot.js e sai");

    const hash = roda("hash-assets.mjs", dir);
    assert.equal(hash.ok, true, hash.saida);

    for (const pagina of ["set/surging-sparks.html", "card/umbreon-ex-161.html", "artist/mitsuhiro-arita.html"]) {
      const srcs = srcDasTags(readFileSync(join(dir, pagina), "utf8"));
      assert.ok(srcs.length, `${pagina} sem <script src>`);
      for (const src of srcs) {
        assert.match(src, /^\/src\/theme\.[0-9a-f]{8}\.js$/, `${pagina} devia pedir o theme versionado`);
        assert.equal(existsSync(join(dir, src)), true, `${pagina} pede ${src}, que não existe no build`);
      }
    }
    const bootDaRaiz = srcDasTags(readFileSync(join(dir, "index.html"), "utf8")).find((s) => s.includes("/boot."));
    assert.match(bootDaRaiz || "", /^src\/boot\.[0-9a-f]{8}\.js$/);
    assert.equal(existsSync(join(dir, bootDaRaiz)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arquivo apagado por um passo anterior reprova o build (o bug de 30/08)", () => {
  const dir = montaRaiz();
  try {
    assert.equal(roda("bundle-boot.mjs", dir).ok, true);
    unlinkSync(join(dir, "src/theme.js")); // o que o bundle-boot fazia antes
    const r = roda("hash-assets.mjs", dir);
    assert.equal(r.ok, false, "o hash-assets devia reprovar a referência órfã");
    assert.match(r.saida, /\/src\/theme\.js — pedido por 3 arquivo\(s\)/);
    assert.match(r.saida, /set\/ 1/);
    assert.match(r.saida, /card\/ 1/);
    assert.match(r.saida, /artist\/ 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("caminho relativo dentro de subpasta resolve como o navegador (e reprova)", () => {
  // Colar na pré-renderizada a tag de uma página da raiz ("src/…", sem a barra)
  // vira /set/src/… — 404, mesmo com o arquivo existindo na raiz.
  const dir = montaRaiz({ "set/relativa.html": preRenderizada('<script src="src/theme.js"></script>') });
  try {
    assert.equal(roda("bundle-boot.mjs", dir).ok, true);
    const r = roda("hash-assets.mjs", dir);
    assert.equal(r.ok, false, "src/theme.js relativo dentro de set/ devia reprovar");
    assert.match(r.saida, /\/set\/src\/theme\.[0-9a-f]{8}\.js — pedido por 1 arquivo\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("precache do sw.js apontando pra arquivo que não existe reprova", () => {
  // O install do SW usa allSettled: sem esta conferência, a falha é calada.
  const dir = montaRaiz({
    "sw.js": 'const SHELL_CACHE = "sleevu-shell-v1";\nconst HASHED_ASSETS = true;\n'
      + 'const SHELL_ASSETS = ["./", "styles.css", "src/theme.js", "src/game.js", "src/shared.js", "src/sumiu.js"];\n'
  });
  try {
    assert.equal(roda("bundle-boot.mjs", dir).ok, true);
    const r = roda("hash-assets.mjs", dir);
    assert.equal(r.ok, false, "o hash-assets devia reprovar o precache órfão");
    assert.match(r.saida, /\/src\/sumiu\.js — pedido por 1 arquivo\(s\) \(raiz 1\); ex\.: sw\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Function que importa arquivo do src/ sai com o nome com hash (o blog importa o renderizador)", () => {
  // functions/blog/_comum.js faz `import "../../src/blog-render.js"`: o
  // hash-assets apaga o nome limpo, então o import tem de ser reescrito — senão
  // o bundle do wrangler procura um arquivo que não existe mais.
  const dir = montaRaiz({
    "src/blog-render.js": "(function (r) { r.SleevuBlog = {}; })(globalThis);\n",
    "functions/blog/_comum.js": 'import "../../src/blog-render.js";\nexport const B = globalThis.SleevuBlog;\n'
  });
  try {
    assert.equal(roda("bundle-boot.mjs", dir).ok, true);
    const r = roda("hash-assets.mjs", dir);
    assert.equal(r.ok, true, r.saida);
    const fn = readFileSync(join(dir, "functions/blog/_comum.js"), "utf8");
    const m = /import "\.\.\/\.\.\/(src\/blog-render\.[0-9a-f]{8}\.js)"/.exec(fn);
    assert.ok(m, `import não foi reescrito: ${fn}`);
    assert.equal(existsSync(join(dir, m[1])), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import de Function apontando pra arquivo que não existe reprova", () => {
  const dir = montaRaiz({ "functions/blog/_comum.js": 'import "../../src/nao-existe.js";\n' });
  try {
    assert.equal(roda("bundle-boot.mjs", dir).ok, true);
    const r = roda("hash-assets.mjs", dir);
    assert.equal(r.ok, false, "import órfão devia reprovar");
    assert.match(r.saida, /\/src\/nao-existe\.js — pedido por 1 arquivo\(s\) \(functions\/ 1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
