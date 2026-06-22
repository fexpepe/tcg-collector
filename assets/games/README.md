# Logos dos jogos (seção "Mais de um jogo" na home)

Coloque aqui os logos dos jogos. O `index.html` já aponta pra eles; assim que os
arquivos existirem, os logos aparecem (o `home.js` revela o `<img>` ao carregar) e
o nome em texto some. Sem os arquivos, fica o nome em texto (fallback) — sem erro.

## Arquivos esperados (nome exato)

- `pokemon.svg` — logo do Pokémon TCG
- `lorcana.svg` — logo do Disney Lorcana

## Recomendações

- **Formato:** SVG (ideal — vetor, nítido, leve). PNG com fundo transparente serve.
- **Fundo transparente.**
- **Legível nos dois temas** (claro e escuro): o card é claro no tema claro e
  escuro no tema escuro. Logos coloridos (ex.: Pokémon) funcionam nos dois; logos
  só-escuros podem sumir no tema escuro. Se necessário, mande versões que
  contrastem, ou um logo com contorno/área clara.
- **Proporção:** algo em torno de paisagem; o CSS limita a `max-height: 46px` e
  `max-width: 170px` (`object-fit: contain`), então não precisa de tamanho exato.

## Trocar o caminho/nome

Se preferir outro nome/caminho, ajuste o `src` dos `<img class="game-logo">` em
`index.html`. O CSP (`img-src 'self'`) já libera arquivos locais — não precisa
mexer nele.

> São marcas registradas dos respectivos titulares; o uso aqui é nominativo (pra
> identificar os jogos), e o site já traz o disclaimer no rodapé.
