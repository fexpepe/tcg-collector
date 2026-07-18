# Imagens curadas de cartas — Naruto (vintage)

Um arquivo `<id-da-carta>.(webp|jpg|png)` nesta pasta **substitui** a imagem
vinda das fontes (tcg-db / TV Tokyo) no build do catálogo
(`scripts/sync-naruto-vintage.mjs`). Sem arquivo, a fonte manda — nada muda.

Uso: correções pontuais de curadoria, tipo a **忍-2 うちはサスケ** (`nrt-N-002`),
em que o tcg-db só tem o scan do reprint 2003 (fundo de cenário) e a impressão
original 2002 (fundo laranja) é a que deve aparecer.

- O `<id>` é o id do catálogo (ex.: `nrt-N-002`, `nrt-nin-20`, `nrt-PRN-001`) —
  confira em `data/naruto/cards.js`.
- Prefira `.webp` ~440px de largura (`ffmpeg -i foto.jpg -vf scale=440:-1 out.webp`);
  `.jpg`/`.png` também funcionam.
- Depois de salvar, rode `node scripts/sync-naruto-vintage.mjs --no-fetch` (o CI
  também aplica em todo deploy).
