// Tabela das folhas de CSS por área — quem é de qual página. Mora aqui (e não
// dentro do scripts/split-css.mjs, onde nasceu) porque dois scripts precisam
// dela: o split-css, que reparte o styles.css no deploy, e o check.mjs, que
// barra a página que usa classe de uma área sem estar na lista dela.

// Área -> prefixos de classe. Uma página que desenha QUALQUER classe de uma
// área precisa estar nas `paginas` dela — senão, em produção, a regra mora numa
// folha que a página não carrega e o componente chega sem estilo (no repositório
// o styles.css é um só e tudo parece certo). O scripts/check.mjs confere isso:
// cruza as classes de cada área com o src/*.js e os HTML, e cada .js com as
// páginas que o carregam.
export const AREAS = [
  { nome: "landing",   prefixos: ["lp-", "support-"],              paginas: ["index.html"] },
  { nome: "login",     prefixos: ["login-"],                       paginas: ["login.html"] },
  // dkc- é o CONSTRUTOR de deck (10 KB), e o prefixo "deck" não o alcança —
  // eram 10 KB do editor de decks em TODAS as ~30 páginas. Mesmas páginas da
  // área: as classes só existem no src/decks.js, que só decks/my-decks carregam.
  { nome: "decks",     prefixos: ["deck", "dkc-"],                 paginas: ["decks.html", "my-decks.html"] },
  // collection.html entrou em 2026-09-14: a Coleção passou a usar .pf-filter
  // (barra de filtros no molde do Portfólio) e sem a folha ela chegava sem estilo.
  { nome: "portfolio", prefixos: ["pf-"],                          paginas: ["portfolio.html", "collection.html"] },
  // binder- são 19 KB (a maior fatia solta do núcleo). Além da própria página,
  // a Coleção precisa: o collection.js desenha .binder-shared-banner/-info.
  // detail.html entrou em 2026-09-14: o fichário da página de set (binder-rail,
  // binder-nav…) usa as classes do Binder, e sem a folha ele chegava sem estilo.
  // pastas.html e explore.html entraram em 2026-09-26, pelo MESMO motivo: as
  // duas ganharam o fichário (src/binder-view.js) e ninguém lembrou daqui. Em
  // produção o fichário da pasta virava uma carta por tela, do tamanho da
  // página — o bolso sem aspect-ratio e a trilha sem flex. Foi o que motivou a
  // guarda do check.mjs.
  { nome: "binders",   prefixos: ["binder-"],                      paginas: ["binders.html", "collection.html", "detail.html", "pastas.html", "explore.html"] },
  { nome: "badges",    prefixos: ["bdg-"],                         paginas: ["badges.html"] },
  // hub- só existe no hub.html/hub.js. (O "hub-vs-jogo" que aparece no
  // shared.js é texto de comentário, não classe — conferido.)
  { nome: "hub",       prefixos: ["hub-"],                         paginas: ["hub.html"] },
  // hb- (2026-10-08) é o Hub PESSOAL (dashboard.html/dashboard.js), não o
  // hub.html de cima. O .dash- antigo segue no núcleo porque vendas, desejos,
  // badges e backup também desenham .dash-head/.dash-stat-*; o redesenho do
  // Hub entrou com prefixo próprio pra não pesar nas outras ~30 páginas.
  { nome: "painel",    prefixos: ["hb-"],                          paginas: ["dashboard.html"] },
  // xpl- (2026-09-28) é o que só a busca global desenha: os chips de resultado
  // por jogo e o selo de posição das mais vistas. Só o src/explore.js monta
  // essas classes (o prefixo "explore-" não serve: a .explore-subnav é das
  // páginas de jogo). Nasceu em área própria porque o núcleo já estava a 98%
  // do teto do check-size. A etiqueta de jogo dos tiles (.tile-game) NÃO é
  // daqui: Coleção e Wishlist também a desenham, e ela mora no núcleo.
  { nome: "explorar",  prefixos: ["xpl-"],                         paginas: ["explore.html"] },
  // sw- (as pastilhas de cor por jogo) só existe no settings.html e vive LOGO
  // DEPOIS do .setting-swatch, sobrescrevendo a cor do texto dele. Se um sai e o
  // outro fica, a ordem inverte e a pastilha muda de cor — por isso viajam juntos.
  // parceiro.html entrou em 2026-09-28 (portal da loja, Analytics 2.1): o
  // relatório usa os cartões, tabelas e gráficos do /admin (.admin-*, .adm-*).
  { nome: "conta",     prefixos: ["setting-", "profile-", "admin-", "adm-", "ach-", "sw-"], paginas: ["settings.html", "profile.html", "admin.html", "parceiro.html"] },
  { nome: "wishlist",  prefixos: ["wish-"],                        paginas: ["wishlist.html"] },
  // vnd- entrou em 2026-09-27 com as pastas de venda (galeria, cartão-herói e
  // preço em lote da pasta aberta) — só o sales.js desenha.
  { nome: "vendas",    prefixos: ["sold-", "vnd-"],                paginas: ["sales.html"] },
  { nome: "ajuda",     prefixos: ["help-"],                        paginas: ["help.html"] },
  // 2026-09-14: segunda leva, medida com o CSS INTEIRO a 99% do teto do CI. Cada
  // prefixo foi conferido contra os 35 HTML + os src/*.js que cada página
  // carrega (e os módulos injetados em runtime, que valem em toda página):
  // nenhum aparece no shared.js nem fora das páginas listadas. Juntas tiram
  // ~60 KB brutos do núcleo, somando os prefixos novos das áreas de cima
  // (support- na landing, adm-/ach- na conta).
  // pastas.html entrou em 2026-09-26: a pasta aberta tem a cara da Toda
  // Coleção e reusa o cartão-herói e a "Visão geral" dela (.coll-hero,
  // .coll-overview) — sem a folha, em produção os dois saíam com o layout cru.
  // sales.html entrou em 2026-09-27 pelo MESMO motivo: as pastas de venda são
  // o card em pilha do Showcase (.coll-card-pile) e a pasta aberta usa o
  // cartão-herói e a "Visão geral" da Coleção.
  { nome: "colecao",   prefixos: ["coll-", "prof-", "tag-", "cond-"], paginas: ["collection.html", "pastas.html", "sales.html"] },
  // ctr- é o Centering Tool. A v1 era um modal que morou na Coleção, no HUB
  // e na página Ferramentas; a v2 (2026-10-01, docs/PLANO-CENTERING-V2.md) é
  // página própria e só ela carrega o centering.js, então a fatia vai só pra
  // lá. Coleção, HUB e /tools levam só um link pra /centering.
  { nome: "medidor",   prefixos: ["ctr-"],                          paginas: ["centering.html"] },
  { nome: "detalhe",   prefixos: ["favorite-", "segmented-"],      paginas: ["detail.html"] },
  { nome: "404",       prefixos: ["notfound-"],                    paginas: ["404.html"] },
  { nome: "set",       prefixos: ["facet-", "mkt-"],               paginas: ["detail.html", "sets.html", "decks.html", "my-decks.html"] },
  { nome: "troca",     prefixos: ["trade-"],                       paginas: ["troca.html", "badges.html"] },
  // Ferramentas do HUB em página própria (2026-10-01, docs/FERRAMENTAS.md):
  // fer- é o comum das duas, gc- o Guia de condição e slv- o Sleeves e
  // fichários. O guia NÃO usa cond-: esse prefixo é da área "colecao". A
  // tools.html (o índice, aonde leva o "Mais" do menu) usa o fer-. Endereços
  // em inglês desde 2026-10-01 (condicao.html → condition.html, ferramentas.html
  // → tools.html). centering.html entra porque reusa o .fer-page/.fer-card
  // (cores e cartão) em volta da ferramenta, que é ctr- (área "medidor").
  { nome: "ferramentas", prefixos: ["fer-", "gc-", "slv-"],        paginas: ["condition.html", "sleeves.html", "tools.html", "centering.html"] },
  { nome: "goldfish",  prefixos: ["gf-"],                          paginas: ["decks.html", "my-decks.html"] },
  { nome: "faq",       prefixos: ["faq-"],                         paginas: ["faq.html"] },
  // blog- (2026-09-30): a lista, o post e o EDITOR — a prévia do editor desenha
  // o post com as mesmas classes (o src/blog-render.js é um só). bed- é só do
  // editor (a tela de escrever), que ninguém mais carrega.
  { nome: "blog",      prefixos: ["blog-"],                        paginas: ["blog.html", "blog-post.html", "blog-editor.html"] },
  { nome: "blogeditor", prefixos: ["bed-"],                        paginas: ["blog-editor.html"] },
  // srt- (2026-09-30): o menu do Ordenar (src/ordenar.js). EXATAMENTE as
  // páginas que carregam o script — toda grade de cartas que ordena.
  { nome: "ordenar",   prefixos: ["srt-"],                         paginas: ["cards.html", "collection.html", "detail.html", "explore.html", "wishlist.html", "sales.html", "binders.html", "pastas.html"] },
  // vitrine (o espaço de anúncio, 2026-09-27): EXATAMENTE as páginas que
  // carregam o src/ads.js. O check.mjs cruza as duas listas (a guarda 9 barra
  // o script numa página pessoal; a 8, a classe numa página fora daqui).
  // Prefixo vtr- e não "vitrine": "vitrine" já é a aba de coleções em cards da
  // Coleção (collection.js) e palavra de texto em outros arquivos.
  { nome: "vitrine",   prefixos: ["vtr-"],                      paginas: ["detail.html", "sets.html", "cards.html", "explore.html", "pokedex.html", "artists.html", "trainers.html", "lancamentos.html", "decks.html"] },
  // trilha (2026-09-30): "Jogos › Pokémon › <set>" no topo das abas do jogo e
  // da página de set — as páginas que têm o <nav class="crumbs"> no HTML. Fora
  // do núcleo porque ele estava a ~200 bytes gz do teto e a trilha sozinha
  // levava ~180; nenhuma outra página desenha a classe.
  { nome: "trilha",    prefixos: ["crumbs"],                       paginas: ["cards.html", "sets.html", "pokedex.html", "lore.html", "trainers.html", "artists.html", "detail.html"] }
];

// Classes que PARECEM de área mas não podem sair: alguma regra posterior do
// núcleo depende de vir depois delas. `.pf-head` é do portfólio, mas o
// `.dash-head` que o segue é compartilhado com dashboard/badges/vendas — mover só
// um dos dois inverte a ordem e muda o layout do cabeçalho.
// Esta lista é o resultado do diff de estilo computado (scripts/diff-computed-style.mjs)
// entre antes e depois: qualquer classe que apareça lá entra aqui.
// As `setting-*` da lista são o campo de @handle do modal de onboarding, que o
// shared.js (não o settings.js) desenha — ele abre na VOLTA DO LOGIN, em cima
// da tela "Entrando…", e o login.html não carrega a folha de conta. Ficavam sem
// estilo nenhum: o "@" descolado do campo e o aviso de disponibilidade sem cor.
// São ~500 bytes; ficam no núcleo em vez de arrastar os 8 KB da folha de conta
// pra dentro do login.
export const FICA_NO_NUCLEO = new Set([
  "pf-head",
  "setting-handle", "setting-input", "setting-field-status"
]);
