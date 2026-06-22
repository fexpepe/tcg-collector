# Logos dos jogos (seção "Mais de um jogo" na home)

Coloque aqui os logos dos jogos. O `index.html` já aponta pra eles; assim que os
arquivos existirem, os logos aparecem (o `home.js` revela o `<img>` ao carregar) e
o nome em texto some. Sem os arquivos, fica o nome em texto (fallback) — sem erro.

## Arquivos esperados (nome exato)

- `pokemon.png` — logo do Pokémon TCG
- `lorcana.png` — logo do Disney Lorcana

(SVG também serve; se usar SVG, troque a extensão no `src` do `index.html`.)

## Recomendações

- **Formato:** PNG com **fundo transparente** (os logos oficiais são raster). SVG
  também serve.
- **Contraste:** o CSS já põe um **chip branco** atrás do logo, então logos com
  texto escuro (ex.: o roxo do Lorcana) ficam legíveis nos dois temas.
- **Proporção:** paisagem; o CSS usa `height: 64px` + `object-fit: contain`, então
  não precisa de tamanho exato.

## Trocar o caminho/nome

Se preferir outro nome/caminho, ajuste o `src` dos `<img class="game-logo">` em
`index.html`. O CSP (`img-src 'self'`) já libera arquivos locais — não precisa
mexer nele.

> São marcas registradas dos respectivos titulares; o uso aqui é nominativo (pra
> identificar os jogos), e o site já traz o disclaimer no rodapé.
