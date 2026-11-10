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
   os **cantos direitos ampliados** (metade da largura, glifos com o dobro de
   pixels) só se o rodapé inteiro não deu código com formato de jogo — o de
   baixo (One Piece, código miúdo) e o de cima (Gundam, o único que imprime o
   código no alto; com o jogo já sabido começa por ele); a **faixa** larga
   (24 %) só se ainda não houver código (carta menor que a moldura, torta); e
   a carta inteira só sem código ou sem saber o jogo. Ver "Medição de
   2026-09-29" abaixo. *(Esta ordem valeu até 2026-11-10; a de hoje — três
   tratamentos do rodapé, topo, carta inteira e duas escalas maiores, com a
   foto conferindo a cada passada — está na fase 1.8.)*
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

**Medição de 2026-09-29: One Piece, Gundam e Lorcana.** Em campo o scanner
acertava Magic e Pokémon e quase nenhum dos outros. Reproduzido com as imagens
oficiais das cartas (8 One Piece, 7 Gundam, 9 Lorcana, 4 Magic, 4 Pokémon)
passadas por uma "foto" simulada — desfoque, 1,5° de inclinação, contraste
baixo, ruído e JPEG — e o `ler()` sem a interface:

| | One Piece | Gundam | Lorcana | Magic | Pokémon |
|---|---|---|---|---|---|
| antes | 2/8 | 1/7 | 7/9 | 3/4 | 1/4 |
| depois | 5/8 | 7/7 | 7/9 | 3/4 | 2/4 |

(Com as imagens limpas, sem a "foto": One Piece 3→7/8, Gundam 1→5/7,
Lorcana 7→9/9.) As causas, todas do lado da extração e do recorte:

- **Gundam**: o código fica no ALTO da carta e nenhum passe lia o topo de
  perto — só a carta inteira, em escala baixa. E a fonte dele sai do OCR como
  `6001-110` / `G001-001` / `S002-030` (G→6/S/C, D→0): começando por dígito,
  nem virava candidato. Agora vira `GD01-…` e o canto de cima é lido.
- **One Piece**: o "O" inicial e o zero do set somem (`P01-016`, `OP3-040`), a
  raridade e o contador de DON grudam no número (`OP07-05163`, `ST10-00308`)
  e às vezes some um zero do número (`OP11-80`, que não casa com `OP11-080`
  guardado inteiro). A regex parava em 4 dígitos e descartava.
- **Lorcana**: bug de busca, não de OCR — "1 11" (set 1, carta 11) colado dava
  "111" e casava a carta 111 do set 1, posta na frente como "exata".
- **Onde** o código foi lido virou pista do jogo: no topo é Gundam; no rodapé
  não é. O `ST10-003` do One Piece voltava como carta do Gundam.

O que sobra: dígito trocado sob desfoque (`OP05-119` → `OP00-119`, Lorcana
`76` → `16`), o `ST10-003` do One Piece lido `ST10-03` (formato do Digimon) e
o Pokémon SWSH `100/195`, que nenhuma versão lê. O banco de imagens não está
no repositório (imagens das editoras); fica em `data/.cache/scan-test/` de
quem mediu.

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
- ~~Atualizar `/comparar` (hoje diz que o Sleevu não tem scanner) **depois** de
  validar a taxa de acerto, não antes.~~ **Resolvido em 19/09/2026, por outro
  caminho.** A regra era não vender acerto sem ter medido, e ela continua de pé
  — mas "o Sleevu não tem scanner" não era prudência, era **falso**, e estava
  nos três idiomas da landing de maior intenção do site (quem pesquisa
  "alternativa ao Collectr" cai ali). A saída foi descrever o **mecanismo e o
  limite** — "lê o código impresso na carta; carta sem código impresso
  (vintage) ainda não" — que não depende de taxa de acerto nenhuma, e manter o
  scanner do Collectr como o melhor na seção "Onde o Collectr é melhor", que é
  verdade: o deles reconhece a carta em si, o nosso lê o código. Quando a fase
  1.5 medir, o que muda é a **ênfase**, não o fato. A
  `tests/comparar-veracidade.test.mjs` trava a classe do bug: enquanto
  `src/scan.js` existir, a página não pode negar o scanner.

## Fase 1.6 — o ManaBox como régua (2026-09-28)

O ManaBox (Magic) é a referência de scanner que o Fernando escolheu. Ele
reconhece pela **arte** (acha as bordas da carta num fundo liso e compara a
imagem), lê sem disparador — a carta entra no quadro, toca um som, vem a
próxima —, junta tudo numa lista da sessão com total, avisa por som a faixa
de preço (< US$ 1, 1–10, > 10) e deixa travar o set. O ponto fraco, que o FAQ
dele admite: pela arte, reimpressão com a mesma arte sai na versão errada.

O Sleevu faz o inverso — lê o **código** —, e o código tem o buraco
simétrico. Contado no catálogo: o mesmo set + número vale pra **54 %** das
cartas do Digimon, **53 %** do Gundam, **40 %** do DBFW, **35 %** do Union
Arena e **30 %** do One Piece e do Yu-Gi-Oh (8 % no FAB; ~0 % no Magic e no
Lorcana; no Pokémon set + número é único, mas a fração sozinha repete entre
sets). E o que separa essas cartas é o que vale dinheiro: Alternate Art,
Parallel, Manga, SP, R+. A busca devolvia a primeira do catálogo — quase
sempre a comum. Juntar os dois (o código diz set e número, a foto diz a arte)
é o que dá pra fazer melhor que o ManaBox. A ordem de entrega, uma PR por
item:

1. **Conferência pela imagem** ✔ (esta entrega) + **medir a precisão** ✔.
2. **Travar o set** ✔ (além do jogo).
3. **Som e vibração por faixa de preço** ✔ (em R$, configurável) e aviso de wishlist.
4. **Leitura automática** ✔ (sem disparador) com dicas ao vivo, e a **lista da
   sessão** ✔ no lugar do contador de lote.
5. Reconhecimento pela arte (a fase 2 abaixo, redesenhada): depois de medir.

**Conferência pela imagem** (`conferirPelaFoto`, `src/scan.js`). Quando o
código casa com mais de uma carta, antes de o resultado aparecer, a foto
(o quadro já congelado no disparo) é comparada com a miniatura de cada
candidato, e a ordem muda se a diferença for clara. A **assinatura** é a
carta reduzida a uma grade 16×22 com três canais por célula — luz e duas
cores opostas —, cada canal sem a média (tira o tom da lâmpada) e o vetor
com norma 1; a semelhança é o cosseno. Na foto, a carta é procurada em 36
recortes (4 escalas × 9 posições, porque ela fica ENTRE as duas molduras;
125 na galeria, onde a foto é livre), com imagem integral pra cada recorte
custar quatro leituras. As miniaturas vêm pela cadeia de sempre
(`cardImgChain`: espelho com CORS, origem, e o wsrv.nl por último, pro
Lorcast), com `sx=1` pra não pegar do cache a cópia sem CORS, prazo de 2,5 s
e um download por imagem. Regra (`ordemPelaFoto`): o 1º da busca só perde o
lugar se outro for mais parecido por **0,06** ou mais e parecido o bastante
(**0,3**); empate (mesma arte, foil ou carimbo diferente) deixa a ordem da
busca; entre os que empatam com o melhor, vence quem vinha antes; o resto da
folha segue por semelhança.

Calibrado com 89 cartas reais (38 grupos de mesmo código de One Piece,
Digimon, DBFW, Union Arena e Gundam, imagens do TCGplayer) e fotos
simuladas no Chromium — carta menor que o quadro, deslocada e girada,
desfocada, com tom de lâmpada, ruído, reflexo e SEM a marca "SAMPLE" que a
referência tem (a foto de verdade não tem):

| Cenário | Arte diferente: 1º certo antes → depois | Estragou um 1º certo |
|---|---|---|
| normal (borrão 0,5–2,5 px, reflexo em metade) | 43 % → 99 % | 0 |
| duro (borrão 2–4,5 px, reflexo sempre, ±7°) | 43 % → 99 % | 0 |
| extremo (carta fora da moldura, ±12°, borrão até 6 px) | 43 % → 87 % | 0 (com margem 0,03–0,04: 1) |

No fluxo real (câmera falsa no Chromium com a Chopper EB01-006 — comum,
Alternate Art e Manga, mais a reimpressão da Manga no Premium Booster), a
foto da comum mantém a comum; a da Alternate Art e a da Manga sobem cada uma
pro 1º lugar, e a reimpressão de mesma arte fica logo atrás. A comparação
leva ~1 s. Limites: foto real (brilho de foil, textura, capa) é mais dura
que a simulada — por isso a margem é conservadora e a métrica abaixo existe.

**Precisão medida.** "Achou" dizia que o código casou com ALGUMA carta. O
`scan_done` ganhou `amb` (leituras com mais de uma carta), `vis` (a foto
mudou o 1º), `troca` (a pessoa trocou o 1º resultado, uma vez por leitura) e
`dig` (buscas digitadas); a migração `20260928b` soma os quatro e o `/admin`
› Funil mostra "Precisão do scanner" (1º resultado aceito, com mais de uma
opção, a foto escolheu, digitou) e o "1º aceito" por jogo. Troca e busca à
mão são a pessoa dizendo que o scanner errou: é a régua de acerto, ao lado
do cartas/min, que é a de ritmo.

**Trava de set** (`travar`, `noSet`). O cadeado da barra de cima trava no
set da carta do resultado — no ManaBox a trava fica nas configurações e pede
o set numa lista; aqui é um toque sobre a carta que acabou de ser lida. Com
o set travado, o seletor de jogo dá lugar ao nome do set, as cartas do set
descem uma vez (o chunk do manifest, o mesmo que a paleta baixa pra busca
por código) e a busca roda nelas, sem ida à borda: o código inteiro
primeiro, em qualquer escrita da carta, e senão só o NÚMERO (`numeroDe`:
"4/102" → 4, "BT1-003 R" → 3, "UE21BT/RLY-1-082" → 82). É o que resolve o
"4/102" do Pokémon (mesmo número e total em vários sets), o total lido
errado ("4/182") e o prefixo lido errado ("EB07-006" acha o -006 do set); na
folha de correção, digitar só o número basta. A leitura travada pula a
passada da carta inteira (o jogo já é sabido). Três leituras seguidas com o
1º resultado no mesmo set sugerem a trava (dica sob a moldura e um anel no
cadeado), e a folha "+N opções" tem o próprio cadeado — é ali que se vê que o
número existe em mais de um set. A trava é da SESSÃO do scanner: esquecida,
faria a carta de outro set "não existir" na próxima vez. Se o set não baixar
(rede), ela vira filtro da busca normal. Conferido no fluxo real (câmera
falsa, 390 e 320 px): travado no EB-01, a leitura da EB01-006 traz só as
três versões do set — as reimpressões do Premium Booster, que têm o mesmo
código, ficam de fora.

**Som por faixa de preço** (`faixaDePreco`, `configSom`, `SONS`). Cada leitura
avisa por som e vibração em que faixa a carta está — é o que deixa triar
bulk sem olhar a tela, o melhor do ManaBox pra quem abre caixa. Lá são três
faixas fixas em US$/€ (< 1, 1–10, > 10); aqui valem na moeda do site, com
padrão de R$ 5 e R$ 50 (US$/€ 1 e 10), e a pessoa muda no painel do alto-
falante da barra — o par só é salvo quando faz sentido (a de baixo menor que
a de cima), sem desfazer o que foi digitado, e fica POR MOEDA (trocar a moeda
do site não faz "5" virar cinco dólares). Os sons são gerados na hora (Web
Audio, sem arquivo): uma nota grave pra barata, duas subindo pra média, um
arpejo pra boa, e um arpejo próprio, mais alto, pra carta que está na
WISHLIST — é a que a pessoa foi procurar no booster, e o cartão ganha o selo
"Na wishlist". Carta boa ou da wishlist também ganha um anel dourado no
cartão (o aviso que funciona com o som mudo). A vibração acompanha em pulsos
(Android; o iPhone não vibra pela web). O áudio nasce dentro do toque do
disparador ou do painel, que é o que o Safari exige; no iPhone, a chave de
silêncio cala o scanner. A preferência é do aparelho (localStorage, com o
padrão quando não há). Conferido no fluxo real com um espião no
AudioContext: a Manga (US$ 3.250) toca o arpejo da boa; na wishlist, o da
wishlist; com as faixas em 5000/9000, a nota grave; mudo, nada.

**Leitura automática** (`medirQuadro`, `passoAuto`). O ManaBox lê sem
disparador: a carta entra no quadro, é lida, vem a próxima. Aqui um laço leve
(~8 quadros/s) reduz o recorte da moldura a 48×66 em cinza e mede luz,
reflexo, contraste e movimento contra a amostra anterior. A carta PARADA
(diferença média abaixo de 5) por três amostras seguidas, com luz (brilho
acima de 40) e com conteúdo (contraste acima de 18: a mesa lisa não conta),
dispara a leitura. Depois de qualquer leitura — automática ou no toque — o
laço só volta a ler quando a cena MUDA (diferença acima de 14: a carta saiu
ou trocou), senão lia a mesma carta a cada segundo; a segunda cópia da mesma
carta é o disparador, que continua lendo na hora. Sem amostra anterior, o
movimento é NaN — nem parada nem mudança: com 255 ali, a carta lida no toque
antes de o laço começar era lida de novo por ele (o teste pegou). O laço
pausa com qualquer folha aberta e com a aba escondida, e começa quando o
motor de OCR está pronto. As medidas viram dica ao vivo ("pouca luz",
"reflexo"), e a leitura automática que não acha código nenhum não abre a
folha de correção (o laço pode ter pego a carta ainda chegando): vira a dica
"afaste um pouco, evite reflexo" até a cena mudar. Com código lido e carta
não achada, a folha abre como antes. O botão ao lado da galeria liga e
desliga (ligado por padrão; preferência do aparelho). O `scan_done` conta as
leituras automáticas (`auto`).

**Lista da sessão** (o "scanned cards" do ManaBox). Toda carta lida entra
nela; a mesma carta de novo soma uma cópia; a ambígua — mesmo código e a foto
sem folga pra decidir (`ordemPelaFoto` devolve `claro`) — fica marcada
"Conferir", que abre as versões e troca o item. Escolher outra versão no
"+N opções" corrige a lista (só a cópia da última leitura), e a busca
digitada na folha também (a folha é "Corrigir leitura"). Condição e variante
(padrão, foil/holo, reverse — o "preferir foil" do ManaBox, e o reverse de
quem separa os reverses do Pokémon) valem pra sessão; "Adicionar N à
coleção" grava tudo o que falta, e o "+ Coleção" do cartão marca a cópia
dela. O botão da direita mostra a contagem e o total (só a contagem abaixo de
360 px). A lista fica no aparelho por 24 h — só ids, variante, quantidade;
nada da foto — e volta ao reabrir o scanner se ainda houver algo por
adicionar. Conferido no fluxo real com um vídeo falso alternando duas cartas
e a mesa vazia: cinco leituras sozinhas em 26 s (uma por aparição, nenhuma
repetida), a Oden Alternate Art e a Chopper Manga escolhidas pela foto, a
Chopper marcada pra conferir (empata com a reimpressão do Premium Booster,
de outro preço), o "Conferir" trocando pela reimpressão, a coleção recebendo
Foil em SP, e a lista de volta depois de fechar — em 390 e 320 px.

## Fase 1.7 — luz e diagnóstico (2026-11-01)

Em campo, cartas de DBFW e Pokémon deram erro com a luz do lugar, e nada no
scanner dizia em que etapa: o OCR não leu, leu errado, leu e o catálogo não
casou, ou casou a versão errada. Esta entrega mexe na captura e passa a medir.

- **Melhor de N quadros** (`rajada`, `nitidez`). O disparo congelava o quadro
  do instante do toque — justo o tremido (o dedo empurra o celular), e no
  escuro a câmera alonga a exposição. Agora colhe 4 quadros (3 na leitura
  automática, que já esperou a carta parar), com 90 ms ou mais entre eles, e
  lê o mais nítido na faixa do código: média do quadrado do laplaciano, a até
  480 px (reduzir também tira parte do ruído do escuro). Só um quadro inteiro
  na memória. Custa ~0,3 s antes do OCR.
- **Dicas de luz sempre.** Pouca luz e reflexo só eram medidos com a leitura
  automática ligada; quem usa o disparador ficava sem aviso. Agora o laço mede
  sempre e só não dispara. No escuro, a lanterna ganha o anel de sugestão; sem
  lanterna (iPhone pela web), a dica não manda acendê-la.
- **Foco e luz na faixa do código** (`focarNoCodigo`): `pointsOfInterest` no
  Android/Chrome, no meio do rodapé (topo no Gundam). A câmera media a cena
  inteira, e a faixa escura do código do DBFW (cinza-claro miúdo sobre azul-
  marinho) saía escura demais. Sem conferir em aparelho: o relatório diz se o
  pedido pegou (`foco x,y`) ou não (`foco padrao`).
- **Modo diagnóstico.** Segurar o disparador ~1,2 s (ou abrir com
  `?scandiag=1`; `=0` desliga) liga um botão "Diagnóstico" no canto da
  moldura. Ele abre a folha com a última leitura: a foto escolhida, a nitidez
  de cada quadro da rajada, cada recorte tratado que foi pro OCR (a imagem que
  o Tesseract viu), o texto lido, os candidatos, o jogo e a busca, com
  "Copiar relatório" (só texto). Fica só na memória e some ao fechar.
- **`scan_done` com `luz` e `luzOk`**: leituras cuja foto escolhida tinha
  pouca luz ou reflexo (o mesmo critério da dica) e quantas dessas acharam
  carta. Sem migração ainda: o `/admin` não soma; os números já ficam nos
  eventos.
- **DBFW Manga Booster** (`SB01-001`) virou formato de jogo. O DBFW imprime o
  copyright na VERTICAL ("©B.S./S., T.A") e o OCR não lê: o formato é a única
  pista, e o SB01 valia peso 1 e levava toda leitura até a carta inteira.

**O que o diagnóstico já mostrou** (câmera falsa no Chromium, carta sintética
no molde do DBFW: código cinza-claro em fonte de 1,7 % da altura da carta,
sobre a faixa azul-marinho). A rajada escolheu o quadro nítido (nitidez
`15 15 465*`), luz boa, e mesmo assim nenhuma das cinco passadas leu o código.
No recorte tratado o "FB03-036" está nítido e com contraste. Relido no
mesmo motor, só mudando a escala, ele sai com a palavra entre 10 e 31 px de
altura e some a partir de ~37 px: o rodapé a 1800 px e o canto a 1400 px
ampliavam demais ESTA carta, e o scanner não tem passada em escala menor.
Inverter (claro↔escuro) não muda nada. É uma carta desenhada, não uma foto: o
código do One Piece foi lido com ~50 px em setembro. Próximo passo: conferir
com o diagnóstico em cartas reais e, se repetir, medir uma passada em escala
menor no banco de `data/.cache/scan-test/`, com um cenário escuro.

## Fase 1.8 — o catálogo como vocabulário e a foto como verificador (2026-11-10)

Uma análise do scanner apontou sete frentes. Seis entraram aqui, cada uma
medida; a sétima (OCR nativo no app) ficou de fora, com o motivo no fim.

### A bancada

Até aqui cada mudança era medida num ensaio próprio. Agora há uma bancada só,
que roda a LEITURA INTEIRA (OCR, extração, busca, conferência) no Chromium,
pelo caminho da galeria, com o catálogo de produção por trás:

- **139 cartas reais de 13 jogos** (One Piece, Digimon, Gundam, DBFW, Union
  Arena, Lorcana, FAB, Weiss, SWU, Riftbound, Pokémon, Magic, Yu-Gi-Oh),
  sorteadas do catálogo com semente fixa, mais 47 de nove jogos sem código
  (DBZ, LOTR, WoW, Sorcery, Cyberpunk, HxH, Carddass) pra bancada do set
  travado. As imagens são as do catálogo (600–716 px de largura): equivalem a
  um vídeo de 1080p, não ao 4K que a câmera pede — a bancada é pessimista.
- **Três cenários de foto simulada**: *limpa* (a imagem, 86 % do quadro);
  *foto* (80–92 % do quadro, ±2°, borrão de 0,6–1,4 px, contraste 0,8, ruído,
  tom de lâmpada, reflexo em metade); *dura* (74–95 %, ±5°, borrão de 1,2–2,4
  px, contraste 0,62, 60 % de luz, reflexo sempre).
- **O que conta**: carta *certa* (o 1º resultado é a carta do banco), *errada*
  (é outra) e errada *sem aviso* (outra, e sem a marca "Conferir"). Versão de
  mesma arte (foil, reimpressão) conta como errada, marcada.

Como as outras, a bancada e o banco ficam fora do repositório (imagens das
editoras). Há também um **laboratório de OCR** (só passadas + extração, sem
busca), que foi o que decidiu a ordem das passadas.

| 139 cartas | certas | erradas | erradas sem aviso |
|---|---|---|---|
| limpa, antes | 40 | 38 | 13 |
| limpa, depois | **72** | 9 | **0** |
| foto, antes | 38 | 26 | 13 |
| foto, depois | **65** | 10 | **0** |
| dura, antes | 11 | 15 | 4 |
| dura, depois | **18** | 2 | **0** |

A linha de base mostrou que o problema do scanner não era só não ler: era
**achar a carta errada**, e calado. O OCR quase nunca era o culpado.

### 1. Os formatos que o catálogo ganhou (cobertura travada no CI)

O scanner nasceu com 13 jogos e o catálogo foi a 24. Passando o número guardado
de cada carta pelo `extrair` + `detectarJogo`, como se o OCR lesse perfeito:
89 % do Weiss (31,6 mil cartas) e 48 % do Union Arena não viravam candidato;
SWU e Harry Potter iam pra busca filtrados pra Pokémon/Lorcana/Riftbound; o
Story Booster do DBFW ia pra One Piece/Digimon; 11 jogos não tinham pista.
Entraram os padrões de Weiss (`SAO/S20-E001S`), Union Arena (promo, extra, AP),
SWU (`JTL • EN ◆ 760`, o número DEPOIS do set), Riftbound (`RAD • 137/167 •
EN`, `263a/298`), FAB History Pack, set de Magic começando por dígito, e as
pistas de rodapé dos jogos novos. O `tests/scan-cobertura.test.mjs` passa o
catálogo versionado de cada jogo pelo scanner e cobra uma taxa mínima — ou a
declaração de que o jogo não tem código legível. **Jogo novo sem declaração
quebra o CI** (item B18 do checklist 4.2 do [CATALOGO](CATALOGO.md)).

### 2. Encaixe no catálogo

O OCR devolve texto; o catálogo é um vocabulário fechado. A ponte era formato
+ busca, e a borda casa palavra por prefixo e pelo NOME: `4/3` achava uma
promo do Lorcana, o `71/204` de uma carta com "© Disney" achava um Pokémon
chinês de set com 204 cartas, `YOU 4` achava "If I Didn't Have You".

- `casaCodigo`: o resultado tem de ser a carta do código lido. Havendo algum
  que casa, o que a borda achou por nome sai.
- **Índice de sets** (`indiceDeSets`), montado dos manifests que a primeira
  busca já baixava (120 KB gz os 24 jogos; agora descem em paralelo enquanto a
  pessoa enquadra): "SET NÚMERO" de set que não existe não vai pra busca;
  código cujo prefixo é set do catálogo ganha peso (`LOB-032`, o Yu-Gi-Oh
  antigo sem "-EN"); e o set diz de que jogo é (`JTL` só existe no SWU).
- **Camadas de jogos**: primeiro o jogo que a carta IMPRIME. Resultado de
  outro jogo só entra se a foto confirmar.

### 3. A foto como verificador de toda leitura

Antes a foto só entrava com mais de um candidato, pra escolher a versão. Com
uma carta só, nada conferia. Agora toda tentativa passa pela foto
(`estadoDaFoto`): confirma (semelhança ≥ 0,60) → entra; código forte que ela
não confirma → entra **marcada "Conferir"**, com som próprio (descendo) e sem
o anel de carta boa; resultado fraco que ela não confirma → não entra.
Calibrado na bancada: carta certa dá 0,72–1,00 na foto simulada (com a carta
endireitada, ver 5), errada 0,44, e até 0,53 na mesma moldura do mesmo jogo.

Antes de aceitar a dúvida, os **vizinhos**, que só entram confirmados e com
folga sobre a segunda colocada: o número a um dígito (`OP05-019` lido
`OP05-010`), o set a uma letra (`OMU 257` é `DMU 257`; `P-063` num Gundam é
`RP-063`) e, com o jogo impresso, o número sozinho (a fração do Lorcana traz o
total impresso, 204, que não é o do catálogo).

**Defeito antigo achado no caminho.** Fora do Pokémon, a miniatura de
referência podia ser o palpite de URL do pokemontcg.io (`…/12/71.png`), que
carrega com CORS aberto e é um Pokémon qualquer. A foto de uma carta do Lorcana
lida certo era comparada com isso: 0 de 8 na bancada, 6 de 8 depois.

### 4. Passadas do OCR: polaridade, escala, e a foto no laço

O laboratório de OCR (139 cartas, foto simulada) mediu cada receita:

- As seis passadas de antes eram do mesmo tratamento e liam, juntas, **60**
  códigos. Metade dos jogos imprime o código CLARO em faixa escura (One Piece,
  DBFW, Riftbound, o rodapé do Magic e do SWU), e o limiar do Tesseract fica
  com a arte clara ao lado. Com o `realcarLocal` (o texto claro vira tinta
  escura em fundo uniforme) e variando a escala, seis passadas leem **69** e
  oito leem **73**. O plano é o `PASSADAS`.
- **Lê, confere, continua**: a cada passada com candidato novo, a busca roda e
  a foto responde. Confirmou, acabou; senão, vem a passada seguinte. Antes, um
  `10/41` lido do texto da carta encerrava a leitura. Metade das cartas certas
  sai na primeira passada (~2,1 s no computador, era 2,0 s); a que não lê
  demora mais (4,3 s contra 2,8 s), com teto de 5 s de passadas.
- **O que NÃO ajudou**: recortar o OCR relativo à carta (34 códigos contra 35
  do recorte pela moldura). O limite é o motor em texto miúdo, não o lugar da
  faixa. Não entrou.

### 5. Achar a carta no quadro

`acharCarta`: quatro retas, uma por lado, numa amostra de 150 px, sem
biblioteca. A reta mais forte de um lado é quase sempre a moldura impressa, não
a borda; quem separa é o sinal do degrau e a geometria (a maior combinação com
proporção de carta). Nas fotos sintéticas de verdade conhecida, erro mediano de
1,2 % da largura; nas 139 da bancada, acha 134. Serve ao que a medição
confirmou: a carta **endireitada** entra nas assinaturas da foto (a semelhança
da carta certa sobe de 0,59–0,98 pra 0,72–1,00, a da errada não mexe), e o
**disparo automático** espera ~1,5 s em vez de 0,4 s quando não há carta no
quadro (antes bastava contraste, e toalha estampada gastava uma leitura).

### 6. Reconhecimento pela arte, no set travado

A fase 2 no recorte que cabe no aparelho: o SET é o filtro, a assinatura
decide. Travado o set, o scanner baixa as miniaturas dele uma vez (as mesmas da
página do set; nada com a economia de dados ligada) e guarda a assinatura de
cada carta. A leitura consulta a arte ANTES do OCR (`escolherPelaArte`):
apontou uma carta com folga, acabou, sem passada nenhuma; apontou a arte mas
não a versão, o OCR ainda roda pro código separar. Como o jogo sem código não
tem "primeira carta lida", o cadeado sem resultado abre um **seletor de set**.

Bancada com o set travado (foto simulada, 22 jogos, 4 cartas de cada): **72 de
88 certas, 1 errada (marcada), 0 sem aviso**; 65 saíram só pela arte, todas
certas, em ~0,1 s cada. Sem código, antes zero: Sorcery, Cyberpunk, HxH e
Miracle Battle 4 de 4, DBZ 3 de 4. Aprender um set leva ~9 s (mediana). O que
ficou baixo é set grande com imagem lenta (LOTR, 380 cartas por proxy) e
casamento de set da própria bancada, não do scanner.

### O que ficou de fora, e o que sobra

- **OCR nativo no app** (ML Kit no Android, Vision no iOS). É o maior salto
  provável de leitura — e lê japonês, o prefixo em kanji do Naruto vintage —,
  mas não entrou: é plugin nativo, que não dá pra exercitar sem aparelho, só
  chega em build de loja (live update não leva código nativo) e pede PR
  própria. O terreno: há dois plugins pro Capacitor 8
  (`@capacitor-mlkit/text-recognition` e `@capacitor-community/image-to-text`);
  o ponto de troca no scanner é o `ocr(worker, canvas)`, que devolve `{ texto,
  palavras }` — um motor nativo entra ali, com o Tesseract de reserva.
- **Ler** continua sendo o teto: na foto simulada, Union Arena (fonte
  vazada), Weiss, FAB e Yu-Gi-Oh (código miúdo, sob a arte) leem pouco. Sem o
  set travado, é onde o OCR nativo mais renderia.
- **Índice de arte do catálogo inteiro** (a fase 2 abaixo): reconhecer sem
  travar o set pede um hash por carta gerado no build, das ~240 mil imagens.
- **Código do set do Pokémon** (SVI, PAL, OBF): o catálogo não guarda a sigla
  impressa; a TCGdex tem (`abbreviation`), falta trazer no sync.
- **`/admin`**: `duv`, `corr`, `neg` e `arte` já saem no `scan_done`; somar no
  Funil pede migração, como `luz`/`luzOk`.

## Fase 2 — hash perceptual da arte

**Estado em 2026-11-10:** a metade "o set é o filtro" está feita (1.8, item 6):
com o set travado, a carta é reconhecida pela arte. O que falta é o índice do
catálogo inteiro, pra reconhecer SEM travar.

Pra vintage e pra quando o código não sai: hash de 64–256 bits por carta,
calculado num script de `scripts/` a partir das imagens que o sync já baixa;
índice por jogo (~8 bytes por carta → ~1,2 MB pros 150 k) e distância de
Hamming no cliente, limitada ao jogo ativo, devolvendo os melhores pra
assinatura 16×22 decidir (a mesma do set travado e da conferência). A
fragilidade é foil/perspectiva; a carta endireitada (`acharCarta`) cuida do
enquadramento.

## Fora do plano

- Modelo próprio de ML (o que o Delver Lens usa): treinar e distribuir um
  modelo por jogo não se paga pra coleção pessoal enquanto OCR + hash cobrem.
- API paga de visão: contraria o local-first e a promessa de "a foto não sai
  do aparelho" (a mesma do medidor de centralização).

## Validação

- `node --test tests/*.test.mjs` — do scanner: `scan-codes` (extração e
  jogo), `scan-cobertura` (taxa por jogo, no catálogo versionado),
  `scan-encaixe` (casar com o código, índice de sets, vizinhos, decisão pela
  foto), `scan-foto`, `scan-carta` (achar a carta, com fotos sintéticas),
  `scan-arte` (set travado e seletor), `scan-captura`, `scan-continuo`,
  `scan-trava`, `scan-som` —, `node scripts/check.mjs`,
  `node scripts/check-mobile.mjs`, orçamento de peso (`scripts/check-size.mjs`).
- No celular (preview ou produção): One Piece, Pokémon SV, Magic moderno e
  Lorcana — carta na moldura, luz de ambiente, sem flash. Anotar o texto lido
  quando errar: é o insumo da fase 1.5.
