// Vitrine — o espaço de anúncio das páginas de catálogo (src/ads.js) e os
// afiliados dos links de loja (shared.js). docs/PLANO-ADS.md, fase 0.
//
// O que se trava aqui:
//   - a regra de posição: nunca na 1ª tela, só em começo de linha, nunca logo
//     depois de um cabeçalho, teto por página — é a promessa de "não atrapalhar";
//   - a config (/data/ads.json) é tolerante: formato errado desliga ou cai no
//     padrão, nunca quebra a página; e a que vai no repositório é válida;
//   - a escolha de criativo: parceiro antes da casa, segmentação por jogo e
//     data, teto por dia da casa, "crie sua conta" só pra quem não tem;
//   - afiliado vazio = link idêntico ao de sempre (e sem a nota de comissão);
//     preenchido = deep link/campid, rel="sponsored" e a nota;
//   - o site não depende do ads.js (adblock que o bloqueie não quebra nada);
//   - a migração nova é só de admin e a whitelist tem os dois eventos.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

// O módulo carregado SEM TCGShared: expõe as regras puras e para antes de
// tocar na página (é o mesmo caminho de quando o shared.js falha).
function carregaVitrine() {
  const sandbox = { console, document: { currentScript: null } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler("src/ads.js"), sandbox);
  return sandbox.window.TCGVitrine;
}
const V = carregaVitrine();
// Arrays do outro realm do vm: copiar antes do deepEqual (ver centering.test).
const arr = (x) => JSON.parse(JSON.stringify(x));

// Grade de `cols` colunas, `linhas` linhas de `altura` px (topo de cada item).
function grade(cols, linhas, altura) {
  const tops = [];
  for (let l = 0; l < linhas; l++) for (let c = 0; c < cols; c++) tops.push(l * altura);
  return tops;
}
const DESKTOP = { primeira: 1.6, intervalo: 4.4, max: 3 };

test("posição: nunca na 1ª tela, só em começo de linha, com intervalo entre faixas", () => {
  // 5 colunas, linhas de 500 px, tela de 900: a 1ª faixa só depois de 1440 px
  // (1,6 tela) — cai no começo da 4ª linha (item 15, topo 1500); a 2ª, 4,4
  // telas depois (5460) — começo da 12ª linha (item 55, topo 5500).
  const idx = arr(V.posicoesNaGrade(grade(5, 20, 500), 900, DESKTOP));
  assert.deepEqual(idx, [15, 55, 95]);
  for (const i of idx) assert.equal(i % 5, 0, `faixa no meio da linha (item ${i})`);
});

test("posição: a mesma regra vale na lista (uma carta por linha)", () => {
  // linhas de 60 px: 1,6 tela de 900 = 1440 px = 24 linhas.
  assert.deepEqual(arr(V.posicoesNaGrade(grade(1, 200, 60), 900, { primeira: 1.6, intervalo: 4.4, max: 1 })), [24]);
});

test("posição: teto por página, grade curta e regra desligada", () => {
  assert.equal(V.posicoesNaGrade(grade(5, 200, 500), 900, DESKTOP).length, 3);
  assert.deepEqual(arr(V.posicoesNaGrade(grade(5, 2, 500), 900, DESKTOP)), [], "set curto não ganha faixa");
  assert.deepEqual(arr(V.posicoesNaGrade(grade(5, 20, 500), 900, { primeira: 1.6, intervalo: 4.4, max: 0 })), []);
  assert.deepEqual(arr(V.posicoesNaGrade([], 900, DESKTOP)), []);
  assert.deepEqual(arr(V.posicoesNaGrade(grade(5, 20, 500), 0, DESKTOP)), [], "sem altura de tela, sem conta");
});

test("posição: nunca logo depois de um cabeçalho (mês, série)", () => {
  const tops = grade(1, 60, 60);
  const permitido = tops.map(() => true);
  permitido[24] = false; // o item 24 vem logo depois de um <h2>
  assert.deepEqual(arr(V.posicoesNaGrade(tops, 900, { primeira: 1.6, intervalo: 4.4, max: 1 }, permitido)), [25]);
});

test("config: desligada, lixo e formato errado nunca quebram", () => {
  assert.equal(V.configValida(null), null);
  assert.equal(V.configValida({ ativo: false, criativos: [{ id: "apoie", tipo: "casa" }] }), null, "ativo:false é o kill switch");
  assert.equal(V.configValida({ ativo: "sim" }), null, "só true liga");
  const c = V.configValida({ ativo: true, criativos: "x", regras: 7, porDia: "muito", pix: "<script>", kofi: "https://evil.example/x" });
  assert.deepEqual(arr(c.criativos), []);
  assert.deepEqual(arr(c.regras.desktop), { primeira: 1.6, intervalo: 4.4, max: 3 });
  assert.equal(c.porDia, 4);
  assert.equal(c.pix, "");
  assert.equal(c.kofi, "", "Ko-fi só em ko-fi.com");
});

test("config: teto de 3 faixas e números fora da faixa são presos", () => {
  const c = V.configValida({ ativo: true, regras: { celular: { primeira: 0, intervalo: 999, max: 99 } } });
  assert.deepEqual(arr(c.regras.celular), { primeira: 1, intervalo: 40, max: 3 });
});

test("config: parceiro só com https, imagem do próprio site e id válido", () => {
  const ok = { id: "loja-x", tipo: "parceiro", href: "https://loja.example/p", alt: "Loja X", imagens: { faixa: "/assets/partners/loja-x-v1.webp", quadrado: "/assets/partners/loja-x-q-v1.webp" }, jogos: ["pokemon"], ate: "2026-12-31" };
  const cfg = (c) => V.configValida({ ativo: true, criativos: [c] }).criativos;
  assert.equal(cfg(ok).length, 1);
  assert.equal(cfg({ ...ok, href: "http://loja.example" }).length, 0, "http puro não");
  assert.equal(cfg({ ...ok, imagens: { ...ok.imagens, faixa: "https://cdn.loja.example/b.png" } }).length, 0, "imagem de fora quebraria o img-src 'self' e traria pixel");
  assert.equal(cfg({ ...ok, id: "Loja X!" }).length, 0, "id fora do padrão que a RPC aceita");
  assert.equal(cfg({ id: "instalar", tipo: "casa" }).length, 0, "casa só com os criativos conhecidos");
  const dup = V.configValida({ ativo: true, criativos: [{ id: "apoie", tipo: "casa" }, { id: "apoie", tipo: "casa", peso: 9 }] }).criativos;
  assert.equal(dup.length, 1, "id repetido entra uma vez");
});

test("config do repositório: válida, ligada, e o AdSense só entra na cadeia com ca-pub e bloco", () => {
  const bruto = JSON.parse(ler("data/ads.json"));
  const cfg = V.configValida(bruto);
  assert.ok(cfg, "data/ads.json não passa na validação — a vitrine sumiria em produção");
  assert.ok(cfg.criativos.length >= 2);
  assert.ok(cfg.pix && cfg.kofi && cfg.contato, "apoie/anuncie sem os dados de contato");
  // Sem o ca-pub, o AdSense sai da cadeia — e é isso que mantém o aviso de
  // consentimento dormente. Com ele, tem de estar lá.
  assert.equal(arr(cfg.fornecedores).includes("adsense"), !!cfg.adsense);
  if (!bruto.adsense || !bruto.adsense.cliente) assert.equal(cfg.adsense, null);
});

test("config: AdSense só com ca-pub de 16 dígitos e data-ad-slot numérico", () => {
  const cfg = (adsense) => V.configValida({ ativo: true, fornecedores: ["parceiro", "adsense", "casa"], adsense });
  const ok = cfg({ cliente: "ca-pub-1234567890123456", blocos: { faixa: "1234567890", quadrado: "abc", trilho: "" } });
  assert.deepEqual(arr(ok.adsense), { cliente: "ca-pub-1234567890123456", blocos: { faixa: "1234567890" } }, "bloco inválido fica de fora");
  assert.deepEqual(arr(ok.fornecedores), ["parceiro", "adsense", "casa"]);
  for (const ruim of [{ cliente: "pub-1234567890123456", blocos: { faixa: "1234567890" } }, { cliente: "ca-pub-123", blocos: { faixa: "1234567890" } },
    { cliente: "ca-pub-1234567890123456", blocos: {} }, { cliente: "ca-pub-1234567890123456\"><script>", blocos: { faixa: "1" } }, null]) {
    const c = cfg(ruim);
    assert.equal(c.adsense, null, JSON.stringify(ruim));
    assert.ok(!arr(c.fornecedores).includes("adsense"), "sem IDs válidos o AdSense sai da cadeia");
  }
});

test("escolha: rede liberada ocupa o que o parceiro deixou; sem ela, a casa", () => {
  const ordem = ["parceiro", "adsense", "casa"];
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, { ...CTX, adsense: true }, 3, ordem, primeiro)), ["loja-poke", "adsense", "adsense"]);
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, { ...CTX, adsense: false }, 3, ordem, primeiro)), ["loja-poke", "conta", "apoie"]);
});

test("rede só com aceite, fora da UE/UK/CH, com a página vinda da borda e sem economia de dados", () => {
  const cfg = V.configValida({ ativo: true, fornecedores: ["adsense", "casa"], adsense: { cliente: "ca-pub-1234567890123456", blocos: { faixa: "1234567890" } } });
  const base = { cfg, consentiu: true, pais: "BR", economia: false };
  assert.equal(V.adsenseLiberado(base), true);
  assert.equal(V.adsenseLiberado({ ...base, pais: "US" }), true);
  assert.equal(V.adsenseLiberado({ ...base, consentiu: false }), false, "recusou (ou não respondeu) = nem o script do Google");
  for (const pais of ["DE", "FR", "PT", "ES", "GB", "CH", "NO", "IS", "LI"]) assert.equal(V.adsenseLiberado({ ...base, pais }), false, pais);
  assert.equal(V.adsenseLiberado({ ...base, pais: "" }), false, "sem data-pais a página não veio com a CSP de nonce");
  assert.equal(V.adsenseLiberado({ ...base, economia: true }), false);
  assert.equal(V.adsenseLiberado({ ...base, cfg: V.configValida({ ativo: true }) }), false, "sem ca-pub, dormente");
});

test("formato da faixa: 728×90 só onde cabe; abaixo disso, 300×250", () => {
  assert.equal(V.formatoDaFaixa(1385), "faixa");
  assert.equal(V.formatoDaFaixa(760), "faixa");
  assert.equal(V.formatoDaFaixa(759), "quadrado");
  assert.equal(V.formatoDaFaixa(318), "quadrado", "celular de 390 px");
});

test("ads.txt, meta de verificação e config falam do MESMO pub", () => {
  const cliente = (JSON.parse(ler("data/ads.json")).adsense || {}).cliente || "";
  const linhas = ler("ads.txt").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const meta = /<meta name="google-adsense-account" content="([^"]+)">/.exec(ler("index.html"));
  if (!cliente) {
    assert.deepEqual(linhas, [], "ads.txt autorizando vendedor sem o AdSense ligado");
    assert.equal(meta, null, "meta de verificação sem ca-pub na config");
    return;
  }
  const pub = cliente.replace(/^ca-/, "");
  assert.ok(linhas.includes(`google.com, ${pub}, DIRECT, f08c47fec0942fa0`), `ads.txt sem a linha do ${pub} — o AdSense marca "ganhos em risco"`);
  assert.ok(meta && meta[1] === cliente, "index.html sem <meta name=\"google-adsense-account\"> do mesmo ca-pub");
});

const CTX = { jogo: "pokemon", idioma: "pt", hoje: "2026-10-10", logado: false, temKofi: true, vistosHoje: {}, porDia: 4 };
const primeiro = () => 0; // sorteio determinístico: sempre o primeiro da fila
const CRIATIVOS = V.configValida({
  ativo: true,
  criativos: [
    { id: "conta", tipo: "casa", peso: 4 }, { id: "apoie", tipo: "casa", peso: 3 }, { id: "anuncie", tipo: "casa", peso: 1 },
    { id: "loja-poke", tipo: "parceiro", href: "https://a.example", imagens: { faixa: "/assets/partners/a.webp", quadrado: "/assets/partners/a-q.webp" }, jogos: ["pokemon"], desde: "2026-10-01", ate: "2026-10-31" },
    { id: "loja-magic", tipo: "parceiro", href: "https://b.example", imagens: { faixa: "/assets/partners/b.webp", quadrado: "/assets/partners/b-q.webp" }, jogos: ["magic"] }
  ]
}).criativos;
const ids = (lista) => Array.from(lista, (c) => c.id);

test("escolha: parceiro antes da casa, só no jogo e na janela dele, sem repetir", () => {
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, CTX, 3, ["parceiro", "casa"], primeiro)), ["loja-poke", "conta", "apoie"]);
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, { ...CTX, hoje: "2026-11-01" }, 1, ["parceiro", "casa"], primeiro)), ["conta"], "campanha vencida não entra");
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, { ...CTX, jogo: "lorcana" }, 5, ["parceiro", "casa"], primeiro)), ["conta", "apoie", "anuncie"], "loja de outro jogo não aparece");
});

test("escolha: quem tem conta não vê 'crie sua conta'; a casa tem teto por dia", () => {
  assert.ok(!ids(V.escolheCriativos(CRIATIVOS, { ...CTX, logado: true }, 5, ["casa"], primeiro)).includes("conta"));
  const cansado = { ...CTX, vistosHoje: { conta: 4, apoie: 4 } };
  assert.deepEqual(ids(V.escolheCriativos(CRIATIVOS, cansado, 5, ["casa"], primeiro)), ["anuncie"]);
});

test("escolha: fora do português, 'apoie' só existe se houver Ko-fi (Pix é do Brasil)", () => {
  assert.ok(!ids(V.escolheCriativos(CRIATIVOS, { ...CTX, idioma: "en", temKofi: false }, 5, ["casa"], primeiro)).includes("apoie"));
  assert.ok(ids(V.escolheCriativos(CRIATIVOS, { ...CTX, idioma: "en", temKofi: true }, 5, ["casa"], primeiro)).includes("apoie"));
});

test("escolha: o sorteio respeita o peso", () => {
  // r = 0,99 × 8 (4+3+1) cai no último da fila; r = 0,5 × 8 = 4 cai no 2º.
  assert.equal(V.escolheCriativos(CRIATIVOS, CTX, 1, ["casa"], () => 0.99)[0].id, "anuncie");
  assert.equal(V.escolheCriativos(CRIATIVOS, CTX, 1, ["casa"], () => 0.5)[0].id, "apoie");
});

// ── Afiliados (shared.js) ────────────────────────────────────────────────────
const api = loadShared("window.__test = { linkDeLoja, brMarketplaceLinks, AFILIADOS };").window.__test;
const carta = { id: "sv1-25", name: "Pikachu", number: "25", setTotal: 198, game: "pokemon" };
const hrefs = (html) => {
  const o = {};
  for (const m of html.matchAll(/data-mkt="([a-z]+)" href="([^"]+)" target="_blank" rel="([^"]+)"/g)) o[m[1]] = { href: m[2].replace(/&amp;/g, "&"), rel: m[3] };
  return o;
};

test("afiliado vazio: links idênticos aos de sempre, sem sponsored e sem nota", () => {
  assert.equal(api.AFILIADOS.tcgplayer, "", "o repositório não pode subir com ID de afiliado de teste");
  assert.equal(api.AFILIADOS.ebay, "");
  const html = api.brMarketplaceLinks(carta);
  assert.doesNotMatch(html, /sponsored/);
  assert.doesNotMatch(html, /price\.affiliateNote/);
  const h = hrefs(html);
  assert.match(h.tcgplayer.href, /^https:\/\/www\.tcgplayer\.com\/search\//);
  assert.doesNotMatch(h.ebay.href, /campid/);
});

test("afiliado preenchido: deep link do Impact, campid do eBay, rel=sponsored e a nota", () => {
  const af = { tcgplayer: "https://partner.tcgplayer.com/c/1234567/1830156/21018", ebay: "5338123456" };
  const busca = "https://www.tcgplayer.com/search/pokemon/product?q=pikachu";
  assert.equal(api.linkDeLoja("tcgplayer", busca, af), `${af.tcgplayer}?u=${encodeURIComponent(busca)}`);
  const ebay = api.linkDeLoja("ebay", "https://www.ebay.com/sch/i.html?_nkw=pikachu", af);
  assert.match(ebay, /\?_nkw=pikachu&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5338123456&toolid=10001&mkevt=1$/);
  assert.match(api.linkDeLoja("ebaysold", "https://www.ebay.com/sch/i.html?_nkw=x&LH_Sold=1", af), /campid=5338123456/);
  // ID fora do formato é ignorado (link cru, em vez de um link de rastreio quebrado)
  assert.equal(api.linkDeLoja("tcgplayer", busca, { tcgplayer: "https://partner.tcgplayer.com/c/abc", ebay: "123" }), busca);
  assert.equal(api.linkDeLoja("ebay", "https://www.ebay.com/sch/i.html?_nkw=x", { tcgplayer: "", ebay: "123" }), "https://www.ebay.com/sch/i.html?_nkw=x");
  // Loja BR nunca vira afiliado: continua só com o utm.
  assert.match(api.linkDeLoja("liga", "https://www.ligapokemon.com.br/?view=cards/search&card=x", af), /&utm_source=sleevu&utm_medium=referral$/);

  // No bloco inteiro (mesmo objeto do closure do shared.js): rel e nota.
  Object.assign(api.AFILIADOS, af);
  try {
    const html = api.brMarketplaceLinks(carta);
    const h = hrefs(html);
    assert.equal(h.tcgplayer.rel, "sponsored noopener");
    assert.equal(h.ebay.rel, "sponsored noopener");
    assert.equal(h.liga.rel, "noopener", "utm não é afiliado");
    assert.equal(h.pricecharting.rel, "noopener");
    assert.match(html, /<p class="market-source">price\.affiliateNote<\/p><\/div>$/);
  } finally {
    Object.assign(api.AFILIADOS, { tcgplayer: "", ebay: "" });
  }
});

// ── Independência e banco ─────────────────────────────────────────────────────
test("o site não depende do ads.js (adblock que o bloqueie não quebra nada)", () => {
  for (const f of readdirSync(join(raiz, "src")).filter((f) => f.endsWith(".js") && f !== "ads.js")) {
    assert.doesNotMatch(ler(join("src", f)), /TCGVitrine|vtr-espaco/, `${f} depende da vitrine`);
  }
  // E o script é o último da página: roda depois do que desenha a grade.
  for (const f of readdirSync(raiz).filter((f) => f.endsWith(".html"))) {
    const scripts = [...ler(f).matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    if (!scripts.includes("src/ads.js")) continue; // (o faq.html só CITA o arquivo num comentário)
    assert.equal(scripts[scripts.length - 1], "src/ads.js", `${f}: o ads.js tem que ser o último script`);
  }
});

test("a CSP global (_headers) segue sem rede de anúncio: a de nonce é só das páginas com vitrine", () => {
  // A CSP com nonce é por ROTA (functions/_vitrine-csp.js) — nunca um
  // afrouxamento global do script-src, que valeria no login e na coleção.
  assert.doesNotMatch(ler("_headers"), /googlesyndication|doubleclick|adservice|fundingchoices|strict-dynamic/);
});

// ── CSP de nonce na borda (functions/_vitrine-csp.js) ─────────────────────────
const csp = await import(new URL("../functions/_vitrine-csp.js", import.meta.url));
const CSP_BASE = /Content-Security-Policy: (.+)/.exec(ler("_headers"))[1];
const diretiva = (pol, nome) => (pol.split(";").map((d) => d.trim()).find((d) => d.startsWith(nome + " ")) || "").split(/\s+/).slice(1);

test("CSP de nonce: o que o AdSense pede, a partir da CSP de verdade do _headers", () => {
  const pol = csp.cspComNonce(CSP_BASE, "QUJDREVGR0hJSktMTU5PUA==");
  assert.deepEqual(diretiva(pol, "script-src").slice(0, 2), ["'nonce-QUJDREVGR0hJSktMTU5PUA=='", "'strict-dynamic'"]);
  assert.ok(diretiva(pol, "script-src").includes("'wasm-unsafe-eval'"), "o scanner de carta (WASM) quebraria nas páginas de catálogo");
  for (const d of ["img-src", "frame-src", "connect-src"]) assert.ok(diretiva(pol, d).includes("https:"), d);
  // O que protege continua igual ao do resto do site.
  for (const d of ["default-src", "object-src", "frame-ancestors", "base-uri", "form-action", "worker-src"]) {
    assert.deepEqual(diretiva(pol, d), diretiva(CSP_BASE, d), `${d} mudou`);
  }
  assert.equal(pol.split(";").length, CSP_BASE.split(";").length, "diretiva sumiu ou duplicou");
});

test("nonce: 16 bytes aleatórios, novo a cada página", () => {
  const a = csp.nonceNovo(), b = csp.nonceNovo();
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(a, b);
});

test("toda página com vitrine passa pela CSP de nonce na borda, e só elas", () => {
  const comVitrine = readdirSync(raiz).filter((f) => f.endsWith(".html") && [...ler(f).matchAll(/<script[^>]*src="([^"]+)"/g)].some((m) => m[1] === "src/ads.js"));
  assert.ok(comVitrine.length >= 9);
  for (const f of comVitrine) {
    const pagina = f.replace(/\.html$/, "");
    const fn = ler(`functions/${pagina}.js`);
    if (pagina === "detail") assert.match(fn, /return comVitrine\(await montaDetail\(env, request\), request\)/, "detail.js sem o nonce");
    else assert.match(fn, new RegExp(`paginaComVitrine\\(context, "/${pagina}\\.html"\\)`), `functions/${pagina}.js não serve o ${f} com nonce`);
  }
  // Nenhuma Function aplica a CSP de anúncio numa página SEM vitrine.
  for (const f of readdirSync(join(raiz, "functions")).filter((f) => f.endsWith(".js") && !f.startsWith("_"))) {
    const m = /paginaComVitrine\(context, "\/([\w-]+)\.html"\)/.exec(ler(join("functions", f)));
    if (m) assert.ok(comVitrine.includes(`${m[1]}.html`), `functions/${f} dá CSP de anúncio pra ${m[1]}.html, que não tem vitrine`);
  }
});

test("theme.js repassa o nonce ao <script> do idioma que escreve", () => {
  // Com 'strict-dynamic', script escrito por document.write só roda com nonce:
  // sem isto o site inteiro ficava sem tradução nas páginas de catálogo.
  const theme = ler("src/theme.js");
  assert.match(theme, /document\.currentScript/);
  assert.match(theme, /nonce="' \+ nonce \+ '"/);
});

test("migração 20260927a: RPC só de admin e os dois eventos na whitelist", () => {
  const sql = ler("supabase/migrations/20260927a_vitrine.sql");
  assert.match(sql, /'ad_view', 'ad_click'/);
  assert.match(sql, /create or replace function public\.admin_vitrine\(days int default 30\)[\s\S]*?if not _is_admin\(\) then return null; end if;/);
  assert.match(sql, /revoke all on function public\.admin_vitrine\(int\) from public, anon;/);
  assert.doesNotMatch(sql, /grant execute on function public\.admin_vitrine\(int\) to anon/);
  // Prop que vem do cliente não é confiável: nada de jsonb_array_elements sem
  // checar o tipo, senão um POST forjado derruba o painel.
  assert.match(sql, /jsonb_typeof\(props->'sv'\) = 'array'/);
  assert.match(sql, /jsonb_typeof\(props->'v'\)\s+= 'array'/);
});

// ── Apoiador sem anúncio (20260928c) ─────────────────────────────────────────
test("apoio vale até o fim do dia gravado; formato errado não vale", () => {
  assert.equal(V.apoioVigente("2026-10-27", "2026-10-27"), true, "último dia ainda vale");
  assert.equal(V.apoioVigente("2026-10-27", "2026-10-28"), false, "venceu");
  assert.equal(V.apoioVigente("2027-01-02", "2026-12-31"), true, "virada de ano");
  for (const ruim of [null, undefined, "", "2026-10-7", "27/10/2026", 20261027, "9999-99-99x"]) {
    assert.equal(V.apoioVigente(ruim, "2026-10-01"), false, String(ruim));
  }
});

test("apoio no cache: quem apoia some com tudo na hora; o resto reconfere com o banco", () => {
  const H = 60 * 60 * 1000, agora = 1_800_000_000_000, dia = "2026-10-01";
  const d = (cache, uid = "u1") => arr(V.apoioDoCache(cache, uid, dia, agora));
  assert.deepEqual(d(null, ""), { apoia: false, confere: false }, "deslogado: nem pergunta");
  assert.deepEqual(d(null), { apoia: false, confere: true }, "logado sem cache: pergunta e ESPERA");
  assert.deepEqual(d({ u: "u1", ate: "2026-10-20", ts: agora - H }), { apoia: true, confere: false }, "apoia: decide sem rede");
  assert.deepEqual(d({ u: "u1", ate: "2026-10-20", ts: agora - 7 * H }), { apoia: true, confere: true }, "apoia, cache velho: reconfere em 2º plano");
  assert.deepEqual(d({ u: "u1", ate: "", ts: agora - H / 2 }), { apoia: false, confere: false }, "não apoia, visto há 30 min");
  assert.deepEqual(d({ u: "u1", ate: "", ts: agora - 2 * H }), { apoia: false, confere: true }, "não apoia, visto há 2 h: reconfere");
  assert.deepEqual(d({ u: "u1", ate: "2026-09-30", ts: agora - H / 2 }), { apoia: false, confere: false }, "venceu ontem: anúncio de volta");
  assert.deepEqual(d({ u: "outra", ate: "2026-10-20", ts: agora }), { apoia: false, confere: true }, "cache de OUTRA conta no mesmo aparelho não vale");
  assert.deepEqual(d({ u: "u1", ate: "", ts: agora + H }), { apoia: false, confere: true }, "relógio que voltou: reconfere");
});

test("apoiador: o ads.js pergunta ao banco antes de montar e o shared.js deixa passar só apoio_*", () => {
  const ads = ler("src/ads.js");
  assert.match(ads, /adminRpc\("apoio_status", 0, \{\}\)/);
  assert.match(ads, /if \(cfg && !apoia\) inicia\(cfg\)/, "quem apoia não passa pelo inicia (nem aviso, nem ad_view)");
  const shared = ler("src/shared.js");
  assert.match(shared, /if \(!\/\^\(admin\|apoio\)_\[a-z_\]\+\$\/\.test\(nome\)\) return null;/);
});

test("migração 20260928c: tabela trancada, leitura só da própria data, escrita só de admin", () => {
  const sql = ler("supabase/migrations/20260928c_apoiador.sql");
  assert.match(sql, /references auth\.users \(id\) on delete cascade/, "apagar a conta leva a linha junto");
  assert.match(sql, /alter table public\.apoiadores enable row level security;/);
  assert.match(sql, /revoke all on public\.apoiadores from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant [a-z, ]+ on (table )?public\.apoiadores/i, "nenhum acesso direto à tabela pela API");
  assert.doesNotMatch(sql, /create policy/i, "sem policy: a tabela só é lida pelas RPCs");
  assert.match(sql, /select ate from apoiadores where user_id = auth\.uid\(\)/, "apoio_status devolve só a própria linha");
  for (const f of ["admin_apoiador", "admin_apoiadores"]) {
    assert.match(sql, new RegExp(`function public\\.${f}\\([\\s\\S]*?if not _is_admin\\(\\) then return null; end if;`), f);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to anon`), f);
  }
  assert.doesNotMatch(sql, /grant execute on function public\.apoio_status\(\) to anon/);
});
