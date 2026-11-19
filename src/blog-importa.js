// Importar um post de um arquivo .md (2026-11-19) — docs/BLOG.md, "Importar".
//
// POR QUE: o texto do post chega pronto de fora (título, endereço, descrição
// pro Google e o corpo num .md só, mais as imagens em arquivos soltos), e
// publicar era copiar campo por campo e subir imagem por imagem. Aqui o
// arquivo vira os campos do editor de uma vez; quem escreve só faz o pente
// fino e salva.
//
// Só a LEITURA mora aqui, sem DOM nem rede, pra ser testada no Node
// (tests/blog-importa.test.mjs). Subir as imagens e preencher o formulário é
// do src/blog-editor.js. Fora do src/blog-render.js de propósito: aquele
// arquivo desce pra todo leitor do blog, e isto só serve a quem escreve.
//
// Dois jeitos de dizer os campos, que podem vir juntos:
//
//   1) Cabeçalho entre linhas "---" no topo (uma "chave: valor" por linha):
//        ---
//        title: Bandai Carddass and the 20-Yen Anime Card Boom
//        slug: bandai-carddass-history
//        description: The story of Bandai Carddass…
//        category: historia
//        lang: en
//        tags: carddass, bandai, vintage
//        cover: capa.jpg
//        ---
//   2) O formato em que os textos costumam chegar: linhas soltas no topo, com
//      o nome do campo em negrito, e o título como "# Título":
//        **Suggested slug** `bandai-carddass-history`
//        **Meta description** The story of Bandai Carddass…
//        # Bandai Carddass and the 20-Yen Anime Card Boom
//
// O "# Título" sai do corpo: o H1 da página é o campo Título (no corpo o
// renderizador o rebaixaria pra H2 e o título apareceria duas vezes).
(function (raiz) {
  "use strict";
  const B = raiz.SleevuBlog;
  if (!B) return;

  // Nome do campo como a pessoa escreve (pt, en, es; com ou sem acento,
  // "suggested slug", "meta description") → campo do post.
  const CHAVES = {
    title: "title", titulo: "title",
    subtitle: "subtitle", subtitulo: "subtitle", linhafina: "subtitle", dek: "subtitle", bajada: "subtitle",
    slug: "slug", endereco: "slug", url: "slug", direccion: "slug",
    excerpt: "excerpt", resumo: "excerpt", summary: "excerpt", resumen: "excerpt",
    seotitle: "seo_title", metatitle: "seo_title", tituloprogoogle: "seo_title", tituloseo: "seo_title",
    seodesc: "seo_desc", seodescription: "seo_desc", metadescription: "seo_desc", description: "seo_desc",
    descricao: "seo_desc", metadescricao: "seo_desc", descripcion: "seo_desc", metadescripcion: "seo_desc",
    category: "category", categoria: "category",
    game: "game", jogo: "game", juego: "game",
    lang: "lang", language: "lang", idioma: "lang",
    tags: "tags", assuntos: "tags", keywords: "tags", etiquetas: "tags",
    author: "author_name", autor: "author_name",
    cover: "cover", capa: "cover", portada: "cover", coverimage: "cover",
    coveralt: "cover_alt", descricaodacapa: "cover_alt", altdacapa: "cover_alt",
    featured: "featured", destaque: "featured", destacado: "featured",
    date: "published_at", data: "published_at", fecha: "published_at", publishedat: "published_at"
  };
  // Os mesmos tetos do banco (20260930b): passar deles faria o salvar inteiro
  // falhar com um aviso genérico. Cortar aqui deixa dizer QUAL campo.
  const TETO = { title: 200, subtitle: 300, excerpt: 400, cover_alt: 300, seo_title: 120, seo_desc: 320, author_name: 80, slug: 100 };
  const ROTULO = {
    title: "título", subtitle: "linha fina", excerpt: "resumo", cover_alt: "descrição da capa",
    seo_title: "título pro Google", seo_desc: "descrição pro Google", author_name: "autor", slug: "endereço"
  };

  // "Meta description:" / "Suggested Slug" / "Linha fina" → chave da tabela.
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  function campoDe(nome) {
    const n = semAcento(nome).replace(/\b(suggested|sugerido|sugerida|sugestao de|proposed)\b/g, "").replace(/[^a-z0-9]+/g, "");
    return Object.prototype.hasOwnProperty.call(CHAVES, n) ? CHAVES[n] : "";
  }
  // Tira o que embrulha o valor: aspas do YAML, crase de código, espaço.
  function limpa(v) {
    let s = String(v == null ? "" : v).trim();
    const m = /^(["'`])([\s\S]*)\1$/.exec(s);
    if (m) s = m[2].trim();
    return s;
  }
  const IMG_LINHA = /^(\s{0,3}!\[(?:[^[\]\\\n]|\\.)*\]\(\s*)([^\s()<>]+)((?:\s+"[^"\n]*")?\s*\)\s*)$/;
  const CERCA = /^\s{0,3}(`{3,}|~{3,})/;
  // Endereço que já serve como está (na web ou no próprio site): não é arquivo.
  const ehEndereco = (u) => /^(?:https?:)?\/\//i.test(u) || /^\/(?![/\\])/.test(u) || /^data:/i.test(u);

  // Nome de arquivo comparável: sem pasta, sem %20, minúsculo.
  function nomeDe(caminho) {
    let s = String(caminho || "").split(/[?#]/)[0].split(/[\\/]/).pop();
    try { s = decodeURIComponent(s); } catch (e) { /* fica como veio */ }
    return s.trim().toLowerCase();
  }
  const semExtensao = (n) => n.replace(/\.[a-z0-9]{2,5}$/, "");

  // Chave ou rótulo (em qualquer idioma) → chave da tabela do renderizador.
  function categoriaDe(v) {
    const n = semAcento(v).replace(/[^a-z0-9]+/g, "");
    return Object.keys(B.CATEGORIAS).find((k) => k === n
      || ["pt", "en", "es"].some((l) => semAcento(B.CATEGORIAS[k][l]).replace(/[^a-z0-9]+/g, "") === n)) || "";
  }
  function jogoDe(v) {
    const n = semAcento(v).replace(/[^a-z0-9]+/g, "");
    return Object.keys(B.GAMES).find((k) => k === n || semAcento(B.GAMES[k][0]).replace(/[^a-z0-9]+/g, "") === n) || "";
  }
  function idiomaDe(v) {
    const n = semAcento(v).replace(/[^a-z]+/g, "");
    return { pt: "pt", ptbr: "pt", portugues: "pt", portuguese: "pt", en: "en", enus: "en", ingles: "en", english: "en",
      es: "es", espanol: "es", espanhol: "es", spanish: "es" }[n] || "";
  }

  // O texto do arquivo → { campos, corpo, capa, avisos }.
  //   campos: só o que o arquivo DISSE (campo ausente não apaga o do editor);
  //   capa:   nome de arquivo ou endereço da capa, "" se não veio;
  //   avisos: o que foi lido mas não coube ou não foi entendido.
  function le(textoCru) {
    const linhas = String(textoCru == null ? "" : textoCru).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
    const campos = {};
    const avisos = [];
    let capa = "";
    let i = 0;

    function poe(campo, valorCru) {
      const v = limpa(valorCru);
      if (campo === "cover") { capa = v; return; }
      if (campo === "tags") {
        const out = [];
        v.replace(/^\[|\]$/g, "").split(",").forEach((t) => {
          const x = limpa(t).replace(/^#/, "").replace(/\s+/g, " ").slice(0, 30);
          if (x && !out.some((y) => y.toLowerCase() === x.toLowerCase()) && out.length < 12) out.push(x);
        });
        campos.tags = out;
        return;
      }
      if (campo === "category") {
        const c = categoriaDe(v);
        if (c) campos.category = c; else if (v) avisos.push(`Categoria "${v}" não existe: ficou a que estava.`);
        return;
      }
      if (campo === "game") {
        const g = jogoDe(v);
        if (g || /^(|geral|general|all|todos)$/i.test(v)) campos.game = g; else avisos.push(`Jogo "${v}" não existe no blog: ficou o que estava.`);
        return;
      }
      if (campo === "lang") {
        const l = idiomaDe(v);
        if (l) campos.lang = l; else if (v) avisos.push(`Idioma "${v}" não é pt, en nem es: ficou o que estava.`);
        return;
      }
      if (campo === "featured") { campos.featured = /^(true|sim|yes|si|1|x)$/i.test(semAcento(v)); return; }
      if (campo === "published_at") {
        // Data sem hora ("2026-11-20") viraria meia-noite UTC, que no Brasil
        // é a noite do dia anterior: lê como meio-dia local.
        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T12:00:00" : v);
        if (v && !isNaN(d)) campos.published_at = d.toISOString(); else if (v) avisos.push(`Data "${v}" não foi entendida: ficou a que estava.`);
        return;
      }
      let texto = campo === "slug" ? B.slugify(v, TETO.slug) : v.replace(/\s+/g, " ");
      if (TETO[campo] && texto.length > TETO[campo]) {
        avisos.push(`O campo ${ROTULO[campo]} passou de ${TETO[campo]} caracteres e foi cortado.`);
        texto = texto.slice(0, TETO[campo]).trim();
      }
      campos[campo] = texto;
    }

    // 1) Cabeçalho entre "---".
    while (i < linhas.length && !linhas[i].trim()) i++;
    if (i < linhas.length && /^---\s*$/.test(linhas[i])) {
      let fim = -1;
      for (let k = i + 1; k < linhas.length; k++) if (/^(---|\.\.\.)\s*$/.test(linhas[k])) { fim = k; break; }
      if (fim > 0) {
        for (let k = i + 1; k < fim; k++) {
          const m = /^([^:#]+):\s*(.*)$/.exec(linhas[k]);
          if (!m) continue;
          const campo = campoDe(m[1]);
          if (campo) poe(campo, m[2]);
          else avisos.push(`"${m[1].trim()}" no cabeçalho não é um campo do post e foi ignorado.`);
        }
        i = fim + 1;
      }
    }

    // 2) Linhas soltas no topo ("**Meta description** …") e o "# Título", em
    //    qualquer ordem, até a primeira linha que já é texto do post.
    let temTitulo = false;
    while (i < linhas.length) {
      const linha = linhas[i];
      if (!linha.trim()) { i++; continue; }
      const h1 = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(linha);
      if (h1 && !temTitulo) {
        temTitulo = true;
        // O cabeçalho manda: com title lá, este H1 só sai do corpo.
        if (!campos.title) poe("title", h1[1].replace(/\*\*|__/g, ""));
        i++;
        continue;
      }
      const m = /^\s{0,3}\*\*\s*([^*]+?)\s*:?\s*\*\*\s*:?\s*(.*)$/.exec(linha);
      const campo = m ? campoDe(m[1]) : "";
      if (!campo || !m[2].trim()) break;
      poe(campo, m[2]);
      i++;
    }

    const corpo = linhas.slice(i).join("\n").replace(/\s+$/, "");
    if (corpo.length > 200000) avisos.push("O texto passa de 200 mil caracteres: o banco não vai aceitar.");
    return { campos, corpo, capa, avisos };
  }

  // As imagens do corpo que apontam pra ARQUIVO (não pra endereço): é o que
  // precisa subir. Fora de bloco de código, na ordem em que aparecem, sem
  // repetir.
  function imagensLocais(md) {
    const out = [];
    let cerca = "";
    String(md || "").split("\n").forEach((linha) => {
      const c = CERCA.exec(linha);
      if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = ""; return; }
      if (cerca) return;
      const m = IMG_LINHA.exec(linha);
      if (m && !ehEndereco(m[2]) && out.indexOf(m[2]) < 0) out.push(m[2]);
    });
    return out;
  }

  // Qual dos arquivos escolhidos é a imagem citada: pelo nome (sem pasta, sem
  // diferenciar maiúscula) e, se não achar, pelo nome sem a extensão — o texto
  // diz "capa.png" e o arquivo veio "capa.jpg", ou diz só "IMAGE-1".
  function arquivoPara(ref, nomes) {
    const n = nomeDe(ref);
    if (!n) return -1;
    let k = nomes.findIndex((x) => nomeDe(x) === n);
    if (k < 0) k = nomes.findIndex((x) => semExtensao(nomeDe(x)) === semExtensao(n));
    return k;
  }

  // Troca, nas linhas de imagem, o arquivo pelo endereço que ele ganhou.
  // `mapa` é { "como está no texto": "https://…" }.
  function trocaImagens(md, mapa) {
    let cerca = "";
    return String(md || "").split("\n").map((linha) => {
      const c = CERCA.exec(linha);
      if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = ""; return linha; }
      if (cerca) return linha;
      const m = IMG_LINHA.exec(linha);
      return m && Object.prototype.hasOwnProperty.call(mapa, m[2]) ? m[1] + mapa[m[2]] + m[3] : linha;
    }).join("\n");
  }

  raiz.SleevuBlogImporta = { le, imagensLocais, arquivoPara, trocaImagens, ehEndereco };
})(globalThis);
