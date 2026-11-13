# Imagens curadas de cartas — Dragon Ball Carddass (vintage)

Um arquivo `<id-da-carta>.(webp|jpg|png)` nesta pasta vira a imagem da carta no
build do catálogo (`scripts/sync-dbc-carddass.mjs`) e passa na frente do scan
da fonte. Sem arquivo, vale o scan do dbzcollection.fr pelo wsrv.nl.

## De onde vem a imagem hoje (2026-11-12)

Do **dbzcollection.fr**, fã-site francês que tem o scan de todas as cartas do
Hondan, do 特別弾, da Super Battle, da Visual Adventure e da Super Barcode
Wars (a versão `h3000`, ~490 px de largura). O site só responde em HTTP, então
a imagem sai pelo wsrv.nl, como nos outros vintages de fã, e o espelho do R2
copia de lá. Tem a marca d'água do site; nos scans mais antigos ela atravessa a
carta na diagonal. O Fernando aprovou assim (2026-11-12).

## O que morava aqui antes

Até 2026-11-12 esta pasta tinha os 631 webp do 第1弾 ao 第15弾, tirados do
**dragonballcards.com** pelo Wayback Machine (2026-10-27, PR #215): 225×155 ou
155×225, com a marca d'água "www.dragonballcards.com". Saíram quando o scan do
dbzcollection, com o dobro da largura, cobriu as mesmas cartas. Estão no
histórico do git, se um dia fizerem falta.

## Scan melhor de uma carta

Salve aqui com o id da carta no nome (`dbc-h06-215b.webp`). Depois rode
`node scripts/sync-dbc-carddass.mjs --no-fetch`; o CI também aplica isso em
todo deploy, inclusive no build rápido do push.
