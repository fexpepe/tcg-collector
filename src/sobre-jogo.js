// "Sobre" de um jogo vintage na tela dele (/games/<jogo>, 2026-11-12): logo,
// nome oficial e o original, um resumo, a ficha (lançamento, encerramento,
// fabricante, licença…), a história e a linha do tempo, com as fontes.
//
// Por quê: o Sleevu existe também pra trazer de volta à vida os TCGs que
// morreram e foram esquecidos (o princípio está no ROADMAP.md). Um jogo de
// 1988 sem uma linha de contexto é só uma lista de cartas; com a história, a
// página serve a quem coleciona, a quem chega pelo Google e às IAs que leem o
// site. Os modernos não têm o bloco: estão vivos, e o lançamento em destaque
// diz mais sobre eles.
//
// UM arquivo, dois lugares, no molde do src/blog-render.js:
//   - na borda, functions/games/[[path]].js faz `import "../../src/sobre-jogo.js"`
//     e desenha o bloco em pt no HTML (é o que o robô sem JS lê, e a tela já
//     nasce com ele, sem pular);
//   - no navegador, o sets.html carrega este arquivo e o app.js redesenha o
//     bloco no idioma da pessoa, com os links da linha do tempo pros sets.
// Por isso é um script clássico que só pendura um objeto no globalThis: nada
// de DOM, de window nem do shared.js.
//
// O TEXTO mora em data/sobre/<url do jogo>.json (um por jogo, os três idiomas
// juntos). Campo de texto é string (vale pros três idiomas) ou { pt, en, es }.
// Jogo novo: o arquivo + o endereço em COM_SOBRE abaixo; o
// tests/sobre-jogo.test.mjs confere um contra o outro e os campos de cada um.
(function (root) {
  "use strict";

  // Jogos com o bloco (o `url` do functions/_lib/jogos.js). A borda só busca o
  // JSON de quem está aqui; o app.js tira o destaque do "Último set" deles.
  const COM_SOBRE = [
    "dragon-ball-carddass", "dragon-ball-visual-adventure", "dragon-ball-super-battle", "dragon-ball-super-barcode-wars",
    "gundam-carddass", "gundam-war", "carddass-masters",
    "naruto-card-game-2002", "naruto-data-carddass", "naruto-ccg", "naruto-shippuden-card-game", "naruto-trading-cards", "naruto-boruto-card-game",
    "hunter-x-hunter-carddass", "one-piece-carddass", "one-piece-card-game-2002", "miracle-battle-carddass",
    "harry-potter-tcg", "lord-of-the-rings-tcg", "dragon-ball-z-ccg", "world-of-warcraft-tcg"
  ];

  const IDIOMAS = ["pt", "en", "es"];

  // Rótulos da interface do bloco. Moram aqui, e não no src/i18n.js, porque a
  // borda também desenha o bloco e não tem o i18n (o mesmo caso do blog).
  const ROTULOS = {
    pt: {
      secao: "Sobre o jogo", historia: "História", linha: "Linha do tempo", fontes: "Fontes",
      mais: "Saber mais", menos: "Mostrar menos", logo: "Logo do jogo", verSet: "Ver o set",
      fatos: {
        lancamento: "Lançamento", encerramento: "Encerramento", fabricante: "Fabricante",
        licenca: "Licença", origem: "Origem", distribuicao: "Distribuição", formato: "Formato", preco: "Preço original"
      },
      meses: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
      mesAno: (mes, ano) => `${mes} de ${ano}`
    },
    en: {
      secao: "About the game", historia: "History", linha: "Timeline", fontes: "Sources",
      mais: "Learn more", menos: "Show less", logo: "Game logo", verSet: "See the set",
      fatos: {
        lancamento: "Released", encerramento: "Ended", fabricante: "Publisher",
        licenca: "License", origem: "Origin", distribuicao: "Distribution", formato: "Format", preco: "Original price"
      },
      meses: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      mesAno: (mes, ano) => `${mes} ${ano}`
    },
    es: {
      secao: "Sobre el juego", historia: "Historia", linha: "Cronología", fontes: "Fuentes",
      mais: "Saber más", menos: "Mostrar menos", logo: "Logo del juego", verSet: "Ver el set",
      fatos: {
        lancamento: "Lanzamiento", encerramento: "Fin", fabricante: "Fabricante",
        licenca: "Licencia", origem: "Origen", distribuicao: "Distribución", formato: "Formato", preco: "Precio original"
      },
      meses: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
      mesAno: (mes, ano) => `${mes} de ${ano}`
    }
  };
  // A ordem da ficha é a desta lista, seja qual for a do JSON.
  const FATOS = ["lancamento", "encerramento", "fabricante", "licenca", "origem", "distribuicao", "formato", "preco"];

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]); }

  function idioma(lang) {
    const l = String(lang || "").slice(0, 2).toLowerCase();
    return IDIOMAS.indexOf(l) >= 0 ? l : "pt";
  }
  // Texto no idioma: string vale pros três; objeto cai no pt quando falta.
  function tx(valor, lang) {
    if (valor == null) return "";
    if (typeof valor !== "object" || Array.isArray(valor)) return valor;
    return valor[lang] != null ? valor[lang] : (valor.pt != null ? valor.pt : "");
  }
  // "1988-11" -> "Novembro de 1988" / "November 1988"; "1997" -> "1997".
  // Escrito à mão, e não com o Intl, pra borda e navegador darem o MESMO texto.
  function dataLonga(valor, lang) {
    const m = /^(\d{4})(?:-(\d{2}))?/.exec(String(valor || ""));
    if (!m) return String(valor || "");
    if (!m[2]) return m[1];
    const R = ROTULOS[lang];
    const mes = R.meses[Number(m[2]) - 1];
    if (!mes) return m[1];
    const t = R.mesAno(mes, m[1]);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Mês curto da linha do tempo: "nov." / "Nov" (3 letras).
  function mesCurto(valor, lang) {
    const m = /^\d{4}-(\d{2})/.exec(String(valor || ""));
    if (!m) return "";
    const mes = ROTULOS[lang].meses[Number(m[1]) - 1] || "";
    return lang === "en" ? mes.slice(0, 3) : mes.slice(0, 3) + ".";
  }
  // Valor de um fato: data ("1988-11") vira data longa; o resto, texto.
  function valorDoFato(f, lang) {
    const v = tx(f.valor, lang);
    return f.chave === "lancamento" || f.chave === "encerramento" ? dataLonga(v, lang) : v;
  }
  // "1988–1997": o período do eyebrow.
  function periodo(dados) {
    const p = dados.periodo || {};
    const a = String(p.inicio || "").slice(0, 4), b = String(p.fim || "").slice(0, 4);
    return a && b && a !== b ? `${a}–${b}` : a || b;
  }

  // O bloco inteiro. `opcoes.hrefDoSet(setId)` devolve o endereço do set (ou
  // ""): o navegador sabe; a borda não passa, e a linha do tempo sai sem link
  // (o robô acha os sets pelo índice da página, logo abaixo).
  // `opcoes.prefixo` é a raiz dos caminhos do site ("/" na borda e no app).
  function html(dados, langPedido, opcoes) {
    const lang = idioma(langPedido);
    const R = ROTULOS[lang];
    const op = opcoes || {};
    const hrefDoSet = typeof op.hrefDoSet === "function" ? op.hrefDoSet : () => "";
    const raiz = op.prefixo == null ? "/" : op.prefixo;
    const nome = tx(dados.nome, lang);
    const orig = dados.nomeOriginal || null;
    const etiquetas = (dados.etiquetas || []).map((e) => tx(e, lang)).filter(Boolean);
    const per = periodo(dados);
    const eyebrow = etiquetas.concat(per ? [per] : []);
    const fatos = FATOS.map((chave) => (dados.fatos || []).find((f) => f && f.chave === chave)).filter((f) => f && tx(f.valor, lang));
    const historia = tx(dados.historia, lang) || [];
    const linha = (dados.linhaDoTempo || []).filter((e) => e && tx(e.texto, lang));
    // Fonte com link por idioma ({ pt, en }) quando ela tem versão traduzida
    // (a entrevista do site oficial de Dragon Ball tem a página em inglês).
    const fontes = (dados.fontes || []).map((f) => f && { nome: tx(f.nome, lang), url: String(tx(f.url, lang) || "") })
      .filter((f) => f && /^https:\/\//.test(f.url));

    const fichaHtml = fatos.length ? `<dl class="sx-sobre-fatos">${fatos.map((f) =>
      `<div><dt>${esc(R.fatos[f.chave])}</dt><dd>${esc(valorDoFato(f, lang))}</dd></div>`).join("")}</dl>` : "";

    const linhaHtml = linha.length ? `<section class="sx-sobre-cartao" aria-labelledby="sx-sobre-linha">
        <h3 id="sx-sobre-linha" class="sx-sobre-h3">${esc(R.linha)}</h3>
        <ol class="sx-linha">${linha.map((e) => {
          const href = e.set ? hrefDoSet(e.set) : "";
          const mes = mesCurto(e.data, lang);
          const texto = esc(tx(e.texto, lang));
          return `<li class="sx-linha-item"><time class="sx-linha-quando" datetime="${esc(e.data)}"><b>${esc(String(e.data).slice(0, 4))}</b>${mes ? ` <span>${esc(mes)}</span>` : ""}</time>`
            + `<p class="sx-linha-texto">${href ? `<a href="${esc(href)}" title="${esc(R.verSet)}">${texto}</a>` : texto}</p></li>`;
        }).join("")}</ol>
      </section>` : "";

    const historiaHtml = historia.length ? `<section class="sx-sobre-cartao" aria-labelledby="sx-sobre-historia">
        <h3 id="sx-sobre-historia" class="sx-sobre-h3">${esc(R.historia)}</h3>
        <div class="sx-sobre-texto">${historia.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
        ${fontes.length ? `<p class="sx-sobre-fontes"><span>${esc(R.fontes)}:</span> ${fontes.map((f) =>
          `<a href="${esc(f.url)}" target="_blank" rel="nofollow noopener noreferrer">${esc(f.nome)}</a>`).join(" · ")}</p>` : ""}
      </section>` : "";

    // História + linha do tempo nascem FECHADAS atrás do "Saber mais" do
    // cartão de cima (pedido de 2026-11-12: abertas, empurravam os sets uma
    // tela pra baixo). O botão mora no canto de cima, na altura do título
    // (no celular desce pro pé do cartão, ver .sx-sobre-id no styles.css).
    // O texto está no HTML mesmo fechado: é o que o robô lê.
    // `opcoes.aberto` mantém aberto quem já abriu, quando o app redesenha.
    const temCorpo = !!(historiaHtml || linhaHtml);
    const aberto = temCorpo && !!op.aberto;
    const chevron = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
    const botaoHtml = temCorpo
      ? `<button type="button" class="sx-sobre-abre" aria-controls="sx-sobre-corpo" aria-expanded="${aberto}" data-mais="${esc(R.mais)}" data-menos="${esc(R.menos)}"><span>${esc(aberto ? R.menos : R.mais)}</span>${chevron}</button>`
      : "";

    return `<section class="sx-sobre" id="sobre" data-sobre-jogo="${esc(dados.url)}" data-idioma="${lang}" aria-label="${esc(R.secao)}">
      <div class="sx-sobre-topo${dados.logo ? "" : " sx-sobre-topo--sem-arte"}">
        ${dados.logo ? `<div class="sx-sobre-arte"><img class="sx-sobre-logo" src="${esc(raiz + String(dados.logo).replace(/^\//, ""))}" alt="${esc(R.logo)}: ${esc(nome)}" decoding="async"${dados.logoLargura && dados.logoAltura ? ` width="${Number(dados.logoLargura)}" height="${Number(dados.logoAltura)}"` : ""}></div>` : ""}
        <div class="sx-sobre-id">
          <div class="sx-sobre-cab">
            ${eyebrow.length ? `<p class="sx-eyebrow">${eyebrow.map(esc).join(" · ")}</p>` : ""}
            <h2 class="sx-sobre-nome">${esc(nome)}</h2>
            ${orig && orig.texto ? `<p class="sx-sobre-original"><span lang="${esc(orig.lang || "ja")}">${esc(orig.texto)}</span>${orig.romaji ? ` <small>${esc(orig.romaji)}</small>` : ""}</p>` : ""}
          </div>
          ${botaoHtml}
          ${dados.resumo ? `<p class="sx-sobre-resumo">${esc(tx(dados.resumo, lang))}</p>` : ""}
          ${fichaHtml}
        </div>
      </div>
      ${temCorpo ? `<div class="sx-sobre-corpo" id="sx-sobre-corpo"${aberto ? "" : " hidden"}>${historiaHtml}${linhaHtml}</div>` : ""}
    </section>`;
  }

  // JSON-LD do jogo (schema.org Game), só com o que a página mostra. A borda
  // serializa com o jsonLdSeguro (functions/_lib/json-ld.js).
  function jsonLd(dados, url, lang) {
    const l = idioma(lang);
    const fato = (chave) => { const f = (dados.fatos || []).find((x) => x && x.chave === chave); return f ? tx(f.valor, l) : ""; };
    const obj = {
      "@context": "https://schema.org",
      "@type": "Game",
      name: tx(dados.nome, l),
      url,
      description: tx(dados.resumo, l),
      inLanguage: l === "pt" ? "pt-BR" : l
    };
    if (dados.nomeOriginal && dados.nomeOriginal.texto) obj.alternateName = dados.nomeOriginal.texto;
    if (dados.logo) obj.image = "https://sleevu.app/" + String(dados.logo).replace(/^\//, "");
    const inicio = (dados.periodo || {}).inicio;
    if (inicio) obj.datePublished = String(inicio);
    if (fato("fabricante")) obj.publisher = { "@type": "Organization", name: fato("fabricante") };
    if (fato("origem")) obj.countryOfOrigin = { "@type": "Country", name: fato("origem") };
    return obj;
  }

  root.SleevuSobre = {
    COM_SOBRE, IDIOMAS, ROTULOS, FATOS,
    tem: (url) => COM_SOBRE.indexOf(String(url || "")) >= 0,
    html, jsonLd, tx, dataLonga, esc, idioma
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
