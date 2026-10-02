# Centering Tool v2 + menu Tools: plano de execução

**Data:** 2026-10-01. Revisado no mesmo dia depois de quatro revisões céticas: graduadoras, viabilidade, matemática e produto. O que mudou está no Apêndice.

**Base do código:** `origin/main` 45bb80b6 (2026-10-01). Todas as linhas citadas vêm dessa base; a `main` anda várias vezes por dia, então reconfira o número da linha antes de editar.

**Pedido do Fernando.** Olhar o [centeringcheck.com](https://www.centeringcheck.com/) e fazer uma versão **igualmente precisa** pro Sleevu, com os dados das graduadoras:

- no celular a pessoa tira a foto e ajusta;
- no PC ela sobe a imagem;
- ter os controles deles **e também correção de ângulo**;
- chamar de **Centering Tool**;
- morar num submenu novo, **Tools**, no topo do site.

A foto de exemplo é uma carta One Piece vintage da Bandai (1999), fotografada em ângulo dentro de um toploader. Ela aparece como um trapézio levemente girado, e as 8 linhas alinhadas aos eixos do concorrente não acompanham a carta.

**Método.** Seis frentes, cada uma escrita antes deste plano:

1. **Concorrente.** Medição do centeringcheck por dentro: a rede (`/api/upload`) e o editor.
2. **Tabelas oficiais.** Leitura das tabelas das 5 graduadoras grandes e de 6 menores, no texto ao vivo e nos snapshots do Wayback.
3. **Checagem cruzada.** Conferência célula a célula contra a tabela do concorrente.
4. **Protótipo.** Pipeline em node com fotos sintéticas (câmera pinhole), medido.
5. **Repositório.** Mapa do que já existe e do que se reaproveita, do menu e das guardas do build.
6. **Mercado.** Pesquisa de 12 ferramentas, entre web e app.

Onde as pesquisas divergiram, a §4.4 diz qual versão vale e por quê. Os custos em bytes do `shared.js` citados aqui foram medidos com `esbuild --minify --charset=utf8` + gzip -9, o mesmo método do CI.

---

## Estado (2026-10-02): o que mudou depois do plano e o que já subiu

**Decisões do Fernando posteriores ao plano** (valem por cima do texto abaixo):

- **Sem menu "Tools" novo.** Depois do plano entrou na `main` o menu **"Mais"** (último item do topo, PR #150), com a fileira Ferramentas e a coluna Colecionar. O Centering Tool é um item dessa coluna e um cartão da página índice. As §7.1–7.4 descrevem o menu que **não** foi feito; ficam como registro.
- **Endereços todos em inglês:** a ferramenta é **`/centering`** (`centering.html`, na raiz, caminho raso, sem `<base>` especial); o índice `/ferramentas` virou **`/tools`** e o Guia de condição `/condicao` virou **`/condition`**, com 301 dos antigos no `_redirects`. `/sleeves` já era inglês; `/troca` não muda (é página da Coleção, com login).
- **Nome:** "Centering Tool" nos 3 idiomas (`ctr.title`).
- **Sem a foto de exemplo do pedido:** ela é de terceiros. O aceite da F1 foi feito com fotos sintéticas: uma carta gerada com bordas conhecidas (verdade 60,0/40,0 · 52,0/48,0) fotografada em perspectiva, e scans do catálogo em perspectiva, um deles dentro de um toploader.
- **Pacote de i18n** `src/i18n-centering.js` (chaves `cen.*`); a página reusa `.fer-page`/`.fer-card` e por isso está nas áreas `medidor` **e** `ferramentas` do split-css.

**Entregue nesta rodada: F1a + F1b juntas**, com push direto na `main` a pedido. Ficaram de fora, como no plano: F2 (detecção automática, que espera o corpus real), F3 (compartilhar e variante em inglês), F4 (carta, preço e salvar), F5 (câmera ao vivo e eBay) e o evento de analytics `centering` (precisa de migração). O peso ficou acima do orçamento da §9.3: o `centering.js` tem ~27 KB gz contra ≤ 10 previstos, porque F1a e F1b vieram juntas. O núcleo `shared.js` subiu só +5 B.

---

## 0. Resumo executivo

O centeringcheck faz bem o essencial:

- detecção automática no servidor, que achata a carta;
- 8 linhas por carta (o corte e a moldura impressa, em cada lado);
- frente e verso;
- quadros de nota de quatro graduadoras.

Ele falha em quatro pontos, todos medidos:

- **Precisão.** Mede numa imagem achatada de ~513 px de largura, onde 1 px de erro vale ~1,1–1,3 ponto. Por isso só mostra número inteiro.
- **Estabilidade.** A mesma foto do exemplo deles deu 53/47 na página publicada e 58/42 hoje.
- **Ângulo.** Fora o achatamento automático, só há um slider de rotação de ±5°. Não dá pra corrigir perspectiva à mão.
- **Privacidade.** A foto vai pro servidor deles, e o link de compartilhar guarda a imagem lá.

As tabelas deles também erram em mais de uma dúzia de células contra as fontes oficiais. A da CGC, por exemplo, está na escala anterior a jul/2023.

**A v2 ganha nos quatro pontos e roda inteira no aparelho:**

- o ângulo é corrigido por **4 cantos (homografia)**. A precisão é cheia até ~10° de inclinação. Acima disso a ferramenta mostra o ângulo estimado e alarga o "±", porque a espessura da carta (~0,3 mm) desloca o corte do lado mais perto da câmera (§6.8);
- a medição é feita na **foto em resolução cheia**, com lupa e, a partir da F1b, ímã sub-pixel;
- o número sai com **1 casa decimal e uma faixa de incerteza** que inclui os erros sistemáticos;
- as tabelas são as oficiais, com fonte e data. Onde a fonte é ambígua, a ferramenta mostra as duas leituras;
- **o Sleevu nunca recebe a foto.**

### Decisões que este plano toma

1. **Página pública `/tools/centering`, não modal.**
   - O arquivo é `tools-centering.html`, na raiz, com reescrita no `_redirects`.
   - Não pede login, tem link próprio, é indexável e funciona offline.
   - A v1 (modal aberto pelo Hub) sai.
2. **Menu "Tools" no topo.**
   - É um grupo com hover, igual ao da Coleção, entre **Decks e Blog**. Enquanto houver uma ferramenta só, **o clique leva direto a `/tools/centering`**, e o painel lista a ferramenta.
   - `/tools` redireciona (302) pra ela. A página-índice nasce com a 2ª ferramenta.
   - Aparece também pra quem não está logado. Custa **+45 B gz** no `shared.js` (medido).
   - No celular (≤ 700 px não existe menu de topo), as entradas são:
     - a página **Busca** (aba pública, ao lado do scanner);
     - a página **Perfil**, antes do menu de conta;
     - o **Hub**;
     - a **landing**.
   - O atalho do PWA depende da pergunta 3.
3. **"Ângulo" = 4 cantos com homografia.** Um slider de rotação não resolve.
   - Os cantos ficam no **encontro das retas** das bordas, porque a carta tem canto arredondado.
   - A homografia corrige giro, inclinação e trapézio de uma vez, que é exatamente o caso da foto do One Piece no toploader.
   - O quadrilátero é validado a cada movimento (convexo e sem perspectiva extrema).
4. **8 linhas, como no concorrente.**
   - São o corte e a moldura em cada lado, desenhados sobre a carta já endireitada.
   - A medição acontece **na foto original, via homografia**, nunca numa cópia reduzida.
   - Há **um controle manual de inclinação só**, o giro da moldura. A inclinação de cada linha vem do ímã (F1b).
5. **Lupa desde a 1ª entrega; ímã sub-pixel na F1b.**
   - O ímã acha a aresta pelo **centroide das diferenças em intensidade linear**, ao longo da linha ou coluna nativa da foto. É um estimador sem viés de fase de pixel (§6.5).
   - A lupa lê direto da foto original.
6. **Número honesto.**
   - 1 casa decimal, com "±" de incerteza **total**: ajuste da reta, cantos, lente, espessura e um piso calibrado.
   - Estado **"no limite"** quando o valor está perto de um corte de nota.
   - "Falta X pt" **em cada eixo e lado que falha**.
   - A nota sai do **pior ponto** de cada lado, que é a regra escrita da PSA, mas só quando ele difere do meio por mais que o ruído (2σ). Abaixo disso vale o meio.
   - A nota é **sempre** decidida pelo valor com 1 casa. O inteiro de uma foto pobre é só exibição.
7. **Detecção automática dos cantos fica pra F2.**
   - Só entra depois do corpus de fotos reais.
   - A meta é estatística: 0 resposta errada com confiança em ≥ 150 fotos, o que dá uma cota superior de ~2% (IC95%). Mesmo assim, sempre com **confirmação de um toque** antes de o número valer.
   - É determinística: **a mesma foto, no mesmo navegador**, dá sempre o mesmo número.
8. **Código próprio, sem OpenCV.js** (~8 MB).
   - O total fica em ~16–20 KB gz, carregados só na página da ferramenta (mais o precache, §9.3).
   - Compartilhar gera um PNG no próprio aparelho, ou um link que leva só os números.
9. **Tabelas pelas fontes oficiais.**
   - O painel mostra as 5 graduadoras que o Graded já suporta: PSA, BGS, CGC, SGC e TAG.
   - Vigência, fonte e grau de confiança ficam num arquivo só, `src/centering-graders.js`.
   - O BGS aparece como **subnota**. As duas páginas oficiais da Beckett divergem, e a ferramenta mostra as duas leituras.
   - A CGC tem número pra TCG só no 10P, no 10 e no 3.5. A régua dela pra non-sports vale quando a carta é classificada assim (Carddass pode ser).
   - Na SGC o texto **não diz o lado**, então a nota segue a leitura conservadora e a outra leitura aparece ao lado.
10. **Câmera nativa no celular na 1ª entrega**, via `<input capture>`, com resolução cheia, foco e macro do próprio aparelho. A câmera ao vivo com nível vem depois.
11. **Números podem ser salvos, só com login; a foto, nunca** (veto do dono). Não há histórico só local. Salvar entra na F4.
12. **O `shared.js` só recebe o menu, o rodapé e a guarda de recarga** (+60 B gz medidos na F1a). O evento de analytics entra na F1b (+4 B).
    - Todo o resto vai em arquivos próprios.
    - O CSS usa o prefixo `ctr-` (área `medidor` do split-css).
    - O i18n vai num pacote, `src/i18n-tools.js`.
13. **Seis entregas, uma PR cada** (§11): F1a, F1b, F2, F3, F4 e F5.
    - A F1a já mede com mais precisão que o concorrente, pela resolução e pela lupa.
    - As seguintes tiram trabalho da pessoa.

---

## 1. O concorrente: centeringcheck.com

### 1.1 Como funciona por dentro (medido)

**Produto**
- Next.js, grátis e sem cadastro. Diz ter "~200 mil imagens analisadas".
- Tem apps iOS e Android com pinça e zoom, detecção automática e rotação. O plano PRO custa US$ 3,99/mês, 39,99/ano ou 99,99 vitalício.

**Entrada**
- Arrastar, colar ou clicar pra escolher a imagem.
- Também aceita colar a URL de um anúncio do eBay. Quem busca a imagem é o servidor deles.
- O checkbox *Auto-detect card for better accuracy* (`warpEnabled`) vem ligado.

**A foto vai pro servidor.** `POST /api/upload` devolve:

```json
{ "borders": { "left":[21,44], "right":[490,473], "top":[19,35], "bottom":[623,606] },
  "centeringValues": { "LR":0.575, "TB":0.485 },
  "detectionFailed": false,
  "detectorVersion": "outer:094aa724|inner:1|corners:legacy",
  "processedImage": "<JPEG base64 ~513x640 da carta já achatada>" }
```

- Um modelo de ML no servidor acha os 4 cantos, achata a perspectiva e acha a borda externa (o corte) e a interna (a moldura impressa).
- As contas: L/R = (44−21) / ((44−21) + (490−473)) = 23/40 = **0,575**. T/B = 16/(16+17) = **0,485**.

**Editor**
- `<canvas>` de 463×576 px CSS **sem escala de `devicePixelRatio`**, por isso fica borrado em tela retina.
- 8 linhas arrastáveis, alinhadas aos eixos. A externa tem alça clara e a interna, alça escura. As alças ficam deslocadas, pra dar pra pegar as duas.
- A faixa entre externa e interna fica clara, e o resto, escurecido.
- Slider **Rotation Adjustment** (−5..5°, passo 0,1, com Reset).
- Toggle Front/Back.

**Resultado**
- Quadros de nota PSA/BGS/CGC/TAG, cada um = mínimo(nota L/R, nota T/B).
- Proporção **direcional e inteira**: "L/R 58/42" quer dizer esquerda primeiro.
- *Share result* cria um link curto `/s/<id>` no servidor, **que guarda a imagem**.
- *Give feedback* abre um canal de retorno.

**Fora do editor**
- `/guide`: a fórmula é maior ÷ (maior + menor). Manda medir no meio de cada lado, de preferência em 2–3 pontos, tirando a média, e dá dicas de foto.
- `/ebay`: colar a foto de um anúncio.
- `/examples`: 20 cartas (crua, sleeve, slab, ângulo, One Piece, esporte, verso).
- `/report` (jul/2026): estudo deles com 10 mil cartas PSA. **Segundo eles**, a PSA apertou a frente em 2025. Pelo texto oficial, mudou a redação da base, enquanto a folga e o exemplo continuaram iguais (§4.2).

### 1.2 O que ele faz bem (adotar)

- **Duas linhas por lado**, corte e moldura. É o modelo certo: mede a borda impressa de verdade, sem supor que a foto está recortada no corte, que é o erro da nossa v1.
- **Alças deslocadas** ao longo da linha e **faixa da borda clareada**. Dá pra ver o que está sendo medido.
- **Proporção direcional** (esquerda e topo primeiro) e **frente/verso**.
- **Zero esforço** quando a detecção acerta.
- **Conteúdo em volta da ferramenta** (guia, exemplos, estudo da PSA), que é o que ranqueia.
- **Retorno de erro da detecção.** Aqui ele vira **métrica implícita** na F2: quanto a pessoa precisou mexer depois do automático, em pp, vai no evento, sem foto. Não há caixa de texto livre: não existe backend pra isso, e o contato segue pela Ajuda.

### 1.3 Onde ele falha

| Falha | Medida | Consequência |
|---|---|---|
| **Resolução** | Imagem achatada com ~513 px de largura (~8 px/mm). No exemplo deles as bordas têm 23 e 17 px. | ±1 px numa linha leva de 57,5 pra 56,4–58,5; ±2 px, pra 55,3–59,5. Na prática ±1 px ≈ ±1 ponto. É por isso que eles escondem o decimal. |
| **Instabilidade** | O exemplo publicado (Duskull em ângulo) diz L/R 53/47. A mesma foto rodada hoje no detector deu 58/42 (PSA 9, BGS 8, CGC 9, TAG 9). | A diferença equivale a ~2–3 px de detecção. O ajuste manual preciso é o produto, não um acessório. |
| **Ângulo** | Além do achatamento automático, só há rotação no plano, de ±5°. | Uma carta 50/50 fotografada a 10° de inclinação e 15 cm de distância lê 53,5/46,5 (§6.8). Rotação não corrige trapézio. Na foto do One Piece no toploader, as linhas alinhadas aos eixos não acompanham a carta. E 2° de giro numa carta de 88 mm deslocam a borda lateral em ~3,1 mm de cima a baixo, uma borda inteira de Pokémon. |
| **Nitidez e ajuste fino** | Canvas sem DPR. Sem lupa, sem zoom e sem passo fino na web. | Mirar uma borda de ~20 px com o dedo, numa tela borrada. |
| **Privacidade** | `POST /api/upload` com a foto; `/s/<id>` guarda a imagem. | É o nosso diferencial mais simples de explicar. |
| **Tabelas** | A CGC está na escala antiga: o "9.5 = 55/45" deles é o Gem Mint 10 de hoje. O verso do BGS 5 aparece como "Any", e o oficial é 95/5. A TAG tem as meias notas arredondadas (62,5 vira 63). O PSA 1 aparece como 90/10, mas a PSA não exige nada no 1. Falta o PSA 1.5. Ignoram a folga de 5% da PSA e a regra do "pior ponto". | Uma carta 62,6/37,4 aparece como "63/37 → TAG 8.5", mas a TAG dá 8. Uma carta TCG a 54/46 aparece como "CGC 9.5", mas oficialmente cabe no Gem Mint 10. Detalhe na §4.5. |
| **Escopo** | Só inglês, só 4 graduadoras (sem SGC), não diz quanto falta pra próxima nota, não mede em vários pontos. | — |

### 1.4 O resto do mercado

Ninguém junta, no mesmo produto, pt-BR, processamento local, perspectiva manual, lupa, decimais, tabelas oficiais certas e preço PSA 9×10.

| Ferramenta | O que tem que importa pra nós |
|---|---|
| **CCGrader** (web, grátis) | O mais parecido com a v2: modelo ONNX no navegador, **quad manual de 4 cantos**, dial de rotação e lupa 3×. Mas só mostra inteiros, só fala inglês e copia as tabelas do centeringcheck, com erros a mais. |
| **Edge Grading** (graduadora nova) | 1º no Bing pra "card centering tool". Mostra mm e %, tem **"Centering Tool" no menu principal** e uma tabela própria com nível acima do 10 (Ultramint 10+, §4.3). |
| **PriceCharting** | Tem um menu **"Tools"** com o Card Centering Calculator ao lado de outras ferramentas, que é o precedente do nosso menu. A recomendação de grading é paga (US$ 6/mês). |
| **JoshBeeTCG, cardgrade.io, The Grading Club** | Cantos automáticos (JoshBee), lupa e setas (cardgrade.io), presets de estilo de borda (Grading Club). Todos só em inglês. |
| **Apps** (Shiny, Centering50, Jade Lizard, Midpoint…) | Lupa de 15×, "perspective fix", histórico. Cobram de US$ 4 a 10/mês. Dois têm português, ambos pagos. |

**Demanda de busca** (usando o autocomplete do Google como indicador):
- Em inglês é rica e disputada, com 10+ domínios dedicados: "card centering tool", "psa 10 centering standards top bottom".
- Em pt-BR, "centralização" quase não aparece. Existe "centering carta pokemon", e a demanda real está em **"graduar carta pokemon"**.
- Em espanhol, "centrado cartas pokemon" e "plantilla centrado".
- Em pt e es a concorrência é zero e o volume é baixo. Por isso a variante indexável em inglês importa (§7.5).

---

## 2. Onde estamos: a v1

`src/centering.js` (179 linhas, IIFE, `window.TCGCentering = {abrir, pct}`):

- modal `.list-modal.ctr-modal`;
- a foto entra por `<input type=file accept=image/*>` e vira um object URL, revogado ao fechar;
- **4 guias**, só na moldura INTERNA, supondo que a foto já está recortada no corte;
- guias em fração 0..1 da imagem;
- `pct` com `Math.round`;
- pointer events e setas (passo de 0,5%).

O Hub abre o modal (`src/dashboard.js:370-375`, clique em `:386-389`).

| Peça da v1 | O que fazer |
|---|---|
| `pct(a,b)`: o 2º lado é `100 − x`, nunca dois arredondamentos (`:22-27`) | **Manter a regra**, agora com 1 casa decimal. |
| Guias em **fração**, que sobrevivem a resize e a girar a tela (`:17-20`) | Manter a ideia, em coordenadas da carta **endireitada** (giro e inclinação calculados no espaço métrico, §6.4). |
| Arrasto com pointer events, repintando só as guias (`:93-125`) | Reaproveitar o padrão. |
| Engolir o `click` que nasce de um arrasto (`:135-143`). Sem isso o gesto fechava o modal e perdia a foto. | **Copiar a guarda e o comentário.** |
| Teclado, setas (`:152-168`) | Manter, com passo menor (1 px da foto) e Shift pra passo maior. |
| Object URL revogado ao fechar (`:73-89`, `:144-151`) | Manter o "a foto nunca sai do navegador". |
| `getElementById("gradedCenteringBtn")` (`:173-176`) e o comentário "só na página de Graded" (`:10-11`) | **Código morto**: o botão não existe em nenhum HTML desde 2026-09-16. Sai com a v1. |
| `<script src="src/centering.js">` em `collection.html:321-322` | **Carga morta**: ninguém chama o módulo na Coleção (1,6 KB de JS + 507 B de CSS baixados à toa). Sai. |
| `<script>` em `dashboard.html:169-172` | Sai quando o Hub virar link. |
| CSS `.ctr-*` (`styles.css:12723-12746`): traço de 2 px + alvo de toque invisível de 28 px via `::before`/`::after` | Reaproveitar a técnica. A área `medidor` (`scripts/lib/css-areas.mjs:72`) passa a ter só a página nova. |
| 13 chaves `ctr.*` × 3 idiomas no núcleo (`src/i18n.js` pt 1175-1187, en 2678-2690, es 4181-4193) | Saem do núcleo. O texto novo vai pro pacote `src/i18n-tools.js`. |
| `ctr.note` diz que o BGS 9.5 pede "de 50/50 a 60/40" | **Ambíguo**, não simplesmente errado. Parafraseia a página `/grading/scale` da Beckett ("50/50 num eixo, 55/45 no outro" na frente; 60/40 no verso), que ficou no ar até 2026 ao lado da `/grading-standards`, que diz 55/45 nos dois eixos (§4.2). Sai com a v1. |
| `tests/centering.test.mjs` (sandbox vm com `document.getElementById: () => null`) | Vira o teste do núcleo puro (§10). |

**Limites da v1, que viram requisito da v2:**

1. Só mede a moldura interna. Com fundo ou toploader na foto, o número sai errado e nada avisa.
2. Sem perspectiva, rotação, zoom ou lupa. A foto fica com no máximo 52dvh (~300 px no celular), então 1 px de arrasto ≈ 0,3% da altura.
3. Número inteiro. Entre 55/45 e 56/44 está a diferença entre PSA 10 e 9.
4. Só aparece pra quem está logado (o `dashboard` está em `AUTH_PAGES`, `src/shared.js:12483`).
5. Botões de rodapé com 40 px (`.list-modal-foot .lst-mini`), abaixo dos 44 px do CLAUDE.md.

---

## 3. Objetivos, não-objetivos e princípios

### Objetivos

1. Medir L/R e T/B de **frente e verso** com erro **≤ 0,5 ponto (p90)** contra um scanner de mesa. Vale pra foto de celular comum **de frente ou inclinada até ~10°**, inclusive com a carta **dentro de toploader ou sleeve**.
   - **Entre ~10° e ~20°:** mede igual, mostra o ângulo estimado e alarga o "±" pela espessura da carta (§6.8).
   - A meta de 0,5 pt até 20° só passa a valer quando a compensação da espessura (F2) for validada no corpus.
2. **No celular:** da foto ao resultado em menos de 1 minuto, com a carta na mão. **No PC:** arrastar, colar ou escolher o arquivo.
3. Estimar a centralização pelas regras **oficiais** de PSA, BGS, CGC, SGC e TAG, com fonte e data, sem fingir certeza perto dos limites e mostrando as duas leituras quando a fonte é ambígua.
4. **O Sleevu nunca recebe a foto.** Tudo é medido no aparelho.
5. Ferramenta **pública** (sem login), offline (PWA), em `/tools/centering`, com o menu **Tools** pronto pra receber outras ferramentas.

### Não-objetivos

- **Nota final** da carta. Cantos, bordas e superfície não entram, e o texto deixa isso claro.
- **Guardar a foto**, seja por carta, por slab ou em servidor (veto do dono).
- **Histórico de medições sem conta.** Feature pessoal nasce atrás do login (decisão do dono, `enforceLoginGate`).
- ML no servidor, OpenCV.js ou modelo baixado.
- Câmera ao vivo na 1ª entrega (vem na F5, depois de medir).
- Medir de forma automática carta **sem borda impressa** (full art borderless). Dá pra medir à mão, usando uma referência impressa.

### Princípios

1. **O número vale o que a borda vale.** Mede-se na resolução da foto. O que vai pra tela é só desenho.
2. **O automático sugere, a pessoa confirma.** A mesma foto, no mesmo navegador, com as mesmas linhas, dá sempre o mesmo número.
3. **Honestidade.**
   - 1 casa decimal e "±" que inclui os erros sistemáticos.
   - "Não publicado" é diferente de "qualquer".
   - "No limite" é um estado, não só uma cor.
   - Fonte ambígua gera duas leituras visíveis.
4. **Tabela é dado com fonte**, não opinião. Quando a graduadora não publica, a ferramenta diz isso.
5. **Nada no núcleo que não precise estar lá.** O `shared.js` tem 255 B gz de folga.
6. **Um modelo, duas interações.** Celular e PC medem igual. O que muda é como se mexe nas linhas.

---

## 4. Dados das graduadoras

Lidos em 01/10/2026:
- **PSA:** arquivo de textos que a página carrega (`gradingStandards.json`), mais snapshots do Wayback de 2024-09 a 2026-09.
- **SGC:** bundle JS da página (`chunk-XZCQGYIQ.js`, "LAST UPDATED: 10/30/2025").
- **Beckett:** JS das duas páginas, pelo Wayback (o site está em manutenção).
- **CGC, TAG, ACE, PCA, ARS, Capy e Edge:** HTML ao vivo.

**Confiança:** **alta** = texto oficial lido agora; **média** = texto oficial arquivado, ou com duas versões oficiais conflitantes; **baixa** = fonte secundária.

Convenção das tabelas: **N/(100−N)** é o limite do **lado maior** ("55/45 ou melhor").

### 4.1 Como a centralização entra na nota de cada uma

| Empresa | Papel da centralização | O que a ferramenta mostra |
|---|---|---|
| **PSA** | **Teto por nota.** A frente tem **folga de 5% pra notas ≥ 7**: 65/35 *pode* dar PSA 9 se o eye appeal for bom. Mede o lado no **ponto mais descentralizado**. Meio ponto (2–9) "depende de qualidades high-end dentro da nota", sem número publicado. Fora do limite, a carta recebe nota com teto **ou** nota + qualificador OC. | Nota pelo limite, mais "possível pela folga (eye appeal)" quando couber. |
| **BGS** | **Subnota** (Centering, ao lado de Corners, Edges e Surface). A final fica perto da pior subnota (até +0,5; raramente dois níveis acima). O 9.5 exige três 9.5 e a quarta ≥ 9. Black Label = 4 subnotas 10; Gold Label = três 10 + um 9.5. As subnotas vão de meio em meio ponto; as meias (8.5, 7.5…) não têm número. | **"Subnota de centralização"**, nunca "BGS 9.5" seco. Nota pela **mais rígida** das duas páginas oficiais, com a outra ao lado quando divergir. |
| **CGC** | Nota única, sem subnotas desde jul/2023. **Pra TCG só publica número no Pristine 10, no Gem Mint 10 e no 3.5** (90/10, texto sem ressalva de categoria). Do 9 ao 4.5, os números valem "pra cartas esportivas e não-esportivas". A CGC classifica algumas linhas como **non-sports**: o relatório de população tem Carddass nas duas rotas. | Pela **categoria**: em TCG, 10P, 10 ou "abaixo de 10: sem número pra TCG"; em não-esportiva, a régua do 9 pra baixo. Com categoria "depende" (Carddass), as duas leituras. |
| **SGC** | Teto por nota (a página chama de "guidelines"). O texto diz só "55/45 or better centering", **sem dizer se vale pra frente ou pra carta inteira**. Fonte secundária (Edge Grading) diz que a SGC exige o mesmo na frente e no verso. | Nota pela **leitura conservadora** (o mesmo limite no verso), com "lado não especificado" e a outra leitura quando divergirem. |
| **TAG** | Componente medido por visão computacional, dentro de uma pontuação de 1000 pontos; a fórmula não é publicada. Tem limites por nota, com **verso diferente pra TCG e pra esporte**. | Nota pela tabela (coluna TCG), com o rótulo "componente da pontuação TAG". |

### 4.2 Tabelas vigentes (o que entra no arquivo)

#### PSA (confiança alta)

Fontes: <https://www.psacard.com/gradingstandards> e <https://www.psacard.com/psa/locales/en-US/gradingStandards.json>.

Vigência do texto atual: **desde 24/01/2025**. A redação mudou entre o snapshot `20250112215218` (texto antigo) e o `20250124105846` (texto novo), sem anúncio oficial.

| Nota | Frente | Verso | Observação |
|---|---|---|---|
| 10 GEM-MT | ~55/45 | 75/25 | "aproximadamente" |
| 9 MINT | ~60/40 | 90/10 | |
| 8 NM-MT | ~65/35 | 90/10 | |
| 7 NM | ~70/30 | 90/10 | |
| 6 EX-MT | 80/20 | 90/10 | |
| 5 EX | 85/15 | 90/10 | |
| 4 VG-EX | 85/15 | 90/10 | |
| 3 VG | 90/10 | 90/10 | |
| 2 GOOD | 90/10 | 90/10 | |
| 1.5 FR | ~90/10 | ~90/10 | **falta na tabela do concorrente** |
| 1 PR | sem exigência | sem exigência | o concorrente põe 90/10 |

Regras que acompanham a tabela:
- **Folga de 5% na frente pra notas ≥ 7.** O exemplo oficial diz que 60/40 cumpre o PSA 9 automaticamente e que 65/35 pode cumprir o PSA 9 se o eye appeal for bom.
- A medida é a do lado "at the most off-center part of the card" (texto da PSA).
- Na nota da centralização há uma "pequena variância a critério do avaliador pelo eye appeal" (apareceu junto com a mudança de jan/2025).
- O contraste da borda pode ajudar ou atrapalhar (exemplos do Koufax 1955 e 1957).

**Histórico (até 12/01/2025).** Fica no arquivo como informação.
- O texto da base era uma **faixa**: 10 = 55/45 a 60/40; 9 = 60/40 a 65/35; 8 = 65/35 a 70/30; 7 = 70/30 a 75/25. Do 6 pra baixo, igual a hoje.
- O parágrafo da folga de 5% e o exemplo dele são **idênticos, palavra por palavra**, antes e depois (snapshots de 2024-09-05 a 2025-01-24).
- A ponta alta de cada faixa antiga = base + folga. **Pela letra, a tolerância máxima com eye appeal não mudou** (~60/40 pro 10). O que mudou foi a redação da base.
- A PSA disse que a prática não mudou: Nat Turner, citado pelo cardhoundvintage em 03/03/2025 (fonte secundária). O estudo do centeringcheck sugere aperto na prática.
- O `/report` deles compara pela ponta leniente da faixa antiga contra a base nova, e é isso que dá a impressão de aperto no texto.

#### BGS (confiança **média**: duas páginas oficiais conflitantes)

O beckett.com redireciona pra uma página de manutenção, então não há texto oficial no ar. Por anos, a Beckett publicou **duas páginas ao mesmo tempo**:

- **`/grading-standards`**: snapshots de 2023-06, 2024-01, 2024-09, 2025-08, 2025-10 e 2025-12, com a regra no JS `2950-ec7d21e60d2cbaf3.js`. As capturas de 2026 dessa página são CloudFront 403.
- **`/grading/scale`**: capturada até **2026-05-03**, já com "Copyright © 2026" e aviso de 2018.

**Não dá pra dizer qual das duas é a vigente.** A tabela abaixo segue `/grading-standards`, e a coluna da direita guarda onde `/grading/scale` diverge.

| Nota | Frente | Verso | Diamond cut | `/grading/scale`, se diferente |
|---|---|---|---|---|
| 10 Pristine | 50/50 em tudo | **55/45** | – | verso **60/40** |
| 9.5 Gem Mint | 55/45 nos dois eixos | 60/40 | – | frente **50/50 num eixo, 55/45 no outro** |
| 9 Mint | 55/45 nos dois eixos | 70/30 | – | |
| 8.5 | sem número | – | – | |
| 8 NM-MT | 60/40 | 80/20 | – | |
| 7 NM | 65/35 | 90/10 | muito leve | |
| 6 EX-MT | 70/30 | 95/5 | leve | |
| 5 EX | 75/25 | **95/5** | leve | (o concorrente põe "Any") |
| 4 VG-EX | 80/20 | 100/0 | moderado | |
| 3 VG | 85/15 | 100/0 | moderado | |
| 2 Good | 90/10 | 100/0 ou offcut | perceptível | |
| 1 Poor | 100/0 ou offcut | – | forte | |

As meias subnotas abaixo do 9.5 (8.5, 7.5, 6.5, 5.5, 4.5, 3.5, 2.5, 1.5) existem e **não têm número publicado**.

**Regra da ferramenta:** a nota exibida é a da leitura **mais rígida** das duas páginas. Quando elas divergem, as duas aparecem lado a lado, com o mesmo peso: "9 por /grading/scale · 9.5 por /grading-standards".

#### CGC (confiança alta)

Fonte: <https://www.cgccards.com/card-grading/grading-scale/>. Vigência: escala unificada (CGC TC + CSG) **desde meados de jul/2023**. Nessa unificação, o "Gem Mint 9.5" passou a equivaler ao Gem Mint 10, o 9.5 virou "Mint+" e as subnotas acabaram.

| Nota | Frente | Verso | Categoria |
|---|---|---|---|
| Pristine 10 | 50/50 | **não publicado: herda o 75/25 do Gem Mint 10**. O texto define o Gem Mint 10 como um 10 em que um critério não alcança o Pristine, então o Pristine cumpre pelo menos o verso do 10. | todas |
| Gem Mint 10 | ~55/45 | 75/25 | todas |
| Mint+ 9.5 | sem número (diz só que centralização excepcional ajuda a chegar no 9.5) | – | – |
| 9 | 60/40 | 90/10 | **só esportes e não-esportes** |
| 8.5 | sem número | – | – |
| 8 e 7.5 | 65/35 | – | só esportes e não-esportes |
| 7 | 70/30 | – | só esportes e não-esportes |
| 6.5 | sem número | – | – |
| 6 | 75/25 | – | só esportes e não-esportes |
| 5.5 | sem número | – | – |
| 4.5 | 85/15 | – | só esportes e não-esportes |
| 3.5 | ~90/10 | – | **todas** (o texto do 3.5 não tem a ressalva de categoria) |

A CGC também dá tolerância de diamond cut por nota: 8.5 e 8 muito leve; 7.5 e 7 leve; 6.5 e 6 moderado; 4.5 e 4 bem perceptível; 2.5 e 2 quase miscut.

**Categoria.** Não dá pra supor que todo o catálogo do Sleevu é TCG. O relatório de população da CGC tem Dragon Ball Carddass **nas duas rotas**: `/population-report/non-sports/dragon-ball-carddass/…` e `/population-report/tcg/dragon-ball-carddass/…`. Cartas de máquina e de vending (Carddass, Data Carddass do Naruto e, possivelmente, a One Piece Bandai de 1999 do exemplo) ficam como **"depende"**.

- **Sem contexto de carta (F1a):** a ferramenta tem um seletor "Tipo pra CGC: TCG | Não-esportiva (Carddass, vending)", com TCG como padrão.
- **Com `?card=` (F4):** a categoria vem da linha do catálogo.
- **Com "depende":** saem as duas leituras.

#### SGC (confiança alta no texto; **lado não especificado**)

Fonte: <https://gosgc.com/card-grading-scale>; texto lido no bundle `chunk-XZCQGYIQ.js` ("LAST UPDATED: 10/30/2025").

As descrições dizem "50/50 centering" e "55/45 or better centering" **sem mencionar front, reverse ou back**. A ferramenta aplica o mesmo número ao verso (**leitura conservadora**, que é a mesma que a Edge Grading atribui à SGC). Quando a leitura "só frente" der nota diferente, ela aparece ao lado.

| Nota | Limite | Nota | Limite |
|---|---|---|---|
| 10 PRI (Pristine) | 50/50 | 7 | 70/30 (aceita diamond leve) |
| 10 GM | 55/45 | 6.5 | sem número |
| 9.5 | sem número ("appears to be Gem Mint 10": não conta como nota intermediária) | 6 | 75/25 |
| 9 | 60/40 | 5.5 | sem número |
| 8.5 | 65/35 | 5 | 80/20 |
| 8 | 65/35 | 4.5 | sem número |
| 7.5 | 70/30 | 4 | 85/15 |
| | | 3.5 | sem número |
| | | 3, 2, 1.5 | 90/10 (2.5 sem número) |
| | | 1 | sem número |
| **lado** | **não especificado**: o mesmo limite vale pro verso na leitura conservadora | | |

O `GRADERS` de `src/graded-ui.js:10-17` não marca `pristine:true` na SGC, embora o 10 PRI exista. É uma inconsistência fora deste escopo; fica registrada.

#### TAG (confiança alta)

Fonte: <https://taggrading.com/pages/rubric>. Todos os limites vêm com "~". **Coluna de verso TCG.**

| Nota | Frente | Verso TCG | Nota | Frente | Verso TCG |
|---|---|---|---|---|---|
| 10 Pristine | 51/49 | 52/48 | 5.5 | **77,5/22,5** | borda* |
| 10 Gem Mint | 55/45 | 65/35 | 5 | 80/20 | borda* |
| 9 | 60/40 | 75/25 | 4.5 | **82,5/17,5** | borda* |
| 8.5 | **62,5/37,5** | 85/15 | 4 | 85/15 | borda* |
| 8 | 65/35 | 95/5 | 3.5 | **87,5/12,5** | borda* |
| 7.5 | **67,5/32,5** | borda* | 3 | 90/10 | borda* |
| 7 | 70/30 | borda* | 2.5 | **92,5/7,5** | borda* |
| 6.5 | **72,5/27,5** | borda* | 2 | 95/5 | borda* |
| 6 | 75/25 | borda* | 1.5 | **98,33/1,67** | borda* |
| | | | 1 | borda* | borda* |

\* **"borda"** = pode sobrar só um fio de borda, mas não pode ser miscut nem mostrar parte de outra carta.

Os números em negrito são onde o concorrente arredondou: 63, 68, 73, 78, 83, 88, 93, e 98/2 no 1.5. O verso de esporte (54,5/45,5 · 70/30 · 90/10 · 95/5) não se aplica ao Sleevu e fica só registrado no arquivo.

### 4.3 Outras graduadoras

Ficam na tabela da página, num bloco "Mais graduadoras", fora do painel principal na F1a.

| Empresa | Regra publicada | Confiança |
|---|---|---|
| **ACE** (Reino Unido) | Mede com precisão de milésimo de mm. 10: melhor que 60/40, **sem dizer o lado** (aplicado à frente e ao verso, leitura conservadora, como na SGC). 9: 65/35 · 70/30. 8: 70/30 · 75/25. 7: 75/25 · 80/20. 6, 5 e 4: 80/20. 3, 2 e 1: 85/15. Dá **OC** se a centralização ficar ≥ 2 notas abaixo da final. | alta (<https://acegrading.com/grading-scale>) |
| **PCA** (França) | Só o 10+ e o 10 têm número: **60/40** na frente e 75/25 no verso, medido pela largura da borda. Do 9.5 pra baixo, sem número. Os blogs dizem 55/45, o que contradiz a página oficial. | alta (<https://pcagrade.com/fr/ressources>) |
| **ARS** (Japão) | A centralização **não desconta**: só o estado de conservação conta. | alta (<https://ars-grading.com/service/reliability>) |
| **Capy Grading** (Brasil) | Derivada da TAG, com versos próprios. A página tem erros de digitação: o 7 aparece igual ao 7,5, e há "67,5/29" e "86/13,5". Final = pior subnota + até 0,5. | alta como fonte, com **erros na própria tabela** (<https://grading.capygames.com.br/escala-de-graduaco>) |
| **Edge Grading** (EUA) | 10: 55/45 na frente e 70/30 no verso. **Ultramint 10+**: 52/48 na frente e 60/40 no verso. | média: texto da própria Edge, mas num artigo comparativo (<https://www.edgegrading.com/centering>), não numa escala formal. Reconferir se surgir uma página de escala. |
| **Manafix/MGS**, **Gradd** (Brasil) | Dão subnota de centralização, mas **não publicam números**. | – |

### 4.4 Onde as pesquisas e as revisões divergiram, e o que vale

| Ponto | Divergência | Decisão |
|---|---|---|
| **Data da mudança da PSA** | Uma pesquisa achou 12–24/01/2025 (snapshots `20250112215218` e `20250124105846`). Outra achou 08/01–02/02, com o 1º relato no Elite Fourum em 29/01. | As duas são compatíveis; vale a janela mais estreita. O texto atual vale **desde 2025-01-24**. |
| **O que mudou na PSA** | O rascunho tratava a mudança como aperto e guardava o histórico pela ponta leniente da faixa. | Mudou a **redação da base**. A folga de 5% e o exemplo são idênticos antes e depois, então a tolerância máxima com eye appeal segue ~60/40 pro 10. O histórico fica como base + `faixaAte` (§4.7). "Aperto na prática" é afirmação do concorrente e vai atribuída a ele. |
| **BGS 9.5 e verso do Pristine** | `/grading-standards` diz 9.5 = 55/45 nos dois eixos e Pristine com verso 55/45. `/grading/scale` diz 9.5 = 50/50 num eixo e 55/45 no outro, e Pristine com verso 60/40. As duas ficaram no ar de 2023 a 2026; a `/grading/scale` foi capturada em 2026-05 com © 2026. | **Nenhuma pode ser dada como vigente.** A nota exibida é a **mais rígida** das duas, e as duas aparecem com o mesmo peso quando divergem. No arquivo, a 2ª página é `variante` com URL, não "regra antiga". **Confiança média.** Reconferir quando o site voltar (pergunta 4 da §12). |
| **CGC 3.5 × 4, e categoria** | Duas leituras puseram o 90/10 no **3.5**; uma pôs no **4**. O rascunho também marcava o 3.5 como "só esportes". | Vale o **3.5**, e o texto dele não tem a ressalva de categoria: **vale pra TCG**. Sem a marca "a conferir". |
| **CGC: todo o catálogo é TCG?** | O rascunho supunha que sim. | **Não.** A categoria vem por linha (`tcg`, `nao-esporte` ou `depende`). Carddass e vending ficam como "depende", com duas leituras. |
| **SGC** | Uma pesquisa não conseguiu ler a página (SPA) e sugeriu deixar a SGC de fora. Outra leu o bundle oficial. O rascunho dizia "só frente". | **Entra**, com os números do bundle oficial (alta), e o **lado é "não especificado"**: o mesmo limite vale no verso (conservador), com a leitura "só frente" ao lado quando divergir. A ACE recebe o mesmo tratamento no 10. |
| **"Não publicado" no verso** | O rascunho tratava `null` no verso como "ignora o verso". Com isso, o CGC Pristine 10 passava uma carta que reprova no Gem Mint 10. | `null` **herda o limite publicado da nota imediatamente inferior** no mesmo lado (o 10P da CGC herda o 75 do 10). Se nenhuma nota inferior publica, não há limite e o painel anota "verso não publicado". |
| **Notas sem número entre duas com número** | O rascunho devolvia a de baixo como teto. | Mostra "8 (8.5 sem número)" no BGS, e o mesmo nas meias notas sem número da SGC e da CGC non-sports. O PSA meio ponto e o SGC 9.5 não entram nessa regra, pela definição de cada um. |
| **Medir no meio ou no pior ponto** | O `/guide` do concorrente manda tirar a média de 2–3 pontos. A PSA mede no ponto mais descentralizado. | A nota usa o **pior ponto** quando ele difere do meio por mais de 2σ. Abaixo disso, o meio. O máximo de várias leituras ruidosas é enviesado pra cima, e uma carta 50/50 perfeita leria acima de 50 (§4.6). |
| **"Nota = mínimo dos eixos"** | O concorrente aplica isso a todas. | Vale pra teto (PSA, SGC, CGC, TAG) e pra **subnota** BGS. Não vale pra nota final BGS, nem pra regra cruzada do 9.5 da `/grading/scale`. |
| **Arredondamento da TAG** | O concorrente usa inteiros. | **Decimais oficiais.** |

### 4.5 Tabela do concorrente × oficial, em resumo

| Graduadora | Situação | O que está errado ou falta |
|---|---|---|
| **PSA** | 9 das 10 linhas batem | O PSA 1 é "sem exigência", não 90/10. Falta o 1.5. Ignoram a folga de 5%, que explica os 9% de PSA 10 de 2025 acima de 55/45 no estudo deles, e a medida no pior ponto. |
| **BGS** | Bate na maioria | O verso do 5 é 95/5. Misturam as duas páginas: Pristine com o verso 60/40 da `/grading/scale` e 9.5 com a frente 55/45 da `/grading-standards`, sem dizer que existem duas. Rotulam a subnota como se fosse a nota final. |
| **CGC** | A tabela inteira está na escala pré-2023 | Pra TCG só o Pristine 10, o Gem Mint 10 e o 3.5 têm número. O "9.5 = 55/45" deles é o Gem Mint 10. Os números do 9 pra baixo são de esportes e não-esportes, e estão deslocados (o 85/15 é do 4.5, o 90/10 é do 3.5). A frase da home, "CGC 9.5 permite 55/45", está errada. |
| **TAG** | Os inteiros e os versos batem | **7 meias notas (8.5 a 2.5) arredondadas 0,5 pra cima**, ou seja, mais lenientes. O 1.5 (98,33 → 98) ficou mais rígido. Falta o 1. |

### 4.6 Regra de cálculo

Pra cada lado medido (frente F, verso V) e cada eixo (L/R, T/B):

```
p(t)     = 100 · mL(t) / (mL(t) + mR(t))   // direcional: esquerda (ou topo) primeiro
meio     = p(½)
pior     = o mais desequilibrado entre p(0,15) e p(0,85)   // DENTRO da faixa ajustada (§6.4)
σdif     = incerteza de (maior(pior) − maior(meio)), pela covariância das retas (§6.8)
p*       = pior, se maior(pior) − maior(meio) > 2·σdif; senão meio
maior(x) = max(x, 100 − x)                 // o "55" de 55/45
X.pior   = max(maior(p*LR), maior(p*TB))   // eixo que limita
X.melhor = min(maior(p*LR), maior(p*TB))   // só pra regra cruzada {melhor, pior}
```

**Que valor entra.** O `p*` **arredondado pra 1 casa**, sempre. Quando a foto é pobre (`σ > 0,5`), a tela mostra o inteiro com "±", mas a nota continua decidida pela 1 casa, com a faixa "no limite". Assim a nota não muda com o formato de exibição, e o arredondamento que criticamos no concorrente não volta.

`passa(limite, X, lado)`:

| Limite | Resultado |
|---|---|
| número `N` | `X.pior ≤ N` |
| `{melhor, pior}` | `X.melhor ≤ melhor + δ50 && X.pior ≤ pior` (o "50" da regra cruzada da `/grading/scale` tem tolerância explícita, ver "No limite") |
| `"qualquer"` | sempre passa |
| `"borda"` | `X.pior < 100` (sobrou borda dos dois lados) |
| `"igual"` | lado não especificado (SGC, ACE 10): na leitura conservadora, o verso usa o número da frente; na leitura "só frente", o verso não decide |
| `null` na frente | não publicado: a linha **não é candidata** |
| `null` no verso | herda o limite publicado da **nota imediatamente inferior** que tenha número no verso. Se nenhuma tiver, não há limite e o painel anota "verso não publicado". |

**`nota(grad, F, V, leitura)`.**
- Percorre as linhas **da melhor pra pior** e devolve a 1ª **candidata** (frente com número, `"qualquer"` ou `"borda"`, e aplicável à categoria) em que `passa(f, F)` e (o verso não foi medido ou `passa(v, V)`).
- Se entre a última candidata reprovada e a aprovada existirem notas sem número (`inter`, ou `so` de outra categoria), o resultado é "**N (X sem número)**", por exemplo "BGS 8 (8.5 sem número)". Na CGC em TCG o caso vira "**abaixo de 10 · sem número pra TCG**" (até o 3.5).
- Se nenhuma candidata passa, o resultado é "**abaixo da última nota com número**".

**Duas leituras.** Três situações calculam a nota duas vezes:
- SGC e ACE (`lado: "nao-especificado"`): conservadora × só frente;
- BGS (`variantes`): `/grading-standards` × `/grading/scale`;
- CGC com categoria `depende`: TCG × não-esportiva.

O painel mostra a **mais rígida** como nota. Quando as duas divergem, mostra também a outra, com a origem ("SGC 7.5 · 10 se o limite valer só pra frente").

**No limite.**
- Folga `δ = max(0,5; 2·σ_total)`, com `σ_total` da §6.8.
- A nota é calculada com `X.pior + δ` (pessimista) e com `X.pior − δ` (otimista). Se as duas diferirem, sai como "**9–10 · no limite**", em âmbar e com o texto (não só com a cor).
- **Limites de 50/50** (Pristine, 10P, Black Label, o "50 num eixo" da `/grading/scale`) usam `≤ 50 + δ` e saem sempre como "**compatível com 50/50 (±σ) · no limite**". Esses limites são decididos pelo **meio** ± σ_total, nunca pelo pior ponto, cujo viés positivo reprovaria uma carta perfeita.

**Folga da PSA.** Se a nota estrita é `N` e existe uma nota `G > N` com `G ≥ 7` tal que `X.pior ≤ limite(G) + 5` (e o verso passa), o resultado é "**PSA N · G possível pela folga de 5% (eye appeal)**". Mostra-se o maior `G` que cumpre isso.

**Falta pro próximo.**
- Lista o `Δ = maior − limite(próxima)` de **cada eixo e de cada lado que falha**, não só o do eixo que limita. Exemplo: "o 10 pede ≤ 55: L/R 3,0 pt (≈ 0,17 mm) + T/B 2,0 pt (≈ 0,11 mm)".
- Em mm: `Δ/100 × (mA + mB)`, com `m` em mm pelo preset de tamanho.

**Frente e verso.** As duas medições são independentes. A nota é a linha mais alta que passa nas duas. Sem verso, o painel diz "**só frente · verso não medido**" e oferece *Medir o verso*. Na SGC, acrescenta "a SGC pode aplicar o mesmo limite ao verso".

**BGS.** O rótulo é sempre "subnota de centralização". Na F1a o painel não tenta estimar a nota final.

### 4.7 Formato do arquivo: `src/centering-graders.js`

É um arquivo **só de dados**, global e sem dependências, carregado antes do núcleo. Mantê-lo separado do núcleo deixa legível, na PR, o diff de uma mudança de regra.

```js
// Tolerâncias de centralização por graduadora (conferidas em 2026-10-01).
// N = "N/(100−N) ou melhor" no lado MAIOR (55 = 55/45). null = não publicado
// (frente: não é candidata; verso: herda o da nota imediatamente inferior);
// "qualquer" = até 100/0; "borda" = qualquer, desde que haja borda dos dois
// lados (não miscut); "igual" = lado não especificado (o verso usa o número
// da frente na leitura conservadora); {melhor, pior} = regra cruzada entre os
// eixos. Extras: inter = nota sem número entre duas com número; so = só numa
// categoria; aprox = "aproximadamente"; faixaAte = ponta alta de faixa histórica.
// Notas como TEXTO ("9.5", "10P"): a ordem do array é a ordem da escala.
window.TCGCenteringGraders = {
  revisado: "2026-10-01",
  lista: [
    { code: "psa", nome: "PSA", papel: "teto", medida: "pior-ponto",
      fontes: ["https://www.psacard.com/gradingstandards",
               "https://www.psacard.com/psa/locales/en-US/gradingStandards.json"],
      conferido: "2026-10-01", confianca: "alta",
      vigencias: [
        { desde: "2025-01-24", folgaFrente: { pontos: 5, notaMin: 7 },
          notas: [["10", 55, 75, { rot: "GEM-MT", aprox: 1 }], ["9", 60, 90, { aprox: 1 }],
                  ["8", 65, 90, { aprox: 1 }], ["7", 70, 90, { aprox: 1 }], ["6", 80, 90],
                  ["5", 85, 90], ["4", 85, 90], ["3", 90, 90], ["2", 90, 90],
                  ["1.5", 90, 90, { aprox: 1 }], ["1", "qualquer", "qualquer"]] },
        { ate: "2025-01-12", historico: true, folgaFrente: { pontos: 5, notaMin: 7 },
          // texto em FAIXA ("55/45 to 60/40"): a ponta alta = base + folga (mesmo exemplo de hoje)
          notas: [["10", 55, 75, { faixaAte: 60 }], ["9", 60, 90, { faixaAte: 65 }],
                  ["8", 65, 90, { faixaAte: 70 }], ["7", 70, 90, { faixaAte: 75 }]] }
      ] },
    { code: "bgs", nome: "BGS", papel: "subnota", padrao: "mais-rigida",
      fontes: ["https://www.beckett.com/grading-standards (Wayback 2025-12-10)"],
      variantes: { scale: "https://www.beckett.com/grading/scale (Wayback 2026-05-03, © 2026)" },
      conferido: "2026-10-01", confianca: "media",
      vigencias: [{ notas: [
        ["10", 50, 55, { rot: "Pristine", scale: { v: 60 } }],
        ["9.5", 55, 60, { scale: { f: { melhor: 50, pior: 55 } } }],
        ["9", 55, 70], ["8.5", null, null, { inter: 1 }], ["8", 60, 80],
        ["7.5", null, null, { inter: 1 }], ["7", 65, 90], ["6.5", null, null, { inter: 1 }],
        ["6", 70, 95], ["5.5", null, null, { inter: 1 }], ["5", 75, 95],
        ["4.5", null, null, { inter: 1 }], ["4", 80, "qualquer"], ["3.5", null, null, { inter: 1 }],
        ["3", 85, "qualquer"], ["2.5", null, null, { inter: 1 }], ["2", 90, "qualquer"],
        ["1.5", null, null, { inter: 1 }], ["1", "qualquer", "qualquer"]] }] },
    { code: "cgc", nome: "CGC", papel: "teto", categorias: ["tcg", "nao-esporte"],
      fontes: ["https://www.cgccards.com/card-grading/grading-scale/"],
      conferido: "2026-10-01", confianca: "alta",
      vigencias: [{ desde: "2023-07",
        notas: [["10P", 50, null, { rot: "Pristine" }],        // verso herda o 75 do Gem Mint 10
                ["10", 55, 75, { rot: "Gem Mint", aprox: 1 }],
                ["9.5", null, null, { rot: "Mint+" }],
                ["9", 60, 90, { so: "nao-esporte" }], ["8.5", null, null, { inter: 1 }],
                ["8", 65, null, { so: "nao-esporte" }], ["7.5", 65, null, { so: "nao-esporte" }],
                ["7", 70, null, { so: "nao-esporte" }], ["6.5", null, null, { inter: 1 }],
                ["6", 75, null, { so: "nao-esporte" }], ["5.5", null, null, { inter: 1 }],
                ["4.5", 85, null, { so: "nao-esporte" }],
                ["3.5", 90, null, { aprox: 1 }]]  // sem ressalva de categoria: vale pra TCG
                // o arquivo final lista a escala inteira da CGC, com null onde não há número
      }] },
    { code: "sgc", nome: "SGC", papel: "teto", lado: "nao-especificado",
      fontes: ["https://gosgc.com/card-grading-scale (bundle, LAST UPDATED 10/30/2025)"],
      conferido: "2026-10-01", confianca: "alta",
      vigencias: [{ notas: [["10P", 50, "igual", { rot: "Pristine" }], ["10", 55, "igual", { rot: "Gem Mint" }],
        ["9.5", null, null],                       // "appears to be Gem Mint 10": não é intermediária
        ["9", 60, "igual"], ["8.5", 65, "igual"], ["8", 65, "igual"], ["7.5", 70, "igual"],
        ["7", 70, "igual"], ["6.5", null, null, { inter: 1 }], ["6", 75, "igual"],
        ["5.5", null, null, { inter: 1 }], ["5", 80, "igual"], ["4.5", null, null, { inter: 1 }],
        ["4", 85, "igual"], ["3.5", null, null, { inter: 1 }], ["3", 90, "igual"],
        ["2.5", null, null, { inter: 1 }], ["2", 90, "igual"], ["1.5", 90, "igual"], ["1", null, null]] }] },
    { code: "tag", nome: "TAG", papel: "componente",
      fontes: ["https://taggrading.com/pages/rubric"], conferido: "2026-10-01", confianca: "alta",
      vigencias: [{ notas: [["10P", 51, 52, { rot: "Pristine" }], ["10", 55, 65], ["9", 60, 75],
        ["8.5", 62.5, 85], ["8", 65, 95], ["7.5", 67.5, "borda"], ["7", 70, "borda"],
        ["6.5", 72.5, "borda"], ["6", 75, "borda"], ["5.5", 77.5, "borda"], ["5", 80, "borda"],
        ["4.5", 82.5, "borda"], ["4", 85, "borda"], ["3.5", 87.5, "borda"], ["3", 90, "borda"],
        ["2.5", 92.5, "borda"], ["2", 95, "borda"], ["1.5", 98.33, "borda"],
        ["1", "borda", "borda"]] }] }
  ],
  mais: [ /* ace (10 com lado "nao-especificado"), pca, ars, capy, edge: mesmo formato, só pra tabela da página na F1a */ ],
  // Categoria pra CGC por linha do catálogo (F4). Fora daqui, o padrão é "tcg".
  // Montada na F4 a partir do GAME_LINES; Carddass e vending ficam "depende".
  categoriaPorLinha: { "nrt-dc": "depende" /* , … */ }
};
```

- A **tabela da página** (seção "Critérios das graduadoras") e o **painel** leem deste arquivo. Não existe segunda cópia no HTML.
- Os textos (rótulos, "não publicado", "lado não especificado", o nome de cada regra) ficam no i18n. O arquivo guarda só números, códigos e URLs.
- A categoria por linha mora **aqui**, e não no `GAME_LINES` do `shared.js`, pra custar 0 B no núcleo.

### 4.8 Como atualizar quando uma graduadora mudar a regra

1. **Nova vigência.** Acrescentar uma entrada em `vigencias` com `desde` = a data do 1º snapshot ou anúncio com o texto novo. A anterior ganha `ate` e `historico: true`. Histórico não se apaga.
2. **Metadados.** Atualizar `conferido`, `fontes` e `confianca`.
3. **Testes.** Atualizar os **casos-âncora** de `tests/centering-graders.test.mjs` (§10.2) com o texto novo. Esse teste é a documentação executável da regra.
4. **Avisos.** Entrada no `data/changelog.json` ("A PSA mudou a regra de centralização: …"). Se a mudança for notável, um parágrafo na seção "Mudanças recentes" da página.
5. **Lembrete periódico.** Quando algum `conferido` passar de 180 dias, o `scripts/check.mjs` imprime **uma linha própria, sempre**, fora da lista de avisos. A lista só aparece com `--verbose`, e hoje já resume 67 avisos numa linha.
   - O texto é "⚠ tabelas de centralização conferidas há N dias: reconferir".
   - No GitHub Actions a linha sai também como anotação `::warning::`, que aparece nos checks da PR.
   - Não falha o CI, pra não virar uma bomba-relógio.

---

## 5. Experiência

### 5.1 Fluxo no celular (o caso principal)

```
/tools/centering
  [Tirar foto] (câmera nativa, resolução cheia)  ·  [Galeria]  ·  [Colar]
        ↓ (lê o cabeçalho, decodifica uma vez ≤ 1 s, orientação EXIF)
1 ÂNGULO   foto inteira · 4 cantos · lupa no canto oposto ao dedo
           (F1b) ao soltar um canto, as 2 bordas vizinhas "grudam" no corte (sub-pixel)
           [Endireitar]
        ↓
2 BORDAS   carta endireitada · 8 linhas
           F1a: externas na borda do quadrilátero, internas a 4,5% pra dentro, ajuste à mão com lupa
           F1b: já sugeridas (corte medido + moldura achada), ímã, modo guiado
           mini-barra fixa: "L/R 57,5/42,5 · T/B 48,5/51,5 · PSA 9"
        ↓
3 RESULTADO folha (recolhida/média/cheia): 5 graduadoras, eixo que limita, quanto falta por eixo,
           ângulo da foto
           [Medir o verso]  [Compartilhar (F3)]
```

**Quantos toques:**
- **F1a:** 4 arrastes de canto, "Endireitar" e 4 a 8 ajustes de linha com lupa.
- **F1b:** as linhas já vêm sugeridas e a conferência costuma ser só olhar.
- **F2:** a detecção automática entrega os cantos, e o caminho comum vira **foto → um toque pra confirmar → resultado**.

### 5.2 Fluxo no PC

O mesmo modelo, com tudo visível ao mesmo tempo:
- **Entrada:** arrastar o arquivo pra página, colar com Ctrl+V em qualquer estado, ou "Escolher foto".
- **Tela:** palco à esquerda; à direita, a lupa fixa, as medidas e o painel de notas, ao vivo.
- **Teclado:** básico na F1a, completo na F1b (§5.5).

### 5.3 Estados

```
S0 ENTRADA --arquivo/câmera/colar/arrastar--> S1 CARREGANDO --ok--> S2 ÂNGULO --Endireitar--> S3 BORDAS (+ resultado ao vivo)
   ^  erro (HEIC fora do Safari, arquivo corrompido) → S0 com a mensagem    ^ "editar cantos" (linhas preservadas em fração)
   |  câmera nativa matou a aba → S0 com a mensagem própria (abaixo)        |
   +--- "Nova foto" (toast com Desfazer, 6 s) <----------------------------+
Dimensão LADO: FRENTE e VERSO, cada um com S1..S3 próprios; trocar pra um lado vazio cai em S0 desse lado.
S4 COMPARTILHADO (F3): #v1;… na URL → cartão só com números, só leitura → "Medir a minha" → S0
```

**Voltar.**
- `history.pushState` por estado de topo, **sempre com a URL atual absoluta**: `history.pushState({ passo }, "", location.pathname + location.search)`.
- A página tem `<base href="/">`, então qualquer URL relativa ("?passo=…", "#…") resolve na **home**. O F5 abriria a Início, e o voltar do Android sairia da ferramenta.
- O voltar do Android e o Esc recuam um passo. O Esc fecha antes a lupa, a folha ou o menu.

**Desfazer e refazer (F1b).**
- Uma pilha por lado, com até 50 passos.
- Cada fim de arrasto é um passo. Rajadas de teclado ou de botão em menos de 400 ms viram um passo só.

**Recargas automáticas, que descartariam a foto (que só existe em memória):**
- **Versão nova do service worker.** O `controllerchange` chama `versaoNovaAssumiu()` (`src/shared.js:2541`), e o `visibilitychange` chama `reg.update()` quando a aba volta a ficar visível (`:12689`). Esse é justamente o momento da volta do app de câmera nativa.
- **Pull da nuvem no boot de quem está logado.** Recarrega se algo mudou (`:12312`), sem passar pelo `podeRecarregarSozinho`.

**Guardas contra essas recargas:**
- Enquanto houver foto carregada (S1–S3), a ferramenta põe `data-ocupado` no `<html>`, e o `podeRecarregarSozinho` (`:2513`) passa a respeitar isso (+13 B gz medidos). A versão nova então vira o toast persistente "versão nova" e espera.
- No celular, o editor imersivo também é `role="dialog" aria-modal="true"`, o que é semanticamente correto ali e já é respeitado hoje.
- Enquanto existir `#pageLoadingPill` (o pull do boot), a entrada de foto fica desabilitada com o texto "sincronizando…". Custa 0 B no núcleo.

**Recarregar e aba morta:**
- Cantos, linhas e números vão pro `sessionStorage`. A foto, **nunca**.
- Ao recarregar com uma medição em curso: "A foto foi descartada; o resultado continua aqui".
- **Câmera nativa no Android:**
  - logo antes de abrir o `<input capture>`, grava-se a marca `ctr-camera-aberta` no `sessionStorage`;
  - se na volta existir a marca e não houver foto, a página diz: "O celular recarregou a página ao abrir a câmera. Tire a foto no app da câmera e use **Galeria**";
  - o evento `centering` registra `etapa: "camera-perdida"` (F1b), pra medir a frequência.

**Ao sair:** revoga os object URLs, fecha os `ImageBitmap`, zera os canvas temporários e remove o `data-ocupado`.

### 5.4 Telas

Convenção dos desenhos: setas, chevrons e o "feito" dos passos são **SVG inline de traço com `currentColor` e `aria-hidden`**. O estado do passo vai em texto e em `aria-current="step"`. Nada de glifo de texto em botão (CLAUDE.md). A única exceção é o `▾` do menu de topo, que segue o `.nav-caret` que já existe no cabeçalho, com `aria-hidden`.

**Menu (desktop, ≥ 861 px).**

```
Início  Jogos  Explorar  Decks beta  [Tools ▾]  Blog  Coleção ▾  Portfólio beta
                                     +--------------------+
                                     | Centering Tool     |
                                     +--------------------+
```

- O clique em "Tools" leva a `/tools/centering`. Hover ou foco abrem o painel.
- Deslogado, o menu é o mesmo, sem Coleção e Portfólio.
- **`/tools` (índice)** só existe quando chegar a 2ª ferramenta. Até lá, `/tools` faz 302 pra `/tools/centering`.

**D1: entrada no desktop.**

```
Centering Tool                         [cadeado] O Sleevu nunca recebe sua foto: tudo é medido no seu aparelho
Meça a centralização como PSA, BGS, CGC, SGC e TAG. Grátis, sem cadastro, funciona offline.
+-----------------------------------------------+  +-------------------------------+
|              [ícone imagem]                   |  | Pra medir certo               |
|     Arraste a foto da carta aqui              |  | 1 Luz difusa, sem reflexo     |
|     ou cole com Ctrl+V                        |  | 2 Fundo que contraste         |
|          [ Escolher foto ]                    |  | 3 Carta grande no quadro      |
|   JPG, PNG, WebP · HEIC só no Safari          |  | 4 O mais de frente possível;  |
+-----------------------------------------------+  |   a ferramenta endireita o    |
                                                   |   resto, inclusive no         |
                                                   |   toploader                   |
                                                   +-------------------------------+
Critérios das graduadoras  [Frente | Verso]   (tabela do §4, com fonte e data)
Como funciona · (F3) A mudança da PSA em 2025 · Perguntas frequentes
```

Os atalhos internos ("Como funciona", "Perguntas frequentes") **não são `href="#…"`**. Com `<base href="/">`, eles levariam pra `/#…`, a home. São botões que rolam por JS, no molde do skip-link (`src/shared.js:3054-3063`).

**D2: Ângulo.**

```
[Frente* | Verso]   1 Ângulo — 2 Bordas — 3 Resultado          [desfazer][refazer] [Nova foto]
+----------------------------------------------------+ +-------------------------------+
| fora do quadrilátero escurecido 55%                | | LUPA · canto sup. esquerdo    |
|     O-----------------o-----------------O          | |  retas prolongadas tracejadas |
|    /                                     \         | |  + cruz no encontro           |
|   o                                       o        | +-------------------------------+
|  /                                         \       | Arraste cada canto até o        |
| O-------------------o-----------------------O      | ENCONTRO das bordas da carta —  |
+----------------------------------------------------+ não da curva, nem do plástico.  |
 [Girar 90°] [Foto já reta]  Tamanho [63×88]  Ângulo da foto ~6°   [ Endireitar ] (Enter)
```

- `O` = canto (anel com alvo de 44 px).
- `o` = meio da aresta: arrasta a aresta inteira em paralelo.
- As arestas são **retas prolongadas** além dos cantos.
- Um arrasto que deixaria o quadrilátero côncavo, cruzado ou com perspectiva extrema **trava no último estado válido** (§6.4).
- O desfazer e o refazer chegam na F1b.

**D3: Bordas e resultado.**

```
[Frente* | Verso]   1 Ângulo (feito) — 2 Bordas — 3 Resultado          [desf][ref] [Nova foto]
+-------------------------------------------+ +----------------------------------------------+
| margem de 4% em volta (fundo escurecido)  | | LUPA · Esquerda · moldura                    |
|  :|                                 |:   | |   :    |  (corte tracejado, moldura sólida)  |
|  :|      carta endireitada          |:   | +----------------------------------------------+
|  :|                                 |:   | FRENTE · foto a ~6°                    ±0,3  |
|  ':' corte · '|' moldura                 | | L/R  esq 57,5 · dir 42,5  (pior ponto 57,9,  |
+-------------------------------------------+ |      dentro da incerteza: vale o meio)       |
 Lado [Esq][Dir][Topo][Base]  [Corte|Moldura]  | T/B  topo 48,5 · base 51,5                   |
 Giro da moldura [−]—|—[+] 0,00°  Ímã: ligado | PSA  9 · L/R limita · o 10 pede ≤55: faltam |
 Zoom [−] 100% [+] [Ajustar]  [?] atalhos     |      2,5 pt no L/R (≈0,14 mm) · 10 possível |
                                                |      pela folga de 5% (eye appeal)           |
                                                | BGS  8 (8.5 sem número) · subnota            |
                                                | CGC  abaixo de 10 · sem número pra TCG       |
                                                |      Tipo pra CGC [TCG | Não-esportiva]      |
                                                | SGC  9 · lado não especificado: o verso      |
                                                |      pode baixar                             |
                                                | TAG  9 · 10 pede ≤55                         |
                                                | Verso não medido   [ Medir o verso ]         |
                                                | Estimativa só da centralização.              |
                                                +----------------------------------------------+
```

Na F1a, a barra mostra o giro da moldura, o zoom e a lupa. O ímã e o modo guiado chegam na F1b.

**M1: entrada no celular** (página normal, com tabbar).

```
Centering Tool
Centralização como PSA, BGS, CGC,
SGC e TAG. O Sleevu nunca recebe sua foto.
+----------------------------------+
| [câmera]  Tirar foto             |   .cta 52 px, largura toda
+----------------------------------+
[ Galeria ]          [ Colar ]          48 px ("Colar" só com clipboard.read)
> Como tirar uma boa foto              <details>
Critérios das graduadoras [Frente|Verso]  (tabela com rolagem lateral, 1ª coluna fixa)
```

**M2: Ângulo.** Editor imersivo por cima da tabbar (z > 40, como o `.scan-modal`), com `role="dialog" aria-modal="true"` e `theme-color` escuro.

```
+----------------------------------+
| (<) Ângulo · Frente  (desf) (...) |  48 px
| +--------+                        |
| | lupa   |  (132 px, no canto     |
| |  -+-   |   oposto ao dedo)      |
| +--------+                        |
|     O--------------O              |
|    /   foto          \            |
|   O-------------------O           |
| Arraste os cantos até o encontro  |
| das bordas da carta               |
| [Girar 90°] [63×88]               |
| [          Endireitar          ]  |  .cta
+----------------------------------+
```

O menu (...) tem: Foto já reta · Trocar foto · Ajuda.

**M3: Bordas** (visão geral e, na F1b, modo guiado).

```
+----------------------------------+      +----------------------------------+
| (<) [Frente*|Verso] (desf)(...)  |      | (<) Direita 2/4      (desf)(...) |
| +------------------------------+ |      | [====][====][    ][    ]         |
| |  carta endireitada com as    | |      | +------------------------------+ |
| |  8 linhas                    | |      | | zoom no meio da borda direita| |
| |                              | |      | |       |           :          | |
| +------------------------------+ |      | |       |           :          | |
| [ Conferir lados ]  Giro 0,00°   |      | +------------------------------+ |
| L/R 57,5/42,5 · T/B 48,5/51,5    |      | [Corte | Moldura*]   Dir 2,09 mm |
| PSA 9 (mini-barra, abre a folha) |      | [−] ===== régua fina ===== [+]   |
+----------------------------------+      | [Anterior]      [Próximo lado]   |
                                          | L/R 57,5/42,5 · PSA 9            |
                                          +----------------------------------+
```

- **Altura útil do palco em pé:** ~844 − 47 (safe-area) − 60 − 150 − 34 ≈ **550 px**.
- No modo guiado, a borda (~17 px na visão geral) chega a ~70 px com o zoom de 4×, o que separa as duas alças de 44 px.

**M4: Resultado.** Folha com três alturas (recolhida 52 px, média ~45%, cheia 84%), no padrão da `scan-sheet`, com o conteúdo do painel do D3. O cabeçalho da folha é um botão com `aria-expanded`.

**M5: celular deitado** (~844×390). É escolhido por `(pointer: coarse) and (orientation: landscape)`, não pela largura, pra não cair no layout de PC.

```
+--------------------------------------------------------------------+
| (<) Bordas · Frente                                  (desf) (...)  |
| +------------------------------------------+ +-------------------+ |
| | palco (~62% da largura, altura toda)     | | Lado / Corte|Mold | |
| |                                          | | [−] régua [+]     | |
| |                                          | | L/R 57,5 · T/B …  | |
| +------------------------------------------+ | PSA 9 · BGS 8 …   | |
|                                              | (coluna rolável)  | |
+--------------------------------------------------------------------+
```

Sem folha: o resultado mora na coluna da direita, e a lupa fica no canto do palco oposto ao dedo.

### 5.5 Interação em detalhe

**Linhas.** O palco é sempre escuro (`#0b0d12`), independente do tema, e por isso as cores são fixas. A distinção nunca depende só da cor.

| Linha | Traço | Alça |
|---|---|---|
| Corte | tracejado de 1,5 px `#f3f5f7`, halo preto de 1 px | anel vazado, **por fora** da linha, a 30% do comprimento |
| Moldura | sólido de 2 px `#00e5ff` (o da v1), com halo | quadrado arredondado cheio, **por dentro**, a 70% do comprimento |
| Selecionada | 3 px `#ff3d7f` (o foco da v1) | rótulo flutuante "Esq · moldura · 2,82 mm" |

- **Faixas:** entre corte e moldura, `rgba(255,255,255,.10)`; fora do corte, escurecido `rgba(6,8,12,.55)`.
- **Ordem obrigatória por eixo:** `corte_esq < moldura_esq < moldura_dir < corte_dir`, com 1 px de folga. O arrasto **trava no vizinho** em vez de cruzar.
- **Arrastar o corpo** move a linha inteira, em paralelo.
- **Inclinação:**
  - Não há alças manuais de inclinação por linha. No modo guiado elas ficariam fora da tela, e dois controles pra mesma coisa confundem.
  - O controle manual é **um só**, o giro da moldura.
  - A inclinação própria de cada linha vem do ímã (F1b), que ajusta a reta com inclinação.

**Giro da moldura** (a paridade com o slider do concorrente, no lugar certo):
- Gira as 4 linhas de moldura juntas, em volta do centro delas. Faixa de −5° a +5°, passo de 0,05°, com Reset.
- O giro é aplicado no **espaço métrico** (u·W, v·H do preset) e convertido de volta pra (u,v). Assim a moldura continua retangular e o ângulo exibido não depende do preset (§6.4).
- Girar o **corte** não precisa de slider: a homografia já deixa o corte reto.
- Quando o ímã (F1b) mede mais de 0,15° entre moldura e corte, aparece "moldura girada 0,4° em relação ao corte". Isso pesa: 0,5° ao longo de 88 mm desloca 0,77 mm de margem entre o topo e a base, ~25% de uma borda de 3 mm.

**Ímã** (F1b, ligado por padrão):
- **Janela** em unidades da carta: ±max(4 px da foto; 30% da margem atual daquele lado), nunca mais que ±12 px de tela.
- **Candidatos por tipo de linha:**
  - o corte fica com a aresta mais de fora que tem fundo ou plástico do lado de fora;
  - a moldura, com a primeira aresta forte por dentro do corte.
- Dentro do tipo, vale o candidato mais perto de onde a linha foi solta.
- No zoom de visão geral do celular (1 px de tela > 3 px da foto), **se a janela tiver mais de um candidato**, a linha fica onde foi solta e o painel sugere "Conferir lados" (modo guiado de 4×).
- Ao encaixar, aparece a marca "ajustada à borda". O Desfazer desfaz o encaixe.
- Pode ser desligado no botão ou, no PC, segurando Alt durante o gesto.
- Sem aresta, a linha fica onde foi solta.

**Lupa** (F1a):
- Aparece no `pointerdown` de uma alça ou da régua e some 300 ms depois de soltar.
- **No celular:** círculo de 132 px no canto superior oposto ao dedo, a 24 px da borda.
- **No PC:** fixa no painel, com 300×300 px.
- Lê a **foto original via H**, com até 6 px de tela por pixel da foto.
- Mostra a mira e as linhas do lado. No passo Ângulo, mostra as duas retas prolongadas e o encontro delas.

**Zoom e pan:**
- **F1a:** roda do mouse no ponto do cursor e botões `+` `−` `Ajustar` no PC; pinça e dois dedos no celular.
- **F1b:** toque duplo alterna entre ajustar e 4× no ponto; Espaço+arrastar no PC; um dedo numa área vazia faz pan quando o zoom é > 1; zoom guiado.
- **Zoom máximo:** 1 px da imagem endireitada = 4 px de tela.

**Ajuste fino (F1b):**
- **Régua:** faixa de 48 px; 10 px de arrasto movem 1 px da foto.
- **Botões −/+:** 1 px por toque, com repetição a 12/s depois de 400 ms segurando.

**Teclado.** Na F1a: Tab, setas, Shift, Enter e Esc. Na F1b, o resto.

| Tecla | Ação |
|---|---|
| Tab / Shift+Tab | próxima/anterior alça (cantos em sentido horário; linhas na ordem guiada) |
| ←/→ (linhas verticais) · ↑/↓ (horizontais e cantos) | 1 px da foto |
| Shift+seta / Alt+seta | 10 px / 0,25 px |
| `[` `]` | lado anterior/próximo (F1b) |
| `C` / `M` | corte/moldura do lado ativo (F1b) |
| Ctrl/Cmd+Z · Ctrl+Shift+Z / Ctrl+Y | desfazer · refazer (F1b) |
| Enter | confirma o passo (Ângulo → Bordas; próximo lado) |
| Esc | fecha lupa/folha/menu; senão volta um passo |
| Ctrl+V | cola uma imagem (troca a foto do lado ativo, com aviso) |
| `?` | popover de atalhos (F1b) |

### 5.6 Resultado

- **Formato principal:** "esq **57,5** · dir **42,5**" e "topo 48,5 · base 51,5", com **±σ_total** pequeno ao lado.
  - Vírgula decimal em pt e es; ponto em en.
  - Uma linha diz o lado mais grosso: "mais grosso à esquerda".
- **Precisão baixa:** se `σ_total > 0,5`, o número **aparece** inteiro com "±" ("58/42 ±1"), com o aviso "Foto com pouca resolução: chegue mais perto ou use o zoom 2×". A nota segue decidida pela 1 casa (§4.6).
  - (2026-10-02) O inteiro e o aviso de resolução olham o σ **só da foto** (ajuste, cantos e piso, sem a paralaxe). Sem dados de câmera (imagem colada, print, scanner, "Foto já reta") a paralaxe vai pro pior caso de 20° e passaria de 0,5 em toda foto nítida; ela já tem o aviso de ângulo. O "±" exibido continua sendo o total.
- **Ângulo da foto:** sempre que a pose for estimável (§6.4).
  - Acima de ~10°: "Foto a ~14°: a espessura da carta pode somar até ±0,4 pt do lado mais perto da câmera. Pra precisão cheia, fotografe mais de frente."
  - Sem EXIF (imagem colada ou recortada): "ângulo desconhecido".
- **Pior ponto e meio:** a nota usa o pior ponto quando ele se afasta do meio por mais de 2σ. Quando os dois diferem, ambos aparecem, com "dentro da incerteza" ou "pior ponto decide".
- **Linha por graduadora:**
  - nota, com `no limite`, `possível pela folga` ou `(X sem número)` quando couber;
  - eixo que limita, contornado em `--accent` e escrito ("L/R limita");
  - "o X pede ≤ N: faltam Δ pt (≈ mm)" **em cada eixo e lado que falha**;
  - **duas leituras** quando divergem (SGC lado, BGS páginas, CGC categoria);
  - para o 10 de topo: Pristine (CGC/SGC), 10P (TAG), Pristine/Black Label (BGS), sempre "compatível com 50/50 · no limite".
- **"Mais graduadoras"** (ACE, PCA, ARS, Capy, Edge) fica recolhido. Na F1a, só com o texto da tabela.
- **Texto fixo:** "Estimativa só da centralização. A nota real também considera cantos, bordas e superfície. PSA, BGS, CGC, SGC e TAG são marcas dos seus donos; o Sleevu não é afiliado a nenhuma."

### 5.7 Textos-chave

| Chave (pt) | pt | en | es |
|---|---|---|---|
| nome | Centering Tool | Centering Tool | Centering Tool |
| menu | Tools | Tools | Tools |
| passos | Ângulo · Bordas · Resultado | Angle · Borders · Result | Ángulo · Bordes · Resultado |
| linhas | corte · moldura | cut edge · print frame | corte · marco |
| privacidade | O Sleevu nunca recebe sua foto: tudo é medido no seu aparelho. | Sleevu never receives your photo: everything is measured on your device. | Sleevu nunca recibe tu foto: todo se mide en tu dispositivo. |
| dica dos cantos | Arraste cada canto até o encontro das bordas da carta — não da curva do canto, nem do plástico do toploader. | Drag each corner to where the card's edges meet — not the rounded corner, not the toploader. | Arrastra cada esquina hasta donde se cruzan los bordes de la carta — no la curva ni el toploader. |
| no limite | no limite | borderline | al límite |
| folga PSA | possível pela folga de 5% (eye appeal) | possible within PSA's 5% leeway (eye appeal) | posible por la tolerancia de 5% (eye appeal) |
| não publicado | não publicado pela graduadora | not published by the grader | no publicado por la empresa |
| lado não especificado | a graduadora não diz se o limite vale pro verso | the grader doesn't say whether this applies to the back | la empresa no dice si el límite vale para el dorso |
| sem número | sem número publicado | no published number | sin número publicado |
| HEIC | por plataforma: Mac → "Abra no Safari ou exporte como JPEG"; Android → "Na câmera, troque o formato pra JPEG (ou 'alta compatibilidade') e tire de novo"; Windows/Linux → "Exporte como JPEG" | … | … |
| câmera perdida | O celular recarregou a página ao abrir a câmera. Tire a foto no app da câmera e use Galeria. | … | … |

"Tools" e "Centering Tool" ficam literais nos 3 idiomas, como pediu o Fernando (pergunta 1 da §12). O H1 em pt leva também "centralização", pra busca: *Centering Tool: centralização de cartas pela foto*.

### 5.8 Casos de borda

| Caso | Tratamento |
|---|---|
| **Toploader, sleeve ou slab** | Há duas bordas na foto. A dica fixa e a lupa mandam mirar a borda da **carta**. O ímã de corte (F1b) só aceita a aresta mais de fora **que tem fundo ou plástico do lado de fora**, dentro de uma janela em unidades da carta. Na F2 a lista de faixas vira o botão "Próxima borda". |
| **Canto arredondado** | O canto é o encontro das retas. Os perfis do ímã usam só de 12% a 88% de cada lado. |
| **Carta deitada (paisagem)** | Girar 90°. O L/R segue a orientação de leitura. |
| **Celular deitado** | Layout M5 (palco + coluna). |
| **Foto muito inclinada (> ~10°)** | Mede igual, mostra o ângulo e soma o `σ_paralaxe` ao "±" (§6.8). A F2 compensa a espessura. |
| **Sem moldura** (full art, borderless) | O ímã não acha faixa uniforme e mostra o aviso "carta sem borda impressa: use uma referência impressa simétrica". As linhas continuam valendo à mão. |
| **Miscut extremo** (> 90/10) | Mostra a nota conforme a tabela ("qualquer"/"borda"), sem quebrar. |
| **Reflexo, holo, moldura da cor do fundo** | Dica de foto. Ímã sem pico: a linha fica onde foi solta, sem marca. |
| **Foto pequena, borrada ou escura** | Aviso de resolução pelo `σ_total` e pela borda mais fina em px (§6.8). |
| **Preset de tamanho errado** | **Não muda a porcentagem**, só os mm. A interface diz isso ("o tamanho só muda os milímetros"). |
| **Trocar a foto no meio** | Toast com Desfazer (F1b), que restaura a anterior. Na F1a, confirmação simples. |
| **Aba recarregada** | Os números ficam e a foto é descartada, com aviso. Recarga por versão nova ou pull fica bloqueada enquanto há foto (§5.3). |
| **Câmera nativa matou a aba (Android)** | Marca no `sessionStorage` e mensagem própria (§5.3). |

---

## 6. Arquitetura técnica

### 6.1 Arquivos

| Arquivo | O quê | Fase |
|---|---|---|
| `tools-centering.html` (novo, raiz) | A ferramenta, servida em `/tools/centering` pelo `_redirects`. Tem `<base href="/">`, `data-active-page="centering"` e conteúdo indexável abaixo da dobra. | F1a |
| `tools-centering-en.html` (novo, raiz) | Variante indexável em inglês: igual ao pt, exceto `lang="en"`, canonical e hreflang (§7.5). | F3 (pergunta 14) |
| `tools.html` | Índice `/tools`. **Só com a 2ª ferramenta.** | depois |
| `src/centering-graders.js` (novo) | Dados da §4.7. | F1a |
| `src/centering-core.js` (novo) | **Puro, sem DOM**, `window.TCGCenteringCore`: leitura do cabeçalho (SOF/EXIF), homografia, validação do quadrilátero, pose, amostragem, perfis, estimador de aresta, RANSAC com semente, ímã, sugestão de linhas, margens, incerteza, notas, formatação e hash de compartilhar (F3). Roda no `vm` do node. | F1a (geometria, notas, incerteza), F1b (aresta, ímã, sugestão) |
| `src/centering.js` (reescrito) | Interface: entrada, estados, palco, alças, lupa, zoom, teclado, desfazer (F1b), painel, tabela de critérios, `sessionStorage`, guarda de recarga. | F1a |
| `src/i18n-tools.js` (novo) | Pacote pt/en/es da ferramenta (molde de `src/i18n-blog.js:1-11`). | F1a |
| `src/centering-detect.js` (novo) | Detecção automática (Hough + rotulagem + porta de confiança) e compensação da espessura. Injetado pelo `centering.js` quando a 1ª foto chega. | F2 |
| `src/centering-camera.js` (novo) | Câmera ao vivo com moldura e nível. Injetado sob demanda. | F5 |
| `tests/lib/carta-sintetica.mjs` (novo) | Gerador de carta sintética, portado do protótipo `sint.mjs`, **com espessura** (parede da carta como faixa da cor do miolo, 0,30 mm por padrão, configurável por jogo). Não termina em `.test.mjs`, então o glob do CI não o pega. | F1a |
| `tests/centering-core.test.mjs`, `tests/centering-graders.test.mjs` | §10. Substituem o `tests/centering.test.mjs`. | F1a |
| `tests/i18n-pacotes-shell.test.mjs` (novo) | Todo `src/i18n-*.js` está como literal no `SHELL_ASSETS`, e toda página da raiz com tag de i18n tem a tag exata do `theme.js` (§7.6). | F1a |
| `scripts/bench-centering.mjs` (novo, fora do CI) | Monte Carlo sintético. Imprime média, p95 e máximo por cenário. | F1a |
| `scripts/harness/centering.html` (novo, fora do deploy) | Roda o corpus real no navegador (`npx http-server`), porque o node não decodifica JPEG. Fica em `scripts/` porque essa pasta é ignorada pelo `split-i18n` e pelo `hash-assets` e é apagada no deploy. Em `tests/`, o `split-i18n` a varreria e abortaria o deploy. | F1a (ferramenta), F2 (uso) |

O protótipo medido (`geo.mjs`, `medir.mjs`, `oito.mjs`, `sint.mjs`, `detecta.mjs`, `rotula.mjs`, `mc.mjs`) está em `docs/centering-prototipo/` (a pasta `docs` sai no deploy e o `check.mjs` não a varre). Roda direto no node: `node docs/centering-prototipo/t1.mjs` mostra a homografia batendo com o DLT (2,3e-13 px) e o erro com e sem correção de perspectiva (−0,08 pp × 6–11 pp). Ele é **portado** na F1a (geometria, gerador), na F1b (refino, ímã, já com o estimador novo da §6.5) e na F2 (detecção), não reescrito do zero; a pasta sai quando a F2 entrar.

**Ordem dos scripts em `tools-centering.html`** (a guarda 6 do `check.mjs` confere):
1. `theme.js` + `game.js` (par exato, sem nada entre as duas tags, `bundle-boot.mjs:45`);
2. `i18n.js`;
3. `i18n-tools.js`;
4. `shared.js`;
5. `centering-graders.js`;
6. `centering-core.js`;
7. `centering.js`.

### 6.2 Estado em memória

```js
sessao = {
  ladoAtivo: "f",                       // "f" | "v"
  preset: "63x88",                      // só desenho e mm (ver 6.4)
  categoriaCgc: "tcg",                  // "tcg" | "nao-esporte" | "depende" (F4: pela linha)
  lados: { f: Medicao | null, v: Medicao | null }
}
Medicao = {
  arquivo: Blob,                        // o JPEG original, comprimido (~3–6 MB); NUNCA persistido
  w, h,                                 // da fonte decodificada (≤ 12 MP)
  exif: { focal35, orientacao } | null, // do cabeçalho; null em imagem colada/recortada
  px: Uint8ClampedArray | null,         // RGBA cheio, SÓ do lado ativo (o outro é redecodificado do Blob)
  mips: [ImageBitmap...],               // 1/2, 1/4… pra tela
  cantos: [[x,y] × 4],                  // px da foto; TL, TR, BR, BL
  pose: { anguloGraus } | null,         // de H + K a priori (6.4)
  linhas: { ext: {l,r,t,b}, int: {l,r,t,b} }, // cada uma {c, k}: posição no meio + inclinação (6.4)
  giro: 0,                              // graus, no espaço métrico, aplicado às 4 internas
  origem: { l: "ima"|"manual"|"auto", … }, sigma: { … }  // por linha (covariância), em px da foto
}
```

O `sessionStorage` (`ctr-sessao-v1`) guarda só `preset`, `categoriaCgc`, `cantos`, `linhas`, `giro`, `sigma`, `pose` e os números de cada lado, além da marca `ctr-camera-aberta` (§5.3). **Pixels, nunca.**

### 6.3 Entrada, decodificação, EXIF, HEIC e memória

**Botões** (`matchMedia("(pointer: coarse)")` decide quais aparecem):
- **Tirar foto** (só no celular): `<input type=file accept="image/*" capture="environment">`. No Android o `capture` abre a câmera direto, **sem galeria**; por isso existem dois botões. Antes de abrir, grava a marca `ctr-camera-aberta`.
- **Galeria / Escolher foto:** o mesmo input, sem `capture`.
- **Colar:** evento `paste` na página inteira (`clipboardData.files`), e um botão com `navigator.clipboard.read()` só onde ele existir.
- **Arrastar:** `dragover`/`drop` na página. Uma imagem arrastada de outra aba chega como URL. Com a CSP atual, a resposta é "Copie a imagem (botão direito → Copiar imagem) e cole aqui". A URL de imagem do eBay fica pra F5.
- Enquanto existir `#pageLoadingPill`, os botões ficam desabilitados ("sincronizando…", §5.3).

**Decodificação: uma vez só, já no tamanho final.** Um `createImageBitmap` sem resize, usado só pra saber o tamanho, decodificaria a foto inteira: 98 MB a 24 MP, 195 MB a 48 MP, exatamente o pico que o teto quer evitar.

```js
// 1) Cabeçalho, SEM decodificar (no centering-core, testável no node, ~40 linhas):
//    JPEG: SOF (largura/altura) + EXIF (orientação, FocalLengthIn35mmFilm). PNG: IHDR. WebP: VP8/VP8X.
//    Formato sem cabeçalho reconhecido: <img> + naturalWidth/Height no onload (decodificação preguiçosa).
// 2) Uma decodificação só:
async function decodifica(blob, { w, h }, maxPx = 12e6) {      // w,h já na orientação final
  const s = Math.min(1, Math.sqrt(maxPx / (w * h)), 4096 / Math.max(w, h));
  const opts = { imageOrientation: "from-image" };
  if (s < 1) Object.assign(opts, { resizeWidth: Math.round(w * s), resizeHeight: Math.round(h * s), resizeQuality: "high" });
  try {
    const b = await createImageBitmap(blob, opts);
    // conferir b.width/b.height contra o esperado: a ordem orientação × resize é testada por navegador
    return b;
  } catch (e) { /* cai pro <img> + drawImage num canvas já reduzido */ }
}
// 3) drawImage num canvas ≤ 12 MP → bitmap.close() ANTES do getImageData → getImageData UMA vez
//    → canvas.width = canvas.height = 0
```

**Teto de 12 MP e 4096 px no lado maior:**
- O canvas do iOS vai até 16.777.216 px, e o total de memória de canvas fica em ~224–384 MB.
- O iPhone 15 em diante fotografa em 24 MP (5712×4284).
- Numa foto de 12 MP com a carta em ~70% da altura, a carta tem ~2.000 px de largura (~32 px/mm), e uma borda de 2,5 mm tem ~80 px: **0,31 pt por px** numa linha, antes do sub-pixel.
- Com `navigator.deviceMemory ≤ 2` (só o Chrome expõe), o teto cai pra 8 MP.
- **Melhoria da F1b (opcional):** depois do Ângulo, decodificar só o **retângulo da carta** em resolução nativa, com `createImageBitmap(blob, sx, sy, sw, sh, {...})`. Uma foto de 24 MP fica com ~12 MP úteis sem redução (√2 a mais de px/mm). Só entra se o harness confirmar a ordem recorte × orientação nos 3 navegadores.

**HEIC:**
- No iOS, o input com `accept="image/*"` converte pra JPEG sozinho.
- No Mac, só o Safari decodifica.
- O Chrome e o Firefox (desktop **e Android**) não decodificam. A galeria da Samsung pode entregar `.heic`.
- Um erro de decodificação com `type` `image/heic`/`heif` (ou essa extensão) mostra a mensagem da plataforma (§5.7).
- **Não** embarcar libheif (> 1 MB de wasm).

**Memória por lado ativo:**

| Item | Tamanho |
|---|---|
| RGBA de 12 MP | 48 MB |
| mips | ~16 MB |
| canvas de tela (DPR ≤ 2–3) | ~1–2 MP |
| lupa | 160×160×DPR |
| **pico transitório na decodificação** | bitmap (48) + canvas (48) + ImageData (48) ≈ **144 MB por ~1 s**, sem o bitmap cheio de 98–195 MB que a versão anterior criava |

O lado inativo guarda só o `Blob` comprimido e os números. Voltar a editá-lo redecodifica (~0,3 s). Trocar de foto fecha os `ImageBitmap` (`.close()`) e solta o buffer.

### 6.4 Geometria

**Homografia.** `H` leva o quadrado unitário (u,v) ∈ [0,1]² aos cantos TL, TR, BR e BL na foto. Usa a forma fechada de Heckbert (1989), sem sistema linear. O DLT 8×8 só existe no teste, pra conferir (diferença medida de 2,3e-13 px).

```js
function squareToQuad([[x0,y0],[x1,y1],[x2,y2],[x3,y3]]) {
  const sx = x0-x1+x2-x3, sy = y0-y1+y2-y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return afim(...);
  const dx1 = x1-x2, dx2 = x3-x2, dy1 = y1-y2, dy2 = y3-y2, den = dx1*dy2 - dx2*dy1;
  const g = (sx*dy2 - dx2*sy)/den, h = (dx1*sy - sx*dy1)/den;
  return [x1-x0+g*x1, x3-x0+h*x3, x0,  y1-y0+g*y1, y3-y0+h*y3, y0,  g, h, 1];
}
const aplica = (m,u,v) => { const w = m[6]*u+m[7]*v+m[8]; return [(m[0]*u+m[1]*v+m[2])/w, (m[3]*u+m[4]*v+m[5])/w]; };
// inversa por adjunta/determinante: foto → (u,v), pra converter toque e pra desenhar
```

**Validação do quadrilátero, a cada movimento de canto ou aresta:**
- os produtos vetoriais das 4 arestas têm o mesmo sinal: convexo, e na ordem TL→TR→BR→BL;
- `min(1, 1+g, 1+h, 1+g+h) > ε`, com ε ≈ 0,15. Como `w = g·u + h·v + 1` é afim, o mínimo no quadrado cai num canto. Isso garante que `w` não cruza zero (numa "gravata" `w` vai a −0,98; com um canto côncavo, a −7,2) e limita perspectiva extrema.

Um arrasto que violaria a regra **trava no último estado válido**.

**Convenção de pixel:** o centro do pixel k fica em **k + 0,5**. Na amostragem bilinear, `x -= .5; y -= .5` antes de interpolar. O protótipo errava 0,7 px em todo canto sem isso; corrigido, o erro caiu pra 0,1 px. Tem teste próprio (§10.1).

**A proporção da carta não muda o resultado.**
- Trocar o retângulo de destino só escala os eixos: `H' = diag(W, H, 1)·H`. Com isso, `L/(L+R)` e `T/(T+B)` ficam **idênticos**.
- Daí que **não é preciso saber** se a carta é 63×88 (Pokémon, Magic, One Piece atual, Lorcana, Digimon) ou 59×86 (Yu-Gi-Oh!, Carddass Bandai e, provavelmente, o One Piece de 1999 do exemplo).
- O preset serve pra desenhar sem esticar, pra converter em mm e **pra giro e inclinação**. Vem do `?game=` ou da sessão, e há um "personalizado".

**Giro e inclinação no espaço métrico.** As linhas vivem em (u,v) normalizado. Um giro θ aplicado direto ali vira cisalhamento: com proporção 0,716, as verticais girariam 0,716θ e as horizontais 1,397θ. Por isso giro e inclinação são calculados em (u·W, v·H) e convertidos de volta pra (u,v).

**Pose da câmera e ângulo da foto (F1a).**
- Da `H` e de um `K` a priori (focal do EXIF `FocalLengthIn35mmFilm`; sem ela, 26 mm-eq; ponto principal no centro), decompõe-se a rotação (Zhang).
- Mostra-se o ângulo entre o eixo da câmera e a normal da carta.
- Isso alimenta o aviso de ângulo e o `σ_paralaxe` (§6.8) na F1a, e a compensação da espessura na F2.
- Sem EXIF, ou com dimensões que não batem com o EXIF (imagem colada ou recortada), o ponto principal é desconhecido: "ângulo desconhecido", e `σ_paralaxe` pelo pior caso de 20°.
- Na F2, a proporção estimada também vira **sanidade**, nunca porta (§6.6).

**Linhas no espaço endireitado:**
- Externas (corte) e internas (moldura) em cada lado.
- **Verticais:** `u(v) = c + k·(v − ½)`. **Horizontais:** `v(u) = c + k·(u − ½)`. `c` é a posição no meio do lado e `k` a inclinação.
- Na F1a as externas nascem na borda do quadrilátero e são ajustáveis à mão. Na F1b passam a ser **medidas** pelo ímã de corte, no espaço endireitado. Isso reduz de 4× a 9× a sensibilidade a erro de canto (§6.8).

**Margens e razões:**

```
mL(v) = uIntL(v) − uExtL(v)     mR(v) = uExtR(v) − uIntR(v)
mT(u) = vIntT(u) − vExtT(u)     mB(u) = vExtB(u) − vIntB(u)
LR(v) = 100 · mL(v) / (mL(v) + mR(v))     TB(u) = idem
meio  = LR(½)                      // = média ao longo do lado (m é linear)
pior  = o mais desequilibrado entre LR(0,15) e LR(0,85)   // T_PONTAS = [0.15, 0.85]
```

- `LR(v)` é razão de funções lineares, portanto monótona em v, e o extremo fica nas pontas.
- As pontas param em 0,15 e 0,85 porque a moldura impressa também tem canto arredondado e porque é ali que termina a faixa ajustada da moldura. Fora dela, a incerteza da inclinação dobra (fator 1,96 em t = 0,15 contra 2,18 em t = 0,10, numa reta de 41 pontos).
- A regra de quando o pior decide está na §4.6.

### 6.5 Estimador de aresta, refino do corte, ímã e sugestão das linhas (F1b)

**Estimador sub-pixel.** O desenho anterior (perfil bilinear a 0,5 px, gradiente por diferença central, pico + parábola, em sRGB) tem dois vieses medidos em simulação:
- **Travamento de fase:** o pico gruda nos centros de pixel. O viés oscila de −0,25 a +0,22 px, em dente de serra, conforme a fase sub-pixel da aresta, e há um platô quando a aresta cai na fronteira entre pixels. Em foto de frente, "Foto já reta", print de anúncio e scanner, todos os perfis têm a mesma fase, então o erro fica sistemático e não se anula entre esquerda e direita.
- **Gama:** em sRGB, com borrão, o pico anda pro lado escuro (−0,64 a −1,83 px com σ de 0,8 a 3 px).

O estimador da v2:

```
perfis ao longo da LINHA/COLUNA NATIVA mais próxima da normal (a aresta fica a < 45° do eixo),
  sem interpolar; a posição achada é projetada na normal (método da borda inclinada)
L(k) = LUT_sRGB→linear[c(k)] por canal                        // 256 entradas
D(k+½) = ‖L(k+1) − L(k)‖                                       // diferença discreta nativa, vetor RGB
pico   = máximo de D mais perto da reta da pessoa, com força ≥ 40% do máximo da janela
aresta = Σ (k+½)·D'(k+½) / Σ D'(k+½), numa janela de ±3σ_borrão em volta do pico,
         com D' = max(0, D − nível do fundo)                    // centroide; os lóbulos do sharpening ficam fora
```

Na simulação, o pior caso desse estimador foi de 0,016/0,024/0,036 px com σ de 0,6/1/1,5 px, contra 0,35–0,79 px do centroide em sRGB. A alternativa, se o corpus pedir, é ajustar uma ESF (erf) por Gauss-Newton.

**Refino do corte (passo Ângulo, ao soltar um canto ou uma aresta):**

```
para cada lado A→B, com normal n apontando pra fora; 48 posições t ∈ [0,12; 0,88]:
  aresta(t) pelo estimador acima, numa janela de ±S (S = 12 px de TELA em px da foto)
reta = RANSAC(2 pontos, tolerância 0,8 px, 150 iterações, semente FIXA, PRNG xorshift)
       → mínimos quadrados totais nos inliers (com covariância de posição e inclinação)
cantos = interseção das retas vizinhas; repete com S = 6 px
```

- Nos caminhos de decisão (limiar de inlier, escolha de pico) só entram `+ − × /` e `sqrt`. As transcendentes do JS não são de arredondamento correto e podem mudar a decisão de um navegador pro outro.
- No protótipo, com cantos iniciais errados em até ±1,2% da foto (1500×2000), o erro de canto final foi de 0,11 px de média (p95 0,21). O reflexo saturado sobre a borda não teve efeito (0,02 pp): o RANSAC descarta. Esses números são do estimador antigo, num gerador sem fase fixa, e são remedidos com o novo na bancada.

**Sugestão das linhas ao endireitar** (estágio D do protótipo):
- 41 perfis por lado, em t ∈ [0,15; 0,85], com d de −3% a +16% pra dentro, lidos **na foto** (linha/coluna nativa via H).
- **Externa** = pico do corte perto de d = 0.
- **Interna** = primeiro pico pra dentro com força ≥ 35–50% do máximo e a pelo menos 6 px da externa.
- Refino perfil a perfil numa janela de ±4 px, e RANSAC ajusta a reta **com inclinação**.
- Sem pico confiável, a moldura começa a 4,5% pra dentro, com o aviso "confira esta borda".

**Ímã ao soltar uma linha:**
- Janela e candidatos pelo tipo de linha, como na §5.5.
- Soma de D nos 41 perfis; candidatos = picos ≥ 40% do máximo da janela.
- Refino por perfil + RANSAC (herda a inclinação).
- Custo abaixo de 3 ms. Roda no `pointerup`, nunca no `pointermove`.

**Determinismo.** A promessa é "mesma foto, **mesmo navegador**, mesmo número":
- Os pixels de entrada mudam entre motores: o decodificador JPEG e a gestão de cor são outros, e o filtro do `resizeQuality` não é especificado (o Firefox só o respeita a partir da versão 149).
- O harness compara Chrome, Safari e Firefox com tolerância de |Δ| ≤ 0,1 pt, não bit a bit.

### 6.6 Detecção automática (F2)

Três estágios, todos do protótipo:

1. **Grosso** (~30–50 ms no desktop):
   - reduz a imagem a 480 px (média em caixa);
   - Sobel por canal, ficando com o canal de maior |∇|;
   - limiar = percentil 90;
   - Hough (ρ, θ) votando só em θ ≈ direção do gradiente ±6° (~15× menos votos);
   - NMS e as 16 retas mais fortes, separadas em famílias ~verticais e ~horizontais;
   - pra cada par×par: quadrilátero convexo (validação da §6.4), área ≥ 12%, razão de lados 0,5–0,92, suporte do perímetro ≥ 0,5 em **todos** os lados;
   - ficam os 8 melhores (top-8).
2. **Rotulagem por lado** (o estágio que decide):
   - pra cada candidato, 31 perfis por lado, com **perfil mediano** por canal;
   - arestas e "faixas" uniformes entre elas;
   - escolha conjunta: a faixa da **mesma cor nos 4 lados** e **a mais de fora**.
   - A moldura colorida por dentro da borda também é uniforme e igual nos 4 lados; a cor empata e a posição desempata. Toploader, sleeve e slab aparecem como faixas **por fora**.
   - Foi a regra "mais de fora" que zerou as respostas erradas com confiança no protótipo. Sem ela, 2 em 20 erraram por 11–15 pp, pegando a moldura como corte.
   - A lista de faixas por lado vira o botão **"Próxima borda"**.
3. **Refino:** o mesmo da §6.5.

**Porta de confiança.** O automático só abre direto as Bordas se **tudo** abaixo for verdade:
- os 4 lados foram rotulados;
- inliers ≥ 70% em cada reta;
- borda mais fina ≥ 12 px na fonte.

**A proporção é sanidade, não porta.** Ela não separa a carta de um sleeve: o sleeve padrão (66,7×92,1 mm) dá 0,724 contra 0,716 da carta (1,2%), e o perfect fit (~64×89) dá ~0,719 (0,5%).
- A lista positiva tem **só cartas** (63×88, 59×86, personalizado).
- Sleeve, perfect fit e toploader (3×4 in = 0,75) entram como **classes negativas**: se existir uma faixa interna com proporção de carta, ela vence.
- Usa a focal do EXIF (ou 26 mm-eq) quando o `f²` de Zhang–He sai ≤ 0 ou mal condicionado, o que acontece com a carta quase de frente.
- Fica desligada sem EXIF ou com dimensões que não batem com o EXIF (imagem colada ou recortada).

**Confirmação de um toque.** Mesmo passando na porta, o automático abre as Bordas com a faixa "Cantos achados automaticamente", e o número aparece marcado "auto · confira" até a pessoa tocar em "Cantos certos" ou ajustar qualquer coisa.

Se não passar, abre o Ângulo com o melhor candidato já posicionado, ou com o quadrilátero padrão a 8% e "Não achei a carta: arraste os cantos".

**Medido no protótipo** (sintético, 1200×1600, 20 fotos por cenário):

| Cenário | Resultado |
|---|---|
| fundo limpo | 20/20 |
| objetos no fundo | 18/20 + 2 "não achei" |
| objetos e toploader | 19/20 + 1 "não achei" |
| objetos e reflexo | 20/20 |

**0 respostas erradas com confiança em 80.** Pela regra de três, isso só garante uma taxa de até ~3,7% (IC95%). Tempo: mediana de 40–80 ms e máximo de 166 ms no node desktop.

**Limite honesto.** Foto sintética não tem JPEG, retícula, lasca branca, textura holo, sleeve de verdade nem, até esta revisão, espessura. Esses números são o **teto** do algoritmo. A F2 só entra se o corpus real (§10.3) confirmar.

**Compensação da espessura (F2).** Pela pose (§6.4), calcula-se pra cada lado de corte a largura projetada da parede da carta e desloca-se a reta de corte pra dentro, ou soma-se essa largura ao `σ_paralaxe` quando não dá pra saber se o detector pegou a face ou a parede. Só passa a reduzir o "±" depois de validada no corpus, com o erro reportado com sinal por lado próximo e lado distante.

**Avisos que vêm junto na F2:**
- **Reflexo:** > 30% de um lado com pixel saturado ≥ 250 nos 3 canais → "reflexo na borda X: incline um pouco a carta".
- **Fundo sem contraste:** contraste do corte < ~15 → aviso de fundo, e o corte vai pro manual.
- **Lente:** flecha de alguma aresta de corte > 0,6% do lado ou > 1,5 px → "lente curvando a borda: afaste o celular, use 2×, centralize a carta".

**Métrica implícita de erro** (no lugar do "Give feedback" do concorrente): o evento `centering` leva `ajusteAuto`, o maior |Δ| em pp entre a linha automática e a final. Nunca leva foto nem coordenada.

### 6.7 Desenho, zoom e lupa

**Palco** = `<canvas>` (imagem) + `<svg>` (linhas e faixas) + alças HTML (`<div role="slider" tabindex="0">`, 44×44).
- O canvas usa o tamanho CSS × DPR, com DPR limitado a 3. O do concorrente não escala e fica borrado.
- **Passo Ângulo:** desenha a foto (`drawImage` do mip adequado) com a transformação da vista.
- **Passo Bordas:** achata em software, por amostragem inversa, só a **área visível**.

```js
for (j…) { X = a*u0+b*v+c; Y = d*u0+e*v+f; Z = g*u0+h*v+1;
  for (i…) { out[i,j] = bilinear(mip, X/Z, Y/Z); X += a*du; Y += d*du; Z += g*du; } }   // 1 divisão por px
```

- O mip é escolhido pra dar ~1–2 px de fonte por px de tela. No zoom alto, a amostragem lê a fonte cheia.
- O achatamento é **só desenho**. A medição usa os perfis nativos da §6.5.
- Custo medido no protótipo: 1000×1397 px em 22 ms no node; estimado em 80–150 ms no celular.
- **Durante a pinça ou o pan:** só transformação CSS 2D (translate/scale) no canvas e no SVG. É rápido e fica borrado por um instante. **Ao terminar** (120 ms sem gesto), redesenha nítido.
- O SVG é exato porque, dentro de um passo, o espaço do palco só sofre escala e translação.

**Por que não `matrix3d` num `<img>`** (proposta de uma das pesquisas):
- os navegadores rasterizam a camada 3D numa escala própria e borram no zoom, problema conhecido no Safari;
- o alinhamento entre o `<img>` transformado e o SVG fica por conta do compositor;
- não dá pra testar no node;
- a imagem cheia continuaria decodificada na GPU.

O caminho em software é determinístico e testável.

**Por que não WebGL:** ~1,5 KB gz a mais, perda de contexto e mais memória no iOS, só pra ganhar no "achatar ao vivo", que não é necessário. Pode virar F-depois.

**Lupa:** canvas próprio de 132 px (celular) ou 300 px (PC) × DPR. Cada pixel vira (u,v), passa por H e é amostrado na **fonte cheia**: ~25 mil amostras, menos de 1 ms por quadro.

### 6.8 Precisão e orçamento de erro

**Sensibilidade.** Com `p = 100·a/(a+b)`:
- mover **uma** linha 1 px muda p em `100·b/(a+b)²` ≈ **25/w pp por px**, com w = largura da borda em px;
- deslocar o miolo inteiro 1 px muda ≈ 50/w.

| Situação | Borda w (px) | pp por px numa linha |
|---|---|---|
| imagem achatada do concorrente (~513 px de largura) | ~20 | **~1,25** |
| foto de anúncio de 1600 px | 45–50 | 0,5–0,55 |
| foto de 12 MP, carta em 70% da altura (nosso teto) | ~80–95 | 0,26–0,31 |
| 24 MP ou carta enchendo o quadro | ~150 | 0,17 |

**Perspectiva sem correção** (carta 50/50 simulada, girada fora do plano):

| Distância | 5° | 10° | 15° | 20° |
|---|---|---|---|---|
| 15 cm | 51,7/48,3 | 53,5/46,5 | 55,2/44,8 | 56,8/43,2 |
| 25 cm | 51,0/49,0 | 52,1/47,9 | 53,1/46,9 | 54,1/45,9 |

No protótipo, medir na foto sem homografia (o melhor que a v1 permite) errou **5–6,8 pp de média e até 14,3 pp**. Com a homografia e o refino, o erro caiu pra **0,02–0,03 pp de média e 0,074 pp no máximo** a 1500×2000, **num gerador sem espessura** (ver abaixo).

**Espessura da carta (paralaxe), o termo que o protótipo não via.**
- A carta tem ~0,3 mm. Com a câmera inclinada além da borda de um lado, ela enxerga a **parede** daquele lado.
- A aresta de corte detectada (parede contra fundo) fica deslocada pra fora **só do lado mais perto da câmera**. A homografia é do plano da face e não corrige isso.
- Carta 50/50 com bordas de 2,5 mm:

| Ângulo | 15 cm | 25 cm | 40 cm | limite ortográfico |
|---|---|---|---|---|
| 10° | ~50,0 | ~50,15 | ~50,3 | ~50,5 |
| 15° | — | ~50,4 | — | — |
| 20° | 50,42 | 50,68 | 50,83 | 51,07 |

- No Yu-Gi-Oh!, com bordas de 1,9 mm, 25 cm e 20° leem ~50,9.
- O viés é **sistemático**: sempre do lado próximo, então não some no p90.
- Afastar e usar 2× piora o viés, porque a projeção fica mais ortográfica. A dica de foto passa a ser "**de frente**, carta grande no quadro; se precisar afastar, mais de frente ainda".

**Orçamento de erro na foto real:**

| Fonte de erro | Tamanho | Observação |
|---|---|---|
| Localização da aresta com ímã (estimador da §6.5) | ≤ 0,05 px → ≤ 0,02 pt | com o pico+parábola em sRGB eram até 0,25 px de viés de fase |
| Definição da aresta (retícula, sangria, bisel, lasca) | ~0,5–1 px | cancela em 1ª ordem, porque os dois lados têm o mesmo tipo de aresta; sobra ~0,1–0,2 pt |
| Erro de canto → perspectiva residual | σ 1 / 3 / 6 px → 0,15 / 0,32 / 0,56 pt | **medindo a linha externa**. Sem medir a externa (F1a): σ 1 → 0,57; σ 3 → 2,9 pt |
| Distorção de lente (k1 = ±0,03, forte) | 0,12–0,16 pt de média, máx 0,6 | — |
| **Espessura (paralaxe)** | ≤ 0,15–0,3 pt até 10°; 0,4–0,9 pt a 20° | sistemático, do lado próximo; F1a: aviso + `σ_paralaxe`; F2: compensação |
| Manual sem ímã, com lupa | max(0,5 px de tela → px da foto; 0,3·σ_borrão) | não se localiza uma aresta borrada melhor que ~0,3σ, mesmo com 6 px de tela por px |

**Meta:** ≤ 0,5 pt no p90 contra o scanner de mesa (§10.3), de frente e até ~10°.

**Incerteza exibida (σ_total):**

```
σ_total² = σ_ajuste(t)² + σ_canto² + σ_lente² + σ_paralaxe² + σ_piso²

σ_ajuste(t)  pela covariância completa de cada reta (posição E inclinação), avaliada no t em
             que o número é lido; n efetivo = n / fator de correlação entre perfis vizinhos
             (borrão + sobreposição); manual sem ímã: σ_reta da linha acima
σ_canto      Jacobiano numérico de p em relação aos 8 números dos cantos × σ de cada canto
σ_lente      pela flecha das arestas (F2); antes disso, 0
σ_paralaxe   pela pose estimada (§6.4) e pela tabela acima; sem pose, o pior caso de 20°
σ_piso       calibrado pelo p90 do corpus; começa em 0,2 pt
propagação pra p: 100/(a+b)² · √( b²·(σextA² + σintA²) + a²·(σextB² + σintB²) ), a e b nas mesmas unidades
```

Sem os termos sistemáticos, a fórmula antiga daria ±0,09 pt numa foto de 12 MP, e a tela mostraria "±0,1" pra um erro real de ~0,5 pt.

**Resolução mínima** (pela borda mais fina, em px da fonte):

| Borda mais fina | O que acontece |
|---|---|
| ≥ 12 px | normal |
| 6 a 12 px | aviso "foto pequena: ±X pt — chegue mais perto ou use o zoom 2×"; número exibido inteiro (a nota continua pela 1 casa). No protótipo, bordas de 6–7 px a 600×800 erraram 1 e 6,9 pp. |
| < 6 px | só manual, com o aviso |

### 6.9 Desempenho

O celular foi estimado em 3–6× o node desktop. Tudo roda na thread principal, em fatias, com `await` entre os estágios.

| Etapa | Node desktop | Celular médio (estimado) |
|---|---|---|
| Ler o cabeçalho (SOF/EXIF) | < 1 ms | < 5 ms |
| Decodificar JPEG de 12 MP (nativo, uma vez) | — | 150–300 ms |
| `getImageData` de 12 MP | — | 40–120 ms |
| Refino do corte, sugestão das linhas | 5–30 ms | 30–150 ms |
| Achatar a área visível (~1–1,4 MP) | 22 ms | 80–150 ms |
| Ímã / lupa por quadro | < 3 ms / < 1 ms | < 10 ms / < 3 ms |
| Detecção automática (F2) | 40–80 ms (máx 166) | 150–400 ms |
| **Da foto ao resultado** | | **~0,5–1 s** |

Worker com OffscreenCanvas (Safari 16.4+) fica pra depois, se o corpus mostrar celular lento. Pela CSP (`worker-src 'self'`), o worker teria de ser um arquivo, não `blob:`.

### 6.10 Distorção de lente

Os celulares corrigem a câmera principal no processamento, e o efeito é quase simétrico com a carta centrada no quadro.
- **F2:** aviso pela flecha das arestas (§6.6) e dicas fixas ("carta no centro; evite a ultra-wide 0,5×").
- **Depois, só se o corpus pedir:** modelo de divisão com 1 parâmetro (Fitzgibbon), com λ achado por seção áurea endireitando as 4 arestas. São ~1 KB, aplicados nos perfis antes da H.

---

## 7. Menu Tools e a página `/tools/centering`

### 7.1 O cabeçalho hoje

Três regimes, todos montados por `initPageNav` (`src/shared.js:3042-3198`):

| Largura | O que existe |
|---|---|
| > 860 px | `.page-nav` no `nav.innerHTML` (`:3134-3141`): Início · Jogos · Explorar · Decks · Blog, e, logado, Coleção (mega) · Portfólio |
| 701–860 px | o hambúrguer move o `.page-nav` pro `.nav-drawer`, e o dropdown vira bloco estático (`initMobileMenu` `:3403-3450`; CSS `styles.css:3875-3931`) |
| ≤ 700 px | **não há menu de topo** (`.menu-toggle{display:none}`, `styles.css:7172`). Só a tabbar (`:3326-3379`; 6 abas logado, **3 deslogado: Jogos · Busca · Decks**) e o botão de perfil, que leva a `account.html` |

### 7.2 O item "Tools" (desktop e drawer)

Entra **exatamente entre Decks e Blog**: depois de `${link("decks", …)}` e antes de `${link("blog", …)}` (`src/shared.js:3137-3138`). Segue o molde do `collectionMega` (`:3119-3128`). O hover e o foco já são tratados genericamente em `:3174-3185`, só pra ponteiro fino.

```js
<div class="nav-group nav-group-hover"><a href="tools/centering"${active === "centering" ? ' class="active"' : ""} aria-haspopup="true" aria-expanded="false">${escapeHtml(t("nav.tools"))}<span class="nav-caret" aria-hidden="true">▾</span></a><div class="nav-dropdown" hidden>${link("tools/centering", "nav.centering", "centering")}</div></div>
```

- **Custo medido:** **+45 B gz** (esbuild `--minify --charset=utf8` + gzip -9, como no CI): de 84.737 pra 84.782.
- **O clique em "Tools" vai direto à ferramenta** enquanto ela for a única. No toque (drawer de 701–860 px, iPad deitado) o toque navega direto (`:3176`), então é um toque só até a ferramenta. Quando chegar a 2ª ferramenta, o `href` passa a ser `tools` e nasce o `tools.html`.
- **Ponte do hover:** a faixa invisível que cobre o vão de 10 px entre o item e o painel só existe pra `.nav-mega` (`styles.css:8648-8659`). Sem ela, o `mouseleave` fecha o menu no meio do caminho. O timer de 160 ms do JS só mitiga.
  - O seletor é generalizado de `.nav-mega::before` pra `.nav-group-hover > .nav-dropdown::before`, o que cobre o mega e o Tools.
  - Custo ~0–10 B no CSS núcleo, que tem ~1,9 KB de folga.
  - Não se usa `.nav-mega` no Tools: viria junto o grid de 3 colunas e o painel centralizado, largo e vazio pra um item só.
- **`href` relativos** funcionam em todas as páginas. As que respondem em caminho fundo têm `<base href="/">`.
- **Sem selo "novo"** no menu: custa bytes e data. A novidade vai no changelog.
- **O `▾`** é o mesmo `.nav-caret` (texto, `aria-hidden`) que o menu da Coleção já usa. Segue o precedente do cabeçalho em vez de introduzir um SVG só pra esse item.
- **Alternativa descartada:** o `group()` de clique (`:3091-3097`, hoje sem uso, +32 B). Sem hover, o painel pede um clique a mais no desktop.

**Risco de largura.** Logado, o menu passa a ter 8 itens no grid `1fr auto 1fr` (`styles.css:554-560`). Conferir renderizando em **861, 1024, 1280 e 1440 px**, logado e deslogado, em pt, en e es. Conferir também o trajeto do mouse até o painel em 861 e 1024 px.

### 7.3 Celular (≤ 700 px)

O menu de topo não existe ali, e a tabbar logada está cheia. As entradas são:

1. **Página Busca** (`search.html`, aba pública da tabbar, logado e deslogado, que já hospeda o scanner). Um `<a class="dash-link" href="tools/centering">` estático, com ícone SVG inline e os textos `nav.centering` + `dash.ctrHint`, entre o `.page-head` e o `#searchPage` (`search.html:62-68`). A posição final é decidida renderizando. **0 B** no `shared.js` e 0 B de CSS (`.dash-link` é núcleo). **É a entrada principal no celular.**
2. **Página Perfil** (`account.html`, aberta a todos pelo botão de perfil do header). O mesmo bloco estático "Tools", **antes** do `.account-actions` (`account.html:66`). Logado, aquele é um menu sempre aberto de ~13 itens terminando em "Sair", e depois dele ninguém acha nada. **0 B.**
3. **Hub** (só logado): o item `action:"centering"` vira `{ href: "tools/centering", icon: "centering", key: "nav.centering", stat: t("dash.ctrHint") }`, e sai o handler (`src/dashboard.js:370-375`, `:386-389`). Continua com 10 itens, então a grade `.dash-links` não muda.
4. **Landing** (`index.html`, `.lp-features` em `:188`, área `landing` com prefixo `lp-`): um cartão "Centering Tool" pra quem chega sem conta. 0 B no núcleo.
5. **Atalho do PWA:** o Chrome Android **só mostra os 3 primeiros** atalhos do manifest, e o iOS não mostra nenhum. Hoje são 3 (Coleção, Explorar, Wishlist). Uma 4ª entrada não aparece. A troca fica pra **pergunta 3**.
6. **F4:** "Medir centralização" no preview da carta (§8).
7. **F5:** modo "Centralização" no scanner (o código mora no `scan.js`, injetado).

**Aba na tabbar.** Logado, a tabbar está cheia (6). Deslogado são só 3 abas, e uma 4ª só pra quem não está logado custaria ~60 B gz (estimativa da pesquisa de navegação, a medir), o que cabe nos ~195 B que sobram depois da F1a. Fica como **pergunta 3**, com os fatos.

### 7.4 Páginas estáticas pré-renderizadas

`/games`, artista e set `-en` não têm JS; usam `cabecalhoEstatico` (`functions/_lib/cabecalho-estatico.js`).
- Acrescentar `["/tools/centering","Tools"]` nas chamadas de `scripts/prerender-catalog.mjs:1018` (vira 3 links) e de `:534`/`:370-374` (vira 4 links).
- O comentário em `cabecalho-estatico.js:31-36` diz que 3 links cabem a partir de 360 px. Com 4, entra a rolagem lateral. **Conferir em 320, 360 e 390 px**; se não couber, fica só no `/games`.
- O teste `tests/cabecalho-estatico.test.mjs:92` conta chamadas, não links, e continua passando.
- `/deck/<slug>` não tem cabeçalho; não se aplica.

### 7.5 A página

**Por que `tools-centering.html` na raiz, e não `tools/centering.html` numa pasta:** todo o build só olha a raiz.
- o `bundle-boot` (`scripts/bundle-boot.mjs:72`) apaga o `game.js`, e uma página em pasta daria 404 nele;
- as guardas 3c, 3d, 6, 7 e 8 do `check.mjs` (`:18`);
- o `buildId` do `hash-assets` (`:291-295`);
- o `check-mobile` (`:67`).

**Por que esse nome, e não `centering.html`:** mantém o namespace `tools-<x>` pras próximas ferramentas, permite uma regra genérica no SW e no `robots.txt` e evita um segundo endereço "bonito" (`/centering`) competindo com o canônico.

**Esqueleto:** copiar `<head>` e header do `faq.html:1-60`, com:
- `<base href="/">` logo depois do charset (como em `sets.html:10`);
- o par theme/game no formato exato de `faq.html:33-34`;
- `<link rel="stylesheet" href="styles.css">` literal (o `split-css.mjs:180-181` sai com erro sem ele);
- canonical e `og:url` em `https://sleevu.app/tools/centering`;
- no `.falha-boot`, "Tentar de novo" com `data-recarrega` (`sets.html:60`);
- JSON-LD `WebApplication` (oferta grátis), **fora** do par theme/game (`tests/marca-json-ld.test.mjs`);
- **nenhum `href="#…"`** e **nenhum `pushState`/`replaceState` com URL relativa** (§5.3, §7.6, armadilha 1).

**Sem Function.** Ela custaria uma execução por visita, e a reescrita do `_redirects` resolve.

**SEO.** O HTML sai em pt (`lang="pt-BR"`) e o i18n roda no cliente.
- **Desde a PR #139, o robô vê o idioma que o HTML declara** (`src/theme.js:110-124`: robô → `lang` do HTML; gente → idioma salvo ou detectado). Só a versão pt de `/tools/centering` entra no índice, e a demanda forte é em inglês (§1.4).
- **Variante em inglês (F3, pergunta 14):** `tools-centering-en.html`, servida em `/tools/centering-en`, no molde do `<set>-en` do `docs/SEO.md`.
  - É igual ao pt, exceto `lang="en"`, canonical e `hreflang` (pt-BR ↔ en, e es se valer).
  - **Sem** `data-idioma-fixo`: quem é gente segue vendo o próprio idioma, e só o robô lê o `lang`.
  - Entra no `STATIC_URLS`, e um teste garante que as duas cópias só diferem nessas linhas.
- **Conteúdo indexável abaixo da ferramenta:**
  - F1a: passo a passo e a fórmula, com exemplo; a tabela de critérios (§4) com fonte e data;
  - F3: "A mudança da PSA em 2025", com a leitura correta da §4.2, e o FAQ completo (10–12 perguntas).

Subpáginas por graduadora (`/tools/centering/psa`) ficam pra depois, se o tráfego pedir.

### 7.6 Checklist arquivo a arquivo (F1a, salvo onde marcado)

| # | Arquivo:linha | O que fazer | Quem pega se esquecer |
|---|---|---|---|
| 1 | `_redirects:8` | `/tools/centering  /tools-centering  200` (molde de `/users/*  /collection  200`; destino sem `.html`, comentário em `:4-5`) e `/tools  /tools/centering  302` (até existir o índice). F3: `/tools/centering-en  /tools-centering-en  200`. | ninguém (404) |
| 2 | `sw.js:113-142` `SHELL_ASSETS` | `"tools-centering.html"`, `"src/centering-graders.js"`, `"src/centering-core.js"`, **`"src/i18n-tools.js"`** (molde `:122`). `"src/centering.js"` já está (`:124`). F2: `"src/centering-detect.js"`, literal. F3: `"tools-centering-en.html"`. Custo no precache na §9.3. | Sem o pacote i18n, o deploy **aborta** em `split-i18n.mjs:142`. O CI não roda o split-i18n, e o `split-i18n` sem `--write` sai na `:72`, antes dessa checagem. Agora quem pega é o teste da linha 33. Sem o resto, falha calada: a página fica sem modo offline. |
| 3 | `sw.js:406-414` `chaveDeNavegacao` e `:422-428` `reservaDaNavegacao` | Regra genérica `/^\/tools\/([a-z-]+)$/` → `/tools-$1.html` (precedente do `/users/`, `:411`). Subir `SHELL_CACHE` de `v268` pra `v269`, com comentário (`:55`). | Calado: o bug "abre a antiga, depois a nova" (v265). |
| 4 | `src/game.js:127` `isNeutralPage` | Acrescentar `centering\|tools-centering` à regex (o último segmento de `/tools/centering` é `centering`); `tools` entra junto com o índice. | Calado: o `stampGame` (`:216-224`) carimba `?game=` na URL compartilhada. |
| 5 | `scripts/lib/css-areas.mjs:67-72` | Área `medidor` (`ctr-`): `paginas: ["tools-centering.html"]` (F3: + `-en`). Tirar `collection.html` e `dashboard.html`; reescrever o comentário. | Guarda 8 do `check.mjs` (`:266-306`) pega classe em JS/HTML carregado direto. **Não pega** script injetado. |
| 6 | `src/i18n-tools.js` (novo) | Molde de `src/i18n-blog.js:1-11`. Casa o regex `^src/i18n(-[a-z]+)?\.js$` (`check.mjs:33`). | Paridade: guardas 3/3b. Pacote usado sem carregar: guarda 7. |
| 7 | `src/i18n.js` | **Entram no núcleo** (perto de `nav.blog`, pt `:905`, en `:2413`, es `:3916`): `nav.tools`, `nav.centering`. Atualizar `dash.ctrHint` (pt 86, en 1595, es 3098) pra "Foto, ângulo e nota PSA, BGS, CGC, SGC e TAG". **Sai** o bloco `ctr.*` (pt 1175-1187, en 2678-2690, es 4181-4193). | guardas 3/3b |
| 8 | `src/shared.js:3137-3138` | O grupo Tools entre Decks e Blog (§7.2), +45 B. | — |
| 9 | `src/shared.js:3869-3873` `analyticsPath` | **Nada na F1a.** Com uma ferramenta só, o segmento `tools` já é o Centering Tool. Muda com a 2ª ferramenta. | — |
| 10 | `src/shared.js:3948-3955` `EVENTOS` + migração nova (**F1b**) | Um nome só, `"centering"` (+4 B), com props `{etapa: "foto"\|"fim"\|"camera-perdida", lados, modo, origem}` e, na F2, `ajusteAuto`. **Sem foto e sem coordenadas.** Migração `supabase/migrations/2026MMDDa_centering_evento.sql` redefinindo `events_guard` com a lista estendida (molde `20260928a_analytics_2_1.sql:52-68`). **Pendente de o Fernando aplicar.** | Calado: o banco descarta nome fora da whitelist. |
| 11 | `src/shared.js:3496` `FOOTER_PAGES` | `"centering"`, e não `"tools-centering"`: o rodapé olha o **último segmento do caminho** (`:3497`), e em `/tools/centering` ele é `centering`. +2 B. `"tools"` entra com o índice. | Calado: a ferramenta fica sem o aviso de projeto independente. O teste da linha 31 pega. |
| 12 | `src/shared.js:2513` `podeRecarregarSozinho` | `if (pageLoadingCount > 0 \|\| document.documentElement.hasAttribute("data-ocupado")) return false;` (+13 B medidos). | Calado: deploy na main com a foto aberta = foto perdida (§5.3). |
| 13 | `src/shared.js:12483` `AUTH_PAGES` | **Não** acrescentar: fora da lista, a página já é pública. Também não entra em `RESCUE_PAGES` (`:12513`). | — |
| 14 | `scripts/check.mjs:317-325` `SEM_VITRINE` | `"tools-centering.html"` (tela de trabalho, PLANO-ADS §14). Pergunta 11. | — |
| 15 | `scripts/check.mjs` | Linha própria, sempre impressa, quando algum `conferido` de `src/centering-graders.js` passar de 180 dias, mais `::warning::` no Actions (§4.8). Não é erro. | — |
| 16 | `scripts/prerender-catalog.mjs:105-109` `STATIC_URLS` | `"/tools/centering"` (F3: `"/tools/centering-en"`). O IndexNow pega pela diferença do sitemap. `/tools` não entra (é redirect). | nada (SEO) |
| 17 | `scripts/prerender-catalog.mjs:370-374, :534, :1018` | Link estático "Tools" → `/tools/centering` (§7.4). | — |
| 18 | `robots.txt` | `Disallow: /tools-` (o duplicado servido pelo arquivo; o prefixo com hífen não pega `/tools/…`). | — |
| 19 | `manifest.json` `shortcuts` | Pela pergunta 3: o Centering Tool **entre os 3 primeiros** (no lugar da Wishlist ou do Explorar) ou nada. Uma 4ª entrada não aparece no Android. | — |
| 20 | `account.html:66` | Bloco "Tools" **antes** do `.account-actions` (§7.3). | — |
| 21 | `search.html:62-68` | Link "Centering Tool" entre o `.page-head` e o `#searchPage` (§7.3). | — |
| 22 | `index.html:188` | Cartão "Centering Tool" na `.lp-features` (classes `lp-`). | — |
| 23 | `src/dashboard.js:370-375, :386-389` | O item vira link; saem o handler e o teste de `window.TCGCentering`. | — |
| 24 | `dashboard.html:169-172`, `collection.html:321-322` | Tirar o `<script src="src/centering.js">` e os comentários. | — |
| 25 | `styles.css:8648-8659` | Ponte do hover generalizada pra `.nav-group-hover > .nav-dropdown::before`, com comentário (§7.2). | — |
| 26 | `_headers:32,37` | **Nada.** `camera=(self)` já está liberada desde o scanner, e a CSP (`img-src blob: data:`, `worker-src 'self'`, `'wasm-unsafe-eval'`) cobre a F1a. | — |
| 27 | `scripts/smoke-pages.mjs:27-34` | `"tools-centering.html"` (manual). | — |
| 28 | `scripts/check-size.mjs` | Teto novo pra `centering-graders + core + centering` somados: **22 KB gz**. Fica em ~18 KB na F1a/F1b e sobe com a F2, conscientemente. Só se o script aceitar a entrada sem refatoração; senão, o número vai na PR. | — |
| 29 | `data/changelog.json` | Entrada `{d, pt, en}` (o schema não tem `es`). | — |
| 30 | `docs/PLANO-UX-2.md:477-484, :996-1000` | Apontar o E1 pra este plano e corrigir "pipeline dos binders reutilizável" (ele reduz pra 900 px e grava no IndexedDB; não serve). | — |
| 31 | `tests/tools-pages.test.mjs` (novo) | Todo `tools*.html` tem `<base href="/">`, canonical em `/tools…`, `data-active-page` e os scripts da §6.1 na ordem. Reprova `pushState(`/`replaceState(` com literal relativo e `href="#` em `tools*.html` e `src/centering*.js`. Confere que `FOOTER_PAGES` contém `"centering"`. | — |
| 32 | `privacy.html` | Se cita o scanner ou o medidor, acrescentar o Centering Tool ("o Sleevu nunca recebe a foto"). | — |
| 33 | `tests/i18n-pacotes-shell.test.mjs` (novo) | Todo `src/i18n-*.js` (fora `.pt/.en/.es`) aparece como literal no `SHELL_ASSETS`, e toda página da raiz com tag `src/i18n*.js` tem a tag exata `<script src="src/theme.js"></script>`. Alternativa equivalente: rodar `split-i18n --write` numa raiz temporária, como o `deploy-referencias` faz com `bundle-boot`/`hash-assets`. | É ele quem pega o que hoje só o deploy pega. |
| 34 | Automáticos | `hash-assets`, `split-i18n` (HTML recursivo), `tests/module-boot-order.test.mjs` (varre `src/*.js`), `check-mobile` 1b. | — |

**Armadilhas desta feature:**
1. **`<base href="/">`** é obrigatório em `tools-centering.html`. Sem ele, `/tools/centering` pede `/tools/src/…` (404), e o `hash-assets` **não pega**, porque resolve pelo arquivo na raiz (`hash-assets.mjs:172-178, 219-226`). Com ele, toda URL relativa resolve na raiz:
   - `pushState(…, "?…")` e `"#…"` levam a barra pra home;
   - âncoras `href="#…"` navegam pra home (o mesmo bug que o skip-link já teve, `src/shared.js:3054-3063`);
   - o link de compartilhar da F3 tem de sair de `location.origin + location.pathname`.

   O teste da linha 31 trava os três casos.
2. **TDZ só com manifest:** nenhuma `const` declarada depois do `boot();` de nível de módulo pode ser lida pelo que o boot chama.
3. **CI × deploy.** O CI não roda `split-i18n`, `bundle-boot` (só `--check`) nem `hash-assets`.
   - O `split-i18n` **sem `--write` sai na `:72`**, antes das três checagens que derrubam o deploy: a tag do `theme.js` (`:121`), "nenhuma página ligada" (`:130`) e o pacote no `SHELL_ASSETS` (`:142`). Simular não serve; quem cobre é o teste da linha 33.
   - O `split-css` sem `--write` também sai antes da checagem do `<link>` (`:170` × `:181`), mas o CI roda `split-css --write`, então essa está coberta.
   - Antes da PR, rodar `node scripts/split-i18n.mjs --write` numa **cópia em LF, fora do repo** (memória do checkout CRLF) e descartar a cópia.
4. **Harness em `scripts/harness/`, nunca em `tests/`.** O `IGNORAR` do `split-i18n` (`:84`) não tem `tests`, e um harness com tag de i18n sem a tag do `theme.js` abortaria o deploy antes do passo que apaga `tests/` (`deploy.yml` 919 → 974).
5. **F4: não carregar o `src/graded-ui.js` na ferramenta.** Ele desenha `.srt-host`, da área `ordenar` (`css-areas.mjs:86`). A guarda 8 reprovaria, e a "correção" levaria o `styles-ordenar.css` pra ferramenta à toa (§8).

---

## 8. Integrações com o resto do site

| Onde | O quê | Fase | Custo no núcleo |
|---|---|---|---|
| **Hub, Busca, Perfil, landing** | Links pra `/tools/centering` (§7.3). Some o modal. | F1a | 0 |
| **Coleção** | Sai o `centering.js` carregado à toa. | F1a | 0 |
| **Preview da carta** (página da carta, Coleção, Explorar, set) | `<a href="tools/centering?game=…&card=…&v=…">Medir centralização</a>` nas ações (`src/shared.js:6577-6611`). Só um link: sem `injectScript`, sem CSS novo no núcleo, uma chave de i18n. | F4 | ~40–60 B, medir; se não couber, só no slab e na Coleção |
| **Ferramenta aberta com `?card=`** | Busca a carta e o preço com `POST /api/collection {jogo:[id]}` (`functions/api/collection.js`, que devolve carta e preço verbatim, com o nó `g`). Mostra miniatura e nome, escolhe o preset pelo jogo, a **categoria pra CGC pela linha** (`categoriaPorLinha`, §4.7) e o bloco **PSA 9 × PSA 10**: `g["10"].s` − `g["9"].s` em USD, convertidos com `convertMoney`/`fmtMoney` do `TCGShared`, na regra do `fillGradedPrice` (`:5853-5910`). O bloco só aparece se os dois preços existem. | F4 | 0 (página própria) |
| **Cobertura do preço** | O nó `g` só existe pra PSA, onde o sync da PPT trouxe (Pokémon, ~3,1 mil cartas). A One Piece Bandai de 1999 do exemplo **não tem**, e o bloco nasce escondido. | F4 | — |
| **Salvar no slab** (só logado) | Vindo de um slab (precisa de `data-graded-gid` no preview: `activeGraded` hoje não tem o `gid`, `src/shared.js:6179, :6460`; o tile manda `data-graded-*` em `src/collection.js:795, :1365, :1388`), grava `ctr: { f:{lr,tb,p}, v?:{…}, d:"AAAA-MM-DD", m:"manual"\|"ima"\|"auto" }` no slab. O bloco graded **sincroniza inteiro** (LWW), então o campo viaja sem custo. **Só números.** A gravação é **direta**, sem o `graded-ui.js` (armadilha 5): uma função pequena no `centering.js` relê a chave `tcg-collector-collection-graded-v1` do disco, mescla só o `ctr` do gid, grava e chama `TCGShared.marcaSuja`. | F4 | ~0–20 B |
| **Carta crua** (o caso principal: medir antes de mandar graduar) | **Sem histórico só local.** O padrão foi fechado nas Pastas e em Meus Decks (`enforceLoginGate`, `src/shared.js:12476-12483`): feature pessoal nasce atrás do login. Com login: uma chave **sincronizada** (`SYNC_KEYS.centering` + uma linha no `mergeData` com o merger LWW existente), ~60–120 B gz, a medir, e entra se couber. Deslogado: o botão vira "**Entrar pra salvar**", guarda os números no `sessionStorage` e volta pelo `tcg-login-return`. Pergunta 8. | F4 | ~60–120 B (sync) |
| **Perfil público** | A medição **não** aparece (`src/shared.js:11785` lista campos fixos). Expor seria decisão do dono. | — | — |
| **Scanner** | Seletor de modo "Identificar \| Centralização" no `scan.js`. Centralização fecha o scanner e abre `/tools/centering` com a câmera. | F5 | 0 |
| **Wishlist / anúncios** | "Medir a foto do anúncio antes de comprar" = colar a imagem (F1a). URL do eBay: F5 (§11). | F1a / F5 | — |
| **Blog** | Post "Centralização: como medir antes de graduar" (pt/en/es, ligando à ferramenta e a "graduar carta pokemon"). **Não passa por PR:** os posts moram no Supabase e são publicados no `/blog-editor` por quem tem o papel de editor (`docs/BLOG.md`). A PR da F3 leva só um rascunho do texto na descrição. | F3 (ação do Fernando/editor) | — |
| **`/comparar`** | Linha da tabela: "Centering Tool grátis, local" (o Collectr não tem). | F3 | — |
| **Novidades** | Changelog em cada fase visível. | F1a–F5 | — |

**Risco do store graded (F4).** O `save()` grava o blob inteiro que está em memória (`src/graded-ui.js:30`), sem cache de instância nem `registerCrossTabStore`. Uma segunda instância na ferramenta, com a Coleção aberta (na mesma aba ou em outra), faria o próximo save de um apagar a medição do outro.

**Saída:** a gravação direta descrita acima (reler → mesclar só o `ctr` do gid → gravar → `marcaSuja`), sem instanciar o store, e um teste em `tests/store-instances.test.mjs` com a Coleção salvando depois da ferramenta e vice-versa.

---

## 9. i18n, acessibilidade e peso

### 9.1 i18n

**Núcleo** (`src/i18n.js`):
- entram `nav.tools` e `nav.centering`;
- muda `dash.ctrHint`;
- saem as 13 `ctr.*` × 3. O saldo é negativo.

**Pacote `src/i18n-tools.js`** (~120 chaves × 3), com os namespaces:

| Namespace | Conteúdo |
|---|---|
| `ctr.entrada.*` | tirar foto, galeria, colar, arrastar, HEIC (por plataforma), câmera perdida, sincronizando, erro |
| `ctr.passo.*` | ângulo, bordas, resultado |
| `ctr.canto.*` | 4 cantos |
| `ctr.lado.*` | 4 lados |
| `ctr.linha.*` | corte, moldura |
| `ctr.ctl.*` | girar 90°, foto já reta, giro da moldura, ímã, zoom, desfazer, refazer, atalhos, tipo pra CGC |
| `ctr.res.*` | L/R, T/B, pior ponto, meio, dentro da incerteza, ±, no limite, folga, falta, não publicado, sem número, lado não especificado, duas leituras, subnota, componente, só frente, medir o verso, ângulo da foto, auto · confira |
| `ctr.aviso.*` | resolução, ângulo, reflexo, lente, sem borda, contraste, foto descartada |
| `ctr.tab.*` | tabela de critérios |
| `ctr.guia.*` e `ctr.faq.*` | guia e FAQ |
| `ctr.aria.*` | textos de acessibilidade |

O vocabulário fixo é o da §5.7. Nomes de graduadora e rótulos de nota (GEM-MT, Pristine, Mint+) ficam literais.

### 9.2 Acessibilidade

- **Alças das linhas:** `role="slider"`, `aria-orientation`, `aria-valuemin/max/now` em px da foto e `aria-valuetext` do tipo "Moldura esquerda, 2,82 milímetros; esquerda/direita 57,5 por 42,5".
- **Cantos:** não existe `role="slider"` 2D. São `<button>` com rótulo ("Canto superior esquerdo") e `aria-describedby` apontando pra dica de teclado; as setas movem.
- **Editor imersivo do celular:** `role="dialog" aria-modal="true"`, com foco preso e o Esc tratado pela pilha de estados.
- **Região `aria-live="polite"`** só com o resumo ("L/R 57,5 por 42,5, T/B 48,5 por 51,5, PSA 9, L/R limita"). Atualiza no fim do arrasto, ou 600 ms depois do último ajuste, nunca a cada pixel.
- **A distinção não depende de cor:** tracejado × sólido, anel × quadrado, "no limite" escrito, e o passo atual em texto com `aria-current="step"`.
- **Ícones:** SVG inline de traço com `currentColor` e `aria-hidden`; nenhum glifo de texto em botão (§5.4).
- **Alvos de 44 px no toque.** Os botões do editor seguem `touch-action: manipulation` (guarda do `check-mobile`), e o palco usa `touch-action: none`. O único campo de texto (busca de carta, F4) tem 16 px.
- **Foco visível** do site.
- **`prefers-reduced-motion`:** zoom guiado sem animação, folha sem mola, lupa sem escala.

### 9.3 Peso

| Peça | Onde viaja | Orçamento |
|---|---|---|
| `shared.js` | todas as páginas | **F1a +60 B gz medidos** (menu 45 + rodapé 2 + guarda de recarga 13): 84.737 → 84.797, sobram **195 B** do teto de 84.992. F1b: +4 B (evento). F4: link no preview ≤ 60 B e sync opcional ≤ 120 B, **medidos antes**. |
| `src/i18n.js` | todas | saldo negativo (−13 chaves, +2) |
| CSS núcleo | todas | **~0–10 B** (só a ponte do hover generalizada; dropdown, `.dash-link`, `.cta`, `.lst-mini` e `.chip` já existem) |
| `styles-medidor.css` (`ctr-*`) | só `/tools/centering` | ≤ 2,5 KB gz. O slider de giro copia o estilo de `.dkc-range-track` com prefixo `ctr-`, porque o original fica na fatia "decks". |
| `centering-graders.js` | só a ferramenta | ≤ 2 KB gz |
| `centering-core.js` | só a ferramenta | ≤ 5 KB gz (F1a+F1b) |
| `centering-detect.js` (F2) | injetado | ≤ 3,5 KB gz |
| `centering.js` | só a ferramenta | ≤ 10 KB gz |
| `i18n-tools.js` | só `/tools*` | ≤ 4 KB gz por idioma depois do split |
| **Total na página da ferramenta** | | **~16–20 KB gz** (OpenCV.js: ~8 MB) |
| **Precache do SW** (todo visitante que instala o SW) | | **+~29 KB gz**: ~17 KB do JS da ferramenta + ~12 KB do `i18n-tools` (o `split-i18n` põe os **três** idiomas no precache, `split-i18n.mjs:132-144`). Sobre um shell de ~345 KB, é ~+8%. **Decisão consciente:** a ferramenta é usada em loja e em evento de cartas, com sinal ruim, e offline desde a instalação vale o custo. Alternativa: precachear só o obrigatório (o pacote i18n, que o `split-i18n` exige) e deixar o JS pro `assetCacheFirst` em runtime (`sw.js:277-281`), aceitando que o offline só funciona depois da 1ª visita. Nesse caso o HTML também fica fora, pra não abrir uma página sem JS. |

**Classes:** tudo novo usa `ctr-` (ferramenta). Nada de `segmented-*` (área `detalhe`), `scan-*` (CSS injetado pelo `scan.js`), `dkc-*`, `srt-*` (área `ordenar`, armadilha 5) ou outras classes de área, que chegariam **sem estilo em produção, sem aviso**.

---

## 10. Testes e validação de precisão

### 10.1 `tests/centering-core.test.mjs` (CI, alvo < 5 s)

Carrega `centering-graders.js` + `centering-core.js` num `vm`, sem DOM.

1. **Homografia:** os 4 cantos saem exatos (< 1e-9); ida e volta com a inversa; forma fechada = DLT 8×8.
2. **Estimador de aresta, sem viés de fase** (F1b): degrau sintético amostrado por área, 8 bits, com gama sRGB. Varre:
   - **fases de 0,0 a 0,9** (passo 0,1), incluindo a fronteira entre pixels;
   - ângulos de 0°, 0,3°, 2° e 10°;
   - σ de borrão de 0,6 a 3 px.

   Exige **|viés| ≤ 0,05 px em todos**. Esse teste pega tanto o bug de 0,7 px da convenção de pixel quanto o travamento de fase do pico+parábola.
3. **Reta robusta:** com ruído e 30% de outliers (reflexo), fica a < 0,2 px; mesma entrada dá mesma saída (semente fixa).
4. **Formatação:**
   - 1 casa decimal e soma 100,0 sempre (`x = round(p·10)/10`; o outro é `100 − x`);
   - vírgula em pt/es, ponto em en;
   - entradas degeneradas da v1 (0/0 → 50/50; negativo → 0/100).
5. **Invariância à proporção:** 63×88 e 59×86 dão a mesma razão. O giro da moldura no espaço métrico dá o mesmo ângulo exibido nos dois presets.
6. **Fim a fim sintético** (gerador em `tests/lib/carta-sintetica.mjs`, sementes fixas, 800×1066, **com espessura de 0,30 mm**):
   - frontal < 0,15 pp;
   - 10° de pitch/yaw < 0,3 pp;
   - 20°: o viés medido bate com a tabela de paralaxe (§6.8) e fica **dentro do σ_total exibido**. Com a compensação da F2, < 0,2 pp;
   - reflexo < 0,2 pp;
   - borda de 1,5 mm → aviso de resolução;
   - full art (sem faixa) → "sem borda";
   - toploader: o refino a partir de cantos a ±1% da carta acha o **corte**, não o plástico.
7. **Ímã** (F1b): uma linha solta a ±8 px da aresta encaixa a < 0,2 px. Sem aresta, fica onde foi solta. Com corte e sleeve na janela de visão geral, não gruda no sleeve.
8. **Pior ponto:** uma moldura girada 0,4° dá pior ≠ meio, e a nota usa o pior (diferença > 2σ). Uma carta 50/50 perfeita, com ruído, **não** é reprovada no Pristine pelo viés do máximo.
9. **Determinismo:** a mesma imagem duas vezes, no mesmo motor, dá resultado idêntico bit a bit.
10. **Tempo:** medir a partir dos cantos leva < 50 ms no node.
11. **F2:** os cenários da §6.6, com sementes fixas e espessura. Em "objetos no fundo", o resultado é **achar ou "não achei", nunca errar mais de 1 pp com confiança**. O sleeve (0,724) é rejeitado como corte quando há faixa interna com proporção de carta.
12. **Quadrilátero:** gravata e côncavo são rejeitados; `w` nunca cruza zero em [0,1]²; o arrasto trava no último estado válido.
13. **Cabeçalho:** SOF e EXIF (orientação 1–8, `FocalLengthIn35mmFilm`) lidos de bytes de fixture, JPEG/PNG/WebP, sem decodificar.
14. **Pose:** um ângulo sintético conhecido (5°, 10°, 20°) é estimado a ±1,5° com a focal certa; sem EXIF, o resultado é "desconhecido".
15. **Decisão × exibição:** com `σ > 0,5` a tela mostra inteiro, mas a nota é a mesma de antes (55,4 nunca vira "55 → PSA 10").

### 10.2 `tests/centering-graders.test.mjs` e testes de registro

- **Estrutura:** toda graduadora tem `fontes` (https), `conferido` (data ISO), `confianca` ∈ {alta, media, baixa} e notas na ordem da escala.
- **Monotonia,** depois da herança do `null`: uma nota maior nunca permite mais, na frente e no verso, em todas as leituras.
- **Casos-âncora** (a regra escrita, executável):
  - **PSA:** 55,0 → 10; 55,1 → 9 · 10 possível pela folga; **60,0 → 9 · 10 possível pela folga**; **60,1 → 9 sem folga pro 10**; 65,0 → 8 · 9 pela folga; **75,0 → 6 · 7 possível pela folga**; 92/8 → 1 ("sem exigência"); 90/10 → 3.
  - **TAG:** 62,5 → 8.5; 62,6 → 8; 98,3 → 1.5; 98,4 → 1.
  - **BGS:**
    - 55/55 com verso 60 → nota **9**, com "9.5 por /grading-standards · 9 por /grading/scale";
    - 50,0 → Pristine "compatível, no limite";
    - verso 96/4 no BGS 5 → 4;
    - **57,9 → "8 (8.5 sem número)"**.
  - **CGC:**
    - TCG 54/46 → 10 Gem Mint;
    - TCG 56/44 → "abaixo de 10, sem número pra TCG";
    - **TCG F = 50,0, V = 80 → "abaixo de 10"** (o verso do 10P herda o 75);
    - TCG 89/11 → 3.5;
    - não-esportiva 58/42 → 9;
    - categoria "depende" a 58/42 → duas leituras ("abaixo de 10 sem número · 9 se non-sports").
  - **SGC:** F 55, V 70 → nota **7.5**, com "10 se o limite valer só pra frente"; F 55 sem verso → 10 com "verso não medido pode baixar".
- **"No limite":** 54,6, 55,4 e 55,6 com σ_total de 0,1 e de 0,4; o 50/50 decide pelo meio.
- **Falta pro próximo:** L/R 58,0 e T/B 57,0 contra 55 → "L/R 3,0 pt + T/B 2,0 pt", e os mm batem com `Δ/100·(mA+mB)`.
- **`tests/sw-navegacao.test.mjs`:** `/tools/centering` → chave `tools-centering.html` (molde do teste de `:103`).
- **`tests/tools-pages.test.mjs`** e **`tests/i18n-pacotes-shell.test.mjs`:** itens 31 e 33 da §7.6.
- **Guarda de recarga:** teste em vm, no molde dos testes que já carregam o `shared.js`. Simula `controllerchange` com `data-ocupado` no `<html>` e espera "não recarrega" (toast persistente).
- **F4:** `tests/store-instances.test.mjs` cobrindo a gravação direta do `ctr` com a Coleção salvando em paralelo.
- **F5:** o compartilhamento de **texto** pro Sleevu continua indo pra busca depois da troca do `share_target`.

### 10.3 Bancada e corpus real (decidem a precisão de verdade)

**Bancada sintética.** `scripts/bench-centering.mjs` (fora do CI) faz Monte Carlo com 200+ fotos por cenário (resolução, inclinação, **espessura**, k1, toploader, objetos, reflexo, **fase sub-pixel**) e imprime média, p95 e máximo. O resultado vai no texto de cada PR que mexer no algoritmo.

**Corpus real.** Fica em `data/.cache/centering-test/`, já no `.gitignore`, o mesmo lugar do `scan-test`. **É o portão da F2** e a verificação pós-merge da F1a/F1b, não o "pronto" da F1a (§11).

- **30–50 cartas:**
  - Pokémon (amarela, prata, holo);
  - Magic de borda preta;
  - One Piece moderno;
  - Yu-Gi-Oh!;
  - **vintage Bandai, incluindo a One Piece de 1999 do exemplo**;
  - versos, sleeve, toploader e slab.
- **Verdade:**
  - scanner de mesa a 600–1200 dpi, sem perspectiva e sem lente;
  - a carta é escaneada **girada 2–5°** (método da borda inclinada), pra fugir da fase fixa;
  - é medida por **duas anotações independentes** e conferida com **um estimador diferente do da ferramenta** (ajuste de ESF/erf). Medir o gabarito com o mesmo ímã esconderia o viés dele;
  - divergência > 0,3 pt → reanotar.
- **Fotos por carta:** 3 de celular (de frente; ~15°; no toploader) e 5 versos. **≥ 150 fotos no total.**
- **Harness:** `scripts/harness/centering.html` via `npx http-server` roda as fotos pelo mesmo `centering-core.js` e exporta CSV. Inclui o **erro com sinal, separado por lado próximo e lado distante** da câmera, e roda em Chrome, Safari e Firefox.
- **Referência cruzada:** passar as mesmas fotos no centeringcheck e anotar os inteiros deles. As divergências ficam documentadas e **não viram meta**.

**Metas:**

| Métrica | Meta |
|---|---|
| \|Δ\| contra o scanner, manual com ímã, de frente e até ~10° | ≤ 0,5 pt p90; ≤ 1 pt máximo |
| Foto a ~15–20° contra o scan da mesma carta | erro com sinal reportado por lado; ≤ 0,5 pt p90 **só depois** da compensação da espessura (F2) |
| Repetibilidade (mesma pessoa, 5 rodadas) | ≤ 0,5 pt |
| Entre navegadores (mesma foto) | \|Δ\| ≤ 0,1 pt |
| `σ_total` exibido × erro real | o erro real cai dentro de ±2σ em ≥ 90% das fotos (calibra o `σ_piso`) |
| Auto (F2): acerto sem tocar em canto | ≥ 85% |
| Auto (F2): resposta errada com confiança | **0 observada em ≥ 150 fotos** (cota ≤ ~2%, IC95%), sempre com a confirmação de um toque |
| Caso do pedido | a foto do One Piece de 1999 em toploader mede até o fim sem gambiarra |

### 10.4 Conferência visual (CLAUDE.md)

- **Servir de um jeito que respeite o `_redirects`.** O `npx http-server` não lê o `_redirects`: `/tools/centering` daria 404, e testando em `/tools-centering.html` os bugs do `<base>` (pushState, âncoras) não aparecem. Usar:
  - um servidor node mínimo (no scratchpad, fora do repo) que aplica as regras do `_redirects` (`/tools/*` → `tools-*.html`, como já se faz pra `/users` e `/blog`); ou
  - o preview da branch no Cloudflare Pages.
- **Renderizar de verdade:**
  - `/tools/centering` em 390 e 1280 px e **844×390 (celular deitado)**, temas claro e escuro, pt/en/es;
  - o menu em 861, 1024, 1280 e 1440 px, logado e deslogado, incluindo o **trajeto do mouse** até o painel;
  - o drawer em 768 px;
  - as estáticas em 320, 360 e 390 px;
  - `account.html` e `search.html` em 390 px;
  - o cartão da landing.
- **Navegação:** F5 em cada passo continua em `/tools/centering`; o voltar do Android recua um passo sem sair; nenhum atalho interno leva pra home.
- **Aparelho real** (pergunta 10, verificação pós-merge e portão da F2):
  - iPhone (Safari): câmera nativa, foto de 24 MP, HEIC da galeria, colar;
  - Android (Chrome): câmera nativa, aba morta pela câmera, `deviceMemory`, HEIC da Samsung.
- **CI local:** `node --test tests/*.test.mjs`, `node scripts/check.mjs`, `node scripts/check-mobile.mjs`, o `check-size` do `shared.js` e do CSS núcleo, e o `split-i18n --write` numa cópia em LF.

---

## 11. Fases de entrega (uma PR cada)

### F1a: Tools + Centering Tool manual

**Escopo:**
- **Navegação:**
  - menu Tools (desktop e drawer, clique direto na ferramenta), `/tools` → 302, `/tools/centering`;
  - entradas no celular (Busca, Perfil antes do menu de conta, Hub, landing), mais o atalho do PWA conforme a pergunta 3;
  - link nas estáticas, ponte do hover, rodapé, guarda de recarga.
- **Entrada:**
  - tirar foto (câmera nativa, com a marca de aba perdida), galeria, colar, arrastar;
  - leitura do cabeçalho e **uma** decodificação; teto de 12 MP;
  - mensagens de HEIC por plataforma.
- **Ângulo:**
  - 4 cantos/retas prolongadas e meios de aresta, com **validação do quadrilátero**;
  - lupa, Girar 90°, Foto já reta, preset de tamanho;
  - **ângulo estimado da foto**.
- **Bordas:**
  - 8 linhas manuais (externas na borda do quadrilátero, internas a 4,5%), giro da moldura (no espaço métrico);
  - lupa, zoom/pan básicos, teclado básico.
- **Resultado:**
  - 1 casa decimal com **σ_total**, meio e pior ponto (regra de 2σ);
  - PSA/BGS/CGC/SGC/TAG pelas regras da §4.6: herança do `null`, intermediárias, duas leituras, categoria pra CGC;
  - no limite, folga da PSA, quanto falta por eixo, frente e verso;
  - avisos de resolução e de ângulo, `sessionStorage`.
- **Conteúdo:** guia curto e tabela de critérios gerada do arquivo, com fonte e data.
- **Dados** em `src/centering-graders.js`.
- **Registros** da §7.6, sem o evento.
- **Limpeza:** v1 removida (modal, scripts no dashboard e na coleção, chaves `ctr.*` do núcleo, área `medidor`).
- **Testes:** §10.1 (1, 3–6, 8–10, 12–15) e §10.2; `i18n-pacotes-shell` e `tools-pages`; bancada sintética com espessura; harness em `scripts/harness/`.

**Pronto quando** (tudo verificável pelo Claude, sem depender de equipamento do Fernando):
- os checks do CI passam, mais o `split-i18n --write` numa cópia em LF;
- a bancada sintética bate as metas da §10.1;
- **a foto do One Piece de 1999** que o Fernando mandou (o arquivo é pedido a ele se não estiver no disco) mede até o fim, com o ângulo exibido;
- a repetibilidade (5 rodadas em 3 imagens) fica ≤ 0,5 pt;
- a renderização foi conferida nos tamanhos da §10.4, servida com o `_redirects` aplicado;
- `shared.js` ≤ +60 B medidos.

**Fica de fora:**
- ímã, refino sub-pixel do corte, sugestão das linhas, modo guiado, desfazer/refazer, régua fina e zoom completo (F1b);
- evento (F1b);
- detecção automática (F2);
- compartilhar, a seção "A mudança da PSA em 2025" e a variante em inglês (F3);
- carta, preço e salvar (F4);
- câmera ao vivo e eBay (F5).
- O corpus com scanner e os aparelhos reais entram na PR como "verificação pós-merge com o Fernando".

### F1b: Ímã, sugestão e conforto

**Escopo:**
- **Ímã** com o estimador da §6.5 (centroide em intensidade linear, linha/coluna nativa), janela em unidades da carta e candidatos por tipo.
- **Refino sub-pixel do corte** no Ângulo.
- **Sugestão das 8 linhas** ao endireitar; inclinação por linha vinda do ímã.
- **Interação:** modo guiado no celular, desfazer/refazer (50 passos), régua fina e −/+, zoom completo (toque duplo, Espaço+arrastar, zoom guiado), teclado completo e `?`.
- **Opcional:** decodificação do retângulo da carta em resolução nativa (§6.3), se o harness confirmar a ordem recorte × orientação nos 3 navegadores.
- **Evento** `centering` (+4 B) + migração. **Pendente de o Fernando aplicar.**
- Testes §10.1 (2 e 7).

**Pronto quando:**
- o CI passa;
- o teste de fase (≤ 0,05 px em todas as fases) passa;
- a bancada mostra o ímã a < 0,2 px;
- a foto do One Piece mede com as linhas sugeridas;
- `shared.js` ≤ +64 B no total.

### F2: Detecção automática

**Escopo:**
- `src/centering-detect.js` (Hough + rotulagem + refino + porta de confiança), injetado quando a foto chega, com "Procurando a carta…", sem bloquear o manual.
- Confirmação de um toque.
- "Próxima borda" (carta × toploader × sleeve).
- Proporção como **sanidade**, com classes negativas, focal a priori e desligada sem EXIF.
- **Compensação da espessura** pela pose.
- Avisos de reflexo, contraste de fundo e lente.
- Métrica implícita `ajusteAuto` no evento.
- Testes §10.1 (11).

**Pronto quando:**
- o corpus inteiro (≥ 30 cartas, ≥ 150 fotos) passa nas metas do automático (≥ 85% de acerto, **0 errado com confiança observado**) e nas metas manuais da §10.3, incluindo a calibração do σ;
- rodar duas vezes dá resultado idêntico;
- os aparelhos reais (iPhone e Android) foram conferidos com o Fernando.

**Fica de fora:** correção de lente, worker.

### F3: Compartilhar sem servidor + conteúdo

**Escopo:**
- **PNG local** (1080×1350): carta endireitada com as 8 linhas, razões, as 5 notas, eixo que limita, "sleevu.app/tools/centering" e data. Reaproveita `baixarCanvasPng(canvas, nome, {share:true})` e `canvasCardHelpers` do `TCGShared` (`src/shared.js:11201-11272`). Web Share com arquivo no celular, download no PC. Opção "Incluir a foto" (pergunta 7).
- **Link só com números:** `location.origin + location.pathname + "#v1;f=57.5,48.5;v=62,51;s=63x88"`. O hash não chega ao servidor e abre um cartão só de leitura com "Medir a minha".
- **Conteúdo:** seção "A mudança da PSA em 2025" (com a leitura da §4.2), FAQ completo, JSON-LD revisado, `/comparar`.
- **Variante indexável em inglês** `/tools/centering-en` (pergunta 14).
- Rascunho do post do blog **na descrição da PR**. A publicação é ação do Fernando ou do editor no `/blog-editor`.
- Testes de codificar e decodificar o hash, incluindo rejeitar lixo.

**Pronto quando:**
- o PNG sai igual no celular e no PC;
- o link abre o cartão em pt/en/es;
- nenhuma requisição leva imagem (conferido na aba de rede);
- as duas cópias do HTML só diferem em `lang`, canonical e hreflang.

**Fica de fora:** link curto no servidor, que **não vai existir**: guardar a imagem fere o veto e a promessa.

### F4: Integração com a carta

**Escopo:**
- "Medir centralização" no preview, medindo o custo antes.
- `?game=&card=&v=`: carta, preset pelo jogo, **categoria pra CGC pela linha** e PSA 9 × 10 com o prêmio de grading.
- **Salvar só com login:** no slab (campo `ctr`, gravação direta da §8) e numa chave sincronizada, se couber (pergunta 8).
- Deslogado: "Entrar pra salvar", com volta pelo `tcg-login-return`.
- Teste do store graded entre instâncias.

**Pronto quando:**
- medir pelo slab grava, sincroniza e sobrevive à Coleção aberta em outra aba;
- uma carta sem `g` não mostra o bloco de preço;
- deslogado não grava nada fora do `sessionStorage`.

**Fica de fora:** expor no perfil público.

### F5: Captura melhor

**Escopo:**
- `src/centering-camera.js`: câmera ao vivo com moldura no formato da carta e **nível** (`deviceorientation`; no iOS, `requestPermission` dentro do toque). Lanterna por capacidade, desligada por padrão, com a dica "reflete no toploader". Auto-disparo com nível ≤ 1° e aparelho parado por 700 ms. `ImageCapture.takePhoto()` onde existir.
- Modo "Centralização" no scanner.
- **`share_target` com arquivo.** O manifest só aceita **um** `share_target`, e hoje ele é `GET /explore` com `{title, text: "q", url}` (`manifest.json:74-82`). Aceitar arquivo **substitui** esse alvo:
  - **um action único** (ex.: `/compartilhar`) em POST multipart, com `params: {title, text, url, files: [{name: "foto", accept: ["image/*"]}]}`;
  - **no SW** (ramo novo em `sw.js:238`, que hoje ignora o que não é GET): com arquivo, guarda em memória e abre `/tools/centering`, que recebe o arquivo por mensagem, sem gravar em disco; sem arquivo, redireciona pra `/explore?q=…`, mantendo o comportamento de hoje;
  - **uma Function mínima no mesmo caminho**, pra quando o SW não estiver no controle (1ª abertura, ou depois do "Limpar cache" do Troubleshooting, que desregistra o SW). Responde 303 pra `/explore?q=` (texto) ou pra `/tools/centering` com o aviso "abra a foto de novo" (arquivo). O Pages não aceita POST em asset estático;
  - teste de que o compartilhamento de texto continua indo pra busca.
- **URL do eBay:**
  - imagem direta → `connect-src https://i.ebayimg.com` no `_headers` (já conferido que ele responde `Access-Control-Allow-Origin: *`); `fetch → blob → objectURL`;
  - URL do anúncio → Function `functions/api/ebay-imagem.js`, que devolve **só a URL** do `og:image`, não os bytes, e o cliente busca direto. **A conferir** se o eBay não bloqueia a Function.

**Pronto quando:** a câmera ao vivo dá resultado tão preciso quanto a nativa no corpus (ou é rebaixada a opção), a aba morta pela câmera nativa no Android deixa de ser problema (medido pelo `etapa: "camera-perdida"`) e o compartilhamento de texto continua funcionando.

### Depois (sem data)

- Correção de lente (Fitzgibbon), se o corpus mostrar erro sistemático.
- Worker/OffscreenCanvas, se algum celular passar de 1,5 s.
- **Comparar cópias:** medir 3 cópias e ranquear qual mandar graduar.
- Subpáginas por graduadora (`/tools/centering/psa`…).
- ACE, PCA, Capy e Edge no painel.
- Índice `/tools` (`tools.html`) e próximas ferramentas: scanner (precisa de deep link) e o analisador de troca (só logado).

---

## 12. Riscos e perguntas em aberto

### 12.1 Riscos

| # | Risco | Efeito | Mitigação |
|---|---|---|---|
| 1 | **Foto real ≠ sintética** (retícula, sangria, lasca, holo, sleeve) | O automático pode cair de 90%+ pra ~70%. | O manual com lupa (F1a) e ímã (F1b) é bom sozinho. A F2 só entra com o corpus. "Não achei" é sempre melhor que número errado, e há sempre a confirmação de um toque. |
| 2 | **Memória no iOS** (canvas de 16,7 MP; total de ~224–384 MB) | Canvas em branco ou aba recarregada com foto de 24–48 MP. | Cabeçalho lido sem decodificar, **uma** decodificação já reduzida, teto de 12 MP (8 MP com pouca RAM), só o lado ativo decodificado, `close()` antes do `getImageData`, canvas zerado, teste com foto de 24 MP num iPhone de verdade. |
| 3 | **Android mata a aba** ao abrir o app de câmera | A foto se perde e a página recarrega. | Marca no `sessionStorage` antes do `capture`, mensagem específica ("use Galeria"), `etapa: "camera-perdida"` no evento pra medir a frequência. A câmera ao vivo (F5) resolve. |
| 4 | **`shared.js` sem folga** (195 B depois da F1a) | Outra feature entrando junto (um jogo novo custa ~58 B) estoura o teto. | F1a +60 B e F1b +4 B, medidos. Preview e sync na F4 só depois de medir. Se faltar, tirar código frio do núcleo antes de subir o teto (regra do `check-size.mjs`). |
| 5 | **split-css / SHELL_ASSETS / base / SW calados** | Página sem estilo, deploy abortado ou offline quebrado, sem o CI ver. | Checklist da §7.6, testes `i18n-pacotes-shell` e `tools-pages`, `split-i18n --write` numa cópia em LF antes da PR. |
| 6 | **Tabelas mudam ou são ambíguas** (a PSA mudou o texto sem anúncio; a Beckett tem duas páginas e está fora do ar; a SGC não diz o lado; a CGC classifica Carddass nos dois lados) | Nota estimada errada. | Vigência, fonte e confiança por tabela; **duas leituras visíveis** quando a fonte é ambígua; nota pela mais rígida; lembrete de 180 dias visível; casos-âncora; texto "estimativa". |
| 7 | **Leitura como nota oficial** | Frustração ou reclamação. | Rótulos "estimativa", "subnota" e "componente", texto fixo dos limites e disclaimer de marcas. |
| 8 | **Menu largo** no desktop com 8 itens | Quebra em duas linhas em 861–1024 px. | Conferir renderizando. Se quebrar, apertar o espaçamento no breakpoint em vez de tirar o item. |
| 9 | **Câmera nativa** com zoom ultra-wide ou distorção forte | Erro de lente. | Dica "carta no centro, evite 0,5×" e aviso de flecha (F2). |
| 10 | **Confusão com o scanner** (em ≤ 860 px a página ganha sozinha a busca com câmera, `initHeaderSearch` `shared.js:2278-2290`) | A pessoa toca na câmera errada. | O botão grande da página é "Tirar foto". Na F5 o scanner ganha o modo Centralização. |
| 11 | **Recarga automática** (versão nova do SW a cada deploy da main; pull da nuvem no boot de quem está logado) | A foto, que só existe em memória, some no meio do ajuste, justamente na volta da câmera. | `data-ocupado` respeitado pelo `podeRecarregarSozinho` (+13 B), editor imersivo como diálogo, entrada desabilitada durante o `#pageLoadingPill`, teste de `controllerchange`. |
| 12 | **Espessura da carta em foto inclinada** | Viés sistemático de 0,4–0,9 pt a 20° do lado próximo, maior quando se afasta e usa zoom. | Objetivo de precisão cheia até ~10°, ângulo exibido, `σ_paralaxe` no "±", gerador com espessura, compensação na F2 validada no corpus. |
| 13 | **"Mesmo número" entre navegadores** | A mesma foto dá ±0,1 pt no Chrome × Safari. | Promessa escrita como "mesmo navegador"; decisões só com `+ − × / sqrt`; harness compara navegadores com tolerância. |

### 12.2 Perguntas pro Fernando, cada uma com a recomendação

1. **Nome no menu:** "Tools" e "Centering Tool" literais nos 3 idiomas, ou "Ferramentas"/"Herramientas" em pt/es?
   *Recomendo literal*, como você pediu. O H1 em pt leva também "centralização", pra busca.
2. **Itens do submenu na F1a:** só o Centering Tool, ou já Scanner e Analisador de troca?
   *Recomendo só o Centering Tool*, com "Tools" levando direto pra ele. O índice `/tools` nasce com a 2ª ferramenta. O scanner não tem endereço próprio (precisaria de deep link no núcleo) e a troca exige login.
3. **Entrada no celular.** Os fatos:
   - a Busca é aba pública e vai ter o link (0 B);
   - a Perfil ganha o bloco antes do menu de conta (0 B);
   - a landing ganha um cartão (0 B);
   - o atalho do PWA só aparece no Android se estiver entre os **3 primeiros** (hoje Coleção, Explorar, Wishlist; o iOS não mostra atalhos);
   - deslogado, a tabbar tem só 3 abas, e uma 4ª só pra quem não está logado custaria ~60 B (cabe nos 195 B).

   Duas decisões: trocar a Wishlist pelo Centering Tool nos atalhos? E uma aba "Tools" na tabbar só pra deslogado?
   *Recomendo trocar a Wishlist nos atalhos* (ela exige login e o Hub já leva a ela) e *não* criar a aba por ora. Reavaliar com o evento da F1b.
4. **BGS:** as duas páginas oficiais (`/grading-standards` e `/grading/scale`) ficaram no ar juntas até 2026, com regras diferentes pro 9.5 e pro verso do Pristine. Ok mostrar a nota pela **mais rígida** e as duas leituras lado a lado quando divergirem?
   *Recomendo que sim*, e reconferir quando o beckett.com voltar.
5. **CGC:** pra TCG a CGC só publica número no 10P, no 10 e no 3.5. Pra non-sports, publica do 9 pra baixo, e ela classifica Carddass às vezes como non-sports, às vezes como TCG. Ok ter o seletor "Tipo pra CGC" e, na F4, marcar as linhas Carddass e vending como "depende", com duas leituras? E você sabe como a CGC classifica a sua One Piece de 1999?
   *Recomendo que sim*, e a confirmação da One Piece define o padrão daquela linha.
6. **Mais graduadoras:** ACE, PCA, ARS, Capy (Brasil) e Edge na tabela da página na F1a, e no painel depois?
   *Recomendo que sim*, com a Capy marcada "como publicado" por causa dos erros da página dela. Vale você falar com eles.
7. **PNG de compartilhar com a foto da carta por padrão?**
   *Recomendo ligado, com opção de tirar.* O PNG é gerado no aparelho e sai pelo app que a pessoa escolhe; o Sleevu não recebe nada. Por isso a promessa da página passa a ser "**o Sleevu nunca recebe sua foto**", e não "a foto não sai do aparelho", que seria falsa ao compartilhar. Não fere o veto, que é sobre guardar foto por carta ou slab. Confirma?
8. **Onde salvar os números da carta crua:** só com login, na conta (chave sincronizada, ~60–120 B gz no núcleo, a medir), e o deslogado vê "Entrar pra salvar"?
   *Recomendo que sim.* O histórico só no aparelho repetiria o padrão que você mandou fechar nas Pastas e em Meus Decks. Se a chave não couber no orçamento depois da F1b, a F4 sai só com o salvar no slab.
9. **Câmera padrão no celular:** a nativa (resolução cheia, macro, HDR; F1a) ou a ao vivo com moldura e nível?
   *Recomendo a nativa agora*, e a ao vivo na F5, depois de medir.
10. **Corpus e aparelhos:**
    - você consegue me passar a foto do One Piece de 1999 em arquivo (pra F1a)? A imagem do pedido é um **print do editor do concorrente**, com as linhas e alças deles por cima; pra medir precisa da foto original, sem nada desenhado.
    - consegue separar ~30 cartas (incluindo a One Piece) e um scanner de mesa a 600 dpi, e testar num iPhone e num Android?
    *Recomendo que sim.* Sem o arquivo, a F1a não fecha o caso do pedido. Sem o corpus, "≤ 0,5 pt" é promessa e não medida, e por isso o corpus é o portão da F2.
11. **Anúncio:** `/tools/centering` sem vitrine (tela de trabalho)?
    *Recomendo sem anúncio na F1a.* Reavaliar depois uma vitrine só na parte de conteúdo, abaixo da ferramenta.
12. **Migração do evento `centering` (F1b):** ok aplicar quando a F1b subir?
    *Recomendo que sim.* Sem ela, o evento é descartado sem aviso e nada quebra, mas fica sem medir a câmera perdida e o uso.
13. **URL do eBay (F5):** ok ter uma Function que devolve só a URL da imagem do anúncio? A foto do usuário continua sem passar pelo Sleevu.
    *Recomendo que sim*, se o eBay não bloquear. Senão, fica só o "copiar imagem e colar".
14. **Variante indexável em inglês** `/tools/centering-en` (igual à pt, só com `lang="en"`, canonical e hreflang próprios) junto com o conteúdo da F3? E em espanhol?
    *Recomendo a en na F3*: é onde está a demanda de busca, e o robô só indexa o idioma que o HTML declara. A es fica pra quando houver conteúdo próprio.

---

## Apêndice — achados da revisão

- [aplicado] graduadoras/crítico — `null` no verso não pode "passar sempre": agora herda o limite da nota inferior (CGC 10P herda o 75 do Gem Mint 10), com âncora CGC F=50, V=80 → "abaixo de 10" e monotonia testada depois da herança.
- [aplicado] graduadoras/major — O bundle da SGC não diz frente ou verso: virou "lado não especificado", com o mesmo limite no verso (conservador), a leitura "só frente" ao lado e a ACE 10 tratada do mesmo jeito; §4.1, §4.2, âncoras e mockup corrigidos.
- [aplicado] graduadoras/major — Categoria TCG × non-sports da CGC por linha (`categoriaPorLinha`, Carddass = "depende", seletor na F1a, duas leituras) e frase "todo o catálogo é TCG" removida; a parte da TAG ("Other TCG") foi descartada, porque é categoria do pop report e não coluna da rubrica.
- [aplicado] graduadoras/major — As duas páginas da Beckett coexistiram até 2026 (conferido nos snapshots: /grading/scale com © 2026, /grading-standards com 403 em 2026): nota pela mais rígida, duas leituras com o mesmo peso, `variantes` com URL, `ctr.note` da v1 reclassificado como ambíguo.
- [aplicado] graduadoras/major — O parágrafo da folga e o exemplo da PSA são idênticos antes e depois de jan/2025 (conferido nos snapshots): histórico gravado como base + `faixaAte`, "aperto" atribuído ao concorrente.
- [aplicado] graduadoras/minor — O texto do CGC 3.5 (90/10) não tem a ressalva de categoria (conferido ao vivo): passou a valer pra TCG, sem a marca "a conferir".
- [aplicado] graduadoras/minor — Notas reais sem número entre a reprovada e a aprovada (BGS 8.5, SGC 6.5…, CGC non-sports): marcadas `inter` e exibidas como "8 (8.5 sem número)", com âncora BGS 57,9.
- [aplicado] graduadoras/minor — Contagem da TAG corrigida: 7 meias notas (8.5 a 2.5) arredondadas pra cima e o 1.5 mais rígido.
- [aplicado] graduadoras/minor — Âncoras da PSA alinhadas à regra da folga: 60,0 → 9 · 10 pela folga, 60,1 → 9 sem folga, 75,0 → 6 · 7 pela folga.
- [aplicado] graduadoras/minor — Edge Grading entrou em "Mais graduadoras" (10: 55/45 · 70/30; Ultramint 10+: 52/48 · 60/40), com confiança média porque a fonte é um artigo da própria Edge, não uma escala formal.
- [aplicado] viabilidade/major — Recarga por versão nova do SW e pelo pull da nuvem perderia a foto (código conferido em `shared.js:2513/2541/12312/12689/12695`): guarda `data-ocupado` no `podeRecarregarSozinho` (+13 B medidos), editor imersivo como diálogo, entrada desabilitada durante o `#pageLoadingPill` e teste de `controllerchange`.
- [aplicado] viabilidade/major — Com `<base href="/">`, pushState relativo, `href="#"` e link de compartilhar caem na home: regra de URL absoluta, teste que reprova os literais, e conferência visual com servidor que aplica o `_redirects` ou com o preview da branch.
- [aplicado] viabilidade/major — O `split-i18n` sem `--write` sai na `:72`, antes das checagens que abortam o deploy (conferido): novo teste de CI `i18n-pacotes-shell` e `--write` numa cópia em LF antes da PR.
- [aplicado] viabilidade/major — O manifest só tem um `share_target` (GET /explore, conferido): a F5 descreve a migração pra um POST único, o roteamento no SW, a Function de reserva sem SW e o teste do compartilhamento de texto.
- [aplicado] viabilidade/minor — O `FOOTER_PAGES` olha o último segmento do caminho (conferido em `:3497`): entra `"centering"`, não `"tools-centering"`.
- [aplicado] viabilidade/minor — Orçamento refeito por medição (charset utf8, como no CI): F1a +60 B (menu 45 + rodapé 2 + guarda 13), evento +4 B na F1b, folga de 195 B depois da F1a.
- [aplicado] viabilidade/minor — A ponte invisível do hover só existe pra `.nav-mega` (conferido): generalizada pra `.nav-group-hover > .nav-dropdown::before` (~0–10 B de CSS), sem usar o grid do mega.
- [aplicado] viabilidade/minor — Aviso do `check.mjs` só aparece com `--verbose` (conferido): o lembrete de 180 dias virou linha própria sempre impressa + `::warning::` no Actions; a sugestão do healthcheck foi descartada, porque ele não abre issue.
- [aplicado] viabilidade/minor — O `IGNORAR` do `split-i18n` não tem `tests/` (conferido): o harness foi pra `scripts/harness/`.
- [aplicado] viabilidade/minor — O `graded-ui.js` desenha `.srt-host` (área ordenar, conferido): a F4 grava o `ctr` direto na chave do graded, o que também resolve o risco das duas instâncias.
- [aplicado] viabilidade/minor — O precache leva ~29 KB gz a mais (3 idiomas do pacote + JS): registrado na §9.3 como decisão consciente (offline em evento de cartas), com a alternativa de runtime cache; o pacote i18n no shell é obrigatório pelo `split-i18n`.
- [aplicado] matemática/crítico — A paralaxe da espessura (~0,3 mm) enviesa o corte do lado próximo em 0,4–0,9 pt a 20°: objetivo reescrito pra precisão cheia até ~10°, pose estimada e exibida, `σ_paralaxe` no "±", gerador com espessura, compensação na F2 e erro com sinal por lado no corpus.
- [aplicado] matemática/major — Pico + parábola sobre amostragem bilinear em sRGB tem viés de fase e de gama: estimador trocado pelo centroide das diferenças nativas em intensidade linear, ao longo da linha/coluna nativa; teste de varredura de fase ≤ 0,05 px; gabarito escaneado inclinado e conferido com outro estimador.
- [aplicado] matemática/major — O "±" só tinha o ruído do ajuste: σ_total com ajuste (covariância, n efetivo), canto (Jacobiano), lente, paralaxe e piso calibrado; pior lido dentro da faixa ajustada (0,15/0,85); pior só decide acima de 2σ; 50/50 decidido pelo meio.
- [aplicado] matemática/major — `decodifica()` decodificava a foto inteira só pra ler o tamanho: cabeçalho SOF/EXIF lido sem decodificar, uma decodificação já reduzida, `close()` antes do `getImageData`, pico transitório na tabela, recorte nativo opcional na F1b e HEIC por plataforma (inclusive Android).
- [aplicado] matemática/major — A porta de proporção não separa o sleeve (1,2%) e listar o toploader confirmaria o plástico: proporção virou sanidade, com classes negativas, focal a priori e desligada sem EXIF; meta "0 errado" virou estatística (≥ 150 fotos, ≤ ~2% IC95%), com confirmação de um toque.
- [aplicado] matemática/minor — Quadrilátero côncavo ou em gravata faz `w` cruzar zero: validação convexa + `min(1, 1+g, 1+h, 1+g+h) > ε`, trava no último estado válido; giro e inclinação calculados no espaço métrico.
- [aplicado] matemática/minor — Decidir pelo número exibido trazia o arredondamento de volta: a nota é sempre decidida pela 1 casa, o inteiro é só exibição, e regras de 50/50 (inclusive a cruzada da `/grading/scale`) usam tolerância explícita e "no limite".
- [aplicado] matemática/minor — A janela de ±12 px de tela cobre corte, moldura e sleeve na visão geral do celular: janela em unidades da carta, candidatos por tipo de linha e, com mais de um candidato no zoom de visão geral, a linha fica onde foi solta e o painel sugere o modo guiado.
- [aplicado] matemática/minor — Determinismo só vale no mesmo motor: promessa reescrita ("mesmo navegador"), decisões só com `+ − × / sqrt`, harness entre navegadores com tolerância de 0,1 pt; reduzir a imagem sempre por conta própria foi descartado pelo custo de memória (fica o recorte nativo opcional).
- [aplicado] matemática/minor — O "falta pro próximo" agora lista o Δ de cada eixo e de cada lado que falha, com âncora 58,0/57,0.
- [aplicado] produto/major — A ferramenta ficava quase invisível no celular: entrada principal na Busca (pública), bloco da Perfil movido pra antes do menu de conta, cartão na landing, atalho do PWA só entre os 3 primeiros (pergunta 3) e pergunta 3 reescrita com os fatos da tabbar deslogada.
- [aplicado] produto/major — O histórico só local contraria a decisão do login obrigatório pra feature pessoal (memória e `enforceLoginGate` conferidos): removido; salvar só com login, deslogado vê "Entrar pra salvar"; pergunta 8 invertida.
- [aplicado] produto/major — O "pronto" da F1 dependia de scanner e aparelhos do Fernando: a F1a fecha com CI, bancada, a foto do One Piece, repetibilidade e render; o corpus e os aparelhos viraram portão da F2 e verificação pós-merge.
- [aplicado] produto/major — A F1 foi partida em F1a (manual útil) e F1b (ímã, sugestão, guiado, desfazer, régua, zoom completo), com um controle manual de inclinação só (giro da moldura); o evento foi pra F1b e não pra F3, porque a F2 e a F5 dependem da medição, e a seção da PSA 2025 foi pra F3.
- [aplicado] produto/major — A premissa "o Googlebot renderiza em en-US" estava velha (`theme.js:110-124` conferido): premissa corrigida e variante indexável `/tools/centering-en` planejada na F3 (pergunta 14).
- [aplicado] produto/minor — A promessa "a foto não sai do aparelho" ficava falsa ao compartilhar o PNG com foto: o texto virou "o Sleevu nunca recebe sua foto".
- [aplicado] produto/minor — `share_target` único: o mesmo achado da viabilidade, tratado na F5.
- [aplicado] produto/minor — Post do blog não passa por PR (mora no Supabase): saiu do escopo da F3, e o rascunho vai na descrição da PR.
- [aplicado] produto/minor — `FOOTER_PAGES` pelo último segmento: o mesmo achado da viabilidade, com a conferência no `tests/tools-pages.test.mjs`.
- [aplicado] produto/minor — Glifos em botão: setas, chevrons e "feito" viram SVG inline com `aria-hidden`, e o estado do passo vai em texto/`aria-current`; o `▾` do menu de topo segue o `.nav-caret` que o cabeçalho já usa.
- [aplicado] produto/minor — Faltava o celular deitado: layout M5 (palco + coluna), escolhido por ponteiro grosso + orientação, e 844×390 na conferência visual.
- [aplicado] produto/minor — Aba morta pela câmera sem diagnóstico: marca no `sessionStorage` antes do `capture`, mensagem específica e `etapa: "camera-perdida"` no evento.
- [aplicado] produto/minor — O índice `/tools` com um cartão só custava um toque a mais e uma página fina: "Tools" leva direto à ferramenta, `/tools` faz 302 até a 2ª ferramenta, e a posição ficou fixada entre Decks e Blog.
- [aplicado] produto/minor — O "Give feedback" do concorrente foi decidido: vira a métrica implícita `ajusteAuto` (Δ entre o automático e o final) no evento da F2, sem foto e sem texto livre.