# Sleevu

Colecionador de cartas **multi-TCG**, grátis e local-first: catalogar por variante
e condição, montar decks e binders, acompanhar o valor da coleção no tempo e
sincronizar entre aparelhos — sem plano pago, sem limite de cartas, com export a
qualquer momento.

Online: <https://sleevu.app/>

Este arquivo documenta a **arquitetura** (como o site é feito e como se roda).
O **plano** e as **decisões** ficam no [ROADMAP.md](ROADMAP.md); o backend em
[docs/BACKEND.md](docs/BACKEND.md); os decks em [docs/DECKS.md](docs/DECKS.md); o
portfólio em [docs/PORTFOLIO.md](docs/PORTFOLIO.md); o SQL do Supabase em
[supabase/migrations/README.md](supabase/migrations/README.md).

---

## Como abrir

Local (sem build, sem bundler — é HTML estático + JS global):

```bash
npx http-server -p 4173 .
```

Precisa ser servido via HTTP: o catálogo é carregado por `fetch` e o service
worker não roda em `file://`. Localmente o app usa os catálogos **versionados**
(`data/<jogo>/cards.js`, e uma amostra em `data/cards.js` no caso do Pokémon); o
catálogo completo só existe no build de produção.

---

## Os jogos

O registro central é o `GAMES` em [src/game.js](src/game.js): **15 slugs**, 14 com
catálogo e o JUMP em preparação. Cada jogo tem um `dataDir` próprio — o do Pokémon
é a raiz `data/` por motivo histórico (não movemos nada).

| Slug | Jogo | Fonte do catálogo | Preço |
|---|---|---|---|
| `pokemon` | Pokémon | TCGdex (en, ja, zh-cn, zh-tw, pt) + PokéAPI (tipos/nomes) + TCGCSV (promos EN, sets JP que a TCGdex não tem e sets EN recém-lançados, por pin) + Bulbapedia (enriquece o JA; sets exclusivos do chinês simplificado) + PokemonPriceTracker (graded) | TCGplayer USD **por impressão** (TCGCSV, diário) · Cardmarket EUR (TCGdex) · PPT (graded) · MYP (BR, pendente) |
| `lorcana` | Lorcana | Lorcast | USD/EUR |
| `onepiece` | One Piece | TCGCSV cat. 68 + vintage (Carddass Hyper Battle, OP Card Game 2002, Miracle Battle) | USD (moderno); vintage sem preço |
| `magic` | Magic: The Gathering | Scryfall (catálogo EN; pt-BR é fase 2) | USD/EUR |
| `fab` | Flesh and Blood | TCGCSV cat. 62 | USD |
| `gundam` | Gundam Card Game | TCGCSV cat. 86 | USD |
| `swu` | Star Wars: Unlimited | TCGCSV cat. 79 (FFG; Hyperspace/Showcase = cartas próprias) + logos de set do site oficial (`mirror-swu-set-logos.mjs`) | USD |
| `dbfw` | Dragon Ball Fusion World | TCGCSV cat. 80 (≠ Masters) | USD |
| `ygo` | Yu-Gi-Oh! | TCGCSV cat. 2 (~46k impressões — o maior) | USD |
| `digimon` | Digimon Card Game | TCGCSV cat. 63 | USD |
| `riftbound` | Riftbound | TCGCSV cat. 89 (Riot) | USD |
| `unionarena` | Union Arena | TCGCSV cat. 81 (Bandai; um anime por set) | USD |
| `naruto` | Naruto Card Game | vintage Bandai 2002–2006 (tcg-db + TV Tokyo + cardcheckbox), Data Carddass (Card Battle, Mission, Formation e Cross), Miracle Battle | sem preço |
| `hxh` | Hunter × Hunter | Carddass Hyper Battle 1999–2001 (Hunterpedia) + Miracle Battle | sem preço |
| `dbc` | Dragon Ball Carddass | Carddass Bandai 1988–1997: Hondan carta a carta (80storage), sem imagem por enquanto | sem preço |
| `jump` | JUMP | curadoria versionada em `data/jump/curated/` | — |

**Linhas** (`GAME_LINES` em [src/shared.js](src/shared.js)): um jogo pode ter
sublinhas selecionadas por `?line=` — por exemplo `nrt-ncg` (o NARUTO CARD GAME
novo, com lançamento mundial em 2027, hoje só com a promo da Gen Con 2026),
`op2002`, `nrt-dc`, `hxh-mb`. O escopo é por prefixo de `setId`: sem `?line=` a
página mostra o jogo principal e **exclui** as linhas. Uma linha pode ter vários
prefixos (`prefixes`): a `nrt-dc` junta os quatro títulos do arcade Data Carddass
(`nrt-dc-`, `nrt-nf-`, `nrt-nx-`), um por seção na página de Sets. Linha que vira
seção de outra ganha um apelido em `LINE_ALIASES`, pro `?line=` antigo seguir abrindo.

### Dragon Ball Carddass (`dbc`)

[scripts/sync-dbc-carddass.mjs](scripts/sync-dbc-carddass.mjs), snapshot em
`data/vintage/dbc-carddass.json` (nunca regride; o id fica gravado no snapshot e o
refresh reaproveita o da carta já conhecida). Levantamento de 2026-09-24:

| Série | Partes | Anos | Por parte | No catálogo |
|---|---|---|---|---|
| 本弾 Hondan | 第1弾–第31弾 | nov/1988–1997 | 42 (o 第31弾, 83) | 第1弾–第18弾 (758 cartas, 80storage) |
| Super Battle | 1–20 | 1991–1997 | 44 (o 20, 46) | — |
| Visual Adventure | 1–5, SP, '95, EX | 1991–1995 | 42 | — |
| Super Barcode Wars | 1–4 | 1992–1993 | 42 | — |

- **Cartas**: o 80storage publica a lista de cada parte do Hondan (número, nome
  JP, BP/DP e símbolos do verso), ~1 parte por mês. O sync tenta as 31 e as novas
  entram sozinhas. Nome em inglês pelo dicionário `scripts/data/dbc-names-en.json`;
  sem tradução segura, fica o japonês.
- **Totais e anos** de todas as séries: RetroballZ (uma foto por parte, sem scan
  carta a carta). Série sem lista carta a carta **não gera carta**: a numeração tem
  pegadinhas (dois No.215 no 第6弾, o No.216 escondido no 第7弾, E-1..9 no 第16弾,
  numeração que recomeça no 第17弾) e inventar números criaria ids a trocar depois.
- **Imagens**: nenhuma fonte acessível tem scan por carta (o dragonballcards.com
  tem, mas só serve HTTP). Scan curado entra por `assets/cards/dbc/<id>.webp`.

---

## Como o multi-jogo funciona

O mesmo HTML serve todos os jogos. [src/game.js](src/game.js) roda **síncrono no
`<head>`**, resolve qual é o jogo e injeta os `<script>` do catálogo daquele
`dataDir` (cada página declara o que precisa em `data-catalog="cards,indexes,…"`;
os consumidores esperam `window.SLEEVU.catalogReady`).

Ordem de decisão do jogo:

1. **página neutra** → `hub` (sem jogo, sem catálogo);
2. **`?game=<slug>`** → usa e grava a sessão;
3. **sessão guardada** (`tcg-collector-game-v1`) → último jogo escolhido;
4. **padrão** → `pokemon`.

Páginas **neutras** são as que não pertencem a um jogo só: Início, HUB, Explorar,
Decks, e todas as pessoais (Coleção, Portfólio, Vendas, Binders, Wishlist,
Graded, Hub pessoal, Badges, Backup). Elas leem os 14 jogos de uma vez e filtram
por jogo *dentro* da página — por isso **não** carimbam `?game=` na URL (link
copiado de `/collection` não deve parecer preso ao Pokémon). Nas demais, o jogo
resolvido é carimbado com `replaceState`, senão compartilhar "os sets do Gundam"
entregaria os sets da sessão de quem abre. `/users/<handle>` é exceção: nunca
carimba.

---

## Páginas

Catálogo e navegação: `index` (landing), `hub` (grade de jogos), `sets`,
`detail` (set/artista/Pokémon), `cards`, `explore` (busca global em todos os
jogos), `pokedex`, `artists`, `trainers`. Só no celular (abertas pela tabbar):
`search` (a tela da paleta Ctrl+K como página, sem popup) e `account` (Perfil:
preferências, conta e atalhos — o que era o hambúrguer do header).

### Busca por código de carta

O código como a carta **imprime** ("009/094", "4/102", "OP05-119") acha a carta
em toda busca do site, seja como for que o catálogo guarde o número ("9" +
`setTotal` 94, "009" + 94, "4/102"), sozinho ou junto do nome ("Nymble
009/094", "Charizard #4"). É o padrão de mercado de pesquisa e o que o scanner
lê na borda da carta. Um lugar por camada, todos com a mesma régua (travada em
[tests/card-code.test.mjs](tests/card-code.test.mjs)):

- **cliente** (`matchesCardQuery`, todas as páginas): o haystack da carta leva
  `cardCodeForms` — número e número/total, com e sem zeros à esquerda;
  `cardCode` exibe "009/094" (o total na largura do número zero-preenchido);
- **paleta e scanner** (`cmdkCardsByCode`): fração "número/total" filtra os sets
  pelo `total` do manifest e baixa só esses chunks;
- **borda D1** (`/api/search`): termo numérico casa por **igualdade** nas suas
  escritas (`word IN ('9','009')`), não por prefixo, e o total do set é
  indexado como palavra **extra** (`cardRows`) — o deploy só a insere nas cartas
  que ainda estão na régua antiga (`acrescentar` no d1-delta), sem reescrever
  todas as palavras do catálogo; com fração na busca, o **número** da carta
  ainda é conferido na SQL (a EB03-009 de um set de 94 não entra em "009/094");
- **índice estático** (decks/listas): `numberSearchForms` no número;
- **SEO** (`prerender-catalog`): título, description, h1 e JSON-LD da página de
  carta usam o código impresso e listam as outras escritas
  (`scripts/lib/card-code.mjs`).

### Busca completa (Explorar)

O Explorar mostra **todas** as cartas que casam com a busca, em todos os jogos,
com contagem exata e rolagem até a última — sem baixar o catálogo. Quem
responde é o `/api/search?game=all&full=1` (D1): até 10 mil cartas, as mais
relevantes primeiro, já no formato do chunk e com os preços (própria + base),
num pedido só (`mew` = 9 KB comprimidos; `dragon`, 8,3 mil cartas, ~250 KB).
Acima de 10 mil o Explorar avisa quantas existem e pede pra refinar. As regras
(em [functions/api/_search-sql.js](functions/api/_search-sql.js), travadas em
[tests/collection-api.test.mjs](tests/collection-api.test.mjs) e
[tests/search-api.test.mjs](tests/search-api.test.mjs)):

- **Casamento**: cada palavra da busca é um prefixo de palavra da carta (nome,
  set, número, artista, total do set, `nameEn`); número e termo de **uma letra**
  casam por igualdade ("charizard x" quer a X). A interseção não tem corte por
  palavra abaixo de 50 mil linhas — o corte antigo de 2 mil fazia "blue eyes"
  voltar vazio e "charizard ex" achar metade.
- **Relevância** na borda: `x` = quantas palavras da busca casaram como palavra
  **inteira**; ordem `x`, lançamento mais novo. No cliente, o "Mais relevantes"
  (padrão do Explorar, `searchRelevance`) pontua pelo **nome** — inteira 3,
  começo de palavra 2, meio 1, fora do nome 0 — e desempata pelo valor: "mew"
  traz todas as Mew antes de qualquer Mewtwo. Carta de nome japonês vinda da
  borda (sem `nameEn` na mão) usa o `x`.
- **setTotal**: o D1 não guarda; o Explorar completa pelo manifest de cada jogo
  (`enrichSetTotals`) e o tile volta a "Mewtwo (063/165)".
- **Vazio da borda é a resposta**: "nenhuma carta" na hora, citando o filtro
  de jogo quando há um. Antes o vazio mandava baixar o catálogo inteiro dos 13
  jogos (dezenas de MB) só pra confirmar — um erro de digitação custava o maior
  download do site. Perde-se, de propósito, o pedaço do **meio** de palavra
  ("kachu" achava Pikachu) e os campos que a borda não indexa (raridade,
  variante, idioma). Só a borda **fora do ar** ainda cai no catálogo local.

As facetas da página de set (Raridade, Cor, Tipo, Seleção…) são declaradas **uma
vez por jogo** em `GAME_FACETS` ([src/shared.js](src/shared.js)) e derivadas dos
campos que o sync já grava na carta — então **set novo herda os filtros sem
código novo**. Cada faceta só aparece se as cartas daquele set tiverem o dado, e
uma opção presente em 100% das cartas é descartada (filtro que não filtra nada
é ruído). Vale a mesma regra do card: bloco sem dado não aparece.

Pessoais: `collection`, `portfolio` (visão financeira: patrimônio no tempo, uma
linha por jogo, valor de pastas/binders, vendas realizadas — ver
[docs/PORTFOLIO.md](docs/PORTFOLIO.md)), `wishlist`, `binders`, `sales` (vendas e trocas
organizadas em **pastas de venda** desde 2026-09-27: cada pasta com nome, preço em
lote pela referência e link público próprio, `/users/<handle>/vendas/<slug do nome>`
— o slug sai de `shared.saleFolderSlugs`, o mesmo que o perfil publica),
`pastas` (as antigas Listas, renomeadas em 2026-09-16: pedaços da coleção com
nome, cada um com link compartilhável e export próprios, checklist de set ou
avulsa — ver [docs/LISTAS.md](docs/LISTAS.md); `/listas` redireciona pra cá),
`my-decks` (galeria + editor), `decks`
(galeria pública da comunidade), `dashboard` (hub pessoal), `badges`, `backup`,
`profile`, `settings`, `login`.

Conteúdo/institucional: `about`, `help`, `faq`, `privacy`, `terms`, `novidades`
(renderiza `data/changelog.json`), `admin` (só o dono).

Pré-renderizadas no build: `set/<slug>.html`, `card/<slug>.html` e
`deck/<slug>.html` — HTML estático com título, meta, Open Graph, JSON-LD e a
lista já dentro, pra o Google indexar conteúdo em vez da casca da SPA.

---

## Estrutura

```
src/        app shell (JS global, sem bundler). shared.js é o núcleo (~9,4k linhas):
            stores, i18n, render, preview, busca, imagens, sync, service worker.
            game.js resolve o jogo; theme.js carrega tema e traduções.
data/       catálogos por jogo (data/ = Pokémon; data/<jogo>/ pros demais),
            índices, preços, logos de set espelhados e snapshots vintage.
scripts/    sync de cada fonte + build (merge, split, prerender, hash, lint, D1).
functions/  Cloudflare Pages Functions (API na borda).
supabase/   migrações SQL versionadas + templates de e-mail.
tests/      node:test (sem framework externo).
docs/       BACKEND.md, DECKS.md, LISTAS.md, PORTFOLIO.md e COMMUNITY-PRICES.md.
```

Não há `package.json`: as ferramentas do build (esbuild, wrangler) são chamadas
via `npx --yes` no CI, e o cron do push usa `npm install --no-save web-push@3`.
**Pegadinha ao instalar algo localmente:** sem `package.json`, um `npm install
<pacote>` na raiz PODA o que já estava em `node_modules` — instale sempre com
`--no-save` e reinstale o que sumir.

Ferramentas que rodam à mão (não estão em workflow nenhum):

| Script | Para quê | Pré-requisito |
|---|---|---|
| `scripts/smoke-pages.mjs` | abre 24 páginas em navegador real e acusa erro de console/página vazia | `npm install playwright --no-save` + servidor local |
| `scripts/diff-computed-style.mjs` | confere que o `split-css.mjs` não mudou nenhum estilo computado (antes × depois, em duas portas) | idem |
| `scripts/test-d1-search.mjs` | prova a busca da borda contra um SQLite real | `node scripts/build-d1.mjs` (gera `out/d1-cards.sql`); com o dump desatualizado ele acusa falhas que não são do código |
| `scripts/seo-meta.mjs` | codemod de `<head>` do rebrand — **destrutivo, reescreve todos os HTML** | commit limpo e revisar o diff depois |
| `scripts/build-og-image.mjs` | regera o `og-image.png` (a imagem que aparece quando alguém compartilha um link) a partir do template `scripts/og/og-image.html` | Chrome/Chromium instalado (ou `CHROME_PATH=/caminho/do/chrome`) |

### Imagem de compartilhamento (og-image)

O que o WhatsApp, o X e o Facebook mostram ao colar um link do site é o
`/og-image.png` (1200x630), apontado pelo `og:image`/`twitter:image` das 22
páginas e pelo `scripts/seo-meta.mjs`. Três exceções sobrescrevem essa imagem
genérica: as páginas de set pré-renderizadas usam o logo do set
(`prerender-catalog.mjs`), a `detail` na borda usa a arte da carta
(`functions/detail.js`) e o perfil público usa a carta mais valiosa — no
perfil (`functions/users/[handle].js`) e no link de cada pasta de venda
(`functions/users/[handle]/vendas/[pasta].js`, que também troca título e
descrição pelos da pasta). As duas rotas de `/users/` dividem a consulta do
perfil em `functions/users/_perfil.js`.

O PNG é **gerado**, não desenhado à mão: o conteúdo mora no
`scripts/og/og-image.html` (HTML+CSS comum, com a Outfit e a paleta do site) e
o `build-og-image.mjs` fotografa isso num Chrome headless. Mudar a chamada é
editar texto e rodar o script — antes disso era um bitmap solto no repo, sem
fonte, e por isso a arte ficou anos anunciando "Pokémon · Lorcana · One Piece ·
Naruto" enquanto o site já tinha 13 jogos.

Fora do CI de propósito: comparar bytes de renderização entre versões do
Chromium daria falso positivo em todo bump. O PNG é versionado; regere e
commite quando mudar.

**Depois de trocar a arte:** as redes guardam a prévia pela URL DA PÁGINA, não
pela da imagem — renomear o PNG não adianta. Force o re-scrape no
[Sharing Debugger](https://developers.facebook.com/tools/debug/) do Facebook e
no [Card Validator](https://cards-dev.twitter.com/validator) do X; o WhatsApp
solta sozinho em algumas semanas.

### Kit para parceiros (PDF)

O material que vai pra loja, anunciante e investidor sai do `/admin` › Visão
geral › Para parceiros: um documento A4 de 4 páginas (capa com o wordmark e o
que é o Sleevu, público, intenção de compra, como trabalhar junto, metodologia
e contato), com os números do período escolhido. A aba mostra a prévia fiel e
o botão abre a impressão ("Salvar como PDF"). Tudo em `src/admin.js`
(`tabParceiros`) e na seção `.adm-kit` do `styles.css`:

- **Paleta fixa**: o `.adm-kit` redefine as variáveis do tema, então o PDF sai
  igual em qualquer tema; `print-color-adjust: exact` é o que faz fundo e
  barra saírem no papel.
- **Página**: o `@page { size: A4; margin: 0 }` é injetado pelo `admin.js` só
  enquanto a aba está aberta (no `styles.css` valeria pra impressão de
  qualquer página). Sem margem, o navegador também não carimba título e URL
  do painel no papel; o nome sugerido do arquivo vem do `<title>`, trocado na
  hora de imprimir.
- **Números do catálogo** (`KIT_CATALOGO`): os mesmos da `.lp-stats` da home e
  do og-image — o `tests/admin-charts.test.mjs` cobra os três.

---

## Dados: modo local × modo manifest

- **Local (`MANIFEST = false`)**: as páginas carregam os `cards.js`/`indexes.js`
  versionados do jogo. Funciona sem rede e é o que se vê ao rodar o http-server.
- **Produção (`MANIFEST = true`)**: o deploy flipa a flag por `sed` e as páginas
  passam a usar os `*.generated.js` mesclados + **chunks por set**
  (`data/<jogo>/sets/<setId>.json`), baixados sob demanda com concorrência
  limitada. A página de detalhe baixa só os sets das cartas exibidas; a Pokédex
  não baixa carta nenhuma (roda só com os índices + a coleção do `localStorage`).

Também são fatiados no build, pela mesma lógica de "não baixe o que não usa":
os índices (`indexes-sets.json`, `indexes-pokedex.json`, …), os preços por set
(`split-pricing.mjs`, flag `pc` no manifest), as traduções por idioma
(`split-i18n.mjs`) e o CSS por área (`split-css.mjs`). A tabela de áreas
(prefixo de classe → páginas que recebem a folha) mora em
`scripts/lib/css-areas.mjs`, e o `check.mjs` barra a página que desenha uma
classe de área sem estar na lista dela — em produção ela chegaria sem estilo.

**Durabilidade**: o catálogo validado é versionado de volta no repo pelo próprio
build (commit `[skip ci]`), e o sync faz união preservadora — carta que some da
API é mantida. API morta = catálogo congela, nenhum item de portfólio some.

---

## Sincronizar catálogos

Pra adicionar carta, set, linha ou jogo, o passo a passo e os contratos estão
em [docs/CATALOGO.md](docs/CATALOGO.md).

Cada jogo tem seu script e roda sozinho:

```bash
node scripts/sync-tcgdex.mjs pt          # Pokémon (idioma por vez)
node scripts/sync-lorcana.mjs            # Lorcast
node scripts/sync-onepiece.mjs           # TCGCSV
node scripts/sync-magic.mjs              # Scryfall
node scripts/sync-ygo.mjs                # TCGCSV (o maior)
```

O `sync-tcgdex.mjs` aceita `--sets base1`, `--force`, `--concurrency N` e
`--include-digital` (o Pokémon TCG Pocket, digital, é excluído por padrão).
Todos guardam cache em `data/.cache/` e refazem tentativas com backoff — se a
execução for interrompida, rodar de novo só busca o que falta.

Depois do sync do Pokémon, o `merge-catalogs.mjs` funde os cinco idiomas num
catálogo só (ids com sufixo de idioma, espécies canonizadas pelo `dexId`).

### Preço do Pokémon: por impressão, de três fontes

A tabela `data/pricing.generated.js` guarda, por carta, `{ u, e, v?, b?, g? }`:
`u` = USD da impressão principal, `e` = EUR do Cardmarket, **`v` = USD de cada
impressão** (`Normal`, `Holo`, `Reverse`, `1st Edition`), `b` = BR (MYP), `g` =
graded PSA (PPT). O cliente (`cardValue`) e o manifest (`setValueBuckets`)
escolhem a impressão da variante do tile em `v` e caem em `u` — a régua vive em
[scripts/lib/pricing.mjs](scripts/lib/pricing.mjs) e é espelhada no `shared.js`
(teste cruzado em `tests/pricing-variants.test.mjs`). Entre a entrada da carta
localizada (-pt/-ja) e a da carta base vale a de melhor fonte (BR > USD > EUR),
pra mesma impressão não mostrar dois valores conforme a bandeira.

**Quem manda em quê (decisão de 19/09/2026).** A pergunta volta sempre que a
TCGCSV chega na frente num lançamento, então fica escrita: a **TCGdex é o
CATÁLOGO** (o que a carta é) e a **TCGCSV é o PREÇO** (quanto ela vale), e o
inglês NÃO sai da TCGdex. O motivo é medível — a TCGCSV espelha o TCGplayer,
que não publica artista, tipo, estágio nem texto de carta:

| idioma | cartas | só-TCGCSV | com artista | com tipo |
|---|---|---|---|---|
| EN | 21.751 | 0,5% | **95,6%** | 84,3% |
| JA | 21.662 | **48,7%** | **48,8%** | 47,5% |
| PT | 14.339 | 0,2% | 96,6% | 84,1% |

O japonês é o experimento que já rodou: onde a TCGCSV domina, **metade do
catálogo fica sem artista e sem tipo** — e é disso que vivem a página de
Artistas, os filtros por tipo e a Pokédex. Trocar o EN pela TCGCSV faria o EN
virar o JA. Some-se que o TCGplayer só vende EN e JP (sem TCGdex, PT e ZH
deixam de existir), que a carta PT sem arte herda a imagem da EN pelo mesmo id
base (`30th-001-pt` → `30th-001`) e que o de-para do pokemontcg.io é indexado
por id da TCGdex. A vantagem da TCGCSV num lançamento é de **1 a 2 dias** (o
30th Celebration saiu 16/09 e a TCGdex publicou em 17–18/09) — e essa janela é
coberta pelo import automático abaixo, sem custar o resto.

As fontes, da pior pra melhor (a última a escrever vence no merge):

1. **TCGdex** — vem embutida no card (`compactTcgdexPrice`); pra muita carta EN é
   só o piso do Cardmarket, promos vêm sem preço, e o cache por set segura até 7 dias.
2. **PPT** (`sync-ppt.mjs`) — por crédito, 3x/semana, com teto de tempo; hoje
   vale pelo **graded** (`g`) e pelo que a TCGCSV não cobrir.
3. **TCGCSV** (`sync-tcgcsv-pokemon.mjs`) — TCGplayer por `subTypeName`, grátis,
   **todo dia**, EN e JP. Casa set ↔ grupo pelo nome normalizado (+ pins em
   `data/tcgcsv-set-map.json`, que aceitam groupId **ou o nome do grupo**) e
   **confirma pelo conteúdo** (metade dos números batem, senão o set fica com a
   TCGdex). Número que não bate ainda tenta pelo **nome das cartas**
   (`matchGroupByName`): é o que salva a **Classic Collection**, que a TCGdex
   numera em sequência (001–030) e o TCGplayer pelo número original da carta
   reimpressa ("Blastoise - 2/102"). Só casa nome inequívoco e **nunca**
   sintetiza carta — o número de lá não serve de id. Em JP o código do grupo ("SV4a: …",
   "S-P Promotional Cards") é o `setId`; código sem chunk nosso = set que a TCGdex
   não tem e é **importado inteiro** (ids `<CODE>-<número impresso>-ja`, como a
   TCGdex escreve, pinados pelo chunk versionado, série pelo prefixo do código);
   código repetido em vários grupos sem chunk ("SV: …" nos decks iniciais) é
   ambíguo e fica de fora até ganhar apelido por nome de grupo em `ja.alias`. Em EN, set inteiro só entra por
   **pin** (`enImport` no mesmo JSON): o TCGplayer cria o grupo na pré-venda e
   lista os singles no lançamento, e a TCGdex leva dias — foi assim que o
   "30th Celebration" (16/09/2026) chegou no dia, como no Collectr e no Dex,
   que montam o catálogo em cima do grupo do TCGplayer. O pin escolhe o `setId`
   — uma APOSTA no id que a TCGdex vai usar, pra as cartas casarem em vez de
   duplicar (quando a aposta erra, ver "Aposentadoria" abaixo) —, nome, série
   e data; ids levam o número como impresso (`cel30-001`, convenção SV/ME) e o
   mesmo numerador com denominadores diferentes (Classic Collection: "2/102" e
   "2/132") vira duas cartas. Desde 19/09/2026 o pin é só a exceção: grupo EN de
   era moderna ("ME: …", "SV##: …"), publicado nos últimos **90 dias**, sem set
   nosso e com pelo menos **20 singles numerados** entra SOZINHO, com setId
   provisório tirado do nome ("ME: Delta Reign" → `delta-reign`). O que segura
   a mão é a aposentadoria automática (abaixo): quando a TCGdex publicar com o
   id dela, o provisório morre e a conta de quem marcou migra. A janela de 90
   dias é o que impede o primeiro build de importar a lista histórica inteira.
   O que não for elegível continua saindo no log como candidato a pin. Roda com
   `--dry-run`, `--en`/`--ja`, `--set a,b`, `--no-import`, `--no-auto`.

**Aposentadoria do set importado.** A aposta do `setId` do pin ERRA: o "30th
Celebration" entrou em 16/09/2026 como `cel30`/`cel30cc` (modelados no
`cel25`/`cel25cc` de 2021) e dois dias depois a TCGdex publicou o mesmo par
como `30th`/`30th-c`. A única guarda do pin era o id EXATO, então os chunks
dela nasceram AO LADO dos nossos — 4 coleções de 30 anos na tela de Sets onde
existem 2. Quem resolve é o `retire-imported-sets.mjs`, em todo build, depois do
`sync-tcgdex` e antes da TCGCSV e do merge:

- **Quem é duplicata**: chunk de set importado que tem um irmão da TCGdex com
  metade dos nomes de carta EM MÃO DUPLA (metade dos nomes de A em B *e* dos de
  B em A — ver `lib/set-supersede.mjs`). A mão dupla é o que impede uma Classic
  Collection de casar com o set original que ela reimprime. Nome de set e data
  não entram na conta: a TCGdex escreve "30th Classic Collection" e o TCGplayer
  "ME: 30th Celebration Classic Collection". Empate entre dois candidatos vira
  aviso no log, nunca exclusão.
- **Quem vence**: sempre a TCGdex. O id dela é o canônico (as edições PT/ZH
  nascem com ele, o de-para do pokemontcg.io é indexado por ele) e o dado é
  melhor (artista, tipo, estágio).
- **Ninguém perde carta**: o de-para de `cardId` vai pro
  `data/card-id-merges.json` (VERSIONADO — o chunk velho some nesta rodada e
  nenhum build futuro recalcularia o par) e é carimbado no `src/shared.js`
  (marcador `SLEEVU_ID_MERGES`, como o `apply-img-mirror`). O app migra a
  coleção, wishlist, decks, binders, custos e preço-alvo de cada navegador uma
  vez, e reescreve também o blob que vem da nuvem de um aparelho ainda não
  migrado. Troca de prefixo (`cel30-001` -> `30th-001`) é uma linha; numeração
  diferente (a Classic Collection é sequencial na TCGdex e pelo número original
  no TCGplayer) é par a par. O `lint-catalog` conhece o arquivo: id que sumiu
  mas tem destino vivo não é perda, é aposentadoria.
- **O set não fica em branco**: a TCGdex publica antes da arte de parte das
  cartas (o "30th Classic Collection" chegou com as 30 sem imagem), então a
  imagem que só o chunk aposentado tinha viaja no mesmo arquivo e o
  `merge-catalogs` a carimba em todo build, só onde a imagem está VAZIA — se
  apaga sozinha quando a TCGdex publicar a dela.
- **Carta sem par nunca some** (20/09/2026): o de-para tenta pelo nome e, quando
  a numeração se preservou entre as fontes, pelo **número** (nome que a régua
  não previu, "Team Rocket's Mewtwo ex" × "Mewtwo ex"). O que ainda sobrar fica
  **congelado** no chunk aposentado, cada carta com `retired: <setId novo>`: o
  merge marca a entrada do manifest, a tela de Sets, a contagem, o detalhe e o
  pré-render a escondem, e o id segue resolvendo na coleção, no popup e na
  busca. Antes a carta ia pro log como "id perdido" e sumia da conta — e o lint
  travava o deploy até alguém aceitar a perda à mão.
- **O carimbo viaja com o snapshot**: o `retire-imported-sets` injeta o de-para
  no `src/shared.js` (`SLEEVU_ID_MERGES`) e o passo "Versiona snapshot" commita
  o arquivo junto com `data/` — antes só o JSON voltava pro repo e o
  `tests/id-merges.test.mjs` quebrava o CI no push seguinte. O link
  `?card=<id velho>` também é reescrito pro novo antes de a página olhar a URL,
  como o link de set já era.

**Guarda do add-on-miss.** Carta que a fonte de preço tem e a TCGdex não só entra
no set se o número segue o **padrão de numeração** do chunk (`missAllowed`):
promo JP "227/S-P" que o TCGplayer lista dentro do "SWSH Promo" não vira mais
`swshp-227` com bandeira dos EUA. A guarda vale no sync e no merge (o artefato
pode vir do cache). O `report-price-coverage.mjs` imprime no deploy a cobertura
por idioma, as cartas sintetizadas e toda cotação acima de US$ 5.000.

Sets JAPONESES não têm logo na TCGdex — o payload de `/v2/ja/sets/<id>` vem sem
o campo e o CDN dá 404. O `mirror-ja-set-logos.mjs` traz esses logos do
Bulbagarden Archives (de-para de arquivo CURADO dentro do script), guarda em
`data/set-logos/ja/` e carimba o `setLogo` dos chunks. O carimbo roda em todo
build (`--no-fetch`, sem rede); baixar logo novo é passo local. O nome do set em
inglês é assunto separado, do `JA_SET_EN` no `shared.js`.

Utilitários: `lint-catalog.mjs` (falha em corrupção dura — ids duplicados,
catálogo zerado), `report-catalog-coverage.mjs` (cobertura por idioma e era,
informativo), `enrich-ja.mjs` + `sync-bulbapedia-ja.mjs` (v2 japonês, ver
"v2 — japonês"), `mirror-*-set-logos.mjs` (espelha logos de set localmente), `mirror-r2.mjs` (espelha as imagens de carta no R2, ver docs/BACKEND.md),
`build-set-id-map.mjs` (de-para TCGdex→pokemontcg.io pras imagens EN que faltam),
`sync-price-history.mjs` (histórico de preços sem servidor: lê o acervo — R2,
produção e cache do runner, fica a cópia mais adiantada —, anexa o snapshot de
hoje, republica e grava a cópia durável no R2; emite também os deltas, os
"maiores altas e quedas" e o **índice de mercado** de cada jogo, que é o
benchmark do gráfico do Portfólio; o acervo segue o de-para de id do
`card-id-merges.json`, então carta aposentada não perde a série).

---

## Modelo de carregamento do Pokémon EN — v1

Fixado em 20/09/2026 como a **v1**: é a régua contra a qual os outros idiomas
(JA, PT, ZH) vão ser trazidos, e não se reabre sem motivo medido. Um jogo
inteiro, ponta a ponta, em cinco camadas:

| camada | quem manda | onde vive | cadência |
|---|---|---|---|
| **catálogo** (o que a carta é) | TCGdex, e o inglês NÃO sai dela | `data/sets/en/*.json`, versionado a cada build | diário 06:20 UTC + sexta 21:00 |
| **lançamento** (1–2 dias antes da TCGdex) | TCGCSV, por pin `enImport` ou janela automática (era moderna, 90 dias, 20+ singles) | chunk provisório, aposentado quando a TCGdex publica | mesma rodada |
| **preço** (quanto vale, por impressão) | TCGCSV > PPT > TCGdex; BR (MYP) por cima quando existir | `pricing.generated.js`, fatiado por set no build | diário; PPT/MYP 3×/semana |
| **histórico** (o que não se compra depois) | `sync-price-history`: diário 60d, semanal 1 ano, mensal depois | acervo no **R2** (`_history/`), cópia estática em produção, cache do runner | 1 ponto por dia |
| **imagem** | TCGdex; pokemontcg.io onde ela não tem scan | espelho no R2 (`img.sleevu.app`) pros hosts completos, origem atrás na cadeia | job diário 14:00 UTC |

O **id é o contrato**: `<setId TCGdex>-<número impresso>` em EN, com sufixo de
idioma nos demais. Coleção, wishlist, decks, binders, custos, histórico de
preço, D1 e páginas pré-renderizadas são indexados por ele. Por isso as
garantias de durabilidade são todas sobre o id:

1. **Carta indexada nunca some.** `preserveMissingCards` no sync (API removeu =
   congela), chunk versionado no git, lint que **falha o deploy** se um id
   publicado sumir ou passar a apontar pra outra carta.
2. **Id que muda tem de-para.** `data/card-id-merges.json` (append-only,
   versionado) + carimbo no `shared.js` commitado junto: localStorage migra uma
   vez por navegador, o blob do Supabase é reescrito no pull, o histórico de
   preço muda de chave, e os links `?setId=`/`?card=` velhos são reescritos.
   Carta sem par fica **congelada** no chunk (`retired`), fora da lista de sets
   e viva na conta.
3. **Fonte fora do ar congela, não esvazia.** TCGdex caiu = catálogo do build
   anterior; TCGCSV caiu = preço do artefato anterior (cache do Actions);
   produção fora do ar no build = acervo do R2; espelho fora do ar no build =
   site aponta pras CDNs de origem.
4. **O que é nosso está no nosso servidor.** Chunks, logos e de-paras no git;
   imagens de carta e acervo de preço no R2; catálogo e preço do dia no D1
   como projeção. O que segue remoto é só o que não vale copiar: a PokéAPI da
   Pokédex e o fallback da pokemontcg.io das cartas que a TCGdex já tem.

O que a v1 **não** cobre, de propósito (fica pro próximo passo do inglês):
texto da carta (HP, ataques, habilidade — o sync descarta), Shadowless e
Unlimited como impressões, e a cobertura de preço só aparece no log do deploy
(`report-price-coverage.mjs`), não num teste.

### v2 — japonês

A mesma régua aplicada ao catálogo `ja` (20/09/2026). O que muda em relação ao
inglês é a **fonte**: a TCGdex só tem ~116 dos 246 sets japoneses, e os outros
150 entram inteiros pela TCGCSV, que não publica artista, categoria, tipo,
estágio, nome japonês nem série. Medido antes da v2: artista 49%, categoria
59%, série em 86% dos sets, nome em inglês 0% nos sets da TCGdex, e 34 sets
caindo em "Outros". Três fontes fecham o buraco, nesta precedência e SÓ em
campo vazio (`scripts/enrich-ja.mjs`, todo build completo, sem rede, depois
dos dois syncs e antes do merge; regra pura em `scripts/lib/enrich-ja.mjs`):

1. **Série pelo código do set** (`jpSerieOfCode`): a tabela cobre todas as
   eras — onde a TCGdex tem nome canônico (PMCG, neo, e, PCG, XY, SM, S, SV,
   M) é o dela; nas que ela não tem (ADV, DP, DPt, Pt, LEGEND, BW) o id é o
   código da era. Decks e promos sem código de era (Battle Strength Decks,
   PLAY, PPP, Worlds) são datados à mão na mesma tabela.
2. **Bulbapedia** (`data/ja-enrich/<setId>.json`, cache versionado): nome
   japonês, nome inglês, tipo, raridade, ilustrador e scan do Archives,
   casados pelo **número** impresso. O download é passo LOCAL
   (`scripts/sync-bulbapedia-ja.mjs`: API do MediaWiki, uma requisição por
   segundo, resumível, `--probe` pra conferir o parser); o CI só aplica o
   cache. Texto vai pro git; imagem vai pro R2 pelo `mirror-r2` (host
   `archives.bulbagarden.net` nas `FONTES`). O cliente nunca toca o wiki.
   Crédito na página Sobre (CC BY-NC-SA).
3. **Irmão inglês**: a carta importada tem o nome em inglês do TCGplayer, que
   é o nome da carta EN. Quando todos os homônimos EN concordam, herda
   categoria, tipo, estágio, tipo de treinador e de energia. Artista nunca —
   a arte japonesa pode ser outra.

`nameEn` é o campo novo: o nome em inglês de toda carta japonesa (o `name`
delas é o japonês). Entra na busca do cliente, nas palavras extras do D1 e no
popup ("Nome em inglês"). Resultado só com os itens 1 e 3 (sem cache da
Bulbapedia ainda): categoria 59% → 99%, série 86% → 99% dos sets, 9.287
cartas com nome em inglês pesquisável.

A régua é o `scripts/report-catalog-coverage.mjs` (CI e deploy, informativo):
por idioma e, no japonês, por era — imagem, artista, categoria, raridade,
nome em inglês, série, logo e quantos sets são só-TCGCSV.

Fica de fora da v2 até a primeira rodada local da Bulbapedia: nome japonês e
ilustrador dos importados, raridade dos 61 sets sem ela, scans dos 31 sets sem
nenhuma imagem (1996–2006 e os SM*p), logos (41 de 246 curados em
`mirror-ja-set-logos.mjs`) e nomes traduzidos (72 de 246 em `JA_SET_EN`; o
`--names` do sync emite `_set-names.json` pra copiar de lá). Os decks
iniciais com código ambíguo ("SV: …", "sA: …") seguem fora até ganhar apelido
em `ja.alias` — o log do sync da TCGCSV lista quais.

### v3 — chinês simplificado

A linha exclusiva da **China continental** (27/09/2026): Gem Pack, Collection
151, Storming Emergence, Terastal Gathering, os subsets, decks, caixas e as
promos SM-P/S-P/SV-P/30th-P/M-P — é o chinês mais comercializado, e nenhuma
fonte com API tinha as cartas. A TCGdex lista 57 desses sets em zh-cn, todos
com **zero** cartas (o sync-tcgdex pula set vazio); a TCGCSV não tem categoria
chinesa (o TCGplayer só vende EN e JP). A fonte é a **Bulbapedia**, na mesma
régua do japonês: ingestão LOCAL, cache versionado, build sem rede.

1. **`scripts/sync-bulbapedia-zh.mjs`** (LOCAL, ~11 min, API do MediaWiki com
   50 páginas por requisição): lê o `Template:Simplified Chinese Releases`, o
   wikitext de cada página de set e o de cada página de carta, e grava
   `data/zh-import/<setId>.json` (uma carta por linha). O **código do set**
   sai do símbolo de cada lista (`SetSymbolCSM1a.png` → `CSM1aC`, o id que a
   TCGdex usa; `CS15` → `CS1.5C`), com `CODIGOS_FIXOS` pras listas sem
   símbolo. Resultado da 1ª rodada: 115 sets, 12,2 mil cartas.
2. **`scripts/import-zh.mjs`** (build, sem rede, depois do `enrich-ja` e antes
   do merge): monta as cartas e grava `data/zh-newcards.generated.json`, que o
   merge injeta como as da TCGCSV (`prov: "bulbapedia"`, id
   `<código>-<número>-zh-cn`). Set que a TCGdex já publica com cartas fica
   de fora inteiro (hoje só o `CSMPiC`).
3. **Imagem**: a página de uma carta chinesa na Bulbapedia é quase sempre um
   redirect pra impressão ocidental/japonesa, e o scan de lá é o inglês. Em vez
   de guardar esse scan do Archives — que o CSP não libera, o wsrv.nl leva 403
   e o espelho R2 só serve host completo (10 mil URLs novas derrubariam os
   scans japoneses até o espelho alcançar) —, o cache guarda as **impressões**
   da página (set, raridade, número, EN e JP) e o build escolhe a da carta
   chinesa pela raridade (`escolherImpressao`: raridade japonesa igual;
   senão, pra raridade regular ou vazia, a primeira impressão regular; senão
   nada). A imagem é a que essa impressão **já tem no nosso catálogo** (EN
   primeiro, JA depois) — mesma regra do fallback da edição PT: arte igual,
   texto em outra língua. Medido na 1ª rodada: imagem em 81% das cartas
   (9,7 mil pela EN, 120 pela JA); a amostra conferida bateu SAR→SIR,
   SR→Ultra Rare, HR→Rainbow, UR→Hyper/Secret, S→Shiny, K→Radiant.

**Tela de Sets**: das 114 edições, 27 são as expansões de booster (18
principais — contando Radiant/Verdant/Abundant e afins como sets separados,
porque cada versão tem código e lista próprios — e 9 subsets ".5"). Os 55
decks, kits e caixas (`tipoDoSet` pelo título da página: starter deck, Battle
Party, Happy Set, Master Strategy, Start Deck 100, "Gift Box") levam
`setKind: "deck"`, que o manifest carrega como `kind`; a lista por série não
os mostra e eles vão pra seção **Decks e caixas** no fim
(`sets.category.decksBoxes`). Expansões, subsets, Gem Pack, 151, pacotes
especiais e promos ficam nas séries.

**Carta já gravada é atualizada**: o merge troca a carta `prov: "bulbapedia"`
que já está no chunk pela versão do artefato de hoje (nunca uma carta
oficial). Sem isso, o 1º build congelava a carta e nenhuma melhoria do cache
chegava nela.

Nome da carta e do set em **inglês** (os da Bulbapedia, como o TCG Collector
mostra); série com o id/nome da TCGdex (`SM`/`太阳&月亮`, `S`/`剑&盾`,
`SV`/`朱&紫`). O Collection 151 é **um** set (`151C`): o código impresso é o
mesmo nas quatro versões (Journey/Hope/Surprise/Gathering), que só mudam a
chance dos padrões.

Fica de fora: **scan chinês** (os Gem Packs e parte dos sets novos não têm
página de carta no wiki e ficam sem imagem; o Archives tem scans chineses
esparsos, listáveis só da rede local), nome em chinês (a 52poke tem, mesma
licença), variantes espelhada/Poké Ball/Master Ball (C/U saem Normal, o resto
Holo) e **preço** — nenhuma fonte grátis cota esses sets (o PriceCharting tem
os Gem Packs, mas só com licença comercial).

---

## Dados do usuário

Ficam no `localStorage`, **namespaced por jogo** (`tcg-collector-<jogo>-…`) ou
globais quando o dado é cross-game:

| Por jogo | Global |
|---|---|
| `collection-v3`, `collection-meta-v1` | `binders-all-v1`, `decks-all-v1`, `lists-all-v1` |
| `wishlist-v1`, `wishlist-meta-v1` | `collection-folders-v1`, `collection-tags-v1` |
| `prices-v1`, `history-v2` | `collection-sales-v1`, `collection-sold-v1`, `collection-costs-v1` |
| | `collection-graded-v1`, `wishlist-targets-v1`, `favorites-v1`, `favorites-meta-v1` |
| | `dex-owned-v1`, `dex-owned-meta-v1` (Pokédex "já tenho", por dexId) |

Fotos dos binders ficam no **IndexedDB** (WebP comprimido, com teto) e nunca
sobem a servidor — nem para a nuvem, nem para o perfil público.

Export/import em JSON e CSV pela página `backup.html`, incluindo importação de
CSV do TCGplayer/Collectr com prévia. A importação do JSON valida o arquivo
inteiro antes de gravar (versão, estrutura, tipos), mostra um resumo e mescla
por padrão (carta do arquivo vence a mesma carta local; o que só existe aqui
fica) ou substitui, se pedido; ids que o catálogo não conhece são preservados.
Antes de gravar guarda uma cópia do estado anterior
(`tcg-collector-pre-import-v1`) — "Desfazer a última importação" na mesma
página —, e a gravação é tudo-ou-nada (`validateBackupPayload` /
`planBackupImport` / `applyBackupImport` no shared.js). Tudo isso sincroniza entre aparelhos (ver
[docs/BACKEND.md](docs/BACKEND.md)). As páginas pessoais **exigem login** desde
2026-07-14 (`enforceLoginGate` no shared.js) — o dado continua vivendo no
aparelho (local-first), mas o cadastro não existe mais "sem conta". Aberto sem
login: catálogo, busca, sets, decks públicos, perfis (`/users/<handle>`) e os
links compartilhados (`?s=`).

---

## Idiomas

Dois eixos independentes:

- **Idioma do site**: português, inglês e espanhol. Chave nova exige os três — o
  `check.mjs` quebra o CI se faltar. As páginas de conteúdo (Sobre/Ajuda/FAQ/
  Privacidade/Termos) usam o `i18n-docs.js`, carregado só por elas.
- **Idioma das cartas** (`tcg-collector-card-lang-v1`): Todas / PT / EN / JA /
  ZH. É o eixo das listas e do progresso, e faz as páginas baixarem só os chunks
  daquele idioma. **"ZH" é um chinês único**: cobre zh-cn (simplificado, o
  padrão) com o zh-tw (tradicional) fundido dentro.

Moeda: BRL (padrão), USD e EUR, com câmbio do dia da AwesomeAPI.

---

## Deploy

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) publica no
Cloudflare Pages (`main` = produção, outras branches = preview). O agendamento é
**diário às 06:20 UTC** (03:20 de Brasília), mais um extra na sexta 21:00 UTC —
dia de lançamento de set do Pokémon, pra pegar o set novo sem esperar a manhã
seguinte. As fontes têm custos diferentes:

- **grátis** (TCGdex, TCGCSV — inclusive o preço por impressão do Pokémon EN/JP —,
  Scryfall, Lorcast e os vintage): **todo dia**. Cobrem os 14 jogos e não custam nada.
- **por crédito** (PPT e MYP): 3x/semana — segunda e quarta pelo cron diário,
  sexta pelo da noite. Cabem na cota diária (o plano da PPT dá 20.000 créditos
  por dia e um run gasta no máximo 8.000); a PPT hoje responde pelo graded.

O cron do GitHub é **best-effort**: atrasos de algumas horas são normais, então
06:20 é alvo, não garantia.

**Push é só build**: reaproveita os artefatos do último build completo (cache do
Actions), porque sincronizar uma dúzia de APIs custa ~10 min e não faz sentido a
cada push de CSS. Uma guarda confere as peças essenciais e cai pro build completo
se o cache expirou. O que roda **sempre**: lint, prerender, fatias de índice,
metadados do manifest, chunks de preço, split de i18n/CSS, minificação (esbuild),
hash do app shell e deploy.

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PPT_API_TOKEN`,
`MYP_API_TOKEN`, `PUSH_SENDER_KEY`, `VAPID_PRIVATE_KEY`. Todos os passos que
dependem de secret são no-op sem ele — o build sai igual, só sem aquela fonte.

Outros workflows: `ci.yml` (portão rápido em todo push/PR — testes, smoke de
i18n e ordem de scripts, guardas de mobile, sintaxe dos scripts, minificação
compila), `healthcheck.yml`, `uptime.yml` (probe de 30 em 30 min) e
`push-wishlist.yml` (notificação de queda de preço, segunda 09:00 UTC).

---

## PWA e resiliência

O service worker ([sw.js](sw.js)) trata imagens como **cache-first** (imutáveis
por URL; sobrevivem a um outage do CDN da TCGdex, que é comunitário), os assets
com hash como **cache-first** (a URL é a versão) e o catálogo como
**stale-while-revalidate**. Depois da primeira visita o app abre offline e a
coleção já vista funciona sem internet.

As **páginas** (navegação) têm noção de versão. No deploy, o
`scripts/hash-assets.mjs` calcula um id do build a partir do JS, do CSS **e do
HTML** do shell, põe esse id no nome do cache do SW e o carimba em
`<meta name="sleevu-build">` de toda página. Com isso:

- dentro de uma sessão ativa (navegação nos últimos 10 min) a página vem do
  cache na hora e a rede atualiza por trás; na primeira navegação depois de
  um tempo parado, a rede vem **primeiro** (com teto de 2,5 s, senão a cópia
  local) — é quase sempre a primeira abertura do dia, quando pode haver
  versão nova;
- se o HTML que chega da rede é de outro build, o SW **confere** antes de
  entregar: pede de novo direto ao servidor (`cache: "reload"`), porque numa
  navegação de histórico (voltar, avançar, o PWA restaurado pelo sistema) o
  navegador devolve a cópia que guardou daquela URL sem revalidar — de uma
  leva cujos arquivos já não existem. Se a conferida ainda for de outro
  build, é deploy novo de verdade: o SW a entrega, não a guarda no cache dele
  e pede a própria atualização na hora; quando o SW novo assume, a página
  aberta compara o build dela com o dele e **recarrega sozinha** se for outro
  (espera se alguém está digitando ou há modal aberto, com o aviso na tela
  até poder);
- recarregar, ou tocar num link pra própria tela, vai à rede primeiro mesmo
  dentro da sessão ativa;
- cada página tem **uma** entrada no cache (`/portfolio`, `/portfolio?x` e
  `/portfolio.html` são a mesma), e ao ativar o SW novo apaga todo cache que
  não é da leva dele;
- o install só assume o comando com **todos** os arquivos com hash no cache
  (um que falhe, mesmo depois de uma 2ª tentativa, derruba a instalação e o
  SW atual segue); HTML, fonte e ícone continuam opcionais.

Era isso que faltava quando o Portfólio abria numa versão antiga e quebrada
antes da nova, e quando um set "não abria" no PWA do iPhone (2026-09-29): a
página velha pedia arquivos com hash que já não existiam — sem o `boot.js`
nada roda, e a tela ficava em "Carregando", sem menu nem barra de baixo.

**Saída de emergência.** Toda página do app traz um cartão escondido
(`.falha-boot`) com "Tentar de novo" e "Ir para o início". Quem o mostra é o
CSS, porque o que falhou é o JS: na hora quando o `boot.js` não rodou (o
`<html>` fica sem `data-game`) e depois de 15 s quando o `shared.js` não montou
a navegação (sem `data-app`). Numa carga normal ele nunca aparece.

Imagens EN do Pokémon têm cadeia de fallback: `low.webp` → `high.png` (TCGdex) →
`images.pokemontcg.io`. Cartas sem imagem em nenhuma fonte vão pro fim da lista
pra não furar o layout.

### Imagem de carta: contrato pra jogo novo

**A moldura manda, não a imagem.** Onde a carta é exibida grande (o preview do
card) a moldura é fixa em **63/88** — a proporção física da carta, a mesma dos
tiles — e a imagem preenche com `object-fit: cover`. Isso vale pra qualquer jogo
que entre depois, **sem CSS novo**.

Por que existe essa regra: cada fonte entrega numa proporção própria (Pokémon
0,727 · Magic 0,7176 · Lorcana 0,7170 · Naruto 0,7018 · HxH 0,6801) e o preview
antes dimensionava pela imagem — a mesma coluna de 400px abria cartas de 550px a
588px de altura, e cada jogo parecia ter um tamanho diferente. Com a moldura
fixa, fonte "alta" escala pra baixo, fonte "baixa" escala pra cima e o recorte
fica em fração de por cento.

O que isso pede de quem adiciona um jogo:

- **não** tente casar a proporção na fonte nem recortar a imagem no sync — a
  moldura resolve na exibição;
- prefira a variante de **maior resolução** que a fonte oferecer (a moldura
  escala pra baixo sem custo; pra cima, borra);
- largura útil mínima ~**440px**, que é o que as fontes vintage entregam via
  proxy de resize (`wsrv.nl`) e o que a moldura de 385px de largura consome;
- proporção muito fora de 63/88 (um scan quadrado, com borda branca sobrando)
  perde as pontas no `cover` — nesse caso o recorte é no **sync**, uma vez, e não
  no CSS.

Segurança: CSP e demais cabeçalhos vivem no [_headers](_headers) (via header, não
`<meta>`, pra cobrir também as páginas pré-renderizadas e valer dentro do service
worker).

---

## Scanner de carta (câmera)

Ícone de câmera em toda busca de página (`.page-search`) e na paleta de busca
(aba **Busca** da bottom-bar). Abre [src/scan.js](src/scan.js), injetado sob
demanda no primeiro toque — o shared.js está no teto do orçamento de peso.

Fase 1: câmera ao vivo com moldura-guia 63/88, OCR **no aparelho** (Tesseract.js
7 em WASM, auto-hospedado em `assets/vendor/tesseract-7.0.0/` porque a CSP é
`'self'`), leitura do **código impresso** (OP05-119, BT1-001, 4/102, MH3 123…)
e busca em duas camadas: set + número exatos pelo manifest (`cmdkCardsByCode`,
a mesma da paleta) e `/api/search?game=all` (D1) com hidratação dos hits. A
foto não sai do navegador; só o código lido vai pra busca. Plano, limites e as
fases seguintes (hash perceptual pra vintage) em
[docs/PLANO-SCANNER.md](docs/PLANO-SCANNER.md).

Quando o código casa com mais de uma carta — o One Piece imprime o mesmo
`EB01-006` na comum, na Alternate Art e na Manga; é assim em 30–54 % do
catálogo de One Piece, Digimon, Gundam, DBFW, Union Arena e Yu-Gi-Oh —, a
foto desempata antes de o resultado aparecer: uma assinatura de cor e luz da
carta (grade 16×22) é comparada com a das miniaturas dos candidatos, e a
ordem só muda com diferença clara (`conferirPelaFoto`). O resumo `scan_done`
leva a precisão (leituras ambíguas, as que a foto reordenou, trocas do 1º
resultado e buscas digitadas), somada no `/admin` pela migração `20260928b`.

O cadeado da barra trava no set da carta lida (ou a folha "+N opções", no set
da escolhida; três seguidas do mesmo set sugerem): a busca passa a rodar nas
cartas do set, sem ida à borda, e o número basta — "4/102" deixa de voltar
vários sets e o prefixo ou o total lidos errado ainda acham a carta.

Cada leitura avisa por som e vibração a faixa de preço da carta (barata,
média, boa — faixas na moeda do site, R$ 5 e R$ 50 por padrão, mudáveis no
alto-falante da barra), com um som próprio pra carta da wishlist: dá pra
triar sem olhar a tela.

A leitura é automática (desliga ao lado da galeria): a carta parada entre as
molduras é lida sozinha, e só se lê de novo quando a cena muda. Toda carta
lida entra na lista da sessão (o botão da direita, com contagem e total), com
quantidade, condição e variante, a ambígua marcada pra conferir, e "Adicionar
N à coleção" grava tudo de uma vez; a lista fica no aparelho por 24 h.

O que isso mudou na infra: `script-src` ganhou `'wasm-unsafe-eval'` e a
`Permissions-Policy` liberou `camera=(self)` (ver [_headers](_headers)); o
worker do OCR nasce por URL (`workerBlobURL: false`) pra `worker-src 'self'`
continuar sem `blob:`. Os ~3,5 MB gz do motor só descem pra quem escaneia e
ficam no cache HTTP (`/assets/*` é immutable), no service worker e, o modelo,
no IndexedDB do Tesseract.

---

## Vitrine (espaço de anúncio)

Plano, números e decisões em [docs/PLANO-ADS.md](docs/PLANO-ADS.md). Fase 0
no ar desde 2026-09-27: o espaço existe e é medido, mas só mostra conteúdo do
próprio Sleevu ("casa": apoie, crie sua conta, anuncie) e de lojas parceiras
servidas daqui. A fase 1 (2026-09-28) ligou o AdSense no mesmo espaço: a
conta (`ca-pub-0808280324005030`) e os três blocos estão no `data/ads.json`.
Só quem aceita o aviso recebe o script do Google; quem recusa ou não responde
continua vendo só a casa e os parceiros.

- **Quem tem vitrine é o HTML.** Só as páginas de catálogo carregam
  `<script defer src="src/ads.js" data-grade="#grade">` (o último script da
  página). Coleção, portfólio, binders, decks, configurações, login, a landing
  e as institucionais **não podem**: a guarda 9 do `check.mjs` quebra o CI.
  Popup e modal nunca recebem espaço.
- **Faixa no feed.** Um `MutationObserver` na grade recoloca as mesmas faixas a
  cada render, no mesmo quadro (nada salta — medido: o CLS com e sem vitrine é
  igual). A posição é medida em ALTURAS DE TELA, só em começo de linha e nunca
  logo depois de um cabeçalho; 1ª depois de ~1,6 tela (2 no celular), teto de
  3 por página.
- **Trilho** só em tela ≥ 1888 px, fixo na margem que o conteúdo de 1440 px
  deixa vazia.
- **Config** em `data/ads.json`: `"ativo": false` desliga tudo; regras de
  densidade por aparelho, teto por dia de cada criativo da casa, criativos de
  parceiro (imagem em `/assets/partners/`, segmentação por jogo, idioma e
  data). Formato errado é descartado, nunca quebra a página.
- **Medição**: um `ad_view` por página (servidos e vistos — metade na tela por
  1 s) e `ad_click`, na aba Mercado › Vitrine do `/admin` (migração
  `20260927a`).
- **CSS** na folha por área `vitrine` (prefixo `vtr-`, não "vitrine": essa
  palavra já é a aba de coleções em cards da Coleção).
- **Consentimento**: o aviso só aparece quando a cadeia do JSON tiver um
  fornecedor com cookie de terceiro (hoje, o `adsense`). A escolha também vive
  em Configurações → Privacidade (`ads`, opt-in, e `adsDecidido`).
- **AdSense (fase 1)**: o fornecedor `adsense` só existe com
  `adsense.cliente` (`ca-pub-` + 16 dígitos) e pelo menos um bloco em
  `adsense.blocos` (`faixa` 728×90, `quadrado` 300×250, `trilho` 160×600) —
  esvaziar os blocos volta ao estado dormente, sem aviso e sem script, sem
  mexer em código. O script do Google só desce com consentimento dado, sem
  economia de dados e fora da UE/UK/CH (`<html data-pais>`, posto pela borda).
  Bloco sem anúncio, bloqueado ou lento vira a vitrine da casa na mesma caixa;
  faixa com anúncio pedido que um filtro reposiciona também — nunca há pedido
  novo sem ação da pessoa. O `ca-pub` da config, a linha do `ads.txt` e a
  `<meta name="google-adsense-account">` do `index.html` (verificação do site,
  não carrega script) são o mesmo pub — o teste cobra; trocar de conta é
  trocar os três.
- **CSP com nonce** só nas páginas com vitrine: cada uma tem uma Function de
  3 linhas em `functions/` que chama o `functions/_vitrine-csp.js` (o
  `/detail` embrulha a resposta que já montava). Lá o `script-src` vira
  `'nonce-…' 'strict-dynamic'` (o que o AdSense suporta), a borda carimba o
  nonce em todo `<script>` e no preload do i18n, e a resposta sai sem
  ETag/`Last-Modified` e `no-cache` (304 juntaria nonce velho com cabeçalho
  novo). O `_headers` global não mudou: login, conta, coleção e o resto seguem
  com `script-src 'self'`. Página nova com `ads.js` precisa da Function — o
  teste de vitrine cobra.
- **Apoiador sem anúncio** (migração `20260928c`): cada apoio de R$ 10+ = 30
  dias sem NENHUM espaço, somando. A data mora na tabela `apoiadores`,
  trancada pra API; a conta logada lê a própria pela RPC `apoio_status` (o
  `adminRpc` do `shared.js` aceita `admin_*` e `apoio_*`), e o dono marca pela
  aba Mercado › Vitrine do `/admin` (e-mail ou @ + dias). O `ads.js` pergunta
  junto do `ads.json` e guarda a resposta por conta em `sleevu-apoio-v1`
  (quem apoia decide sem rede a partir da 2ª página); Configurações mostra o
  selo com a data. Sem a migração aplicada, a RPC dá 404 e todo mundo segue
  vendo a vitrine.

Afiliados moram no `shared.js` (`AFILIADOS` + `linkDeLoja`): vazios, os links
de loja saem idênticos; preenchidos, TCGplayer vira deep link do Impact
(`?u=`), eBay ganha o `campid`, os dois com `rel="sponsored"`, e a nota de
comissão aparece embaixo dos chips. Loja BR segue só com o `utm_source`.

---

## Testes

```bash
node --test tests/*.test.mjs
node scripts/check.mjs          # smoke estático: sintaxe, i18n pt/en/es, ordem de scripts
node scripts/check-mobile.mjs   # guardas de layout mobile
```
