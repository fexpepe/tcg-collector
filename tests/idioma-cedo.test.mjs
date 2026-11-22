// Quem não lê português não vê português na frente (2026-11-22).
//
// O HTML nasce em pt e só o shared.js traduzia, por último. Medido em produção
// com o navegador em inglês e 4G lento: a home pintava em português aos 1,5 s
// e só virava inglês aos 8,0 s. Agora o theme.js (1) pede o pacote do idioma
// com prioridade alta, (2) esconde o texto traduzível enquanto ele não chega
// (data-i18n-espera, com prazo de 3 s) e (3) traduz o HTML assim que o último
// pacote da página executa, sem esperar o shared.js.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8").replace(/\r\n/g, "\n");
const theme = ler("src/theme.js");

// O deploy carimba o mapa de pacotes no lugar do `null` (scripts/split-i18n.mjs).
const MAPA = { i18n: { pt: "src/i18n.pt.js", en: "src/i18n.en.js", es: "src/i18n.es.js" }, "i18n-decks": { pt: "src/i18n-decks.pt.js", en: "src/i18n-decks.en.js", es: "src/i18n-decks.es.js" } };
const comMapa = (mapa) => {
  const marca = "var I18N = null; /* SLEEVU_I18N */";
  assert.ok(theme.includes(marca), "theme.js sem o marcador SLEEVU_I18N");
  return theme.replace(marca, `var I18N = ${JSON.stringify(mapa)}; /* SLEEVU_I18N */`);
};

// Navegador de mentira: o <html> guarda atributos, o document.write cria o
// <script> (com ouvintes de load/error que o teste dispara) e os elementos
// traduzíveis são objetos simples.
function abre({ linguas = ["en-US", "en"], salvo = null, pacotes = "i18n", ua = "Mozilla/5.0 (Linux; Android 14)", mapa = MAPA, elementos = [] } = {}) {
  const attrs = new Map([["lang", "pt-BR"]]);
  if (pacotes) attrs.set("data-i18n-packs", pacotes);
  const escritos = [], prazos = [];
  const html = {
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => { attrs.set(k, String(v)); }, removeAttribute: (k) => { attrs.delete(k); },
    classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {}
  };
  const documento = {
    documentElement: html, currentScript: null, scripts: [], head: { appendChild() {} },
    write(texto) {
      const src = (texto.match(/ src="([^"]+)"/) || [])[1];
      const ouvintes = {};
      const el = { texto, getAttribute: (k) => (k === "src" ? src : null), addEventListener: (ev, fn) => { ouvintes[ev] = fn; }, dispara: (ev) => ouvintes[ev] && ouvintes[ev]() };
      escritos.push(el);
      documento.scripts.push(el);
    },
    querySelectorAll: (sel) => elementos.filter((e) => e.attr === sel.slice(1, -1)),
    querySelector: () => null, addEventListener() {}, createElement: () => ({ setAttribute() {}, style: {} })
  };
  const store = new Map(salvo ? [["tcg-collector-ui-lang-v1", salvo]] : []);
  const sandbox = {
    document: documento,
    navigator: { languages: linguas, language: linguas[0], userAgent: ua },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem() {}, removeItem() {} },
    location: { pathname: "/", search: "", hash: "", href: "https://sleevu.app/", replace() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: (fn, ms) => { prazos.push({ fn, ms }); return prazos.length; },
    addEventListener() {}, console
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(comMapa(mapa), sandbox);
  return { sandbox, attrs, escritos, prazos, emEspera: () => attrs.has("data-i18n-espera") };
}
const elemento = (attr, chave, inicial) => {
  const e = { attr, textContent: inicial, innerHTML: inicial, placeholder: inicial, getAttribute: (k) => (k === attr ? chave : null) };
  return e;
};

test("em inglês: pacote com prioridade alta, texto em espera, e a tradução entra quando o pacote executa", () => {
  const els = [
    elemento("data-i18n", "home.titulo", "Sua coleção"),
    elemento("data-i18n", "home.jogo", "Sua coleção de Pokémon"),
    elemento("data-i18n", "chave.que.falta", "Fica como está"),
    elemento("data-i18n-html", "home.rico", "<b>pt</b>"),
    elemento("data-i18n-placeholder", "busca.dica", "Buscar")
  ];
  const p = abre({ elementos: els });
  assert.equal(p.sandbox.SLEEVU_LANG, "en");
  assert.equal(p.escritos.length, 1);
  assert.match(p.escritos[0].texto, /^<script defer src="src\/i18n\.en\.js" fetchpriority="high"><\/script>$/);
  assert.ok(p.emEspera(), "texto traduzível escondido enquanto o pacote não chega");
  // o pacote executa (preenche a tabela) e o navegador dispara o load
  p.sandbox.TCG_MESSAGES.en = { "home.titulo": "Your collection", "home.jogo": "Your {game} collection", "home.rico": "<b>en</b>", "busca.dica": "Search" };
  p.sandbox.SLEEVU = { name: "Lorcana" };
  p.escritos[0].dispara("load");
  assert.equal(els[0].textContent, "Your collection");
  assert.equal(els[1].textContent, "Your Lorcana collection", "{game} trocado como no t() do shared.js");
  assert.equal(els[2].textContent, "Fica como está", "chave que a tabela não tem não vira chave crua aqui");
  assert.equal(els[3].innerHTML, "<b>en</b>");
  assert.equal(els[4].placeholder, "Search");
  assert.ok(!p.emEspera(), "espera solta junto com a tradução");
});

test("página com dois pacotes só traduz e solta depois do ÚLTIMO", () => {
  const els = [elemento("data-i18n", "decks.titulo", "Decks")];
  const p = abre({ pacotes: "i18n,i18n-decks", linguas: ["es-MX", "es"], elementos: els });
  assert.equal(p.sandbox.SLEEVU_LANG, "es");
  assert.deepEqual(p.escritos.map((e) => e.getAttribute("src")), ["src/i18n.es.js", "src/i18n-decks.es.js"]);
  p.sandbox.TCG_MESSAGES.es = {};
  p.escritos[0].dispara("load");
  assert.ok(p.emEspera(), "falta o pacote da página");
  assert.equal(els[0].textContent, "Decks");
  p.sandbox.TCG_MESSAGES.es["decks.titulo"] = "Mazos";
  p.escritos[1].dispara("load");
  assert.equal(els[0].textContent, "Mazos");
  assert.ok(!p.emEspera());
});

test("pacote que não chega: o prazo de 3 s (e o erro de rede) soltam o português", () => {
  const p = abre();
  assert.ok(p.emEspera());
  const prazo = p.prazos.find((x) => x.ms === 3000);
  assert.ok(prazo, "sem o prazo de segurança de 3 s");
  prazo.fn();
  assert.ok(!p.emEspera(), "o prazo solta o texto");
  const q = abre();
  q.escritos[0].dispara("error");
  assert.ok(!q.emEspera(), "erro de rede no pacote solta o texto na hora");
});

test("em português, pra robô e em dev nada fica em espera", () => {
  const pt = abre({ linguas: ["pt-BR", "pt"] });
  assert.equal(pt.sandbox.SLEEVU_LANG, "pt");
  assert.ok(!pt.emEspera());
  assert.match(pt.escritos[0].texto, /src="src\/i18n\.pt\.js" fetchpriority="high"/);
  // robô fica no idioma do HTML (pt), mesmo com o navegador dizendo inglês
  const robo = abre({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
  assert.equal(robo.sandbox.SLEEVU_LANG, "pt");
  assert.ok(!robo.emEspera());
  // dev: sem o mapa carimbado não há pacote por idioma, e nada é escondido
  const dev = abre({ mapa: null });
  assert.equal(dev.escritos.length, 0);
  assert.ok(!dev.emEspera());
});

test("a regra do CSS esconde só o que é traduzível, e mora no núcleo", () => {
  const css = ler("styles.css");
  assert.match(css, /html\[data-i18n-espera\] \[data-i18n\],\nhtml\[data-i18n-espera\] \[data-i18n-html\] \{ visibility: hidden; \}/);
  // sem classe de área no seletor: o split-css deixa a regra no núcleo, que
  // toda página carrega (regra roteada por prefixo sumiria de quase todas).
  const regra = css.slice(css.indexOf("html[data-i18n-espera]"), css.indexOf("html[data-i18n-espera]") + 220);
  assert.ok(!/\.[a-z]/.test(regra.split("{")[0]), "seletor da espera não pode levar classe");
});
