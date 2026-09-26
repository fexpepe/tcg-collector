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
  // sw- (as pastilhas de cor por jogo) só existe no settings.html e vive LOGO
  // DEPOIS do .setting-swatch, sobrescrevendo a cor do texto dele. Se um sai e o
  // outro fica, a ordem inverte e a pastilha muda de cor — por isso viajam juntos.
  { nome: "conta",     prefixos: ["setting-", "profile-", "admin-", "adm-", "ach-", "sw-"], paginas: ["settings.html", "profile.html", "admin.html"] },
  { nome: "wishlist",  prefixos: ["wish-"],                        paginas: ["wishlist.html"] },
  { nome: "vendas",    prefixos: ["sold-"],                        paginas: ["sales.html"] },
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
  { nome: "colecao",   prefixos: ["coll-", "prof-", "tag-", "cond-"], paginas: ["collection.html", "pastas.html"] },
  // ctr- é o medidor de centralização. Morou na aba Graded da Coleção (a
  // página /graded saiu em 2026-09-14) e em 2026-09-16 virou atalho do HUB
  // pessoal — o modal abre por cima do dashboard, que precisa da fatia. A
  // Coleção segue carregando: o centering.js continua nela (o preview de
  // slab pode chamá-lo).
  { nome: "medidor",   prefixos: ["ctr-"],                          paginas: ["collection.html", "dashboard.html"] },
  { nome: "detalhe",   prefixos: ["favorite-", "segmented-"],      paginas: ["detail.html"] },
  { nome: "404",       prefixos: ["notfound-"],                    paginas: ["404.html"] },
  { nome: "set",       prefixos: ["facet-", "mkt-"],               paginas: ["detail.html", "sets.html", "decks.html", "my-decks.html"] },
  { nome: "troca",     prefixos: ["trade-"],                       paginas: ["troca.html", "badges.html"] },
  { nome: "goldfish",  prefixos: ["gf-"],                          paginas: ["decks.html", "my-decks.html"] },
  { nome: "faq",       prefixos: ["faq-"],                         paginas: ["faq.html"] }
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
