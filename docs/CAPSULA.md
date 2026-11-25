# Cápsula: a ficha de toda carta em grade

Regra de trabalho (o [CLAUDE.md](../CLAUDE.md) aponta pra cá): toda tela que
mostra carta em grade monta o texto embaixo da imagem pelo
[`src/capsula.js`](../src/capsula.js). Aqui fica **o que vai em cada posição,
com que formato, e o que cede quando falta espaço**. O CSS é o bloco "Cápsula"
do `styles.css` (classes `cap-`).

> **Estado (2026-11-24):** vale em Catálogo (página de set, Cartas, Explorar),
> Coleção, Wishlist, Pastas, Vendas, graduadas e perfil público. A etiqueta de
> torneio e o "+N" entraram em 24/11. O popup da carta segue com o nome do
> catálogo. A escada de raridade ainda tem furo em alguns jogos (seção 6).

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
| 1 | Etiquetas | graduação · raridade · torneio · tipo · extras (+N) | 20px, colada na imagem |
| 2 | Título | Nome (código) | 20px |
| 3 | Origem | bandeira · set · jogo | 20px (40 quando o jogo desce) |
| 4 | Base | preço, depois os botões | colada no fundo do tile |

### 2.1 Etiquetas

- Ordem fixa: **graduação → raridade → torneio → tipo → extras**. Quem não
  tem o dado não tem a etiqueta.
- Todas com 20px de altura, fonte 11px e canto reto (o passe flat do site). Só
  o preenchimento muda, e ele diz a categoria:

| Etiqueta | Preenchimento | Texto |
|---|---|---|
| Graduação | cheio, cor da graduadora | "PSA 9", peso 800 |
| Raridade | fundo tingido, em 5 faixas | por extenso, peso 700 |
| Torneio | cheio, laranja claro, com troféu | "Tournament", peso 700 |
| Tipo | contorno | a versão; cor do acabamento |
| Extra | contorno tracejado | o que saiu do nome |
| +N | cheio, neutro | quantas extras não couberam |

- **Raridade** vem por extenso, como o catálogo traz, com a caixa acertada
  ("Super_rare" vira "Super Rare"). Sigla fica como é. "None", "-" e vazio não
  viram etiqueta. As cinco faixas: comum cinza, incomum verde, rara azul, as
  de brilho roxo, o topo dourado. Elas saem do `shared.rarityRank`, a mesma
  escada que ordena as grades. Raridade que a escada não conhece fica no
  cinza: melhor sem cor do que com a cor errada.
- **Tipo** é a versão da carta (Normal, Foil, Holofoil, Reverse, 1st Edition).
  **Condição (NM, SP…) não é tipo e não entra na ficha.** Onde ela faz parte
  da oferta (carta à venda), anda com o preço, na base. Acabamento com brilho
  que não é Foil/Holo/Holofoil (Prism, Diamond Foil, Rainbow Foil…) ganha a
  classe `is-brilho`, na mesma cor roxa.
- No tile de uma versão só, o tipo fica na cor do acabamento mesmo quando você
  tem a carta (a posse está na borda e no ✓). No tile agrupado ("Normal ·
  Foil"), a versão que você tem acende na cor do jogo.
- **Torneio** marca a carta que se ganha jogando, e não se compra (seção 2.1.1).
  O texto é "Tournament" nos três idiomas, como a raridade e as extras; a
  explicação aparece ao passar o mouse.
- **Extras aparecem inteiras ou não aparecem.** A que não cabe sai da linha e
  entra no **"+N"**, na ponta direita. No computador, passar o mouse no "+N"
  lista as escondidas. No celular não há hover: o "+N" avisa que tem mais, e a
  carta aberta mostra o nome completo.
- Sem espaço, encolhe primeiro a **raridade** (reticências), depois o
  **torneio** e, em último caso, o **tipo**.
- **Ficha estreita** (celular, menos de 190px): o torneio fica só com o
  troféu (a palavra viraria "T…") e as etiquetas apertam o respiro. Na
  graduada o troféu também vai sem a palavra, porque o selo come o espaço.
  Graduada de torneio no celular não mostra as extras nem o "+N": é o único
  caso em que não cabe tudo, e o "+N" é o de menor prioridade.

#### 2.1.1 Quando é de torneio

Prêmio por participar ou por colocação (Winner, Champion, Finalist, Top 8,
Prize Wall, Participant), carta de juiz, de liga e os packs de torneio e
campeonato (Store Championship, Regionals, Judge Pack, Tournament Pack,
Weekly Play). A regra (`torneio()` no `capsula.js`) olha quatro lugares; o
último é um campo opcional do catálogo, pra quando só a curadoria sabe:

| Onde | Exemplos |
|---|---|
| Sufixo do nome | `(Champion)`, `(Prize Wall)`, `(Judge Pack Vol. 4)`, `(2023 Regionals Participant)`, `(Masters Cup 2024)` |
| Set inteiro | Tournament Promotion Cards, Store Championships, Duelist League Promo, Tournament Pack 1, Organized Play Promos, Weekly Play Promos, Friday Night Magic |
| Raridade | `League` e `Judge` (DBZ CCG) |
| Campo `tournament: true` | PR忍-1-R うずまきナルト（箔押し）do Naruto 2002, prêmio de torneio no set de promos de sempre (25/11/2026). Na busca digitada não aparece: ela vem do D1, que não guarda o campo |

Fica de fora o **produto vendido** com essas palavras no nome: boosters
("Tournament of Power", "World Martial Arts Tournament", "Champions of
Kamigawa", "Champion's Path"), os decks de campeão ("World Championship
Decks") e os bundles de Worlds do Riftbound. Nome de carta também não conta
("Robin Hood - Champion of Sherwood"). O sufixo que marca torneio sai do nome
e vira extra, então o detalhe (qual colocação, qual pack) continua visível.

Medido em 24/11/2026: 8.774 cartas em 24 catálogos (Yu-Gi-Oh! 2.412, DBS
1.704, Digimon 827, Star Wars 798, One Piece 724, Magic 662…). No Pokémon só
1: a fonte (TCGdex) não cataloga os Prize Packs do Play! Pokémon à parte.

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

### 2.5 Raridade e acabamento por jogo (24/11/2026)

O catálogo grava a raridade como a fonte escreve; **a tela** usa o nome do
jogo. Duas tabelas no topo do `src/capsula.js`:

- `NOMES_DA_RARIDADE`: sigla → nome, por jogo. Hoje só o Naruto japonês (Card
  Game de 2002 e Data Carddass): N, R, SR, UR e P aparecem como Normal, Rare,
  Super Rare, Ultra Rare e Promo. Jogo que usa sigla no próprio sistema (One
  Piece, Vanguard, Kayou…) não entra: lá a sigla é o nome.
- `ACABAMENTO_NA_RARIDADE`: o Carddass que grava o **brilho** no campo de
  raridade (Normal, Prism, Holo, Gold Stamp…). Esses valores deixam de ser
  raridade e viram o **tipo** da carta: a etiqueta mostra "Prism" no lugar de
  "Normal" (via `shared.variantDisplayLabel`), a de raridade some, e o popup
  mostra "Acabamento: Prism". Lista fechada por jogo; valor fora dela (a
  Promo da HxH) segue raridade.

As grades montam os dois filtros daqui — **Raridade** (`opcoesRaridade`, a
chave é o `nomeRaridade`, igual nos três idiomas) e **Acabamento**
(`opcoesAcabamento` + `casaAcabamento`, sobre os pares carta × versão). Assim
"R" do Card Game e "Rare" do CCG americano viram uma opção só, e Foil/Normal
nunca mais aparecem no filtro de raridade. Página sem o `capsula.js`
(Portfólio, Fichários…) mostra a raridade crua, como antes.

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
  preço · ações. O nome é o limpo, e a carta de torneio ganha o troféu na
  frente da raridade. No celular ficam nome, nº e ações.
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
- **Nome de raridade fora das grades.** O Portfólio ("por raridade"), o CSV
  exportado e a página da carta servida pela borda (SEO) mostram a raridade
  crua (N, UR): não carregam o `capsula.js`.
- **Sufixos não reconhecidos.** Siglas de tiragem do Weiß Schwarz (`OFR`,
  `JJR`, `BDR`) e da Vanguard seguem no nome.
- **Filtro de torneio.** A etiqueta existe, mas ainda não há filtro "Prêmios de
  torneio" nas grades. A regra (`torneio()`) já é a que um filtro usaria.
- **Prize Packs do Pokémon.** Não existem no catálogo como cartas separadas
  (a TCGdex não os cataloga), então não têm como ganhar a etiqueta.
