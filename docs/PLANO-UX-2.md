# Plano UX 2 — performance sem perder qualidade + a segunda safra (2026-08-29)

Segunda análise profunda do Sleevu contra os concorrentes — principalmente o
**Collectr** — quatro dias depois de o [primeiro plano](PLANO-UX.md) ter os seis
pacotes entregues. O pedido do Fernando desta vez: melhorar **experiência e
feeling**, com foco também em **performance — sem que a performance tire nenhuma
qualidade do que existe** (nem de imagem, nem de nada), avaliando inclusive
"hospedar mais imagens no próprio servidor". E sem quebrar o que já existe.

Método: 5 auditorias de código em paralelo (rede, imagens, UX, dados ociosos,
mobile/PWA) + 3 pesquisas de mercado (Collectr ago/2026, trackers, Brasil) +
**6 verificadores adversariais** que tentaram refutar cada alegação lendo o
código real antes de o plano ser escrito. O plano anterior teve 3 erros de
auditoria descobertos na execução; este nasce com 51 alegações verificadas —
as 2 refutadas e as corrigidas estão registradas na §7, porque errar por
escrito e corrigir por escrito é o padrão da casa.

Estrutura: uma trilha de **performance (P1–P9)**, as **10 melhorias (M1–M10)**
e as **10 features (F1–F10)** — mais **extras (E1–E6)** porque o Fernando
autorizou passar de 10+10. Esforço: **P** (até uma sessão), **M** (algumas),
**G** (projeto).

---

## 1. Leitura competitiva — o que mudou desde 2026-08-25

### Collectr hoje (v2.5.6, 11/ago/2026)

Segue o rei: 4M+ usuários, ARR de 8 dígitos, bootstrapped, 4,8★ com ~77k
avaliações. Novidades 2025-26: Trade Analyzer ganhou **histórico de trades
salvos** (o F1 do Sleevu já nasceu com isso), **Compare Grades**, redesign
"Glass UI", **All Portfolios** (valor agregado), deep links de Showcase/Set,
quick-add por long-press. Pro segue US$4,99/mês anual; atrás do paywall:
scans ilimitados, histórico 5 anos, **export de dados**, widgets.

O que mudou nas reclamações — e importa pro Sleevu:

- A reclamação nº 1 **migrou do paywall pra PRECISÃO**: "95% das vezes tenho
  que usar entrada manual" (scanner), "preços imprecisos no high-end".
- **Só PSA** nas graduadas — usuários pedem BGS/CGC há anos (o Sleevu já tem
  PSA/BGS/CGC/SGC/TAG).
- Japonês segue fraco: promos JP sem match, chinês ausente (o eixo JA/ZH do
  Sleevu ataca exatamente isso).
- Social do app quebrado ("posts, messages and notifications have stopped
  working") — apostar em social pesado é o erro deles, não o caminho.

### O mercado em uma linha: fadiga de assinatura

Dex (3 pastas grátis, lifetime de US$109 chamado de "ridiculous", 60
conquistas pagas), Dragon Shield (ads após o 1º scan), Pokellector (US$60/ano
só pra sync), Ludex (US$9,99/mês com scanner "50/50"). O TCGplayer respondeu
com **scanner grátis e ilimitado pra todos os TCGs** (ago/2025). Novos players:
Dex lançou **versão web** (jul/2026), Shiny despontou com **price alerts +
centering tool** (500k usuários). "Grátis de verdade" deixou de ser detalhe e
virou o posicionamento mais defensável da categoria — que é o do Sleevu.

### Brasil: apareceram concorrentes diretos

- **Bynx.gg** — "quanto vale sua coleção Pokémon TCG hoje?": preço em R$ por
  variante (mín/méd/máx), catálogo com as edições Copag, scan IA, marketplace
  que fecha via WhatsApp. É a tese do Sleevu, mono-jogo e com scanner.
- **Pokélens TCG** — app Android BR, 100% offline, preços em R$ com link pros
  marketplaces. Prova que "offline + R$" ressoa aqui.
- **Liga**: a ferramenta Coleções segue desktop-first, o app **não cadastra
  coleção** (pedido aberto no fórum), preços de coleção param de atualizar. O
  frete virou a dor nacional (Correios só aceitam PAC/SEDEX pra cards; PAC
  passando de R$30).
- **MYP**: a API pública tem **Swagger documentado e atualizado em
  25/08/2026** (github.com/MYPCards/mypcards-api) — ver F1: o item nº 1 do
  ROADMAP pode estar menos travado do que parecia.

### Onde o Sleevu está depois dos 6 pacotes

Ganha (agora com ainda mais folga): grátis o que todo mundo cobra (histórico,
export, sync, sem limite), troca com veredito + export de imagem, condição por
cópia, vintage JP curado, graded de 5 graduadoras, portfólio com benchmark.
Perde/deve: preço BR real (F1), feeling mobile de app nativo (M1–M4 — o
Collectr é nativo e "zero lag" é o elogio padrão dele), catálogo servindo
imagem de terceiro com pontos únicos de falha (P1–P2), e o gancho público de
mercado que Collectr/PriceCharting têm e aqui fica atrás de página pessoal (F2).

---

## 2. Trilha P — performance que não tira qualidade (P1–P9)

Regra desta trilha, nas palavras do pedido: **nenhum item pode degradar imagem
ou funcionalidade**. Cada item declara o risco; dois deles (P4, P5) *aumentam*
a qualidade percebida. Fatos-base medidos: shared.js = 71 KB gz servido em
toda página; ~235.354 imagens de carta vêm de CDNs de terceiros; 5.333
vintages passam pelo proxy wsrv.nl; o deploy usa ~12-13k dos 20.000 arquivos
do limite do Cloudflare Pages.

### P1 — Imagens no próprio servidor, fase 1: os 5.333 vintages · M
**O quê.** Espelhar localmente as imagens vintage que hoje dependem do
wsrv.nl sobre fã-sites (naruto 4.691, hxh 321, onepiece 321 — fontes:
cdn.narutocards.ca, tcg-db.nikita.jp, tv-tokyo, wikia, grandlinewiki).
**Como.** O padrão já existe DUAS vezes no repo: em lote
(`mirror-vintage-images.mjs` — 714 webp/54 MB já espelhados) e por carta via
`assets/cards/<game>/<id>.*`, que os syncs do Naruto/HxH **já honram**
(`sync-naruto-vintage.mjs:223`, `sync-hxh-hyper-battle.mjs:181`,
`sync-naruto-ccg.mjs:34`) — não precisa de script novo, precisa rodar o
download. Ressalvas mapeadas: 115 hyperbattle do One Piece o mirror já tentou
e não achou (exigem de-para manual); ~206 Miracle Battle estão fora do script
atual (fonte nikita.jp).
**Por quê.** wsrv.nl é ponto único de falha de 3 jogos (e fã-site morre sem
aviso — a lição do catálogo versionado vale pra imagem). Cartas de 1999-2013
são imutáveis: espelhar é o caso perfeito.
**Qualidade.** Zero risco — o espelho grava o MESMO webp de ~440px que o
wsrv entrega hoje, byte a byte o que o usuário já vê.
**Cuidado.** ~4.600 arquivos consomem a maior parte da folga dos 20k do Pages
— fazer DEPOIS do guarda-corpo do P8, e avaliar ir direto pro R2 (P2) pros
volumes maiores.

### P2 — Imagens no próprio servidor, fase 2: R2 `img.sleevu.app` · G
**O quê.** Bucket R2 com domínio próprio como espelho de leitura das imagens
de carta, rollout incremental por jogo. Não é backend em runtime — R2 com
custom domain é hospedagem de arquivo estático, compatível com as decisões
travadas; egress zero, custo ~centavos/mês.
**Ordem.** Começar por Lorcana (3.192) e One Piece moderno (6.848): além de
host único sem fallback, são os 2 jogos cujo **export de imagem depende do
wsrv como proxy de CORS** (`shared.js:8695-8706`). Bônus verificado: o
roteamento do canvas é por jogo, não por host — cartas tcgplayer-cdn dos
OUTROS 7 jogos TCGCSV hoje provavelmente saem **sem foto** no compartilhar
(crossOrigin falha em host sem CORS); espelho com CORS conserta o export de 8
jogos, não de 2. Scryfall/YGO (os maiores, CDNs mais confiáveis) por último.
**Qualidade.** Zero se copiar verbatim a variante que o site já exibe. Risco
real a mitigar: tcgplayer-cdn troca a arte NA MESMA URL (caso Gundam
documentado em `sw.js:45-54`) — só espelhar sets com 30+ dias de lançamento e
re-verificar os recentes.
**Cuidado.** Host novo entra em `img-src` E `connect-src` da CSP
(`_headers:20`) + `IMAGE_HOSTS` do sw.js; manter a URL de origem na cadeia
`data-img-fallbacks` (espelho falha → CDN original — o inverso de hoje).

### P3 — Cache imutável pro que nunca muda · P
**O quê.** (a) `_headers`: `public, max-age=31536000, immutable` pra
`/assets/*` (a convenção rename-on-change já é documentada pras fontes) — hoje
o hub revalida ~20 assets **por abertura** (17 logos + ícones + manifest caem
no networkFirst com `cache:'no-cache'`, `sw.js:343-362`); (b) mesma regra pras
~2.238 imagens já espelhadas (`/data/set-logos/*`, `/data/*/set-logos/*`,
`/data/onepiece/vintage-images*/*`) — conteúdo congelado revalidando de hora
em hora; (c) no sw.js, mover esses caminhos locais pro IMAGE_CACHE — hoje
disputam o FIFO de 3.000 slots do DATA_CACHE com os 1.296+ chunks do Magic.
**Qualidade.** Zero; trocar um logo passa a exigir renomear o arquivo (fluxo
que já é o da curadoria manual).

### P4 — Nitidez 2x/3x: o srcset que o prerender já tem · P
**O quê.** Portar pro `localizedImg` (`shared.js:3790-3818`) o srcset/sizes
que o prerender já usa (`prerender-catalog.mjs:127-133`: low 245w + high
600w). Hoje a grade serve `low.webp` de 245px pra todo mundo — num celular 3x
o navegador precisa de ~450px e recebe 245 esticados (o próprio prerender
documenta: "escala 3,8x borrada em DPR 3").
**Qualidade.** É o item que **melhora** qualidade: tela 1x segue baixando os
mesmos 17 KB; tela 2x+ passa a receber nitidez de fonte.
**Cuidado.** A cadeia de fallback troca `img.src` no onerror — precisa limpar
o srcset junto, senão o navegador ignora a troca.

### P5 — A arte de 141 KB no tile de 48px · P
**O quê.** A aba "pokemon" da **Coleção** exibe a official-artwork
(~100-300 KB, PNG 475px do raw.githubusercontent.com) em tiles de **48px**
(`collection.js:1652-1653`) — trocar por `shared.spriteUrl` (~1,3 KB, o mesmo
sprite da grade da Pokédex, que já faz certo). Fator ~100x por linha.
**Qualidade.** No tile de 48px o sprite pixelado é a estética que a Pokédex
já usa — nenhuma perda real; o hero do detalhe **mantém** a arte grande
(lá ela é vista grande). Opcional futuro: espelhar as 1.025 artes no R2
(verbatim, zero perda) pra tirar o GitHub raw do caminho.

### P6 — Primeira visita mais rápida (a 1ª impressão de quem vem do Google) · P
**O quê.** (a) Concatenar `theme.js`+`game.js` num `boot.<hash>.js` único no
deploy — 2 requests síncronos bloqueantes viram 1 (preservar o
`data-catalog` por página, o marcador SLEEVU_I18N do split-i18n e a lista
SHELL_ASSETS do sw.js); (b) **Early Hints**: o `hash-assets.mjs` já reescreve
o `_headers` e conhece os nomes com hash — emitir `Link: rel=preload` do CSS
núcleo + fonte (Cloudflare Pages converte em 103); (c) `loading="lazy"` nos 4
caps de jogo da landing (82 KB eager abaixo da dobra — o hub já faz certo) e
`fetchpriority="high"` no 1º tile do hub (LCP provável).
**Qualidade.** Zero — mesmo conteúdo, ordem melhor. Depois da 1ª visita o SW
já resolve; isto é otimização de aquisição.

### P7 — Câmbio sem segurar o primeiro render · P
**O quê.** 1x/dia o primeiro render de valores espera a awesomeapi por até
2,5s (`fetchFxRatesBRL` no Promise.all de portfolio/dashboard/collection/app).
O câmbio vencido JÁ é usado como fallback — mas só DEPOIS do timeout. Virar
SWR de verdade: cache <48h responde na hora, atualização roda por trás (o
count-up do patrimônio já anima a chegada do valor fresco).
**Qualidade/cuidado.** Variação de câmbio/dia é <1%; a guarda obrigatória é
NÃO gravar o snapshot diário do histórico com câmbio velho (gravar só após a
atualização) — senão o gráfico registra ruído.

### P8 — Guarda-corpos: que a perf não regrida calada · P
**O quê.** (a) Contagem de arquivos antes do `wrangler pages deploy` (aviso
>16k, falha >18k — o limite de 20k hoje é invisível e o P1 vai consumir folga);
(b) orçamento de tamanho no CI: falha se gz(shared.js) > teto (~75 KB),
gz(núcleo CSS) > teto — no espírito das guardas que já existem
(check-mobile, split-indexes --check); (c) tirar do publish os 577 KB de
matéria-prima órfã em `assets/brand` (6 arquivos sem nenhuma referência;
preservar no repo, só não subir); (d) curto-circuito do
`detail.js:519`: nome fora do índice → "não encontrado" + link pra busca, em
vez de baixar o catálogo INTEIRO (507+ chunks no Pokémon — o pior request
storm possível do site).
**Qualidade.** Zero em runtime. No (d), troca consciente: o link podre que a
varredura "salvaria" vira mensagem útil com busca sugerida.

### P9 — A coleção do usuário imune a outage · P
**O quê.** (a) `MAX_IMAGES` do sw.js: 1500 → 4.000-5.000 (~70-85 MB de Cache
Storage — o FIFO atual evicta coleção grande, e é FIFO puro: imagem antiga E
ainda usada sai primeiro); (b) pré-aquecer no idle (Wi-Fi) as thumbs das
cartas QUE O USUÁRIO TEM — a coleção abre offline completa e sobrevive a
outage de CDN sem depender de "já ter visto".
**Por quê.** É a tese local-first aplicada a imagem: "sua coleção funciona no
busão sem 4G" só é verdade inteira com isso.

---

## 3. As 10 melhorias (M1–M10)

### M1 — O toque responde (o núcleo do "parece app") · P
**O quê.** Hoje: **0** regras `:active` contra 156 `:hover`, 0
`touch-action: manipulation`, `enterkeyhint` existe 1 vez no site. Pacote
único, escopado em `@media (pointer: coarse)`: estado de pressão
(`transform: scale(.96)`, 60ms) em tabbar/chips/botões/steppers/tiles +
`-webkit-tap-highlight-color: transparent` + `touch-action: manipulation` e
`user-select: none` nos controles (mata double-tap-zoom no spam de +1 e a
seleção azul no long-press) + `enterkeyhint` nas buscas e campos numéricos +
haptic leve opcional (`navigator.vibrate(10)` no add, 30 no set 100% —
Android; iOS ignora sem erro; respeita `prefers-reduced-motion`).
**Por quê.** Resposta <100ms a todo toque é literalmente o elogio central ao
Collectr. Todo o feedback do site hoje é hover — que não existe no dedo.
**Qualidade.** Desktop byte a byte igual (gate por pointer).

### M2 — O botão voltar do Android para de destruir contexto · M
**O quê.** Zero `popstate` no site: com o preview de carta aberto, voltar SAI
da página (no PWA, da primeira tela sai do app). `history.pushState` ao abrir
preview/cmdk/drawer + listener que fecha o overlay — gateado em pointer
coarse pra manter o desktop intacto. Par natural: swipe-down fecha o preview
(o padrão touchstart/dy>80 já existe em `binders.js:1822-1832`; exigir
scrollTop=0 pra não brigar com a rolagem interna).
**Cuidado.** O deep-link `?card=` usa `replaceState` de propósito
(`shared.js:4622-4643` documenta) — o pushState do modal não pode duplicar
entrada nem quebrar o pouso das páginas `/card/<slug>`.

### M3 — O deploy diário fica visível (e o PWA para de recarregar sozinho) · P
**O quê.** (a) `reg.update()` no `visibilitychange→visible` (app volta do
background = momento natural de checar) + toast "Versão nova · Recarregar" no
`controllerchange` (a infra `.undo-toast` já existe; hoje o evento dispara e
ninguém escuta); (b) `@media (display-mode: standalone) { html, body {
overscroll-behavior-y: contain } }` — mata o pull-to-refresh acidental que
recarrega a página e perde filtros, só no app instalado.
**Por quê.** O deploy sai 06:20 todo dia; sessão PWA parada fica na versão
velha indefinidamente e o usuário nunca fica sabendo do que chegou.

### M4 — Instalação que convida (hoje está enterrada) · M
**O quê.** O `beforeinstallprompt` é capturado e o ÚNICO gatilho é um item
escondido no menu de conta; o hint iOS é um `window.alert`. Fazer: (a) banner
contextual 1x, dispensável, quando há sinal de engajamento (coleção ≥10
cartas ou 3ª visita) — "Instala o Sleevu: abre offline e some a barra do
navegador"; (b) sheet iOS própria com os 2 passos ilustrados (□↑ → Adicionar
à Tela de Início) no lugar do alert; (c) `screenshots` no manifest (3
narrow + 1 wide — transforma a mini-infobar do Android na bottom-sheet rica);
(d) `share_target` GET → `/explore?q=` (compartilhar um nome de carta de
qualquer app cai na busca).
**Por quê.** Instalado = push, shortcuts, offline e retenção que já existem
passam a valer; e badge no ícone (M9) só existe pra instalados.

### M5 — Erros que orientam em vez de assustar · M
**O quê.** (a) Falha de catálogo mostra `Failed to fetch` cru (e o throw de
`shared.js:7357` é pt hardcoded — usuário EN vê mistura de idiomas): mapear
pra mensagem amigável + **botão "Tentar de novo"** (chave i18n nova nos 3
idiomas; cards/explore já zeram a promise memoizada — o retry funciona, falta
o botão; app.js exige refactor do load, fazer por último); (b) busca da Troca:
API fora do ar hoje vira "Nada encontrado." — distinguir indisponível de
inexistente (mesmo ajuste no fallback das listas); (c) quota de storage
engolida em silêncio nos stores das páginas: trocar os 4 `catch { /* quota */ }`
(collection.js:32/186, sales.js:57, graded-ui.js:30) por `notifyStorageFull`
— já exportado na API pública, decks/listas já usam; e `sales.js:55` (write de
migração) não tem try/catch NENHUM; (d) restaurar backup: QuotaExceededError
no meio deixa restauração parcial com erro que culpa o arquivo — diferenciar
por `e.name`, avisar "parcial", e toast de sucesso pós-reload ("Backup
restaurado: N cartas") via sessionStorage.
**Por quê.** É o primeiro contato do usuário de 4G oscilante com o site — e
hoje parece bug do Sleevu, não rede.

### M6 — Copy e i18n sincronizados (o texto que nega o produto) · P/M
**O quê.** (a) **21 divergências** HTML×i18n verificadas, e nas ~8 em que o
HTML é o novo o runtime mostra a copy VELHA — a pior: o subtítulo do
Portfólio diz nos 3 idiomas que o valor vem "dos preços que você registrou",
negando o diferencial de preço automático na página-vitrine
(`i18n.js:548/1651/2749` vs `portfolio.html:75`); mesma família: login.sub,
home.support.* ("café" vs "coxinha"), home.lp.sub, title.hub. Sincronizar o
dicionário e os fallbacks; (b) o Sobre diz "**10 jogos**"
(`i18n-docs.js:44`) — são 13; (c) a mesma feature se chama **Showcase** (aba),
**"coleção"** (botões folders.*) e **"Pastas"** (Ajuda/FAQ) — quem segue a
Ajuda não acha a aba; escolher UM nome (decisão do Fernando) e propagar
(~25 strings); (d) leitor de tela em EN/ES ouve português: ~140 `aria-label`
pt fixos nos HTML e o `applyTranslations` não tem `data-i18n-aria` — 3 linhas
no shared + ~30 chaves cobrem tudo; de quebra os placeholders "mín"/"máx" de
cards.html.

### M7 — O push cumpre o que a UI promete · P
**O quê.** O robô de queda da wishlist só carrega deltas de **3 jogos**
(pokemon/lorcana/onepiece — `send-wishlist-push.mjs:45-52`); wishlist de
Magic/YGO/etc **nunca** notifica, silenciosamente. E o site publica a janela
de **7 dias** (`price-deltas-7d`) pra 11 jogos sem nenhum consumidor no front
— enquanto o aviso in-page da wishlist usa a de 24h, que desde o build diário
só enxerga o movimento de ontem (perde a carta que caiu 20% em passos de
3%/dia — o próprio cabeçalho do sync admite). Fazer: (a) robô itera os 11
dirs com deltas (naruto/hxh não têm price-history — limite conhecido);
(b) mensagem `es` no MSG (hoje cai em pt); (c) aviso da wishlist e linha do
chip do preview passam a usar/mostrar a janela 7d; (d) unificar os thresholds
divergentes (robô -5% vs página -3%).
**Por quê.** Valor alto por esforço mínimo: o dado já é publicado e cacheado;
é a classe de correção "a promessa da landing precisa ser verdade".

### M8 — Um padrão só de feedback destrutivo · M
**O quê.** Convivem três padrões: toast-com-desfazer (o declarado padrão da
casa), `confirm()` nativo (13) e 62 `alert()`. Migrar pro undo o que já tem
tombstone: **deck** (decks.js:1931 grava tombstone na linha seguinte ao
confirm!) e **item manual**; trocar os alerts de "nada pra compartilhar"
(graded/sales/collection) por botão desabilitado com title; trocar os DOIS
prompts de entrada de dado (alvo de preço da wishlist e **nome de pasta
nova**, collection.js:989) por popover inline — `window.prompt` é suprimido
em webview de Instagram/Facebook (tráfego BR de grupos): o sino do alvo hoje
falha MUDO exatamente pro público que mais importa. Binders mantêm confirm()
(fotos são irreversíveis — coerente).
**Cuidado.** Os 10 prompts de fallback de clipboard falham nos mesmos
webviews — padronizar o fallback de cópia junto.

### M9 — Fechaduras, portas e sinais · P
**O quê.** (a) `AUTH_PAGES` sem `listas` e `mydecks`: deslogado usa as duas
gravando local que **nunca sincroniza** (e os Termos dizem que listas exigem
conta) — verificado que my-decks não tem uso público legítimo (viewer `?s=` e
galeria vivem em decks.html); adicionar as duas ao gate; (b) compartilhar
deck/binder ganha `navigator.share` com clipboard de fallback (o padrão do
shareCard; hoje é clipboard+prompt — no celular o link deve cair direto no
WhatsApp); mesmo passe: `share:true` no PNG de vendas (1 linha — o da coleção
já compartilha); (c) logo do Union Arena no hub (único jogo moderno em texto
puro entre 12 tiles com arte; o comentário do hub.html documenta os 2
passos); (d) a bolinha de novidades só existe em 2 lugares que o mobile não
vê — propagar o mesmo `has-news` pro botão do menu + `setAppBadge` no push
handler do sw.js (`clearAppBadge` no boot); (e) `navigator.storage.persist()`
no boot quando a coleção não está vazia — protege o local-first de eviction
do Chrome; (f) perfil público passa a mostrar "coleção atualizada em X" — o
`updated_at` já chega na resposta e é descartado (sinal de vida que importa
pra troca/venda).

### M10 — A Ajuda alcança o produto (e as guardas alcançam o mobile) · M
**O quê.** (a) A Ajuda tem 11 seções e NENHUMA cobre Portfólio, Graded,
Troca, Decks, Listas, Badges ou selados/manuais — a FAQ responde "o que são
Pastas, Binders e Vendas" como se fosse o app inteiro. Adicionar 4-6 seções +
atualizar faq.q.features (i18n-docs é lazy-loaded — crescer não pesa no
site); (b) check-mobile.mjs ganha 3 guardas do que esta auditoria achou: toda
página com as metas mobile (3 já divergem), **cada entrada de SHELL_ASSETS
existe no disco** (um rename hoje quebra o precache em silêncio — o install
usa allSettled), e `position:fixed` novo com bottom exige `--tabbar-lift` ou
allowlist.

---

## 4. As 10 features (F1–F10)

### F1 — Preço BR: destravar via API pública da MYP · M
**O quê.** O item nº 1 do ROADMAP ("a tese do projeto, travada num e-mail")
pode não estar mais travado: a pesquisa achou a **API pública da MYP com
Swagger, mantida e atualizada em 25/08/2026**
(github.com/MYPCards/mypcards-api — "preços e informações de cartas de todos
os jogos"). Revisitar o `sync-myp.mjs` contra essa documentação: se o Swagger
expõe endpoints de preço sem o `X-Api-Token` (ou com registro self-service),
os passos 2-4 do ROADMAP destravam sem esperar o suporte; senão, a doc pelo
menos fecha o matching carta↔MYP (passo 3) antes do token chegar.
**Por quê.** "Valores localizados pro Brasil" é a promessa central; a Bynx
provou a demanda fazendo disso o produto inteiro. O front já lê
`TCG_PRICING.b` e mostra "Brasil · MYP" — é só o dado que falta.

### F2 — Mercado aberto: altas e quedas + índice por jogo *(pede aval)* · P/M
**O quê.** Os movers diários (30 altas + 30 quedas × 11 jogos) e o índice de
mercado (base 1000) são publicados todo build e consumidos SÓ pelo Portfólio
(o índice, só no modo % do gráfico). Levar pro **Explorar/página do jogo**:
rail "altas e quedas de hoje" (hidratação como o Portfólio já faz) e
sparkline "mercado Pokémon — 30d" com o n do índice na legenda. Depois, a
versão SEO: página estática `/mercado/<jogo>` no prerender.
**Decisão pendente — registrada com honestidade.** A decisão do Pacote 2
("nada de movers/finanças no **Hub pessoal**") não cita superfícies públicas
— mas a oração "a visão financeira fica concentrada no Portfólio" cobre o
espírito. Este item **só entra com aval explícito do Fernando**; o plano o
propõe porque é conteúdo diário grátis que PriceCharting (Big Movers) e Card
Ladder cobram, e nada dele toca o Hub pessoal.

### F3 — Tendência por set: "▲ 3% na semana" · M
**O quê.** O manifest já carrega a soma de valor por set (vb/vu/ve via
`setValueBuckets`) e o price-history tem 60 pontos por carta. Um passo de
build agrega dv7/dv30 por set (bytes no manifest) → chip de tendência nos
cards da tela de Sets e nas páginas `/set/*.html`. Alternativa mais barata
verificada: acumular os próprios vb/vu/ve do manifest a cada build (o truque
do loadPrevious do price-history).
**Por quê.** "Set trends" é conteúdo que o Collectr cobra; aqui é um reduce
no build. **Cuidado.** Piso de cartas precificadas por set (o MIN_INDEX do
índice) pra % não sair ruidosa; guarda de fonte mista (carta USD + BR no
mesmo set) que o setValueBuckets já resolve.

### F4 — "À venda na comunidade" no preview e na Troca · P
**O quê.** A RPC `find_sellers` (dados já públicos, aceita lote de 300 ids) é
usada numa página só (wishlist). Bloco hide-if-empty no preview da carta —
"À venda: @fulano · R$ X" — e sugestão de vendedores no lado "recebo" do
Analisador de Troca. 1 chamada por carta aberta, cache de sessão.
**Por quê.** Liga o marketplace social que já existe às telas de intenção de
compra; é a metade barata do que o F5 adiado (troca casada) faria.

### F5 — "Novidades na sua coleção" no Hub · P
**O quê.** Cada add/edição já carimba `meta.mod[cardId]` — e o único leitor é
o merge de sync. Cápsula no Hub pessoal (não-financeira, ao lado do
"Continuar de onde parou"): últimas cartas adicionadas + "+N cartas em
agosto". Import CSV/merge carimba lote de uma vez — tratar lote como um
evento só. De quebra: a Retrospectiva anual ganha a linha "melhor venda do
ano" (único gap real — o stat card de melhor venda e as barras mensais JÁ
existem no Portfólio; ver §7).

### F6 — A safra de badges que faltou · P
**O quê.** 31 badges e ZERO pra decks, listas, trocas, import ou favoritos —
os stores nem são lidos pelo badges.js. Adicionar 6-8 de custo quase zero:
deck1/deckPub1, list1, import1, trade1/trade10, fav10 — todas na onda
instantânea que já existe, com o share de imagem que já existe. E o histórico
da Troca ganha o agregado que falta: "saldo das suas trocas: +R$ X em N
trocas" (rotulado "neste aparelho" — a chave é local-only).

### F7 — Favoritos que devolvem · P
**O quê.** `favorites-v1` sincroniza entre aparelhos e é write-only: o toggle
existe (detalhe do Pokémon) e NADA consome. Filtro "favoritos" na Pokédex,
rail "seus favoritos" no hub do jogo. O usuário já investiu os cliques; hoje
eles não devolvem nada.

### F8 — Calendário de lançamentos + .ics · M
**O quê.** Todo sync grava `release` por set e os chunks JÁ têm datas futuras
(sets de set/out/nov 2026 no Magic, verificado) — e nenhuma superfície mostra
"o que vem aí". Página "Próximos lançamentos" (por jogo, EN/JP/BR quando a
Copag tiver data) + arquivo **.ics estático** gerado no build pra assinar no
Google/Apple Calendar.
**Por quê.** Alerta de release é o recurso mais pedido da categoria
(Pokellector cobra os alertas; PokéGuardian vive disso) e um .ics é 100%
estático. Datas BR em pt é algo que nenhum player global cobre.
**Cuidado.** O `data/indexes-sets.json` da raiz é fixture de dev SEM
releaseDate — o dado real está nos manifests gerados; cobertura de futuro
varia por fonte (Scryfall meses antes; TCGdex/TCGCSV mais perto).

### F9 — A ponte BR completa: Liga nos dois sentidos + WhatsApp · M
**O quê.** (a) **Export da coleção pra Liga**: hoje só LISTAS exportam
(formato "Compra por Lista", `export-liga.js` — lógica pura sem DOM, testes
dourados) — reusar pro export da coleção/pasta inteira (a escala de condição
já é 1:1 com a Liga); (b) **import ManaBox e Dragon Shield MV**: verificado
que os headers e condições dos dois JÁ CASAM com o parser atual — a feature é
testar com arquivos reais, corrigir 2 arestas ('etched' vira Normal; linha
`sep=,` de preâmbulo quebraria o header) e DOCUMENTAR ("escaneou no ManaBox,
importa no Sleevu") — o scanner grátis dos outros vira porta de entrada do
Sleevu; (c) **composer de WhatsApp** nas vendas: texto formatado (carta,
condição, preço R$, link) via `navigator.share`/`wa.me` — os dados já estão
prontos no `saleItems`, e o OG do perfil já é otimizado pro WhatsApp
desenrolar bonito.
**Por quê.** A troca BR acontece em grupo; a Liga é onde se precifica. Ser a
ponte (sem custódia, sem taxa) é o lugar estratégico do Sleevu no ecossistema.

### F10 — Testar mão (goldfish) no deck · M
**O quê.** Zero simulador hoje; `deck.zones.main` é bem definido e
embaralhável em todos os rule packs (verificado). Botão "Testar mão" no
editor: embaralha, 7 cartas (ou o tamanho do formato), mulligan, comprar —
imagens via `cardImageSources` que já existe.
**Por quê.** É o "brinquedo" que faz Moxfield/Archidekt serem abertos todo
dia; puro JS de cliente, coerente com o site estático.

---

## 5. Extras (E1–E6) — além dos 10+10, autorizado

### E1 — Centering tool 100% local · M
Medir centralização (frente: 55/45 etc.) antes de mandar pra grading:
carregar foto → 4 guias arrastáveis → percentuais. O pipeline de foto local
dos binders (FileReader→canvas→IndexedDB, "nunca sai do navegador") é
reutilizável de ponta a ponta. Shiny e PriceCharting **cobram** por isso; no
Sleevu é grátis e a foto nem sai do aparelho — o argumento local-first virando
feature.

### E2 — Página "Sleevu × Collectr" em pt-BR · P
As três coisas que o Collectr cobra (scans, histórico, **export**) o Sleevu
dá de graça, e as dores documentadas dele (só PSA, JP fraco, USD) são os
pontos fortes daqui. As tabelas comparativas de PLANO-UX.md/PORTFOLIO.md já
são o rascunho. Página estática de conteúdo (SEO: "alternativa ao Collectr").

### E3 — Primeiros passos guiados · M
Pós-onboarding do @ (que já existe), um checklist leve e dispensável no Hub:
marcar a 1ª carta → importar CSV → criar lista → instalar o app. Hoje nada
guia o recém-logado; o elogio dominante da categoria é "se aprende em 1
minuto", e os caminhos rápidos já existem (quick-add por número, modo
compacto, wizard de listas) — falta apresentá-los.

### E4 — "Em destaque" que esquenta: hot score da galeria · M
O hero da galeria é o mais visitado dentre os 60 mais recentes — e trava no
deck antigo (a própria doc dos decks aponta). Um passo do deploy diário lê
shares+deck_views (leitura pública) e publica `decks-hot.generated.json` com
decaimento; a galeria ordena por ele e degrada pro comportamento atual se o
arquivo faltar. Sem tabela nova, sem RPC nova.

### E5 — Prerender de artistas — só onde há dado · M
`/artist/<slug>.html` no molde do `/set/`, **começando por Pokémon e Lorcana**
— verificado que são os únicos com indexes-artists populados (One
Piece/Digimon/FAB/Riftbound/UA estão vazios; a auditoria anterior já tinha
tropeçado nisso — M9b). Magic depois, via dado do D1. "Mitsuhiro Arita cards"
é busca real de volume e o perfil público já expõe artistTotals.

### E6 — Eventos de produto no analytics *(exige migração manual)* · P + SQL
3-5 eventos nomeados (export usado, import concluído, deck criado, backup
feito) pra próxima safra ser priorizada com dado em vez de palpite.
**Verificado:** o trigger `events_guard` tem whitelist hardcoded
(`pageview`/`jserror`) e **descarta silenciosamente** qualquer nome novo —
exige migração SQL aplicada à mão no painel (mesma classe de pendência do F5
antigo). Sem a migração, o JS "funciona" sem gravar nada — não fazer pela
metade.

---

## 6. Ordem sugerida

Pacotes pequenos, cada um mesclável e testável sozinho:

1. **Cache e primeira visita (1 sessão):** P3, P6, P7, P8. Só deploy/headers
   /guardas — risco mínimo, ganho em toda visita.
2. **O toque e o app (1-2 sessões):** M1, M3, M9. O grosso do feeling mobile
   por CSS/JS pequeno.
3. **Voltar, preview e instalação (1-2 sessões):** M2, M4.
4. **Confiança (1-2 sessões):** M5, M6 (decisão de nome do Showcase com o
   Fernando), M10.
5. **Push e dados que já existem (1-2 sessões):** M7, F4, F5, F6, F7.
6. **Imagens no servidor (incremental):** P4, P5 → P1 (com o guarda-corpo do
   P8 já no ar) → P9 → P2 (R2, por jogo).
7. **Brasil (2-3 sessões):** F9, F8, E2 — e F1 assim que a leitura do Swagger
   da MYP confirmar o caminho.
8. **Apostas e polimento (projetos):** F3, F10, M8, E1, E3, E4, E5; F2 e E6
   aguardam aval/migração do Fernando.

## 6b. Estado de execução

**Etapa 1 — "o invisível" — entregue em 2026-08-30.** Seis commits, nenhuma
tela muda de aparência. A ordem executada foi a natural (dependência), não a
temática: P8 primeiro porque é ele que protege o resto.

- **P8** ✔ — contagem de arquivos no deploy (avisa em 16k, falha em 18k, e
  imprime o número real em todo build — o dado que faltava pra decidir quanta
  imagem cabe no Pages e quanta vai pro R2); orçamento de peso no CI
  (`scripts/check-size.mjs`: shared.js 69,6 KB de 75, styles 39,2 de 43);
  577 KB de matéria-prima de `assets/brand` fora do publish (conferido caminho
  a caminho — só o `sleevu-wordmark.svg` é referenciado e fica); e o
  curto-circuito do `detail.js`, que parou de baixar o catálogo inteiro
  (507+ chunks) pra terminar numa página vazia — agora o estado vazio diz que
  o nome não existe neste jogo e leva pra busca (chave `empty.detailUnknown`
  nos 3 idiomas). A varredura sobrou só pro caso de o índice não ter chegado.
- **P3** ✔ — `/assets/*` e as ~2.238 imagens espelhadas ganharam um ano de
  `immutable`; as imagens locais saíram do DATA_CACHE (onde disputavam 3.000
  slots com os chunks) pro IMAGE_CACHE; `/assets/` entrou no cache-first do SW
  **só em produção** (`HASHED_ASSETS`), pra não atrapalhar edição de arte em
  dev. A contrapartida ficou escrita no `_headers`: trocar arte é por RENAME.
- **P6** ✔ — Early Hints (o `hash-assets` passou a escrever o header `Link` do
  CSS núcleo + fonte, com `crossorigin`); os 4 caps da landing viraram lazy;
  `fetchpriority=high` no 1º tile do hub. E o **boot.js**: `theme.js`+`game.js`
  fundidos por `scripts/bundle-boot.mjs` no deploy — dois scripts síncronos no
  head viraram um. Seguro porque os dois são IIFE e só o game.js lê
  `currentScript` (pro `data-catalog`, preservado byte a byte nos 11 valores
  distintos). O script PARA se o par sair do formato, o comentário HTML entre
  as tags é preservado, e o mesmo `--check` roda no CI.
- **P7** ✔ — câmbio vira stale-while-revalidate (até 48h responde na hora e
  atualiza por trás; acima disso, o caminho de sempre). No caminho, um bug que
  já existia: com a cotação vencida em uso, o ponto do dia do histórico era
  gravado com ela — e como quase toda carta é cotada em USD/EUR, o valor passa
  pelo câmbio até pra quem usa BRL, então o gráfico registrava ruído de dólar
  como se fosse mercado. Agora o snapshot pula com câmbio vencido (entra na
  carga seguinte), com válvula acima de 7 dias. 4 testes novos.
- **M7** ✔ *(promovido do pacote 5 pra cá)* — o robô de push passou de 3 pra
  os 11 jogos com histórico publicado (quem tinha Magic ou YGO na wishlist
  nunca recebia aviso, sem erro nenhum: jogo fora do mapa virava `{}`);
  espanhol deixou de virar inglês na assinatura; e o aviso na página passou a
  usar a janela de 7 dias — que já era publicada e nenhuma tela usava —
  com o mesmo corte de -5% do robô (eram -3% na página e -5% no push).
- **Fora de escopo por decisão:** a linha de 7 dias no chip do preview da
  carta (é mudança visível; vai com a etapa de UI).
- **Validação:** 156 testes (4 novos), `check.mjs`, `check-mobile.mjs`,
  orçamento de peso, e o smoke de navegador real 23/24 — a única falha é o 404
  pré-existente dos logos de loja (M10c do plano 1, curadoria do Fernando). O
  `bundle-boot` e os Early Hints foram provados num sandbox com o pipeline
  real do deploy (split-i18n → bundle → minify → hash).
- **A conferir no primeiro preview** (só se prova servido): `curl -I` num logo
  de set deve dizer `max-age=31536000`; o header `Link` deve aparecer; e o
  `boot.<hash>.js` deve carregar como script único no `<head>`.

**Etapa 2 — "o toque" — entregue em 2026-08-30.** Quatro commits. Tudo que muda
no celular está atrás de `pointer: coarse` ou `display-mode: standalone` — o
desktop foi conferido byte a byte.

- **M1** ✔ — o número que resumia o problema: **0 regras `:active` contra 156
  de `:hover`**. Todo o retorno do site era hover, que no dedo não existe.
  Agora: estado de pressão (`scale .96`, 60ms) em botão/chip/tabbar/tile/
  hub-tile, `touch-action: manipulation` (que não existia em lugar nenhum do
  repo — sem ele, tocar "+1" três vezes dava zoom em vez de somar três
  cópias), `-webkit-tap-highlight-color` e `user-select: none` nos controles,
  `enterkeyhint=search` nos 12 campos de busca (existia **um** no site) e
  retorno tátil de 10ms no add e 30ms no set 100% (Android; iOS não tem a API;
  desligado no movimento reduzido). Decisão que fez a implementação funcionar:
  a propriedade individual `scale` em vez de `transform: scale()` — ela
  **compõe** com transform de layout, e o `.chip-scroll-btn` (posicionado com
  `translateY(-50%)`) pularia do lugar ao ser tocado.
- **M3** ✔ — o `controllerchange` já disparava e ninguém escutava: toast
  "Versão nova · Recarregar" (só quando JÁ havia SW no comando — senão toda
  primeira visita veria "versão nova"), `reg.update()` no `visibilitychange`
  (sessão parada nunca pedia atualização) e `overscroll-behavior-y: contain`
  só no app instalado, matando o pull-to-refresh que recarregava a página e
  levava junto scroll e filtros.
- **M9a** ✔ — `listas` e `mydecks` entraram no `AUTH_PAGES`: deslogado, as duas
  gravavam local o que nunca sobe pra nuvem. E deck/binder ganharam o sheet
  nativo de compartilhar (o helper devolve `true` só quando o sheet abriu, então
  o caminho antigo de copiar+prompt segue intacto no desktop); o PNG de vendas
  ganhou o `share: true` que a vitrine da Coleção já tinha.
- **M9b** ✔ — `navigator.storage.persist()` quando há coleção a proteger (o
  local-first não tinha defesa nenhuma contra eviction), `setAppBadge` no push
  + `clearAppBadge` no boot, a bolinha de novidades propagada pro botão do
  menu (vivia atrás de dois toques, invisível no celular) e o
  "coleção atualizada em X" no perfil público, com o `updated_at` que já
  chegava e era descartado.
- **Guardas novas** no `check-mobile`: `:active` e `touch-action` presentes —
  sumir esse bloco num refactor não quebra nada, só devolve o problema calado.
- **Um erro pego pela suíte:** a primeira versão do M3 guardava o bloco com
  `"serviceWorker" in navigator`, que passa quando a chave existe valendo
  `undefined` (o sandbox dos testes) — 87 testes caíram e a guarda virou
  `navigator.serviceWorker`. Nada disso chegou a ser publicado.
- **Validação:** 156 testes, `check`/`check-mobile`/orçamento de peso, smoke
  23/24 (a falha é o 404 dos logos de loja, pendência sua) e testes dirigidos
  de navegador: 390px com pressão em `scale=0.96` e volta a `none`; desktop com
  `touch-action: auto` e `scale: none` no clique; toast ausente na 1ª
  instalação e presente em página controlada; deslogado barrado em listas/
  my-decks com decks/cards/sets e `?s=` abertos; persistência pedida só com
  coleção.
- **Não deu pra ver aqui:** o "atualizada em" do perfil público exige dado do
  Supabase, que o ambiente não alcança — a data cai fora quando inválida, então
  o pior caso é a linha não nascer.

**Etapa 3 — "voltar e instalar" — entregue em 2026-08-30.** Dois commits, os
dois gateados no toque.

- **M2** ✔ — o achado mais grave da auditoria mobile (zero `popstate` no site
  todo): com o popup de carta aberto, o botão voltar do Android saía da página
  inteira, e no app instalado saía do app. Agora abrir empilha uma entrada
  (`pushState`) e o voltar fecha o popup. Três cuidados no código: empilha
  **uma vez por sessão de popup** (trocar de carta só reescreve o `?card=`);
  `openFromUrl` **não** empilha (a URL já chegou com `?card=` de um link
  compartilhado — ali voltar tem que sair da página); e fechar pelo ×/Escape
  **desfaz** a entrada, senão o voltar seguinte não faria nada visível, que é a
  sensação de botão travado. Junto: arrastar o painel pra baixo fecha, só com
  o conteúdo no topo e só em movimento claramente vertical.
- **M4** ✔ — o convite de instalação saiu de dentro do menu de conta: banner
  acima da tabbar, uma vez, só no toque e só pra quem tem 10+ cartas
  (convidar quem acabou de chegar queima a única chance de perguntar). O iOS
  ganhou uma folha com os dois passos no lugar do `window.alert` — que é
  suprimido em webview de Instagram/Facebook, justo o tráfego que vem de
  grupo. E `share_target` no manifest: compartilhar o nome de uma carta de
  qualquer app cai na busca do Sleevu.
- **Um bug que só o navegador pegaria:** a primeira versão do convite tentava
  aparecer uma vez no boot — mas o `beforeinstallprompt` do Chrome chega
  *depois* dele. O convite nunca nasceria no aparelho mais comum. Passou a
  escutar o evento também.
- **Fora de escopo, com motivo:** o mesmo tratamento de voltar no menu e na
  paleta de comandos (dois overlays empilhando histórico precisam de um dono
  único da entrada — desenho pra outro commit; os dois fecham por clique fora
  e Escape). E os **screenshots do manifest**: gerei os quatro aqui e as
  cartas saíram em cinza, porque este ambiente não alcança os CDNs de imagem.
  Precisam ser capturados de produção — mesmo caminho dos logos de loja.
- **Validação:** 156 testes, os três checks, smoke 23/24, e testes dirigidos
  de navegador: voltar fecha o popup e **continua** na página sem `?card=`; o
  × não deixa entrada morta (o voltar seguinte navega de verdade); desktop
  segue saindo da página como sempre; o gesto foi testado nos quatro limites
  (fecha pra baixo no topo; não fecha com conteúdo rolado, pra cima, nem em
  arrasto oblíquo); convite não aparece sem coleção, aparece com 12 cartas
  terminando em y=766 com a tabbar em 774, some pra sempre ao dispensar, e o
  iPhone simulado recebe a folha sem nenhum alert nativo.

---

## 7. O que a verificação corrigiu (pra não repetir o erro do plano 1)

A auditoria alimentou 51 alegações ao time de verificação; o plano acima só
usa o que sobreviveu. Registrando o que caiu ou mudou:

- **REFUTADO — theme-color dinâmica**: a auditoria propôs atualizar a meta ao
  forçar tema; o `applyTheme` (shared.js:2689-2705) **já faz exatamente
  isso**, com comentário explicando o mecanismo. Fora do plano.
- **REFUTADO — "vendas por mês" e "melhor venda"**: `renderVendasPorMes`
  (portfolio.js:864-899) e o stat card de melhor venda **já existem** na
  seção Vendas do Portfólio — a auditoria confundiu com a seção Investimento
  (sem eixo temporal por desenho). Sobrou só o micro-gap da Retrospectiva
  (F5).
- **Reescopado — cadastro em série mobile**: quick-add por número, modo
  compacto e listas vinculadas já cobrem o caso; nada a propor (long-press
  seria a única novidade, e não paga o custo agora).
- **Corrigido — push**: são 11 jogos possíveis, não 13 (naruto/hxh não têm
  price-history no deploy).
- **Corrigido — official-artwork**: a grade da Pokédex já usa sprites; o
  desperdício real está na aba pokemon da **Coleção** (48px) e no hero do
  detalhe (P5 mira lá).
- **Corrigido — compartilhar listas**: o botão das listas é o modal de
  export, não share; o par real do M9b é decks+binders.
- **Corrigido — prompt "único"**: são 12 `window.prompt` (o do nome de pasta
  também é entrada de dado; os demais são fallback de clipboard) — M8 cobre o
  conjunto.
- **Corrigido — artistas**: só Pokémon/Lorcana têm índice populado (E5).
- **Descoberto no caminho**: o Sobre diz "10 jogos" (M6b); o export de imagem
  dos 7 jogos TCGCSV provavelmente sai sem foto por CORS (P2 conserta); o
  Swagger público da MYP (F1); `sales.js:55` sem try/catch nenhum (M5c).

## 8. Como implementar sem quebrar (vale pra todos os itens)

- **Rodar sempre:** `node --test tests/*.test.mjs`, `node scripts/check.mjs`
  (chave i18n nova exige pt/en/es), `node scripts/check-mobile.mjs`; shell/CSS
  → `smoke-pages.mjs`; split de CSS → `diff-computed-style.mjs`.
- **Invariantes intocáveis:** fórmula única de valor no cliente; local-first;
  catálogo congela, nunca esvazia; sem upload de foto por carta; sem backend
  de preço em runtime (R2 é hospedagem estática, não runtime); "nada de
  movers/finanças no Hub pessoal" (F5 é deliberadamente não-financeiro; F2
  vive fora do Hub e ainda assim pede aval).
- **Padrões:** feature sem dado não aparece; animação respeita
  `prefers-reduced-motion`; dinheiro novo respeita `data-sensitive` e o Modo
  Colecionador; mudança mobile gateada em `pointer: coarse`/`display-mode`
  pra desktop ficar byte a byte igual; chave localStorage nova prefixada e
  aditiva.
- **Específicos desta safra:** srcset convive com a cadeia `onerror`
  (P4); espelho de tcgplayer-cdn exige regra de frescor (P2); boot.js
  concatenado preserva `data-catalog`/SLEEVU_I18N/SHELL_ASSETS (P6); snapshot
  diário nunca grava com câmbio vencido (P7); evento de analytics novo SÓ com
  a migração do events_guard aplicada (E6).

## 9. Menções honrosas (avaliadas e deixadas fora)

- **Scanner IA** — segue fora (custo/API paga); a resposta do plano é reduzir
  a fricção da entrada manual (M1, E3) e importar dos scanners grátis alheios
  (F9b).
- **Splash screens iOS** — ganho real só no cold start do instalado; ~15
  `<link>` por página; fica atrás de M4 na fila.
- **Prova social de usuários na landing** — exige RPC pública nova e os
  números pré-lançamento podem depor contra; a landing já mostra os números
  de catálogo. Reavaliar pós-lançamento.
- **Board público de feedback** (Moxfield/nolt) — barato (GitHub Discussions
  no rodapé), mas prematuro antes do lançamento ter gente; anotar pro
  pós-launch.
- **Widget de home screen** — plataforma ainda irregular; o App Badging (M9d)
  é o primeiro passo que já entrega.
- **Wants list com otimizador de carrinho** — segue impossível sem preço por
  vendedor; o aviso de frete BR (consolidar compras) entra como microcopy na
  wishlist quando F1 der o preço BR.
