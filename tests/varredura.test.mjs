// Varredura pós-deploy (D8 do docs/PLANO-TECNICO.md): a parte que DECIDE.
//
// O script (scripts/varredura-producao.mjs) precisa de navegador e de
// produção; o que ele conclui sai do scripts/lib/varredura.mjs, que é puro e
// é conferido aqui. Os casos são os da passada técnica de 2026-10-02: o logo
// de loja que dava 404 na home (S9), a imagem que o espelho ainda não tem
// (S10, aviso), o 103 com o CSS de outra leva (S4) e as telas que pulavam
// (S3). Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITE_CLS, APARELHOS, PAGINAS_PRODUCAO, PAGINAS_LOCAIS, CAMINHOS_EARLY_HINTS,
  ehNosso, classificaResposta, clsDasEntradas, blocosDoCurl, ativosComHash,
  confereEarlyHints, jserrorsDoCorpo, consolida, montaRelatorio
} from "../scripts/lib/varredura.mjs";

const BASE = "https://sleevu.app";

test("arquivo nosso: mesma origem ou o espelho de imagens", () => {
  assert.equal(ehNosso("https://sleevu.app/src/shared.8ecb73ce.js", BASE), true);
  assert.equal(ehNosso("https://img.sleevu.app/assets.tcgdex.net/x@200.webp", BASE), true);
  assert.equal(ehNosso("https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/card_views", BASE), false);
  assert.equal(ehNosso("https://assets.tcgdex.net/en/base/base1/4/low.webp", BASE), false);
  // Subdomínio que não é o espelho não é "nosso" por tabela.
  assert.equal(ehNosso("https://www.sleevu.app/", BASE), false);
  assert.equal(ehNosso("lixo", BASE), false);
});

test("resposta: 404 de arquivo nosso reprova; terceiro e espelho só avisam", () => {
  assert.equal(classificaResposta({ url: BASE + "/", status: 200, tipo: "document" }, BASE), null);
  assert.equal(classificaResposta({ url: BASE + "/x", status: 304, tipo: "document" }, BASE), null);

  // S9: o logo de loja que não existe.
  const logo = classificaResposta({ url: BASE + "/assets/shops/shop_myp.webp", status: 404, tipo: "image" }, BASE);
  assert.equal(logo.nivel, "falha");
  assert.match(logo.motivo, /404 \/assets\/shops\/shop_myp\.webp/);

  // S6: o script de leva que saiu do ar.
  assert.equal(classificaResposta({ url: BASE + "/src/boot.0000aaaa.js", status: 404, tipo: "script" }, BASE).nivel, "falha");
  assert.equal(classificaResposta({ url: BASE + "/api/search?q=x", status: 500, tipo: "fetch" }, BASE).nivel, "falha");

  // S10: o espelho sem a imagem — a cadeia cai na fonte original.
  const espelho = classificaResposta({ url: "https://img.sleevu.app/assets.tcgdex.net/x@200.webp", status: 404, tipo: "image" }, BASE);
  assert.equal(espelho.nivel, "aviso");
  // Mas o espelho servindo outra coisa (não imagem) com erro é nosso de verdade.
  assert.equal(classificaResposta({ url: "https://img.sleevu.app/manifest.json", status: 500, tipo: "fetch" }, BASE).nivel, "falha");

  assert.equal(classificaResposta({ url: "https://economia.awesomeapi.com.br/last/USD-BRL", status: 429, tipo: "fetch" }, BASE).nivel, "aviso");
  assert.equal(classificaResposta({ url: BASE + "/cdn-cgi/challenge-platform/scripts/jsd/main.js", status: 403, tipo: "script" }, BASE).nivel, "aviso");
});

test("resposta no site local: o que só o deploy gera não reprova (e em produção reprova)", () => {
  const preco = { url: "http://127.0.0.1:8899/data/magic/pricing.js", status: 404, tipo: "script" };
  assert.equal(classificaResposta(preco, "http://127.0.0.1:8899", { local: true }), null);
  assert.equal(classificaResposta(preco, "http://127.0.0.1:8899").nivel, "falha");
  const busca = { url: "http://127.0.0.1:8899/api/search?q=x", status: 405, tipo: "fetch" };
  assert.equal(classificaResposta(busca, "http://127.0.0.1:8899", { local: true }), null);
  // O resto do site local continua valendo.
  assert.equal(classificaResposta({ url: "http://127.0.0.1:8899/src/shared.js", status: 404, tipo: "script" }, "http://127.0.0.1:8899", { local: true }).nivel, "falha");
});

test("CLS: maior janela de sessão, sem o que veio de toque", () => {
  assert.equal(clsDasEntradas([]), 0);
  assert.equal(clsDasEntradas(undefined), 0);
  // Mesma janela (< 1 s entre si): soma.
  assert.equal(clsDasEntradas([{ value: 0.1, startTime: 100 }, { value: 0.15, startTime: 600 }]), 0.25);
  // Duas janelas separadas por mais de 1 s: vale a maior, não a soma.
  assert.equal(clsDasEntradas([{ value: 0.1, startTime: 100 }, { value: 0.12, startTime: 2000 }]), 0.12);
  // A janela fecha aos 5 s mesmo com mudança a cada 0,9 s.
  const serie = Array.from({ length: 8 }, (_, i) => ({ value: 0.05, startTime: i * 900 }));
  assert.equal(clsDasEntradas(serie), 0.3);
  // Mudança logo depois de toque não conta.
  assert.equal(clsDasEntradas([{ value: 0.5, startTime: 10, hadRecentInput: true }, { value: 0.01, startTime: 20 }]), 0.01);
  // Ordem de chegada não importa.
  assert.equal(clsDasEntradas([{ value: 0.15, startTime: 600 }, { value: 0.1, startTime: 100 }]), 0.25);
});

test("CLS: o limite é o 'ruim' do Core Web Vitals e as telas do S3 são medidas", () => {
  assert.equal(LIMITE_CLS, 0.25);
  const medidas = PAGINAS_PRODUCAO.filter((p) => p.cls).map((p) => p.caminho);
  for (const c of ["/games/pokemon", "/games/pokemon/base-set", "/condition", "/help", "/lancamentos", "/novidades"]) {
    assert.ok(medidas.includes(c), `${c} fora da medição de CLS`);
  }
  assert.ok(medidas.some((c) => /^\/games\/pokemon\/base-set\/[a-z0-9-]+$/.test(c)), "sem a tela de carta");
  assert.deepEqual(APARELHOS.map((a) => a.nome), ["desktop", "android", "iphone"]);
  assert.equal(APARELHOS[0].janela.width, 1366);
  assert.deepEqual(CAMINHOS_EARLY_HINTS, ["/", "/hub", "/games/pokemon", "/pokedex"]);
  // Cada tela local tem rótulo que existe em produção (o relatório compara).
  const rotulos = new Set(PAGINAS_PRODUCAO.map((p) => p.rotulo));
  for (const p of PAGINAS_LOCAIS) assert.ok(rotulos.has(p.rotulo), p.rotulo);
});

// A saída do curl -D - por trás do proxy, como ela veio em 14/11/2026.
const CURL_OK = [
  "HTTP/1.1 200 Connection Established", "",
  "HTTP/2 103 ",
  "link: </styles.cf5da58b.css>; as=style; rel=preload, </assets/fonts/outfit-latin.woff2>; as=font; crossorigin; rel=preload", "",
  "HTTP/2 200 ",
  "content-type: text/html; charset=utf-8",
  "link: </styles.cf5da58b.css>; rel=preload; as=style, </assets/fonts/outfit-latin.woff2>; rel=preload; as=font; crossorigin", ""
].join("\r\n");

test("103: lê os blocos do curl e acha o arquivo com hash", () => {
  const blocos = blocosDoCurl(CURL_OK);
  assert.deepEqual(blocos.map((b) => b.status), [200, 103, 200]);
  assert.match(blocos[1].headers.link, /styles\.cf5da58b\.css/);
  assert.deepEqual([...ativosComHash(blocos[2].headers.link)], ["/styles.cf5da58b.css"]);
  // A fonte não tem hash e não entra; URL absoluta vira caminho.
  assert.deepEqual([...ativosComHash("<https://sleevu.app/src/boot.8fc10e98.js>; rel=preload, </assets/fonts/x.woff2>")], ["/src/boot.8fc10e98.js"]);
  assert.deepEqual([...ativosComHash("")], []);
});

test("103: mesmo hash do 200 passa; o CSS de outra leva (S4) reprova; sem 103 é escolha", () => {
  assert.equal(confereEarlyHints(blocosDoCurl(CURL_OK)).estado, "ok");

  // O caso do S4: o 103 com o styles de uma leva anterior.
  const velho = CURL_OK.replace("HTTP/2 103 \r\nlink: </styles.cf5da58b.css>", "HTTP/2 103 \r\nlink: </styles.ed9c7605.css>");
  const r = confereEarlyHints(blocosDoCurl(velho));
  assert.equal(r.estado, "velho");
  assert.deepEqual(r.velhos, ["/styles.ed9c7605.css"]);
  assert.deepEqual(r.certos, ["/styles.cf5da58b.css"]);

  // Early Hints desligado (a opção b do S4): nada a comparar.
  const sem = CURL_OK.replace(/HTTP\/2 103 \r\nlink: [^\r]+\r\n\r\n/, "");
  assert.equal(confereEarlyHints(blocosDoCurl(sem)).estado, "sem-103");
  assert.equal(confereEarlyHints([]).estado, "sem-resposta");
});

test("medição segurada: os jserror do corpo viram aviso, o resto some", () => {
  const erro = JSON.stringify({ name: "jserror", path: "/", props: { k: "recurso", m: "script não carregou", s: "x" } });
  assert.deepEqual(jserrorsDoCorpo(erro), ["recurso: script não carregou"]);
  assert.deepEqual(jserrorsDoCorpo(JSON.stringify({ name: "pageview", path: "/" })), []);
  assert.deepEqual(jserrorsDoCorpo(JSON.stringify([{ name: "jserror", props: { m: "boom" } }])), ["js: boom"]);
  assert.deepEqual(jserrorsDoCorpo("não é json"), []);
  assert.deepEqual(jserrorsDoCorpo(null), []);
});

test("duas passadas: só reprova o que falhou nas duas; o soluço vira aviso", () => {
  const primeira = [
    { chave: "desktop|home", titulo: "home", falhas: ["404 /assets/shops/shop_myp.webp (image)"], avisos: [] },
    { chave: "android|set", titulo: "set", falhas: ["não abriu: timeout"], avisos: ["console: x"] },
    { chave: "iphone|help", titulo: "help", falhas: [], avisos: [], cls: 0 }
  ];
  const segunda = [
    { chave: "desktop|home", titulo: "home", falhas: ["404 /assets/shops/shop_myp.webp (image)"], avisos: [] },
    { chave: "android|set", titulo: "set", falhas: [], avisos: [], cls: 0.01 }
  ];
  const r = consolida(primeira, segunda);
  assert.deepEqual(r[0].falhas, ["404 /assets/shops/shop_myp.webp (image)"]);
  assert.equal(r[0].repetiu, true);
  assert.deepEqual(r[1].falhas, []);
  assert.deepEqual(r[1].avisos, ["soluço (só na 1ª passada): não abriu: timeout"]);
  assert.equal(r[1].cls, 0.01);
  assert.equal(r[2], primeira[2]);
  // Sem segunda passada (nada a refazer), fica como estava.
  assert.deepEqual(consolida(primeira, []), primeira);
});

test("relatório: uma linha por verificação, motivos embaixo, resumo e exit", () => {
  const limpo = montaRelatorio([
    { titulo: "help        iPhone 390   /help", falhas: [], avisos: [], cls: 0, ms: 2100 }
  ], { base: BASE });
  assert.equal(limpo.falhou, false);
  assert.match(limpo.texto, /^Varredura https:\/\/sleevu\.app/);
  assert.match(limpo.texto, /✓ help {8}iPhone 390 {3}\/help · CLS 0\.000 · 2\.1 s/);
  assert.match(limpo.texto, /1 verificações limpas \(0 aviso\(s\)\)$/);

  const avisos = Array.from({ length: 9 }, (_, i) => `console: ${i}`);
  const sujo = montaRelatorio([
    { titulo: "home", falhas: ["404 /assets/shops/shop_myp.webp (image)"], avisos },
    { titulo: "set", falhas: ["CLS 0.310 (limite 0.25)"], avisos: [], cls: 0.31 },
    { titulo: "hub", falhas: [], avisos: [] }
  ], { limiteAvisos: 6 });
  assert.equal(sujo.falhou, true);
  assert.equal(sujo.falhas, 2);
  assert.equal(sujo.avisos, 9);
  assert.match(sujo.texto, /✗ home\n {6}✗ 404 \/assets\/shops\/shop_myp\.webp \(image\)/);
  assert.match(sujo.texto, /… e mais 3 aviso\(s\)/);
  assert.match(sujo.texto, /✗ set · CLS 0\.310/);
  assert.match(sujo.resumo, /^2 de 3 verificações com falha/);
});
