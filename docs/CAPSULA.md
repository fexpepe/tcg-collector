# Cápsula: a ficha de toda carta em grade

Regra de trabalho (o [CLAUDE.md](../CLAUDE.md) aponta pra cá): toda tela que
mostra carta em grade monta o texto embaixo da imagem pelo
[`src/capsula.js`](../src/capsula.js). Aqui fica **o que vai em cada posição,
com que formato, e o que cede quando falta espaço**. O CSS é o bloco "Cápsula"
do `styles.css` (classes `cap-`).

> **Estado (2026-11-23):** vale em Catálogo (página de set, Cartas, Explorar),
> Coleção, Wishlist, Pastas, Vendas, graduadas e perfil público. O popup da
> carta segue com o nome do catálogo. A escada de raridade ainda tem furo em
> alguns jogos (seção 6).

## 1. Por que existe

Até 23/11/2026 seis lugares montavam a ficha cada um do seu jeito. O resultado:
a graduada não mostrava o código, a pasta mostrava a condição da cópia no lugar
do tipo ("Normal · NM"), a venda não mostrava o set, e nenhuma mostrava a
raridade. O nome vinha como a loja escreve o produto ("Master Gundam (LR++)"),
e num tile de 200px o que sobrava cortado era o código, que é justo o que
separa duas cartas de mesmo nome.

## 2. As quatro faixas

Sempre nesta ordem e sempre com a mesma altura. Faixa sem dado não some: é o
que faz a linha de um tile bater com a do vizinho.

| # | Faixa | O que leva | Altura |
|---|---|---|---|
| 1 | Etiquetas | graduação · raridade · tipo · extras | 20px, colada na imagem |
| 2 | Título | Nome (código) | 20px |
| 3 | Origem | bandeira · set · jogo | 20px (40 quando o jogo desce) |
| 4 | Base | preço, depois os botões | colada no fundo do tile |

### 2.1 Etiquetas

- Ordem fixa: **graduação → raridade → tipo → extras**. Quem não tem o dado
  não tem a etiqueta.
- Todas com 20px de altura, fonte 11px e canto reto (o passe flat do site). Só
  o preenchimento muda, e ele diz a categoria:

| Etiqueta | Preenchimento | Texto |
|---|---|---|
| Graduação | cheio, cor da graduadora | "PSA 9", peso 800 |
| Raridade | fundo tingido, em 5 faixas | por extenso, peso 700 |
| Tipo | contorno | a versão; cor do acabamento |
| Extra | contorno tracejado | o que saiu do nome |

- **Raridade** vem por extenso, como o catálogo traz, com a caixa acertada
  ("Super_rare" vira "Super Rare"). Sigla fica como é. "None", "-" e vazio não
  viram etiqueta. As cinco faixas: comum cinza, incomum verde, rara azul, as
  de brilho roxo, o topo dourado. Elas saem do `shared.rarityRank`, a mesma
  escada que ordena as grades. Raridade que a escada não conhece fica no
  cinza: melhor sem cor do que com a cor errada.
- **Tipo** é a versão da carta (Normal, Foil, Holofoil, Reverse, 1st Edition).
  **Condição (NM, SP…) não é tipo e não entra na ficha.** Onde ela faz parte
  da oferta (carta à venda), anda com o preço, na base.
- No tile de uma versão só, o tipo fica na cor do acabamento mesmo quando você
  tem a carta (a posse está na borda e no ✓). No tile agrupado ("Normal ·
  Foil"), a versão que você tem acende na cor do jogo.
- Sem espaço, quem encurta é a **raridade**. O tipo de uma versão não encurta.
  A primeira extra encurta até 44px e abaixo disso some; as outras só aparecem
  inteiras.

### 2.2 Título: Nome (código)

- Uma linha. Quem encurta é o **nome**; o **código nunca é cortado**.
- Nome em 15px/700. Código em 13px/500, cor secundária, entre parênteses. No
  celular, 14px e 11,5px.
- Código como está impresso: `138/103`, `GD05-033`, `忍-2`. O "/total" só
  entra em número puramente numérico ("GD05-033/197" não existe em carta).
- O nome é o **limpo** (seção 3).

### 2.3 Origem

- Bandeira do idioma na frente, depois o set. O set é link pra página dele,
  menos na página do próprio set, onde é texto.
- A etiqueta do jogo só aparece em grade que mistura jogos, na ponta direita.
- O set tem direito a 64px. Se o jogo não cabe ao lado, desce pra uma linha só
  dele. No celular isso é o caso normal.
- O número saiu daqui: já está no título.

### 2.4 Base

- O que já existia: preço numa linha, botões na de baixo, à direita.
- Um fio separa a ficha da base, e a base cola no fundo do tile.
- Carta sem preço guarda a linha vazia. Sem preço e sem botão (slab sem valor)
  não há base.
- Tile com campos próprios (venda, graduada editável) põe os campos no lugar
  da base.

## 3. O que sai do nome

Só exibição: o `name` do catálogo, a busca, o id e os endereços não mudam.

| Destino | O que é | Exemplos |
|---|---|---|
| Some | já tem lugar próprio na ficha | o código da carta, `(GD01-013)`, ` - OP05-006`; a raridade, `(LR++)`, `(C)`, `(SPR)`; o acabamento que é a versão do tile, `(Foil)` |
| Vira extra | diz qual impressão é | `Alternate Art`, `Manga`, `Box Topper`, `Winner`, `Promotion Pack Vol.5`; sigla de paralela diferente da raridade, `(SP)` numa L |
| Fica | diz quem é a carta | `(Shippuden)`, `(2016)`, `(Red)`, `(Evolved)`, `(X Antibody)` |

Sufixo que a regra não reconhece fica no nome. A lista de palavras que marcam
tiragem (`TRATAMENTO`) e a de siglas (`SIGLA_EXTRA`, `SIGLA_DA_RARIDADE`) são
fechadas e moram no `capsula.js`. Sufixo novo que aparecer num sync entra lá,
com o caso no `tests/capsula.test.mjs`.

Medido no catálogo em 23/11/2026: 240.630 cartas, 53.341 nomes mais curtos,
22.891 com alguma etiqueta extra, nenhum nome vazio.

## 4. Lista, compacto e celular

- **Lista** (uma carta por linha): a mesma ficha. O jogo cola no set, o fio
  some e a carta sem preço não guarda a linha vazia.
- **Compacto** (sem imagem): colunas nome · nº · set · raridade · versão ·
  preço · ações. O nome é o limpo. No celular ficam nome, nº e ações.
- **Celular** (2 colunas): mesma anatomia, título um ponto menor.

## 5. Como usar numa tela nova

1. A página carrega `src/capsula.js` logo depois do `src/shared.js`.
2. O tile monta a ficha com `TCGCapsula.ficha(card, opções)` e a base com
   `TCGCapsula.base(preço, botões)`. As opções estão no cabeçalho da função:
   `variant`, `tipo`, `grupo`, `graded`, `jogo`, `setAtual`.
3. A página entra na área `capsula` do `scripts/lib/css-areas.mjs`. Sem isso
   a ficha chega sem estilo em produção (o `check.mjs` barra).
4. Nenhuma tela escreve título, versão ou set à mão. O `shared.js` chama a
   ficha e não escreve classe `cap-` (ele viaja em toda página).

O `tests/capsula.test.mjs` confere os itens 1 e 3 página por página.

## 6. O que ficou de fora

- **Escada de raridade por jogo.** Em 23/11/2026, 13% das cartas com raridade
  caem no cinza porque a escada não conhece a raridade delas. Os piores:
  Sorcery (99%), Vanguard (54%), Naruto Kayou (47%), Cyberpunk (37%), Godzilla
  (35%), Palworld (34%). Completar é mexer no `rarityRank` do `shared.js`, que
  também muda a ordenação por raridade, então é PR própria.
- **Marcas `+` e `*`.** A cor sobe um degrau por marca (LR++ é topo), mas a
  ordenação por raridade ainda trata "LR++" como desconhecida. Entra junto com
  o item de cima.
- **Popup da carta.** O título do popup segue com o nome do catálogo.
- **Sufixos não reconhecidos.** Siglas de tiragem do Weiß Schwarz (`OFR`,
  `JJR`, `BDR`) e da Vanguard seguem no nome.
