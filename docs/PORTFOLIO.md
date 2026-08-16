# Portfólio — visão financeira da coleção

Plano da feature **e** registro do que foi construído. Complementa o
[ROADMAP.md](../ROADMAP.md); segue o formato de [LISTAS.md](LISTAS.md) e
[DECKS.md](DECKS.md) (fases F0–F4, cada uma entregável sozinha).

> **Estado: F0–F4 implementadas e mescladas na `main`** (2026-08-16). A proposta
> saiu da auditoria da tela + pesquisa de 10 concorrentes; o que mudou durante a
> execução está na seção 7, o que ficou de fora na 8.

**Tese:** o Portfólio é a **visão financeira da Coleção** — não um segundo
inventário. O total dele tem que bater com o da Coleção no centavo, porque a
fórmula vive num lugar só. O que a 2.0 acrescentou foi *perspectiva*: por jogo,
no tempo, contra o mercado, e separando o que ainda é potencial do que já virou
dinheiro.

---

## 1. O que os concorrentes fazem (pesquisa de ago/2026)

| Produto | Gráfico no tempo | Multi-série | Custo | Venda realizada | Valor por pasta | Preço |
|---|---|---|---|---|---|---|
| **Collectr** (~4M usuários) | ✓ série única | — | ✓ | **—** | ✓ por portfólio | Pro US$ 4,99–7,99/mês |
| **PriceCharting** | ✓ mensal | ✓ valor+custo+lucro | ✓ | ✓ (mar/2026) | ✓ | premium |
| **Card Ladder** (sports) | ✓ | — | ✓ + data | fraco | ✓ | ~US$ 20/mês |
| **Dragon Shield** | ✓ 30d por carta | — | — | — | ✓ | US$ 2,99/mês |
| **TCG Collector** | — | — | — | — | — (mas tem "cost to completion") | US$ 3,99/mês |
| **CollX / Ludex** | parcial | — | — | via marketplace | — | US$ 5–25/mês |
| **Moxfield / Archidekt** | — | — | — | — | ✓ por deck | grátis |
| **Sleevu** | ✓ | ✓ **por jogo** | ✓ | ✓ | ✓ | grátis |

Quatro leituras que guiaram as prioridades:

1. **Venda realizada é espaço em branco.** O líder da categoria não tem
   "marcar como vendido" nem lucro realizado; o PriceCharting só ganhou isso em
   março de 2026. O Sleevu já tinha — e escondia no fim de um bloco.
2. **Ninguém tem linhas por jogo.** O Collectr agrupa por TCG numa *lista de
   totais*; o único multi-série do mercado é o do PriceCharting (valor/custo/
   lucro, atrás de paywall).
3. **Todo mundo cobra pelo gráfico.** Histórico longo, export e análise são o
   paywall padrão. Aqui é grátis — vale dizer isso no marketing.
4. **Confiança vence precisão.** A crítica recorrente ao Card Ladder é
   estimativa duvidosa em carta ilíquida; a resposta deles foi expor o método de
   avaliação. Daí o "≥" das listas e a nota de cobertura das vendas.

Padrões de UX importados: delta combinado `+R$ X (Y%)` no cabeçalho
(Collectr/Robinhood), scrub que move o número grande (Robinhood), movers da
*sua* coleção (Dragon Shield/Delta), privacidade que borra dinheiro e mantém
porcentagem (Trading 212), vocabulário leigo — "lucro potencial" em vez de "não
realizado" (Card Ladder chama de *Potential Profit*).

---

## 2. Modelo (o que não muda)

- **Patrimônio = cartas raw + slabs graded**, todos os jogos. Mesma fonte e
  mesma fórmula da Coleção e do Hub (`shared.collectionValueLines` +
  `shared.gradedTotalValue`).
- **Binders, listas e wishlist são VISÕES, não patrimônio.** As cartas que você
  tem já estão contadas; somar de novo seria contar em dobro. A seção de listas
  diz isso na própria tela.
- **Modo investidor é privado.** Custo, vendas e resultado nunca entram no perfil
  público.
- **Vender remove a cópia da coleção** (decisão do Fernando).

---

## 3. Fases

### F0 — Fundação e consertos
- Filtro de jogo com os **13 jogos** via `shared.setGameFilterScope` (tinha cinco
  fixos no HTML; a gaveta do mobile nascia vazia porque procura
  `[data-game-filter]`).
- **Eixo X pelo tempo**, não pela posição na lista: um buraco de 25 dias no
  histórico ocupava a largura de um dia.
- **Cabeçalho do gráfico** com valor + variação da faixa e scrub. As três
  cápsulas 7d/30d/início saíram (mesmo número, por outro caminho de cálculo).
  Faixa "1D" virou "1A" — com ponto diário, um dia nunca tem os 2 pontos que o
  gráfico exige.
- **`history-v2` subiu pro `shared.js`** (`valueHistory`, `recordValueSnapshot`)
  e o Hub e a Coleção passaram a gravar o ponto do dia.

### F1 — Uma linha por jogo
- Modos **Séries** × **Por jogo**, chip "Todos os jogos", e um **%** que
  normaliza cada linha a 100 no início da faixa (sem ele, comparar YGO com HxH
  compara o tamanho das coleções, não o desempenho).
- `renderChart` passou a trabalhar com **traços genéricos**
  `{key, label, color, vals, from}` — foi o que fez o modo novo caber sem um
  segundo renderizador. Acima de 4 linhas a área sob a curva sai.

### F2 — Listas e binders com preço
- Valor por lista e por binder, com **"custo pra completar"** os slots vazios (o
  recurso que o TCG Collector cobra).
- Valor vira um **piso "≥"** quando alguma carta não tem cotação, com o motivo no
  `title`.
- O card "desejos" abre em **wishlist × faltantes de binder**.

### F3 — Vendas 2.0
- "Investimento" virou **Posições** (lucro *potencial*) e **Vendas** (resultado
  *realizado*).
- **Taxa e frete** no modal "Vendi", em % e em dinheiro (espelhados), com o %
  lembrado entre vendas (`shared.getSaleFeePct`).
- **Câmbio congelado na data**: o registro guarda o BRL do dia. Resultado
  realizado não flutua — o dinheiro já entrou.
- **Nota de cobertura** ("o resultado considera 5 de 7 vendas") com link pra
  corrigir. Padrão *flag-then-fix* do Quicken/CoinLedger: nunca chutar um custo
  em silêncio.
- **Barras por mês** (12 meses, líquido) + total no ano.

### F4 — Diferenciais
- **Movers em duas abas**: "Minhas cartas" ordena pelo impacto no bolso
  (variação × valor × quantidade), "Mercado" é a visão de sempre.
- **Modo privacidade** no cabeçalho: reusa o `data-sensitive` que já existia nas
  Configurações, ampliado pro que a 2.0 trouxe. Borra o **dinheiro**, mantém
  **porcentagem** e o formato do gráfico.
- **Benchmark de mercado**: `sync-price-history.mjs` passou a emitir um
  `market-index.generated.json` por jogo — índice *equal-weighted* (média das
  variações relativas, não a soma dos preços) normalizado em 1000, como o CL50 do
  Card Ladder. ~570 bytes por jogo. Aparece tracejado, só no modo %.
- **Retrospectiva do ano** (PNG 4:5): canvas puro, sem rede e sem imagem de carta
  — nunca *taint*a o canvas nem depende de CDN.

---

## 4. Onde o código mora

| O quê | Onde |
|---|---|
| Tela, gráfico, seções | `src/portfolio.js` · `portfolio.html` |
| Histórico de valor (ler/gravar/migrar + cookie do hub) | `shared.js`: `valueHistory`, `recordValueSnapshot` |
| Valor da coleção (fonte única) | `shared.js`: `collectionValueLines`, `collectionNetWorth`, `gradedTotalValue` |
| Contas de uma venda (fonte única) | `shared.js`: `soldValues`, `getSaleFeePct` |
| Modal "Vendi" (taxa, custo, data) | `src/sales.js`: `openSoldConfirm` |
| Índice de mercado | `scripts/sync-price-history.mjs` → `<dataDir>/market-index.generated.json` |
| Estilos | `styles.css`: prefixo `pf-` (sai pra `styles-portfolio.css` no split) |

Preferências locais da tela: `tcg-pf-chart-mode`, `tcg-pf-chart-pct`,
`tcg-pf-chart-bench` (modo/normalização/benchmark) e
`tcg-collector-pref-sale-fee` (taxa padrão, global).

---

## 5. Regras que os testes protegem

`tests/value-snapshot.test.mjs` e `tests/sold-values.test.mjs`:

- **Campo ausente preserva, zero explícito grava.** O Hub e a Coleção sabem o
  patrimônio mas não os desejos; mandar `w: 0` de lá apagaria o que o Portfólio
  registrou no mesmo dia. Já "vendi tudo" é um dado real e precisa entrar.
- Duas gravações no mesmo dia **substituem** o ponto (não duplicam).
- Jogo vazio e sem histórico **não cria entrada** (13 jogos × um ponto de zeros
  por dia poluiria o storage e o sync de quem coleciona um só).
- Venda: **líquido = preço − taxa**, **resultado = líquido − pago**, e o BRL
  congelado vence a conversão de hoje. Registro antigo sem o congelado cai na
  moeda original — não some nem zera.

---

## 6. Bugs de dados corrigidos no caminho

1. **O somatório "Todos" zerava o jogo que não mediu no dia.** Agrupava por data
   e somava só quem tinha ponto naquela data: se o Pokémon registrou na terça e o
   Lorcana não, a terça saía valendo só o Pokémon. Medido no navegador: 02/07
   mostrava R$ 4.080 no lugar de R$ 8.006 — 49% a menos, num dia em que nada
   aconteceu. Agora cada jogo carrega o último valor conhecido pra frente.
2. **Jogo era desenhado valendo zero antes de existir.** Quem começou a
   acompanhar Lorcana um mês depois do Pokémon não teve a coleção valendo zero
   naquele mês. Antes do 1º ponto o valor é `null`, e a linha nasce onde a
   medição nasceu.
3. **A wishlist nunca somava.** `wishlistTotal` varre `cards`, mas a página só
   carregava as cartas que você *tem* — e carta desejada é, por definição, carta
   que você não tem. O número de "desejos" era na prática só o buraco dos
   binders. A carga inicial passou a pedir possuídas + desejadas na mesma
   requisição, como a `wishlist.js` sempre fez.
4. **O eixo Y descia abaixo de zero** num eixo de dinheiro (a folga de 12%
   embaixo, com coleção pequena).

---

## 7. Desvios do plano

- A F2 previa **histórico diário por lista** atrás de opt-in. Ficou de fora: o
  ganho é pequeno perto do risco de multiplicar chaves no `localStorage` e no
  payload de sync. Se voltar, nasce com teto de pontos e opt-in explícito.
- O plano falava em "3 cápsulas viram parte do gráfico"; na prática elas foram
  **removidas** — a variação da faixa no cabeçalho cobre 7D e 1M, que eram duas
  das três.
- O modo privacidade era pra ser novo; virou **extensão do `data-sensitive`** que
  já existia. Dois interruptores pro mesmo estado é como se descobre, no print,
  que só um deles estava ligado.

---

## 8. Fora de escopo (por decisão)

- **Binders/listas somando ao patrimônio** — seria contar em dobro.
- **Marketplace in-app** (estilo CollX): outra escala de produto. O caminho segue
  sendo lista + export pra Liga e grupos.
- **Custo por lote/FIFO**: o custo é unitário por carta×variante. Contabilidade
  por lote é sofisticação que nenhum tracker TCG tem. O primeiro passo natural, se
  a demanda aparecer, é a **data** opcional no custo (habilita tempo de posse e
  ROI anualizado, como o Card Ladder).
- **E-mail periódico de resumo**: é o loop de retenção do Card Ladder e do
  PriceCharting, mas exige infra de e-mail que o site não tem hoje.

---

## 9. Limites conhecidos

- O **índice de mercado** só existe a partir do próximo build (o arquivo é
  gerado, não versionado — `data/*.generated.json` é gitignored).
- O benchmark é **por jogo**; no filtro "Todos" ele é a média simples dos índices
  disponíveis, então cada mercado pesa igual.
- Cartas de lista/binder que não são suas entram numa 2ª etapa de carga, com
  **teto de 300 ids** sem jogo conhecido — o id não carrega a marca, então esses
  precisam ser pedidos a todos os jogos.
- A **retrospectiva** usa o histórico local: quem nunca abriu as telas pessoais
  no aparelho vê o que veio pelo sync, não mais que isso.
