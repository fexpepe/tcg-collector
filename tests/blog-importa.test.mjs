// Importar um post de um .md (src/blog-importa.js, 2026-11-19).
//
// O que se trava aqui:
//   - o formato em que os textos chegam ("**Suggested slug** `x`", "**Meta
//     description** …", "# Título") vira campos, e o H1 sai do corpo;
//   - o cabeçalho entre "---" faz o mesmo, com as chaves em pt/en e os rótulos
//     de categoria, jogo e idioma como a pessoa escreve;
//   - campo que o arquivo não diz não aparece (não apaga o que está no editor);
//   - o que passa do teto do banco é cortado COM aviso (senão o salvar falha
//     inteiro, sem dizer o campo);
//   - imagem citada por nome de arquivo casa com o arquivo escolhido e vira o
//     endereço; endereço pronto e bloco de código ficam como estão.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/blog-render.js";
import "../src/blog-importa.js";

const B = globalThis.SleevuBlog;
const Imp = globalThis.SleevuBlogImporta;

const SOLTO = [
  "**Suggested slug** `bandai-carddass-history`",
  "",
  "**Meta description** The story of Bandai Carddass, from Japan’s 20-yen vending machines.",
  "",
  "# Bandai Carddass and the 20-Yen Anime Card Boom",
  "",
  "In 1988, 20 yen got you one card. [Timeline](https://prtimes.jp/x.html)",
  "",
  "## What was Carddass?",
  "",
  "![A máquina](1.jpg \"20 yen, one card.\")",
  "",
  "**Gundam War** came out in 1999."
].join("\n");

test("formato solto: slug, descrição e título saem do topo; o corpo começa no texto", () => {
  const r = Imp.le(SOLTO);
  assert.deepEqual(r.campos, {
    slug: "bandai-carddass-history",
    seo_desc: "The story of Bandai Carddass, from Japan’s 20-yen vending machines.",
    title: "Bandai Carddass and the 20-Yen Anime Card Boom"
  });
  assert.ok(r.corpo.startsWith("In 1988, 20 yen"));
  assert.ok(!/^# /m.test(r.corpo), "o H1 não fica no corpo");
  // Negrito no MEIO do texto não é campo: a varredura para na primeira linha de texto.
  assert.ok(r.corpo.endsWith("**Gundam War** came out in 1999."));
  assert.deepEqual(r.avisos, []);
  // E o corpo é o que o renderizador entende.
  const html = B.render(r.corpo, { lang: "en" }).html;
  assert.equal((html.match(/<h2/g) || []).length, 1);
});

test("negrito que abre o texto e não é nome de campo fica no corpo", () => {
  const r = Imp.le("# Título\n\n**Gundam War** came out in 1999.\n");
  assert.equal(r.campos.title, "Título");
  assert.equal(r.corpo, "**Gundam War** came out in 1999.");
});

test("cabeçalho ---: chaves em pt/en, rótulos de categoria, jogo e idioma", () => {
  const jogo = Object.keys(B.GAMES)[0];
  const r = Imp.le([
    "---",
    'título: "Os graals do Carddass"',
    "linha fina: Uma frase",
    "endereço: Os Graals do Carddass!",
    "resumo: Curto.",
    "description: Pro Google.",
    "categoria: History & Vintage",
    "jogo: " + B.GAMES[jogo][0],
    "idioma: English",
    "tags: [Carddass, bandai, carddass, #vintage]",
    "autor: Sleevu",
    "capa: capa.png",
    "destaque: sim",
    "data: 2026-11-20",
    "coisa: qualquer",
    "---",
    "",
    "# Título repetido no corpo",
    "",
    "Texto."
  ].join("\n"));
  assert.equal(r.campos.title, "Os graals do Carddass", "o cabeçalho manda no título");
  assert.equal(r.campos.subtitle, "Uma frase");
  assert.equal(r.campos.slug, "os-graals-do-carddass");
  assert.equal(r.campos.excerpt, "Curto.");
  assert.equal(r.campos.seo_desc, "Pro Google.");
  assert.equal(r.campos.category, "historia");
  assert.equal(r.campos.game, jogo);
  assert.equal(r.campos.lang, "en");
  assert.deepEqual(r.campos.tags, ["Carddass", "bandai", "vintage"]);
  assert.equal(r.campos.author_name, "Sleevu");
  assert.equal(r.campos.featured, true);
  assert.equal(new Date(r.campos.published_at).getDate(), 20, "data sem hora cai no dia escrito, na hora local");
  assert.equal(r.capa, "capa.png");
  assert.equal(r.corpo, "Texto.");
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /coisa/);
});

test("só texto: nenhum campo inventado, corpo inteiro", () => {
  const r = Imp.le("﻿Primeiro parágrafo.\r\n\r\n## Seção\r\n");
  assert.deepEqual(r.campos, {});
  assert.equal(r.corpo, "Primeiro parágrafo.\n\n## Seção");
  assert.equal(r.capa, "");
});

test("valor que não existe vira aviso e não vira campo", () => {
  const r = Imp.le("---\ncategory: receitas\ngame: xadrez\nlang: klingon\ndate: amanhã\n---\nTexto.");
  assert.deepEqual(r.campos, {});
  assert.equal(r.avisos.length, 4);
});

test("passou do teto do banco: corta e avisa qual campo", () => {
  const r = Imp.le("**Meta description** " + "a".repeat(400) + "\n\nTexto.");
  assert.equal(r.campos.seo_desc.length, 320);
  assert.match(r.avisos[0], /descrição pro Google/);
});

test("imagens: só as que apontam pra arquivo, fora de bloco de código", () => {
  const md = [
    "![a](1.jpg)",
    "![b](fotos/Capa%20Final.PNG \"legenda\")",
    "![c](https://img.sleevu.app/x.webp)",
    "![d](/assets/x.png)",
    "![e](1.jpg)",
    "```",
    "![f](codigo.jpg)",
    "```",
    "texto com ![g](nalinha.jpg) no meio"
  ].join("\n");
  assert.deepEqual(Imp.imagensLocais(md), ["1.jpg", "fotos/Capa%20Final.PNG"]);
});

test("arquivoPara: pelo nome sem pasta nem maiúscula e, na falta, sem a extensão", () => {
  const nomes = ["Capa Final.png", "1.jpg", "image-2.webp"];
  assert.equal(Imp.arquivoPara("fotos/Capa%20Final.PNG", nomes), 0);
  assert.equal(Imp.arquivoPara("1.jpg", nomes), 1);
  assert.equal(Imp.arquivoPara("1.png", nomes), 1);
  assert.equal(Imp.arquivoPara("IMAGE-2", nomes), 2);
  assert.equal(Imp.arquivoPara("3.jpg", nomes), -1);
});

test("trocaImagens: o endereço entra no lugar do arquivo, descrição e legenda ficam", () => {
  const url = "https://" + B.SUPABASE_HOST + "/storage/v1/object/public/blog-media/2026/11/1-abc123-w1600h900.webp";
  const md = "![A máquina](1.jpg \"20 yen.\")\n\n```\n![x](1.jpg)\n```\n\n![outra](2.jpg)";
  const out = Imp.trocaImagens(md, { "1.jpg": url });
  assert.equal(out, `![A máquina](${url} "20 yen.")\n\n\`\`\`\n![x](1.jpg)\n\`\`\`\n\n![outra](2.jpg)`);
  const html = B.render(out, { lang: "en" }).html;
  assert.match(html, /width="1600" height="900" alt="A máquina"/);
  assert.match(html, /<figcaption>20 yen\.<\/figcaption>/);
});
