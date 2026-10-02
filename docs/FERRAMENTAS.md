# Ferramentas do HUB — Guia de condição e Sleeves e fichários

Plano e registro de 2026-10-01. Pedido do Fernando: duas ferramentas novas pra
comunidade, cada uma numa **página própria** (como a `/troca`), não em modal.
O protótipo em modal (commit `dec06a32`, branch
`claude/ferramentas-condicao-sleeves-f308`) serviu pra aprovar o desenho; esta é
a versão de produção.

## 1. O que entra

| Página | Endereço | Arquivos | O que faz |
| --- | --- | --- | --- |
| Guia de condição | `/condition` (era `/condicao`, §7) | `condition.html`, `src/condicao.js` | Cinco perguntas (danos, cantos, bordas, verso, superfície) e a condição na escala da Liga, com régua por critério e texto pra negociação |
| Sleeves e fichários | `/sleeves` | `sleeves.html`, `src/sleeves.js` | Sleeves no tamanho certo, inner, folhas, fichários, penny sleeves e toploaders, a partir da coleção e dos decks da pessoa |

Textos das duas em `src/i18n-ferramentas.js` (pacote próprio, pt/en/es). CSS
no `styles.css`, logo depois do medidor de centralização (`.ctr-*`).

## 2. Decisões

- **Página, não modal** (pedido do Fernando). O medidor de centralização segue
  em modal: ele não foi citado no pedido.
- **O Guia de condição é público e indexável** (pedido do Fernando, mesmo
  dia): não lê nada da conta, e "condição de carta NM SP" é busca de verdade.
  Tem canonical e Open Graph e está no sitemap. O **Sleeves exige login** e fica
  fora do índice, igual à `/troca`: ele lê a coleção e os decks (`noindex` +
  `AUTH_PAGES`).
- **Menu "Mais"** (pedido do Fernando, mesmo dia): o ÚLTIMO item do topo,
  logado ou não, com o mesmo painel da Coleção (helper `mega()` no
  `shared.js`). O clique leva à página **Ferramentas** (`/ferramentas`), que é
  a 1ª fileira do painel; as colunas são Colecionar (condição, centralização,
  sleeves), Negociar (troca) e Conteúdo (o Blog, que saiu do meio do menu). No
  celular não há menu de topo: a página Ferramentas entra na tela Perfil (o
  menu da conta), ao lado do Blog, e no rodapé das páginas públicas.
- **Página Ferramentas** (`ferramentas.html`): índice público com um cartão por
  ferramenta, conteúdo estático (é o que o buscador lê). O medidor de
  centralização abre por cima dela (`[data-ctr-abrir]` e o `#medir` do menu, no
  `centering.js`), então ele também ficou público. Os atalhos do HUB seguem
  iguais.
- **Entrada**: o HUB ganha a seção **Ferramentas** (Analisador de troca, Medir
  centralização, Guia de condição, Sleeves e fichários) e o "Ir para" fica só
  com navegação — 8 + 4, duas grades de 4 colunas cheias. No topo, as páginas
  novas acendem o "Mais" (a Troca segue acendendo a Coleção).
- **Escala da Liga** (`CARD_CONDITIONS`: M, NM, SP, MP, HP, D), não NM/LP/MP.
  Equivalência com TCGplayer e Cardmarket só como referência ("≈").
- **Vale o pior critério.** É como loja e comprador conferem, e é a única regra
  que se defende numa negociação. Dano que já decide (rasgo, água, escrita)
  pula direto pro D.
- **Valor da condição** vem do mesmo desconto da cotação do site
  (`CONDITION_MULTIPLIERS`). O guia guarda uma cópia; um teste confere que ela
  bate com o `shared.js`.
- **Sleeves**: medidas de referência das marcas comuns (padrão 63×88 / inner
  64×89 / sleeve 66×91; japonês 59×86 / 60×87 / 62×89). Só o Yu-Gi-Oh! é citado
  como japonês até conferirmos os outros jogo a jogo. Pacotes de referência:
  sleeve, inner e penny de 100; toploader de 25.
- **"Usar minha coleção"**: cópias soltas acima de um valor (padrão 20 na moeda
  da pessoa) vão pro toploader; o resto, pro fichário. Slab não entra: já está
  protegido. **"Usar meus decks"**: quantidade de decks e cartas de todas as
  zonas de cada um, do "Meus Decks".
- **Nada sai do aparelho**: as duas são conta pura no navegador. Não gravam
  nada nem falam com a rede, exceto o carregamento do catálogo das cartas da
  própria pessoa (o mesmo do HUB) pra saber o valor de cada uma.
- **Sem selo "NOVO"** no HUB: envelheceria e ninguém lembraria de tirar.

## 3. Onde mexer (o rastro da `/troca`)

| Arquivo | Mudança |
| --- | --- |
| `condicao.html`, `sleeves.html` | Casca de página neutra (`data-catalog=""`), `noindex`, cabeçalho, "← Hub" |
| `src/condicao.js`, `src/sleeves.js` | Lógica + render na página; funções puras expostas pra teste |
| `src/i18n-ferramentas.js` | Textos das duas páginas (pt/en/es) |
| `src/i18n.js` | Só o que o HUB e o menu usam: `dash.tools`, títulos e dicas dos atalhos |
| `styles.css` | Folha das duas páginas (prefixos `fer-`, `gc-`, `slv-`) + HUB em 4 colunas |
| `scripts/lib/css-areas.mjs` | Área `ferramentas` → `condicao.html`, `sleeves.html` |
| `dashboard.html`, `src/dashboard.js` | Seção Ferramentas |
| `src/shared.js` | `AUTH_PAGES`, `collectionActive` e links no mega-menu |
| `sw.js` | `SHELL_ASSETS`: 2 HTML, 2 JS e o pacote de i18n (sem ele o `split-i18n --write` aborta o deploy) |
| `src/admin.js` | Rótulos das páginas no painel |
| `scripts/check.mjs` | As duas em `SEM_VITRINE` (tela de trabalho não tem anúncio) |
| `scripts/smoke-pages.mjs`, `scripts/diff-computed-style.mjs` | As duas na lista de páginas |
| `tests/ferramentas.test.mjs` | Regra do pior critério, conta das folhas e pacotes, paridade do desconto |

**Armadilha do prefixo:** `cond-` já é da área `colecao` do split-css (as
condições da Coleção). Classe `.cond-*` numa página nova vai pra folha da
Coleção e chega **sem estilo** em produção, sem erro nenhum. Por isso o guia usa
`gc-`. Pelo mesmo motivo o seletor de tamanho do Sleeves não reusa o
`.segmented` (área `detalhe`). As variáveis de cor ficam presas em `.fer-page`,
e não no `:root`, pra viajar na folha da área em vez de pesar no núcleo.

## 4. Fases

1. **Páginas e lógica**: HTML, JS e i18n das duas.
2. **CSS e área**: regras no `styles.css` + área no `css-areas.mjs`; simulação
   do `split-css` pra conferir que nada cai no núcleo nem em área alheia.
3. **Entrada**: HUB, mega-menu, portão de login, `sw.js`, admin, listas dos
   scripts.
4. **Testes**: `tests/ferramentas.test.mjs`.
5. **Conferência**: suíte + `check.mjs` + `check-mobile.mjs` + `check-size`
   (peso do `shared.js` e do CSS núcleo) num checkout LF; render nas duas
   páginas em desktop e 390px, temas escuro e claro; HUB.
6. **Subida**: rebase na `origin/main`, checagem de novo e push direto na
   `main` (pedido explícito do Fernando).

## 5. Fora deste pacote

- Seção na Ajuda (`i18n-docs.js`) explicando as ferramentas.
- O plano do Centering v2 (`docs/PLANO-CENTERING-V2.md`, branch
  `claude/centering-tool-v2-5e1a`) previa um menu "Tools" entre Decks e Blog e
  uma página `/tools`. O "Mais" e a `/ferramentas` ocupam esse lugar: a v2
  entra como mais um item da coluna Colecionar e mais um cartão da página.
- Lista de jogos por tamanho de carta (hoje só o Yu-Gi-Oh! é citado como
  japonês).
- ~~Levar o medidor de centralização pra página própria também.~~ Feito na
  v2: `/centering` (§7).

## 6. Estado (2026-10-01)

Fases 1–5 feitas e conferidas antes da subida:

- `tests/ferramentas.test.mjs` (20 testes) + suíte inteira verde; `check.mjs`
  e `check-mobile.mjs` sem erro.
- Build simulado num checkout LF: `split-css` manda as regras `fer-`/`gc-`/`slv-`
  pra `styles-ferramentas.css` (~15,7 KB brutos, só nas duas páginas) e nada
  delas fica no núcleo. Peso: `shared.js` +38 B gz (sobram ~217 B do teto);
  CSS núcleo com ~1,8 KB de folga.
- Render nas duas páginas e no HUB, desktop (1280) e celular (390), temas
  escuro e claro: voltar do navegador volta uma pergunta; "Usar minha coleção"
  separou 4 cópias de R$ 50 pro toploader e 16 pro fichário e reagiu ao valor
  mínimo; "Usar meus decks" somou 121 cartas em 2 decks; a faixa de resumo do
  celular fica acima da tabbar e some quando a lista aparece.

**2026-10-01, 2ª rodada:** Guia público, menu "Mais" no fim do topo e a página
`/ferramentas` (seções 2 e 3 acima). O `shared.js` pagou o menu tirando um
helper morto (`group()`, o menu de clique com botão, sem uso desde o
mega-menu) e montando Coleção e Mais com o mesmo `mega()`.

## 7. Endereços em inglês e o Centering Tool em página própria (2026-10-01, 3ª rodada)

Pedido do Fernando junto com o Centering Tool v2: **todos os links das
ferramentas em inglês**.

| Antes | Agora | Arquivo |
| --- | --- | --- |
| `/ferramentas` | `/tools` | `tools.html` (era `ferramentas.html`) |
| `/condicao` | `/condition` | `condition.html` (era `condicao.html`) |
| modal por cima do HUB, da Coleção e da `/ferramentas` | `/centering` | `centering.html` (nova, na raiz, sem `<base>`) |

- **301 no `_redirects`** pros dois endereços antigos: link salvo, post
  compartilhado e o que o buscador já indexou chegam no novo. O sitemap
  (`STATIC_URLS` do `prerender-catalog.mjs`) anuncia só os destinos:
  `/tools`, `/condition` e `/centering`.
- **Só os endereços mudaram.** As chaves de i18n (`title.condicao`,
  `nav.condicao`, `title.ferramentas`), o pacote `src/i18n-ferramentas.js`,
  o `src/condicao.js` e os prefixos de CSS (`fer-`, `gc-`, `slv-`) ficaram
  com o nome antigo. A `/troca` e a `/sleeves` não mudam.
- **Centering Tool** (o "Medir centralização" da v1, agora com o nome
  "Centering Tool" nos três idiomas): página própria, pública e indexável. O
  plano inteiro, com as tabelas das graduadoras e a precisão, está em
  [`docs/PLANO-CENTERING-V2.md`](PLANO-CENTERING-V2.md). Ele é um item da
  coluna Colecionar do "Mais" (`link("centering", …)`; não nasceu menu
  "Tools" novo), um cartão da `/tools` e um atalho comum (`<a>`) na seção
  Ferramentas do HUB. O `centering.js` saiu do HUB e da Coleção; só a
  `centering.html` o carrega, e a área `medidor` do split-css (`ctr-`) ficou só
  com ela. Ela também reusa o `.fer-page`/`.fer-card`, então está na área
  `ferramentas`.
- **Registro:** `data-active-page`, `moreActive`, `FOOTER_PAGES` (pelo último
  segmento do caminho), rodapé e menu da conta, `isNeutralPage` do `game.js`
  (as quatro ferramentas são neutras: antes o `/condicao` público saía com
  `?game=` no link), `SHELL_ASSETS` + `SHELL_CACHE` v269, `SEM_VITRINE`,
  `smoke-pages`, `diff-computed-style` e rótulos do Admin (as chaves antigas
  ficam pro histórico das estatísticas).
- **Guarda de recarga:** o `podeRecarregarSozinho` do `shared.js` não
  recarrega por versão nova enquanto o `<html>` tiver `data-ocupado` (o
  Centering Tool põe com a foto carregada, que só existe em memória).
- **Lembrete das tabelas:** o `scripts/check.mjs` imprime uma linha própria
  (e `::warning::` no Actions) quando algum `conferido` do
  `src/centering-graders.js` passa de 180 dias
  (`scripts/lib/lembrete-centering.mjs`). Nunca falha o CI.
- **Testes:** `tests/tools-pages.test.mjs` (endereços, 301, `SHELL_ASSETS`,
  rodapé, menu, ordem dos scripts da `centering.html`, guarda de recarga e
  lembrete) e `tests/ferramentas.test.mjs` com os nomes novos. O
  `tests/centering.test.mjs` da v1 saiu: o núcleo novo tem os dele
  (`centering-core` e `centering-graders`).
