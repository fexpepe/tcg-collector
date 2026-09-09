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

1. **Câmera ao vivo** (`getUserMedia`, câmera traseira) em **tela cheia**, com
   uma **moldura-guia 63/88 a 86 % da largura** e tudo o mais flutuando em
   vidro por cima (segunda versão, 2026-09-09, na linha do que o Collectr
   faz): barra de topo abaixo da safe-area com Fechar, o jogo detectado como
   chip e lanterna; disparador redondo embaixo, galeria à esquerda e o
   contador do **lote** à direita; o resultado aparece num cartão entre o
   disparador e a moldura, com *+ Coleção* na hora; a correção (código, mais
   de um candidato) vive numa folha que só sobe quando precisa. A moldura
   maior não é só estética: o recorte passa de ~700 pra ~1200 px de largura
   no vídeo de 1920×1440, e os glifos do código dobram antes do OCR. A moldura
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
4. **Detecção do jogo** (`detectarJogo`, função pura com teste), porque o
   mesmo número existe em vários jogos — `4/102` é Pokémon, mas "4" é um set
   do Lorcana e um número do Magic, e a primeira versão devolvia os três.
   Três pistas somadas: o que a carta **imprime** no rodapé (© Pokémon /
   Nintendo, Wizards of the Coast, Disney, Eiichiro Oda, Konami…; +3, a mais
   forte), o **formato** do código (OP05- é One Piece, BT1- é Digimon,
   -EN001 é Yu-Gi-Oh, fração é Pokémon/Lorcana/Riftbound; +2 por jogo
   possível) e o jogo da **sessão** (+1, só desempate). Palavras que vários
   jogos dividem (BANDAI, SHUEISHA) ficam de fora. Se a faixa não bastou pra
   ter certeza, lê a carta inteira. O seletor *Jogo* do scanner mostra o
   detectado e a pessoa corrige se errar; "Automático" busca só nos jogos
   possíveis, e se nada sair com o filtro, tenta uma vez sem ele.
5. **Busca**, em duas camadas, pra cada candidato até achar:
   - `cmdkCardsByCode` (a mesma da paleta Ctrl+K): set + número exatos pelo
     manifest do jogo, baixando só o chunk do set;
   - `/api/search?game=all` (D1 na borda): indexa as palavras do número, então
     `4/102` acha todo "4" de set com 102 cartas, em qualquer jogo; os hits são
     hidratados com `loadOwnedAcrossGames`.
   Com o jogo detectado a borda é consultada **por jogo** (resposta menor e
   mais precisa). O resultado é ranqueado com número exato primeiro, depois
   pela confiança do jogo. O primeiro vira o cartão flutuante (miniatura, nome,
   set · número, valor de mercado quando há, *+ Coleção*, toque abre o set);
   "+N opções" abre a folha com os candidatos em fileira pra tocar na certa.
6. **Fallbacks**: sem câmera (webview, permissão negada) fica o botão de
   galeria (`<input type=file capture=environment>`); código lido errado se
   corrige no campo da folha e busca de novo; nada achado → a folha abre
   sozinha com o código e um link pro Explorar.

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
- Pokémon e Lorcana ainda voltam **vários candidatos** dentro do jogo (o
  número se repete entre sets com o mesmo total); a pessoa escolhe pela
  miniatura. Ler o código do set impresso (SVI, PAL…) é a fase 1.5.
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
