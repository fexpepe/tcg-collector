# Analytics 3 — o que medimos, o que estava cego e o /admin v3

2026-10-09. Análise da medição do site inteira (cliente, banco e painel) e o
que mudou com a migração `20261009a` e o `/admin` v3. O banco de produção não
foi lido: o MCP do Supabase pede autorização e o modo automático barra
chamada de RPC em produção. Então os achados vêm do código e do SQL. O
comportamento do SQL novo foi testado no PGlite, em cima de todas as
migrações de analytics do repo (detalhes no `supabase/migrations/README.md`).

## Resumo

- **O app das lojas mediria zero.** Todo envio de medição só saía em
  `*.sleevu.app`, e o Capacitor roda em `localhost`. Agora a trava é o
  `emProducao()` (site ou app nativo), e o pageview do app leva a plataforma
  (`pl`) e a versão do binário (`av`).
- **O banco descartava calado e ninguém contava.** Nome fora da lista,
  evento grande e ritmo acima do limite viravam `return null` sem rastro.
  Foi assim que o `search_hit` passou 16 dias zerado sem alarme. Agora cada
  descarte soma em `events_descartes`, e Técnico › Medição compara o que o
  site manda com o que chegou.
- **Todo número do painel era solto, sem régua.** O Resumo agora compara
  com o período anterior do mesmo tamanho, cortado na mesma hora do dia. Os
  gráficos de tempo trazem a média de 7 dias, o período anterior tracejado
  e os marcos (campanha, deploy, lançamento).
- **O painel não via o site por áreas.** O novo grupo Páginas agrupa as 40
  e poucas telas em 8 áreas (Catálogo, Minha coleção, Decks…). Por visita,
  mostra entrada, rejeição, saída e os caminhos de uma área pra outra.
- **Web × app desde já.** O grupo App e plataformas separa navegador, app
  da web instalado, Android e iOS e mostra a soma. Também traz as versões do
  app e os números que só as lojas têm (anotados à mão por enquanto; o robô
  já tem porta no banco).
- **Dado que chegava e ninguém lia.** O `utm_content` (a peça do anúncio) e
  o tipo de clique pago chegam desde 06/10. Agora estão em Aquisição ›
  Campanhas.
- **O dono contava como visitante.** Com ~15 visitantes por dia, isso pesa.
  O painel marca sozinho o navegador da equipe, e esse navegador para de
  mandar evento.
- **A política de privacidade prometia mais do que o código fazia.** Dizia
  "nada disso identifica você", mas o evento de quem está logado leva a conta,
  e o relatório de erro e o Cloudflare seguiam com a medição desligada. A
  política foi reescrita (pt/en/es), e o código agora cumpre o que ela diz
  (A11).

## 1. Como a medição funciona

```
navegador / app ── mandaEvento (shared.js) ── POST /rest/v1/events
                                                   │
                                     events_guard (trigger, SECURITY DEFINER)
                     lista de nomes · tamanho · 60/min por visitante · 600/min por IP
                          uid = conta do JWT · bot = user-agent/webdriver
                                     │ descartou? → events_descartes (v3)
                                     ▼
                     events (13 meses) ── events_daily (resumo por dia, pg_cron)
                                     │      metrics_daily (retrato diário, pg_cron)
                                     ▼
                     RPCs admin_* (só is_admin) ──► /admin
```

Fora desse cano:

- `increment_card_view` (contador público por carta, com série por dia);
- `increment_deck_view`;
- `consent_tally` (quantos desligaram a medição, sem id);
- Cloudflare Web Analytics, que mede país, navegador, Core Web Vitals e o
  tráfego que não roda JS.

O pageview leva um contexto agregável em `props`:

| Campo | O que é |
|---|---|
| `d` | aparelho de toque × ponteiro |
| `l` | idioma |
| `r` | host de origem |
| `wd` | webdriver |
| `iab` | navegador embutido |
| `s` | app da web instalado |
| `u` / `c` / `a` | utm source / campaign / content |
| `k` | nome do parâmetro de clique pago |
| `pl` / `av` | **v3**: plataforma e versão do app nativo |

Os 24 nomes aceitos estão no `events_guard`. O que cada um carrega está no
`docs/BACKEND.md` e no `ENVIADOS` do `src/admin.js`, que é a lista que a aba
Medição confere.

## 2. O que a análise achou

| # | Achado | Efeito | Agora |
|---|---|---|---|
| A1 | Envio só em `*.sleevu.app` (6 travas no shared.js) | O app Capacitor (`capacitor://localhost`, `https://localhost`) não mandaria nenhum evento: nem pageview, nem erro, nem view de carta | **Resolvido**: `emProducao()` = site ou app nativo |
| A2 | Nada identificava a plataforma | Impossível separar app de site depois do lançamento. O app no Android ainda cairia como `iab=webview` (navegador embutido) | **Resolvido**: `pl`/`av` no pageview; `admin_plataformas` |
| A3 | No app, o `page_time` só saía no `pagehide`, que não existe quando o app vai pro segundo plano | A última tela de cada visita do app sumiria, e o "tempo por visita" do app sairia menor que o da web | **Resolvido só no app**: envio no 1º `hidden`. A web segue no `pagehide` (ver A15) |
| A4 | O guard descarta calado (lista, tamanho, ritmo) | Evento novo no JS antes da migração, ou perda por CGNAT, some sem rastro | **Resolvido**: `events_descartes` + Técnico › Medição |
| A5 | A sentinela só vê nome que já chegou nos últimos 16 dias | O `search_hit` nunca chegou e nunca alarmou | **Resolvido**: lista "o que o site manda × o que chegou" |
| A6 | `search_hit` zerado desde que nasceu (28/09); `search_empty` parou em 25/09 | A demanda de busca está cega | **Diagnóstico**: o guard do repo aceita os dois (testado no PGlite). Ou o guard no ar é outro, ou a causa é do cliente. A 20261009a reescreve o guard e passa a contar descarte por NOME: se continuar zerado e sem descarte, é o cliente. Uma pista do cliente: a paleta conta como "achou" qualquer espécie, set ou artista de qualquer jogo, então busca vazia ficou rara |
| A7 | `utm_content` (`a`) e clique pago (`k`) chegam desde 06/10 | Nenhuma RPC lia | **Resolvido**: `admin_anuncios` em Aquisição › Campanhas |
| A8 | Navegação do dono contada como visitante | Com ~15 visitantes por dia, o dono testando é uma fatia visível | **Resolvido**: `sleevu-equipe-v1`, marcado sozinho no 1º acesso ao `/admin` |
| A9 | Número sem régua (sem período anterior), gráfico sem contexto | Pico de campanha lido como crescimento; queda de feriado lida como quebra | **Resolvido**: régua, média de 7 dias, fantasma, marcos |
| A10 | Página por página (top 20), sem visita | Não dava pra dizer qual área segura gente nem onde a visita termina | **Resolvido**: grupo Páginas (`admin_paginas`) |
| A11 | **Eventos de quem está logado levam a conta (`uid`)**, mas a política de privacidade diz que "nada disso identifica você" | A frase é forte demais: o `uid` liga o uso à conta, de forma pseudônima, só pra contar logados e a retenção por conta. Pra loja de app isso é "dado ligado a você" | **Resolvido** (2026-10-09, seção 4.6): a política (pt/en/es) diz o que vai, pra quê, a base legal e o contato; apagar a conta tira o `uid` dos eventos (`20261009b`); com a medição desligada, o erro sai sem a conta e o Cloudflare não carrega |
| A12 | `detail` é a tela do set E a da carta | Não dá pra separar "olhou o set" de "olhou a carta" | **Pendente**: proposta na seção 5 |
| A13 | Páginas estáticas da borda (índice /games, sets em inglês, artistas) não carregam o shared.js | Tráfego de SEO dessas páginas só aparece no Cloudflare | **Pendente** (seção 5) |
| A14 | `admin_erros` agrupa o dia em UTC; `admin_experiments`, `admin_users` e o `events_purge` cortam em UTC; o resto usa Brasília | Erro das 21h–0h cai no dia seguinte | **Pendente**, baixo impacto |
| A15 | Na web, a última página de uma visita no celular (trocou de app e o sistema fechou a aba) também perde o `page_time` | O tempo de uso na web é um piso | **Pendente**: um "page_time v2" em pedaços (seção 5). Mudar agora quebraria a série |
| A16 | Robô fora de alguns totais: `overview.errors` e `*_users` da `admin_dashboard`, desfechos da `admin_experiments`, `gate_conv` | Ruído pequeno | **Pendente**, baixo |
| A17 | `admin_health.cron` só olha se a extensão existe, não se os jobs estão agendados | "Ligado" pode ser mentira se o pg_cron foi ligado depois das migrações | **Pendente**. Conferir com `select jobname from cron.job;` |
| A18 | O README das migrações lista a `20260914a` e a `20261004a` como pendentes | Ambas estão no ar: a 14a criou `uid`/`bot`, de que tudo depende; a 04a foi aplicada em 05/10 | **Pendente**: corrigir o README na próxima migração |
| A19 | A regex de robô do guard pega `okhttp` e `java/` | Se o app mandar evento por HTTP nativo (CapacitorHttp ou SDK), o user-agent pode deixar de ser o do WebView e o evento pode virar robô | **Documentado**: o app manda pelo `fetch` do WebView (seção 4.3) |

## 3. O /admin v3

### 3.1 Navegação

Antes eram 6 grupos e 22 abas em chips de dois níveis. Agora são 8 grupos e
29 abas:

- **Desktop (1024px+):** barra lateral fixa com todas as abas à vista, um
  clique. Ela rola sozinha até a aba aberta.
- **Celular e tablet:** um `<select>` nativo com os grupos em `optgroup`.
- **Topo:** "grupo › aba" e o período (7/30/90).
- **Links antigos** (`#produto`, `#qualidade`…) continuam valendo.

A ordem dos grupos segue o caminho da pessoa:

1. **Visão geral**: Resumo, Crescimento, Para parceiros
2. **Aquisição** (chega): Audiência, Canais, Campanhas
3. **Páginas** (navega, novo): Áreas do site, Todas as páginas, Caminhos
4. **Engajamento** (fica): Retenção, Funil, Tempo de uso, Produto,
   Experimentos
5. **Usuários** (quem é): Perfil, Maiores coleções, Segmentos
6. **Mercado** (procura e compra): Lojas, Portal da loja, Demanda, Sets,
   Vitrine, Conteúdo
7. **App e plataformas** (em que aparelho, novo): Web × app, Versões do
   app, Lojas de apps
8. **Técnico**: Qualidade, Medição, Marcos (novo)

### 3.2 Novas formas de ler os gráficos

| Forma | Onde | Como ler | Por quê |
|---|---|---|---|
| **Régua do período anterior** | Cartões do Resumo, Áreas, Páginas | Selo verde ou vermelho com a variação; "antes: N" embaixo | Número sozinho não diz se é bom. O anterior é cortado na mesma hora do dia: às 10h, hoje tem 10h de dado, e o último dia do período anterior também |
| **Selo invertido** | Erros a cada mil páginas | Subir é vermelho | Nem toda alta é boa |
| **Minigráfico (sparkline)** com o anterior tracejado | Cartões do Resumo | A forma da série no próprio cartão | Mostra se o total veio de um pico ou de uma subida constante |
| **Média de 7 dias** | Gráfico principal do Resumo | Linha cheia por cima das barras | Tira o vaivém de dia útil × fim de semana e deixa a tendência à vista |
| **Período anterior "fantasma"** | Gráfico principal | Linha tracejada alinhada dia a dia | Compara a forma, não só o total |
| **Marcos** | Resumo, Crescimento (as duas séries) | Círculo numerado em cima do dia e a lista embaixo | O pico de 22–30/09 só se lê com "campanha paga" escrito em cima. Campanha com utm (5+ visitantes) vira marco sozinha |
| **Troca de métrica** | Gráfico principal | Visitantes, visitas, páginas, ativações, cartas, cliques, contas, erros: o mesmo gráfico, sem recarregar | Uma pergunta por vez, com a mesma régua |
| **O que mudou** | Resumo | Os maiores movimentos (página, jogo, canal, origem, plataforma), separados em subiu e caiu | A ordem é pelo IMPACTO (a − b), não pela %: 1 → 4 é "+300%" e não muda nada. Precisa de 10%+ e 3+ unidades, senão é ruído |
| **Mapa de calor hora × dia** | Aquisição › Audiência | Grade 7 × 24 começando na segunda; mais forte = mais páginas | Os gráficos de hora e de dia separados escondem que o pico de sábado pode ser de manhã e o de terça, à noite. É a grade pra marcar post, push e campanha |
| **Pequenos múltiplos** | Páginas › Áreas do site | Um quadro por área, cada um na própria escala | Compara a FORMA (cresce, cai, pico) de áreas de tamanhos muito diferentes |
| **Matriz de caminhos** | Páginas › Caminhos | Linha = de onde vem; coluna = pra onde vai (ou "Saiu"); cor = fração da linha | Mostra o uso real do site, por exemplo quanta gente do Catálogo chega à Coleção |
| **Porta de entrada × canal** | Páginas › Caminhos | Em que área começa a visita de cada canal | Campanha que entra pela home e para lá é dinheiro rejeitado |
| **Participação %** | App e plataformas › Web × app | Barras empilhadas, chave Número / % | Mostra o app ganhando espaço mesmo num dia de tráfego baixo |
| **Funil da loja ao uso** | App e plataformas › Lojas de apps | Visitas na loja → instalações → abriram o app → ativaram | Junta os números da loja (anotados) com os do próprio app |

### 3.3 Áreas do site

O mapa é o `AREAS` do `src/admin.js`. Ele vai inteiro pra `admin_paginas`,
então página nova ganha área com uma linha no JS, sem migração. O
`tests/admin-v3.test.mjs` falha se uma página com nome no painel ficar sem
área.

| Área | Páginas |
|---|---|
| Entrada e institucional | home, about, faq, help, privacy, terms, 404 |
| Catálogo | cards, sets, detail (set e carta), search, explore, pokedex, artists, trainers, lancamentos, comparar, lore |
| Minha coleção | hub, dashboard, collection, wishlist, portfolio, binders, pastas, listas, graded, sales, badges |
| Decks | decks, my-decks, deck |
| Comunidade e conteúdo | users, troca, blog, novidades |
| Ferramentas | tools, condition, centering, sleeves |
| Conta e login | login, account, settings, profile, backup |
| Interno | admin, parceiro, blog-editor |

Definições:

- **Visita**: páginas do mesmo navegador sem uma pausa de 30 minutos.
- **Entrada**: a visita começou na área.
- **Rejeição**: das entradas, as visitas que pararam na 1ª página.
- **Saída**: das páginas vistas ali, as que foram a última da visita.
- **Visitantes por área**: pessoas DISTINTAS. Não é a soma das páginas.

## 4. App de celular (Android e iOS)

### 4.1 Decisão: o mesmo cano, sem SDK de terceiro

A medição do app é a **mesma** do site. O app é o mesmo HTML/JS empacotado
no Capacitor, manda pelo mesmo `fetch`, cai na mesma tabela e aparece no
mesmo painel. Por quê:

- **A soma web + app sai de graça e sem duplicar.** Cada aparelho tem um id
  anônimo só dele: o armazenamento do app é separado do navegador. A ponte
  entre os dois é a conta.
- **A política de privacidade continua verdadeira.** Ela promete
  "first-party, sem rastreio entre sites, sem cookie". Firebase ou GA4
  levariam o uso pro Google e mudariam isso.
- **Nada de SDK nativo pra manter**, e as declarações das lojas ficam
  simples (seção 4.6).

O que só a loja sabe vem dos **consoles das lojas**, que são grátis: Play
Console e App Store Connect.

- **Entra hoje à mão** (App e plataformas › Lojas de apps): impressões,
  visitas à página do app, instalações, desinstalações, aparelhos ativos,
  nota, avaliações e taxa de travamento. Uma vez por semana basta.
- **Pra automatizar depois**: um job no GitHub Actions lê as APIs e chama
  `app_store_import(chave, linhas)`.
  - Google Play: as estatísticas de instalação ficam no bucket do Cloud
    Storage do console; os vitals vêm da Play Developer Reporting API.
  - Apple: Sales and Trends e a Analytics Reports API do App Store Connect.
  - O banco já tem a porta, com a chave por SHA-256 (README das migrações).

Terceiro **só se** o travamento NATIVO (fora do JS) virar problema. Nesse
caso, Sentry ou Crashlytics só pra crash. O erro de JS do app já chega pelo
`jserror`, como no site.

### 4.2 O que já está pronto no código

- `emProducao()`: o app mede (site **ou** `Capacitor.isNativePlatform()`).
- Pageview com `pl` (android | ios), lido de `Capacitor.getPlatform()`, e
  `av` (versão do binário), lido de `Capacitor.Plugins.App.getInfo()` com
  teto de 800 ms.
- `page_time` no 1º `hidden` dentro do app.
- `admin_plataformas`:
  - navegador × app da web instalado × Android × iOS, e a soma;
  - por plataforma: ativação, D1, D7, tempo por visita e erros a cada mil
    páginas;
  - contas logadas em 2+ plataformas;
  - versões do app e números das lojas.
- Abas Web × app, Versões do app e Lojas de apps. Antes do app existir, as
  colunas Android e iOS ficam zeradas, com um aviso.

### 4.3 Checklist pro esqueleto do Capacitor (pra medição funcionar)

O esqueleto (PR #175, `mobile/`, 2026-10-09) cumpriu os itens 1–4 e 7. O 5
mudou de forma, e o 6 segue pra depois.

1. **Instalar o `@capacitor/app`.** Sem ele não há `getInfo()`, e o
   pageview do app vai sem versão (a aba Versões mostra "?").
   **Feito** (8.1.1). A ponte do app também usa o plugin pro botão
   "voltar" do Android.
2. **Não ligar o `CapacitorHttp` pras chamadas ao Supabase.** Ele troca o
   `fetch` do WebView pelo HTTP nativo. O user-agent pode deixar de ser o
   do WebView (Dalvik/okhttp no Android, CFNetwork no iOS), e a regex de
   robô do guard pega `okhttp` (A19). Se um dia precisar ligar, mandar um
   pageview de teste do app e conferir em Técnico › Qualidade (gente ×
   robôs) antes de publicar. **Feito**: desligado. A ponte só reescreve o
   endereço de `/data` e `/api` e deixa o `fetch` do WebView.
3. **Não sobrescrever o user-agent.** O `appendUserAgent` com
   "SleevuApp/x" pode; trocar o UA inteiro, não. **Feito**: o UA é o do
   WebView, intacto.
4. **CORS das APIs da Cloudflare** (`functions/api/*`): aceitar
   `capacitor://localhost` e `https://localhost`. O Supabase já aceita
   qualquer origem. **Feito**: `functions/api/_middleware.js`, só pras duas
   origens. O catálogo estático manda `*` (`_headers`).
5. **Login com Google no app.** O app carimba `data-iab="app"` nos DOIS
   sistemas (theme.js, antes do `webview` do Android). O botão do Google
   some e o pageview leva `iab=app`. No iOS, sem isso, o botão aparecia e
   abria o Safari, que logava o SITE. O login dentro do app (deep link, e
   Sign in with Apple quando houver Google) fica pra próxima PR. Até lá o
   funil do app mostra esse atrito.
6. **Atribuição de instalação** (fase 2, opcional): o Install Referrer do
   Play diz de qual campanha veio a instalação. Exige plugin nativo. No
   iOS, só pelo App Analytics (links de campanha da App Store).
7. **Live update (Capgo):** a versão do JS vai no `jserror` (`v`). Antes de
   publicar JS que chama plugin novo, olhar quantos aparelhos ainda estão na
   versão velha do binário (Versões do app). **Feito**: toda página do
   pacote leva `<meta name="sleevu-build" content="app-<commit>">`, então o
   `v` do erro diz de qual commit veio o JS. O pageview do app também leva
   `s=1`: a ponte declara `navigator.standalone` pra esconder o convite de
   instalar o PWA. O `pl` decide a plataforma pela prioridade
   ios > android > pwa.

### 4.4 Web + app: o que soma e o que não soma

**Soma:**

- **Navegadores distintos**: cada aparelho conta uma vez, na plataforma de
  maior prioridade que usou (ios > android > pwa > web).
- **Contas distintas.**
- **Páginas vistas.**
- **Ações**: ativações, cartas, cliques e erros.

**Não soma:**

- **Visitantes por página vista entre plataformas.** Um Android com o app
  da web instalado aparece nas duas colunas, porque o app da web e o Chrome
  dividem o armazenamento.
- **Instalações da loja com aberturas do app.** São medidas diferentes, e é
  justamente a diferença entre elas que interessa: instalou e não abriu.

### 4.5 Rotina sugerida quando o app estiver no ar

**Semanal:**

- Anotar os números das lojas.
- Olhar Web × app em Participação %.
- Ver Versões antes de cada live update.

**A cada lançamento ou campanha:**

- Anotar um marco (Técnico › Marcos).

### 4.6 Declarações das lojas e a política de privacidade

O que o app coleta, pra Data safety (Play) e App Privacy (Apple):

- **Interações com o app e diagnóstico (erros)**: sem localização, sem
  contatos, sem identificador de publicidade, sem rastreio entre apps.
  Então **não pede ATT** no iOS.
- **Uso ligado à conta (A11).** Quando a pessoa está logada, o evento leva
  a conta. Pra Apple, isso é "Dados de uso → ligados a você, sem rastreio";
  no Play, "Atividade no app" e "Diagnóstico", coletados, não compartilhados,
  com opção de desligar.

A política foi reescrita em 2026-10-09 (pt/en/es), com o aval do Fernando:
- **Estatísticas de uso** (antes "Estatísticas anônimas") lista tudo o que
  entra, campo por campo:
  - as visitas com o identificador aleatório e o contexto (incluindo utm,
    clique de anúncio e a plataforma e a versão do app);
  - as funções contadas;
  - os relatórios de erro;
  - o contador por carta e o Cloudflare.
- Diz que, logado, vai o identificador interno da conta (nunca o e-mail),
  pra quê ele serve e quem vê; que ao apagar a conta o vínculo some; que o
  IP não é guardado (só um hash, por pouco tempo, pro limite de abuso); a
  base legal (legítimo interesse, LGPD art. 7º, IX); e como desligar.
- Cookies, retenção e a chave das Configurações deixaram de prometer
  anonimato total. O contato ganhou o e-mail (sleevuapp@gmail.com), com
  os pedidos da LGPD.

O código passou a cumprir o texto:
- apagar a conta tira o `uid` dos eventos (trigger da `20261009b`);
- com "Contar minhas visitas" desligado, o relatório de erro sai sem o token
  (sem conta) e o beacon do Cloudflare não carrega.

## 5. Fica pra depois (em ordem de valor)

1. **A6 depois de aplicar a 20261009a**: se `search_hit` seguir zerado SEM
   descarte, a causa é do cliente.
   - Conferir a paleta (`talvezBuscaVazia`).
   - Conferir as páginas `/search` e `/explore`, que talvez usem outra busca
     (a da borda) e nunca passem pela paleta.
2. **"page_time v2"** (A15): enviar em pedaços no `hidden`, com a marca de
   continuação, e as RPCs somarem os pedaços. Sem isso, o tempo na web é um
   piso. Quando trocar, anotar um marco: a série muda de régua.
3. **Set × carta** (A12):
   - O `analyticsPath` devolver `set` para `/games/<jogo>/<set>` e `card`
     para `/games/<jogo>/<set>/<carta>`.
   - As chaves antigas `card`/`set` (endereços de antes, hoje 301) já estão
     no Catálogo.
   - O que muda nas RPCs antigas: nenhuma filtra `path = 'detail'` (é só
     rótulo), mas a série histórica de "Detalhe" acaba no dia da troca.
     Anotar um marco.
4. **Páginas estáticas** (A13): um beacon mínimo (pageview só com `d`/`l`/`r`)
   no HTML da borda, ou aceitar que o SEO dessas páginas se lê no
   Cloudflare.
5. **Vitals no painel** (D5 do `docs/PLANO-TECNICO.md`): o evento `vitals`
   tem de entrar na lista do guard ANTES de o JS mandar. Agora, se esquecer,
   aparece em Descartados.
6. **Série longa por plataforma**: o `metrics_daily` guarda MAU sem separar
   plataforma, e o evento bruto some em 13 meses. Antes de o app fazer um
   ano, o retrato diário precisa de `mau_app`.
7. **Fuso e robô nas RPCs antigas** (A14, A16) e o **cron real** (A17).
8. **README das migrações** (A18).

## 6. Aplicar e conferir

1. Aplicar `supabase/migrations/20261009a_admin_v3.sql` no SQL Editor
   (aplicada em 2026-10-09). Ela contém a 20261006a: **não rodar a 06a
   depois**. Depois, a `20261009b_eventos_sem_conta.sql` (apagar a conta
   tira a conta das estatísticas, como a política promete). As consultas de
   conferir estão no README das migrações.
2. Abrir o `/admin` logado. O 1º acesso marca o navegador como da equipe (o
   aviso explica), e o Resumo ganha a régua.
3. Em Técnico › Marcos, anotar o que já aconteceu:
   - a campanha paga de 22–30/09;
   - o fim dela em 01/10;
   - deploys grandes (home nova em 07/10, por exemplo).
4. Depois de 2–3 dias, olhar Técnico › Medição › Descartados e "o que
   chegou". É ali que o `search_hit` se explica.
