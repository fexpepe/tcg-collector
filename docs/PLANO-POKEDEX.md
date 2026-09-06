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

## v2 (próximos passos, por prioridade)

1. **Progresso por geração** nos chips (Gen I · 120/151) e barra no topo.
2. **Hub/Dashboard:** card "Pokédex 412/1025" com link pra "Ainda faltam".
3. **Badges:** "Kanto completo", "100 Pokémon", "Pokédex 50%".
4. **Marcar em massa:** "marcar todos os filtrados" (ex.: geração inteira) e
   desfazer.
5. **Auto-marcar ao adicionar carta** (opção): hoje a carta já conta como
   captura no cálculo, sem gravar o `dexId`; a opção gravaria pra manter a
   checklist explícita mesmo se a carta for vendida.
6. **Perfil público:** mostrar progressão da Pokédex na página `@handle`.
7. **Shiny/formas:** checklist por forma (regional, mega) como sub-lista.
