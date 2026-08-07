# Roadmap & estado do projeto

Resumo do que existe e do que vem a seguir, pra retomar o contexto em qualquer
sessão (local ou na nuvem) só pelo Git. Complementa o [README.md](README.md)
(que documenta a **arquitetura**) — aqui é o **plano** e as **decisões**.

**Tese:** um colecionador de cartas **multi-TCG**, grátis, local-first e em
português, com valores localizados pro Brasil. Não é concorrente pago do
Collectr — é a alternativa livre: sem cartão, sem plano "pro", sem limite de
cartas, com export a qualquer momento. A sincronização na nuvem, que noutro
produto seria o extra pago, aqui é grátis.

Última revisão: 2026-08-04.

---

## ✅ O que existe hoje

Detalhe técnico de cada item está no README; aqui é só o mapa.

**Catálogo — 12 jogos + JUMP em preparação.** Pokémon (5 idiomas, via TCGdex),
Lorcana, One Piece, Magic, Flesh and Blood, Gundam, Dragon Ball Fusion World,
Yu-Gi-Oh!, Digimon, Riftbound, Naruto e Hunter × Hunter — do lançamento de
ontem ao Carddass de 1999. Os vintage japoneses (Carddass Hyper Battle, Miracle
Battle, Data Carddass, Formation/Cross) foram levantados carta a carta de fontes
que não têm API, e ficam versionados como snapshot pra nunca regredir.

**Coleção.** Por variante **e condição** (escala LigaPokémon: M/NM/SP/MP/HP/D),
com quantidade por cópia. Páginas unificadas: a Coleção, o Portfólio, a Wishlist
e as demais pessoais leem todos os jogos de uma vez e filtram por jogo dentro da
página. Pastas, tags custom, custo pago por cópia e histórico de vendas.

**Portfólio.** Visão financeira da coleção: patrimônio (raw + graded, todos os
jogos), valor no tempo, custo médio, lucro nas vendas realizadas, maiores altas
e quedas da semana. O total bate com a Coleção porque a fórmula vive num lugar
só — a borda devolve dado, nunca o total calculado.

**Preços.** TCGplayer (USD) e Cardmarket (EUR) por carta, PokemonPriceTracker
pros preços JP e graded, câmbio do dia da AwesomeAPI, moeda escolhida pelo
usuário (BRL/USD/EUR). Histórico de preços sem servidor: a produção é o banco.

**Graded.** Slabs PSA/BGS/CGC/SGC/TAG com nota, certificado e valor — automático
por graduadora+nota quando a PPT tem, editável sempre. A carta do catálogo é
renderizada dentro de um slab sintetizado (sem foto).

**Decks.** Construtor multi-jogo com engine genérica + rule pack por jogo:
formatos, side/maybeboard, marcar carta como proxy, valor do deck separando o que
já se tem do que falta comprar. Galeria pública da comunidade com destaque por
visitas e páginas pré-renderizadas pra SEO. Ver [docs/DECKS.md](docs/DECKS.md).

**Binders.** Fichários 2×2/3×3/4×4 montados por clique, tipo coleção ou venda
(com preço/condição/nota), export da grade como imagem. Fotos do usuário ficam
100% locais no IndexedDB.

**Vendas e trocas.** Lista com preço e condição, valor total, link público ou
imagem pros grupos. A wishlist cruza com quem tem à venda (RPC `find_sellers`).

**Conta (opcional).** Login por link mágico ou Google, sync multi-jogo na nuvem,
perfil público em `/users/<handle>` (nasce público, com escolha do @ no primeiro
login), badges, notificação de queda de preço por web push. Sem conta, o app
funciona igual — tudo no `localStorage`.

**Infra.** PWA instalável e offline, API na borda com D1 (busca global e "só as
minhas cartas"), páginas de set/carta/deck pré-renderizadas, CSP e cabeçalhos de
segurança, analytics first-party anônimo com painel `/admin`, uptime probe,
Turnstile no login, SMTP próprio (Resend), CI com testes e guardas de mobile.

**Idiomas.** Site em pt/en/es; cartas em Todas/PT/EN/JA/ZH.

---

## 🔜 Próximos passos (em ordem)

### 0. Preço da Comunidade + graded no card — **F0 a F4a no ar; falta F4b e o visual da F5**
Plano e estado por fase em `docs/COMMUNITY-PRICES.md`. Prontas: F0 (merge de
preço por condição), F1 (SQL aplicado e verificado), F2 (contribuição + toggle
em Configurações → Privacidade + política), F3 (gráfico com Cadastrados ×
Vendas, mediana e n) e F4a (valores PSA no card). Faltam:
- **F4b** "+ Graded" de dentro do card — precisa do hook `graded` no
  `createCardPreview` (hoje ele não recebe) ou o store no shared;
- **F5 visual** — reordenar os blocos, recolher os de valores no celular e os
  market tags com ícone: exige revisão com screenshot;
- **F6** histórico graded no pipeline de snapshots.

O gráfico só aparece quando uma carta tem 3+ contribuições — então ele nasce
invisível e enche com o uso.

### 1. Preço BR de verdade (MYP) — **a tese do projeto, travada num e-mail**
"Valores localizados pro Brasil" é a promessa central, e hoje o preço BR só
existe como registro manual. O lado do código está pronto: `sync-myp.mjs` existe,
o front já lê `TCG_PRICING.b` e mostra a linha "Brasil · MYP", e o passo do
deploy é no-op enquanto o secret não existir. Falta:

1. pedir o `X-Api-Token` ao suporte do MYP;
2. rodar `MYP_API_TOKEN=… node scripts/sync-myp.mjs pokemon` e inspecionar a
   resposta real (nomes de campos, paginação);
3. finalizar o matching carta↔MYP (`edition_code` + número e/ou nome);
4. adicionar o secret `MYP_API_TOKEN` no GitHub.

Destrava também o preço BR do One Piece, que espera a mesma fonte.

### 2. Lançar
O site está tecnicamente pronto pra ter gente: SMTP próprio, Turnstile, rate
limits, uptime, analytics, zero migração pendente. Antes de divulgar:

- colar o template de `supabase/email-templates/magic-link.html` também na aba
  **Magic Link** do painel (o Confirm signup já está customizado; usuário que
  volta ainda recebe o e-mail padrão em inglês);
- semear conteúdo: o "Em destaque" da galeria é por visitas, então a vitrine não
  pode nascer vazia.

### 3. Fase 0 dos decks — enriquecer o catálogo
Os dois jogos mais pedidos (Pokémon e Magic) são os mais pobres em dados de deck,
e **os campos já vêm na resposta da API e são descartados** ao montar a carta:
`type_line`/`mana_cost`/`cmc`/`colors` no Scryfall, `types`/`stage` no TCGdex.
São ~4 linhas em cada sync + re-sync, e tiram os dois do modo livre. Ver a seção
"Fase 0" de [docs/DECKS.md](docs/DECKS.md).

### 4. Magic em português
O catálogo está em EN v1 e o Scryfall já traz nome e imagem impressos em pt —
reforça a tese "em português" no segundo jogo mais popular do site.

### 5. Polimento acumulado
- **Nomes dos 67 sets do Naruto** seguem em japonês (aparecem no seletor, no tile
  e 2× no modal). Decisão pendente do Fernando: traduzir (como já foi feito com
  os nomes das cartas, com o original guardado em `nameJp`) ou manter.
- **Espanhol nas páginas de conteúdo**: Sobre/Ajuda/FAQ/Privacidade/Termos ainda
  caem no fallback pt.
- **JUMP**: o slug existe e o compilador de curadoria roda, mas o catálogo está
  vazio — decidir se entra de verdade ou sai do registro.
- **Realce de 100%** nos cards de set/artista, como o dourado da Pokédex.

---

## 💡 Backlog / ideias

- **Naruto moderno (2027)**: `sync-naruto.mjs` está dormente esperando a
  categoria no TCGCSV. Quando ela existir, decidir o dedupe com a promo curada
  (`nrt-ncg-cp-001`) — ids são pegajosos por design.
- **Vintage ainda não importado**: Naruto CCG (Bandai USA, 2006–2013, 28 sets) e
  o `nrts` do tcg-db (NARUTO 疾風伝 カードゲーム). HxH Hyper Battle/Masters
  seguem sem fonte com nome + imagem.
- **Worker de preços BR** (LigaBRA/LigaPokémon) como complemento do MYP. MYP e
  MYP só: as ligas não têm API pública e o CORS impede fazer do navegador.
- **Raridade em zh**: a TCGdex traz a maioria das cartas chinesas sem raridade.
- **Índice de busca** com MiniSearch/FlexSearch, se a busca da borda não bastar.
- **IndexedDB pra coleção**, se o `localStorage` apertar.

---

## 🔒 Decisões tomadas (não reabrir sem motivo novo)

- **Site único, jogo é sessão.** O plano antigo de subdomínios
  (`poke.sleevu.app`, `lorcana.sleevu.app`) foi substituído pelo modelo
  `?game=`/`?line=` com sessão no `localStorage` — está implementado e
  documentado no cabeçalho do [src/game.js](src/game.js).
- **Sem upload de foto por carta/slab.** Fotos existem só nos binders, e ficam
  no IndexedDB do próprio navegador.
- **Nada de backend em runtime pro preço.** Preço é puxado no build e servido
  estático: mantém o site estático, o token seguro no CI e o custo previsível.
- **A borda devolve dado, não total.** Uma fórmula de valor só, no cliente —
  duas fórmulas divergem, e esse bug já custou caro.
- **Catálogo versionado é a durabilidade.** Fonte fora do ar congela o catálogo
  em vez de esvaziá-lo; nenhum item de portfólio pode sumir.
- **Chinês é um só.** zh-cn (simplificado) é o padrão, com zh-tw fundido dentro
  do mesmo eixo "ZH".
- **Conta é opcional, pra sempre.** Todo recurso tem que funcionar sem login.
