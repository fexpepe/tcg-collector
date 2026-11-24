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
- **Trocar a imagem de uma carta que já tem arquivo aqui não é sobrescrever.**
  `/assets/*` sai com um ano de `immutable` (ver o `_headers`) e o service
  worker serve do cache sem perguntar: com o mesmo nome, quem já viu a carta
  segue vendo a imagem velha. A nova entra como `<id>-v2.webp` (depois `-v3`…)
  e a anterior sai do repositório; o sync do Card Game 2002 pega a versão mais
  alta (`indiceDeCuradas`, em `scripts/lib/naruto-vintage-fontes.mjs`). Quem
  aponta pro arquivo à mão também muda: hoje, só a vitrine do `index.html`.
  Os syncs das outras linhas (Data Carddass, CCG, 疾風伝) ainda só leem
  `<id>.<ext>`: na primeira troca de uma carta deles, passam a usar o mesmo
  índice.

Scans do dono no Card Game 2002~2006:

- **COIN-8 うちはイタチ (`nrt-COIN-008`)** (2026-11-23): a lista oficial da
  Bandai dá número e nome das 16 cartas COIN+, mas nenhuma fonte tem a imagem.
  Scan de 1086 px recortado na borda da carta e reduzido a 640 px (q80). O
  fundo do scanner que sobrava fora dos cantos arredondados ficou
  transparente (webp com alfa): na ampliação o raio da tela é menor que o da
  carta, e o canto claro apareceria.
- **忍-365 うちはイタチ (`nrt-nin-365`, 巻ノ十五, UR)** (2026-11-23): o tcg-db
  só tem 3 scans do vol. 15 (作-294, 術-313 e 忍-362) e a TV Tokyo só lista
  até o 13. Mesma receita,
  640×916 em q72: a trama prateada do holo pesa (q80 dava 209 KB, q72 171 KB)
  e o texto segue nítido. A carta sai mais estreita que a COIN-8 no scan
  (0,699 contra 0,711); não foi esticada.
- **忍-367 うちはイタチ＆干柿鬼鮫 (`nrt-nin-367`, 巻ノ十五, R)** (2026-11-23):
  este veio já recortado, 1075×1463 com os cantos em PRETO (sem alfa) e uma
  lasca escura de 1–2 px em volta. Aparado 2 px de cada lado antes da mesma
  receita, com o preto dos cantos em transparente; 640×875, q80. Proporção
  0,732, também sem esticar.
- **PR忍-18 はたけカカシ (`nrt-PRN-018`, promo NOT FOR SALE, 2006)**
  (2026-11-23): das promos curadas sem scan. Mesma receita da COIN-8,
  640×887 em q80. Junto com a `nrt-PRN-001`/`-001R` do dono, é uma das 10
  das 68 promos com imagem.
- **PR忍-7 うずまきナルト (`nrt-PRN-007`, promo NOT FOR SALE, 2003)**
  (2026-11-23): mesma receita, com 1 px aparado em volta (a borda esquerda
  do scan tinha 1 px do fundo numa parte da altura); 640×884, q80.
- **術-211 千鳥 (`nrt-jutsu-211`, 巻ノ十, UR)** (2026-11-23): carta do starter
  巻ノ十 烈火の書, fora da lista de booster da TV Tokyo, então nenhuma fonte
  tinha imagem. A que o Fernando mandou é pequena (350×512), já recortada
  rente à carta, de cantos retos, e achatada como a NXP-002 (0,684). Lado a
  lado com a PR忍-7 escaneada, ela tem a carta inteira; levada a 63:88 na
  largura que veio (350×489, sem ampliar), com cantos arredondados no raio
  relativo dos scans (13,9 px). q90, porque a 350 px a compressão aparece.
- **PR忍-1-R うずまきナルト（箔押し）(`nrt-PRN-001R`, promo, 2002)**
  (2026-11-23): tinha uma foto de 313×453 (`nrt-PRN-001R.webp`); o scan do
  dono de 1086×1448 entra no lugar como **`nrt-PRN-001R-v2.webp`**, pela regra
  de cima. Mesma receita: caixa da carta em x 42–1042, y 15–1432 (a coluna 41
  e a 1043 são meio fundo, e a borda direita anda 2 px da ponta de cima à de
  baixo, então ficaram de fora), fundo dos quatro cantos em transparente com
  1 px comido ao longo do arco; 640×907, q80, 116 KB. No mesmo dia a carta
  passou de `Normal` pra `Foil` (`variants` em
  `data/vintage/naruto-promos-curated.json`): é a versão com estampa em foil
  da PR忍-1 e só existe assim.
- **PR忍-1 うずまきナルト (`nrt-PRN-001`, promo, 2002)** (2026-11-23): a
  normal da mesma carta. Tinha uma foto de 628×917 (`nrt-PRN-001.webp`); o
  scan do dono, 1086×1448, entra como **`nrt-PRN-001-v2.webp`**. Mesma
  receita, caixa em x 54–1031, y 28–1400 (as colunas 53 e 1032 e a linha
  1401 são meio fundo); a carta ocupa menos do scan que a da `-001R`, então
  sai de 978 px de largura em vez de 1001. 640×898, q80, 137 KB. Segue
  `Normal`.
- **忍-19 うずまきナルト (`nrt-nin-19`, 巻ノ壱, UR)** (2026-11-24): a
  impressão original, de fundo holo roxo. A imagem era a miniatura da TV
  Tokyo (`cardimg/n19.jpg`, 80×117), que é a outra impressão, de fundo
  claro. Sem arquivo anterior aqui, entra como `nrt-nin-19.webp` (o endereço
  já muda, de wsrv.nl pra `/assets/`). Mesma receita, caixa em x 31–1052,
  y 13–1430 (as colunas 30 e 1053 e as linhas 12 e 1431 são meio fundo);
  640×888, q80, 137 KB. Proporção 0,721, sem esticar.

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
- **Mission 第2章 e 第3章 (`nrt-dc-nm-051`–`092` e `-093`–`136`) e a
  `nrt-dc-nm-187`** (2026-11-13): os folhetos oficiais (チラシ) da máquina,
  `carddas.com/naruto/mission/room/leaflet_{21,31,41}.pdf`, capturas
  `20100120044835`, `20100120044901` e `20100120041612`. Cada um é uma página
  com TODAS as cartas do capítulo em grade e a legenda `NM-xxx` + nome embaixo
  de cada uma, sem marca d'água. Cuidado com o CDX: com `collapse=urlkey` ele
  só mostra a captura de 2008, truncada em ~130 KB (metade cinza); a inteira
  é a de 2010. Recorte na resolução da imagem embutida (JPEG 2039×2894 no 21
  e no 31), pela moldura preta da carta:
  - 第2章: carta de 180×264, canto em x = 84 + 211,3·coluna e
    y = 710 + 344,4·linha. As raras de topo vêm maiores, 381×555: NM-054 em
    (90, 717) e NM-056 em (1569, 718).
  - 第3章: carta de 155×226, x = 499 + 177,6·coluna e y = 489 + 308,6·linha.
    As quatro ナルティメットレア vêm em 406×592: NM-135 (61, 565), NM-136
    (1572, 565), NM-111 (61, 1677) e NM-128 (1572, 1677).
  - A ordem é a da folha (número crescente, pulando as grandes), conferida
    carta a carta numa folha de contato contra a legenda impressa.
  - 第4章: o folheto é um A4 de 300 dpi fatiado em 103 tiras de 2481×35 que se
    sobrepõem em 1 linha, mas a arte dentro dele é um 100 dpi ampliado 3× e
    muito comprimido. As 46 miniaturas dão ~50×72 de informação real e as
    quatro médias (NM-140, 146, 168, 169) ~109×159, borradas: ficaram de fora.
    Só a 九尾レア NM-187, a maior da folha, entrou, reduzida à resolução real
    (170×247) e com a faixa branca de 2 linhas que o arquivo tem em
    y = 1542–1543 trocada pela média das vizinhas.
  - 第1章 (`leaflet_11.pdf`): as cartas têm ~55×78, pequenas demais. Não entrou.
- Ficam sem imagem: a Mission 第1章, 第4章 (menos a NM-187), 特別任務の章,
  promos e NC, que não têm folheto ou têm um pequeno demais; as séries à parte
  da Formation e da Cross (promos, clear cards, folha de 4, pocket file) e a
  Cross 第3・4章, cujos PDFs não foram arquivados.

Tudo abaixo dos ~440 px do contrato, porque não há versão maior em lugar
nenhum. Webp q88 sem metadado. As curadas do dono (fotos, ~420 px:
`nrt-dc-dn-004`, `-008`, `-051`, `-083`, `-214`, `nrt-dc-nm-003`, `-016`,
`nrt-dc-can-001`, `nrt-nx-nxp-spi`) ficaram como estavam: a leva do Wayback
não sobrescreve arquivo que existe. Scan melhor de uma carta substitui o
arquivo dela; depois rode os dois syncs (o CI também roda). Atenção ao nome:
vale a regra do `-v2` lá de cima, e estes dois syncs ainda não a entendem.

**NXP-003 うずまきナルト (`nrt-nx-nxp-003`, promo da Cross, 2009)**
(2026-11-23): scan do dono, pela receita das três do Card Game lá em cima
(recorte na borda, cantos transparentes), 640×894 em q80. É a segunda das 13
promos da Cross com imagem, depois da `nrt-nx-nxp-spi`.

**NXP-002 うちはサスケ (`nrt-nx-nxp-002`, promo da Cross, 2009)**
(2026-11-23): esta veio diferente: já recortada rente à carta, 702×1024,
cantos em fundo escuro, e ACHATADA na largura (0,686). A proporção certa é a
da NXP-003, escaneada e do mesmo tipo de carta (0,716): lado a lado, com a
mesma largura, as faixas do layout (código de barras, 忍力, 奥義, rodapé) só
batem com a NXP-002 levada a 640×894. Sem isso, a tela da carta (cover em
63:88) cortaria o rodapé com o número. Os cantos são uma máscara arredondada
com o raio medido na NXP-003 (25,5 px a 640), mais uma rampa de alfa pelo
escuro só ao longo do arco dos dois cantos de cima, onde sobrava um fio do
fundo. q80, 132 KB.
