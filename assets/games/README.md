# Logos dos jogos (hub e sets)

Padrão: **`game_<slug>.webp`**, 512px de largura, fundo transparente (o ffmpeg
preserva o alpha). O `hub.html` aponta pra eles; o `hub.js` revela o `<img>`
quando o arquivo carrega e esconde o nome em texto (fallback sem erro).

## Arquivos

- `game_pokemon.webp` — Pokémon TCG
- `game_lorcana.webp` — Disney Lorcana
- `game_onepiece.webp` — One Piece Card Game
- `game_onepiece_carddass.webp` — Carddass Hyper Battle (tile vintage do OP)
- `game_naruto.webp` — Naruto Card Game 2002~2006 (tile do jogo, tile vintage e
  `setLogo` de todos os sets do Naruto, via sync-naruto-vintage.mjs)
- `game_naruto.svg` — FONTE vetorial do logo do Naruto (Inkscape). Se editar,
  re-exporte o webp: @resvg/resvg-js (ou qualquer rasterizador) em 512px e
  depois `ffmpeg -i logo.png -c:v libwebp -quality 90 game_naruto.webp`.

## Conversão (novo logo)

```sh
ffmpeg -i logo.png -vf "scale=512:-1" -c:v libwebp -quality 88 game_<slug>.webp
```

## Notas

- **Contraste:** o CSS põe um chip branco atrás do logo, então logos escuros
  ficam legíveis nos dois temas.
- **Proporção:** paisagem; o CSS usa `object-fit: contain` — não precisa de
  tamanho exato.
- O CSP (`img-src 'self'`) já cobre arquivos locais.

> São marcas registradas dos respectivos titulares; o uso aqui é nominativo (pra
> identificar os jogos), e o site já traz o disclaimer no rodapé.
