# Roadmap & estado do projeto

Resumo do que existe e do que vem a seguir, pra retomar o contexto em qualquer
sessão (local ou na nuvem) só pelo Git. Complementa o [README.md](README.md)
(que documenta a **arquitetura**) — aqui é o **plano** e as **decisões**.

**Tese:** um colecionador de cartas **multi-TCG**, grátis, local-first e em
português, com valores localizados pro Brasil. Não é concorrente pago do
Collectr — é a alternativa livre: sem cartão, sem plano "pro", sem limite de
cartas, com export a qualquer momento. A sincronização na nuvem, que noutro
produto seria o extra pago, aqui é grátis.

Última revisão: 2026-09-14.

---

## ✅ O que existe hoje

Detalhe técnico de cada item está no README; aqui é só o mapa.

**Catálogo — 14 jogos + JUMP em preparação.** Pokémon (5 idiomas, via TCGdex),
Lorcana, One Piece, Magic, Flesh and Blood, Gundam, Dragon Ball Fusion World,
Yu-Gi-Oh!, Digimon, Riftbound, Union Arena, Naruto, Hunter × Hunter e Dragon Ball
Carddass — do lançamento de ontem ao Carddass de 1988. Os vintage japoneses (Carddass Hyper Battle, Miracle
Battle, Data Carddass, Formation/Cross) foram levantados carta a carta de fontes
que não têm API, e ficam versionados como snapshot pra nunca regredir.

**Coleção.** Por variante **e condição** (escala LigaPokémon: M/NM/SP/MP/HP/D),
com quantidade por cópia. Páginas unificadas: a Coleção, o Portfólio, a Wishlist
e as demais pessoais leem todos os jogos de uma vez e filtram por jogo dentro da
página. Pastas, custo pago por cópia e histórico de vendas.

**Listas.** Checklist de um set ou lista avulsa, com modo compacto (uma linha
por carta, sem imagem — a tela de cadastro em série), export pra LigaPokémon /
texto / CSV, "aplicar à coleção" com prévia do delta e criar deck a partir da
lista. As **tags custom viraram listas** (migração automática por navegador).
Ver [docs/LISTAS.md](docs/LISTAS.md).

**Portfólio 2.0.** Visão financeira da coleção: patrimônio (raw + graded, todos
os jogos) com **uma linha por jogo** no gráfico e um modo **%** que compara
desempenho em vez de tamanho; valor das **listas e binders** (com "custo pra
completar"); **vendas realizadas** em seção própria — taxas/frete, câmbio
congelado na data, resultado por mês e nota de cobertura ("considera N de M
vendas"); movers das **suas** cartas por impacto no bolso; **benchmark** contra o
índice de mercado do jogo; modo privacidade e retrospectiva anual. O total bate
com a Coleção porque a fórmula vive num lugar só — a borda devolve dado, nunca o
total calculado. Ver [docs/PORTFOLIO.md](docs/PORTFOLIO.md).

**Preços.** TCGplayer (USD) **por impressão** — Normal, Holo, Reverse, 1st
Edition — via TCGCSV, diário, pro Pokémon EN e JP; Cardmarket (EUR) da TCGdex;
PokemonPriceTracker pro graded; câmbio do dia da AwesomeAPI, moeda escolhida
pelo usuário (BRL/USD/EUR). Os sets JP que a TCGdex não tem (promos S-P/SM-P/
XY-P, eras DP/BW/XY) entram inteiros pela TCGCSV; set EN recém-lançado que a
TCGdex ainda não publicou entra inteiro por pin (`enImport`) — decisão de
16/09/2026, quando o 30th Celebration saiu no mundo todo sem PR na TCGdex e os
concorrentes (Collectr, Dex) já o mostravam a partir do grupo do TCGplayer. O
`setId` do pin é uma aposta no id que a TCGdex vai usar, e ela erra: em
18/09/2026 o set chegou lá como `30th`/`30th-c` e ficou AO LADO do nosso
`cel30`/`cel30cc` — 4 coleções de 30 anos onde existem 2. Desde então quem
aposenta o duplicado é o `retire-imported-sets.mjs`, em todo build, com o
de-para de `cardId` versionado pra ninguém perder o que marcou (ver
"Aposentadoria do set importado" no README). Com essa rede no lugar, em
19/09/2026 o pin deixou de ser obrigatório: grupo EN de era moderna, dos
últimos 90 dias e com 20+ singles entra sozinho, e o id provisório é aposentado
quando a TCGdex publicar o dela. A régua de fonte está fixada no README ("Quem
manda em quê"): TCGdex é o CATÁLOGO, TCGCSV é o PREÇO, e o inglês não sai da
TCGdex — onde a TCGCSV domina (o japonês) metade das cartas fica sem artista e
sem tipo. PT
e ZH continuam dependendo da TCGdex: o TCGplayer só vende EN e JP. Histórico de
preços sem servidor: o acervo vive no R2 desde 20/09/2026 (antes a produção era
o único banco, e produção fora do ar + cache expirado recomeçava o histórico do
zero); segue o de-para de id, então carta aposentada não perde a série. O
conjunto — catálogo TCGdex, lançamento TCGCSV, preço por impressão, histórico
no R2, espelho de imagem, id como contrato com de-para — está fixado no README
como o **modelo de carregamento do Pokémon EN, v1**: é a régua pra trazer JA,
PT e ZH. Decisão de 14/09/2026, depois da comparação com
o TCG Collector: a tabela tinha um preço por carta (o do Normal), o preço JP
dependia de crédito e chegava atrasado, e promos JP estavam injetadas em sets
EN — ver "Preço do Pokémon" no README.

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

**Conta.** Login por link mágico ou Google, sync multi-jogo na nuvem, perfil
público em `/users/<handle>` (nasce público, com escolha do @ no primeiro login),
badges, notificação de queda de preço por web push. As **páginas pessoais exigem
login** desde 2026-07-14 (`enforceLoginGate`); o dado continua vivendo no
aparelho (local-first), mas o cadastro não existe mais "sem conta". Catálogo,
busca, decks públicos, perfis e links `?s=` seguem abertos.

**Scanner de carta.** Câmera + OCR no aparelho (Tesseract.js em WASM,
auto-hospedado) lendo o código impresso e buscando no catálogo — fase 1 em
2026-09-09; vintage por hash perceptual é a fase 2. Ver
[docs/PLANO-SCANNER.md](docs/PLANO-SCANNER.md).

**Infra.** PWA instalável e offline, API na borda com D1 (busca global e "só as
minhas cartas"), páginas de set/carta/deck pré-renderizadas, CSP e cabeçalhos de
segurança, analytics first-party anônimo com painel `/admin`, uptime probe,
Turnstile no login, SMTP próprio (Resend), CI com testes e guardas de mobile.

**Idiomas.** Site em pt/en/es; cartas em Todas/PT/EN/JA/ZH. O japonês está na
v2 do modelo de carregamento (README, "v2 — japonês"): série em toda era,
categoria/tipo/estágio pelo irmão inglês e nome em inglês pesquisável já no
ar; nome japonês, raridade, ilustrador e scans vintage dependem da primeira
rodada local do `sync-bulbapedia-ja.mjs`.

---

## 🔜 Próximos passos (em ordem)

> A segunda análise competitiva (2026-08-29) e o plano de execução — trilha de
> performance sem perder qualidade, 10 melhorias, 10 features e extras — estão
> em [docs/PLANO-UX-2.md](docs/PLANO-UX-2.md). O item 1 abaixo (preço BR/MYP)
> ganhou um caminho novo lá (F1: a API pública da MYP tem Swagger atualizado).

### 0. Preço da Comunidade + graded no card — **F0 a F6 no ar**
Plano e estado por fase em `docs/COMMUNITY-PRICES.md`. Prontas: F0 (merge de
preço por condição), F1 (SQL aplicado e verificado), F2 (contribuição + toggle em
Configurações → Privacidade + política), F3 (gráfico com Cadastrados × Vendas,
mediana e n), F4a (valores PSA no card), F4b ("+ Graded" de dentro do card, via
hook opcional no `createCardPreview`) e F5 (painel reorganizado; "Detalhes" virou
`<details>` no fim e abre fechado no celular) e F6 (2026-09-14: o
`sync-price-history.mjs` fotografa o `g` por nota PSA em
`graded-history.generated.json`, e o card desenha uma linha por nota assim que
houver 2+ pontos — nasce invisível e enche a 1 ponto/dia, como o de mercado).

O gráfico só aparece quando uma carta tem 3+ contribuições — então ele nasce
invisível e enche com o uso.

Fora de escopo por decisão: os "market tags" com ícone por loja (exigiria asset
curado por loja) e contribuir o preço **pago** (ver a nota de privacidade em
[docs/BACKEND.md](docs/BACKEND.md)).

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

### 3. Regras de deck além de Pokémon, Magic e Yu-Gi-Oh!
A "Fase 0" (enriquecer o catálogo) **está feita**: `sync-magic.mjs` grava
`type_line`/`mana_cost`/`cmc`/`colors`/`color_identity` e o `sync-tcgdex.mjs`
grava `types`/`stage`, e os rule packs de Pokémon, Magic (8 formatos) e
Yu-Gi-Oh! vivem em [src/deck-rules.js](src/deck-rules.js). O que falta é o
mesmo tratamento nos outros jogos, que seguem em modo livre — cada um precisa
do seu pack (zonas, limite por carta, formatos).

### 4. Magic em português
O catálogo está em EN v1 e o Scryfall já traz nome e imagem impressos em pt —
reforça a tese "em português" no segundo jogo mais popular do site.

### 5. Polimento acumulado
- **Nomes dos 67 sets do Naruto** seguem em japonês (aparecem no seletor, no tile
  e 2× no modal). Decisão pendente do Fernando: traduzir (como já foi feito com
  os nomes das cartas, com o original guardado em `nameJp`) ou manter.
- **JUMP**: o slug existe e o compilador de curadoria roda, mas o catálogo está
  vazio — decidir se entra de verdade ou sai do registro.
- **Peso do núcleo**: o `shared.js` saiu de 99% pra ~89% do teto em 2026-09-14
  (importação de backup/CSV, resgate de `?card=` e facetas de set viraram
  módulos por página ou sob demanda) e o CSS passou a ser medido pelo NÚCLEO
  que toda página baixa, com o split por área rodando no CI. Bloco frio novo
  continua tendo que nascer fora do `shared.js` — o padrão está em
  `src/backup-import.js`.

(Saíram daqui em 2026-09-14, por já estarem no ar: o espanhol das páginas de
conteúdo — `src/i18n-docs.js` cobre Sobre/Ajuda/FAQ/Privacidade/Termos nos três
idiomas — e o realce dourado de 100% nos cards de set/artista.)

---

## 💡 Backlog / ideias

- **Naruto moderno (2027)**: `sync-naruto.mjs` está dormente esperando a
  categoria no TCGCSV. Quando ela existir, decidir o dedupe com a promo curada
  (`nrt-ncg-cp-001`) — ids são pegajosos por design.
- **Vintage ainda não importado**: Naruto CCG (Bandai USA, 2006–2013, 28 sets) e
  o `nrts` do tcg-db (NARUTO 疾風伝 カードゲーム). HxH Hyper Battle/Masters
  seguem sem fonte com nome + imagem.
- **Dragon Ball Carddass (`dbc`)**: entrou só o Hondan 第1弾–第18弾, sem imagem.
  Faltam (1) o Hondan 第19弾–第31弾, que o sync pega sozinho quando o 80storage
  publicar; (2) Super Battle, Visual Adventure e Super Barcode Wars, sem fonte
  carta a carta acessível; (3) scans — o dragonballcards.com tem, mas é só HTTP;
  (4) raridade (prisma × regular), que nenhuma fonte marca por carta.
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
- **Pokémon EN é a v1 do modelo de carregamento** (20/09/2026; README, "Modelo
  de carregamento do Pokémon EN — v1"). Id é o contrato, id que muda tem
  de-para, carta indexada nunca some, fonte fora do ar congela, e o que é nosso
  fica no nosso servidor (git, R2, D1). Idioma novo entra por essa régua, não
  por uma régua própria.
- **Japonês (v2) enriquece, não troca de fonte.** TCGdex segue o contrato de
  id; a TCGCSV segue trazendo os sets que ela não tem; o que falta (série,
  categoria, nome japonês, raridade, ilustrador, scans vintage) entra por
  `enrich-ja` só em campo vazio, com a Bulbapedia como fonte de ingestão
  OFFLINE (cache versionado, imagem no R2, crédito no Sobre). O site oficial
  pokemon-card.com fica de fora: sem API e sem termos que permitam copiar.
- **Nada de backend em runtime pro preço.** Preço é puxado no build e servido
  estático: mantém o site estático, o token seguro no CI e o custo previsível.
- **A borda devolve dado, não total.** Uma fórmula de valor só, no cliente —
  duas fórmulas divergem, e esse bug já custou caro.
- **Catálogo versionado é a durabilidade.** Fonte fora do ar congela o catálogo
  em vez de esvaziá-lo; nenhum item de portfólio pode sumir.
- **Chinês é um só.** zh-cn (simplificado) é o padrão, com zh-tw fundido dentro
  do mesmo eixo "ZH".
- **O dado é do usuário, sempre.** O `localStorage` é a fonte da verdade e o
  export está a um clique — a nuvem sincroniza, não aprisiona. (Esta linha já
  disse "conta é opcional, pra sempre"; deixou de valer em 2026-07-14, quando as
  páginas pessoais passaram a exigir login por decisão do Fernando — "tá confuso
  elas existirem sem logar". O que permanece é o local-first, não o anonimato.)
