// "Sobre" dos jogos vintage (src/sobre-jogo.js + data/sobre/<url>.json,
// 2026-11-12): o bloco com a história no topo da tela de um jogo que acabou.
//
// O que não pode quebrar calado:
//   1. A lista COM_SOBRE e os arquivos de data/sobre/ andam juntos, e só jogo
//      vintage do registro (functions/_lib/jogos.js) tem o bloco.
//   2. Cada JSON tem o que a página precisa nos TRÊS idiomas (o bloco é
//      redesenhado no idioma da pessoa): resumo, história, ficha, linha do
//      tempo. O resumo é a descrição do Google: cabe em 160 caracteres.
//   3. A linha do tempo só aponta set que existe no catálogo do jogo.
//   4. Texto nenhum vira HTML (o JSON é nosso, mas o bloco vai pro HTML da
//      borda e pro innerHTML do app).
//   5. A borda põe o bloco, o JSON-LD e o resumo como descrição.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import "../src/sobre-jogo.js";
import { JOGOS_URL, jogoDaUrl } from "../functions/_lib/jogos.js";
import { metaDoJogo } from "../functions/games/[[path]].js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normaliza CRLF: a checkout Windows do repo usa core.autocrlf=true.
const ler = (p) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const S = globalThis.SleevuSobre;
const DIR = "data/sobre";
const arquivos = existsSync(join(RAIZ, DIR)) ? readdirSync(join(RAIZ, DIR)).filter((f) => f.endsWith(".json")) : [];
const dadosDe = (url) => JSON.parse(ler(`${DIR}/${url}.json`));

test("COM_SOBRE e data/sobre/ andam juntos, e só jogo vintage tem o bloco", () => {
  assert.ok(S.COM_SOBRE.length > 0);
  assert.deepEqual(arquivos.map((f) => f.replace(/\.json$/, "")).sort(), [...S.COM_SOBRE].sort());
  for (const url of S.COM_SOBRE) {
    const jogo = jogoDaUrl(url);
    assert.ok(jogo, `${url}: fora do registro de jogos`);
    assert.ok(jogo.vintage, `${url}: o "Sobre" é dos vintage (os modernos estão vivos)`);
    assert.equal(S.tem(url), true);
  }
  assert.equal(S.tem("pokemon"), false);
  assert.equal(S.tem(""), false);
});

for (const url of S.COM_SOBRE) {
  test(`${url}: campos nos três idiomas, datas e fontes`, () => {
    const d = dadosDe(url);
    const jogo = jogoDaUrl(url);
    assert.equal(d.url, url);
    assert.ok(S.tx(d.nome, "pt"), "nome");
    assert.ok(existsSync(join(RAIZ, String(d.logo || "").replace(/^\//, ""))), `logo inexistente: ${d.logo}`);
    assert.match(String(d.periodo && d.periodo.inicio), /^\d{4}(-\d{2})?$/);
    assert.match(String(d.periodo && d.periodo.fim), /^\d{4}(-\d{2})?$/);
    // O período do registro (o "1988–1997" do hub) e o do bloco contam o mesmo.
    assert.equal(`${String(d.periodo.inicio).slice(0, 4)}–${String(d.periodo.fim).slice(0, 4)}`, jogo.vintage.replace("~", "–"));
    for (const lang of S.IDIOMAS) {
      const resumo = S.tx(d.resumo, lang);
      assert.ok(resumo && typeof d.resumo === "object" && d.resumo[lang], `resumo em ${lang}`);
      assert.ok(resumo.length >= 70 && resumo.length <= 160, `resumo em ${lang} com ${resumo.length} caracteres (é a descrição do Google: 70–160)`);
      const hist = d.historia && d.historia[lang];
      assert.ok(Array.isArray(hist) && hist.length >= 2, `história em ${lang}`);
      assert.equal(hist.length, d.historia.pt.length, `história em ${lang} com outro número de parágrafos`);
      hist.forEach((p) => assert.ok(typeof p === "string" && p.trim().length > 40));
      for (const f of d.fatos) {
        assert.ok(S.FATOS.includes(f.chave), `fato desconhecido: ${f.chave}`);
        assert.ok(String(S.tx(f.valor, lang)).trim(), `fato ${f.chave} vazio em ${lang}`);
      }
      for (const e of d.linhaDoTempo) assert.ok(e.texto && e.texto[lang], `linha do tempo ${e.data} sem ${lang}`);
      (d.etiquetas || []).forEach((e) => assert.ok(S.tx(e, lang)));
    }
    for (const chave of ["lancamento", "encerramento", "fabricante"]) {
      assert.ok(d.fatos.some((f) => f.chave === chave), `ficha sem ${chave}`);
    }
    // Linha do tempo em ordem e com data no formato do catálogo (sem dia inventado).
    const datas = d.linhaDoTempo.map((e) => e.data);
    datas.forEach((x) => assert.match(x, /^\d{4}(-\d{2})?$/));
    assert.deepEqual([...datas].sort(), datas, "linha do tempo fora de ordem");
    assert.ok(d.linhaDoTempo.length >= 5);
    // Fonte: https e ao menos uma.
    assert.ok(Array.isArray(d.fontes) && d.fontes.length >= 1);
    d.fontes.forEach((f) => assert.match(f.url, /^https:\/\//));
  });

  test(`${url}: a linha do tempo só aponta set que existe no catálogo`, () => {
    const d = dadosDe(url);
    const jogo = jogoDaUrl(url);
    const cards = ler(`data/${jogo.game}/cards.js`);
    for (const e of d.linhaDoTempo.filter((x) => x.set)) {
      assert.ok(cards.includes(`"setId":"${e.set}"`), `set ${e.set} (${e.data}) não está em data/${jogo.game}/cards.js`);
    }
  });
}

test("renderizador: os três idiomas, ficha na ordem, data por extenso e sem link sem resolvedor", () => {
  const url = S.COM_SOBRE[0];
  const d = dadosDe(url);
  const pt = S.html(d, "pt");
  assert.match(pt, new RegExp(`data-sobre-jogo="${url}"`));
  assert.match(pt, /data-idioma="pt"/);
  assert.match(pt, /<h2 class="sx-sobre-nome">/);
  assert.match(pt, /<dt>Lançamento<\/dt>/);
  assert.match(pt, /Linha do tempo/);
  // A borda não passa resolvedor: a linha do tempo sai sem link.
  assert.doesNotMatch(pt.slice(pt.indexOf('class="sx-linha"')), /<a href="\/games/);
  const en = S.html(d, "en", { hrefDoSet: (id) => `/games/${url}/${id}` });
  assert.match(en, /data-idioma="en"/);
  assert.match(en, /<dt>Released<\/dt>/);
  assert.match(en, /Timeline/);
  if (d.linhaDoTempo.some((e) => e.set)) assert.match(en, new RegExp(`<a href="/games/${url}/`));
  assert.match(S.html(d, "es"), /Cronología/);
  // Idioma desconhecido cai no pt.
  assert.match(S.html(d, "fr"), /data-idioma="pt"/);
  // Ordem da ficha = a de S.FATOS, seja qual for a do JSON.
  const ordem = [...pt.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  const esperada = S.FATOS.filter((k) => d.fatos.some((f) => f.chave === k)).map((k) => S.ROTULOS.pt.fatos[k]);
  assert.deepEqual(ordem, esperada);
  assert.equal(S.dataLonga("1988-11", "pt"), "Novembro de 1988");
  assert.equal(S.dataLonga("1988-11", "en"), "November 1988");
  assert.equal(S.dataLonga("1988-11", "es"), "Noviembre de 1988");
  assert.equal(S.dataLonga("1997", "pt"), "1997");
});

test("renderizador: texto nenhum vira HTML", () => {
  const mau = "<img src=x onerror=alert(1)>";
  const d = {
    url: `x"><script>`, nome: mau, logo: `x" onerror="alert(1)`, nomeOriginal: { texto: mau, lang: `ja" x="` },
    periodo: { inicio: "1990", fim: "1991" }, etiquetas: [mau], resumo: { pt: mau },
    fatos: [{ chave: "fabricante", valor: mau }], historia: { pt: [mau, mau] },
    linhaDoTempo: [{ data: `1990"><b>`, texto: { pt: mau }, set: "a" }],
    fontes: [{ nome: mau, url: "https://x.y/?a=<b>" }, { nome: "js", url: "javascript:alert(1)" }]
  };
  const h = S.html(d, "pt", { hrefDoSet: () => `/x"><script>` });
  assert.doesNotMatch(h, /<img src=x/);
  assert.doesNotMatch(h, /<script>/);
  assert.doesNotMatch(h, /onerror="alert/);
  assert.doesNotMatch(h, /javascript:/, "fonte que não é https não vira link");
  assert.doesNotMatch(h, /"><b>/, "a data não fecha o atributo datetime");
});

test("a borda: bloco em pt, JSON-LD do jogo, título com a história e o resumo como descrição", () => {
  const url = S.COM_SOBRE[0];
  const d = dadosDe(url);
  const jogo = jogoDaUrl(url);
  const sets = [{ slug: "a", nome: "A", cartas: 42, data: "1988-11" }];
  const m = metaDoJogo(jogo, sets, d);
  assert.match(m.titulo, /história/);
  assert.ok(m.titulo.length <= 65);
  assert.equal(m.desc, S.tx(d.resumo, "pt"));
  assert.match(m.sobreHtml, /data-idioma="pt"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*)<\/script>/.exec(m.jsonLd)[1]);
  assert.equal(ld["@type"], "Game");
  assert.equal(ld.url, `https://sleevu.app/games/${url}`);
  assert.equal(ld.name, S.tx(d.nome, "pt"));
  assert.ok(ld.publisher && ld.publisher.name);
  // Sem o "Sobre" (o JSON não veio, ou jogo moderno), a tela é a de sempre.
  const sem = metaDoJogo(jogo, sets);
  assert.equal(sem.sobreHtml, "");
  assert.equal(sem.jsonLd, "");
  assert.doesNotMatch(sem.titulo, /história/);
});

test("as classes que o renderizador desenha têm CSS (e moram na folha da tela de Sets)", () => {
  const css = ler("styles.css");
  const src = ler("src/sobre-jogo.js");
  const classes = new Set([...src.matchAll(/class="([^"$]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("sx-")));
  assert.ok(classes.size > 10);
  for (const c of classes) {
    if (c === "sx-eyebrow") continue; // a do destaque, reaproveitada
    assert.match(css, new RegExp(`\\.${c}\\b`), `.${c} sem regra no styles.css`);
  }
  // O sets.html carrega o renderizador antes do app.js (que lê window.SleevuSobre).
  const html = ler("sets.html");
  assert.ok(html.indexOf("src/sobre-jogo.js") > 0 && html.indexOf("src/sobre-jogo.js") < html.indexOf("src/app.js"));
  assert.match(ler("sw.js"), /"src\/sobre-jogo\.js"/);
});
