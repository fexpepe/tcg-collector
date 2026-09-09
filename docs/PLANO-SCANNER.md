# Scanner de carta pela câmera — plano de execução

Objetivo: no celular, tocar num ícone de câmera, apontar pra carta e o Sleevu
achar a carta no catálogo — o que o Collectr, o Delver Lens e o ManaBox fazem.
Sem API paga e sem a foto sair do aparelho: o motivo que deixou o "Scanner IA"
fora do PLANO-UX-2 (custo) cai quando a leitura roda no navegador.

Não existe um "Delver Lens open source" pronto. O que existe são componentes
(OCR em WASM, hash perceptual, detecção de carta) e projetos pequenos que os
combinam — o mais próximo do nosso caso é o
[mtgscan](https://github.com/GrimbiXcode/mtgscan) (JS puro + Tesseract.js, lê
o número de coleção e consulta o Scryfall). O plano abaixo segue essa linha,
adaptada aos 13 jogos e ao catálogo local.

## Fase 1 — OCR do código impresso ✔ (esta entrega)

**Ideia.** Quase todo jogo imprime um código único e legível na carta:
One Piece `EB01-001`, Digimon `BT1-001`, Gundam `EXB-001`, FAB `WTR001`,
Yu-Gi-Oh `LOB-EN001`, Union Arena `UE21BT/RLY-1-082`, Magic número + código do
set (`MH3 • EN`), Pokémon `123/198`, Lorcana `12/204 · EN · 4`. O catálogo já
guarda isso em `number` (e `setId`), então achar a carta é OCR + busca local.

**Como funciona** (`src/scan.js`, injetado no primeiro uso):

1. **Câmera ao vivo** (`getUserMedia`, câmera traseira) com uma **moldura-guia
   63/88** na tela. A pessoa encaixa a carta e toca em *Ler carta*. A moldura
   dispensa detecção de contorno (OpenCV.js pesa 8 MB); o recorte é o retângulo
   da guia, reamostrado pra ~1000 px de largura.
2. **OCR no aparelho** com Tesseract.js 7 (WASM, Apache-2.0), auto-hospedado em
   `assets/vendor/tesseract-7.0.0/` — a CSP é `script-src 'self'`, então nada
   vem de CDN. Modelo `eng` do tessdata_fast (LSTM, ~2 MB gz), whitelist
   `A-Z 0-9 / - .` e modo *sparse text*. Lê primeiro a **faixa inferior** da
   carta (24 % da altura, onde mora o código em quase todo jogo) e, se não sair
   código, a carta inteira.
3. **Extração de candidatos** (`extrairCodigos`, função pura com teste):
   códigos com hífen, Union Arena, FAB, fração `N/T`, Magic `SET NUM` e Lorcana
   `SET NUM`, com correção das confusões clássicas do OCR (O→0, I→1, S→5, B→8)
   só na parte que tem de ser numérica.
4. **Busca**, em duas camadas, pra cada candidato até achar:
   - `cmdkCardsByCode` (a mesma da paleta Ctrl+K): set + número exatos pelo
     manifest do jogo, baixando só o chunk do set;
   - `/api/search?game=all` (D1 na borda): indexa as palavras do número, então
     `4/102` acha todo "4" de set com 102 cartas, em qualquer jogo; os hits são
     hidratados com `loadOwnedAcrossGames`.
   O resultado é ranqueado com número exato primeiro e mostrado na hora, com
   *+ Coleção* / *+ Desejos* (como na paleta) e toque pra abrir o set.
5. **Fallbacks**: sem câmera (webview, permissão negada) o botão vira *Usar
   foto* (`<input type=file capture=environment>`); código lido errado pode ser
   corrigido no campo e buscado de novo; nada achado → link pro Explorar com o
   código.

**Onde aparece.** Ícone de câmera dentro de toda busca de página
(`.page-search`: Cartas, Explorar, Sets, Coleção, Wishlist…) e na paleta de
busca que a aba *Busca* da bottom-bar abre. Um botão só, dois lugares.

**Infra que mudou.**

- `_headers`: `script-src` ganha `'wasm-unsafe-eval'` (compilar WASM) e a
  `Permissions-Policy` passa de `camera=()` pra `camera=(self)` — antes o
  próprio site estava proibido de abrir a câmera.
- O worker do Tesseract nasce de URL (`workerBlobURL: false`): `worker-src
  'self'` continua como está, sem `blob:`.
- Peso: **zero** pra quem não usa. Os ~3,5 MB gz (core WASM 1,5 MB + modelo
  2 MB) descem no primeiro scan, ficam no cache HTTP (`/assets/*` é immutable),
  no cache do service worker e o modelo também no IndexedDB do Tesseract.
  `shared.js` cresceu só o botão e o injetor (~0,5 KB gz).

**Limites conhecidos da fase 1** (medir no aparelho antes de decidir a fase 2):

- Depende de luz e de segurar parado; foil e reflexo derrubam o OCR.
- Pokémon e Lorcana voltam **vários candidatos** (o número se repete entre
  sets com o mesmo total); a pessoa escolhe pela miniatura.
- Vintage (Naruto, HxH, Carddass) não tem código legível — fica pra fase 2.
- Yu-Gi-Oh: o código fica embaixo da arte, não no rodapé — cai na leitura da
  carta inteira, mais lenta.
- Em dev (sem `/api/search` nem manifest) a busca só vê o catálogo do jogo da
  sessão; o teste real é no preview/produção.

## Fase 1.5 — afinar com dados reais

- Log local (só no aparelho) de "texto lido → código → achou?" pra medir a
  taxa de acerto por jogo e ajustar regex/whitelist/faixa.
- Ranquear Pokémon pelo **código do set** impresso (SVI, PAL, OBF…) mapeando
  pra `setId` da TCGdex — precisa de um de-para novo (o `set-id-map` atual é
  TCGdex → pokemontcg.io).
- Yu-Gi-Oh: ler o **passcode** (8 dígitos no canto inferior esquerdo) se o
  catálogo passar a guardá-lo.
- Modo **lote**: ler e adicionar em sequência sem fechar (abrir booster).
- Atualizar `/comparar` (hoje diz que o Sleevu não tem scanner) **depois** de
  validar a taxa de acerto, não antes.

## Fase 2 — hash perceptual da arte

Pra vintage e pra quando o código não sai: hash de 64–256 bits por carta,
calculado num script de `scripts/` a partir das imagens que o sync já baixa;
índice por jogo (~8 bytes por carta → ~1,2 MB pros 150 k) e distância de
Hamming no cliente, limitada ao jogo ativo, devolvendo os 3 melhores pra
confirmação. A fragilidade é foil/perspectiva; a moldura-guia da fase 1 já
resolve o enquadramento. Fica condicionada ao que a fase 1.5 medir.

## Fora do plano

- Modelo próprio de ML (o que o Delver Lens usa): treinar e distribuir um
  modelo por jogo não se paga pra coleção pessoal enquanto OCR + hash cobrem.
- API paga de visão: contraria o local-first e a promessa de "a foto não sai
  do aparelho" (a mesma do medidor de centralização).

## Validação

- `node --test tests/*.test.mjs` (inclui `tests/scan-codes.test.mjs`),
  `node scripts/check.mjs`, `node scripts/check-mobile.mjs`, orçamento de
  peso (`scripts/check-size.mjs`).
- No celular (preview ou produção): One Piece, Pokémon SV, Magic moderno e
  Lorcana — carta na moldura, luz de ambiente, sem flash. Anotar o texto lido
  quando errar: é o insumo da fase 1.5.
