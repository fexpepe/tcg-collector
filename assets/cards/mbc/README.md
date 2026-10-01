# Imagens curadas de cartas — Miracle Battle Carddass (vintage)

Um arquivo `<id-da-carta>.(webp|jpg|png)` nesta pasta **substitui** o scan do
tcg-db no build do catálogo (`scripts/sync-miracle-battle.mjs`). Sem arquivo, a
fonte manda — nada muda.

- O `<id>` é o id do catálogo (ex.: `nrt-mb-nr-nr-15`, `mb-db01-12`) — confira
  em `data/mbc/cards.js`. As séries que já estavam no ar antes de o Miracle
  Battle virar jogo próprio (2026-10-01) mantêm o prefixo da marca (`op-mb-`,
  `nrt-mb-`, `hxh-mb-`); as outras usam `mb-`.
- Prefira `.webp` ~440px de largura (`ffmpeg -i foto.jpg -vf scale=440:-1 out.webp`).
- Depois de salvar, rode `node scripts/sync-miracle-battle.mjs --no-fetch` (o CI
  também aplica em todo deploy).

A `nrt-mb-nr-nr-15` veio de `assets/cards/naruto/` quando o Miracle Battle saiu
do catálogo do Naruto.
