# Logos das marketplaces (home)

Padrão: **`shop_<nome>.webp`**, ~512px de largura, fundo transparente (mesma
receita dos logos de jogo em `../games/`). O `index.html` já aponta pra estes
nomes; o `home.js` revela o `<img>` quando o arquivo carrega e esconde o nome
em texto (fallback sem erro) — ou seja: **basta colocar o arquivo aqui com o
nome certo e o logo aparece**, sem tocar em HTML.

O ambiente do agente não tem saída de rede pros sites das lojas, então os
arquivos precisam ser baixados e colocados aqui à mão (logo oficial do site de
imprensa/brand de cada uma).

## Arquivos

- `shop_ligamagic.webp` ✔ — LigaMagic (o grupo Liga; cobre todos os jogos).
  Fonte de 400×400 com padding; recortada pro conteúdo (241×241). Fundo branco,
  que é o que a cápsula usa nos dois temas.
- `shop_ebay.webp` ✔ — eBay (fonte 1280×513 já com alfa, escalada pra 512).
- **FALTA `shop_myp.webp`** — MYP Cards. Fica na fileira mesmo sem o arquivo
  (decisão do Fernando, 2026-08-30): o ícone vem depois.
- **FALTA `shop_tcgplayer.webp`** — TCGplayer.
- **FALTA `shop_pricecharting.webp`** — PriceCharting.

Enquanto faltarem, o `index.html` aponta pros três e o `home.js` deixa o nome em
texto — sem ícone quebrado, mas com 404 no log (é o que mantém o smoke em 24/25).
