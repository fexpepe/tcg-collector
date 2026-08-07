# Sleevu

Colecionador de cartas **multi-TCG**, grátis e local-first: catalogar por variante
e condição, montar decks e binders, acompanhar o valor da coleção no tempo e
sincronizar entre aparelhos — sem plano pago, sem limite de cartas, com export a
qualquer momento.

Online: <https://sleevu.app/>

Este arquivo documenta a **arquitetura** (como o site é feito e como se roda).
O **plano** e as **decisões** ficam no [ROADMAP.md](ROADMAP.md); o backend em
[docs/BACKEND.md](docs/BACKEND.md); os decks em [docs/DECKS.md](docs/DECKS.md); o
SQL do Supabase em [supabase/migrations/README.md](supabase/migrations/README.md).

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

O registro central é o `GAMES` em [src/game.js](src/game.js): **13 slugs**, 12 com
catálogo e o JUMP em preparação. Cada jogo tem um `dataDir` próprio — o do Pokémon
é a raiz `data/` por motivo histórico (não movemos nada).

| Slug | Jogo | Fonte do catálogo | Preço |
|---|---|---|---|
| `pokemon` | Pokémon | TCGdex (en, ja, zh-cn, zh-tw, pt) + PokéAPI (tipos/nomes) + PokemonPriceTracker (JP e graded) | TCGplayer USD · Cardmarket EUR · PPT · MYP (BR, pendente) |
| `lorcana` | Lorcana | Lorcast | USD/EUR |
| `onepiece` | One Piece | TCGCSV cat. 68 + vintage (Carddass Hyper Battle, OP Card Game 2002, Miracle Battle) | USD (moderno); vintage sem preço |
| `magic` | Magic: The Gathering | Scryfall (catálogo EN; pt-BR é fase 2) | USD/EUR |
| `fab` | Flesh and Blood | TCGCSV cat. 62 | USD |
| `gundam` | Gundam Card Game | TCGCSV cat. 86 | USD |
| `dbfw` | Dragon Ball Fusion World | TCGCSV cat. 80 (≠ Masters) | USD |
| `ygo` | Yu-Gi-Oh! | TCGCSV cat. 2 (~46k impressões — o maior) | USD |
| `digimon` | Digimon Card Game | TCGCSV cat. 63 | USD |
| `riftbound` | Riftbound | TCGCSV cat. 89 (Riot) | USD |
| `unionarena` | Union Arena | TCGCSV cat. 81 (Bandai; um anime por set) | USD |
| `naruto` | Naruto Card Game | vintage Bandai 2002–2006 (tcg-db + TV Tokyo + cardcheckbox), Data Carddass, Formation/Cross, Miracle Battle | sem preço |
| `hxh` | Hunter × Hunter | Carddass Hyper Battle 1999–2001 (Hunterpedia) + Miracle Battle | sem preço |
| `jump` | JUMP | curadoria versionada em `data/jump/curated/` | — |

**Linhas** (`GAME_LINES` em [src/shared.js](src/shared.js)): um jogo pode ter
sublinhas selecionadas por `?line=` — por exemplo `nrt-ncg` (o NARUTO CARD GAME
novo, com lançamento mundial em 2027, hoje só com a promo da Gen Con 2026),
`op2002`, `nrt-dc`, `hxh-mb`. O escopo é por prefixo de `setId`: sem `?line=` a
página mostra o jogo principal e **exclui** as linhas.

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
Graded, Hub pessoal, Badges, Backup). Elas leem os 13 jogos de uma vez e filtram
por jogo *dentro* da página — por isso **não** carimbam `?game=` na URL (link
copiado de `/collection` não deve parecer preso ao Pokémon). Nas demais, o jogo
resolvido é carimbado com `replaceState`, senão compartilhar "os sets do Gundam"
entregaria os sets da sessão de quem abre. `/users/<handle>` é exceção: nunca
carimba.

---

## Páginas

Catálogo e navegação: `index` (landing), `hub` (grade de jogos), `sets`,
`detail` (set/artista/Pokémon), `cards`, `explore` (busca global em todos os
jogos), `pokedex`, `artists`, `trainers`.

As facetas da página de set (Raridade, Cor, Tipo, Seleção…) são declaradas **uma
vez por jogo** em `GAME_FACETS` ([src/shared.js](src/shared.js)) e derivadas dos
campos que o sync já grava na carta — então **set novo herda os filtros sem
código novo**. Cada faceta só aparece se as cartas daquele set tiverem o dado, e
uma opção presente em 100% das cartas é descartada (filtro que não filtra nada
é ruído). Vale a mesma regra do card: bloco sem dado não aparece.

Pessoais: `collection`, `portfolio`, `wishlist`, `binders`, `graded` (slabs
PSA/BGS/CGC/SGC/TAG, com valor automático da PPT), `sales` (vendas e trocas),
`my-decks` (galeria + editor), `decks` (galeria pública da comunidade),
`dashboard` (hub pessoal), `badges`, `backup`, `profile`, `settings`, `login`.

Conteúdo/institucional: `about`, `help`, `faq`, `privacy`, `terms`, `novidades`
(renderiza `data/changelog.json`), `admin` (só o dono).

Pré-renderizadas no build: `set/<slug>.html`, `card/<slug>.html` e
`deck/<slug>.html` — HTML estático com título, meta, Open Graph, JSON-LD e a
lista já dentro, pra o Google indexar conteúdo em vez da casca da SPA.

---

## Estrutura

```
src/        app shell (JS global, sem bundler). shared.js é o núcleo (~7k linhas):
            stores, i18n, render, preview, busca, imagens, sync, service worker.
            game.js resolve o jogo; theme.js carrega tema e traduções.
data/       catálogos por jogo (data/ = Pokémon; data/<jogo>/ pros demais),
            índices, preços, logos de set espelhados e snapshots vintage.
scripts/    sync de cada fonte + build (merge, split, prerender, hash, lint, D1).
functions/  Cloudflare Pages Functions (API na borda).
supabase/   migrações SQL versionadas + templates de e-mail.
tests/      node:test (sem framework externo).
docs/       BACKEND.md, DECKS.md e COMMUNITY-PRICES.md.
```

Não há `package.json`: as ferramentas do build (esbuild, wrangler) são chamadas
via `npx --yes` no CI.

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
(`split-i18n.mjs`) e o CSS por área (`split-css.mjs`).

**Durabilidade**: o catálogo validado é versionado de volta no repo pelo próprio
build (commit `[skip ci]`), e o sync faz união preservadora — carta que some da
API é mantida. API morta = catálogo congela, nenhum item de portfólio some.

---

## Sincronizar catálogos

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

Utilitários: `lint-catalog.mjs` (falha em corrupção dura — ids duplicados,
catálogo zerado), `mirror-*-set-logos.mjs` (espelha logos de set localmente),
`build-set-id-map.mjs` (de-para TCGdex→pokemontcg.io pras imagens EN que faltam),
`sync-price-history.mjs` (histórico de preços sem servidor: lê o acumulador do
deploy anterior, anexa o snapshot de hoje e republica).

---

## Dados do usuário

Ficam no `localStorage`, **namespaced por jogo** (`tcg-collector-<jogo>-…`) ou
globais quando o dado é cross-game:

| Por jogo | Global |
|---|---|
| `collection-v3`, `collection-meta-v1` | `binders-all-v1`, `decks-all-v1` |
| `wishlist-v1`, `wishlist-meta-v1` | `collection-folders-v1`, `collection-tags-v1` |
| `prices-v1`, `history-v2` | `collection-sales-v1`, `collection-sold-v1`, `collection-costs-v1` |
| | `collection-graded-v1`, `wishlist-targets-v1`, `favorites-v1` |

Fotos dos binders ficam no **IndexedDB** (WebP comprimido, com teto) e nunca
sobem a servidor — nem para a nuvem, nem para o perfil público.

Export/import em JSON e CSV pela página `backup.html`, incluindo importação de
CSV do TCGplayer/Collectr com prévia. Com conta, tudo isso sincroniza (ver
[docs/BACKEND.md](docs/BACKEND.md)); sem conta, o app funciona igual.

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

- **grátis** (TCGdex, TCGCSV, Scryfall, Lorcast e os vintage): **todo dia**.
  Cobrem 12 dos 13 jogos e não custam nada.
- **por crédito** (PPT e MYP): 3x/semana — segunda e quarta pelo cron diário,
  sexta pelo da noite. Cabem na cota diária (o plano da PPT dá 20.000 créditos
  por dia e um run gasta no máximo 8.000), mas preço JP/graded muda devagar.

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
por URL; sobrevivem a um outage do CDN da TCGdex, que é comunitário), o app shell
como **network-first** (deploy novo é sempre pego) e o catálogo como
**stale-while-revalidate**. Depois da primeira visita o app abre offline e a
coleção já vista funciona sem internet.

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

## Testes

```bash
node --test tests/*.test.mjs
node scripts/check.mjs          # smoke estático: sintaxe, i18n pt/en/es, ordem de scripts
node scripts/check-mobile.mjs   # guardas de layout mobile
```
