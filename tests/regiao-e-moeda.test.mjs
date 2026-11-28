// Região do navegador pro formato do espanhol, e euro pra Portugal (4D, 28/11).
//
// O que mudou:
//   - o espanhol formatava SEMPRE em es-ES. Agora o locale de número e data é o
//     primeiro "es-XX" de navigator.languages: es-MX escreve 1,234.56 e
//     es-AR/es-ES, 1.234,56. "es" puro e "es-ES" seguem es-ES;
//   - pt-PT sem moeda salva abre em euro (o texto segue o português do site e
//     o formato de número segue pt-BR). Os outros pt seguem em real.
//
// O que se trava aqui:
//   - o locale e a moeda padrão pra es-MX, es-AR, es, es-ES, pt-PT, pt-BR, pt e
//     en-US, saindo do theme.js REAL (que escolhe o idioma antes do shared.js)
//     e do shared.js REAL — se os dois discordarem, o teste quebra;
//   - a régua do dinheiro digitado (#354) acompanha a região: em es-MX "1,250"
//     grava 1250 e o valor sai "1,250.00"; em es-AR "1.250,50" grava 1250,5;
//   - tag que o Intl recusa não derruba o shared.js: cai em es-ES;
//   - nenhuma tela voltou a formatar com `undefined` (o idioma do navegador,
//     que pode ser outra região que a do site) nem com o es-ES fixo.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checkout do Windows vem em CRLF (core.autocrlf): normaliza na leitura.
const ler = (rel) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const THEME = ler("src/theme.js");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// O idioma que o theme.js real escolhe pra esse navegador (window.SLEEVU_LANG),
// que o shared.js lê. `salvo` é a escolha explícita de idioma.
function idiomaDoTheme(languages, salvo) {
  const dados = new Map(salvo ? [["tcg-collector-ui-lang-v1", salvo]] : []);
  const storage = { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem() {}, removeItem() {} };
  const attrs = new Map([["lang", "pt-BR"]]);
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(THEME, {
    window,
    document: {
      documentElement: {
        getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
        setAttribute: (n, v) => attrs.set(n, String(v)),
        hasAttribute: (n) => attrs.has(n)
      },
      currentScript: null,
      write: () => { throw new Error("document.write inesperado"); }
    },
    navigator: { userAgent: CHROME, languages, language: languages[0] },
    localStorage: storage,
    location: { search: "", pathname: "/", hash: "", replace() {} },
    history: { state: null, replaceState() {} }
  });
  return window.SLEEVU_LANG;
}

// O shared.js num navegador com esses idiomas, sem idioma nem moeda salvos
// (a menos que `salvo` diga). Devolve o que importa pra formatar.
function noNavegador(languages, salvo = {}) {
  const lang = idiomaDoTheme(languages, salvo["tcg-collector-ui-lang-v1"]);
  const sb = loadShared("", {
    localStorage: makeLocalStorage(salvo),
    antes: (s) => {
      s.navigator = { languages, language: languages[0], onLine: true, serviceWorker: undefined };
      s.SLEEVU_LANG = lang;
    }
  });
  const S = sb.window.TCGShared;
  return {
    lang: S.getLanguage(),
    locale: S.getLocale(),
    moeda: S.getCurrency(),
    parseMoney: S.parseMoney,
    moneyInput: S.moneyInput,
    formatMoney: S.formatMoney
  };
}

test("locale e moeda padrão, sem nada salvo, pelos idiomas do navegador", () => {
  const casos = [
    // [idiomas do navegador, idioma da interface, locale de formato, moeda]
    [["es-MX", "es"], "es", "es-MX", "USD"],
    [["es-AR"], "es", "es-AR", "USD"],
    [["es"], "es", "es-ES", "USD"],
    [["es-ES", "es"], "es", "es-ES", "USD"],
    [["pt-PT", "pt"], "pt", "pt-BR", "EUR"],
    [["pt-BR", "pt"], "pt", "pt-BR", "BRL"],
    [["pt"], "pt", "pt-BR", "BRL"],
    [["en-US", "en"], "en", "en-US", "USD"]
  ];
  for (const [languages, lang, locale, moeda] of casos) {
    const n = noNavegador(languages);
    const rotulo = languages.join(",");
    assert.equal(n.lang, lang, `${rotulo}: idioma da interface`);
    assert.equal(n.locale, locale, `${rotulo}: locale de formato`);
    assert.equal(n.moeda, moeda, `${rotulo}: moeda padrão`);
  }
});

test("espanhol: o 1º es-XX da lista manda, mesmo atrás de outro idioma", () => {
  // Idioma da interface vem do 1º que o site atende (aqui o inglês), e quem
  // escolheu espanhol na mão ainda formata pela região que o navegador diz.
  assert.equal(noNavegador(["es-MX", "en-US"]).locale, "es-MX");
  assert.equal(noNavegador(["en-US", "es-CL"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-CL");
  assert.equal(noNavegador(["pt-BR", "es-AR", "es-MX"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-AR");
  // Sem nenhum es-XX na lista (escolheu espanhol na mão): es-ES, como era.
  assert.equal(noNavegador(["en-US"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-ES");
  assert.equal(noNavegador(["pt-BR"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-ES");
});

test("a região do espanhol não vaza pros outros idiomas", () => {
  // O navegador de um mexicano com o site em português ou inglês escolhido.
  assert.equal(noNavegador(["es-MX"], { "tcg-collector-ui-lang-v1": "pt" }).locale, "pt-BR");
  assert.equal(noNavegador(["es-MX"], { "tcg-collector-ui-lang-v1": "en" }).locale, "en-US");
});

test("tag que o Intl recusa não derruba o shared.js: cai em es-ES", () => {
  assert.equal(noNavegador(["es-"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-ES");
  assert.equal(noNavegador(["es-_"], { "tcg-collector-ui-lang-v1": "es" }).locale, "es-ES");
});

test("moeda padrão: só o 1º pt do navegador sendo pt-PT vira euro", () => {
  assert.equal(noNavegador(["pt-PT"]).moeda, "EUR");
  assert.equal(noNavegador(["pt-pt"]).moeda, "EUR", "caixa baixa também");
  assert.equal(noNavegador(["pt-BR", "pt-PT"]).moeda, "BRL", "o 1º pt é o brasileiro");
  assert.equal(noNavegador(["pt-AO"]).moeda, "BRL", "só Portugal muda");
  // Quem lê em inglês ou espanhol segue em dólar, mesmo com pt-PT na lista.
  assert.equal(noNavegador(["en-GB", "pt-PT"]).moeda, "USD");
  assert.equal(noNavegador(["es-ES", "pt-PT"]).moeda, "USD");
  // A escolha salva de moeda vence sempre.
  assert.equal(noNavegador(["pt-PT"], { "tcg-collector-currency-v1": "BRL" }).moeda, "BRL");
  assert.equal(noNavegador(["pt-BR"], { "tcg-collector-currency-v1": "EUR" }).moeda, "EUR");
  // Idioma salvo em inglês num navegador pt-PT: a moeda segue o idioma da interface.
  assert.equal(noNavegador(["pt-PT"], { "tcg-collector-ui-lang-v1": "en" }).moeda, "USD");
  // Idioma salvo em português num navegador pt-PT: euro.
  assert.equal(noNavegador(["pt-PT"], { "tcg-collector-ui-lang-v1": "pt" }).moeda, "EUR");
});

test("es-MX: digitar 1,250 grava 1250, e o valor sai 1,250.00 (a régua da #354)", () => {
  const mx = noNavegador(["es-MX"]);
  assert.equal(mx.parseMoney("1,250"), 1250);
  assert.equal(mx.parseMoney("$2,000"), 2000);
  assert.equal(mx.parseMoney("1,250.50"), 1250.5);
  assert.equal(mx.parseMoney("12.5"), 12.5);
  assert.equal(mx.parseMoney("1.250,50"), 1250.5, "os dois separadores: o último é o decimal");
  assert.equal(mx.formatMoney("USD", 1250), "US$ 1,250.00");
  assert.equal(mx.formatMoney("EUR", 1234567.891), "€ 1,234,567.89");
  // O campo escreve no decimal da região, e o parseMoney lê de volta.
  assert.equal(mx.moneyInput(1250.5, 1), "1250.50");
  assert.equal(mx.moneyInput(0, 1, 1), "0.00");
  assert.equal(mx.parseMoney(mx.moneyInput(1250.5, 1)), 1250.5);
});

test("es-AR: digitar 1.250,50 grava 1250,5, e o valor sai com vírgula decimal", () => {
  const ar = noNavegador(["es-AR"]);
  assert.equal(ar.parseMoney("1.250,50"), 1250.5);
  assert.equal(ar.parseMoney("1.250"), 1250);
  assert.equal(ar.parseMoney("12,5"), 12.5);
  assert.equal(ar.parseMoney("1,250.50"), 1250.5, "os dois separadores: o último é o decimal");
  assert.equal(ar.formatMoney("USD", 1250.5), "US$ 1.250,50");
  assert.equal(ar.moneyInput(1250.5, 1), "1250,50");
  assert.equal(ar.moneyInput(0, 1, 1), "0,00");
  assert.equal(ar.parseMoney(ar.moneyInput(1250.5, 1)), 1250.5);
});

test("es e es-ES: vírgula decimal, como sempre foi", () => {
  for (const languages of [["es"], ["es-ES"]]) {
    const es = noNavegador(languages);
    assert.equal(es.parseMoney("12,5"), 12.5);
    assert.equal(es.parseMoney("1.250,50"), 1250.5);
    assert.equal(es.moneyInput(12.5, 1), "12,50");
    assert.equal(es.formatMoney("EUR", 12.5), "€ 12,50");
  }
});

test("pt-PT: euro com o formato do português do site", () => {
  const pt = noNavegador(["pt-PT", "pt"]);
  assert.equal(pt.moeda, "EUR");
  assert.equal(pt.formatMoney(pt.moeda, 1250.5), "€ 1.250,50");
  assert.equal(pt.parseMoney("1.250,50"), 1250.5);
  assert.equal(pt.moneyInput(12.5, 1), "12,50");
});

// Quem formata passa pelo getLocale(): o `undefined` seguia o idioma do
// navegador, que numa lista como ["pt-BR", "es-MX"] é outra região que a do
// site; o es-ES fixo seguia a Espanha. Os dois travados fora do núcleo.
test("nenhuma tela do app formata com `undefined` nem com es-ES fixo", () => {
  // Todo src/*.js, menos o que é de propósito em português do Brasil: o painel
  // do admin, o editor do blog (de quem escreve) e o blog-render (que a borda
  // usa no idioma do POST, não no de quem lê; ver o relatório do 4D).
  const FIXOS = new Set(["admin", "blog-editor", "blog-render"]);
  const TELAS = readdirSync(join(raiz, "src")).filter((f) => f.endsWith(".js") && f !== "shared.js" && !FIXOS.has(f.slice(0, -3))).map((f) => f.slice(0, -3));
  assert.ok(TELAS.length > 40, "a lista de telas não pode vir vazia");
  const semComentario = (js) => js.replace(/\/\/[^\n]*/g, "");
  for (const nome of TELAS) {
    const js = semComentario(ler(`src/${nome}.js`));
    assert.ok(!/\.toLocale(?:Date|Time)?String\(\s*(?:undefined\s*[,)]|\))/.test(js), `${nome}.js formata com o idioma do navegador (toLocale*String sem locale)`);
    assert.ok(!/["']es-ES["']/.test(js), `${nome}.js tem es-ES fixo`);
  }
  // No núcleo, o es-ES só aparece como o último recurso do espanhol.
  const nucleo = semComentario(ler("src/shared.js"));
  assert.equal((nucleo.match(/["']es-ES["']/g) || []).length, 2, "o es-ES do núcleo é só o do último recurso (try e catch)");
});
