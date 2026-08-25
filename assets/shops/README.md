# Logos das marketplaces (home)

Padrão: **`shop_<nome>.webp`**, ~512px de largura, fundo transparente (mesma
receita dos logos de jogo em `../games/`). O `index.html` já aponta pra estes
nomes; o `home.js` revela o `<img>` quando o arquivo carrega e esconde o nome
em texto (fallback sem erro) — ou seja: **basta colocar o arquivo aqui com o
nome certo e o logo aparece**, sem tocar em HTML.

O ambiente do agente não tem saída de rede pros sites das lojas, então os
arquivos precisam ser baixados e colocados aqui à mão (logo oficial do site de
imprensa/brand de cada uma).

## Arquivos esperados

- `shop_ligamagic.webp` — LigaMagic (o grupo Liga; cobre todos os jogos)
- `shop_myp.webp` — MYP Cards
- `shop_ebay.webp` — eBay
- `shop_tcgplayer.webp` — TCGplayer
- `shop_pricecharting.webp` — PriceCharting
