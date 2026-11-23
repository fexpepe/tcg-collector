# Plano — Revisão de novembro de 2026: correções, ajustes e fases

2026-11-22. Em 21/11 o site passou por uma revisão geral: tempo de carga medido
em produção, idiomas e moeda, e os padrões do catálogo (jogos, vintage, sets,
cartas). O pedido do Fernando foi revisar o que existe, sem feature nova e sem
piorar foto nem logo. O relatório com as medições está em
<https://claude.ai/artifact/Xhjqsyk3A7Xn1a5cAR5N1n>; os números de item deste
plano (1 a 17) são os dele.

Este documento é o que se executa. Ele diz, pacote por pacote, o que está
errado, onde, o que fazer, o que não fazer e como saber que ficou pronto.

- **Seção 0**: regras que valem para todo pacote.
- **Fase 1**: já está em seis PRs. Aqui fica o que falta pra fechá-la.
- **Fase 2**: cinco pacotes (2A a 2E).
- **Fase 3**: quatro pacotes (3A a 3D).
- **Seção 4**: o que depende de decisão do Fernando e por isso não se executa.
- **Seção 5**: o que foi olhado e não vale mexer.
- **Seção 6**: registro de execução (pacote, branch, PR, estado).

## 0. Regras de execução

Valem para quem executar qualquer pacote, gente ou agente. As regras gerais do
repositório estão no [CLAUDE.md](../CLAUDE.md); aqui só o que este plano
acrescenta ou o que mais costuma dar errado.

### 0.1 Base e branch

- Sempre a partir da `origin/main` do momento: `git fetch origin main` e
  `git switch -c <branch do pacote> origin/main`. A `main` local costuma estar
  centenas de commits atrás.
- Um pacote = uma branch = uma PR. Quando o pacote diz "dois commits", são dois
  commits na mesma branch.
- Nunca `git config` (grava na configuração comum a todas as worktrees), nunca
  `git stash`, nunca `sed -i` em arquivo versionado (regrava em LF e o diff
  explode). Edição é com a ferramenta de edição.
- O agente que implementa **commita e não publica**: sem `git push`, sem PR.
  Quem revisa o diff, roda os checks de novo e abre a PR é a sessão principal.

### 0.2 Orçamento de peso: o `shared.js` não pode crescer

O `scripts/check-size.mjs` limita o `src/shared.js` minificado e comprimido em
86.272 bytes, e a `main` de 22/11 está em 86.270. **Qualquer byte a mais no
`shared.js` reprova o CI.** Por isso todo pacote deste plano foi desenhado pra
morar fora dele: em `functions/`, no arquivo da própria página, no
`src/theme.js`, no `src/game.js` ou no CSS.

- Se um pacote precisar mesmo tocar no `shared.js`, a mudança tem de sair
  neutra ou negativa. Comentário não pesa (o minificador tira); código e chave
  nova no `window.TCGShared` pesam.
- Como medir, antes e depois: minificar com `npx --no-install esbuild --minify
  --charset=utf8` a versão da `origin/main` (`git show origin/main:src/shared.js`)
  e a sua, e comparar `zlib.gzipSync(buf, { level: 9 }).length`.
- Estourou e não deu pra enxugar: para, commita o que tem e relata o número.
  Subir o teto é decisão do Fernando.

### 0.3 Checks antes de dar por pronto

A cópia de trabalho no Windows é CRLF e o CI é LF. Rodar tudo numa cópia em LF
do commit, que é o que o CI vê:

```bash
git -c core.autocrlf=false archive HEAD | tar -x -C <pasta vazia fora do repo>
cd <pasta>
node --test tests/*.test.mjs
node scripts/test-sync-merge.mjs
node scripts/check.mjs
node scripts/check-mobile.mjs
node scripts/bundle-boot.mjs --check
node scripts/lint-catalog.mjs
node scripts/split-indexes.mjs --check        # só se mexeu em data/indexes*
# se mexeu em shared.js ou styles.css:
node scripts/split-css.mjs --write
npx --no-install esbuild --minify --charset=utf8 --outdir=<min> src/*.js
npx --no-install esbuild --minify --outfile=<min>/styles.min.css styles.css
node scripts/check-size.mjs <min>
```

Na cópia CRLF, nove testes falham só por fim de linha, nestes arquivos:
`funil-ativacao`, `headers-link` (3), `history-shards`, `rotulo-jogo`,
`sets-refino` (2) e `tela-set-cache-velho`. Qualquer outra falha é do pacote.

Teste novo que lê fonte do disco normaliza o fim de linha na leitura
(`.replace(/\r\n/g, "\n")`).

### 0.4 Conferência em navegador

Mudança que aparece na tela é conferida renderizando, em 1280 px e em 390 px.

- Servidor estático na pasta da worktree, numa porta própria do pacote (cada
  pacote abaixo traz a sua), encerrado no fim.
- Navegador: o Chrome DevTools MCP, sempre com `isolatedContext` de nome
  próprio do pacote. Vários pacotes rodam ao mesmo tempo e não podem dividir
  aba, cache nem service worker.
- Páginas pessoais (Coleção, Desejos, Vendas, Badges) pedem login e não se
  loga em conta nenhuma. Pra abri-las localmente, sirva uma CÓPIA temporária
  do HTML com o `data-active-page` trocado (o portão `enforceLoginGate` só lê
  esse atributo): por exemplo `wishlist.html` copiada pra `zz-wishlist.html`
  com `data-active-page="zz-wishlist"`. A cópia fica fora do commit. A coleção
  se semeia pelo console da própria página, com
  `TCGShared.createCollectionStore(<jogo>).add(<id>, <variante>, <condição>, 1)`
  (os ids saem de `data/<jogo>/cards.js`); espere uns 2 s antes de recarregar,
  porque a gravação é adiada.
- Localmente não existe `/api/collection` nem D1: o servidor estático responde
  405 e o site cai sozinho no caminho de chunks. É esperado.
- O que só dá pra provar em produção (borda, D1, espelho de imagens) entra na
  PR como "o que ficou de fora", com a receita de medir depois do deploy.

### 0.5 Texto, comentário e commit

- Comentário e commit em português, explicando a decisão e o problema que a
  motivou, com a data quando ajuda. Sem emoji. Ícone é SVG de traço.
- Texto de interface passa pelo i18n e entra em pt, en e es; o `check.mjs`
  reprova se faltar um. Chave de i18n não conta no teto do `shared.js`.
- O commit termina com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

### 0.6 O que o agente devolve

Caminho da worktree, branch e SHA do commit; arquivos mudados, uma linha cada;
os números do `shared.js` (antes, depois, teto) quando tocou nele; os totais
exatos dos testes na cópia LF; o que conferiu em navegador e como; o que não
conseguiu conferir; e toda decisão que tomou e que o plano não previa.

## 1. Fase 1 — fechar o que já está em PR

Seis PRs abertas em 22/11, todas sem conflito com a `main` de 9ab1a515.

| PR | Item | O que faz |
|---|---|---|
| fexpepe/tcg-collector#354 | 9 | Preço digitado segue o idioma (em inglês, `1,250` deixa de gravar 1,25) |
| fexpepe/tcg-collector#346 | 1 | `/api/collection` vai ao banco uma vez pra todos os jogos |
| fexpepe/tcg-collector#349 | 2 | Explorar com uma consulta de ranking, guardada no aparelho, com esqueletos |
| fexpepe/tcg-collector#347 | 3 e 4 | Pré-conexão no espelho de imagens e prioridade alta pro `shared.js` |
| fexpepe/tcg-collector#348 | 10 | Tradução aplicada quando o pacote do idioma chega |
| fexpepe/tcg-collector#353 | 13 | Um `setId` passa a ser um set só nos syncs da TCGCSV |

### 1.1 Ordem de merge

**A #354 entra primeiro.** Ela reduz o `shared.js` em 18 bytes. Em cima da
`main` de hoje, a #346 sozinha estoura o teto por 4 bytes e a #349 por 14; com
a #354 antes, as três fecham em 86.269. As outras três não tocam no
`shared.js` e entram em qualquer ordem.

Estourar o teto deixa o CI vermelho mas não barra o deploy: o `check-size` roda
só no `ci.yml`.

### 1.2 Conferir depois do deploy

Nada disto dá pra medir antes de estar no ar.

- **#346**: repetir o mesmo `POST /api/collection` com 6 ids por jogo e 1, 4,
  8 e 14 jogos. Antes: 162, 598, 1.176 e 2.050 ms. Esperado: perto de 200 ms em
  todos.
- **#347**: home a frio em celular emulado, 4G lento, CPU 4×. Antes: `shared.js`
  termina aos 6,8 s e a página fica interativa aos 6,9 s. Esperado: perto de
  2 s. No pouso da carta, a imagem chegava 3,1 s depois de pedida.
- **#348**: a mesma home com o navegador em inglês. Antes: português aos 1,5 s,
  inglês aos 8,0 s. Esperado: nada em português, inglês perto de 2,6 s.
- **#349**: Explorar com o service worker ativo. Antes: conteúdo aos 3,1 s e 47
  pedidos ao Supabase. Esperado: um pedido na primeira visita, nenhum na
  segunda, conteúdo abaixo de 1 s.
- **#353**: só muda dado no build COMPLETO seguinte ao merge (o das 06:20 UTC
  ou um manual). Conferir depois dele: `data/digimon/manifest.generated.js`
  com as entradas `BT-26` e `BT-26_PR`; o lint sem os 23 avisos da TCGCSV
  (sobram os 2 do Pokémon japonês); e a tela de Sets do Yu-Gi-Oh! com os sets
  de 25 anos em cartão próprio. O Yu-Gi-Oh! é o único dos quatro jogos que não
  foi ensaiado antes do merge.

#### Medido em 22/11, com as Fases 1 e 2 no ar

Mesmas condições de antes: celular emulado (390 px, tela 3x), 4G lento, CPU 4×
mais lenta, contexto novo do navegador a cada carga a frio. Uma medição por
caso; outras tarefas rodavam na mesma máquina, então o que vale é a ordem de
grandeza.

| O quê | Antes | Depois |
|---|---|---|
| #346, `POST /api/collection` com 6 ids por jogo, 1 / 4 / 8 / 14 jogos (mediana de 4) | 162 / 598 / 1.176 / 2.050 ms | 183 / 182 / 201 / 214 ms |
| #347, home a frio: `shared.js` termina | 6,8 s | 2,0 s |
| #347, home a frio: página pronta pra uso (`TCGShared` existe) | 6,9 s | 2,2 s |
| #348, home com o navegador em inglês: texto em português na tela | aos 1,5 s | nunca |
| #348, home com o navegador em inglês: texto em inglês | 8,0 s | 2,5 s |
| #349, Explorar, primeira visita: pedidos ao Supabase pro ranking | 47 | 1 |
| #349, Explorar, primeira visita: cartas na tela | 3,1 s | 3,0 s (esqueleto aos 1,3 s) |
| #349, Explorar, segunda visita: cartas na tela | 3,1 s | 1,7 s, sem pedido de ranking |
| #360, pouso da carta: imagem da carta pedida | depois do `shared.js` e do arquivo do set | aos 0,7 s, junto com o HTML |
| #360, pouso da carta: imagem na tela (é o LCP) | 3,1 s depois de pedida | aos 2,3 s da navegação |
| #360, pouso da carta: arquivo do set | 2 pedidos | 1 pedido |
| #353, Digimon em produção | `BT-26` com dois sets dentro | `BT-26` e `BT-26_PR` no manifesto |

Duas previsões do plano não se confirmaram:

- **Explorar abaixo de 1 s.** Na segunda visita o ranking sai do aparelho, mas
  as cartas ainda dependem de um `POST /api/collection` (cerca de 0,6 s nesse
  4G). Deu 1,7 s, não menos de 1.
- **Explorar na primeira visita não ficou mais rápido**, só mais leve: uma
  consulta em vez de 47, e o esqueleto aparece aos 1,3 s.

No pouso da carta o `shared.js` termina aos 3,1 s (na home, 2,0 s): ele divide
a banda com a imagem da carta e com o arquivo do set, que agora descem juntos.
A carta aparece antes; o popup interativo abre aos 4,1 s.

Não medido: as páginas pessoais (Coleção, Desejos, Badges), que pedem login, e
a tela de Sets do Yu-Gi-Oh! depois da #353.

### 1.3 O teto do `shared.js`

Com a Fase 1 inteira no ar sobram 3 bytes. Um jogo novo custa cerca de 70. A
saída é uma destas duas, e a escolha é do Fernando (seção 4): subir o teto, ou
tirar do núcleo o `JP_NAME_ALIASES` (1,8 KB, é a metade que faltou da F3 do
`docs/CATALOGO.md`).

**Decidido em 22/11:** o teto subiu pra 86.528 B (+256), junto com o Rush of
Ikorr. Com tudo o que entrou no dia, a `main` está em 86.311 B: sobram 217.

## 2. Fase 2

Cinco pacotes independentes, um por PR. Podem ser executados ao mesmo tempo.
O 2A e o 2C mexem nos mesmos arquivos da borda em trechos diferentes: se os
dois ficarem abertos juntos, o segundo a entrar pode pedir um merge da `main`.

### 2A. Pouso vindo da busca: a carta e o set (itens 5 e 6)

**Branch** `claude/pouso-da-carta-e-do-set-2a71` · **porta local** 4311 ·
**PR** "Pouso da carta e do set: a carta já no HTML e os dados pedidos mais cedo"

**O problema.** Quem chega do Google numa carta, no celular e em rede lenta,
vê a tela vazia até 3,1 s e a imagem da carta só aos 7,3 s. Na página de set a
primeira pintura sai aos 1,7 s, a grade aos 4,2 s e a primeira imagem aos
7,3 s (medido em produção em 21/11, 4G lento, CPU 4×). As causas:

1. Na rota da carta o CSS esconde a tela do set
   (`html[data-carta] main > :not(#cardPreviewModal):not(.cs-more):not(.cs-esqueleto)`,
   `styles.css` ~4231) e o esqueleto `.cs-esqueleto` só entra quando o
   `src/detail.js` (~94–97) roda, depois do `shared.js`. E o esqueleto são dois
   `<span>` vazios: bloco de fundo não conta como primeira pintura com
   conteúdo.
2. A imagem da carta só é descoberta depois do JavaScript. O popup monta três
   `<img>`: o brilho e a miniatura na URL do espelho em 300 px, e a grande em
   1.000 px (`cardImgChain`, `src/shared.js` ~5385: `mirrorImg(url, thumb ? 300 : 1000)`).
3. O arquivo do set (`data/sets/<idioma>/<id>.json` ou
   `data/<jogo>/sets/<id>.json`) só é pedido depois que o `detail.js` roda
   (`fetchSetChunks`, `src/shared.js` ~9749), e é pedido de novo mais tarde
   pelo `preparaEnderecos` (`src/detail.js` ~1108–1118), que não reaproveita
   as cartas que a tela já tem.

**Como a borda monta a página (pra saber onde mexer).** Tudo passa por
`functions/games/[[path]].js` (`telaDoSetDecorada`): lê o mapa
`data/game-pages/<jogo>.json` (por set: nome `n` e a lista de arquivos `f`),
busca a casca `detail.html`, lê as cartas e chama `pecasDaCarta`
(`functions/_lib/pagina-carta.js`) ou `pecasDoSet`
(`functions/_lib/pagina-set.js`). O `decoraApp`
(`functions/_lib/decora-app.js`) aplica as peças com HTMLRewriter: no `<head>`
acrescenta o que `cabecaDaRota(pecas, rota)` devolve (função pura, testada em
`tests/games-rota.test.mjs`), e no `<main>` acrescenta `pecas.corpoHtml`.
`rota.card` existe quando o endereço é de carta. O HTMLRewriter não roda em
Node, então o que se testa são as funções puras.

**O que fazer — commit 1, a carta já no HTML.**

1. **Espelho na borda.** Criar `functions/_lib/img-espelho.js` com as três
   variáveis carimbadas pelo deploy, nos MESMOS marcadores do `src/game.js`
   (`var IMG_MIRROR_HOSTS = []; /* SLEEVU_IMG_MIRROR */`, `IMG_MIRROR_GEN`,
   `IMG_MIRROR_450`), e uma função pura `urlDoEspelho(u, w)` que é cópia de
   `urlEspelho` de `scripts/lib/img-mirror.mjs` (~174). É cópia de propósito:
   o deploy apaga `scripts/` antes do `wrangler pages deploy`, então a borda
   não pode importar de lá.
2. **Carimbo.** O `scripts/apply-img-mirror.mjs` passa a carimbar também esse
   arquivo, com o mesmo `injetaEspelho` (ele só precisa dos três marcadores).
   Arquivo sem marcador para o script com erro, como já acontece com o
   `game.js`.
3. **Teste de três pontas.** Em `tests/img-mirror.test.mjs`, travar a cópia da
   borda contra `urlEspelho` e contra o `mirrorImg` do cliente, nos mesmos
   casos que já travam os outros dois (host comum, wsrv.nl, geração > 1, host
   fora da lista).
4. **O esqueleto.** `pecasDaCarta` devolve um campo novo `esqueletoHtml`:
   `<div class="cs-esqueleto" aria-hidden="true">` com dois filhos, como o de
   hoje. No primeiro, a imagem da carta **só quando o host dela está
   espelhado**: `<img>` com `src` = `urlDoEspelho(card.image, 300)`,
   `fetchpriority="high"`, `alt=""`, `decoding="async"`. No segundo, o nome da
   carta como texto (um `<p>`, não um `<h1>`: o `#detailTitle` já é o h1). A
   classe tem de ser `.cs-esqueleto`: a regra do CSS que a poupa do
   `display: none` é travada por `tests/tela-carta.test.mjs` e
   `tests/cls-tela-set.test.mjs`. O que faltar de estilo vai num `<style>`
   dentro do próprio fragmento (é o padrão do `ESTILO` em `pagina-carta.js`),
   nunca no `styles.css`. A caixa da imagem mantém a proporção 63/88 do
   esqueleto atual, pra nada pular quando o popup entra.
5. **Aplicar.** No `decora-app.js`, o tratador do `main` faz
   `el.prepend(pecas.esqueletoHtml, { html: true })` quando o campo existe.
6. **Cliente.** Em `src/detail.js` ~94–97, não inserir um segundo esqueleto
   quando já existe um `.cs-esqueleto` no `main`. A remoção (~106, ~723,
   ~1135) já usa `querySelectorAll` e limpa os dois casos.

Por que só a imagem de 300 px: é a mesma URL que o brilho e a miniatura do
popup pedem, então o popup a encontra em cache. A de 1.000 px tem 150 a 250 KB
e, pedida cedo, disputaria banda com o CSS e o JavaScript, que é o problema que
a #347 corrige na home.

**O que fazer — commit 2, os dados pedidos mais cedo.**

7. **Preload do arquivo do set.** `cabecaDaRota` passa a emitir
   `<link rel="preload" as="fetch" crossorigin href="/<arquivo>">` pra cada
   arquivo de `entrada.f`, nas rotas de set e de carta. Limites: no máximo 3
   arquivos, e nenhum quando o endereço traz `?setId=` ou `?region=` (aí o
   cliente estreita a lista em `entradasDoSet`, `src/detail.js` ~1165, e o
   preload sobraria). O `crossorigin` é obrigatório pra o `fetch` do cliente
   reaproveitar; a URL tem de resolver igual à que o cliente pede (ele pede
   relativo, com `<base href="/">`).
8. **Sem o segundo pedido.** `preparaEnderecos` (`src/detail.js` ~1108–1118)
   reaproveita as cartas que a tela já carregou em vez de buscar os mesmos
   arquivos de novo.
9. **Mapa do jogo com prioridade baixa.** O `fetch` de
   `data/game-pages/<jogo>.json` em `carregaMapa` (`src/detail.js` ~1026) leva
   `{ priority: "low" }`: são 26 KB que hoje descem junto com as primeiras
   imagens.
10. **Opcional, só se bater byte a byte:** preload `as="script"` do manifesto
    (`data/manifest.generated.js` no Pokémon, `data/<jogo>/manifest.generated.js`
    nos outros), que o `boot.js` só pede depois de executar. Só entra se a URL
    for exatamente a que o `boot.js` monta e a conferência em navegador
    mostrar um pedido só. Na dúvida, fica de fora e a PR diz.

**Não fazer.**

- Não tocar no `src/shared.js` (seção 0.2). Tudo aqui cabe em `functions/`,
  `src/detail.js` e `scripts/apply-img-mirror.mjs`.
- Não pedir cedo a imagem de 1.000 px, nem o arquivo de preço do set (ele só
  existe nos jogos com preço, e a borda teria de sondar).
- Não trocar a classe do esqueleto nem a regra do CSS que a protege.
- Não mexer na imagem `.seo-carta-img` nem no texto do bloco `.seo-carta`: é o
  que o robô lê.

**Como conferir.**

- Testes das funções puras: `esqueletoHtml` com e sem host espelhado, nome
  hostil escapado (já há um teste desse tipo em `tests/pagina-carta.test.mjs`),
  `cabecaDaRota` com 1, 3 e 5 arquivos e com `?setId=`.
- Em navegador: a borda não roda no servidor estático. Monte a página com um
  script fora do repo que chama `pecasDaCarta` e `cabecaDaRota` com uma carta
  real de `data/`, injeta o resultado numa cópia do `detail.html` (o que o
  `decoraApp` faria: acréscimo no `<head>`, esqueleto no começo do `<main>`,
  `corpoHtml` no fim) e grava como arquivo temporário na raiz da worktree,
  fora do commit. Abra com `?type=set&name=<set>&setId=<id>&game=<jogo>&card=<id>`,
  em 390 px e em 1280 px, com rede lenta. Conferir: o esqueleto com o nome
  aparece antes de o `detail.js` rodar; existe UM esqueleto; ele some quando o
  popup entra, sem salto de layout (CLS 0); a imagem de 300 px é pedida uma
  vez só; o arquivo do set é pedido uma vez só e o console não acusa preload
  sem uso.

  > **Corrigido na execução (22/11).** Abrir pela forma `?type=set…&card=`
  > não exercita o esqueleto: ele só existe no endereço bonito
  > (`/games/<jogo>/<set>/<carta>`), que é onde a borda escreve. O ensaio da
  > #360 usou um servidor fora do repo que responde nesse endereço chamando as
  > mesmas funções da borda.
- Ensaio do carimbo numa cópia em LF: rodar `node scripts/apply-img-mirror.mjs`
  e ver os dois arquivos com a lista de hosts.

**Pronto quando.** Testes e checks da seção 0.3 passam; a conferência em
navegador acima está descrita no relato com os números; o `shared.js` não
mudou. Na PR, "o que ficou de fora" diz que o ganho em produção (esperado:
primeira pintura perto de 1,7 s e imagem perto de 3 s na carta) só se mede
depois do deploy, com a receita da medição de 21/11.

### 2B. Desejos, Badges, Troca e Blog pelo caminho rápido (item 7)

**Branch** `claude/paginas-pelo-caminho-rapido-2b54` · **porta local** 4312 ·
**PR** "Desejos, Badges, Troca e Blog pedem à borda só as cartas que usam"

**O problema.** O `src/shared.js` tem dois jeitos de carregar "as cartas desta
pessoa". O antigo, `loadOwnedAcrossGames`, baixa por jogo o manifesto e o
arquivo INTEIRO de cada set que tem uma das cartas. O novo, `loadOwnedFast`,
pede à borda (`POST /api/collection`) só aqueles ids e cai sozinho no antigo
se a borda falhar. Coleção, Portfólio e Painel migraram em agosto. Continuam
no antigo, entre outros: `src/wishlist.js` ~68, `src/badges.js` ~351,
`src/troca.js` ~77 e `src/blog.js` ~215.

**O que a borda NÃO devolve**, e que o caminho antigo devolvia. Cada carta vem
só com: `id`, `name`, `set`, `setId`, `number`, `rarity`, `artist`, `language`,
`image`, `variants`, `setReleaseDate`, `cardType`, `cost`. Não vêm `setTotal`,
`vintage`, `pokemonName`, `dexId`, `setLogo` nem `setSymbol`. E o
`window.TCG_INDEXES_MERGED` não é preenchido. É por isso que a troca não é só
de nome de função.

**O que fazer — um commit por página.**

1. **Desejos** (`src/wishlist.js` ~68). Trocar por `shared.loadOwnedFast` com o
   mesmo mapa (ele já é exato por jogo). Depois que `cards` é preenchido,
   chamar `shared.enrichSetTotals(cards)` e redesenhar se ele disser que mudou
   (é o que Explorar, Cartas e Fichários já fazem), senão o código da carta sai
   "063" em vez de "063/197".
2. **Badges** (`src/badges.js` ~351). Trocar por `shared.loadOwnedFast` e:
   - `await shared.enrichSetTotals(cards)` ANTES do laço `bySet` (~362–372).
     Sem isso todo `total` é 0 e "set completo" nunca desbloqueia, calado.
   - `hasVintage` (~375) passa a ser
     `mine.some((c) => c.game !== "pokemon" && shared.isVintageCard(c))`. A
     marca `c.vintage` não vem da borda; o `isVintageCard` reconhece os jogos
     e linhas vintage também pelo prefixo do id. O `c.game !== "pokemon"`
     mantém a conquista como sempre foi: carta de jogo ou linha vintage. O
     Pokémon antigo já tem a conquista dele (`old2005`, por data). É também o
     que conserta o World of Warcraft, o único jogo vintage cujas cartas nunca
     tiveram a marca (item 16).
   - Manter o `.catch` que impede zerar as conquistas.
3. **Troca** (`src/troca.js` ~77). Só lê `id`, `name`, `set`, `number` e
   `game`. Trocar por `shared.loadOwnedFast`. A chamada da ~92 fica como está:
   é a reserva de quando a borda está fora.
4. **Blog** (`src/blog.js` ~215). Só lê nome, set, número, imagem e data.
   Trocar por `shared.loadOwnedFast`. É página pública: hoje o visitante de um
   post com cartas baixa os arquivos inteiros dos sets.

Antes de trocar cada uma, confirmar no arquivo que nada do que ela lê depois
está na lista do que a borda não devolve. Se estiver, parar naquela página e
relatar.

**Mudanças de comportamento que vão na PR.** Quem tem carta de World of
Warcraft passa a ganhar a conquista de vintage. E set sem total oficial passa
a poder contar como completo: sem o total da fonte, o `enrichSetTotals` usa o
número de cartas do catálogo.

**Não fazer.**

- **Vendas (`src/sales.js` ~1358) fica no caminho antigo.** Três motivos,
  conferidos no código: ela republica o perfil público (`shared.publishProfile`
  em sete pontos), e o `buildPublicPayload` tira os totais de set do
  `window.TCG_INDEXES_MERGED`, que a borda não preenche (o perfil sairia com
  todo set em 100%); ela manda os ids vendidos pra TODOS os jogos, o que pela
  borda multiplica o pedido por 48; e a conta de "resposta parcial" do
  `fetchCollectionApi` daria parcial sempre. Migrar Vendas é outro trabalho.
- Também ficam: o perfil público (`src/collection.js` ~3396, precisa do set
  inteiro), o scanner (`src/scan.js` ~932, usa `setTotal` pra casar o código) e
  os ids órfãos do Portfólio (`src/portfolio.js` ~293).
- Não tocar no `src/shared.js`: tudo o que se usa já é exportado
  (`loadOwnedFast`, `enrichSetTotals`, `isVintageCard`).

**Como conferir.** O servidor estático esconde qualquer erro daqui: sem
`/api/collection` o site cai no caminho antigo e tudo parece certo. Por isso:

- Subir um servidor de teste fora do repo que serve a worktree e responde o
  `POST /api/collection` no contrato da borda, montando as cartas a partir de
  `data/<jogo>/cards.js` **só com os campos da lista acima**, e os preços de
  `data/<jogo>/pricing.js` quando existir. Formato:
  `{ c: { <jogo>: [carta…] }, p: { <jogo>: { <id>: preço } } }`.
- Abrir Desejos e Badges por cópia temporária do HTML (seção 0.4), com uma
  coleção semeada que tenha um set COMPLETO de um jogo pequeno e uma carta de
  jogo vintage. Conferir: a lista de desejos aparece com "nº/total"; "set
  completo" e a conquista de vintage desbloqueiam; o pedido foi pela borda de
  teste e nenhum arquivo de set inteiro foi baixado.
- Troca e Blog: a mesma checagem de rede (um `POST`, nenhum arquivo de set).
- Teste de fonte novo, no estilo de `tests/explore-borda.test.mjs`: cada uma
  das quatro usa `loadOwnedFast`; Badges tem `enrichSetTotals` e
  `isVintageCard` e não tem mais `c.vintage`; a ~92 da Troca segue no antigo.

**Pronto quando.** Checks da seção 0.3 passam, a conferência com a borda de
teste está no relato, e a PR lista Vendas, perfil público e scanner como
deixados de fora, com o porquê.

### 2C. Textos da borda no idioma de quem lê (item 11)

**Branch** `claude/textos-da-borda-no-idioma-2c38` · **porta local** 4313 ·
**PR** "Idioma: os textos que a borda escreve seguem o idioma de quem lê"

**O problema.** O HTML estático é português e o cliente traduz o que tem
`data-i18n`. Alguns textos a borda escreve em português fora desse mecanismo,
e quem usa o site em inglês ou espanhol os vê em português pra sempre.

**O que fazer — um commit por parte.**

1. **Índices do pé das telas.** São três geradores:
   - `functions/games/[[path]].js` ~150–152: "Todos os sets de <jogo>",
     "Ver a lista (N)" e, por set, "N cartas" (que hoje escreve "1 cartas").
   - `functions/_lib/pagina-set.js` ~172–174: "Todas as cartas de <set>" e
     "Ver a lista (N)".
   - `functions/_lib/indices.js` ~24, ~37, ~39, ~46: "Ver a lista (N)",
     "N cartas", "Artistas com página no Sleevu" e "Decks da comunidade com
     página própria" (alimenta `/artists` e `/decks`).

   Envolver só a parte fixa num `<span data-i18n="CHAVE">texto em pt</span>` e
   deixar a variável fora dele (o `data-i18n` troca o `textContent` inteiro do
   elemento). O `applyTranslations` já varre o documento todo, então não
   precisa de código no cliente, e o robô continua lendo o português. Chaves
   novas no `src/i18n.js`, nos três idiomas:

   | Chave | pt | en | es |
   |---|---|---|---|
   | `idx.setsOf` | Todos os sets de | All sets of | Todos los sets de |
   | `idx.cardsOf` | Todas as cartas de | All cards of | Todas las cartas de |
   | `idx.viewList` | Ver a lista | View the list | Ver la lista |
   | `idx.cardsWord` | cartas | cards | cartas |
   | `idx.cardWord` | carta | card | carta |
   | `idx.artistsTitle` | Artistas com página no Sleevu | Artists with a page on Sleevu | Artistas con página en Sleevu |
   | `idx.decksTitle` | Decks da comunidade com página própria | Community decks with their own page | Decks de la comunidad con página propia |

   O "N cartas" usa `idx.cardWord` quando N é 1. Confirmar que `sets.html`,
   `detail.html`, `artists.html` e `decks.html` carregam o pacote base de
   idioma. Ajustar `tests/indices.test.mjs` (~16 e ~30 travam "Ver a lista
   (2)" como texto contínuo) e acrescentar um teste: sem as tags, cada bloco
   continua lendo a frase em português.
2. **Título da aba.** Em `/games/<jogo>` e em `/games/<jogo>/<set>` a borda
   escreve o `<title>` em português e tira o `data-i18n` dele, e o cliente
   nunca o troca (`src/app.js` não mexe em título; `acertaTituloDaAba` em
   `src/detail.js` ~982 sai cedo quando a página veio da borda).
   - A borda passa a pôr no `<title>` os atributos `data-titulo-en` e
     `data-titulo-es`. No jogo (`metaDoJogo`, `[[path]].js` ~112): "… — sets
     and cards | Sleevu" e "… — sets y cartas | Sleevu", ou com "history," /
     "historia," nos jogos com "Sobre", no mesmo limite de 65 caracteres. No
     set (`pecasDoSet`, `pagina-set.js` ~116): em inglês o
     `SET_L10N.en.title(...)`, que já existe e é o título da página `-en`; em
     espanhol o mesmo texto do português ("lista de cartas de …" é espanhol
     válido).
   - O cliente troca o `document.title` pelo atributo do idioma quando o
     idioma não é português: em `src/app.js` na tela de sets, e em
     `src/detail.js` antes da saída antecipada do `acertaTituloDaAba`. O
     idioma vem de `shared.getLanguage()`.
   - O título da carta ("Nome · Set | Sleevu") não tem idioma e fica como
     está.
3. **Números da home.** `index.html` ~227 e ~229 mostram "300.000+" e
   "2.800+" com ponto de milhar em qualquer idioma. Corrigir só no
   `src/home.js`, dentro do bloco que já formata os outros números com
   `shared.getLocale()`: reescrever o texto de cada `.lp-stat strong` que seja
   só dígitos, pontos e "+" com
   `toLocaleString(locale, { useGrouping: "always" }) + "+"`. Não mexer no
   `index.html`: o número de lá é o que o robô lê, e
   `tests/admin-charts.test.mjs` ~158 trava o `<strong>` como está.

   > **Corrigido na execução (22/11).** O "+" só volta onde já estava: a
   > contagem de jogos ("48") não tem "+" e não pode ganhar um. A #359
   > preserva o sufixo de cada número em vez de somar "+" a todos.
4. **Data da venda.** `fmtDate` em `src/sales.js` ~875 escreve dd/mm/aa fixo.
   Passa a usar
   `new Date(s + "T00:00:00").toLocaleDateString(shared.getLocale(), { day: "2-digit", month: "2-digit", year: "2-digit" })`,
   mantendo a checagem de formato ISO de hoje (valor fora do formato sai como
   veio).
5. **Trilha "Games" da página de set em inglês.** `scripts/prerender-catalog.mjs`
   ~368–372 aponta "Games" pra `/games`, que só existe em português. Na
   variante em inglês a trilha passa a apontar pra `/hub`, que o cliente
   traduz, tanto no link visível quanto no JSON-LD da trilha (os dois têm de
   dizer o mesmo).

**Não fazer.**

- Não deixar `data-i18n` no `<title>`: o robô do Google roda o JavaScript em
  português e passaria a indexar o título genérico "Sets - Sleevu".
- Não tocar no `src/shared.js`.
- Não é erro e fica como está: o "R$" do preço do fichário de venda (o preço
  manual é guardado em real por desenho, ver `src/shared.js` ~6276), o CSV e a
  prévia do perfil compartilhado.
- Não criar página nova em inglês.

**Como conferir.**

- Testes das funções puras da borda (`metaDoJogo`, `pecasDoSet`, `indice`)
  com os atributos e os `span`; teste de fonte pras linhas novas do cliente.
- `node scripts/check.mjs` passa (chave nos três idiomas). Chave usada só em
  `functions/` pode sair como aviso de órfã; aviso é aceito, erro não.
- Em navegador, com o idioma do navegador em inglês e em espanhol
  (sobrescrevendo `navigator.languages` por `initScript`): a home mostra
  "300,000+" em inglês e "300.000+" em espanhol e português; a data da venda
  segue o idioma (página pessoal: cópia temporária, seção 0.4).
- Índices e título dependem do HTML da borda: gerar o bloco pela função num
  script fora do repo, injetar numa cópia local da tela e conferir que o texto
  troca e que o título da aba troca.

**Pronto quando.** Checks da seção 0.3 passam; a PR diz que os índices e o
título só se confirmam em produção depois do deploy e que a trilha em inglês
passa a apontar pro Hub.

### 2D. Índice de sets do Naruto com os nomes de hoje (item 14)

**Branch** `claude/indice-de-sets-do-naruto-2d19` · **PR** "Naruto: o índice de
sets volta a usar os nomes que as cartas têm"

**O problema.** `scripts/translate-naruto-names.mjs` ~81 lê o índice ANTIGO
(`indexes.js`) e a ~83 o devolve pro `writeGameCatalog`. Em
`scripts/lib/sync-common.mjs` ~311, `const idx = indexes || buildSetIndexes(cards)`:
índice passado vence. Resultado, medido no dado versionado: dos 112 sets do
índice, 75 têm um nome japonês que nenhuma carta usa mais (as cartas dizem
"Vol. 1" e o índice, "あたりカード"). Quem lê o índice pelo NOME:

- `src/collection.js` ~1955: o total por set da aba de sets da Coleção. Esses
  75 sets ficam sem total.
- `src/app.js` ~900 (`indexCardIdsByEntry`): a contagem de cartas que a pessoa
  tem em cada cartão de set fica em 0, mesmo tendo cartas.
- `src/detail.js` ~756: o resgate de link com `?game=` errado não acha o set.

**O que fazer.**

1. Tirar a leitura do índice antigo (~81) e o `indexes,` da chamada (~83). O
   `readGlobalVar` continua em uso pro `pricing`.
2. Regenerar os arquivos versionados: rodar
   `node scripts/translate-naruto-names.mjs` na worktree (não usa rede: lê
   `data/naruto/cards.js`, `scripts/data/naruto-names-en.json` e
   `src/nomes-sets.js`). Só `data/naruto/indexes.js` e
   `data/naruto/indexes-sets.json` devem mudar de conteúdo; os outros arquivos
   que o script regravar têm de sair iguais (conferir com `git diff --stat`
   depois do `git add`: o git normaliza o fim de linha). Se mais algum mudar,
   parar e relatar.
3. Teste novo em `tests/naruto-sets-en.test.mjs`: todo nome de set do índice
   existe em alguma carta, e todo set das cartas está no índice.

**Não fazer.** Não mexer em outro jogo nem no `writeGameCatalog`.

**Como conferir.** O teste novo; `node scripts/split-indexes.mjs --check` na
cópia LF dizendo "Fatias de índice em dia"; os checks da seção 0.3. Em
navegador, a tela de Sets do Naruto local (`sets.html?game=naruto`) com uma
carta semeada de um dos 75 sets: o cartão do set mostra a contagem.

**Pronto quando.** Zero nomes órfãos no índice e a PR diz quantos sets mudaram.

### 2E. A trava de "catálogo zerou" do lint (item 15)

**Branch** `claude/lint-catalogo-zerou-2e63` · **PR** "Lint do catálogo: a trava
de catálogo vazio passa a disparar"

**O problema.** Em `scripts/lint-catalog.mjs` ~108–110:
`const sample = cards.length < 100;`, depois `if (base && !sample) {` e, lá
dentro, `if (cards.length === 0 && base.cards > 0) errors.push(… ZEROU …)`.
Zero é menor que 100, então a checagem de zero nunca roda. Pior: quando não
existe `cards.js` nem arquivo de set, `readCards` devolve `null` e a ~90
(`if (!cards) { … continue; }`) pula calada, mesmo com a régua dizendo que o
jogo tinha milhares de cartas. E o atalho de amostra isenta jogos pequenos de
verdade (Naruto Boruto, 97 cartas).

**O que fazer.**

1. Tirar a decisão pra uma função pura em `scripts/lib/` (por exemplo
   `avaliaRegua(jogo, cards, base)`, devolvendo erros e avisos), e o lint passa
   a chamá-la. O script é de efeito colateral no topo e não dá pra testar
   direto.
2. Regra nova: `base.cards > 0` e catálogo vazio OU não lido é **erro**. O
   atalho de amostra continua valendo só de 1 a 99 cartas (é o Pokémon de
   desenvolvimento, com 13).
3. Testes com `node:test`: `[]` com régua > 0 é erro; `null` com régua > 0 é
   erro; `null` com régua 0 (o JUMP) passa; 13 cartas com régua 52.430 passa;
   catálogo cheio abaixo da régua segue como aviso.
4. Atualizar a régua (`data/catalog-baseline.json`) com
   `node scripts/lint-catalog.mjs --update-baseline` numa cópia LF. Ficam como
   estão só os jogos com menos de 100 cartas (a régua não se aplica a eles).

   > **Corrigido na execução (22/11).** A primeira versão deste passo mandava
   > deixar `pokemon`, `magic` e `ygo` de fora, dizendo que o dado completo
   > deles não está no repositório. **Está**: vai versionado em arquivos por
   > set, e é deles que o lint lê quando não há `cards.js` inteiro. A régua dos
   > três subiu junto com a dos outros 25 jogos (segundo commit da #357).

**Não fazer.** Não transformar em erro o catálogo de 1 a 99 cartas (é a
amostra de desenvolvimento do Pokémon, com 13). Não ligar a atualização da
régua no `deploy.yml` (fica como sugestão, seção 5).

**Como conferir.** Os testes; e o lint rodando limpo na cópia LF com o dado
versionado (é o que o `ci.yml` faz). Ensaio: numa cópia, esvaziar o
`cards.js` de um jogo com régua e ver o lint sair com erro.

**Pronto quando.** O ensaio do catálogo vazio dá erro, o lint do dado real
passa e a PR lista os jogos cuja régua subiu.

## 3. Fase 3

Quatro pacotes, depois da Fase 2. O 3D só se executa com a #354 já na `main`.

### 3A. Decks: imagens pelo espelho (item 8)

**Branch** `claude/decks-imagens-pelo-espelho-3a82` · **porta local** 4321 ·
**PR** "Decks: capas e miniaturas pelo espelho de imagens"

**O problema.** A galeria e o visualizador de Decks pedem as imagens direto na
origem (`cards.scryfall.io`, `cards.lorcast.io`…), em JPG de tamanho único.
Medido em produção: 6 pedidos ao Scryfall e 7 ao Lorcast na abertura da
galeria, e a capa principal só aos 2,6 s. O resto do site usa o espelho
`img.sleevu.app`, em WebP na largura da tela, com a origem como reserva. O
`src/decks.js` monta 14 `<img>` com a URL crua (~596, ~634, ~928, ~943, ~962,
~1044, ~1048, ~1395, ~1856, ~1950, ~1954, ~2219) e duas miniaturas de hover
que recebem `img.src = <URL>` (~1231/~1249 e ~2519).

**O que fazer.**

1. Trocar cada `<img>` de carta por `shared.localizedImg(url, opções)`, que já
   é exportado e é o que as grades usam: põe o espelho na frente, a origem na
   cadeia de reserva (`data-img-fallbacks`) e aceita `alt`, `className`,
   `loading`, `priority`, `thumb` e `sizes`. Com `thumb: true` o `src` é o de
   300 px e, se `sizes` vier, o `srcset` oferece 300, 450 e 600; sem `thumb` o
   `src` é o de 1.000 px.
2. Pras miniaturas de hover, usar `shared.cardImgChain(url, opções)` (também
   exportado): `src`, e a cadeia em `data-img-fallbacks`.
3. **Regra de qualidade, que é a exigência do Fernando:** nenhuma imagem pode
   ficar com menos pixels do que a área em que é desenhada vezes a densidade
   da tela. Pra cada um dos pontos, medir a largura real em 390 px e em
   1280 px e escolher `thumb` e `sizes` de modo que a candidata escolhida
   cubra essa largura em tela 3×. Na dúvida, a maior. A PR leva a tabela:
   ponto, largura desenhada, opção escolhida.
4. Manter classe, `alt`, `aria-hidden`, `loading` e `decoding` de cada ponto, e
   os atributos `data-art` / `data-capa`, que guardam a URL de ORIGEM pro
   hover.

**Não fazer.** Não tocar no `src/shared.js`. Não mudar o que é gravado no deck
(a capa continua sendo a URL de origem). Não mexer no CSS das capas.

**Como conferir.** Em navegador, galeria de Decks e um deck aberto, em 390 px
e 1280 px: as imagens saem de `img.sleevu.app` quando o host é espelhado
(localmente a lista de hosts é vazia; pra ver o espelho, definir
`window.SLEEVU.imgMirrorHosts` por `initScript` com os seis hosts de produção
e `imgMirrorGen` com as gerações, que estão no `tests/dicas-de-carga.test.mjs`
da #347 ou no `boot.js` de produção), a reserva funciona quando o espelho
falha (forçar um 404), e nenhuma imagem aparece mais mole que antes (comparar
`naturalWidth` com a largura desenhada × densidade). Teste de fonte: nenhum
`<img … src="${escA(` de carta sobra no `decks.js`.

**Pronto quando.** A tabela de larguras está na PR e a comparação de nitidez
não mostra nenhum ponto pior.

### 3B. Furos pequenos de padrão do catálogo (item 16)

**Branch** `claude/catalogo-furos-de-padrao-3b47` · **PR** "Catálogo: quatro
furos pequenos de padrão" · um commit por furo.

1. **World of Warcraft sem a marca de vintage.** 0 das 4.672 cartas têm
   `vintage: true`; os outros jogos vintage da mesma fonte põem a marca no
   sync (`scripts/sync-lotr.mjs` ~340). Em `scripts/sync-wow.mjs`, marcar
   `c.vintage = true` no laço que percorre `merged` (~213, o mesmo que põe o
   `setLogo`), pra cobrir também as cartas preservadas. O dado muda no build
   completo seguinte. Efeito colateral, que vai na PR: com a marca, a busca do
   eBay dessa carta passa a levar o ano (`vintageSearchYear`,
   `src/shared.js` ~7530).
2. **Texto do filtro Vintage** (`filter.vintageHint`, `src/i18n.js` ~230,
   ~1887, ~3535). Faltam O Senhor dos Anéis TCG, Saint Seiya e Fullmetal
   Alchemist Carddass. Acrescentar nos três idiomas, no tom da frase atual.
3. **Teste do nome do set sem seis jogos.** Em `tests/nome-do-set.test.mjs`,
   `NOMES_DO_JOGO` (~38) lista, por jogo, as marcas que não podem abrir o nome
   de um set. Acrescentar, conferindo cada entrada contra os nomes reais em
   `data/<jogo>/cards.js`:
   - `dbsb`, `dbva`, `dbbw`: "Dragon Ball", "DRAGON BALL", "ドラゴンボール",
     "Carddass", "カードダス" e o nome da linha em inglês e japonês (Super
     Battle, Visual Adventure, Barcode Wars);
   - `herorush`: "Marvel Hero Rush", "Hero Rush", "Marvel";
   - `narutomythos`: "Naruto Mythos", "Naruto", "NARUTO";
   - `narutokayou`: "Naruto Kayou", "Naruto", "NARUTO", "火影忍者", "Kayou".
   Jogo novo que tenha entrado na `main` depois de 22/11 e não esteja em
   nenhuma das duas listas (o teste e `scripts/lib/nome-do-set.mjs`) entra
   também.
4. **Logos do Flesh and Blood no disco e sem uso.** `scripts/sync-fab.mjs`
   ~151–159 procura o logo pelo `setId`; os arquivos de `data/fab/set-logos/`
   têm o código impresso; e 46 dos 104 `setId`s são o número do grupo. Nove
   sets ficam sem logo com o arquivo no disco (os seis "Historic Pack 1 Blitz
   Deck", `1HB` `1HD` `1HT` `1HK` `1HR` `1HV`; e `AIO`, `AJV`, `AMX`). No
   laço do logo, tentar também o código impresso do set, tirado dos números
   das cartas com `prefixoDominante` de `scripts/lib/codigo-do-set.mjs` (a
   régua do FAB já está lá, ~166). Travas: só pra set com mais de 5 cartas e
   só quando o arquivo existe. O dado muda no build completo seguinte.

**Não fazer.** Não apagar os arquivos de logo repetidos nem os sem uso. Não
mexer em `badges.js` (está no 2B). Não mexer no nome de set com espaço no fim
nem nos sets do Pokémon japonês (seção 4).

**Como conferir.** Checks da seção 0.3. Pro logo do FAB, um script fora do
repo que aplica a régua nova sobre `data/fab/cards.js` e lista set → arquivo:
os nove aparecem e nenhum set pequeno ganha logo errado.

### 3C. Documentação e comentários defasados (item 17)

**Branch** `claude/documentacao-em-dia-3c05` · **PR** "Documentação: números e
regras que o código já não confirma"

Só texto. Cada número se confere no código NO DIA, porque a `main` anda. Em
22/11: 49 jogos (o `GAMES` de `src/game.js` tem 50 chaves, uma é o `hub`), 48
com catálogo e o JUMP em preparação; 53 endereços em `/games`; vintage com 25
endereços e 21 slugs.

- `README.md` ~36 ("45 slugs, 44 com catálogo") e os dois "14 jogos" (~791 e
  ~1430).
- `docs/CATALOGO.md`:
  - cabeçalho (~11–13), seção 0 (~22), ~621 e ~702 dão quatro contagens
    diferentes de pontos e de travas: recontar e unificar;
  - "nenhuma fase foi feita" é falso: a F2 está pronta (14/11,
    `split-pricing.mjs`) e a F3 pela metade (`JA_SET_EN` e `VINTAGE_SET_EN`
    saíram pro `src/nomes-sets.js`; o `JP_NAME_ALIASES` segue no `shared.js`);
  - 3.1, tabela de famílias: a linha da TCGCSV lista 9 jogos e são cerca de
    23; faltam jogos na linha de fã-sites e o Duel Masters;
  - 3.2 (~216) põe `JA_SET_EN`/`VINTAGE_SET_EN` no `shared.js`;
  - listas de `SECOES_BANDAI` (~176 e ~287) sem `dbs` e `herorush`;
  - 4.3 (~633) "6 dos 15 jogos"; ~757 e F7 (~876) "accents dos 15 jogos";
  - 5.2 cita `CSV_GAME_NAMES`, que não existe mais.
- Comentários: `hub.html` ~325 ("fecha uma fileira de 6"; são 7 cartões);
  `src/game.js` ~70 (tile "Em breve" do JUMP, que não existe) e ~37 (o `hxh`
  descrito como Miracle Battle; hoje é só o Hyper Battle); `src/app.js` ~9 e
  ~1421 (dizem que Union Arena e FAB não têm logo; têm); `src/admin.js` ~1417
  ("de 1996 a hoje"; o resto do site diz 1988, que é o certo).

**Não fazer.** Não mudar comportamento. Não reescrever seções que estão certas.
Comentário em arquivo `.js` muda só o comentário.

**Como conferir.** Checks da seção 0.3 (o `check.mjs` lê os HTML) e o
`shared.js` com o mesmo peso (comentário não pesa).

### 3D. Filtro de faixa de preço na régua do idioma (sobra da #354)

**Depende da #354 na `main`.** Sem ela, não executar.

**Branch** `claude/filtro-de-preco-no-idioma-3d90` · **PR** "Filtro de preço de
Cartas e do Explorar lê o número no idioma da interface"

`parsePrice` em `src/cards.js` ~39 e em `src/explore.js` ~194 tem conta própria
em que toda vírgula é decimal: em inglês, "1,000" filtra por 1. Trocar a conta
por `shared.parseMoney(el.value)`, mantendo "campo vazio = sem limite" (o
`parseMoney` devolve 0 pra vazio; hoje vazio é `null`). Teste de fonte e, em
navegador com o idioma em inglês, "1,000" no mínimo filtra por mil.


<!-- FASE-3 -->

## 4. Decisões que são do Fernando

Não se executam sem resposta. Cada uma muda o resultado que o visitante vê ou
exige redirecionamento.

| # | Decisão | Hoje | Alternativa |
|---|---|---|---|
| D1 | Teto do `shared.js` | **Decidido em 22/11:** subiu pra 86.528 B; a `main` está em 86.311 | Segue aberto tirar o `JP_NAME_ALIASES` do núcleo (1,8 KB), que resolve de vez |
| D2 | Preço pra quem usa dólar ou euro (item 12) | O valor da carta prefere o preço brasileiro (MYP) convertido, em qualquer moeda (`cardValue`, `src/shared.js`); o texto que a borda escreve na mesma página cita o dólar do TCGplayer | O preço brasileiro só vence quando a moeda é real |
| D3 | Home em inglês indexável (item 12) | A home não tem `hreflang` nem versão `-en`; a busca em inglês mostra título e descrição em português | Página estática em inglês, como os sets já têm |
| D4 | Formato de número em espanhol (item 12) | Todo espanhol usa o formato da Espanha (1.234,56) | Usar a região do navegador (México escreve 1,234.56) |
| D5 | Português de Portugal em real, e e-mail de login só em português (item 12) | Como está | Euro pra pt-PT; e-mail no idioma da interface |
| D6 | Regra do logo do set vintage (item 16) | Três versões escritas (CATALOGO contrato 3, `docs/LOGOS.md`, `sync-dbc-carddass.mjs`). Dragon Ball, HxH e Miracle Battle levam o logo do jogo; Gundam e Saint Seiya, só o nome; o One Piece Carddass usa a arte da primeira carta, que o contrato 3 proíbe | Escolher uma regra e alinhar dado e documento |
| D7 | Endereços de set feitos das letras que sobram do título japonês (item 16) | `30-db`, `29-4`, `16-z`, `12-3`, `9-vs`, `6-vs` no Dragon Ball Carddass; `10-vs` no Gundam; `2000` a `2002` no HxH; `naruto` no Carddass Masters | Trocar pelo código do set, com redirecionamento 301 |
| D8 | Pokémon japonês: o set `svpj` repete as 217 cartas do `SV-P` (item 16) | Duplicado | Aposentar o `svpj` com de-para em `data/card-id-merges.json`. Mexe na coleção de quem tem carta dele, então pede sessão própria |
| D8b | Pokémon japonês: nomes de set trocados (item 16) | 40 cartas do `SV4a` levam o nome do SV3a; o `WCS23` mistura um nome em japonês e um em inglês | Corrigir na fonte do dado; é o mesmo aviso que o lint da #353 passa a dar |
| D8c | Dois nomes de set em português com espaço no fim (item 16) | "Sintonia Mental " (`sm11`, 258 cartas) e "Destinos Brilhantes " (`swsh4.5`, 195), vindos da TCGdex (`scripts/sync-tcgdex.mjs` ~179 e ~392) | Tirar o espaço no sync. Nome de set é chave de listas, de conquistas e do perfil público, então a troca tem de passar pelo de-para de set renomeado (`scripts/data/sets-renomeados.json`) |
| D9 | Yu-Gi-Oh!, `BPT` e `DPCT` na #353 | Pelo menor `groupId`, quem fica com o código limpo é o "2003 Collectors Tin" e o "2010 Duelist Pack Collection Tin" | Fixar o código no set que aparece hoje (duas linhas) |
| D10 | Lint "um `setId`, um set" como erro | Aviso, pra não derrubar o build completo | Virar erro depois de o dado regenerar e ficar estável |

## 5. Olhado e sem mudança

- Hub, Sets, tela de set, Lançamentos, Vintage e Pokédex com o service worker
  ativo: todas abaixo de 1,3 s num celular com CPU 4× mais lenta.
- Sets gigantes: a grade paginada segura. O The List (5.659 cartas) abre em
  1,4 s com 125 imagens no DOM.
- Busca: os 48 arquivos de nomes somam 90 KB e descem em paralelo.
- Largura das imagens: já acompanha a densidade da tela. Nada a ganhar
  reduzindo, e reduzir pioraria a foto.
- Logos da home: já são `lazy`. O problema era de prioridade (#347), não de
  peso.
- Sprites da Pokédex direto do `raw.githubusercontent.com`: é dependência de
  terceiro com cache curto, não lentidão. Espelhar somaria mil arquivos ao
  deploy, que já está perto do teto de arquivos do Pages.
- CSV (cabeçalho em português, ponto e vírgula) e prévia do perfil
  compartilhado (português e "R$"): formato pensado pro Excel brasileiro e pro
  WhatsApp. Ficam.
- Páginas estáticas `/artist/<slug>` e `/deck/<slug>` só em português: gerar a
  versão em inglês é projeto, não correção.

### 5.1 Fica pra depois (trabalho maior, não decisão)

- **Vendas pelo caminho rápido.** Precisa de três coisas antes: carregar os
  totais de set como a Coleção faz (`loadCollectionIndexes`, com
  `shared.loadGameIndexSlice`), não republicar o perfil quando a resposta vier
  parcial, e parar de mandar os ids vendidos pra todos os jogos (o registro de
  venda não guarda o jogo).
- **Perfil público e scanner pelo caminho rápido.** O perfil precisa do set
  inteiro pra desenhar as faltantes; o scanner usa o total do set pra casar o
  código.
- **Coleção, Portfólio e Painel sem o total do set no código da carta.** Saem
  "063" em vez de "063/197" porque não chamam `enrichSetTotals`.
- **Régua do lint atualizada sozinha.** Hoje o `--update-baseline` só roda à
  mão. Ligá-lo no build completo, depois do lint passar, faria a régua
  acompanhar o catálogo; mexe no `deploy.yml`.
- **Preload do arquivo de preço do set e do manifesto** na borda (o 2A deixa
  o primeiro de fora e o segundo como opcional).
- **Os 10 manifestos que o Explorar pede depois da grade** (`enrichSetTotals`)
  e ainda disputam banda com as primeiras imagens.
- **Arquivos de logo repetidos do Flesh and Blood** (nove pares do mesmo logo
  com nomes diferentes).
- **Miniatura de 300/600 nos Decks pra todo jogo.** Hoje só o Magic usa; os
  outros baixam a imagem inteira da fonte (seção 6, 3A). Pede uma opção no
  `shared.cardImgChain` que deixe a variante reduzida do host fora da cadeia
  de reserva, e a candidata de 1000 no `srcset` pra tela entre 460 e 700 px.
- **Faixa de preço no endereço.** Cartas grava em `?pmin=` e `?pmax=` o texto
  digitado; gravar o número já lido faz o link valer em qualquer idioma
  (sobra da #365).
- **Explorar: as cartas da segunda visita ainda esperam a borda** (1,7 s no 4G
  lento). Guardar no aparelho também as cartas do ranking, e não só os ids,
  tiraria esse pedido.

## 6. Registro de execução

| Pacote | Branch | PR | Estado |
|---|---|---|---|
| Fase 1, item 9 | `claude/preco-digitado-segue-idioma-2b9d` | fexpepe/tcg-collector#354 | na `main` (22/11) |
| Fase 1, item 1 | `claude/api-colecao-paralela-3f8a` | fexpepe/tcg-collector#346 | na `main` (22/11) |
| Fase 1, item 2 | `claude/explorar-uma-consulta-6a2f` | fexpepe/tcg-collector#349 | na `main` (22/11) |
| Fase 1, itens 3 e 4 | `claude/dicas-de-carga-5b1d` | fexpepe/tcg-collector#347 | na `main` (22/11) |
| Fase 1, item 10 | `claude/idioma-sem-portugues-na-frente-9d4c` | fexpepe/tcg-collector#348 | na `main` (22/11) |
| Fase 1, item 13 | `claude/sets-escondidos-setid-4e7b` | fexpepe/tcg-collector#353 | na `main` (22/11), dado já no ar |
| 2A | `claude/pouso-da-carta-e-do-set-2a71` | fexpepe/tcg-collector#360 | na `main` (22/11) |
| 2B | `claude/paginas-pelo-caminho-rapido-2b54` | fexpepe/tcg-collector#358 | na `main` (22/11) |
| 2C | `claude/textos-da-borda-no-idioma-2c38` | fexpepe/tcg-collector#359 | na `main` (22/11) |
| 2D | `claude/indice-de-sets-do-naruto-2d19` | fexpepe/tcg-collector#356 | na `main` (22/11) |
| 2E | `claude/lint-catalogo-zerou-2e63` | fexpepe/tcg-collector#357 | na `main` (22/11) |
| 3A | `claude/decks-imagens-pelo-espelho-3a82` | fexpepe/tcg-collector#366 | na `main` (23/11) |
| 3B | `claude/catalogo-furos-de-padrao-3b47` | fexpepe/tcg-collector#361 | na `main` (22/11); o dado muda no build completo |
| 3C | `claude/documentacao-em-dia-3c05` | fexpepe/tcg-collector#364 | na `main` (23/11) |
| 3D | `claude/filtro-de-preco-no-idioma-3d90` | fexpepe/tcg-collector#365 | na `main` (23/11) |

O que a execução da Fase 3 mostrou e o plano não previa:

- **3A.** Com `thumb`, a cadeia de reserva do `shared.cardImgChain` passa pela
  variante reduzida do host (TCGdex 245 px, Lorcast 488, TCGplayer 400) antes
  da origem. Por isso, nos Decks, a miniatura grande só usa a de 300/600 no
  Magic; os outros jogos recebem a imagem inteira pelo espelho. Fazer a de
  300/600 valer pra todo jogo pede uma opção no `shared.js` que tire a
  variante reduzida da cadeia (fica pra depois, 5.1).
- **3B.** O filtro Vintage já pegava o World of Warcraft pelo prefixo do id; a
  marca `vintage` que faltava só mudava o ano na busca do eBay e o selo de
  vintage dos Badges.
- **3C.** A linha do `src/admin.js` que o plano listava como comentário é
  texto da capa do kit de parceiros ("sets, de 1996 a hoje"); foi corrigida
  pra 1988 em commit separado. "Outros TCGs" nunca teve 7 cartões: eram 8 e
  hoje são 9.
- **3D.** O `parsePrice` do Explorar fica em ~259, não em ~194. Sobrou um caso
  do mesmo problema: Cartas grava no endereço (`?pmin=`) o texto como foi
  digitado, e um link feito em inglês lê outro número em português.

