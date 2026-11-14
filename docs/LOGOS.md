# Logos de jogo e de set: o padrão

Vale pra todo logo que o site serve: o logo do jogo (`assets/games/game_*`),
o logo do set (`data/<jogo>/set-logos/`, `data/set-logos/<idioma>/`,
`assets/games/set_*`) e o símbolo do set (`data/set-logos/symbol/`). O que
aparece **no lugar** do logo quando o set não tem um (o nome do set) é a
política da regra 3 do [CATALOGO.md](CATALOGO.md); aqui é o **arquivo**.

O objetivo é um só: o logo fica **nítido** em tela de alta densidade (retina,
monitor 4K com escala, celular de 3×) em todo lugar onde aparece, e **leve**,
pra não pesar na página. Os números moram em
[scripts/lib/logo-padrao.mjs](../scripts/lib/logo-padrao.mjs); o
[check-logos](../scripts/check-logos.mjs) confere no CI e o
[normaliza-logo](../scripts/normaliza-logo.mjs) gera o arquivo no padrão.

## A régua: densidade

**Densidade** é quantos pixels do arquivo cabem em cada pixel CSS no lugar
onde o logo aparece. Uma tela retina desenha 2 pixels físicos por pixel CSS;
um celular topo de linha, 3. Se o arquivo tem menos pixels do que a tela
desenha, o navegador estica e o logo fica macio.

| Densidade | Na tela | No check |
|---|---|---|
| 2× ou mais | nítido em qualquer tela | passa |
| 1,5× a 2× | macio só em tela retina, de perto (o navegador estica até 33%) | aviso |
| abaixo de 1,5× | borrado em tela retina | erro |

Monitor 4K a 100% de escala é 1×; a 150% é 1,5×; a 200% é 2×. MacBook e
iPad são 2×; iPhone e Android topo de linha são 3×. Com 2× no desktop e 3×
no celular, todas essas telas ficam cobertas.

## Onde cada logo aparece

Medido no sleevu.app em 2026-11-14, em 390, 1440 e 2560 px de largura: o
maior tamanho que o logo chega a ocupar, em px CSS (a caixa do
`object-fit: contain`; o logo ocupa a largura ou a altura dela, conforme a
proporção). Em telas mais largas que 1440 os tamanhos não crescem: as
caixas têm limite.

| Logo | Lugar | Desktop | Celular |
|---|---|---|---|
| Jogo | hub (`.hub-logo`, tamanho pela proporção) | até 308×122 | 150×86 |
| Jogo | /games | 204×56 | — |
| Jogo vintage | /vintage | 185×92 | 146×72 |
| Jogo vintage | "Sobre" no topo da página do jogo | 385×156 | 300×84 |
| Set | chip do set (grade de sets) | 176×74 | 123×60 |
| Set | página do set | 253×80 | 220×80 |
| Set | vitrine do topo (o set mais novo) | 385×156 | 300×96 |
| Símbolo | tela de sets e Coleção (`.set-symbol`) | 34×34 | 34×34 |

O logo de jogo vintage também vira `setLogo` dos sets do jogo (regra 3 do
CATALOGO), mas o "Sobre" já é o maior desses lugares. A vitrine do topo
mostra o set mais novo, que é justamente o do logo que acabou de entrar.
Por isso ela conta pro set, e não só como ideal.

## O padrão

| Tipo | Arquivo | Cabe em (teto) | Peso máximo |
|---|---|---|---|
| Logo de jogo | `assets/games/game_<slug>.webp` | 640×260 | 60 KB |
| Logo de jogo vintage | `assets/games/game_<slug>.webp` | 960×320 | 80 KB |
| Logo de set | `data/<jogo>/set-logos/<setId>.webp` | 960×320 | 60 KB |
| Símbolo de set | `data/set-logos/symbol/<setId>.webp` | 128×128 | 10 KB |
| SVG (qualquer tipo) | vetor de verdade | — | 30 KB |

E, pra todos:

1. **WebP.** PNG e JPEG não. SVG só quando a fonte é vetor de verdade: nítido
   em qualquer tela, mas sem bitmap embutido (`<image href="data:...">` é
   bitmap disfarçado).
2. **Fundo transparente de verdade.** Nenhum pixel do fundo com alfa entre
   1 e 11: sobre o chip branco, esse "véu" vira um retângulo cinza. Pontinho
   solto em volta do logo (brilho, purpurina, sujeira da fonte) sai.
3. **Recortado na tinta**, com 2 px de folga. Margem dentro do arquivo vira
   logo menor que os vizinhos no chip e no hub: o `contain` encolhe a margem
   junto.
4. **Cabe no teto, nunca maior.** O teto é o que o lugar mais exigente pede
   na tela mais densa (2× desktop, 3× celular), arredondado pra cima. Passar
   dele é peso que nenhuma tela mostra. Fonte menor que o teto **não é
   ampliada**: ampliar não cria detalhe. Ela fica no tamanho dela, e a
   densidade diz se basta.
5. **No menor peso.** WebP com perda (q90, alfa sem perda) ou WebP sem perda,
   o menor dos dois (logo de cor chapada sai menor sem perda; com degradê,
   com perda). Se mesmo assim passa do peso máximo, a cor desce até q75 e
   depois o alfa até q60. Em logo com purpurina ou brilho pontilhado, o alfa
   passa de dois terços do arquivo. No fundo branco do chip, o alfa q60 não
   se distingue do sem perda (comparado lado a lado no Lorcana 1 e no OP-17).
6. **Nítido:** 2× em todo lugar é o alvo. Abaixo de 1,5× em algum lugar é
   erro: o logo precisa de fonte maior, ou de exceção com o motivo.

### O que isso dá na prática

Com fonte grande o bastante, o arquivo sai com pelo menos 2× no desktop e 3×
no celular em todo lugar. Exemplos do normalizador:

| Fonte | Antes | No padrão |
|---|---|---|
| Magic (`assets/brand/`, 2000×1300) | 496×167, 17 KB, 1,95× no hub | 640×213, 26 KB, 2,5× no hub |
| Pokémon Base Set (TCGdex) | 2500×1281, 90 KB | 625×320, 38 KB, 2× na vitrine |
| Lorcana 1 (curado, PNG 1000×500) | 118 KB com margem | 621×320, 46 KB, sem margem |
| OP-17 (brilho pontilhado) | 786×162, 94 KB | 786×162, 41 KB |

Os 413 logos do repositório, regravados no teto, ficaram com mediana de 23 KB
(set) e 29 KB (jogo), e 95% abaixo de 54 KB. O peso máximo de 60 KB só pega
textura pesada, e o normalizador resolve com os degraus do item 5.

## Como gerar um logo

O sharp fica fora do repositório (o site não tem `package.json`), como no
caçador de logos:

```bash
mkdir -p /tmp/sharp && cd /tmp/sharp && npm init -y && npm i sharp@0.33.5
```

```bash
SHARP_DIR=/tmp/sharp/node_modules/sharp node scripts/normaliza-logo.mjs <fonte> assets/games/game_<slug>.webp
```

O tipo sai do caminho do destino (`assets/games/game_*` = jogo,
`set-logos/` = set, `set-logos/symbol/` = símbolo); jogo vintage é
reconhecido pelo `functions/_lib/jogos.js` ou por `--vintage`. A fonte pode
ser PNG, WebP, AVIF, TIFF ou SVG (rasterizado a 600 dpi), mas **precisa ter
fundo transparente**. Tirar o fundo (chave de cor, de luminância) é decisão
de arte e vem antes, à mão; os casos estão no
[assets/games/README.md](../assets/games/README.md).

O script grava o arquivo e mostra a densidade em cada lugar e o que o check
acha dele. Se der "BORRADO", a fonte é pequena: procure uma maior (página
oficial, media kit, wiki; o tamanho que precisa vem na mensagem). Se não
existe maior, registre a exceção (abaixo).

Logo de jogo novo continua com nome novo a cada troca de arte (`-v2`,
`-v3`): `/assets/*` é `immutable`. Ver o README de `assets/games`.

## Como o CI confere

O passo "Padrão dos logos" do CI roda
`node scripts/check-logos.mjs --base <base>`. Ele confere só os logos que a
PR (ou o push) **mudou**, e cai em erro se algum está fora do padrão sem
exceção. Aviso (macio) não barra.

- Sem o sharp, o check lê só o cabeçalho do arquivo: formato, tamanho, alfa,
  peso e densidade. Com o sharp, confere também os pixels: recorte, véu e
  fundo transparente. O CI instala o sharp só quando algum logo mudou.
- `node scripts/check-logos.mjs --todos` dá o relatório de todos os logos, por
  pasta (informativo, sai 0). Com `SHARP_DIR`, confere os pixels também.
- `node scripts/check-logos.mjs <arquivo>...` confere arquivos avulsos.

**Por que só o que mudou:** o build completo espelha logo de set sozinho
(Pokémon EN/PT pelo `mirror-set-logos`, Magic, FAB, Star Wars) e commita com
`[skip ci]`. Conferir todos em toda PR culparia a PR errada pelo arquivo que
o espelho trouxe.

### Exceção

Quando a fonte não existe maior, ou quando há uma decisão de arte (o
Yu-Gi-Oh! com fundo branco que funde no chip), a exceção vai em
[scripts/data/logos-excecoes.json](../scripts/data/logos-excecoes.json):

```json
{
  "assets/games/game_<slug>.webp": {
    "regras": ["nitidez"],
    "motivo": "<onde se procurou, a maior versão achada e a data da busca>"
  }
}
```

Ela cala **só** aquelas regras daquele arquivo, e o motivo é obrigatório (o
teste exige pelo menos uma frase).
Exceção que deixou de ser necessária (a regra passou) também é erro: a lista
é o registro do que está fora do padrão e por quê.

## Situação

`check-logos --todos`, com os pixels. **Nítido** = no padrão; **macio** = só
o aviso; **exceção** = fora, com o motivo no `logos-excecoes.json`; **fora**
= algum erro sem exceção.

Quando o padrão entrou (2026-11-14), 442 logos estavam fora. Depois das
trocas do mesmo dia (os vintage com as fontes do Fernando na PR #318; o resto
com fonte nova onde havia, regravação onde a arte já servia e exceção onde
não há fonte maior):

| Pasta | Logos | Nítido | Macio | Exceção | Fora | Erros de quem está fora |
|---|---|---|---|---|---|---|
| `assets/games` | 50 | 34 | 12 | 4 | 0 | — |
| `data/lorcana/set-logos` | 14 | 14 | 0 | 0 | 0 | — |
| `data/onepiece/set-logos` | 25 | 1 | 10 | 14 | 0 | — |
| `data/fab/set-logos` | 53 | 14 | 29 | 10 | 0 | — |
| `data/swu/set-logos` | 12 | 12 | 0 | 0 | 0 | — |
| `data/set-logos/en` | 141 | 25 | 55 | 0 | 61 | nitidez 61, recorte 7 |
| `data/set-logos/pt` | 39 | 8 | 10 | 0 | 21 | nitidez 19, recorte 6 |
| `data/set-logos/ja` | 43 | 2 | 1 | 0 | 40 | nitidez 40, recorte 5 |
| `data/set-logos/zh-cn` | 29 | 3 | 0 | 0 | 26 | nitidez 23, alfa 7 |
| `data/set-logos/symbol` | 162 | 103 | 2 | 0 | 57 | nitidez 55, recorte 20 |
| `data/magic/set-logos` (SVG) | 1.068 | 1.068 | 0 | 0 | 0 | — |
| `data/cyberpunk`, `data/harrypotter` | 4 | 1 | 0 | 3 | 0 | — |

Os 205 que sobram são todos do Pokémon e precisam de fonte maior que a da
TCGdex e do Bulbagarden (que hoje recusa o `fetch` do script): regravar não
muda a nitidez, e o CI barraria o arquivo mexido sem exceção. Os que só
tinham teto, peso, recorte ou véu já foram regravados.

**Arquivo trocado de nome.** O build rápido traz o `data/<jogo>/sets/` do
cache do último build completo, com o caminho antigo do logo. O arquivo
antigo sai do repositório mesmo assim, e o nome dele ganha um 301 pro novo
no `_redirects` (os PNG do Lorcana e o `op05.png` pro WebP, os `game_*`
pro `-v2`/`-v3`). Não sobra PNG de logo no repositório.

## Os espelhos automáticos

Desde 2026-11-14 todo script que baixa logo de set grava pelo mesmo
normalizador (`scripts/lib/logo-espelho.mjs`, que chama o `normaliza()` do
padrão): `mirror-set-logos` (Pokémon EN/PT e símbolos, TCGdex),
`mirror-ja-set-logos` (Bulbagarden, agora pedindo o arquivo de até 1400 px
em vez do thumb de 520), `mirror-fab-set-logos` (o PNG original, não mais o
wsrv a 600 px), `mirror-swu-set-logos` (sombra e contorno na escala do teto),
`sync-bulbapedia-zh --logos` e o caçador de logos de set. Sem o sharp
(`SHARP_DIR`), eles não gravam logo novo: o set fica com o nome até a próxima
rodada com sharp, em vez de entrar um arquivo fora do padrão. No deploy, o
passo "Instala o sharp (logos de set no padrão)" põe o `SHARP_DIR` no
ambiente antes dos espelhos.

Duas fontes pararam de responder ao script em 2026-11-14 e ficam no
registro: o `set_logo` do the-fab-cube aponta pra um CloudFront que não
resolve mais (sem DNS), e a Cloudflare do Bulbagarden recusa o `fetch` do
Node (403; a API responde, a imagem não). Os arquivos que já estavam no
repositório seguem valendo.
