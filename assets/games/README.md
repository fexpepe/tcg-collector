# Logos dos jogos (hub e sets)

Padrão: **`game_<slug>.webp`**, 512px de largura, fundo transparente (o ffmpeg
preserva o alpha). O `hub.html` aponta pra eles; o `hub.js` revela o `<img>`
quando o arquivo carrega e esconde o nome em texto (fallback sem erro).

## Arquivos

- `game_pokemon.webp` — Pokémon TCG
- `game_lorcana-v2.webp` — Disney Lorcana
- `game_onepiece.webp` — One Piece Card Game
- `game_magic-v2.webp` — Magic: The Gathering (fonte: `../brand/Magic-The-Gathering-logo.png`)
- `game_gundam-v2.webp` — Gundam Card Game (fonte: gundam-gcg.com/en/images/common/logo.png;
  162px nativo, upscalado p/ 512 — line-art aguenta)
- `game_dbfw-v2.webp` — Dragon Ball Super Fusion World (fonte: `../brand/logo_title_dbfwcardgame.webp`)
- `game_fab.webp` — Flesh and Blood (fonte: `../brand/Flesh_and_Blood_TCG_Logo.png`)
- `game_ygo-v2.webp` — Yu-Gi-Oh! (fonte: `../brand/yugioh.jpg` — JPG de fundo branco,
  funde no chip branco; sem alpha)
- `game_digimon-v2.webp` — Digimon Card Game (fonte: `../brand/digimon.webp`)
- `game_riftbound-v2.webp` — Riftbound / League of Legends (fonte: `../brand/riftbound.webp`,
  1908×1908 com padding — cortado pro bbox do conteúdo antes de escalar)
- `game_onepiece_carddass.webp` — Carddass Hyper Battle (tile vintage do OP)
- `game_narutomythos.webp` — Naruto Mythos TCG (12/11/2026): o logo do site
  oficial (`irp.cdn-website.com/99e556bf/dms3rep/multi/Logo+Naruto+Mythos+TCG.png`,
  o mesmo do cabeçalho de narutotcgmythos.com), PNG de 933×472 já com fundo
  transparente: o "NARUTO" laranja com o "MYTHOS TCG" preto em cima. Recortado
  no conteúdo, reduzido pra 512×257 em alfa pré-multiplicado, alfa ≤12 zerado,
  WebP sem perda (72 KB). O "MYTHOS TCG" é preto: lê bem na cápsula branca do
  hub e some em fundo escuro, então o logo só vai onde há cápsula.
- `game_narutokayou.webp` — Naruto Kayou (13/11/2026): até aqui o jogo usava o
  `game_naruto.webp` (o site oficial da Kayou só mostra o logo do Naruto); o
  Fernando mandou a arte com o "KAYOU" amarelo em cima do Naruto, PNG 1280×1280
  com fundo transparente. Recortado no conteúdo, reduzido pra 512×341 em alfa
  pré-multiplicado, alfa ≤12 zerado, WebP q90 com alfa sem perda (40 KB). O
  amarelo pede a cápsula branca, como o Mythos.
- `game_naruto_boruto.webp` — Naruto Boruto Card Game (jogo `narutoboruto`, 13/11/2026):
  o logo do site oficial do Chrono Clash System, no Wayback
  (`chronoclashsystem.com/images/product/naruto/common/img_logo.png`, captura
  20220223125309), PNG de 506×305 já com fundo transparente (Naruto, Boruto e
  Naruto adulto em cima do letreiro). Sem recorte: só ampliado pra 512×309 em
  alfa pré-multiplicado, alfa ≤12 zerado, WebP q90 com alfa sem perda (62 KB).
  Vai na página Vintage, no "Sobre" e no `setLogo` do set da linha.
- `game_onepiece_2002.webp` — One Piece Card Game de 2002–2005 (linha
  `op2002`: tile vintage do hub, parede da landing e página /games). É a placa
  "From TV animation / ONE PIECE (ワンピース)" do verso de madeira das cartas.
  Fonte: foto do verso enviada pelo Fernando em 2026-11-11 (1200×1599; a placa
  com ~620 px). Antes dela só havia cópias de ~185–220 px (embalagem do 1º set
  e banner no Grand Line Wiki) e um scan de pacote com retícula forte e arte
  encostando no logo. O "CARD GAME" do verso é entalhado na madeira, separado
  da placa, e ficou de fora. Na carta, a placa é aro amarelo com uma sombra
  marrom-escura em volta, irregular e grudada nas faixas escuras da madeira: o
  recorte foi pelo aro (máscara pelo brilho, buracos fechados, abertura de 3 px
  pra soltar as faixas) e a sombra foi REFEITA como contorno uniforme de 5 px
  na cor medida dela (≈ #3e2008, mediana 62,37,17), em 4× e reduzido (borda
  sem serrilhado). Sem ele, o aro amarelo some na cápsula branca do hub.
  Recortado no conteúdo (+2px), reduzido pra 512×243 em alfa pré-multiplicado,
  alfa abaixo de 12 zerado; WebP com perda q88 e alfa sem perda (56 KB — a
  textura da impressão e da foto pesa, como no Naruto vintage). Os sets seguem
  com o nome (`setLogo` vazio): pôr o logo do jogo em todo set é decisão por
  jogo (regra 3 do `docs/CATALOGO.md`), e cada set tem logo próprio impresso
  (o Grand Line Wiki publica, a ~250 px).
- `game_unionarena-v2.webp` — Union Arena (12/11/2026; o v1 era a fonte
  enviada pelo Fernando em 2026-08-30, 384×384 com fundo branco: recortado dava
  285×123, mole na prateleira em tela 2×, com contorno preto e o "E" vermelho).
  Fonte nova: a capa do manual oficial (`unionarena-tcg.com/na/pdf/rule_manual.pdf`,
  Ver1.1), renderizada a 300 dpi com o PyMuPDF — o logo atual da marca, BRANCO
  sobre o fundo escuro da capa, com "TRADING CARD GAME" e "ユニオンアリーナ",
  1554×715. Virou tinta preta com o alfa saído da luminância (fundo ~9, letra
  ~255; só na vizinhança das letras, pra não pegar cisco das faixas da capa),
  recortado no conteúdo (+2px), reduzido pra 512×237 em alfa pré-multiplicado,
  alfa ≤12 zerado. WebP sem perda, 11 KB (uma cor só). Sai o "E" vermelho do
  v1, que a versão do manual não tem.
- `game_swu-v2.webp` — Star Wars: Unlimited (12/11/2026; o v1 era a fonte
  enviada pelo Fernando em 2026-09-30, 316×226, PNG com alfa, tinta preta —
  pequena pra tela 2×). Fonte nova: a capa das Comprehensive Rules v8.0
  (`cdn.starwarsunlimited.com//SWH_Comp_Rules_v8_0_e26603c6e1.pdf`), onde o
  logo é BRANCO num painel preto liso (fundo ~1, letra ~250), renderizada na
  resolução da imagem da capa (309 dpi): 971×696. Mesmo tratamento do Union
  Arena: tinta preta com alfa pela luminância, recorte +2px, 512×367 em alfa
  pré-multiplicado, alfa ≤12 zerado, WebP sem perda (13 KB). Preto puro
  funciona nos dois temas porque a cápsula do hub é branca.
- `game_cyberpunk.webp` — Cyberpunk TCG. Fonte: "Cyberpunk TCG Logo Yellow With
  Black Stroke", PNG oficial 3310×850 com alfa da página
  cyberpunktcg.com/marketing-materials (seção "Logo", 30/09/2026). Das quatro
  versões publicadas, é a que lê na cápsula branca (o amarelo puro some no
  branco). Recortado no conteúdo (+2px), alfa ≤12 zerado e reduzido pra 512
  de largura com o sharp (webp com alfa sem perda — o libwebp do ffmpeg
  deixava um véu cinza no fundo).
- `game_wow.webp` — World of Warcraft TCG (tile vintage do hub). Fonte: o logo
  "World of Warcraft Trading Card Game" enviado pelo Fernando em 2026-09-30
  (1200×615, com alfa). Recortado no conteúdo (+2px), alfa ≤12 zerado e
  reduzido pra 512 de largura com o Pillow em alfa pré-multiplicado (sem
  franja escura na borda). WebP com perda q88 e alfa sem perda: 52 KB; o sem
  perda dava 190 KB, por causa dos gradientes do logo.
- `game_sorcery-v2.webp` — Sorcery: Contested Realm (12/11/2026). O v1 saiu
  do logo enviado pelo Fernando em 2026-10-01: 907×365, PNG de PALETA (256
  cores) com alfa, e a sombra em volta das letras era escura e
  semitransparente (luminância ~32) — na cápsula branca virava uma mancha
  cinza borrada. Fonte nova: o logo embutido no rulebook oficial (out/2026,
  Google Drive linkado em sorcerytcg.com/how-to-play), página 2, imagem
  884×341 em CMYK com máscara de alfa própria — cor cheia, com a placa de
  pedra e o degradê das bordas como a Erik's Curiosa desenhou. Extraído com o
  PyMuPDF (CMYK → RGB, máscara como alfa), recortado no conteúdo (+2px), alfa
  ≤12 zerado, 512×194 com o Pillow em alfa pré-multiplicado. WebP com perda
  q88 e alfa sem perda: 35 KB. (O site oficial hoje só mostra o "gotlogo",
  versão temática da expansão Gothic, com estalactites — não serve de logo
  do jogo.)
- `game_weiss.webp` — Weiß Schwarz (16º tile da grade moderna do hub). Fonte: o
  logo oficial (Weiß Schwarz com ヴァイスシュヴァルツ) enviado pelo Fernando em
  2026-10-01 (1312×644, com alfa). Mesmo tratamento do WoW: recortado no
  conteúdo (+2px), alfa ≤12 zerado e reduzido pra 512×252 com o Pillow em alfa
  pré-multiplicado. WebP com perda q88 e alfa sem perda: 38 KB (o sem perda
  dava 95 KB, pelos gradientes prata). O contorno escuro do logo segura o
  branco das letras na cápsula branca do hub.
- `game_gcd.webp` — Gundam Carddass (Bandai, 1988–1997; tile vintage do
  jogo `gcd` no hub, parede da landing, página /games e kit). Logo "Carddass
  GUNDAM SELECTION / カードダス ガンダム セレクション" enviado pelo Fernando em
  2026-11-11 (JPG 894×409, fundo branco). O fundo saiu por flood fill a partir
  das bordas (pixels com o menor canal > 150 ligados à borda), então o branco
  de dentro das letras fica; na faixa de antisserrilhado o alfa sai da
  escuridão do pixel e a cor vira o preto do contorno (sem franja branca no
  tema escuro). Reduzido pra 512×234 com o Pillow em alfa pré-multiplicado,
  alfa abaixo de 12 zerado. WebP com perda q88 e alfa sem perda: 28 KB. O
  contorno preto grosso segura o logo na cápsula branca do hub. Os sets
  seguem com o nome (`setLogo: ""`): logo do jogo em todo set é decisão por
  jogo (regra 3 do docs/CATALOGO.md).
- `game_godzilla.webp` — Godzilla Card Game (17º tile da grade moderna do
  hub, 2026-11-11). Fonte: o logo vermelho oficial do site da edição inglesa
  (`en.godzilla-cardgame.com/wordpress/wp-content/themes/godzilla_tcg-e/assets/img/common/logo_red.svg`,
  o do cabeçalho; vetor 335×141, uma cor só, #e60012). Renderizado em 2048 px
  no Chromium, recortado no conteúdo com 2 px de margem, alfa ≤12 zerado e
  reduzido pra 512×218 com o Pillow em alfa pré-multiplicado. WebP sem perda:
  16 KB (com perda q88 dava o mesmo tamanho, num logo chapado de uma cor).
  O vermelho lê bem na cápsula branca do hub.
- `game_palworld.webp` — Palworld OFFICIAL CARD GAME (18º tile da grade
  moderna do hub, 2026-11-11). Fonte: o `logo_black.svg` do site oficial da
  Bushiroad (en.palworld-official-cardgame.com, cabeçalho, 11/11/2026). Das
  duas versões publicadas é a que lê na cápsula branca (a outra é o ouro
  `#ceaf73`, que some no branco, como o amarelo do Cyberpunk). O SVG embute
  bitmap, então foi renderizado no Chromium a 2400×848 com fundo
  transparente, recortado no conteúdo (+2px), alfa ≤12 zerado e reduzido pra
  512×182 com o Pillow em alfa pré-multiplicado. WebP com perda q88 e alfa
  sem perda: 34 KB.
- `game_vanguard.webp` — Cardfight!! Vanguard (tile da grade moderna do hub,
  depois do Final Fantasy, 2026-11-13). Fonte enviada pelo Fernando no mesmo
  dia: PNG de 600×269 com alfa, o logo "CARDFIGHT!! Vanguard overDress"
  (vermelho com contorno prateado). Trocou o do cabeçalho do site oficial
  (`vg_logo_en.png`, 474×211), menor e sem o prateado. Sem recorte nem
  redimensionamento; WebP sem perda pelo ffmpeg, 56 KB.
- `game_fftcg.webp` — Final Fantasy TCG (19º tile da grade moderna do hub,
  depois do Palworld, 2026-11-11). Fonte: o logo do cabeçalho do site
  oficial (`fftcg.square-enix-games.com/theme/fftcg/images/large-fftcg-logo.png`,
  321×230, PNG com alfa: "FINAL FANTASY", o katakana e "TRADING CARD GAME"
  em cinza sobre o contorno de uma carta). Recortado no conteúdo (+2px) e
  alfa ≤12 zerado; como o Star Wars v1, **não** foi esticado pra 512 (bitmap
  pequeno). WebP sem perda, 17 KB. O cinza escuro lê bem na cápsula branca.
- `game_grandarchive.webp` — Grand Archive TCG (21º tile da grade moderna
  do hub, 2026-11-13). Fonte: o logo do cabeçalho do site oficial
  (`www.gatcg.com/_nuxt/img/logo_navbar_stacked.63a3a6a.png`, 300×116, PNG
  com alfa: "GRAND ARCHIVE" em duas linhas, BRANCO chapado — o site é
  escuro). É a única versão publicada, e branco some na cápsula branca do
  hub: o alfa foi mantido e a cor trocada por `#14161c` (o logo é de uma
  cor só, então nada do desenho muda). Alfa ≤12 zerado; não foi esticado
  (bitmap pequeno). WebP sem perda, 5 KB. **Decisão a confirmar pelo
  Fernando**: se a marca publicar uma versão escura, ela entra no lugar.
- `game_hololive.webp` — hololive OFFICIAL CARD GAME (seção "Outros TCGs"
  do hub, 2026-11-13). Fonte: o logo do cabeçalho do site oficial em inglês
  (`en.hololive-official-cardgame.com/wp-content/themes/tcg_en/assets/img/global/logo.svg`,
  283×78, SVG de uma cor só, o roxo-escuro `#534b88`, com um halo branco
  suave atrás do emblema). Renderizado no Chrome a 2268×621 com fundo
  transparente, alfa ≤12 zerado e reduzido pra 512×140 com o Pillow em alfa
  pré-multiplicado. WebP sem perda, 52 KB. O roxo lê bem na cápsula branca;
  a versão `logo_w.svg` (branca) não foi usada.
- `game_gw.webp` — Gundam War (Bandai, 1999–2011). Fonte enviada pelo
  Fernando em 2026-11-11: WebP de 360×125 com alfa, o logo dourado "GUNDAM
  WAR / MOBILE SUIT GUNDAM THE CARD GAME". Recortado no conteúdo (+2px), com
  o alfa ≤12 zerado: 354×87. Como o Star Wars v1, **não** foi esticado pra 512
  (bitmap pequeno). WebP q88 com alfa sem perda, 12 KB. Fica fora da fileira
  Vintage da landing por enquanto: o One Piece Card Game de 2002 e o Gundam
  Carddass (2026-11-11) já levaram a fileira a 14 (7 + 7 no tablet); com ele
  seriam 15, e a grade se decide junto.
- `game_seiya.webp` — Saint Seiya (os três jogos: Carddass, Trading
  Collection e Crusade, até cada produto ganhar o seu; linhas da página
  /vintage, páginas /games e os "Sobre"). É o logo 聖闘士星矢 da época das cartas,
  recortado do DISPLAY da Carddass Part 2 「バトルメモリアル」 (1988), no scan
  do animecollection.fr (`packagings/118/271/h3000_1363_packaging.jpg`,
  600×926, o logo com ~240 px). Fonte melhor não achada em 2026-11-12: o
  display da Part 3 e as caixas das Trading Collection têm o mesmo logo no
  mesmo tamanho; o "Saint Seiya International logo" do Commons (CC0) tem 300
  px e é o logo ocidental, não o das cartas japonesas; o site oficial da Toei
  não publica o logo. Recorte: trabalhado em 4× (LANCZOS + unsharp leve), o
  fundo vermelho do display e o cabelo cinza do Seiya tirados por
  preenchimento a partir da borda (scipy `ndimage.label`), fica só o maior
  componente (sem a furigana セイントセイヤ e sem o "©" de cima), buracos
  preenchidos (a estrela vermelha), alfa suavizado e ≤12 zerado, e de volta
  ao tamanho nativo: 249×106. Como o Gundam War, **não** foi esticado pra 512
  (bitmap pequeno). WebP q88 com alfa sem perda, 9 KB. Fica fora da fileira
  Vintage da landing pelo mesmo motivo do Gundam War (a grade de 14 se decide
  junto). Trocar por uma fonte maior quando aparecer (scan do display ou do
  álbum em boa resolução).
- `game_naruto.webp` — logo NARUTO genérico (tile do jogo e `setLogo` do Data
  Carddass Cross Formation nrt-nx/nrt-nf)
  Vale também como logo do jogo `narutotc` (Naruto Trading Cards, as cartas de
  coleção da Amada e da Ensky, 13/11/2026) e de todos os sets dele: nenhum
  produto tem logo recortado em fonte aberta, e o NARUTO é a marca impressa
  em todos. Pendência: logo próprio do Etching Card Collection e da 忍術大全.
- `game_naruto_ccg-v2.webp` — Naruto Collectible Card Game americano 2006+
  (tile vintage EN do hub, parede de logos do index e `setLogo` da linha
  `nrt-ccg`, via sync-naruto-ccg.mjs). Logo SOLTO, recortado como os outros
  vintage (2026-10-14). Até então era o medalhão do verso da carta num quadrado
  com o fogo em volta (`game_naruto_ccg.webp`, apagado): o único tile vintage
  com fundo, e com o "Collectible Card Game" ilegível na miniatura. Fonte: o
  logo chapado em fundo branco da Wiki Naruto em português
  (`File:Naruto_Collectible_Card_Game_(Capa).jpg`, 881×462) — o mesmo da
  embalagem dos starters e do verso, sem medalhão. Melhor que as outras
  achadas: o verso em foto do eBay dá ~440 px de logo com granulação, e o site
  antigo da Bandai (bandaicg.com no Wayback: livro de regras em PDF e os Flash
  do cabeçalho) só tem bitmap de ~250 px. O branco do fundo saiu por distância
  até a "tinta" (escuro ou saturado), não por preenchimento a partir da borda:
  na embalagem o logo tem um contorno BRANCO externo em volta de tudo, invisível
  na fonte branca. Ele foi devolvido com 5 px na escala da fonte (borda feita
  em 4× e reduzida, sem serrilhado) — sem ele o contorno preto some no tema
  escuro da página do set. Miolos brancos maiores que o contorno (dentro do O,
  entre o redemoinho e as letras) viram transparentes, como na embalagem. A
  fonte foi ganhando 12 px de margem branca antes: a sombra azul do O acaba a
  3 px da borda e o contorno sairia cortado reto. Recortado no conteúdo (+2px),
  reduzido pra 512×262 em alfa pré-multiplicado, alfa abaixo de 12 zerado;
  WebP com perda q88 e alfa sem perda (49 KB)
- `game_naruto_vintage.webp` — Naruto Card Game japonês 2002~2006 (tile vintage
  do hub e `setLogo` da linha `nrtcg`, via sync-naruto-vintage.mjs). Fonte: o
  verso da carta enviado pelo Fernando em 2026-09-30 — logo recortado do fundo
  azul por chroma key (PIL), 512px. A textura de papel impressa fica, por isso
  pesa mais que os outros (~64 KB)
- `game_naruto_datacarddass.webp` — NARUTO ナルティメットカードバトル (Narutimate
  Card Battle, o 1º título do Data Carddass, 2005). Tile "Naruto Data Carddass
  (arcade)" do hub e `setLogo` só dos sets do Card Battle (nrt-dc-s01..s10, via
  sync-naruto-datacarddass.mjs) — Mission, Formation e Cross têm marca própria.
  Fonte: capa do guia e verso da carta (DNP-008) enviados pelo Fernando em
  2026-09-30. Recortado da CAPA (774px nativos, reduzido pra 512×344), que tem
  mais resolução; o verso serviu de referência pra forma do redemoinho e pra
  saber o que é arte e o que é fundo. Na capa o fundo laranja se mistura com as
  letras, então o corte foi por cor (flood fill com sementes à mão, sem rembg,
  que devolvia um bloco só). O contorno escuro do topo (engolido pela faixa
  preta da capa) e a ponta esquerda do painel verde (cortada pela borda) foram
  redesenhados. Os bolsões escuros entre o NARUTO e o painel e entre o painel e
  o カードバトル são da ARTE — aparecem nas duas fontes, com fundos diferentes.
- `game_naruto_2027.webp` — NARUTO CARD GAME novo (Bandai, mundial 2027; tile
  "Em breve" do hub; fonte: naruto-cardgame.com/images/common/logo.webp)
- `game_hxh.webp` — HUNTER×HUNTER (tile do jogo no hub e `setLogo` dos sets do
  Carddass Hyper Battle, via sync-hxh-hyper-battle.mjs)
- `game_mbc.webp` — Miracle Battle Carddass (tile vintage do jogo `mbc` e
  `setLogo` de todos os sets dele, via sync-miracle-battle.mjs). Até 2026-10-01
  eram três arquivos, `game_onepiece_miracle`, `game_naruto_miracle` e
  `game_hxh_miracle`, um por linha, com o MESMO conteúdo (md5 igual): o logo
  oficial do jogo, que não muda de franquia pra franquia.
- `game_dbc-v2.webp` — Dragon Ball Carddass (Bandai, 1988→; tile vintage do
  jogo `dbc` e `setLogo` de todos os sets dele, via sync-dbc-carddass.mjs).
  Fonte enviada pelo Fernando em 2026-09-24: 414×260 com fundo branco e muita
  margem. Recortado no conteúdo + 2px, a regra dos -v2 (abaixo) = 373×82, e
  **não** foi esticado pra 512 (bitmap pequeno, como o Union Arena v1). É o logo
  mais largo (~4.5:1), mas não precisa de scale no CSS: o equilíbrio óptico do
  `.hub-logo` já dá a largura pela proporção.
  Até 2026-11-12 era o `game_dbc.webp`, opaco com o fundo branco. Na cápsula
  branca do hub não aparecia, mas fora dela (página do jogo, cinza claro) dava
  pra ver o retângulo. O fundo saiu do próprio arquivo de 373×82 (a fonte
  original não está no repo), com o Pillow + scipy:
  - **Tinta** = pixel com o menor canal abaixo de 120: o contorno, a sombra, o
    vermelho e o amarelo das letras e o vermelho dos círculos.
  - O que fica **opaco** é a tinta com os buracos fechados dela preenchidos. É
    assim que o creme do katakana, dentro dos 12 círculos, continua opaco: com
    esse limiar cada círculo fecha sozinho, ~268 px cada.
  - As duas fendas claras de dentro dos "S" são exceção: são o fundo visto por
    dentro do contorno (buracos com miolo ≥ 180; o amarelo de dentro das letras
    não passa de 139), e ficaram transparentes.
  - **Alfa:** o resto, mais a beira da tinta (até 2 px do fundo, que no JPEG já
    vinha misturada com o branco), tem o alfa desmisturado do branco. A conta é
    a = (255 − min(C)) / (255 − min(F)), com F = a tinta mais escura num raio
    de 2 px. Na base das letras o contorno tem 1 px, e a tinta mais PRÓXIMA ali
    era o amarelo, que deixava uma linha clara no tema escuro. A cor também é
    desmisturada; com alfa abaixo de 0,35 vale a de F.
  - Sobre branco reproduz a fonte (diferença média de 2,8 níveis, a da
    compressão); no escuro não sobra franja clara.
  - Alfa abaixo de 12 zerado. WebP q88 com alfa sem perda: 16 KB.
- `game_lotr.webp` — The Lord of the Rings Trading Card Game (Decipher,
  2001–2007; tile vintage do jogo `lotr`). Fonte enviada pelo Fernando em
  2026-10-01: 481×243, letras douradas sobre PRETO com um brilho laranja
  embaixo. O preto virou alfa por chave de luminância (PIL): alfa pelo canal
  mais claro, rampa de 14 a 110, e a cor das bordas "desmisturada" do preto
  (observada ÷ alfa), senão o contorno ficava encardido na cápsula branca. O
  brilho de baixo ficou fora do recorte (as letras acabam na linha ~199 da
  fonte). Recortado no conteúdo +2px = 200×172, alfa abaixo de 12 zerado, sem
  esticar (bitmap pequeno, como o Union Arena v1).
- `game_harrypotter.webp` — Harry Potter Trading Card Game (Wizards of the
  Coast, 2001–2002; tile vintage do jogo `harrypotter`). Fontes enviadas pelo
  Fernando em 2026-09-30: um scan 1587×1256 sobre fundo PRETO e uma versão
  750×400 já sobre fundo claro. Recortado do scan, que tem mais resolução,
  com o recorte claro como referência do que é logo. O fundo preto saiu por
  região: preenchimento a partir da borda e os miolos das letras (dentro do P,
  do o e do a) acima da placa. O preto ABAIXO da placa é o texto "TRADING CARD
  GAME" e fica. Na faixa de borda o alfa vem do brilho, com a mistura com o
  preto desfeita, e os pontinhos soltos da retícula foram tirados. Recortado no
  conteúdo +2px e reduzido pra 512×393 (webp com alfa). A textura de retícula
  das letras é da impressão original.
- `game_dbz.webp` — Dragon Ball Z Collectible Card Game (Score, 2000–2006;
  tile vintage do jogo `dbz` e `setLogo` de todos os sets dele). Fonte: o
  verso do anúncio de lançamento, o sell sheet da Score com o calendário de
  2000, que o retrodbzccg publica (`wp-content/uploads/2021/06/s-l1600-1.jpg`,
  1221×1600). Escolhido em vez da frente que o Fernando mandou porque ali o
  selo "New!" cobre o D. O "DRAGON BALL Z" tem contorno preto e um filete
  branco por fora, sobre fundo carmim: o fundo saiu por preenchimento a partir
  da borda da imagem (scipy `ndimage.label` nas regiões escuras que não são
  amarelo, vermelho vivo nem branco), que para no filete — a cor sozinha não
  separava o vermelho das letras do carmim. O contorno preto puxava pro carmim
  no impresso e foi fechado em preto (luminância < 85 dentro do logo). O
  subtítulo "Collectible Card Game" não tem filete: saiu por chave de cor
  (amarelo) e ganhou de volta o contorno escuro de 3 px por dilatação, senão
  sumia na cápsula branca. Recortado no conteúdo +2px, alfa abaixo de 12
  zerado, reduzido pra 512×179 (Pillow, webp q90 com alfa sem perda). Script
  no scratchpad da sessão de 2026-11-02.
- `game_naruto.svg` — FONTE vetorial do logo do Naruto (Inkscape). Se editar,
  re-exporte o webp: @resvg/resvg-js (ou qualquer rasterizador) em 512px e
  depois `ffmpeg -i logo.png -c:v libwebp -quality 90 game_naruto.webp`.
- `game_cdm.webp` — Carddass Masters (Bandai, 1996–2011; tile vintage do
  jogo `cdm` no hub, parede da landing, página /games e kit). Fonte: o tapete
  do Final Fantasy VIII Triple Triad, um produto da própria linha, na Final
  Fantasy Wiki (`File:Final Fantasy VIII Bandai Carddass Masters Triple Triad
  Game Mat.jpg`, 3500×2603), onde o logo está a cores no canto: letras
  grafite e o "A" vermelho, cada um com contorno branco. É o maior achado; no
  verso das cartas (HxH na Hunterpedia, FF7/FF8 na mesma wiki) o logo tem de
  120 a 170 px e sai sem o contorno. O fundo é marrom texturizado: saiu por
  cor (matiz 12–48°, saturação > 0,28), com a máscara feita em 4× e reduzida
  (borda macia), e os bolsões marrons dentro do contorno (miolo do D, do A,
  entre letras) também viram transparentes. O contorno, bege na fonte, é o
  papel no impresso: foi normalizado pra branco, e a borda externa leva a cor
  dele (sem franja marrom). Ilhas soltas de ruído saíram. Recortado no
  conteúdo (+2px), alfa abaixo de 12 zerado; **369×120, sem esticar** (como o
  Union Arena e o Star Wars: bitmap pequeno não ganha detalhe). WebP com perda
  q88 e alfa sem perda: 17 KB. Na cápsula branca do hub o contorno some e fica
  o grafite com o "A" vermelho, como no verso das cartas. Nos sets ele entra
  pequeno, dentro dos `set_cdm_<ip>.webp` (abaixo).
- `set_cdm_eva.webp`, `set_cdm_hxh.webp` e `set_cdm_naruto.webp` — `setLogo` de todos os sets de cada
  IP do Carddass Masters (registro `IPS` do sync-carddass-masters.mjs). Pedido
  do Fernando em 2026-11-11: o jogo junta dezenas de IPs, e o tile com só o
  nome do set não dizia de que série nem de que jogo era. Uma imagem só, pra
  valer em todo lugar que mostra o logo do set (grade, lista, página do set):
  o logo da IP grande e o `game_cdm.webp` pequeno no canto superior esquerdo
  (150px de largura, encostando no topo do logo da IP). Montados com o Pillow
  (LANCZOS, recorte no conteúdo +2px), WebP q88 com alfa sem perda.
  - HxH: o `game_hxh.webp` a 420px de largura, 40px pra direita do selo
    (455×228, 27 KB).
  - Evangelion: o SVG transparente (新世紀 EVANGELION エヴァンゲリオン,
    versão pra fundo claro: EVANGELION preto e o 新世紀 vazado com contorno)
    enviado pelo Fernando em 2026-11-11. Rasterizado no Chromium a 1600px,
    recortado e reduzido pra 440px, 30px pra direita do selo; o traço laranja
    da esquerda sobe até a altura do MASTERS sem encostar nele (470×200, 42 KB:
    os degradês do laranja pesam mais que o HxH).
  - Naruto (2026-11-13): o `game_naruto.webp` a 420px de largura, 40px pra
    direita do selo; o logo sobe até a primeira linha dele com tinta debaixo
    do selo ficar 2px abaixo do MASTERS (460×214, 35 KB).
  IP nova: mesma montagem, e o `logo` no bloco dela no sync.

### Os `-v2` (2026-09-28)

Sete logos voltaram com nome novo, pelos dois defeitos que a tela de Jogos
mostrava lado a lado:

1. **Véu de alfa.** Lorcana, DBFW, Digimon, Riftbound e Gundam tinham de 10% a
   65% dos pixels do FUNDO com alfa 1–11 (sobra da conversão). Invisível sobre
   transparente, mas sobre a cápsula branca escurece até 11 níveis (#fff →
   #f4f4f4): era o retângulo cinza atrás do logo. Nos -v2 todo pixel com alfa
   abaixo de 12 virou transparente de verdade.
2. **Padding interno.** Magic (o logo ocupava só 47% do quadro — por isso
   existia um `transform: scale(1.2)` só pra ele), Lorcana, Digimon e Yu-Gi-Oh! vinham com
   margem dentro do arquivo, e o `object-fit: contain` encolhe o conteúdo junto.
   Os -v2 são recortados no conteúdo (+2px). O hub equilibra o tamanho de cada
   logo pela proporção do arquivo (ver `.hub-logo` no styles.css), então o
   recorte precisa ser justo — padding no arquivo vira logo menor na prateleira.

Feitos no Chromium (canvas → `toBlob("image/webp", 0.9)`, alfa sem perda),
que dá o mesmo peso dos originais: 181 KB contra 214 KB dos sete antigos.

## Conversão (novo logo)

```sh
ffmpeg -i logo.png -vf "scale=512:-1" -c:v libwebp -quality 88 game_<slug>.webp
```

Antes de subir, confira as duas regras dos -v2: **recorte no conteúdo** (sem
margem dentro do arquivo) e **nenhum pixel de fundo com alfa baixo** — ponha o
logo sobre branco com contraste no máximo; se aparecer um retângulo, o fundo tem
véu.

## Notas

- **Jogos ainda sem logo (pendência, 2026-11-13):** Dragon Ball Super Battle
  (`dbsb`), Dragon Ball Visual Adventure (`dbva`) e Dragon Ball Super Barcode
  Wars (`dbbw`), as séries do Carddass que viraram jogo. Decisão do Fernando:
  entram sem logo; o registro (`functions/_lib/jogos.js`) leva `logo: ""`, a
  página Vintage mostra o nome no quadro (`.vt-logo-texto`), o "Sobre" vem sem
  arte e o cartão do set mostra o nome. Logo novo entra por aqui (`game_<slug>.webp`)
  e troca o `""` no registro, no `GAME_LOGO`/`KIT_LOGO`, no `vintage.html`, no
  "Sobre" e no `LOGO` do `scripts/sync-dbc-carddass.mjs`.
- **Contraste:** o CSS põe um chip branco atrás do logo, então logos escuros
  ficam legíveis nos dois temas.
- **Proporção:** paisagem; o CSS usa `object-fit: contain` — não precisa de
  tamanho exato. No hub, o tamanho sai da proporção (logo largo fica mais baixo,
  logo alto fica mais estreito), pra nenhum pesar mais que o vizinho.
- **Troca de arte:** `/assets/*` é `immutable` (ver `_headers`) — suba com OUTRO
  nome (`-v2`, `-v3`…) e atualize as referências: `hub.html`, `index.html`,
  `src/app.js` (`GAME_LOGO`) e `scripts/og/og-image.html`.
- O CSP (`img-src 'self'`) já cobre arquivos locais.

> São marcas registradas dos respectivos titulares; o uso aqui é nominativo (pra
> identificar os jogos), e o site já traz o disclaimer no rodapé.
