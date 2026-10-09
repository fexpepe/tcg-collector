# SEO e indexação

Como o Sleevu entra nos buscadores (Google, Bing e os que ele alimenta, as
buscas de IA) e como conferir se entrou. Uma parte mora no código; a outra é
configuração fora do repositório (Search Console, Bing Webmaster Tools,
Cloudflare), que só o Fernando consegue mexer.

## Ponto de partida (2026-09-30)

Medido ao vivo no dia em que este registro nasceu:

- **Google**: umas 6 páginas das 7.809 do sitemap. Eram a home e o /terms no
  `sleevu.app`, e /novidades, /sets, /artists e /graded no `www.sleevu.app`.
  Os títulos estavam em inglês ("Sleevu - For Collectors!"), porque o Googlebot
  renderiza com o navegador em en-US. "sleevu" no Google Brasil não trazia o
  site na primeira página. No Google dos EUA vinha "você quis dizer: sleeve" e
  três páginas do site.
- **Bing** (e por tabela DuckDuckGo, Yahoo, Ecosia e a busca do ChatGPT e do
  Copilot): nenhuma página. **Brave**: nenhuma.
- `www.sleevu.app` respondia 200 com o site inteiro, e o Google indexou páginas
  nele. `tcg-collector.pages.dev` também respondia 200, mas sem páginas
  indexadas, porque o canonical segura.
- `sleevu.com.br` fora do ar: a raiz sem registro DNS, o www com erro 1016.
- A Cloudflare devolvia 403 pros robôs de **treino** de IA (GPTBot, ClaudeBot,
  CCBot, Amazonbot, Bytespider, cohere-ai). Os de **busca** de IA passavam
  (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot).

## O que o código faz

| Onde | O quê |
|---|---|
| `scripts/prerender-catalog.mjs` | páginas estáticas da lista de jogos, da variante em inglês de cada set (`<set>-en`), de artista e de deck, com o texto já no HTML; os mapas que a borda lê (`data/game-pages/`) |
| `functions/games/[[path]].js` | as telas do app nos endereços /games: a de cada jogo (por cima do `sets.html`) e a de cada set e cada carta (por cima do `detail.html`), com título, descrição, JSON-LD e o texto que o robô sem JS lê |
| `functions/_lib/pagina-set.js`, `pagina-carta.js`, `decora-app.js` | os textos e o JSON-LD do set e da carta, e o que a borda põe no HTML da tela (inclusive a rota que o `detail.js` lê) |
| `functions/_lib/jogos.js` | o registro dos jogos: endereço oficial, apelidos e linhas (a cópia do `src/game.js` tem que bater) |
| `scripts/lib/sitemap.mjs` | o `sitemap.xml` é um índice, com um arquivo por tipo de página (tabela abaixo) |
| `src/theme.js` | robô vê o idioma que o HTML declara; página com `data-idioma-fixo` (as pré-renderizadas) nunca tem o `lang` trocado |
| `index.html` | JSON-LD `WebSite` + `Organization`: nome do site, logo, perfis oficiais (`sameAs`) |
| `scripts/indexnow.mjs` + `deploy.yml` | a cada deploy da main, avisa Bing, Yandex, Seznam, Naver e Yep do que entrou e saiu do sitemap |
| `robots.txt` | o que fica fora: telas pessoais, conta e parâmetros de filtro |

| Sitemap | Conteúdo |
|---|---|
| `sitemap-pages.xml` | páginas fixas (home, hub, /games, blog, FAQ…) |
| `sitemap-games.xml` | a tela de cada jogo (`/games/<jogo>`) |
| `sitemap-sets.xml` | páginas de set em português |
| `sitemap-sets-en.xml` | as mesmas em inglês |
| `sitemap-cards-<jogo>.xml` | todas as cartas do jogo; acima de 45 mil, `-2`, `-3`… (o limite do protocolo é 50 mil por arquivo) |
| `sitemap-artists.xml` | artistas |
| `sitemap-decks.xml` | decks da comunidade |
| `sitemap-blog.xml` | posts do blog, com `lastmod` |

**IndexNow.** A chave fica publicada em `sleevu.app/<chave>.txt`, o que o
protocolo exige; não é segredo. Na primeira vez (chave ainda fora do ar) vai o
sitemap inteiro. Depois, só a diferença. O log do passo "IndexNow — separa as
URLs novas" diz quantas URLs foram e por quê. O passo "IndexNow — avisa os
buscadores" mostra o HTTP e a resposta de cada lote: 200 ou 202 é aceito.
Teto de 20 mil URLs por deploy (`TETO_POR_DEPLOY` em
`scripts/lib/indexnow.mjs`): jogos, sets e endereços antigos vão primeiro,
cartas completam até o teto e o resto fica pro sitemap. Sem o teto, a mudança
pra `/games` (~290 mil cartas de uma vez) viraria dezenas de lotes num deploy
só.

Chave nova só é conferida quando chega o primeiro envio. Até o IndexNow
terminar, a resposta é 403 com `SiteVerificationNotCompleted`, e o passo de
envio espera e tenta de novo por até 10 minutos. Na estreia (30/09/2026) o
passo ainda desistia na hora. As 7.834 URLs foram reenviadas à mão às 19:23
UTC, uns 5 minutos depois do deploy, e aceitas (HTTP 200). Ao trocar a chave,
confira esse passo no log do primeiro deploy.

## Endereços (2026-09-30, telas do app desde 2026-10-01)

Sempre em inglês (o site é pra todo mundo, não só pro Brasil), no molde do
TCGplayer: jogo, set e carta aninhados, cada nível uma página. E cada
endereço é a TELA DO APP, a mesma que a pessoa usa navegando: não existe uma
"página do Google" separada do app (até 2026-10-01 o set e a carta tinham
página estática própria e o app seguia em `/detail?…`).

| Endereço | O que é | Quem monta |
|---|---|---|
| `/games` | todos os jogos, modernos e vintage | estática (`prerender-catalog`) |
| `/games/<jogo>` | a tela de Sets do app, com título, descrição e índice de sets próprios | borda, por cima do `sets.html` |
| `/games/<jogo>/<set>` | a tela do set do app, com título, JSON-LD (CollectionPage) e o índice das cartas | borda, por cima do `detail.html`, dos mesmos chunks do app |
| `/games/<jogo>/<set>/<carta>` | a mesma tela com o popup da carta aberto, com o título, o JSON-LD (Product só quando a carta tem preço; sem preço, só a trilha) e o texto da carta | borda, idem |
| `/games/<jogo>/<set>-en` | a variante em inglês do set (hreflang) | estática (`prerender-catalog`) |
| `/games/<jogo>/_id/<id>` | link de compartilhar do app | 301 pra carta |

- **A rota** vai no HTML num `<meta name="sleevu-rota">` (nome do set, jogo e
  carta; o content é o caminho). O `detail.js` lê daí no lugar da query de
  `/detail?type=set&…`. Numa cópia sem ele (a reserva do service worker,
  offline), acha o set no mapa do jogo e a carta pelo nome no endereço.
- **Dentro do app**, `/detail?type=set&…` continua funcionando (a grade de Sets,
  a busca e os links antigos usam), e a barra passa sozinha pro endereço do
  set assim que a tela carrega. O popup troca a barra pro endereço da carta ao
  abrir e volta pro do set ao fechar. A tela "dentro da coleção"
  (`&scope=collection`) e as de Pokémon, artista e treinador seguem em
  `/detail?…`.

- `<jogo>` é o nome inteiro do jogo (`star-wars-unlimited`, não `swu`). Linha
  vintage tem endereço próprio (`/games/one-piece-carddass`). Apelido, a chave
  interna do jogo, maiúscula, barra no fim e `.html` levam 301 pro oficial.
- `<carta>` é nome + número impresso (+ total, quando o número é só dígitos) +
  idioma quando não é inglês (`charizard-4-102`, `charizard-4-102-jp`). Empate
  ganha `-2`, `-3` na ordem do id. A regra é uma só
  (`functions/_lib/slug-carta.js`) pro build e pra borda.
- **Endereços antigos seguem valendo**, como 301: `/set/<slug>` pelo
  `data/game-pages/legado-sets.json` e `/card/<slug>` pelas fatias
  `data/game-pages/legado-cartas/<1ª letra>.json` (vão direto pra tela do
  set/da carta), e
  `/sets?game=<jogo>[&line=…]` pelo `functions/sets.js`. O `/sets` sem jogo
  continua respondendo 200 (é o que o service worker guarda no install e o
  que o PWA instalado abre), com `noindex`.
- **Endereço de set ou carta que mudou também leva 301** (2026-10-08). O nome
  da carta no endereço leva o total do set, e o total muda quando o set
  cresce: cada build completo trocava o endereço das ~2.600 cartas do Secret
  Lair Drop, e os sets em pré-venda (Lorcana) mudavam a cada leva revelada.
  Quando a carta pedida não existe no set, a borda procura a mesma carta com
  outro total, ou o mesmo número com outro nome (`cartaParecida`); quando o
  set não existe, procura um set cujo nome termine no pedido (`setRenomeado`:
  o TCGCSV pôs "ST-11" na frente dos Starter Decks do One Piece). Conferido
  contra os snapshots do catálogo de 29/09 a 04/10: as 10.253 cartas que
  mudaram de endereço dentro do mesmo set acham a carta certa, nenhuma errada.
  O que não acha segue 404.
- **Offline e PWA**: o service worker guarda cada `/games/<jogo>` na entrada
  dela (com o título e o índice daquele jogo) e usa a do `sets.html`, que o
  install guarda, de reserva: a tela de um jogo nunca visitado abre offline.
  Uma entrada só pra todos os jogos entregava, na troca de jogo, a cópia do
  anterior (título errado na aba).
  O mesmo vale pra cada set e cada carta, com a reserva do `detail.html`.
  O `sets.html` e o `detail.html` têm `<base href="/">`: cada um responde no
  endereço antigo e nos de `/games/…`, e os links relativos têm que valer nos
  dois.
- **Nome da carta no endereço calculado em dois lugares**: a borda
  (`functions/_lib/slug-carta.js`) e o `detail.js` (cópia, script clássico).
  O `tests/slug-carta-cliente.test.mjs` roda os dois nas mesmas cartas; se
  divergirem, o endereço que o app mostra dá 404.
- A tela do set e a da carta não são arquivos do deploy (seriam ~290 mil
  cartas; o Pages aceita 20 mil): a borda lê o mapa do jogo, o chunk do set e
  o preço, e guarda o HTML decorado no cache da borda por 24 h, com o build na
  chave, antes da vitrine (o nonce da CSP é por resposta).

## Fora do repositório

Em ordem de impacto:

1. **Google Search Console.** A propriedade de domínio já está verificada (TXT
   `google-site-verification` no DNS).
   - *Sitemaps*: enviar `https://sleevu.app/sitemap.xml`. Se já estava enviado,
     reenviar uma vez pra ele ler o índice novo.
   - *Páginas*: filtrar por sitemap mostra, por tipo, o que não entra e o
     motivo. "Detectada, mas não indexada" é falta de autoridade ou de
     rastreio. "Rastreada, mas não indexada" é o Google achando a página fraca
     ou duplicada.
   - *Inspeção de URL* → "Solicitar indexação" pra home, /games, /hub,
     /explore, /blog, a tela dos jogos principais (`/games/pokemon`…) e os sets
     mais procurados. A cota é de uns 10 por dia.
   - Depois do deploy, inspecionar a home e usar "Testar URL publicada" →
     HTML renderizado. O título tem que sair em português.
2. **Bing Webmaster Tools** (bing.com/webmasters): "Importar do Google Search
   Console" traz o site verificado e o sitemap. É o que põe o Sleevu no Bing,
   DuckDuckGo, Yahoo, Ecosia e na busca do ChatGPT e do Copilot. O IndexNow já
   avisa sozinho, mas o painel mostra o que foi aceito e os erros.
3. **Cloudflare, zona sleevu.app**: Rules → Redirect Rules → modelo "Redirect
   from WWW to Root" (301, mantendo caminho e query). Enquanto o www responder
   200, a pouca autoridade do site fica dividida entre dois endereços.
4. **Cloudflare, zona sleevu.com.br**: pra redirecionar, criar um registro
   proxied na raiz e outro no www (`AAAA` apontando pra `100::`, o endereço de
   mentira que a Cloudflare documenta pra domínio sem servidor) e uma Redirect
   Rule pra `https://sleevu.app` com o caminho, 301. Se o domínio não vai ser
   usado, dá pra apagar a zona.
5. **Cloudflare, AI Crawl Control**: hoje bloqueia os robôs de treino de IA. Os
   de busca passam, então ChatGPT, Perplexity e Claude conseguem achar e citar
   o site quando buscam. Liberar os de treino faz as próximas versões dos
   modelos conhecerem o Sleevu sem precisar buscar. É decisão de produto. O
   comentário do `robots.txt` ("nada aqui bloqueia crawler de IA") vale pro
   arquivo, não pro painel.
6. **Opcional, `tcg-collector.pages.dev`**: Bulk Redirect (nível de conta) pro
   sleevu.app. Não tem página indexada, então é só higiene. O `sync-ppt.mjs`,
   o `sync-price-history.mjs` e o `indexnow.mjs` leem o site pelo pages.dev no
   build. Com o redirect eles seguem funcionando (o fetch segue o 301), mas
   passam a depender do sleevu.app responder ao runner do GitHub, o que o Bot
   Fight Mode ligado impediria.

## Como conferir

- O `site:` do Google é amostra, não contagem. A conta certa é o relatório de
  Páginas do Search Console, por sitemap.
- Bing: Webmaster Tools → URLs enviadas por IndexNow, e o Site Explorer.
- O robô vê o texto do HTML, em pt-BR. O que o Google renderizou aparece na
  Inspeção de URL → HTML renderizado.

## Relatório de Páginas (2026-10-08)

Uma semana depois das cartas entrarem no sitemap (337.556 URLs), o Search
Console mostrava isto em "Por que as páginas não foram indexadas". A leitura
de cada linha veio de medição ao vivo (amostra de 1.606 URLs do sitemap: todas
200; os sitemaps de julho versionados no git; os snapshots do catálogo; o log
do IndexNow), porque o painel só dá exemplos:

| Motivo | Páginas | O que é |
|---|---|---|
| Detectada, mas não indexada | 304.451 | o Google achou pelo sitemap e ainda não rastreou: domínio novo, pouca autoridade (ver abaixo). Não é erro de código |
| Excluída pela tag "noindex" | 1.875 | as cascas do app em `/detail?…`, de propósito. O app linka pra elas (cada carta tem ~13 links de "Impressões" pra `/detail?type=set&…&card=<id>`; a grade de Sets linka cada set por `/detail?…`), e o robô gasta rastreio nelas |
| Não encontrado (404) | 615 | era bug: `/card/` e `/set/` antigos sem 301 (906 das 1.269 cartas e 68 dos 1.236 sets do sitemap de julho) e cartas de `/games` que mudaram de endereço a cada build. Corrigido em 2026-10-08 (ver "Endereços") |
| Rastreada, mas não indexada | 596 | o Google leu e achou fraca ou repetida. Carta chinesa ou japonesa sem nome em inglês sai com endereço só de número (`091-098-zh-2`) e texto quase igual ao da edição inglesa |
| Página com redirecionamento | 81 | www, http, apelidos e endereços antigos: esperado |
| Página alternativa com tag canônica adequada | 25 | `/detail?type=set&…` com canonical pro set e variações com query: esperado |
| Bloqueada pelo robots.txt | 6 | telas pessoais e conta (`/login`, `/collection`…): esperado |
| Indexada, mas bloqueada pelo robots.txt | 3 | telas que o robots barra mas que têm link em toda página (o menu): o Google indexa o endereço sem ler. Pra sair do índice, a página tem que ser liberada no robots e levar `noindex` |
| Erro soft 404 | 1 | sem exemplo; abrir a linha no painel |
| Cópia, Google escolheu canônica diferente | 3 | sem exemplo |

O build completo trocava ~2.600 endereços de carta por vez (o "N nova(s) e N
removida(s)" do passo do IndexNow). Depois do 301 eles param de virar 404, mas
o Secret Lair segue mudando de endereço a cada build: o Google vê as cartas
dele como redirecionamento até o total parar de crescer.

## O que o código não resolve

- **Links de fora.** É o que tira um domínio novo do "Detectada, mas não
  indexada": o link no perfil do Instagram, parceiros (lojas, MYP, Liga)
  linkando pro sleevu.app, posts em comunidades e o blog sendo citado.
- **"sleevu" virando "sleeve".** Some quando o Google associa o nome à marca:
  menções com o nome escrito sempre igual (Sleevu, sleevu.app), perfis
  oficiais com o link, e gente buscando o nome e clicando no site. Perfil
  oficial novo (TikTok, YouTube…) entra no `sameAs` do JSON-LD da home.
