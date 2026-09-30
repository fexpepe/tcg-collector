// Textos do blog (blog.html e blog-post.html). Pacote SEPARADO do i18n.js pelo
// mesmo motivo dos decks e das pastas: só essas páginas usam.
// O que é do ARTIGO (autor, "min de leitura", nome das categorias no cartão)
// não mora aqui: sai do src/blog-render.js no idioma do POST, que a borda
// escreve pronto. Aqui fica o que é da INTERFACE, no idioma de quem lê.
// (A "nav.blog", do menu, vive no i18n.js: o menu aparece em toda página.)
// Merge por IDIOMA, como os outros pacotes: a ordem de carga não importa.
(function () {
  const M = (window.TCG_MESSAGES = window.TCG_MESSAGES || {});

  M.pt = Object.assign(M.pt || {}, {
    "blog.title": "Blog - Sleevu",
    "blog.heading": "Blog",
    "blog.sub": "Guias, mercado e a história das cartas — escrito por quem coleciona.",
    "blog.manage": "Escrever e editar",
    "blog.editPost": "Editar este post",
    "blog.catsLabel": "Categorias",
    "blog.gameLabel": "Jogo",
    "blog.allCats": "Tudo",
    "blog.allGames": "Todos os jogos",
    "blog.loading": "Carregando…",
    "blog.more": "Carregar mais",
    "blog.empty": "Nenhum post por aqui ainda. Volte em breve.",
    "blog.emptyFilter": "Nenhum post com esse filtro.",
    "blog.tagActive": "Assunto: {tag}",
    "blog.clearFilter": "Limpar filtro",
    "blog.loadError": "Não deu pra carregar agora. Tente de novo em instantes.",
    "blog.notFound": "Não achamos esse post.",
    "blog.back": "Voltar pro blog",
    "blog.copied": "Link copiado",
    "blog.have": "Tenho",
    "blog.haveN": "Tenho {n}",
    "blog.haveAdd": "Marcar que tenho {card}",
    "blog.want": "Quero",
    "blog.wantOn": "Na lista de desejos",
    "blog.wantToggle": "Lista de desejos: {card}"
  });

  M.en = Object.assign(M.en || {}, {
    "blog.title": "Blog - Sleevu",
    "blog.heading": "Blog",
    "blog.sub": "Guides, market and the history of the cards — written by collectors.",
    "blog.manage": "Write and edit",
    "blog.editPost": "Edit this post",
    "blog.catsLabel": "Categories",
    "blog.gameLabel": "Game",
    "blog.allCats": "All",
    "blog.allGames": "All games",
    "blog.loading": "Loading…",
    "blog.more": "Load more",
    "blog.empty": "No posts here yet. Check back soon.",
    "blog.emptyFilter": "No posts match this filter.",
    "blog.tagActive": "Topic: {tag}",
    "blog.clearFilter": "Clear filter",
    "blog.loadError": "Couldn't load right now. Try again in a moment.",
    "blog.notFound": "We couldn't find this post.",
    "blog.back": "Back to the blog",
    "blog.copied": "Link copied",
    "blog.have": "Have",
    "blog.haveN": "Have {n}",
    "blog.haveAdd": "Mark that I have {card}",
    "blog.want": "Want",
    "blog.wantOn": "On your wishlist",
    "blog.wantToggle": "Wishlist: {card}"
  });

  M.es = Object.assign(M.es || {}, {
    "blog.title": "Blog - Sleevu",
    "blog.heading": "Blog",
    "blog.sub": "Guías, mercado y la historia de las cartas — escrito por coleccionistas.",
    "blog.manage": "Escribir y editar",
    "blog.editPost": "Editar este post",
    "blog.catsLabel": "Categorías",
    "blog.gameLabel": "Juego",
    "blog.allCats": "Todo",
    "blog.allGames": "Todos los juegos",
    "blog.loading": "Cargando…",
    "blog.more": "Cargar más",
    "blog.empty": "Todavía no hay posts. Vuelve pronto.",
    "blog.emptyFilter": "Ningún post con este filtro.",
    "blog.tagActive": "Tema: {tag}",
    "blog.clearFilter": "Quitar filtro",
    "blog.loadError": "No se pudo cargar ahora. Inténtalo de nuevo en un momento.",
    "blog.notFound": "No encontramos este post.",
    "blog.back": "Volver al blog",
    "blog.copied": "Enlace copiado",
    "blog.have": "Tengo",
    "blog.haveN": "Tengo {n}",
    "blog.haveAdd": "Marcar que tengo {card}",
    "blog.want": "Quiero",
    "blog.wantOn": "En tu lista de deseos",
    "blog.wantToggle": "Lista de deseos: {card}"
  });
})();
