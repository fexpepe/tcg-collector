# Catálogo: como entram cartas, sets e jogos

Regra de trabalho (o [CLAUDE.md](../CLAUDE.md) aponta pra cá): toda adição ao
catálogo — carta, set, linha ou jogo — segue este documento. Os mecanismos
(sync, merge de idiomas, aposentadoria de set, modelo v1 do Pokémon) estão no
[README.md](../README.md) e não se repetem aqui. Aqui fica **o que fazer, em
que ordem e como saber que terminou**.

> **Estado (2026-09-30):** as seções 1 a 4 descrevem o processo que vale hoje.
> A seção 5 mede de onde vem o ruído, e a seção 6 é o plano pra reduzir o custo
> de um jogo novo: hoje são 38 pontos de registro, e só 4 deles têm alguma trava
> automática. O plano tem as fases F1–F8, uma PR cada, e nenhuma foi feita
> ainda. Os números foram medidos na `main` em `f1df1aae`, já com o Star Wars,
> e no deploy dela.

## 0. Resumo

| Adição | O que é automático | O que é manual | Quem barra o erro |
|---|---|---|---|
| Carta nova num set que já existe | tudo: o build completo (diário 06:20 UTC, e sexta 21:00) roda os syncs | nada | `lint-catalog`: id publicado que some ou passa a apontar pra outra carta barra o deploy |
| Set novo | quase tudo: entra pelo sync, com filtros e página de SEO | conferir a tela (3.2); logo e nome em inglês quando existirem; no Pokémon, pin quando a janela automática não pega (3.3) | `lint-catalog` e os relatórios de cobertura |
| Linha ou jogo novo | nada | a ficha (4.1) e o checklist (4.2) inteiros | só 4 dos 38 pontos têm trava automática (4.2) |

## 1. Contratos que valem pra toda adição

1. **O id é o contrato.** Coleção, wishlist, decks, binders, vendas, custos,
   histórico de preço, D1 e páginas pré-renderizadas são indexados pelo `id` da
   carta. Id publicado nunca muda nem some. O `lint-catalog` barra o deploy nos
   dois casos. Na prática:
   - o id sai de algo que **não muda**: número oficial (Pokémon, vintage) ou
     `productId` do TCGplayer (família TCGCSV). Nunca da impressão escolhida
     pelo preço (é por isso que existe o `numDoId` em
     [scripts/lib/sync-common.mjs](../scripts/lib/sync-common.mjs)) nem da
     ordem em que a fonte lista;
   - cada jogo tem um **prefixo de id exclusivo** (`gcg-`, `ua-`, `dbc-`…).
     Os ids do Pokémon são `<setId>-<número>`, então o prefixo não pode
     coincidir com um setId dele (`np`) nem com o começo de um (`tk-bw-e` ocupa
     `tk-`). Também não pode coincidir com os prefixos do Lorcana (`cp-`,
     `DIS-`, `P1-`…). O comando da seção 7.3 confere;
   - em fonte de fã, o id fica **gravado no snapshot** e o refresh reaproveita
     o da carta já conhecida (ids pegajosos, ver
     [scripts/sync-dbc-carddass.mjs](../scripts/sync-dbc-carddass.mjs));
   - id que precisa mudar ganha de-para em `data/card-id-merges.json`, que hoje
     só o `retire-imported-sets` do Pokémon escreve. Em outro jogo, isso é
     conversa antes de código.
2. **Carta indexada nunca some.** Carta que a fonte tira fica congelada no
   catálogo (`preserveMissingCards`). Snapshot de fonte de fã só é regravado
   quando **não regride** (menos cartas é suspeito, e fica o anterior). Set
   aposentado deixa as cartas sem par congeladas, com `retired`.
3. **Dado que falta não se inventa.** Set sem logo próprio fica com
   `setLogo: ""` e a tela mostra o **nome** (sem arte da primeira carta, sem
   logo genérico do jogo). Carta sem preço fica sem preço. Nome traduzido só
   com fonte citada, e marcado quando a tradução é nossa (os títulos de cena do
   Naruto). Set fan-made fica fora do catálogo (`skip: true` no snapshot, como o
   "Set 29" do Naruto CCG).
4. **Fonte com procedência.** O cabeçalho do sync diz de onde vem cada campo,
   a URL e a data da última conferência do que muda com o tempo (lojas, logos,
   categoria). O User-Agent identifica o Sleevu (`Sleevu (sleevu.app) catalog
   sync` nas APIs; `Mozilla/5.0 … Sleevu/1.0 (+sleevu.app)` nos sites de fã).
   Fonte que recusa acesso automatizado (403, desafio do Cloudflare) não entra
   no sync, e o bloqueio não se contorna.
5. **Fonte fora do ar não derruba o deploy; catálogo corrompido derruba.** Todo
   passo de sync no `deploy.yml` termina em `|| echo "… mantém o catálogo
   versionado"`, e o `lint-catalog` é o contrapeso que falha alto.
6. **Um jogo, um registro.** Comportamento por jogo mora nas tabelas que já
   existem (4.2). Um `if (game === "x")` novo só entra quando o comportamento
   não cabe em tabela nenhuma, e com o porquê no comentário.

## 2. Carta nova num set que já existe

Não há o que fazer: a carta entra no próximo build completo. O que pode
aparecer no passo "Lint dos catálogos" do deploy:

| Mensagem | Tipo | O que fazer |
|---|---|---|
| `N id(s) PUBLICADO(S) sumiram do catálogo` | erro, deploy barrado | a fonte tirou ou re-identificou cartas. Achar o motivo antes de tudo. O `--aceitar-mudanca-de-id` só entra com a lista de quem perde carta na mão |
| `N id(s) passaram a apontar pra OUTRA carta` | erro, deploy barrado | o mesmo: é o caso que troca a carta da pessoa por outra |
| `N id(s) o TCGplayer mudou de set` | aviso | nada: é o mesmo produto (exceção `ID_DE_PRODUTO`, item A5) |
| `N id(s) mudaram de número` | aviso | conferir se é só formatação da fonte (`4/102` → `4`) |
| `N cartas < régua` ou `imagens X% (régua Y%)` | aviso | regressão da fonte? Conferir antes de rodar `--update-baseline` |

## 3. Set novo

### 3.1 Como o set entra, por família de fonte

| Família | Jogos | Como o set novo entra | `setId` | Logo |
|---|---|---|---|---|
| TCGdex, com a TCGCSV no lançamento | Pokémon | pela TCGdex; no lançamento a TCGCSV antecipa (3.3) | o da TCGdex (o provisório é aposentado) | espelhado por `mirror-set-logos` (EN/PT) e `mirror-ja-set-logos` (JA, de-para curado, passo local) |
| API própria | Lorcana (Lorcast), Magic (Scryfall) | sozinho no sync | código oficial | Lorcana: curado em `data/lorcana/set-logos/`; Magic: símbolo espelhado |
| TCGCSV (espelho do TCGplayer) | One Piece, FAB, Gundam, DBFW, Yu-Gi-Oh!, Digimon, Riftbound, Union Arena, Star Wars | sozinho no sync (grupo novo da categoria) | abreviação do grupo; rename da fonte é re-fixado sozinho (`repinSetIdsRenomeados`) | vazio, salvo curadoria local (One Piece, FAB e Star Wars) |
| Fã, com snapshot | Naruto, HxH, DBC, vintages do One Piece | quando a fonte publica e o snapshot não regride; set sem lista carta a carta não gera carta | fixo no script | curado ou vazio |
| Curadoria | JUMP | à mão em `data/jump/curated/` | — | — |

### 3.2 O que conferir quando um set novo aparece

- A tela de Sets mostra o set com **nome, data e X/Y**. O Y é o total oficial
  (`setTotal`) quando a fonte tem, senão a contagem do chunk.
- O set caiu na **categoria certa**. Lorcana, One Piece, Naruto, HxH e DBC
  agrupam pelo `setId` (`group<Jogo>Sets` em [src/app.js](../src/app.js)), e
  um formato de código inédito pode cair em "outros".
- **Filtros**: nada a fazer. As facetas (`GAME_FACETS` em
  [src/facets.js](../src/facets.js)) saem dos campos que o sync grava, e um
  valor inédito aparece sozinho no fim da lista.
- **Logo**: vazio é o certo quando o set não tem logo próprio. Quando tem, o
  arquivo vai em `data/<jogo>/set-logos/<setId>.<ext>`. Nos jogos com logo
  local (Lorcana, One Piece, FAB e Star Wars), o sync usa o arquivo que existe
  e não baixa por cima.
- **Nome em inglês** (set japonês do Pokémon e vintages): `JA_SET_EN` e
  `VINTAGE_SET_EN` no [src/shared.js](../src/shared.js), com a fonte verbatim
  (Bulbapedia no japonês). Cada nome **custa bytes do `shared.js`**, que está no
  teto (5.4). É por isso que a F3 tira esses mapas de lá.
- **Preço**: aparece no build seguinte ao da listagem dos singles no
  TCGplayer. Set em pré-venda pode entrar sem preço.

### 3.3 Pokémon: o caminho do lançamento

Resumo do README ("Preço do Pokémon" e "Modelo de carregamento do Pokémon EN —
v1"):

- Grupo EN de era moderna, publicado há no máximo 90 dias, com pelo menos 20
  singles numerados e sem set nosso, entra **sozinho** pela TCGCSV, com
  `setId` provisório tirado do nome.
- Fora dessa janela, entra por **pin** (`enImport` em
  `data/tcgcsv-set-map.json`), que escolhe o `setId` (uma aposta no id que a
  TCGdex vai usar), o nome, a série e a data. O log do sync lista os candidatos
  a pin.
- Quando a TCGdex publica, o `retire-imported-sets` aposenta o provisório,
  grava o de-para, e a conta de quem marcou migra sozinha. Não há passo manual.
- Set japonês que a TCGdex não tem entra inteiro pela TCGCSV (ids
  `<CÓDIGO>-<número>-ja`). Código ambíguo precisa de apelido em `ja.alias`.

## 4. Linha ou jogo novo

### 4.1 A ficha: decidir antes de escrever código

Parte destas decisões é do Fernando (linha ou jogo, cor, logo, posição no
hub). A ficha preenchida vai na descrição da PR.

- **Linha ou jogo?** Pelos precedentes, vira **linha** (`GAME_LINES`,
  `?line=`) quando já existe um slug que é a **marca**: as vintages do One
  Piece e do Naruto são linhas de `onepiece` e `naruto`, e o Miracle Battle é
  linha de `hxh`. Vira **slug próprio** quando o slug existente é um **jogo
  específico** (o `dbc`, Carddass de Dragon Ball, não é linha do `dbfw`, que é
  o Fusion World) ou quando não há slug da marca. Linha soma na conta da marca;
  slug tem chip, cor e contagem próprios. A escolha não se desfaz depois,
  porque os ids ficam.
- **Uma linha ou uma por título?** Títulos em sequência da MESMA plataforma
  são **uma linha com seções**, como as eras de um jogo: o arcade Data
  Carddass do Naruto teve Card Battle, Mission, Formation e Cross, e é a linha
  `nrt-dc` com uma seção por título (PR #134, 2026-09-30). Cada título pode ter
  prefixo de id próprio: a linha lista todos em `prefixes` no `GAME_LINES`, e
  um `group<…>` no `app.js` monta as seções (item B16). Se uma linha já
  publicada virar seção de outra, o `?line=` antigo entra em `LINE_ALIASES`
  (shared.js), pra favoritos e links seguirem abrindo.
- **slug**: minúsculo, `[a-z0-9]+`, curto (`unionarena`, `dbc`). Vai pra URL
  (`?game=`), pro banco e pras chaves do localStorage
  (`tcg-collector-<slug>-…`).
- **Nome completo** e **rótulo curto** do chip ("Star Wars: Unlimited" e
  "Star Wars").
- **Prefixo de id**: ver 1.1 e o comando da 7.3.
- **Fonte e família** (3.1). Na TCGCSV, anotar a categoria e a `tcgLine`: o
  prefixo do slug na URL de produto da própria TCGCSV é a linha do TCGplayer.
- **Durabilidade**: no padrão FAB, o `cards.js` inteiro é versionado e os
  chunks saem no build. Perto do teto de **25 MiB por arquivo** do Pages, vale o
  padrão Magic/YGO: chunks versionados e monólito fora do git e do deploy
  (`.gitignore` e o passo "Remove arquivos" do `deploy.yml`). O YGO foi pra esse
  padrão com 22 MB. Fonte de fã usa snapshot versionado em
  `data/vintage/<fonte>.json`.
- **Preço**: slots `u`/`uf` (USD normal e foil) e `e` (EUR), variantes em ordem
  canônica. Jogo vintage fica sem preço.
- **Imagem**: host e resolução (largura útil de pelo menos 440 px). A moldura
  63/88 resolve a proporção na exibição (README, "Imagem de carta: contrato pra
  jogo novo"). Host novo é o item C16.
- **Lojas** (`MARKETS`): Liga e MYP (BR), `tcgLine`/`usText` (EUA), `cm`
  (Cardmarket). Cada URL é aberta e conferida no dia, com a data no comentário,
  como no Union Arena ("sem loja BR, conferido em 07/08/2026").
- **Cor**: contraste AA com texto preto ou branco (o `textOnColor` escolhe o
  melhor) e pelo menos 65 de distância RGB do vizinho mais próximo (a régua que
  o ouro do Riftbound fixou).
- **Logo do jogo e posição no hub**: logo em `assets/games/game_<slug>.webp`,
  pela especificação de [assets/games/README.md](../assets/games/README.md).
  Sem logo, o tile mostra o nome. A grade moderna do hub foi desenhada pra **12
  tiles**, que fecham retângulo em 4, 3 e 2 colunas. Com o Star Wars ela tem 13,
  e 13 deixa fileira incompleta em qualquer número de colunas: a posição do
  próximo jogo e o formato da grade se decidem juntos. A seção Vintage segue
  ordem cronológica.
- **Orçamento** (5.3 e 5.4): arquivos no deploy e bytes no `shared.js` e no
  CSS. Se não cabe, o jogo espera a fase que abre espaço. O teto não sobe por
  reflexo (cabeçalho do [scripts/check-size.mjs](../scripts/check-size.mjs)).

Modelo pra descrição da PR:

```text
Ficha do jogo — <Nome completo> (`<slug>`)
- Linha ou jogo: <slug próprio | linha `<linha>` de `<slug>`> — <porquê>
- Rótulo curto (chip): <…>
- Prefixo de id: `<prefixo>-` (7.3: livre)
- Fonte: <TCGCSV cat. N | API <nome> | fã: <site>, snapshot data/vintage/<x>.json | curadoria> — conferida em <data>
- Durabilidade: <padrão FAB | padrão Magic | snapshot>
- Preço: <u/uf/e de <fonte> | sem preço>
- Imagem: <host>, <largura> px — host novo? <não | sim (C16)>
- Lojas: BR <…|nenhuma, conferido em <data>> · EUA <tcgLine/usText> · EU <cm|—>
- Cor: <hex> — <x>:1 com texto <preto|branco>; vizinho mais próximo <jogo>, a <d> RGB
- Logo: <arquivo | sem logo, tile em texto> · posição no hub: <…>
- Orçamento: <n> sets ≈ <3n + 40> arquivos (último deploy: <total> de 18.000);
  shared.js +<b> B gz, CSS +<b> B gz (folga depois: <…>)
- Migração: supabase/migrations/<arquivo>.sql (aplicar em ordem de nome)
```

### 4.2 Checklist

A ordem das letras é a ordem dos commits (4.5). "Se faltar" diz o que
acontece. "Trava hoje" diz quem pega o esquecimento; **—** quer dizer que
ninguém pega e o erro vai calado pro ar. Itens com condição ("só vintage")
valem só nesse caso.

**A. Fonte e dados** (commit 1)

| # | Onde | O que entra | Se faltar | Trava hoje |
|---|---|---|---|---|
| A1 | `scripts/sync-<slug>.mjs` | o sync, a partir do modelo da família: [sync-unionarena.mjs](../scripts/sync-unionarena.mjs) (TCGCSV), [sync-dbc-carddass.mjs](../scripts/sync-dbc-carddass.mjs) (fã com snapshot). Grava por `writeGameCatalog` e preserva carta sumida | — | — |
| A2 | `tests/<slug>*.test.mjs` | parse e atribuição de id com fixture, sem rede; obrigatório quando o sync tem lógica própria | regressão de parse ou de id passa | — |
| A3 | `data/<slug>/` (e `data/vintage/<fonte>.json`) | rodar o sync e versionar o que o `.gitignore` deixa | dev e build rápido sem catálogo | guarda C15 |
| A4 | `data/catalog-baseline.json` | `node scripts/lint-catalog.mjs --update-baseline` e commitar **só a linha do jogo novo** | sem régua, catálogo zerado desse jogo não barra o deploy | — |
| A5 | `scripts/lib/id-stability.mjs` (`ID_DE_PRODUTO`) | formato do id, se ele é `productId` do TCGplayer | quando o TCGplayer mudar uma carta de grupo, o lint derruba o deploy agendado (foi o que criou a exceção, com Gundam e FAB, em 26/09/2026) | lint, mas tarde |
| A6 | `scripts/lint-catalog.mjs` (`GAMES`) | slug e dataDir | jogo fora da checagem de integridade e da régua | — |

**B. Registro no front** (commit 2)

| # | Onde | O que entra | Se faltar | Trava hoje |
|---|---|---|---|---|
| B1 | `src/game.js` (`GAMES`) | slug, nome completo, dataDir | `?game=<slug>` rejeitado, a página cai no Pokémon | — |
| B2 | `src/game.js` (`IMG_HOST`) | só se o host de imagem não tem preconnect no HTML | imagem começa mais tarde (LCP) | — |
| B3 | `src/shared.js` (`DATA_GAMES`) | slug e dataDir | `normalizeGame` devolve "pokemon" e `gameDataDir` devolve `data/`: as páginas pessoais não carregam o jogo | — |
| B4 | `src/shared.js` (`GAME_COLOR`) | a cor (ficha) | etiqueta na cor do Pokémon | — |
| B5 | `src/shared.js` (`GAME_LABEL_KEY`) e `src/i18n.js` (`filter.game<X>` em pt, en e es) | rótulo curto | rótulo "Pokémon" (sem entrada no mapa) ou a chave crua (sem tradução) | `check.mjs`, só por causa da `<option>` do explore.html (4.3) |
| B6 | `src/shared.js` (`MARKETS`) | lojas da ficha; `noTcgplayer` quando o TCGplayer não tem o jogo | links da carta vão pra LigaPokémon e pro TCGplayer do Pokémon | — |
| B7 | `src/shared.js` (`EXPLORE_SUBNAV`) | só se o jogo tem artista | sem aba Artistas (o padrão é o mínimo seguro) | — |
| B8 | `src/shared.js` (`VINTAGE_ID_PREFIX`), `src/explore.js` (`VINTAGE_GAMES`), `filter.vintageHint` | só vintage | cartas fora do filtro Vintage | — |
| B9 | `src/shared.js` (`GAME_LINES`), `sets.category.*`, tile no hub | só linha | linha sem página própria | — |
| B10 | `styles.css` (`[data-game-accent="<slug>"]`) | bloco do escuro e do claro; no claro, os dois seletores (no `<html>` e de descendente, que o tile do hub usa) | página e tile no vermelho do Pokémon, que é o accent base | — |
| B11 | `src/app.js` (`GAME_LOGO`) e `src/admin.js` (`KIT_LOGO`) | arquivo do logo, ou `""` sem logo | sem logo no lugar do set e no kit | — |
| B12 | `src/binders.js` (`PREFIXO_JOGO`) e `src/card-rescue.js` (`ID_PREFIX_GAME`) | o prefixo de id | carta do jogo no binder sem jogo atribuído ("Tenho" e preço manual olham a coleção errada); link de carta resolve em duas ondas | — |
| B13 | `src/backup-import.js` (`mapCsvGame`) e `tests/csv-import.test.mjs` | o nome do jogo como Collectr e TCGplayer escrevem | import de CSV tenta todos os jogos (mais lento; pode casar carta homônima de outro jogo) | — |
| B14 | `src/portfolio.js` (`CSV_GAME_NAMES`) | nome no CSV do Portfólio, até a F6 | CSV sai com o slug (hoje já sai assim em 9 jogos, 5.2) | — |
| B15 | `hub.html` | tile: grade moderna ou Vintage (anos e bandeira), com a posição da ficha; `href="/games/<endereço>"` e `data-game="<slug>"` (desde 2026-09-30) | jogo sem porta de entrada | `games-url.test.mjs` (todo endereço tem tile e todo tile aponta pro registro) |
| B16 | opcionais: `src/facets.js`, `src/detail.js` (`RARITY_LISTED_GAMES`), `src/app.js` (`group<Jogo>Sets`), `src/scan.js`, `src/deck-rules.js` | filtros, agrupamento, scanner e regras de deck próprios | tudo genérico (funciona) | — |
| B17 | `src/game.js` (`URL_DOS_JOGOS`) | a cópia do C17: `[endereço, slug, linha, prefixos]` | a tela do jogo em `/games/<endereço>` não sabe qual jogo abrir e cai no da sessão | `games-url.test.mjs` (a cópia bate com o C17) |

**C. Borda, build e deploy** (commit 2)

| # | Onde | O que entra | Se faltar | Trava hoje |
|---|---|---|---|---|
| C1 | `functions/api/search.js` (`GAMES`) | slug | `/api/search?game=<slug>` responde 400 | — |
| C2 | `functions/api/collection.js` (`GAMES`) | slug | a borda ignora o jogo, e quem também tem carta de outro jogo **não vê as cartas dele** na Coleção nem no Portfólio (o cliente segue com o que veio) | — |
| C3 | `functions/detail.js` (`JOGOS`) | slug | página de carta sem os metadados de SEO | — |
| C4 | `scripts/lib/d1-catalogo.mjs` (`JOGOS`) | slug e dataDir | jogo fora do D1: mesmo efeito do C2, sem busca global, e o espelho R2 não vê as imagens | — |
| C5 | `scripts/prerender-catalog.mjs` (`GAMES` e `DECK_GAME_LABELS`) | slug e nome | sem páginas de set e de carta pro Google | — |
| C6 | `scripts/enrich-manifest.mjs` (`DIRS`) | dataDir | o manifest do jogo fica fora da manutenção de todo build: no build rápido, mudança de formato não chega nele e set sem chunk vira tile vazio | — |
| C7 | `scripts/split-pricing.mjs` (`DIRS`) | dataDir | sem chunks de preço (o cliente cai no monólito) | — |
| C8 | `scripts/build-releases.mjs` (`JOGOS` e rótulo) | slug, dataDir, nome | sets fora de /lancamentos e do .ics | — |
| C9 | `scripts/build-market.mjs` (`JOGOS`) | slug e dataDir | sem trilho de altas e quedas | — |
| C10 | `scripts/build-set-trends.mjs` (`DIRS`) | dataDir | sem o chip de variação por set | — |
| C11 | `scripts/send-wishlist-push.mjs` | só com preço | sem aviso de queda de preço | — |
| C12 | `scripts/healthcheck.mjs` | cartas; preço e deltas se tem preço | queda do catálogo em produção não alerta | — |
| C13 | `.github/workflows/deploy.yml` | passo do sync (com `\|\| echo`); passo `sync-price-history.mjs data/<slug>` se tem preço | catálogo não atualiza e fica sem histórico | — |
| C14 | `deploy.yml` (restore e save) e `mirror-images.yml` (restore) | `data/<slug>/sets` (padrão FAB) ou os monólitos (padrão Magic) nas **três** listas de cache, idênticas e na mesma ordem | listas diferentes: o job de imagens deixa de achar o cache e o espelhamento para em **todos** os jogos (5.5) | — |
| C15 | `deploy.yml` ("Decide o modo do build") | `data/<slug>/manifest.generated.js` na guarda | build rápido publica o tile sem catálogo atrás | — |
| C16 | `_headers`, `sw.js`, `scripts/lib/img-mirror.mjs` | só com host de imagem novo: `img-src` **e** `connect-src` (o SW baixa por `fetch`), `IMAGE_HOSTS` (e `MUTABLE_IMAGE_HOSTS` se a arte muda na mesma URL), `FONTES` do espelho | imagens bloqueadas pela CSP somem do site | — |
| C17 | `functions/_lib/jogos.js` (`JOGOS_URL`) | endereço oficial em inglês e por extenso (`star-wars-unlimited`, o nome que o TCGplayer usa), nome, logo, e pra linha o `linha` e os `prefixos`; apelido novo em `APELIDOS` | sem `/games/<endereço>` (404), sem páginas de set e de carta, fora dos sitemaps e da página /games | `games-url.test.mjs` (todo jogo do app tem endereço; endereço único e fora das rotas reservadas) |

**D. Banco** (commit 2, aplicada pelo Fernando)

| # | Onde | O que entra | Se faltar | Trava hoje |
|---|---|---|---|---|
| D1 | `supabase/migrations/<AAAAMMDD><letra>_add_<slug>.sql` e o README de lá | cópia da migração de jogo mais nova, com a lista inteira mais o slug, nas **duas** whitelists (`card_views`/`increment_card_view` e `contribute_price`), mais o par de `curl` de verificação | views de carta e Preço da Comunidade descartados em silêncio (as funções só dão `return`) | — |

**E. Textos** (commit 3)

| # | Onde | O que entra | Se faltar | Trava hoje |
|---|---|---|---|---|
| E1 | `README.md` ("Os jogos") | linha da tabela; seção própria só se o jogo tem peculiaridade | — | — |
| E2 | `assets/games/game_<slug>.webp` e `assets/games/README.md` | logo e procedência (ou a pendência anotada) | tile em texto | — |
| E3 | `index.html` (`.lp-stat`) e `src/i18n.js` (`home.lp.*`) | número de jogos; "de <ano>" se o jogo é mais antigo que o atual | landing desatualizada | — |
| E4 | `src/i18n-docs.js` (`about.s.games` e `faq.a.games`, em pt, en e es) | número e lista de nomes | Sobre e FAQ desatualizados | — |
| E5 | `scripts/og/og-image.html` e `og-image.png` | número de jogos e o "e mais N jogos"; PNG regerado com `node scripts/build-og-image.mjs` (Chrome local, fora do CI). Se cartas e sets mudarem de patamar ("240 mil+", "2.200+"), também o `KIT_CATALOGO` do `src/admin.js` e a landing | imagem de compartilhamento desatualizada | — |
| E6 | `src/i18n-docs.js` (`vs.s.table`, linha "Jogos" da página /comparar, em pt, en e es) | número de jogos com catálogo | o CI falha | `tests/comparar-veracidade.test.mjs` (compara com o `catalog-baseline.json`, então depende do A4) |

Contagem: um jogo TCGCSV com preço, sem host novo e sem opcionais, passa por
**38 itens** (A1, A3–A6; B1, B3–B6, B10–B15; C1–C15; D1; E1–E6). Só 4 têm
alguma trava automática: A3 (pela guarda C15), A5 (pelo lint, que derruba o
deploy agendado), B5 (pelo `check.mjs`, por acaso) e E6 (pelo teste do
/comparar). Os outros 34 dependem de alguém lembrar. Parte aparece na tela quando se testa (tile, cor, página do
jogo), mas os da borda, do build, do banco e os mapas que caem no Pokémon vão
calados pro ar.

### 4.3 O que não mexer: é ruído

- **Chips estáticos** de `collection.html` e `wishlist.html`: o
  `initGameFilterChips` (shared.js) reconstrói a fileira a partir de
  `GAME_SLUGS`. O HTML traz 6 dos 15 jogos e não faz falta.
- **`<option>` do `explore.html`**: também é reconstruída (`src/explore.js`).
  Mas hoje é ela que faz o `check.mjs` exigir a chave `filter.game<X>`: a
  regra dele só enxerga `t("…")` e `data-i18n`, e o `GAME_LABEL_KEY` é um
  literal num mapa. Fica até a F1 travar as chaves, e aí sai junto com os
  chips.
- **Amostra de cores em `settings.html`** (`.sw-<slug>`): é vitrine de exemplo
  com 6 jogos, não registro.
- **Comentário com contagem de jogos** ("os 13 jogos"): das 41 menções no
  código, 31 já estão erradas. Escrever "todos os jogos".
- **Ordinal em commit ou PR** ("15º jogo"): o `dbc` e o `swu` se chamaram os
  dois de 15º, porque um conta o JUMP e o outro não. Use o slug.

### 4.4 Pronto = PR

Antes da PR:

1. `node scripts/sync-<slug>.mjs` local, com as contagens do log batendo com a
   fonte, e `node scripts/lint-catalog.mjs` mostrando a linha do jogo e
   terminando em "catálogos íntegros".
2. Os checks do CLAUDE.md, mais o orçamento de peso (7.1), porque o
   `check-size` está colado no teto.
3. Na tela (servidor local, 1280 px e 390 px, tema claro e escuro): tile do
   hub; tela de Sets (categorias, nome, data, X/Y); um set aberto, com os
   filtros; o popup com o preço e **cada link de loja clicado** (tem que cair
   na busca do jogo certo); o Explorar com o jogo no seletor; a Coleção com uma
   carta do jogo (chip, cor, valor). As páginas pessoais exigem login.

Depois do merge (vai na PR como pendência):

4. Migração aplicada pelo Fernando e conferida com o par de `curl` do próprio
   arquivo. A view **cria a linha** no `card_views`, e um jogo inventado **não
   cria**. O 204 sozinho não prova nada: a função devolve 204 até pra jogo
   inválido.
5. No log do primeiro deploy completo: a linha do jogo no lint, a contagem do
   prerender e "Arquivos no deploy".
6. `/api/search?game=<slug>&q=<nome>` devolvendo carta depois da recarga do D1
   (em jogo grande a troca leva minutos, e nesse tempo a resposta vem vazia).

### 4.5 Commits e PR

- Branch a partir da `origin/main` (CLAUDE.md), em três commits:
  1. **fonte**: bloco A (sync, teste, dados, régua, lint);
  2. **registro**: blocos B, C e D;
  3. **textos**: bloco E.

  Assim o diff de dados fica isolado. O `dbc` entrou num commit só: 51
  arquivos e 10.830 linhas, 9.866 delas do snapshot. Separado, a revisão lê o 2
  e o 3, e reverter o registro não mexe nos dados.
- Descrição da PR: a ficha preenchida, o que foi conferido (4.4) e as
  pendências pós-merge (migração, logo).
- **Dois jogos em paralelo** (aconteceu em 2026-09-30, com `dbc` e `swu`):
  quem mescla depois faz rebase e resolve os conflitos de registro por **união**
  (as duas entradas ficam). A migração do segundo tem de conter o slug do
  primeiro, porque cada uma **reescreve a lista inteira**. Se a do primeiro
  ainda não foi aplicada, ela sai da lista de pendentes no mesmo commit: a do
  segundo já a cobre, e aplicá-la depois apagaria o segundo jogo (5.5).

## 5. Diagnóstico: de onde vem o ruído

Medido em 2026-09-30 na `main` em `f1df1aae`, já com o Star Wars, e no deploy
dela (15:06 UTC).

### 5.1 Registro espalhado

O commit do `dbc` mexeu em 51 arquivos, e os 3 commits do Star Wars (`swu`),
em 62. A lista de jogos (slug, dataDir ou os dois) se repete em 10 scripts, nas
3 Functions, no `DATA_GAMES` e no `game.js`; o nome completo, em pelo menos 5
lugares; o prefixo de id, em 3 mapas (`binders.js`, `card-rescue.js`,
`id-stability.mjs`). São 38 itens por jogo, e 34 deles sem trava automática
(4.2).

### 5.2 Mapas que envelhecem e caem no Pokémon

- `CSV_GAME_NAMES` ([src/portfolio.js](../src/portfolio.js)) parou nos 6
  primeiros jogos. O CSV do Portfólio exporta `magic`, `ygo`, `fab`, `gundam`,
  `dbfw`, `digimon`, `riftbound`, `unionarena` e `swu` como slug cru.
- Todo mapa por jogo sem a entrada cai no **Pokémon**, sem erro: rótulo
  (`gameLabel`), cor (`GAME_COLOR` e o accent base do CSS), lojas
  (`marketOf`), jogo (`normalizeGame`) e diretório (`gameDataDir`).

### 5.3 Orçamento de arquivos do Pages

- Deploy com o Star Wars: **16.479 arquivos**, 161 a mais que o anterior (das
  12:46 UTC, sem ele). O passo "Conta arquivos" avisa acima de 16.000 e **falha
  acima de 18.000** (o teto do Pages é 20.000). Folga: 1.521.
- Um set custa 3 arquivos: chunk de cartas, chunk de preço e página de SEO
  (2.694 páginas de set pra 2.694 sets). Um jogo soma ainda uns 40 fixos:
  catálogo, índices, histórico de preço e os logos de set (o Star Wars trouxe
  12). As páginas de carta e de artista têm teto global e não crescem com o
  jogo.
- **138 deles são chunks de preço vazios**: Naruto 105, HxH 15 e DBC 18. Jogo
  sem preço ganha um arquivo `{}` por set. Sem a flag `pc` no manifest, o
  cliente já usa o monólito (um arquivo só), então esses chunks não fazem nada
  (F2).

### 5.4 Orçamento de peso do núcleo

Medido como o CI (minificado e gzip -9). O custo de cada bloco é o que sai
quando ele é tirado (método em 7.1).

- `shared.js`: 83.883 de 83.968 bytes gz (folga de **85**). CSS núcleo: 33.552
  de 33.792 (folga de 240).
- O registro de um jogo custa **70 B** no `shared.js` (`DATA_GAMES`,
  `GAME_COLOR`, `GAME_LABEL_KEY` e `MARKETS`, medido tirando as entradas do
  Star Wars) e **58 B** no CSS (os dois blocos de accent). Com 85 B de folga,
  cabe mais um jogo só se ele não trouxer mais nada pro núcleo: nome de set em
  inglês, agrupamento ou qualquer ajuste junto estoura o teto.
- O que é dado por jogo dentro do núcleo: `VINTAGE_SET_EN` 2.456 B,
  `JP_NAME_ALIASES` (apelidos em romaji da busca dos vintages) 1.776 B e
  `JA_SET_EN` 1.367 B, cerca de 5,6 KB, ou 7% do teto. O `JA_SET_EN` cresce a
  cada set japonês novo. No CSS, os accents dos 15 jogos somam 960 B.

### 5.5 Cópias que divergem

- **Syncs TCGCSV**: 9 scripts de 130 a 240 linhas com o mesmo esqueleto (One
  Piece, FAB, Gundam, DBFW, Yu-Gi-Oh!, Digimon, Riftbound, Union Arena e Star
  Wars). O do Union Arena difere do Riftbound em ~50 linhas de diff, quase tudo
  mapeamento de campo. Os 9 têm o mesmo `api()` copiado, com 4 tentativas em
  ~15 s, e não usam o `fetchJsonRetry`, que nasceu quando uma queda da TCGdex
  derrubou o deploy (15/09/2026). A correção de abreviação repetida (dois
  grupos "P26") existe só no `sync-swu.mjs`; os outros 8 não a têm.
- **Migração de jogo novo**: copia os corpos inteiros de `increment_card_view`
  e `contribute_price`, com a lista de jogos em três lugares, e cada uma
  reescreve a lista inteira. Isso já aconteceu: a `20260930a` (`swu`),
  aplicada em 30/09, trouxe o `dbc` na lista, e a `20260924a` (`dbc`) ficou em
  "Pendentes de aplicar" no [README das migrações](../supabase/migrations/README.md).
  Aplicada depois, ela tiraria o `swu` das duas whitelists. Saiu da lista no
  mesmo dia, e o README a registra como "não aplicar".
- **Listas de cache**: as três listas de `path` do cache de catálogo
  (restore e save no `deploy.yml`, restore no `mirror-images.yml`) precisam
  ser idênticas e na mesma ordem, porque o `actions/cache` deriva a versão da
  entrada dessa lista. Com listas diferentes, o cache não é encontrado. No job
  de imagens, isso para o espelhamento de todos os jogos, sem erro.

### 5.6 Textos com contagem

O número de jogos está escrito à mão no `index.html`, no Sobre e na FAQ (3
idiomas, com a lista de nomes) e no `og-image.html` (e no PNG, regerado com um
Chrome local). O kit do `/admin` já faz o certo: conta pelo `GAME_SLUGS`. Nos
comentários, 31 das 41 menções já estão erradas.

## 6. Plano: de 38 pontos pra ~10, com trava nos que sobram

Cada fase é uma PR que entrega sozinha, na ordem recomendada: primeiro a trava
(F1), depois o que abre espaço pro próximo jogo (F2 e F3), e por fim o que
encolhe o checklist (F4 a F8).

| Fase | O que faz | Efeito | Esforço | Risco |
|---|---|---|---|---|
| **F1** trava do registro | teste que confere todos os espelhos contra o `game.js` | quase todos os itens sem trava passam a falhar no CI | pequeno | nenhum |
| **F2** preço só onde há preço | `split-pricing` pula jogo sem preço | −138 arquivos; jogo vintage novo custa zero ali | pequeno | baixo |
| **F3** dados de vintage e JA no catálogo | tira `VINTAGE_SET_EN`, `JA_SET_EN` e `JP_NAME_ALIASES` do `shared.js` | ~5,6 KB gz fora do núcleo; abre espaço pros próximos jogos | médio | médio |
| **F4** lib TCGCSV | um esqueleto, e cada jogo vira configuração | jogo TCGCSV novo ≈ 30 linhas; correção vale pra todos | médio | baixo |
| **F5** jogos numa tabela do banco | migração de jogo vira um `insert` | fim da cópia de função e do risco de ordem | médio | médio |
| **F6** registro único no Node | scripts e Functions leem uma lista só | −15 itens do checklist | médio | baixo |
| **F7** accent fora do CSS núcleo | cor do jogo sai do registro | até −960 B gz do CSS núcleo, e jogo novo custa zero ali | médio | médio |
| **F8** textos e CI derivados | contagens e listas de cache saem do registro | −5 itens do checklist | pequeno | baixo |

**F1 — Trava do registro.** Um `tests/registro-jogos.test.mjs` que toma o
`GAMES` do `src/game.js` como fonte da verdade e, com as exceções declaradas no
próprio teste (JUMP sem catálogo, jogo sem preço fora das listas de preço),
confere:

- `DATA_GAMES`, `GAME_COLOR`, `GAME_LABEL_KEY` e `MARKETS` completos (lidos
  pelo `tests/lib/shared-sandbox.mjs`), e cada chave do `GAME_LABEL_KEY` em pt,
  en e es;
- as listas das 3 Functions, do `d1-catalogo`, do `lint-catalog`, do
  `prerender-catalog`, do `enrich-manifest`, do `split-pricing`, do
  `build-releases`, do `build-market`, do `build-set-trends`, do
  `send-wishlist-push` e do `healthcheck`;
- o accent (escuro e claro) de cada jogo no `styles.css` e um tile
  `sets?game=<slug>` no `hub.html`;
- o prefixo de id no `PREFIXO_JOGO` e no `ID_PREFIX_GAME`, sem colisão com o
  Pokémon e com o Lorcana (a mesma regra da 7.3);
- as três listas de cache idênticas, e o manifest de cada jogo na guarda do
  build rápido;
- a migração mais nova que redefine `increment_card_view` e `contribute_price`
  listando todos os slugs.

A mensagem de falha aponta o item da 4.2. Com isso a `<option>` do
`explore.html` e os chips estáticos podem sair (4.3).

**F2 — Chunk de preço só onde há preço.** O `split-pricing` pula o jogo cujo
monólito não tem nenhuma entrada: não escreve chunks e não liga `pc`. O
carregamento do cliente já trata a falta da flag baixando o monólito (`{}`, um
arquivo). O único outro leitor de `pricing-chunks/` é o prefetch da tela de
Sets (`prefetchChunk` em `src/app.js`), que pede o irmão de preço sem olhar a
flag. Ele passa a olhar, senão vira 404.

**F3 — Dados de vintage e JA no catálogo.** O sync grava o nome de exibição
do set no catálogo (chunk e manifest), e o `setDisplayName` lê de lá em vez do
`JA_SET_EN`/`VINTAGE_SET_EN`. Os apelidos em romaji do `JP_NAME_ALIASES` vão
pra carta no sync, como texto de busca. Fica a resolver: a borda (a tabela
`cards` do D1 não tem essas colunas), o prerender (que hoje mostra o nome
original do set) e o `tests/set-display-name.test.mjs`, que trava a regra de
idioma do JA (`neo1` existe no EN e no JA). É a fase que abre espaço de verdade
no `shared.js`.

**F4 — Biblioteca TCGCSV.** Um `scripts/lib/tcgcsv.mjs` com o esqueleto:
grupos, produtos e preços por `fetchJsonRetry`; `setId` pela abreviação, com o
tratamento de repetida e de vazia; variantes em `u`/`uf`; URL de imagem;
`preserveMissingCards`; logo local com skip-if-exists; `writeGameCatalog`. Cada
sync vira configuração mais um `mapCard`. Os jogos migram um a um com **teste
de ouro**: `cards.js` e `pricing.js` iguais byte a byte antes e depois. Onde a
regra nova de `setId` mudaria um id publicado, ela fica desligada pra aquele
jogo.

**F5 — Jogos numa tabela do banco.** Uma `public.jogos(slug)`, com
`card_views.game` apontando pra ela e as duas funções conferindo
`exists (select 1 from public.jogos where slug = p_game)`. A migração de um
jogo novo vira `insert into public.jogos (slug) values ('<slug>') on conflict
do nothing;`: idempotente, sem ordem e sem copiar corpo de função. Precisa ser
testada num PostgreSQL local (como a `20260924a`) e reafirmar os grants e
revokes das funções.

**F6 — Registro único no Node.** Um `scripts/lib/jogos.mjs` (slug, nome,
dataDir, prefixo, família, preço) importado pelos scripts. As Functions leem
de um `functions/_jogos.js`: falta confirmar se o build das Functions importa
de fora de `functions/`, e se não importar, fica uma cópia travada pela F1. No
front, o `DATA_GAMES` passa a derivar do `GAMES` do `game.js` (hoje repete
slug e dataDir), e o `CSV_GAME_NAMES`, o `KIT_LOGO` e os rótulos do prerender
saem do registro.

**F7 — Accent fora do CSS núcleo.** Hoje são 15 pares de blocos (960 B gz) no
CSS que toda página baixa, e cada jogo novo soma mais um (58 B). Há duas opções
pra medir antes de escolher: aplicar as cores do registro pelo `game.js`, que
roda síncrono no `<head>` antes do primeiro paint; ou uma regra genérica que
lê as cores de variáveis.

**F8 — Textos e CI derivados.** A contagem do `index.html` passa a ser
carimbada no build a partir do registro, como o `hash-assets` carimba o id do
build. O Sobre, a FAQ e a tabela do /comparar (textos do `i18n-docs.js`, que
entram por `data-i18n-html`, sem variáveis) ganham marcadores preenchidos
dentro do próprio `t()`, do jeito que o `{game}` já é.
As listas de cache viram glob (`data/*/sets`, com `!data/magic/sets` e
`!data/ygo/sets`), a conferir num run de branch. A guarda do build rápido vira
um laço sobre o registro.

**Resultado esperado.** Depois de todas as fases, um jogo novo passa por uns 10
pontos, todos com trava: o sync (com teste), a entrada no `game.js`, a entrada
no `jogos.mjs`, o rótulo nos 3 idiomas, `MARKETS`, tile e logo no hub, o passo
no `deploy.yml`, um `insert` de migração e a linha do README.

## 7. Como medir

### 7.1 Peso do núcleo (como o CI)

Numa cópia descartável, porque o `split-css --write` reescreve arquivos:

```bash
mkdir -p /tmp/sleevu-medida && git archive HEAD | tar -x -C /tmp/sleevu-medida
cd /tmp/sleevu-medida && node scripts/split-css.mjs --write
npx --yes esbuild --minify --charset=utf8 --outdir=/tmp/ci-min src/*.js
npx --yes esbuild --minify --outfile=/tmp/ci-min/styles.min.css styles.css
node scripts/check-size.mjs /tmp/ci-min
```

O custo de um bloco sai na mesma cópia: esvaziar o bloco (por exemplo
`const JA_SET_EN = {};`, ou tirar as entradas de um jogo), minificar de novo e
subtrair o gzip -9 do resultado (`node -e` com `zlib.gzipSync(buf, { level: 9
})`). Foi assim que saíram os números da 5.4.

### 7.2 Arquivos no deploy

```bash
gh run list --workflow deploy.yml --branch main --limit 1
gh run view <id> --log | grep "Arquivos no deploy"
```

### 7.3 Prefixo de id livre

Na raiz do repositório, trocando `swu` pelo prefixo candidato:

```bash
node -e '
const fs = require("fs"), p = process.argv[1].toLowerCase();
const pk = fs.readdirSync("data/sets").flatMap((l) => fs.readdirSync("data/sets/" + l).map((f) => f.replace(/_?\.json$/, "").toLowerCase()));
const lor = {}; new Function("window", fs.readFileSync("data/lorcana/cards.js", "utf8"))(lor);
const outros = [...fs.readFileSync("src/binders.js", "utf8").matchAll(/\["([a-z0-9-]+)-", "/g)].map((m) => m[1]);
const a = pk.find((s) => (s + "-").startsWith(p + "-"));
const b = lor.TCG_CARDS.find((c) => String(c.id).toLowerCase().startsWith(p + "-"));
console.log(a ? `colide com o set "${a}" do Pokémon` : b ? `colide com o id "${b.id}" do Lorcana` : outros.includes(p) ? "já é prefixo de outro jogo" : "livre");
' swu
```

Exemplos conferidos em 2026-09-30: `swu` e `dc` estão livres; `np`, `sv4a` e
`tk` colidem com sets do Pokémon; `cp` e `dis` colidem com o Lorcana.
