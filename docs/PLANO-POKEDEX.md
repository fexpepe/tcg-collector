# Plano — Pokédex como checklist ("já tenho")

## Problema

A Pokédex do Pokémon só "acendia" um Pokémon quando havia uma carta dele
registrada na coleção. Quem quer colecionar a Pokédex em si (tenho o Bulbasaur,
independente de qual carta) precisava cadastrar uma carta só pra ver progresso —
e quem coleciona de outro jeito (figurinha, jogo, "já peguei") não tinha onde
marcar. A ideia: entrar no site, dizer "já tenho o Bulba", e isso ficar salvo na
conta com uma progressão.

## Decisões

- **Um dado novo, por espécie:** lista de `dexId` marcados como "já tenho"
  (`tcg-collector-dex-owned-v1`), separada da coleção de cartas. Não cria carta
  fantasma nem mexe em valor/portfólio.
- **Captura = marcado OU tem carta.** Contorno dourado, resumo e filtro usam o
  mesmo critério. Quem já tinha carta não perde nada; quem marca à mão ganha o
  mesmo feedback.
- **Mesmo mecanismo dos favoritos:** store de ids com carimbo `updatedAt`, chave
  em `SYNC_KEYS`, merge LWW por bloco (desmarcar propaga; empate = união), entra
  no backup JSON (mesclar = união, substituir = arquivo). Blob JSON em
  `collections.data` → **sem migração** no Supabase.
- **Botão fora do link do card.** Botão dentro de `<a>` é HTML inválido e o
  clique navegaria; o botão é irmão do link, ancorado no canto superior direito.
  Atualiza o card no lugar (sem re-render da grade, que faria os sprites piscar).

## v1 (entregue)

- `shared.js`: `createDexOwnedStore()`, `SYNC_KEYS.dexOwned/dexOwnedMeta`,
  `mergeData` (reusa `mergeFavorites`), backup export/validar/planejar.
- Pokédex (`app.js` + `pokedex.html`): botão "Já tenho / ✓ Tenho" em cada card;
  resumo passa a contar **Pokémon** (que você tem / na Pokédex / progresso) em
  vez de cartas; filtro **Pokédex: Todos / Já tenho / Ainda faltam**.
- Página do Pokémon (`detail.js`): o mesmo botão no herói, ao lado do favorito.
- i18n pt/en/es, CSS (botão + dourado no herói), testes (store, merge LWW,
  backup), docs (README, BACKEND).

## v2 (entregue)

1. **Progresso por geração** nos chips (`Gen I · Kanto 120/151`) e barra de
   progressão no cartão "progresso" do resumo.
2. **Hub:** cartão "412/1025 Pokémon na Pokédex" (só aparece com algo
   capturado), linkando pra Pokédex já filtrada em "Ainda faltam"
   (`pokedex?dex=missing`).
3. **Badges:** Primeiros 50, Kanto completo (151), Metade do caminho (500),
   Mestre Pokémon (1025).
4. **Marcar em massa:** botão "Marcar N como já tenho / Desmarcar N" na linha
   de resultados, só quando algum filtro estreita a lista; toast com Desfazer.
5. **Auto-marcar ao adicionar carta** (Configurações, desligado por padrão):
   carta de Pokémon que passa a existir na coleção grava o `dexId` na
   checklist — e ele fica mesmo se a carta sair. Resolve o `dexId` pela fatia
   `indexes-pokedex` (já carregada na página ou baixada uma vez).
6. **Perfil público:** "Pokédex: 412 de 1025 Pokémon" sob o @ no cartão-herói.
   Só os totais viajam no payload; a lista de dexIds não sai da conta.

**Cache de progressão.** A Pokédex é a única página com o índice por espécie,
então é ela que calcula capturados/total (geral e por geração) e guarda em
`tcg-pokedex-progress-v1`. Hub, badges e perfil público leem daí — é cache de
primeiro paint, como o cookie do Portfólio; o `max` com o store de marcados
cobre quem marcou pelo herói do Pokémon sem abrir a Pokédex.

## v3 (fica pra depois)

- **Shiny/formas:** checklist por forma (regional, mega, gigantamax) como
  sub-lista da espécie. Precisa de dado de formas (hoje só vem do PokeAPI em
  tempo de execução na página do Pokémon) e de um formato `dexId:forma` no
  store — mudança de modelo, não cabe no mesmo passo.
