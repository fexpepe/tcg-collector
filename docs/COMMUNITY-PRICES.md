# Preço da Comunidade + Graded no card — plano de execução

> Escrito em 2026-08-07 a partir do pedido do Fernando: um gráfico "Comunidade"
> ao lado dos de mercado (TCGplayer/Cardmarket), com DUAS séries — preços
> cadastrados e preços de venda — mais valores de graded no card, a opção de
> adicionar um slab de dentro do card, e uma reorganização do painel do card
> (referência: Collectr). Regra de ouro mantida: bloco sem dado NÃO aparece.

## 0. O que os dados de hoje permitem (e o que não)

| Sinal | Onde vive | Público? | Serve pra comunidade? |
|---|---|---|---|
| Preço manual (NM etc.) | `prices-v1` por usuário, BRL, sync | não | só com contribuição explícita |
| Venda realizada (sold) | `sold-v1` por usuário, sync | **não, por design** | idem |
| À venda (sales) | `public_profiles.data.sales` | sim (perfil público) | sim, mas é "pedida", não venda |
| Valor graded PSA | `TCG_PRICING.g` (PPT, USD) | sim (catálogo) | já é agregado externo |
| Histórico de mercado | `price-history.generated.json` | sim | é a série dos gráficos atuais |

Conclusão: **"preço da comunidade" exige um canal novo de contribuição**, no
molde do `card_views`/`deck_views` (tabela + RPC `security definer` + throttle
`_rate_ok`). Não dá pra minerar o que já existe sem quebrar a promessa de
privacidade do sold ("nunca entram no perfil público").

## 1. Modelo de dados (Supabase)

Uma tabela de PONTOS, um ponto por usuário×carta×dimensões×mês — o upsert por
PK é o que dá dedupe e resistência a manipulação (1 usuário = 1 voto):

```sql
create table community_prices (
  user_id   uuid not null,            -- p/ upsert e 1-voto; NUNCA legível por cliente
  game      text not null,            -- whitelist igual card_views
  card_id   text not null,
  variant   text not null,
  cond      text not null,            -- NM/SP/... (raw)
  kind      text not null,            -- 'listed' (cadastrado) | 'sold' (venda)
  company   text,                     -- graded: psa/bgs/cgc/sgc/tag (null = raw)
  grade     text,                     -- graded: "10", "9.5"...
  month     date not null,            -- bucket mensal (date_trunc)
  value_brl numeric not null,         -- normalizado em BRL na escrita
  updated_at timestamptz not null default now(),
  primary key (user_id, game, card_id, variant, cond, kind, coalesce-cols, month)
);
```

Regras de segurança (mesma filosofia do deck_views, mais rígida porque aqui há
valor monetário derivado de dado privado):

- **RLS sem NENHUMA policy de SELECT pra cliente** — nem o próprio dono lê a
  tabela crua pela API. Leitura só por RPC agregadora.
- Escrita só por RPC `contribute_price(...)`, `security definer`, exigindo
  `auth.uid()` (anônimo não contribui — também corta spam), com:
  - whitelist de game (igual `increment_card_view`),
  - clamp de valor (0 < v ≤ 1.000.000),
  - `_rate_ok('commprice', 60)`,
  - upsert pela PK (editar o preço substitui o próprio ponto, não acumula).
- Leitura: RPC `community_price_for(game, card_id)` devolvendo por
  (variant, kind, [company+grade], month): `n`, média APARADA (descarta
  topo/fundo quando n≥10) e mediana. **Só devolve bucket com n ≥ 3** — abaixo
  disso é (a) estatística ruim e (b) vazamento do preço de 1-2 pessoas.

Sobre "average": média pura é manipulável e sensível a erro de digitação (um
R$ 99.999 por engano arrasta tudo). **DECIDIDO (Fernando, 2026-08-07): a UI
exibe a MEDIANA**, rotulada "preço da comunidade"; o RPC também devolve a média
aparada, pra depuração e comparação.

## 2. Contribuição no cliente

Ganchos nos três pontos de gravação que já existem (todos passam por uma
função só, `contributePrice()` no shared.js):

1. `setPrice(...)` manual (grade de condições e o atalho NM) → kind `listed`.
2. `createSoldStore().add(...)` (registrar venda) → kind `sold`, convertendo
   `cur`→BRL com o câmbio do dia antes de enviar.
3. Edição de `value` de um slab graded → kind `listed` + company/grade.

Condições: logado, produção (`sleevu.app`, como o logCardView), fire-and-forget
com `keepalive` (falha em silêncio — contador é acessório).

**Privacidade — DECIDIDO (Fernando, 2026-08-07):** toggle nas Configurações
("Contribuir com o preço da comunidade"), **padrão LIGADO**, no mesmo padrão do
opt-out de analytics, + parágrafo na política de privacidade deixando claro que
sobe só (carta, valor, mês), nunca quem/quantidade/coleção. Entra na F2.

## 3. Gráfico "Comunidade" no card

- Mesmo componente do histórico atual (`price-history-chart`), série mensal.
- DUAS séries: **Cadastrados** (listed) e **Vendas** (sold), com `n` no tooltip
  ("mediana de 7 preços").
- Aparece SÓ quando algum bucket tem n≥3 (regra hide-if-empty de sempre).
- Uma chamada de RPC por card aberto, com cache em memória por sessão.
- Seletor de período (1M/3M/6M/1A) compartilhado com o gráfico de mercado —
  observação honesta: o alcance real depende da retenção; a série da
  comunidade nasce vazia e engorda com o uso.

## 4. Graded no card

**4a. Valores (agora):** bloco "Graded (PSA)" com os valores atuais do
`TCG_PRICING.g` — tabela nota→valor, com `n` e tendência que o nó já traz. Só
PSA, porque é o dado que existe; BGS/CGC ficam de fora até haver fonte (não
inventar). Some quando a carta não tem `g`.

**4b. Adicionar slab de dentro do card:** botão "+ Graded" no bloco de coleção
do preview (padrão visual do "+ Tag"), abrindo seletor de marca (GRADERS do
graded-ui: PSA/BGS/CGC/SGC/TAG), nota e pristine — grava via
`createGradedStore().add()` que já existe. Requer expor o hook de graded no
contexto do preview (mesmo caminho que tags/folders já fazem).

**4c. Histórico graded (futuro, fase própria):** estender o
`sync-price-history.mjs` pra também fotografar `g` por nota — aí o card ganha o
gráfico "Graded Price History" estilo Collectr, com uma linha por nota PSA.

## 5. Painel do card reorganizado (desktop e mobile)

Ordem proposta (desktop, coluna direita do preview):

1. **Identidade**: nome, set·número, raridade — como está.
2. **Ações**: Tenho/Quero/Compartilhar — como está.
3. **Minha cópia**: condições×qtd, coleção, tags, Paguei, atalho preço NM,
   **+ Graded** (novo), Vender por.
4. **Valores** (novo agrupamento): Mercado (TCGplayer/Cardmarket/PPT +
   histórico com 1M/3M/6M/1A) · **Comunidade** (novo) · **Graded PSA** (novo).
   Cada sub-bloco some sem dado.
5. **Comprar** : chips BR + EUA — os "market tags"; adicionar favicon/imagem
   por loja é cosmético e barato.
6. **Detalhes**: artista, nome original etc.

Mobile: mesma ordem numa coluna; blocos 4-6 como `<details>` recolhíveis
(padrão que os sets já usam) pra primeira dobra ser imagem+ações+minha cópia.

## 6. Fases de execução (cada uma shippável sozinha)

- **F0 — higiene de merge — FEITA (2026-08-07, commit "F0: merge de preço
  manual por CONDIÇÃO"):** carimbo `at` por condição com hora, tombstones de
  exclusão, merge por "opinião" (só disputa a condição quem tem preço ou
  tombstone nela), tolerante ao formato legado. Validada com 5 cenários.
- **F1 — backend — SQL PRONTO (2026-08-07, aguardando o Fernando aplicar):**
  `supabase/migrations/20260807a_community_prices.sql` + README. Curls de
  verificação no rodapé do arquivo.
- **F2 — contribuição:** `contributePrice()` + ganchos + toggle de privacidade
  + política atualizada.
- **F3 — gráfico Comunidade** no card (hide-if-empty).
- **F4 — graded no card:** bloco PSA + botão "+ Graded" no preview.
- **F5 — painel reorganizado** + market tags + passe mobile.
- **F6 (futuro) — histórico graded** no pipeline de snapshots.

Riscos assumidos: série da comunidade começa vazia (semanas até n≥3 nas cartas
populares); mediana≠média pode confundir quem compara com Collectr; graded
multi-marca sem fonte fica explícito como limitação.
