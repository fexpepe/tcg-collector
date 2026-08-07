# Decks — plano (construtor multi-jogo)

Seção de **construção de decks**: o usuário cria um deck, escolhe o jogo (e o
formato, quando o jogo tem), busca cartas **daquele jogo**, monta a lista e vê o
**valor total** — separando o que já tem na coleção do que falta comprar.

Princípio: **engine genérica + "rule pack" por jogo**. O motor não sabe as regras
de nenhum jogo; ele lê um pacote declarativo. Isso permite entregar todos os 12
jogos desde o dia 1 (em modo livre) e ir apertando as regras jogo a jogo.

---

## 1. Realidade dos dados (a restrição que define o escopo)

Levantamento feito nos catálogos (`data/<jogo>/cards.js`). É isto que determina
o que é **viável** hoje:

| Jogo | Campos úteis pra deck | Nível |
|---|---|---|
| **Lorcana** | `ink`, `cost`, `cardType` | 🟢 regras reais |
| **One Piece** | `opColor`, `cost`, `cardType` (tem `Leader`), `power` | 🟢 regras reais |
| **Digimon** | `color`, `cost`, `level`, `cardType` (tem `Digi-Egg`) | 🟢 regras reais |
| **Gundam** | `color`, `cost`, `level`, `cardType` | 🟢 regras reais |
| **DBFW** | `color`, `cost`, `cardType` | 🟢 regras reais |
| **Yu-Gi-Oh!** | `cardType` (dá pra derivar Extra Deck), `attribute`, `monsterType` | 🟡 parcial |
| **Flesh and Blood** | `cardType` (tem `Hero`), `pitch`, `talent` | 🟡 parcial (falta `class`) |
| **Riftbound** | `cardType`, `domain`, `tag` | 🟡 parcial (regras do jogo ainda novas) |
| **Pokémon** | só `category` (`Trainer`/vazio) | 🔴 modo livre |
| **Magic** | **nenhum** (sem cor, custo ou tipo) | 🔴 modo livre |
| **Naruto / HxH** | nenhum (vintage) | 🔴 modo livre — e tudo bem |

**A ironia:** os dois jogos mais pedidos (Pokémon e Magic) são os mais pobres em
dados. Mas o conserto é barato — ver Fase 0.

---

## 2. Fase 0 — enriquecer o catálogo (destrava tudo)

Nenhuma fonte nova é necessária: **os dados já vêm na resposta da API e são
descartados na hora de montar o objeto da carta.**

**Magic** — `scripts/sync-magic.mjs`. O objeto `c` do Scryfall já traz
`type_line`, `mana_cost`, `cmc`, `colors` e `color_identity`. Basta gravá-los
(vira ~4 linhas em [scripts/sync-magic.mjs:127](../scripts/sync-magic.mjs)).
Destrava: curva de mana, identidade de cor, Commander (singleton + color
identity), separar terreno básico do limite de 4 cópias.

**Pokémon** — `scripts/sync-tcgdex.mjs`. Já grava `category`; falta `types`
(Fire/Water…) e `stage` (Basic/Stage 1/…), que o TCGdex fornece. Destrava:
identificar **energia básica** (isenta do limite de 4) e a curva de estágios.

> Custo estimado: baixo (editar 2 scripts + re-sync). Ganho: Pokémon e Magic
> saem do 🔴 para 🟢. **Recomendo fazer antes da Fase 1.**

---

## 3. Modelo de dados

Segue o padrão do binder ([src/binders.js:243](../src/binders.js)): **um store
global cross-game**, com o jogo gravado em cada item.

```js
// localStorage: "tcg-collector-decks-all-v1"
{
  decks: [{
    id: "dk_1a2b3c",
    game: "lorcana",           // qual jogo — define rule pack, busca e coleção
    format: "core",            // slug do formato dentro do rule pack
    name: "Amber/Steel Aggro",
    notes: "",
    coverCardId: "1-1",        // carta de capa da galeria
    zones: {                   // as zonas VÊM do rule pack
      main:   [{ id: "1-1", qty: 4, variant: "Normal" }],
      leader: [],              // One Piece / DBFW
      egg:    [],              // Digimon
      extra:  [], side: []     // Yu-Gi-Oh! / Magic
    },
    createdAt: 1730000000000,
    updatedAt: 1730000000000
  }]
}
```

Notas:
- **`variant` por entrada** — é o que faz o valor bater (Normal ≠ Foil). Padrão:
  a variante mais barata; o usuário pode trocar (afeta só o preço, não a regra).
- Decks são **leves** (só id + qty): centenas cabem no `localStorage` sem drama.
- Entra de graça no sync do Supabase (Fase 2 do [BACKEND.md](BACKEND.md)) — é só
  mais uma chave no JSON do usuário.

---

## 4. Rule pack (o coração)

Declarativo, um objeto por jogo em `src/deck-rules.js`. O motor lê; não conhece
nenhum jogo.

```js
DECK_RULES.lorcana = {
  formats: [{ slug: "core", label: "Padrão" }],
  zones: [{ key: "main", label: "Deck", min: 60, max: null }],
  copyLimit: 4,
  copyKey:  (card) => card.name,          // o que conta como "a mesma carta"
  exempt:   (card) => false,              // ex.: energia básica / terreno básico
  identity: { field: "ink", max: 2, label: "Tintas" },
  facets:   ["ink", "cost", "cardType", "rarity"],  // filtros da busca
  curve:    { field: "cost", max: 10 }    // histograma do painel de análise
};

DECK_RULES.onepiece = {
  formats: [{ slug: "standard", label: "Standard" }],
  zones: [
    { key: "leader", label: "Líder", min: 1, max: 1, filter: (c) => c.cardType === "Leader" },
    { key: "main",   label: "Deck",  min: 50, max: 50, filter: (c) => c.cardType !== "Leader" }
  ],
  copyLimit: 4,
  copyKey: (card) => card.number,         // OP limita por NÚMERO, não por nome
  // cores do deck têm que caber nas do líder
  identityFrom: { zone: "leader", field: "opColor", split: ";" },
  facets: ["opColor", "cost", "cardType", "power"],
  curve:  { field: "cost", max: 10 }
};
```

Jogos sem rule pack caem no **modo livre** automático: zona única, sem limites,
sem validação — mas com busca, valor e "tenho na coleção" funcionando.

### Regras por jogo (a implementar por pacote)

| Jogo | Zonas | Cópias | Identidade |
|---|---|---|---|
| Lorcana | main 60+ | 4 | máx. 2 inks |
| One Piece | leader 1 + main 50 | 4 (por número) | cores ⊆ líder |
| Digimon | main 50 + egg 0–5 | 4 | — |
| DBFW | leader 1 + main 50 | 4 | — |
| Yu-Gi-Oh! | main 40–60 + extra 0–15 + side 0–15 | 3 | Extra derivado do `cardType` (Fusion/Synchro/Xyz/Link) |
| Pokémon¹ | main 60 exato | 4 | energia básica isenta |
| Magic¹ | main 60+ / side 15 · Commander 100 singleton | 4 | terreno básico isento; color identity |
| Gundam / FAB / Riftbound | **⚠️ confirmar antes de codar** | — | — |

¹ depende da Fase 0.

> ⚠️ **Não codar regra de cabeça.** Gundam, FAB e Riftbound são recentes e eu não
> tenho certeza das listas oficiais (deck base/resource do Gundam, legalidade por
> class/talent no FAB, runas do Riftbound). Confirmar na regra oficial e só então
> escrever o pacote — até lá, modo livre.

---

## 5. Validação = conselho, nunca bloqueio

`validate(deck)` devolve uma lista de avisos:

```js
[{ level: "error" | "warn" | "info", code: "copy-limit", msg: "…", cardId }]
```

**O deck salva sempre**, mesmo ilegal. Três motivos:
1. Regras mudam (bans, formatos rotativos) — um pacote desatualizado não pode
   travar o usuário.
2. Dado incompleto (carta sem `ink`) não pode virar erro fatal.
3. O usuário está **especulando** — brew incompleto é o estado normal enquanto
   monta.

A UI mostra um selo: ✅ legal · ⚠️ N avisos · ✍️ rascunho (modo livre).

---

## 6. Valor — o diferencial

O painel de valor é o que amarra deck ↔ coleção ↔ portfólio, e é o número que
nenhum deck builder concorrente dá:

```
Valor do deck        R$ 1.240
├─ Já tenho          R$   890   (32 cartas na coleção)
└─ Falta comprar     R$   350   (8 cartas)  ← o número que importa
```

- Preço por carta: `TCGShared.cardValue(card, variant, prices, condition)`
- Moeda/câmbio: `getCurrency` + `convertMoney` (já existem)
- Nas cartas que faltam: `brMarketplaceLinks(card)` → links de compra prontos
- Posse: lê a coleção do jogo do deck (`gameKey("collection-v3", deck.game)`)

**Selo de posse** em cada carta do deck e da busca:
`✔ tenho ×3` · `⚠ tenho ×1, faltam 3` · `✖ não tenho`.

Detalhe: a mesma carta pode estar em vários decks. Contar posse por deck
isoladamente é o certo (nada de "reservar" carta); um aviso opcional
"usada em 3 decks" fica pra Fase 3.

---

## 7. UX

### Duas páginas, dois públicos

| Página | Quem vê | Papel |
|---|---|---|
| `decks.html` | **qualquer visitante** (sem login) | Galeria da **comunidade** — em alta, novos, mais copiados, filtro por jogo. Indexável. |
| `my-decks.html` | só logado | **Meus Decks**: os que o usuário criou **+** os que salvou da comunidade. `noindex`. |

**Decks fica no menu do topo**, fora da Coleção — é a porta de entrada de quem
ainda não tem conta (deck público é o conteúdo que atrai de fora). Coleção e
Portfólio continuam só no logado. "Meus Decks" entra pelo Dashboard e acende a
Coleção no menu, porque é área pessoal.

Login é exigido pra **criar, salvar e publicar** — nunca pra ver. O muro fica na
ação, não na leitura.

### Galeria (dentro de cada página)
Grid de decks com capa, nome, jogo (bolinha na cor do jogo), contagem, valor e
selo de legalidade. Em `my-decks.html`, botão **"Criar novo deck"** e duas
seções: *Criados por mim* e *Salvos da comunidade* (com crédito ao autor).

### Criar (modal, 2 passos)
1. **Jogo** — os 12, cada um com sua cor.
2. **Formato** — só aparece se o rule pack tiver mais de um (ex.: Magic →
   Standard/Commander). Jogo com um formato só pula o passo.
3. Nome (opcional; "Deck sem nome" serve).

→ abre direto no editor. Sem fricção.

### Editor — 2 colunas
```
┌────────────────────────────┬──────────────────────┐
│ ZONAS DO DECK              │ BUSCA (só deste jogo)│
│ Líder      1/1             │ [ buscar carta… ]    │
│ [carta]                    │ facetas: cor/custo/  │
│                            │          tipo        │
│ Deck      47/50   ⚠ 3      │ ┌──┬──┬──┐           │
│ [4×][4×][3×][2×] …         │ │  │  │  │ ← clique  │
│                            │ ├──┼──┼──┤   +1      │
│ ── Valor ──                │ │  │  │  │   shift   │
│ Total      R$ 1.240        │ └──┴──┴──┘   -1      │
│ Tenho      R$   890        │ selo "tenho" em cada │
│ Falta      R$   350        │                      │
│ ── Curva ──   ▁▃█▅▂        │                      │
└────────────────────────────┴──────────────────────┘
```

- **Busca travada no jogo do deck** — nunca mistura catálogos.
- Clique = +1, shift+clique = −1, respeitando o limite de cópias (avisa, não
  impede).
- Cartas **dentro e fora da coleção** entram igual; muda só o selo.
- **Salvamento**: autosave com debounce + botão explícito (o binder já faz isso).
- Ações: renomear, duplicar, excluir, definir capa, **editar a qualquer momento**.

### Mobile
Vira abas (Deck | Buscar) em vez de 2 colunas.

---

## 8. Ponto técnico crítico — carregar catálogo pra busca

Em produção o catálogo é **chunked por set** (manifest). Carregar o catálogo
inteiro no editor é inviável pra **Yu-Gi-Oh! (46k cartas)** e Magic.

Solução: reusar o padrão da paleta de comandos
([src/shared.js:672](../src/shared.js) — `cmdkLoadGameMeta` + `cmdkChunkCache`):
manifest primeiro, chunks sob demanda, cache em memória.

Se a busca por nome se mostrar lenta nos catálogos gigantes, a saída é um
**índice leve por jogo** (`data/<jogo>/search-index.json` com `id`, `name`,
`setId`, `number` + campos de faceta) gerado no build. Fica como contingência —
medir antes de construir.

---

## 9. Arquivos

| Arquivo | Papel |
|---|---|
| `decks.html` | Página (galeria + editor) |
| `src/decks.js` | Motor, store, UI |
| `src/deck-rules.js` | Rule packs por jogo (declarativo) |
| `src/i18n.js` | Chaves `decks.*` (pt/en) |
| `styles.css` | Bloco `/* DECKS */` |
| `src/shared.js` | Registrar no nav + tabbar mobile |

Reusa pronto: `createCollectionStore`, `createPriceStore`, `cardValue`,
`sumCardsValue`, `matchesCardQuery`, `loadCatalog`, `createCardPreview`,
`formatMoney`, `convertMoney`, `createShare`, `toastUndo`, `notifyStorageFull`,
`GAME_COLOR`, `gameLabel`.

---

## 10. Fases

**Fase 0 — enriquecer catálogo** (Magic + Pokémon). Barato, destrava o resto.

**Fase 1 — MVP**: store + galeria + criar/editar/salvar + busca por jogo + valor
(total/tenho/falta) + **modo livre em todos os 12 jogos** + rule packs de
**Lorcana, One Piece e Digimon** (os de dado mais limpo).

**Fase 2** ✅: rule packs de Pokémon, Magic (Standard × Commander), Yu-Gi-Oh! e
DBFW + **formatos** + painel de análise (curva, cor, raridade).

Aprendizados da Fase 2, pra quem for mexer:
- **Zonas `manual: true`.** Side/Sideboard/Comandante aceitam carta mas NÃO são
  destino automático — senão todo lendário viraria comandante e toda carta cairia
  no side em vez do main. O editor mostra um botão por zona quando há escolha.
- **`{game}` é token RESERVADO do i18n** ([src/shared.js:1041](../src/shared.js)):
  `t()` troca por conta própria pelo jogo da SESSÃO. Numa tela que fala do jogo
  do DECK (que pode ser outro), use outro nome — aqui virou `{deckGame}`.
- **`data-game` está no `<html>`** (o game.js marca a sessão). Um
  `closest("[data-game]")` dentro de qualquer componente casa com ele. Os
  seletores próprios usam `data-pick-game`.
- Extra Deck do YGO sai de `/Fusion|Synchro|Xyz|Link/` no `cardType` — conferido
  nos 110 tipos do catálogo: Ritual e Pendulum ficam no main, e
  "Xyz/Pendulum/Effect Monster" vai pro Extra, como manda a regra.

**Fase 3** ✅ (menos um item): import em texto (colar lista do
Moxfield/Limitless/Dreamborn), copiar a lista, duplicar. **Falta** "usada em N
decks" — exige varrer todos os decks por carta, e ninguém pediu ainda.

**Fase 4** ✅: decks públicos + comunidade (seção 12).

**Fase 5** ✅: sync na nuvem junto com o resto do save (`SYNC_KEYS.decks`, global
— cada deck carrega seu próprio `game`).

**Fase 6** ✅ — **o que o Moxfield tem e faltava aqui** (pedido do Fernando com o
Moxfield como referência):
- **Sideboard e Maybeboard** como zonas de verdade (o "maybe" é `scratch`: conta
  no valor, não conta no tamanho legal do deck);
- **8 formatos de Magic** (os mais jogados), não só Standard × Commander;
- **mais de um comandante e mais de uma cópia** quando o jogador quiser — Partner
  e Relentless Rats existem, e o site bloqueava jogada correta. Virou **aviso**:
  `canAdd` devolve `{ok: true, warn}`. Regra geral do projeto: "deixa errar e
  sinaliza" (seção 5);
- **agrupamento por TIPO, não subtipo** (`shared.cardTypeGroup`) — antes "Human
  Wizard" e "Elf Druid" viravam dois grupos;
- **PROXY / carta faltando**: marcar a carta como proxy tira ela do "falta
  comprar" sem tirar do deck. Nenhuma das referências faz isso;
- **impressão nos resultados de busca** (foil/promo/tratamento), porque em Magic
  duas linhas idênticas podem ser cartas de preço muito diferente;
- **painel de busca fixo** ao rolar a lista;
- **galeria em 2 colunas** com deck em destaque + filtros na lateral, e o "Em
  destaque" por **visitas** (`deck_views`), não por data — vitrine por
  popularidade real. Consequência operacional: a vitrine não pode nascer vazia
  (ver "Lançar" no [ROADMAP.md](../ROADMAP.md)).

Aprendizado da Fase 6: `.dkc-meta-item` era usada por DUAS telas com layouts
opostos (galeria empilhada × cabeçalho em linha com "·") e **nenhuma das regras
estava escopada** — o CSS vazava nos dois sentidos e desalinhava as duas. Se for
criar mais um bloco de metadados de deck, escope no container.

---

## 12. Decks públicos e comunidade

Referências que o Fernando trouxe: [riftbound.gg/builder](https://riftbound.gg/builder/),
[archidekt](https://archidekt.com/), [dreamborn.ink/decks](https://dreamborn.ink/decks).
O padrão dos três: deck privado enquanto rascunho → **publicar** → galeria
pública com contadores → outro usuário **copia pra si**.

### A boa notícia: quase toda a infra já existe

| Precisa | Já tem no projeto |
|---|---|
| Publicar conteúdo | `createShare(kind, title, data)` — a coluna `kind` já discrimina |
| Contar views anônimas | `logCardView` + RPC `increment_card_view` + `fetchTopViewed` (throttle 1×/sessão no `sessionStorage`) |
| Página pública por usuário | `profiles`/`public_profiles` + `functions/users/[handle].js` |
| Ranking "mais vistas" | a Explorar já ordena cartas por views da comunidade |

Ou seja: **é replicar padrão, não inventar.**

### O que falta

`shares` é *fetch-by-id* — serve pra link direto, mas não pra **galeria**
(listar, ordenar, filtrar, paginar). Então decks publicados pedem tabela própria:

```sql
create table public.decks (
  id           text primary key,          -- slug curto, tipo dreamborn
  user_id      uuid references auth.users (id) on delete cascade,
  handle       text,                      -- desnormalizado: evita join na galeria
  game         text not null,
  format       text,
  name         text not null,
  data         jsonb not null,            -- as zonas (mesmo shape do local)
  views        int  not null default 0,
  copies       int  not null default 0,   -- quantas vezes foi salvo por outro
  likes        int  not null default 0,
  hot          real not null default 0,   -- score de trending (ver abaixo)
  published_at timestamptz default now(),
  updated_at   timestamptz default now()
);
-- leitura pública; escrita só do dono (mesmo padrão de RLS de `collections`).
```

Contadores **só por RPC validada no servidor** (`increment_deck_view`,
`copy_deck`) — nunca `update` direto do cliente, senão qualquer um zera/infla.
Exatamente o que `increment_card_view` já faz.

### Trending — o ponto que exige cuidado

Ordenar por `views` **total** trava a galeria: o deck mais antigo fica no topo
pra sempre e deck novo nunca aparece. Precisa de decaimento por idade:

```
hot = (views + likes*3 + copies*5) / pow(horas_desde_publicacao + 2, 1.5)
```

Peso maior em **copies** de propósito: copiar é o sinal mais honesto de que o
deck presta (dá trabalho), enquanto view é barata e inflacionável.

Recalcular o `hot` num cron diário — o projeto **já tem** GitHub Actions em cron
pros preços, então é só mais um passo. Assim a galeria só faz
`order=hot.desc`, sem cálculo em runtime.

Abas da galeria: **Em alta** (hot) · **Novos** (published_at) · **Mais copiados**
(copies) — e filtro por jogo/formato reusando as cores de jogo.

### "Quantas pessoas estão vendo"

Dois conceitos diferentes, com custos bem diferentes:

- **Total de views** (o que o Dreamborn mostra) — contador acumulado. Barato,
  é o `card_views` de novo. **Recomendo começar por aqui.**
- **Espectadores agora** (presença ao vivo, "3 vendo") — precisa de WebSocket
  (Supabase Realtime presence), conexão aberta por leitor e cota bem maior.
  Bonito, mas é custo recorrente por um enfeite. Deixar pra depois, se houver
  volume que justifique.

### Copiar deck de outro ("salvar")

Copiar = **fork** pro store local do usuário (novo `id`, `game`/`zones` iguais,
campo `forkedFrom` com o id de origem). Exige login, incrementa `copies` na
origem e dá crédito visível ("copiado de @fulano") — o crédito é o que faz o
autor querer publicar.

### Decisões e riscos

1. **Publicar ≠ expor coleção.** O deck público mostra as cartas do deck, nunca
   o que o autor possui. O selo "tenho/falta" é calculado **no cliente de quem
   olha**, contra a coleção dele — assim o visitante vê quanto *ele* gastaria
   pra montar. Esse é o gancho que amarra a comunidade ao portfólio.
2. **Moderação.** Conteúdo público criado por usuário precisa de caminho de
   denúncia e de um jeito de despublicar. Mínimo viável: campo `hidden` +
   botão de reportar. Não dá pra lançar galeria pública sem isso.
3. **Nome/handle obrigatório** pra publicar (o perfil já exige handle único).
4. **SEO**: deck público é conteúdo indexável de graça — vale prerender por
   deck (o projeto já tem `scripts/prerender-catalog.mjs` como molde).

---

## 11. Decisões em aberto

1. **Deck conta no Portfólio?** Recomendo **não** — o deck é uma *visão*, e as
   cartas já contam pela coleção. Somar de novo inflaria o patrimônio (mesma
   regra que já vale pra binder/wishlist, ver memória `portfolio-model`).
2. **Deck só de cartas que possuo?** Não — o valor está justamente em especular
   o custo antes de comprar.
3. **Deck público no perfil?** Cabe bem no `/users/<handle>`, mas só na Fase 3.
4. **Limite de decks?** Sem limite; o freio natural é a cota do `localStorage`
   (já tratada por `notifyStorageFull`).
