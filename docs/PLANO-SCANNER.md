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
   maior não é só estética: em retrato a largura nativa do recorte é ~40 % da
   altura do quadro, e os glifos do código crescem junto antes do OCR. Por
   isso a câmera é pedida em **4K** (`ideal`, o navegador dá o modo mais
   próximo que tem): a 1920×1440 a carta sobrava com ~760 px de largura e o
   código do One Piece (~1,8 mm) com ~20 px — trocava dígito. A moldura
   dispensa detecção de contorno (OpenCV.js pesa 8 MB); cada recorte sai
   **direto da fonte, em resolução nativa** (a primeira versão reamostrava a
   carta pra 1000 px e cortava a faixa dessa cópia: jogava fora a maior parte
   dos pixels de uma foto de 12 MP e depois ampliava o borrão). O toque no
   disparador **congela um quadro** (2026-09-10): o vídeo é copiado, em
   resolução nativa, pra um canvas fora da tela, e todos os passes do OCR saem
   desse quadro — antes cada passe redesenhava do vídeo ao vivo, então a
   carta tinha de ficar imóvel por 2-4 passes e a votação entre as escalas do
   rodapé comparava quadros diferentes. Como no Collectr, o vídeo segue ao
   vivo e a foto vai pro canto: o cartão de resultado mostra uma miniatura
   do recorte da moldura com o status ("Lendo…", "Procurando…") e, quando
   acha, vira o resultado de sempre no mesmo tamanho. O quadro inteiro é
   zerado no fim da leitura; a miniatura morre com o cartão. Nada vai pra
   disco nem cache.
2. **OCR no aparelho** com Tesseract.js 7 (WASM, Apache-2.0), auto-hospedado em
   `assets/vendor/tesseract-7.0.0/` — a CSP é `script-src 'self'`, então nada
   vem de CDN. Modelo `eng` do tessdata_fast (LSTM, ~2 MB gz), whitelist
   `A-Z 0-9 / - .`, modo *sparse text* e `user_defined_dpi` 300 (canvas não
   carrega DPI; sem isso o motor assume 70 e estima a fonte errado). Lê do
   recorte mais justo pro mais largo: o **rodapé** (15 % de baixo, ampliado
   pra 1800 px de largura), que se sair inseguro (confiança do motor < 85 na
   palavra do código) é relido noutra escala e as duas leituras **votam**;
   a **faixa** larga (24 %) só se o rodapé não deu código (carta menor que a
   moldura, torta); e a carta inteira só sem código ou sem saber o jogo.
3. **Extração de candidatos** (`extrairCodigos`, função pura com teste):
   códigos com hífen, Union Arena, FAB, fração `N/T`, Magic `SET NUM` e Lorcana
   `SET NUM`, com correção das confusões clássicas do OCR (O→0, I→1, S→5, B→8)
   só na parte que tem de ser numérica, raridade grudada no número
   (`OP05-119SR`, `OP01-001L`) e `0P05-` de volta a `OP05-`. A ordem dos
   candidatos é por **peso do formato**, não pela posição no texto: o One
   Piece imprime o copyright em japonês à esquerda do código, o modelo inglês
   transcreve aquilo como lixo (`E-12`, `3/7`) e, na ordem do texto, o lixo ia
   pra busca antes do `OP05-119` e a borda "achava" carta errada. Formato de
   jogo conhecido vale 3, fração plausível/Magic/Lorcana/FAB 2, hífen de
   prefixo desconhecido 1, duvidoso 0; empate desempata pela confiança que o
   Tesseract deu à palavra. No Magic o set ("HOB • EN") e o número são
   casados em duas partes: o número logo antes vale 2; se o artista se meteu
   entre os dois no texto (fica na linha do número), um número com zero à
   esquerda ("0042") ou uma fração de total >= 100 em qualquer lugar vale 1 —
   e os dígitos passam pela correção de OCR ("004Z" -> 42, e não "HOB 4").
4. **Detecção do jogo** (`detectarJogo`, função pura com teste), porque o
   mesmo número existe em vários jogos — `4/102` é Pokémon, mas "4" é um set
   do Lorcana e um número do Magic, e a primeira versão devolvia os três.
   Três pistas somadas: o que a carta **imprime** no rodapé (© Pokémon /
   Nintendo, Wizards of the Coast, Disney, Eiichiro Oda, Konami…; +3, a mais
   forte), o **formato** do código (OP05- é One Piece, BT1- é Digimon,
   -EN001 é Yu-Gi-Oh, fração é Pokémon/Lorcana/Riftbound; +2 por jogo
   possível, e formato que só um jogo usa vale como palavra impressa — as
   cartas do One Piece em inglês não imprimem nada legível além do código) e
   o jogo da **sessão** (+1, só desempate). Palavras que vários
   jogos dividem (BANDAI, SHUEISHA) ficam de fora. Se a faixa não bastou pra
   ter certeza, lê a carta inteira. O seletor *Jogo* do scanner fica em
   "Automático" (busca só nos jogos possíveis e, se nada sair com o filtro,
   tenta uma vez sem ele) até a pessoa escolher um jogo — aí a busca fica
   presa nele. A detecção não grava no seletor: quando gravava, um Pokémon
   lido primeiro travava a busca em Pokémon e a carta seguinte de outro jogo
   não era achada.
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

- Foto em resolução plena via `ImageCapture.takePhoto()` (Android/Chrome)
  em vez do quadro do vídeo: mais pixels e foco refeito no disparo. Fica
  condicionado a checar no aparelho a orientação e o campo de visão do JPEG
  contra o vídeo — quando diferem, a moldura cai no lugar errado.
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
