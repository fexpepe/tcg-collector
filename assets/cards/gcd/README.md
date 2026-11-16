# Imagens curadas de cartas — Gundam Carddass (vintage)

Um arquivo `<id-da-carta>.(webp|jpg|png)` nesta pasta vira a imagem da carta no
build do catálogo (`scripts/sync-gundam-carddass.mjs`, `curatedImg`) e passa na
frente do scan do animecollection.fr. Sem arquivo, vale o scan da fonte pelo
wsrv.nl. Carta que a fonte não tem (os prêmios da Comic BomBom) só ganha imagem
por aqui.

- O `<id>` é o id do catálogo (ex.: `gcd-wd13-500`, `gcd-wdp-124`); confira em
  `data/gcd/cards.js`.
- Prefira `.webp` com 440 px de largura, a mesma do scan servido pelo wsrv
  (`ffmpeg -i foto.jpg -vf scale=440:-1 out.webp`).
- Depois de salvar, rode `node scripts/sync-gundam-carddass.mjs --no-fetch` (o
  CI também aplica em todo deploy).

## O que mora aqui (2026-11-16)

Os três prêmios de sorteio da Comic BomBom do 本弾 (set `gcd-wdp`), que não têm
scan em fonte nenhuma:

| Arquivo | Carta | Impresso na frente |
|---|---|---|
| `gcd-wdp-0.webp` | No.0 | 武者ガンダムMK-Ⅱ / 武者ZG / 武者ガンダム, LIMITED 3000 |
| `gcd-wdp-124.webp` | No.124 | ガンダムチーム, LIMITED 6000, URL `www.carddas.com/no124` |
| `gcd-wdp-bb100.webp` | sem número | コミックボンボン100号記念スペシャルカード, 武者五人衆, LIMITED 10000 |

Recortes de fotos das cartas, escolhidos e mandados pelo Fernando em
2026-11-16 e reduzidos aqui para 440 px. A pesquisa daquele dia achou as três
em anúncios encerrados do Yahoo! Auctions (`m1251168577`, `s1251314890`,
`1230727630`). São fotos de vendedor, não scans; se aparecer um scan melhor,
ele entra no lugar com o mesmo nome. Não confundir com as reedições: o
`真124 真・ガンダムチーム` (20º aniversário) e o 0番 復刻版 que veio num box de
DVD são outras cartas.
