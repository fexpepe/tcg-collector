# Imagens curadas de cartas — Dragon Ball Carddass (vintage)

Um arquivo `<id-da-carta>.(webp|jpg|png)` nesta pasta vira a imagem da carta no
build do catálogo (`scripts/sync-dbc-carddass.mjs`). Sem arquivo, a carta fica
sem imagem (o 80storage, fonte da lista, não tem scan).

## De onde vieram as 631 do 第1弾 ao 第15弾 (2026-10-27)

Do **dragonballcards.com**, pelo Wayback Machine. O site saiu do ar (a Cloudflare
responde 1001), e o Wayback guardou as páginas `carddass-part-1..15.html` com
os arquivos das imagens. Do 第16弾 em diante as páginas de lá existem, mas as
imagens delas são cópias de molde do Weebly (nome com `_` na frente) que o dono
nunca trocou. A parte 17, por exemplo, mostra as cartas da parte 1. Nenhuma
dessas cópias foi arquivada, então essas partes seguem sem imagem.

- Tamanho nativo do site: 225×155 (carta deitada) ou 155×225 (em pé). O
  `_orig` do Weebly é o mesmo arquivo. Fica abaixo dos ~440 px do contrato do
  README da raiz. Não há versão maior em lugar nenhum. Webp q88 sem metadado.
- Têm a marca d'água "www.dragonballcards.com". O Fernando aceitou assim.
- A página põe 6 cartas por linha, na ordem do número, que é a ordem do
  catálogo. São duas exceções, conferidas carta a carta numa folha de contato:
  - 第7弾: a página abre com a No.216 escondida (Ginyu), e o catálogo a põe no
    fim (`dbc-h07-216`).
  - 第12弾: a página traz o prisma 三大超サイヤ人 (`dbc-h12-500b`) antes do THE
    MEMORIAL CARDDASS (`dbc-h12-500`).

Scan melhor de uma carta substitui o arquivo dela aqui, com o mesmo nome. Depois
de salvar, rode `node scripts/sync-dbc-carddass.mjs --no-fetch`; o CI também
aplica isso em todo deploy.
