# JUMP — sets curados

Promos de **Jump Festa / V-Jump / revista Shonen Jump** não têm fonte única nem
API: a fonte de verdade é **este diretório**, versionado no git. Cada arquivo
`.json` é um set (por evento/ano); arquivos começando com `_` são ignorados.

Compilar: `node scripts/build-jump.mjs` (gera `data/jump/cards.js` etc.).
O build FALHA em erro de curadoria (campo faltando, número duplicado no set).

## Schema (`meu-set.json`)

```json
{
  "name": "Jump Festa 2000",
  "date": "1999-12",
  "language": "ja",
  "vintage": true,
  "logo": "",
  "total": 0,
  "cards": [
    {
      "number": "JF00-01",
      "name": "Nome da carta",
      "nameJp": "日本語名",
      "franchise": "Dragon Ball",
      "rarity": "Promo",
      "artist": "",
      "image": "https://... (ou vazio = placeholder do site)",
      "note": "distribuída no evento X"
    }
  ]
}
```

- `franchise` vira o "tipo" da carta no site (filtrável).
- `number` precisa ser único dentro do set (o id da carta deriva dele).
- Imagens: preferir espelhar em `data/jump/images/` e referenciar o caminho
  relativo (mesmo padrão do vintage do One Piece), não hotlink de wiki de fã.

## Sets curados (2026-11-14)

As cinco **ジャンプフェスタ特製 WJカードセット** (Shueisha/Bandai, vendidas
só na Jump Festa, 2001–2005): 24 cartas cada, o set inteiro num pacote. O
verso imprime o número, o **título da série**, o autor e a sinopse — nenhuma
carta imprime nome de personagem, então o `name` é o título da série (em
inglês; o original no `nameJp`) e a `franchise` é a mesma série. SP1 e SP2 são
prismas que juntam uma ilustração só; EX são as especiais. Os sets levam o nome
do EVENTO (Jump Festa 2001 foi vendida em 23/12/2000 e o verso diz 2000):
anúncio e etiqueta da PSA misturam os dois anos.

Procedência (conferida em 14/11/2026):
- a escalação de séries por ano: cardcheckbox.com/a03b-shueisha/wjcardset.html
  (sem a ordem das cartas, e com a ordem errada em 2002 nº 9–12 e 2003 nº 7/8);
- a ordem e o número: o verso das cartas nas fotos de carta avulsa do Suruga-ya
  (2001, 2002, 2003, 2005), lidas uma a uma;
- 2004: a foto dos 24 versos em ordem (Mercari m72690720011), anúncios de carta
  avulsa e graduada (Yahoo! Leilões) e a descrição do set no Suruga-ya. Os nº 4,
  6, 8–11, 14 e 17 saem da ORDEM da foto, sem o número legível (anotado no
  `note` do set).

Sem imagem: o Suruga-ya barra acesso automatizado à página do produto (403), e
pelo contrato 4 do docs/CATALOGO.md o bloqueio não se contorna. Os nomes em
inglês são os títulos conhecidos no Ocidente ou a romanização; o 無頼男 fica em
japonês até achar a grafia usada em inglês.

Fora, por enquanto: as cartas de 55 anos da revista (2023, 55 cartas com
personagem e série, sem número impresso conferido), a All-Star Card Collection
da exposição de 50 anos (2017–18, sem lista em texto) e os cartões de visita da
Movic (mercadoria, sem número).
