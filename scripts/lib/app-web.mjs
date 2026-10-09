// O pacote web do app (Capacitor, mobile/) — a parte PURA da montagem: o que
// entra, o que fica de fora e o que muda em cada arquivo. Quem copia os
// arquivos é o scripts/app-web.mjs; os testes (tests/app-web.test.mjs) usam
// estas mesmas funções.
//
// O app roda o MESMO código do site, servido de dentro do aparelho. O que só
// existe no servidor continua no servidor e é pedido a ORIGEM
// (https://sleevu.app): o catálogo (data/, ~550 MB, muda todo dia), as APIs da
// borda (/api/*) e as páginas que a borda monta. O pacote leva o código e a
// ponte (mobile/web/app-nativo.js), que entra como 1º script de toda página.

export const ORIGEM_PADRAO = "https://sleevu.app";

// Páginas do repositório que NÃO vão pro app:
//   mockup-*      rascunhos de layout (nem sobem pro site);
//   games.html    índice estático gerado no deploy (no app, /games abre o HUB);
//   admin.html, parceiro.html, blog-editor.html: painéis de quem administra —
//                 são do navegador, e no app só aumentariam a superfície.
const PAGINA_FORA = /^(?:mockup-.*|games|admin|parceiro|blog-editor)$/;
export function paginaDoApp(nome) { return !PAGINA_FORA.test(nome); }

// Arquivos soltos da raiz que as páginas usam (ícones e o manifest, que a
// <link rel=manifest> pede). sw.js, robots, sitemap, _headers, _redirects e
// afins são do servidor e ficam de fora.
export const ARQUIVOS_DA_RAIZ = ["styles.css", "favicon.svg", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.json"];

// assets/: tudo, menos o que o deploy também não publica (matéria-prima dos
// logos e os README de cada pasta). O vendor do scanner (tesseract, ~10 MB)
// ENTRA: o Worker dele tem que vir da mesma origem da página.
const ASSET_FORA = /(?:^|\/)README\.md$|^brand\/(?!sleevu-wordmark\.svg$)/;
export function assetDoApp(rel) { return !ASSET_FORA.test(rel); }

// ── game.js ──────────────────────────────────────────────────────────────────
// Os mesmos marcadores que o deploy troca por sed (MANIFEST e o espelho de
// imagens), mais o dataDir de cada jogo, que no app aponta pra ORIGEM: é dele
// que saem o <script> do catálogo e o fetch das fatias de índice.
export function transformaGameJs(texto, { origem = ORIGEM_PADRAO, hostsEspelho = [] } = {}) {
  let out = texto;
  const troca = (re, por, oQue) => {
    if (!re.test(out)) throw new Error(`app-web: não achei ${oQue} no src/game.js — o formato mudou?`);
    out = out.replace(re, por);
  };
  troca(/var MANIFEST = false; \/\* SLEEVU_MANIFEST \*\//, "var MANIFEST = true; /* SLEEVU_MANIFEST */", "o marcador SLEEVU_MANIFEST");
  troca(/var IMG_MIRROR_HOSTS = \[[^\]]*\]; \/\* SLEEVU_IMG_MIRROR \*\//,
    `var IMG_MIRROR_HOSTS = ${JSON.stringify(hostsEspelho)}; /* SLEEVU_IMG_MIRROR */`, "o marcador SLEEVU_IMG_MIRROR");
  const antes = (out.match(/dataDir: "data\//g) || []).length;
  if (!antes) throw new Error("app-web: nenhum `dataDir: \"data/…\"` no src/game.js — o registro de jogos mudou?");
  out = out.replace(/dataDir: "data\//g, `dataDir: "${origem}/data/`);
  return { texto: out, jogos: antes };
}

// ── HTML ─────────────────────────────────────────────────────────────────────
// 1. A ponte logo depois do <head>, antes de qualquer outro script (o
//    theme.js e o game.js já leem o endereço). O Capacitor injeta o dele no
//    início do documento, então window.Capacitor existe quando ela roda.
// 2. Referência estática a data/ (o set-id-map de algumas páginas) vai pra
//    ORIGEM — no pacote não existe data/.
// 3. Só no index.html: <base href="/">. É ele que o Capacitor serve em TODO
//    endereço sem ponto (/games/pokemon/base-set…), e a ponte sai dali na
//    hora; mas o leitor antecipado do navegador já pediu src/theme.js etc.
//    relativos ao caminho fundo — 404 à toa. Na raiz a base é a mesma de
//    sempre. NÃO vai nas outras páginas: com base "/", href="?aba=x" e
//    href="" passariam a apontar pro início (as que têm base já tratam isso).
export function transformaHtml(texto, { pagina, origem = ORIGEM_PADRAO }) {
  const head = /<head(?:\s[^>]*)?>/i.exec(texto);
  if (!head) throw new Error(`app-web: ${pagina}.html sem <head>`);
  let ponte = `<script src="/src/app-nativo.js" data-pagina="${pagina}"></script>`;
  if (pagina === "index" && !/<base\s/i.test(texto)) ponte += `\n<base href="/">`;
  let out = texto.slice(0, head.index + head[0].length) + "\n" + ponte + texto.slice(head.index + head[0].length);
  out = out.replace(/(\s(?:src|href)=")(?:\.?\/)?data\//g, `$1${origem}/data/`);
  // O .ics dos lançamentos também é gerado no deploy: o link de assinar o
  // calendário abre o do servidor (no app, fora dele — o sistema cuida do .ics).
  out = out.replace(/(\shref=")(?:\.?\/)?lancamentos\.ics"/g, `$1${origem}/lancamentos.ics"`);
  out = out.replace(RE_VITRINE, "");
  return out;
}

// 4. Sem vitrine (src/ads.js) no app. O AdSense dentro de WebView viola a
//    política do Google (no app seria AdMob), e a "casa" da vitrine oferece o
//    "apoie: R$10 = 30 dias sem anúncio" — desbloqueio digital pago fora da
//    loja, que a Apple e o Google barram (tem que ser compra dentro do app).
//    Sem o script a página fica como sempre ficou sem vitrine.
const RE_VITRINE = /[ \t]*<script\b[^>]*\bsrc="\/?src\/ads\.js"[^>]*><\/script>[ \t]*\r?\n?/g;
export const temVitrine = (html) => new RegExp(RE_VITRINE.source).test(html);

// ── CSS ──────────────────────────────────────────────────────────────────────
// Entalhe e barras do sistema. O site já desenha por baixo da barra de status
// (viewport-fit=cover, o mesmo do PWA no iPhone) e afasta o conteúdo com
// env(safe-area-inset-*). No iOS isso vale igual no app. No Android o app é
// edge-to-edge (alvo SDK 36), e a WebView anterior à 140 não entrega a medida
// certa no env(); o Capacitor 8 (plugin SystemBars, ligado por padrão) injeta
// a medida em --safe-area-inset-*. Aqui cada env() ganha a variável na frente,
// com o próprio env() como reserva — no site nada muda, a troca é só no pacote.
export function transformaCss(texto) {
  return texto.replace(/env\(safe-area-inset-(top|right|bottom|left)(\s*,\s*[^)]*)?\)/g,
    (todo, lado) => `var(--safe-area-inset-${lado}, ${todo})`);
}

// ── A ponte ──────────────────────────────────────────────────────────────────
export function preenchePonte(texto, { origem = ORIGEM_PADRAO, paginas }) {
  let out = texto;
  const troca = (re, por, oQue) => {
    if (!re.test(out)) throw new Error(`app-web: não achei ${oQue} em mobile/web/app-nativo.js`);
    out = out.replace(re, por);
  };
  troca(/var ORIGEM = "[^"]*"; \/\* SLEEVU_APP_ORIGEM \*\//, `var ORIGEM = ${JSON.stringify(origem)}; /* SLEEVU_APP_ORIGEM */`, "SLEEVU_APP_ORIGEM");
  troca(/var PAGINAS = \[[^\]]*\]; \/\* SLEEVU_APP_PAGINAS \*\//, `var PAGINAS = ${JSON.stringify(paginas)}; /* SLEEVU_APP_PAGINAS */`, "SLEEVU_APP_PAGINAS");
  return out;
}

// Origem válida: https (ou http só em localhost, pra testar contra um servidor
// local), sem barra no fim e sem caminho.
export function confereOrigem(origem) {
  let u;
  try { u = new URL(origem); } catch { throw new Error(`app-web: --origem inválida: ${origem}`); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) throw new Error(`app-web: --origem precisa ser https (http só em localhost): ${origem}`);
  if (u.pathname !== "/" || u.search || u.hash) throw new Error(`app-web: --origem é só o endereço, sem caminho: ${origem}`);
  return u.origin;
}
