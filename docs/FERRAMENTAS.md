# Ferramentas do HUB — Guia de condição e Sleeves e fichários

Plano e registro de 2026-10-01. Pedido do Fernando: duas ferramentas novas pra
comunidade, cada uma numa **página própria** (como a `/troca`), não em modal.
O protótipo em modal (commit `dec06a32`, branch
`claude/ferramentas-condicao-sleeves-f308`) serviu pra aprovar o desenho; esta é
a versão de produção.

## 1. O que entra

| Página | Endereço | Arquivos | O que faz |
| --- | --- | --- | --- |
| Guia de condição | `/condicao` | `condicao.html`, `src/condicao.js` | Cinco perguntas (danos, cantos, bordas, verso, superfície) e a condição na escala da Liga, com régua por critério e texto pra negociação |
| Sleeves e fichários | `/sleeves` | `sleeves.html`, `src/sleeves.js` | Sleeves no tamanho certo, inner, folhas, fichários, penny sleeves e toploaders, a partir da coleção e dos decks da pessoa |

Textos das duas em `src/i18n-ferramentas.js` (pacote próprio, pt/en/es). CSS
no `styles.css`, logo depois do medidor de centralização (`.ctr-*`).

## 2. Decisões

- **Página, não modal** (pedido do Fernando). O medidor de centralização segue
  em modal: ele não foi citado no pedido.
- **Exigem login e ficam fora do índice**, igual à `/troca`: entram pelo HUB,
  que já é pessoal, e o Sleeves lê a coleção e os decks. `noindex` no HTML;
  `AUTH_PAGES` no `shared.js`. Abrir pro público (SEO do guia) é trocar duas
  linhas, se um dia for o caso.
- **Entrada**: o HUB ganha a seção **Ferramentas** (Analisador de troca, Medir
  centralização, Guia de condição, Sleeves e fichários) e o "Ir para" fica só
  com navegação — 8 + 4, duas grades de 4 colunas cheias. O mega-menu da
  Coleção ganha os dois links na coluna "Mais", ao lado da Troca, e a Coleção
  acende no menu quando a pessoa está nas páginas novas.
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

- Seção na Ajuda (`i18n-docs.js`) explicando as duas ferramentas.
- Lista de jogos por tamanho de carta (hoje só o Yu-Gi-Oh! é citado como
  japonês).
- Levar o medidor de centralização pra página própria também.
