# Tesseract.js (auto-hospedado)

OCR em WASM usado pelo scanner de carta (`src/scan.js`). Auto-hospedado porque
a CSP do site é `script-src 'self'` — nada vem de CDN. A pasta leva a versão no
nome (`/assets/*` é immutable por um ano): pra atualizar, crie outra pasta e
aponte o `VENDOR` do `scan.js` pra ela.

| Arquivo | Origem | Licença |
|---|---|---|
| `tesseract.min.js`, `worker.min.js` | npm `tesseract.js@7.0.0` (`dist/`) | Apache-2.0 (`LICENSE-tesseract.js.txt`) |
| `tesseract-core-simd-lstm.wasm.js` | npm `tesseract.js-core@7.0.0` | Apache-2.0 (`LICENSE-tesseract.js-core.txt`) |
| `tesseract-core-lstm.wasm.js` | idem — fallback sem SIMD | idem |
| `eng.traineddata.gz` | `tesseract-ocr/tessdata_fast` (`eng.traineddata`, gzip -9) | Apache-2.0 |

Os dois núcleos são a build **LSTM-only** (`OEM.LSTM_ONLY`) — a única que o
modelo `fast` aceita e ~1 MB menor que a completa. O `scan.js` aponta o
núcleo por caminho explícito (SIMD primeiro, sem-SIMD se falhar) em vez de
deixar o worker escolher, porque a escolha automática pediria também a
variante `relaxedsimd` (+4 MB) e resolveria o caminho contra a URL do worker.
