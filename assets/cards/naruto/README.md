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

## Data Carddass (`nrt-dc-*`, `nrt-nf-*`, `nrt-nx-*`)

Os syncs do arcade (`sync-naruto-datacarddass.mjs` e
`sync-naruto-dc-cross-formation.mjs`) leem esta pasta do mesmo jeito: arquivo
com o id da carta vira a imagem dela. Nenhuma fonte de lista do arcade tem
scan, então quase tudo aqui saiu dos sites oficiais da Bandai, que saíram do
ar e ficaram no Wayback Machine (2026-11-04):

- **Card Battle (`nrt-dc-dn-*`, `nrt-dc-dnp-*`, `nrt-dc-na-*`)**: as imagens da
  lista oficial, `carddas.com/datacarddas/naruto/card/DN-001T.gif` e afins,
  185×269. São as 249 DN, as 36 promos (DNP-001–030, 030S, 030J, NA-001–004) e,
  da Mission, só a `nrt-dc-nm-202` (a única que o Wayback guardou). A DN-136–140
  só existe como `DN-136TC2.gif`, a da スペシャルコンボシート２ em que estrearam.
  Os outros sufixos (T2–T8, TJ, TK…) são a mesma carta relistada.
- **Formation (`nrt-nf-*`, os 7 capítulos e as シークレットミッションカード) e
  Cross (`nrt-nx-*`, 第1・2・5・6・7章)**: o Wayback não guardou a imagem das
  cartas, só os PDFs de checklist (`formation/pdf/cardchecklist_nf_*.pdf` e
  `x/pdf/cardchecklist_nx_*.pdf` do fudanin.com), A4 de 300 dpi com uma
  miniatura de cada carta. Recortadas na resolução do PDF (~166×240, as
  deitadas 241×165), aparadas na borda cinza da célula. A ordem é a da folha
  (número crescente), conferida carta a carta numa folha de contato contra o
  número impresso. Duas exceções: o 第4章 põe a NFM-002 antes da NFM-001, e o
  第5章, a NFM-005 antes da NFM-004.
- Ficam sem imagem: a Mission (NM, NC), as séries à parte da Formation e da
  Cross (promos, clear cards, folha de 4, pocket file) e a Cross 第3・4章, cujos
  PDFs não foram arquivados.

Tudo abaixo dos ~440 px do contrato, porque não há versão maior em lugar
nenhum. Webp q88 sem metadado. As curadas do dono (fotos, ~420 px:
`nrt-dc-dn-004`, `-008`, `-051`, `-083`, `-214`, `nrt-dc-nm-003`, `-016`,
`nrt-dc-can-001`, `nrt-nx-nxp-spi`) ficaram como estavam: a leva do Wayback
não sobrescreve arquivo que existe. Scan melhor de uma carta substitui o
arquivo dela, com o mesmo nome; depois rode os dois syncs (o CI também roda).
