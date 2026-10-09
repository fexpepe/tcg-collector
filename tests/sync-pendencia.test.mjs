// Sync com a nuvem falhando não pode apagar dado (2026-10-08).
//
// Três buracos travados aqui, todos no boot do initAuth (src/shared.js):
//  1. LOGIN cujo pull falhava (5xx, 429, rede trocando de Wi-Fi pra 4G) subia
//     mesmo assim o snapshot de cada jogo deste aparelho. O upsert troca o
//     `data` inteiro da linha: num celular novo, a coleção VAZIA ia por cima da
//     nuvem. Agora não sobe nada e todos os jogos ficam devendo.
//  2. Boot de SESSÃO com pull falho ligava o laço com `lastPushedByGame`
//     vazio: o 1º push subia o local de todos os jogos sem o merge. Agora a
//     página não sobe nada; o que for editado vira pendência na saída.
//  3. Edição que não teve push confirmado antes de a pessoa sair (keepalive
//     recusado acima de 64 KB, página fechada) ficava só no aparelho: o boot
//     seguinte carimbava o local como "já enviado". Agora a saída grava a
//     pendência e o próximo boot com pull bom sobe o jogo.
// O shared.js roda inteiro num sandbox com um Supabase falso no fetch.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTE = readFileSync(join(raiz, "src/shared.js"), "utf8");
const PENDENCIA = "tcg-sync-pendente-v1";
const SESSAO = "tcg-supabase-session-v1";
const UID = "u-teste";

function montaApp({ seed = {}, hash = "", pullOk = true, linhas = [], pushOk = true, tokenStatus = 200, marcas401 = 0, cota = Infinity } = {}) {
  const noop = () => {};
  const makeEl = (extra = {}) => new Proxy(
    Object.assign({ dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, children: [], childNodes: [], options: [], attributes: [] }, extra),
    {
      get: (t, k) => {
        if (k in t) return t[k];
        if (typeof k !== "string") return undefined;
        if (/^(textContent|innerHTML|innerText|value|id|className|tagName|href|src|type|name|placeholder|title)$/.test(k)) return "";
        if (/^(querySelectorAll|getElementsByTagName|getElementsByClassName|getClientRects)$/.test(k)) return () => [];
        // querySelector de elemento CRIADO devolve outro falso: o initAuth monta
        // o menu da conta e os dropdowns por innerHTML e liga ouvintes nos filhos.
        if (k === "querySelector") return () => makeEl();
        if (/^(closest|getAttribute)$/.test(k)) return () => null;
        if (k === "getBoundingClientRect") return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
        if (/^(appendChild|insertBefore|prepend|append|replaceWith|cloneNode)$/.test(k)) return (x) => x || makeEl();
        if (k === "hasAttribute") return () => false;
        return noop;
      },
      set: (t, k, v) => { t[k] = v; return true; }
    }
  );
  const attrs = new Map();
  const html = makeEl({ setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), lang: "pt-BR" });
  const nav = makeEl({ dataset: { activePage: "detail" } });
  const acoes = makeEl();
  const store = { ...seed };
  // `cota`: quantos caracteres cabem por chave de coleção (simula o iPhone no teto).
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (/-collection-v3$/.test(k) && String(v).length > cota) throw new Error("QuotaExceededError"); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; }, get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i] ?? null
  };
  const ouvintes = {};
  const ouve = (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); };
  const pushes = [];
  const reloads = [];
  const intervalos = [];
  const gets = []; // URLs dos GET em /collections (o pull leve pede as versões e só depois os dados)
  const tokens = []; // pedidos de renovação do token
  // Linhas da conta: { game, data, updated_at }. O GET responde como o PostgREST:
  // select=game,updated_at traz as versões; game=in.(…) restringe as linhas.
  const nuvem = linhas.map((l) => ({ updated_at: "2026-10-08T10:00:00.000+00:00", ...l }));
  const resposta = (ok, corpo, status = ok ? 200 : 503) => Promise.resolve({ ok, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });
  const fetch = (url, init = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return resposta(true, { id: UID, email: "a@b.c" });
    if (u.includes("/auth/v1/token")) {
      tokens.push(u);
      return tokenStatus === 200 ? resposta(true, { access_token: "t2", refresh_token: "r2", user: { id: UID, email: "a@b.c" } }) : resposta(false, { error: "x" }, tokenStatus);
    }
    if (u.includes("/rest/v1/collections") && (init.method || "GET") === "GET") {
      gets.push(u);
      if (!pullOk) return resposta(false, { message: "fora" });
      if (u.includes("select=game,updated_at")) {
        if (marcas401 > 0) { marcas401--; return resposta(false, { message: "JWT expired" }, 401); }
        return resposta(true, nuvem.map((l) => ({ game: l.game, updated_at: l.updated_at })));
      }
      const m = /game=in\.\(([^)]*)\)/.exec(u);
      const quais = m ? m[1].split(",") : null;
      return resposta(true, nuvem.filter((l) => !quais || quais.includes(l.game)).map((l) => ({ game: l.game, data: l.data })));
    }
    if (u.includes("/rest/v1/collections") && init.method === "POST") {
      const corpo = JSON.parse(init.body);
      pushes.push({ corpo, keepalive: !!init.keepalive });
      // A nuvem guarda o updated_at que o push manda (sem gatilho), como o upsert faz.
      if (pushOk) [].concat(corpo).forEach((l) => {
        const i = nuvem.findIndex((x) => x.game === l.game);
        const linha = { game: l.game, data: l.data, updated_at: l.updated_at.replace("Z", "+00:00") };
        if (i >= 0) nuvem[i] = linha; else nuvem.push(linha);
      });
      return resposta(pushOk, null);
    }
    return resposta(false, null, 599);
  };
  const sandbox = {
    document: {
      querySelector: (sel) => (/page-nav/.test(sel) ? nav : /header-actions/.test(sel) ? acoes : null), querySelectorAll: () => [],
      getElementById: () => null, createElement: () => makeEl(), createTextNode: () => makeEl(), createDocumentFragment: () => makeEl(),
      addEventListener: ouve, removeEventListener: noop, dispatchEvent: noop,
      documentElement: html, body: makeEl(), head: makeEl(), title: "", cookie: "", referrer: "", visibilityState: "visible", readyState: "loading",
      scripts: [], currentScript: null
    },
    localStorage: ls, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { language: "pt-BR", languages: ["pt-BR"], serviceWorker: undefined, onLine: true, userAgent: "Mozilla/5.0 (Linux; Android 14)" },
    location: { pathname: "/collection", search: "", hash, origin: "http://localhost", hostname: "localhost", host: "localhost", protocol: "http:", href: "http://localhost/collection" + hash, replace: noop, reload: () => reloads.push(1) },
    history: { replaceState: noop, pushState: noop, state: null },
    fetch,
    setInterval: (fn) => { intervalos.push(fn); return intervalos.length; }, clearTimeout: noop, clearInterval: noop, setTimeout: noop, requestIdleCallback: noop, requestAnimationFrame: noop,
    console: { ...console, warn: noop, log: noop, info: noop }, URL, URLSearchParams, Blob: class {}, CustomEvent: class {},
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    addEventListener: ouve, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    TCG_MESSAGES: { pt: {} },
    SLEEVU: { game: "hub", dataDir: "", manifest: true, catalogReady: Promise.resolve(), games: {}, line: "", urlDoJogo: () => "/games/pokemon", urlDoSet: () => "/games/pokemon" },
    IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
    ResizeObserver: function () { return { observe: noop, disconnect: noop }; },
    MutationObserver: function () { return { observe: noop, disconnect: noop }; },
    indexedDB: { open: () => ({}) }, performance: { now: () => 0, getEntriesByType: () => [] },
    screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
    alert: noop
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const fonte = FONTE.replace("window.TCGShared = {", "window.__t = { GAME_SLUGS, createCollectionStore, flushWrites, get comKeepalive() { return comKeepalive; } };\nwindow.TCGShared = {");
  vm.runInContext(fonte, sandbox, { filename: "shared.js" });
  const espera = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
  const dispara = (tipo) => (ouvintes[tipo] || []).forEach((fn) => fn({ type: tipo }));
  const pendencia = () => { const p = ls.getItem(PENDENCIA); return p ? JSON.parse(p) : null; };
  return { sandbox, t: sandbox.__t, ls, pushes, gets, tokens, nuvem, store, reloads, intervalos, espera, dispara, pendencia };
}

const comSessao = (extra = {}) => ({
  [SESSAO]: JSON.stringify({ access_token: "t1", refresh_token: "r1", user: { id: UID, email: "a@b.c" }, ts: Date.now() }),
  "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }),
  ...extra
});
const UMA_CARTA = JSON.stringify({ "base1-4": { Normal: { NM: 1 } } });

test("login com o pull FALHANDO não sobe nada e deixa todos os jogos devendo", async () => {
  const app = montaApp({ hash: "#access_token=t1&refresh_token=r1", pullOk: false, seed: { "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }) } });
  await app.espera();
  assert.equal(app.pushes.length, 0, "com o pull falho o login subiu o snapshot local por cima da nuvem");
  const p = app.pendencia();
  assert.ok(p && p.u === UID, "a pendência do login tem de ficar gravada com o dono");
  assert.deepEqual([...p.g].sort(), [...app.t.GAME_SLUGS].sort());
});

// Linha só pra jogo com dado (2026-10-08): o login subia os 22 jogos, cada
// linha com uma cópia das chaves globais, e todo pull baixava as 22.
test("login com o pull bom sobe só os jogos com dado e os que já têm linha, sem pendência", async () => {
  const app = montaApp({
    hash: "#access_token=t1&refresh_token=r1",
    linhas: [{ game: "lorcana", data: {} }],
    seed: {
      "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }),
      "tcg-collector-pokemon-collection-v3": UMA_CARTA,
      "tcg-collector-magic-wishlist-v1": JSON.stringify({ "mtg-lea-1": ["Normal"] })
    }
  });
  await app.espera();
  assert.equal(app.pushes.length, 1);
  assert.deepEqual(app.pushes[0].corpo.map((l) => l.game).sort(), ["lorcana", "magic", "pokemon"], "Pokémon e Magic têm dado; Lorcana já tinha linha");
  assert.equal(app.pendencia(), null);
});

test("login de conta nova sem dado nenhum sobe no máximo UMA linha", async () => {
  const app = montaApp({ hash: "#access_token=t1&refresh_token=r1", linhas: [], seed: { "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }) } });
  await app.espera();
  assert.ok(app.pushes.length <= 1);
  if (app.pushes.length) assert.ok(app.pushes[0].corpo.length <= 1, `subiu ${app.pushes[0].corpo.length} linhas`);
});

test("sessão com o pull FALHANDO não sobe nada; o que for editado vira pendência na saída", async () => {
  const app = montaApp({ seed: comSessao(), pullOk: false });
  await app.espera();
  app.t.createCollectionStore("pokemon").add("base1-4", "Normal", "NM", 1);
  app.t.flushWrites();
  app.dispara("pagehide");
  await app.espera();
  assert.equal(app.pushes.length, 0, "pull falho: nenhum push sem merge");
  const p = app.pendencia();
  assert.ok(p && p.g.includes("pokemon"), `a edição do Pokémon tinha de ficar devendo: ${JSON.stringify(p)}`);
});

test("boot com pull bom sobe o que ficou devendo e limpa a pendência", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: UID, g: ["pokemon"] }) }),
    linhas: []
  });
  await app.espera();
  assert.equal(app.pushes.length, 1, "o jogo devendo tinha de subir no boot");
  const linha = app.pushes[0].corpo.find((l) => l.game === "pokemon");
  assert.ok(linha && linha.data.collection && linha.data.collection["base1-4"], "a carta que só existia no aparelho tinha de ir pra nuvem");
  assert.equal(app.pendencia(), null);
});

test("pendência de OUTRA conta não sobe", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: "outra-conta", g: ["pokemon"] }) }),
    linhas: []
  });
  await app.espera();
  assert.equal(app.pushes.length, 0);
});

test("push do boot que falha mantém o jogo devendo", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: UID, g: ["pokemon"] }) }),
    linhas: [], pushOk: false
  });
  await app.espera();
  assert.ok(app.pushes.length >= 1);
  assert.deepEqual(app.pendencia(), { u: UID, g: ["pokemon"] });
});

test("saída sem nada editado não varre nem sobe; com edição, grava a pendência antes de enviar", async () => {
  const app = montaApp({ seed: comSessao(), linhas: [] });
  await app.espera();
  const antes = app.pushes.length;
  app.dispara("pagehide");
  await app.espera();
  assert.equal(app.pushes.length, antes, "saída sem edição não pode subir nada");
  app.dispara("pageshow"); // a página voltou (bfcache): pode sair de novo
  app.t.createCollectionStore("pokemon").add("base1-4", "Normal", "NM", 1);
  app.t.flushWrites();
  app.sandbox.document.visibilityState = "hidden";
  app.dispara("visibilitychange");
  app.dispara("pagehide"); // os dois juntos, como na navegação: UM push só
  await app.espera();
  assert.equal(app.pushes.length, antes + 1, "um push por saída");
  // O push confirmou: a pendência gravada antes do envio foi limpa.
  assert.equal(app.pendencia(), null);
});

test("keepalive só com corpo que cabe nos 64 KB do Fetch", () => {
  const { t } = montaApp({});
  assert.equal(t.comKeepalive(true, "x".repeat(1000)), true);
  assert.equal(t.comKeepalive(true, "x".repeat(30000)), false, "corpo grande com keepalive é recusado pelo navegador na hora");
  assert.equal(t.comKeepalive(false, "x"), false);
});

// ── Sync leve (2026-10-08) ──────────────────────────────────────────────────
// O boot de TODA página logada renovava o token e baixava as linhas inteiras
// de todos os jogos, mudasse algo ou não. Agora pede as versões (updated_at) e
// desce só a linha que mudou desde o que este aparelho viu.
const VISTO = "tcg-sync-visto-v1";
const DUAS_LINHAS = () => [
  { game: "pokemon", data: { collection: JSON.parse(UMA_CARTA) }, updated_at: "2026-10-08T10:00:00.000+00:00" },
  { game: "magic", data: { wishlist: { "mtg-lea-1": ["Normal"] } }, updated_at: "2026-10-08T11:00:00.000+00:00" }
];
const dados = (gets) => gets.filter((u) => !u.includes("select=game,updated_at"));

test("1º boot depois da troca: pede as versões, baixa as linhas e guarda o que viu", async () => {
  const app = montaApp({ seed: comSessao(), linhas: DUAS_LINHAS() });
  await app.espera();
  assert.ok(app.gets[0].includes("select=game,updated_at"), "primeiro as versões");
  assert.equal(dados(app.gets).length, 1);
  assert.match(dados(app.gets)[0], /game=in\.\((pokemon,magic|magic,pokemon)\)/, "só as linhas que existem");
  // As duas linhas trouxeram novidade pro aparelho (vazio) e subiram de volta
  // mescladas: o que fica visto é a versão que o push gravou na nuvem.
  const visto = JSON.parse(app.ls.getItem(VISTO));
  assert.equal(visto.u, UID);
  for (const g of ["pokemon", "magic"]) {
    assert.equal(visto.g[g], Date.parse(app.nuvem.find((l) => l.game === g).updated_at), `${g}: a versão da nuvem depois do boot`);
  }
});

test("linha baixada que não muda nada no aparelho conta como vista pela versão dela", async () => {
  const app = montaApp({ seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA }), linhas: [{ game: "pokemon", data: { collection: JSON.parse(UMA_CARTA) }, updated_at: "2026-10-08T10:00:00.000+00:00" }] });
  await app.espera();
  assert.equal(app.pushes.length, 0);
  assert.equal(JSON.parse(app.ls.getItem(VISTO)).g.pokemon, Date.parse("2026-10-08T10:00:00.000+00:00"));
});

test("boot com nada mudado na nuvem: só as versões, nenhuma linha inteira, nenhum push", async () => {
  const primeiro = montaApp({ seed: comSessao(), linhas: DUAS_LINHAS() });
  await primeiro.espera();
  const app = montaApp({ seed: { ...primeiro.store }, linhas: primeiro.nuvem });
  await app.espera();
  assert.equal(app.gets.length, 1, `pediu ${JSON.stringify(app.gets)}`);
  assert.equal(app.pushes.length, 0);
  assert.equal(app.tokens.length, 0, "token com menos de 50 min não é renovado");
});

test("linha que mudou em OUTRO aparelho: desce só ela", async () => {
  const primeiro = montaApp({ seed: comSessao(), linhas: DUAS_LINHAS() });
  await primeiro.espera();
  const nuvem = primeiro.nuvem.map((l) => (l.game === "magic" ? { ...l, data: { wishlist: { "mtg-lea-1": ["Normal"], "mtg-lea-2": ["Normal"] } }, updated_at: "2026-10-08T12:00:00.000+00:00" } : l));
  const app = montaApp({ seed: { ...primeiro.store }, linhas: nuvem });
  await app.espera();
  assert.equal(dados(app.gets).length, 1);
  assert.match(dados(app.gets)[0], /game=in\.\(magic\)/);
  assert.ok(JSON.parse(app.ls.getItem("tcg-collector-magic-wishlist-v1"))["mtg-lea-2"], "a novidade da outra máquina chegou");
});

// O 1º boot de um aparelho vazio traz novidade e RECARREGA a página (sem
// ligar o laço); quem edita e sai é a página seguinte, que abre sem novidade.
async function aparelhoEmDia(linhas) {
  const primeiro = montaApp({ seed: comSessao(), linhas });
  await primeiro.espera();
  const app = montaApp({ seed: { ...primeiro.store }, linhas: primeiro.nuvem });
  await app.espera();
  assert.equal(app.reloads.length, 0, "a 2ª página abre sem novidade");
  assert.equal(app.intervalos.length, 1, "e com o laço de sync ligado");
  return app;
}
const sai = async (app) => { app.sandbox.document.visibilityState = "hidden"; app.dispara("visibilitychange"); await app.espera(); };

test("o push confirmado guarda a versão que gravou: o boot seguinte não baixa a própria edição", async () => {
  const app = await aparelhoEmDia(DUAS_LINHAS());
  app.t.createCollectionStore("pokemon").add("base1-2", "Normal", "NM", 1);
  app.t.flushWrites();
  await sai(app);
  assert.equal(app.pushes.length, 1, "a edição subiu na saída");
  const seguinte = montaApp({ seed: { ...app.store }, linhas: app.nuvem });
  await seguinte.espera();
  assert.equal(dados(seguinte.gets).length, 0, `baixou de novo o que acabou de subir: ${JSON.stringify(seguinte.gets)}`);
});

test("edição numa chave GLOBAL sobe só as linhas que existem, não os 22 jogos", async () => {
  const app = await aparelhoEmDia(DUAS_LINHAS());
  // Um binder novo (chave global: muda o snapshot dos 22 jogos) e uma carta,
  // que é o que acorda o laço (a escrita direta do binder não passa pelo
  // scheduleWrite).
  app.ls.setItem("tcg-collector-binders-all-v1", JSON.stringify({ binders: [{ id: "b1", name: "x", slots: [] }] }));
  app.t.createCollectionStore("pokemon").add("base1-3", "Normal", "NM", 1);
  app.t.flushWrites();
  await sai(app);
  const subiram = app.pushes.flatMap((p) => [].concat(p.corpo).map((l) => l.game)).sort();
  assert.deepEqual(subiram, ["magic", "pokemon"], "as duas linhas que existem levam o binder; os outros 20 jogos não ganham linha");
});

test("token velho (> 50 min) renova antes do pull; token recusado (401) renova e tenta de novo", async () => {
  const velho = montaApp({ seed: comSessao({ [SESSAO]: JSON.stringify({ access_token: "t1", refresh_token: "r1", user: { id: UID, email: "a@b.c" }, ts: Date.now() - 3600e3 }) }), linhas: DUAS_LINHAS() });
  await velho.espera();
  assert.equal(velho.tokens.length, 1);
  const recusado = montaApp({ seed: comSessao(), linhas: DUAS_LINHAS(), marcas401: 1 });
  await recusado.espera();
  assert.equal(recusado.tokens.length, 1, "o 401 renovou o token");
  assert.equal(recusado.gets.filter((u) => u.includes("select=game,updated_at")).length, 2, "e pediu as versões de novo");
  assert.ok(recusado.ls.getItem(VISTO), "o boot seguiu até o fim");
});

test("renovação com a nuvem soluçando (5xx/429) não desloga; 400/401 desloga", async () => {
  const velhaSessao = () => comSessao({ [SESSAO]: JSON.stringify({ access_token: "t1", refresh_token: "r1", user: { id: UID, email: "a@b.c" }, ts: Date.now() - 3600e3 }) });
  for (const status of [503, 429]) {
    const app = montaApp({ seed: velhaSessao(), linhas: [], tokenStatus: status });
    await app.espera();
    assert.ok(app.ls.getItem(SESSAO), `HTTP ${status} na renovação deslogou`);
  }
  for (const status of [400, 401]) {
    const app = montaApp({ seed: velhaSessao(), linhas: [], tokenStatus: status });
    await app.espera();
    assert.equal(app.ls.getItem(SESSAO), null, `HTTP ${status} na renovação tinha de deslogar`);
  }
});

// Cota cheia (iPhone perto do teto): o mesclado não cabe no aparelho. Desde que
// o writeSnapshot deixou de lançar (pra pílula "Carregando" não ficar presa),
// o boot seguia: recarregava a página — e o boot seguinte mesclava e de novo
// não gravava, em laço — e ligava o laço de sync, que subiria o local VELHO por
// cima da nuvem.
test("linha que não coube no aparelho (cota cheia): sobe o mesclado, não recarrega, não liga o laço, não conta como vista", async () => {
  const grande = { game: "pokemon", data: { collection: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`base1-${i + 1}`, { Normal: { NM: 1 } }])) } };
  const app = montaApp({ seed: comSessao(), linhas: [grande], cota: 200 });
  await app.espera();
  const visto = JSON.parse(app.ls.getItem(VISTO) || "null");
  assert.ok(!visto || visto.g.pokemon === undefined, "o próximo boot tem de baixar a linha e tentar gravar de novo");
  assert.equal(app.reloads.length, 0, "recarregar aqui entra em laço");
  assert.equal(app.intervalos.length, 0, "o laço de sync subiria o local velho por cima da nuvem");
  const subiu = app.pushes.flatMap((p) => [].concat(p.corpo)).find((l) => l.game === "pokemon");
  assert.ok(subiu && Object.keys(subiu.data.collection).length === 50, "o mesclado (em memória) sobe inteiro");
});
