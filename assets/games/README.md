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
- `game_unionarena.webp` — Union Arena (fonte enviada pelo Fernando em
  2026-08-30, 384×384 com fundo branco e muito padding). **Único que NÃO tem 512
  de largura**: o recorte do conteúdo dá 285×123, e esticar bitmap não inventa
  detalhe — só infla o arquivo, já que o navegador ia reamostrar do mesmo jeito
  numa tela 2×. Se um dia aparecer uma fonte maior, é só refazer com 512. O
  fundo branco fica: a cápsula do hub é branca nos dois temas, e o branco aqui é
  o PREENCHIMENTO das letras (que têm contorno preto) — transformá-lo em alfa
  esvaziaria o logo.
- `game_swu.webp` — Star Wars: Unlimited (fonte enviada pelo Fernando em
  2026-09-30: 316×226, PNG com alfa, tinta preta). Já vinha justo no conteúdo
  (o recorte +2px não tirou nada) e sem véu; só o alfa abaixo de 12 foi zerado.
  Como o Union Arena, **não** foi esticado pra 512 (bitmap pequeno). Preto
  puro funciona nos dois temas porque a cápsula do hub é branca.
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
- `game_naruto.webp` — logo NARUTO genérico (tile do jogo e `setLogo` do Data
  Carddass Cross Formation nrt-nx/nrt-nf)
- `game_naruto_ccg.webp` — Naruto Collectible Card Game americano 2006+ (tile
  vintage EN do hub e `setLogo` da linha `nrt-ccg`, via sync-naruto-ccg.mjs).
  Fonte: verso da carta enviado pelo Fernando em 2026-09-30 — o medalhão com
  um pouco do fogo em volta, recortado num QUADRADO de cantos arredondados
  (512×512, alfa só nos cantos). Era um oval largo; com o fogo sobrando dos
  lados o medalhão ficava pequeno na prateleira, e o quadrado justo o deixa
  maior (pedido do Fernando, mesmo dia). O fundo escuro fica de propósito: é
  o que faz o fogo aparecer
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
- `game_naruto_miracle.webp` — Miracle Battle Carddass (tile vintage do Naruto
  e `setLogo` dos sets nrt-mb-*, via sync-miracle-battle.mjs)
- `game_hxh.webp` — HUNTER×HUNTER (tile do jogo no hub e `setLogo` dos sets do
  Carddass Hyper Battle, via sync-hxh-hyper-battle.mjs)
- `game_hxh_miracle.webp` — Miracle Battle Carddass (tile vintage do HxH e
  `setLogo` dos sets hxh-mb-*, via sync-miracle-battle.mjs)
- `game_dbc.webp` — Dragon Ball Carddass (Bandai, 1988→; tile vintage do jogo
  `dbc`). Fonte enviada pelo Fernando em 2026-09-24: 414×260 com fundo branco e
  muita margem. Recortado no conteúdo + 2px, a regra dos -v2 (abaixo) = 373×82
  (em 2026-09-24 tinha saído com 6px de margem; refeito em 2026-09-30, quando o
  jogo entrou). Como o Union Arena, **não** foi esticado pra 512 e o fundo
  branco fica: é opaco, então não tem véu de alfa, e a cápsula do hub é branca
  nos dois temas. É o logo mais largo (~4.5:1), mas não precisa de scale no CSS:
  o equilíbrio óptico do `.hub-logo` já dá a largura pela proporção.
- `game_lotr.webp` — The Lord of the Rings Trading Card Game (Decipher,
  2001–2007; tile vintage do jogo `lotr`). Fonte enviada pelo Fernando em
  2026-10-01: 481×243, letras douradas sobre PRETO com um brilho laranja
  embaixo. O preto virou alfa por chave de luminância (PIL): alfa pelo canal
  mais claro, rampa de 14 a 110, e a cor das bordas "desmisturada" do preto
  (observada ÷ alfa), senão o contorno ficava encardido na cápsula branca. O
  brilho de baixo ficou fora do recorte (as letras acabam na linha ~199 da
  fonte). Recortado no conteúdo +2px = 200×172, alfa abaixo de 12 zerado, sem
  esticar (bitmap pequeno, como o Union Arena).
- `game_naruto.svg` — FONTE vetorial do logo do Naruto (Inkscape). Se editar,
  re-exporte o webp: @resvg/resvg-js (ou qualquer rasterizador) em 512px e
  depois `ffmpeg -i logo.png -c:v libwebp -quality 90 game_naruto.webp`.

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
