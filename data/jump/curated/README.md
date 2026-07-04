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
