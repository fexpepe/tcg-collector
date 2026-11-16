# Logos das marketplaces (home)

Padrão: **`shop_<nome>.webp`**, ~512px de largura, fundo transparente (mesma
receita dos logos de jogo em `../games/`). O `home.js` revela o `<img>` quando
o arquivo carrega e esconde o nome em texto.

**Logo novo = arquivo aqui + `<img>` no `index.html`**, nos dois passos e no
mesmo commit. Até 2026-11-14 o `index.html` já apontava pros arquivos que
faltavam (a ideia era "basta soltar o arquivo aqui"), e isso custava três 404
em toda visita à home — ruído no console, no relatório de erro e no smoke, que
ficava preso em 24/25. Agora a cápsula sem logo nasce só com o nome em texto,
e o `tests/html-assets.test.mjs` quebra o CI se uma página da raiz voltar a
pedir arquivo de `assets/` que não existe. O `<img>` a colocar de volta é o
mesmo das outras cápsulas:

```html
<img class="lp-shop-logo" src="assets/shops/shop_<nome>.webp" alt="<Nome>" loading="lazy" decoding="async">
```

(antes do `<span class="lp-shop-text">`).

O ambiente do agente não alcança o site do MYP (403 pro robô), então os
arquivos que faltam precisam ser baixados à mão (logo oficial do site de
imprensa/marca de cada uma).

## Arquivos

- `shop_ligamagic.webp` ✔ — LigaMagic (o grupo Liga; cobre todos os jogos).
  Fonte de 400×400 com padding; recortada pro conteúdo (241×241). Fundo branco,
  que é o que a cápsula usa nos dois temas.
- `shop_ebay.webp` ✔ — eBay (fonte 1280×513 já com alfa, escalada pra 512).
- **FALTA `shop_myp.webp`** — MYP Cards. Fica na fileira mesmo sem o arquivo
  (decisão do Fernando, 2026-08-30), com o nome em texto.
- **FALTA `shop_tcgplayer.webp`** — TCGplayer. O site é uma SPA e o logo do
  cabeçalho não aparece nos arquivos que dá pra baixar (procurado em
  2026-11-14).
- **FALTA `shop_pricecharting.webp`** — PriceCharting. O único logo público
  (`/images/logo-pricecharting-new.png`) tem 200×62: na cápsula de 52px de
  altura dá densidade ~1,2×, borrado em tela retina (a régua do
  [docs/LOGOS.md](../../docs/LOGOS.md) pede 2×). Melhor o nome em texto que
  um logo macio.
