// Idioma que o theme.js escolhe antes da primeira pintura (2026-09-30).
//
// O bug: o Google indexa o DOM depois do JS, e o navigator.languages do
// Googlebot é en-US. A home, o hub e o FAQ entravam no índice na tradução
// inglesa ("Sleevu - For Collectors!") e sumiam da busca em português. E as
// páginas pré-renderizadas, que têm o texto FIXO no HTML, anunciavam
// lang="en" com o conteúdo em português.
//
// O que se trava aqui:
//   - gente segue com a detecção pelo navegador (e a escolha salva vence);
//   - robô vê o idioma que o HTML declara;
//   - página de idioma fixo nunca tem o lang trocado;
//   - celular CUBOT não é robô (a régua é a do events_guard).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTE = readFileSync(join(raiz, "src", "theme.js"), "utf8");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Roda o theme.js num navegador de mentira e devolve o <html lang> final e o
// window.SLEEVU_LANG que o shared.js vai ler.
function roda({ ua = CHROME, languages = ["pt-BR"], htmlLang = "pt-BR", fixo = false, salvo = null } = {}) {
  const attrs = new Map([["lang", htmlLang]]);
  if (fixo) attrs.set("data-idioma-fixo", "");
  const dados = new Map(salvo ? [["tcg-collector-ui-lang-v1", salvo]] : []);
  const storage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k)
  };
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }) };
  const document = {
    documentElement: {
      getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
      setAttribute: (n, v) => attrs.set(n, String(v)),
      hasAttribute: (n) => attrs.has(n)
    },
    currentScript: null,
    write: () => { throw new Error("document.write inesperado"); }
  };
  vm.runInNewContext(FONTE, {
    window,
    document,
    navigator: { userAgent: ua, languages, language: languages[0] },
    localStorage: storage,
    location: { search: "", pathname: "/", hash: "" },
    history: { state: null, replaceState() {} }
  });
  return { lang: attrs.get("lang"), sleevu: window.SLEEVU_LANG };
}

test("gente: segue o navegador, e a escolha salva vence", () => {
  assert.deepEqual(roda({ languages: ["en-US", "pt-BR"] }), { lang: "en", sleevu: "en" });
  assert.deepEqual(roda({ languages: ["es-AR"] }), { lang: "es", sleevu: "es" });
  assert.deepEqual(roda({ languages: ["pt-BR"] }), { lang: "pt-BR", sleevu: "pt" });
  assert.deepEqual(roda({ languages: ["en-US"], salvo: "pt" }), { lang: "pt-BR", sleevu: "pt" });
});

test("robô vê o idioma do HTML, não o en-US do servidor dele", () => {
  assert.deepEqual(roda({ ua: GOOGLEBOT, languages: ["en-US"] }), { lang: "pt-BR", sleevu: "pt" });
  const robos = [
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    // Inspeção de URL do Search Console: tem que ver o mesmo que o Googlebot.
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)",
    "Mediapartners-Google",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)"
  ];
  for (const ua of robos) assert.equal(roda({ ua, languages: ["en-US"] }).sleevu, "pt", ua);
});

test("celular CUBOT não é robô", () => {
  const cubot = "Mozilla/5.0 (Linux; Android 9; CUBOT_X19) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  assert.equal(roda({ ua: cubot, languages: ["es-ES"] }).sleevu, "es");
});

test("página de idioma fixo nunca tem o lang trocado", () => {
  // A variante inglesa de um set, aberta por quem tem o navegador em português.
  assert.deepEqual(roda({ fixo: true, htmlLang: "en", languages: ["pt-BR"] }), { lang: "en", sleevu: "en" });
  // A variante portuguesa, aberta pelo Googlebot (en-US).
  assert.deepEqual(roda({ fixo: true, htmlLang: "pt-BR", ua: GOOGLEBOT, languages: ["en-US"] }), { lang: "pt-BR", sleevu: "pt" });
  // Nem a escolha salva mexe: o texto da página não é traduzido no cliente.
  assert.deepEqual(roda({ fixo: true, htmlLang: "pt-BR", salvo: "es" }), { lang: "pt-BR", sleevu: "pt" });
});

test("o prerender marca como idioma fixo as páginas que carregam o theme.js", () => {
  const prerender = readFileSync(join(raiz, "scripts", "prerender-catalog.mjs"), "utf8");
  // Cada template é um `return \`<!doctype html>...` que abre um documento.
  const templates = prerender.split("<!doctype html>").slice(1).map((t) => t.split("</html>")[0]);
  assert.ok(templates.length >= 4, "esperava os templates de set, artista, deck e carta");
  for (const t of templates) {
    if (!t.includes("/src/theme.js")) continue;
    assert.match(t, /^\s*<html lang="[^"]+" data-idioma-fixo>/, "template com theme.js sem data-idioma-fixo");
  }
});
