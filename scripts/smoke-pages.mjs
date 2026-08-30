// Abre as páginas principais num navegador de verdade e falha se alguma
// quebrar: erro de JS, 404 de arquivo do site, ou a mensagem de "não foi
// possível carregar o catálogo" (que é onde o boot despeja QUALQUER exceção do
// render — inclusive as que não aparecem como erro de JS).
//
// Existe por causa de um bug que passou por tudo: o título da página de SÉRIE
// (?serie=) é montado inserindo o link "← Sets" antes do <h1>. Quando o h1 saiu
// de baixo do .page-head e foi pra dentro do .page-head-bar-text (o título
// dividindo a faixa com a busca), o insertBefore passou a receber um nó que não
// era filho do alvo — e isso LANÇA. A exceção subia até o .catch() do boot e a
// página de toda série e de toda linha vintage ficava em branco. Nenhum teste de
// unidade nem guarda estática pega isso: só abrindo a página.
//
// Uso: sirva o site (npx http-server -p 8899 .) e rode
//   npx --yes playwright install chromium   # uma vez
//   node scripts/smoke-pages.mjs [porta]
// Antes o import era um caminho ABSOLUTO de uma máquina só (/opt/node22/…), o que
// deixava a guarda inrodável em qualquer outro lugar — inclusive no CI. Especifier
// normal resolve onde o playwright estiver instalado.
import { chromium } from "playwright";

const PORTA = process.argv[2] || "8899";
const BASE = `http://localhost:${PORTA}/`;

// As URLs com parâmetro são as que mais escapam: elas mudam o caminho de código
// do título e do agrupamento, e nenhuma delas é a página que se abre por hábito.
const PAGINAS = [
  "index.html", "hub.html", "sets.html?game=pokemon", "sets.html?game=pokemon&serie=sv",
  "sets.html?game=onepiece&line=opcd", "sets.html?game=naruto&line=nrt-mb",
  "cards.html?game=pokemon", "detail.html?type=set&name=Base+Set&game=pokemon",
  "explore.html", "collection.html", "portfolio.html", "wishlist.html", "binders.html",
  "decks.html", "my-decks.html", "dashboard.html", "graded.html", "sales.html",
  "settings.html", "profile.html", "login.html", "faq.html", "help.html", "badges.html",
  "lancamentos.html", "comparar.html"
];

const SESSAO = {
  "tcg-collector-ui-lang-v1": "pt",
  "tcg-supabase-session-v1": JSON.stringify({
    access_token: "fake", refresh_token: "fake", expires_at: 4102444800,
    user: { id: "00000000-0000-4000-8000-000000000000", email: "smoke@sleevu.app" }
  })
};

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
await contexto.addInitScript((seed) => {
  Object.keys(seed).forEach((k) => localStorage.setItem(k, seed[k]));
}, SESSAO);

const falhas = [];
for (const pagina of PAGINAS) {
  const page = await contexto.newPage();
  const erros = [];
  const quebrados = [];
  page.on("pageerror", (e) => erros.push(e.message.slice(0, 140)));
  page.on("response", (r) => {
    // Artefatos de BUILD só existem depois do build completo — ausentes
    // localmente: os chunks de preço e o calendário de lançamentos
    // (build-releases.mjs) e o trilho de mercado (build-market.mjs). Nos
    // três casos a página tem estado vazio próprio, que é o comportamento
    // certo sem o arquivo.
    if (r.status() >= 400 && r.url().startsWith(BASE) && !/price-(movers|deltas)|releases\.generated|market\.generated|decks-hot\.generated/.test(r.url())) {
      quebrados.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.goto(BASE + pagina, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  // Só a mensagem de ERRO do boot (i18n `error.catalog`), não o estado vazio.
  // O /catálogo|catalog/ de antes acusava a Coleção e a Wishlist de quebradas
  // sempre que a conta não tinha dados: o texto de lista vazia convida a
  // "Explorar o catálogo", e a palavra bastava pra casar. Duas falhas fixas
  // deixavam a guarda inútil — quem roda aprende a ignorar o vermelho.
  const erroDeCatalogo = await page.evaluate(() => {
    const vazio = document.getElementById("emptyState");
    if (!vazio || vazio.hidden) return "";
    const texto = vazio.textContent || "";
    return /(não foi possível carregar o catálogo|could not load the catalog|no se pudo cargar el catálogo)/i.test(texto)
      ? texto.trim().slice(0, 160) : "";
  });
  const problemas = [...erros.map((e) => `js: ${e}`), ...quebrados.map((e) => `http: ${e}`)];
  if (erroDeCatalogo) problemas.push(`boot: ${erroDeCatalogo}`);
  if (problemas.length) falhas.push({ pagina, problemas });
  console.log(`${problemas.length ? "FALHA" : "ok   "} ${pagina}`);
  problemas.slice(0, 3).forEach((p) => console.log(`        ${p}`));
  await page.close();
}
await navegador.close();

if (falhas.length) {
  console.error(`\n${falhas.length} página(s) com problema.`);
  process.exit(1);
}
console.log(`\n${PAGINAS.length} páginas abriram limpas.`);
