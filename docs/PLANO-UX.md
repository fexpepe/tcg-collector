# Plano UX — análise competitiva e 20 itens (10 melhorias + 10 features)

Análise profunda do Sleevu contra os concorrentes — principalmente o **Collectr**
— com um plano de execução: 10 melhorias no que já existe e 10 features novas
(algumas pequenas de propósito), todas escolhidas pra melhorar a **experiência e
o feeling** de usar o site. Segue o formato dos outros docs (fases entregáveis
sozinhas) e a regra de ouro do projeto: **não quebrar o que já existe**.

Data da análise: 2026-08-25. Método: auditoria do código (todas as páginas e o
`shared.js`) + pesquisa de mercado (Collectr, TCGplayer, Pokellector, Dex,
PriceCharting, Moxfield/Archidekt, Dragon Shield, Ludex, Rare Candy, Cardmarket).

---

## 1. Leitura competitiva

### O Collectr em uma página

Referência da categoria: 4M+ usuários, nota 4,8 com ~77 mil avaliações, 25+
jogos, 1M+ produtos. O que sustenta isso, na ordem que importa:

1. **O gancho diário é financeiro.** A home do app é "seu portfólio agora":
   ganho/perda do dia com seta verde/vermelha, "cartas movendo seu portfólio",
   maiores altas/quedas do dia. É o motivo de ~2M aberturas de app por dia.
2. **Raw + graded + selado no mesmo lugar**, com preço por grade (PSA/BGS/CGC),
   pop report e link pra vendas concluídas no eBay.
3. **Ferramentas que viram conversa**: Trade Analyzer (veredito de troca justa),
   Compare Grades, showcase público com deep link.
4. **Scanner IA** (inclusive página de binder, 9 cartas por foto) — limitado no
   free, e é a reclamação nº 1 (paywall de scan).
5. **Monetização sem marketplace próprio**: Pro (US$ 5–8/mês: scans ilimitados,
   histórico de 5 anos, export CSV, filtros avançados, widgets) + afiliados
   eBay/TCGplayer + rede de ads. Export atrás de paywall = lock-in.

O que os usuários **elogiam**: interface que se aprende em 1 minuto, zero lag,
free tier utilizável. O que **reclamam**: limite de scans, **preço impreciso em
carta específica** (bom pra tendência, ruim pra precificar uma venda), catálogo
com lacunas **sem opção de item manual**, promos japonesas faltando.

### Onde o Sleevu já ganha (não mexer, só contar pro mundo)

- **Grátis o que lá é Pro**: histórico de preço, export CSV/JSON, sync na nuvem,
  filtros, portfólio ilimitado.
- **Vendas realizadas** com taxa/frete/câmbio congelado — o Collectr não tem.
- **Uma linha por jogo no gráfico + benchmark de mercado** — ninguém tem.
- **Condição por cópia** (M/NM/SP/MP/HP/D) afetando o valor — o Collectr trata
  condição de forma rasa.
- **Vintage japonês curado** (Carddass, Miracle Battle, Naruto CCG…) — lacuna
  deles ("promos japonesas faltando" é reclamação recorrente lá).
- **Local-first + export livre** — a resposta direta ao lock-in do CSV pago.
- Listas com export LigaPokémon, binders com impressão, badges, retrospectiva.

### Onde o Sleevu perde hoje

- **Gancho diário fraco**: o dado de variação de 24h existe e é publicado todo
  build, mas o Hub pessoal abre com números estáticos.
- **Sem selados** e sem item manual — metade do hobby de investimento fica fora.
- **Sem ferramenta de troca** — num mercado (BR) onde troca em grupo é o coração.
- **Confiança no preço** sem o "ver vendas reais" a um clique.
- Meia dúzia de pontas soltas visíveis (botão morto, texto "em breve" de coisa
  já lançada, import CSV que só cobre 3 jogos) que corroem a sensação de capricho
  que o resto do site entrega.

---

## 2. As 10 melhorias (M1–M10)

Polir o que já existe. Ordenadas por impacto no feeling; esforço **P** (até uma
sessão), **M** (algumas sessões), **G** (projeto).

### M1 — Variação do dia no Hub pessoal e no Portfólio (estilo corretora) · P
**O quê.** Um chip discreto "+R$ X (Y%) hoje" com seta verde/vermelha junto ao
patrimônio no `dashboard.html` e nos KPIs do Portfólio. Calculado do
`history-v2` que o site já grava todo dia (`valueHistory`/`recordValueSnapshot`
no `shared.js`) — último ponto vs anterior; sem ponto anterior, o chip não nasce.
**Por quê.** É O gancho de retenção do Collectr (delta do dia no topo de tudo).
O Sleevu já paga o custo de gravar o histórico e não colhe o retorno diário.
**Cuidado.** O sparkline do Hub foi removido por decisão (commit `6ae99f1`) —
isto é um chip de texto, não um gráfico. Respeitar o modo privacidade
(`data-sensitive`) e o Modo Colecionador.
**Onde.** `src/dashboard.js`, `src/portfolio.js`; dado já existe.

### M2 — "Movers de hoje" com as suas cartas no Hub pessoal · P/M
**O quê.** Card no Hub pessoal com as 3–5 cartas **suas** que mais mexeram no
bolso nas últimas 24h (variação × valor × quantidade), clicáveis.
**Por quê.** "Cartas movendo seu portfólio agora" é a seção de abertura do
Collectr. O Sleevu já publica `price-deltas.generated.json` (24h) todo build e
já tem a lógica de movers "minhas cartas" no Portfólio (F4 do PORTFOLIO.md) —
só que semanal e enterrada no fim da página financeira.
**Onde.** `src/dashboard.js` reusando o cálculo de `src/portfolio.js`.

### M3 — O idioma das cartas ganha interface · P
**O quê.** A chave `tcg-collector-card-lang-v1` é **lida** em 6 arquivos
(`game.js:171`, `shared.js:1043`, `app.js`, `cards.js`, `collection.js`,
`detail.js`, `wishlist.js`) e **nunca escrita** — o eixo "Todas/PT/EN/JA/ZH"
que o README vende não tem nenhum controle na tela. Adicionar o seletor em
Configurações → Idioma e Moeda (ao lado do idioma do site) e um chip nas
páginas de catálogo.
**Por quê.** Colecionador de JP/PT hoje vê tudo misturado sem saída; e é
exatamente o público que o Collectr atende mal.
**Cuidado.** Default "Todas" preserva o comportamento atual de todo mundo;
testar em produção o download de chunks por idioma (`MANIFEST=true`).

### M4 — Facetas nos outros jogos (hoje, só o Magic tem) · M
**O quê.** `GAME_FACETS` (`shared.js:6533`) tem uma única chave: `magic`. Os
outros 12 jogos ficam só com Raridade. Declarar facetas com os campos que o
sync já grava: Pokémon (tipo, estágio), Lorcana (tinta, tipo), One Piece (cor),
Yu-Gi-Oh! (tipo, atributo), Digimon (cor, nível) — um jogo por PR.
**Por quê.** Navegar um set com filtros bons é boa parte do "feeling premium"; a
infraestrutura declarativa já existe e tem as guardas certas (faceta sem dado
não aparece; opção presente em 100% das cartas é descartada).
**Cuidado.** Conferir campo a campo no catálogo real antes de ligar cada jogo —
a guarda esconde faceta vazia, então o pior caso é "não aparece", não "quebra".

### M5 — Import CSV para os 13 jogos (a porta de quem vem do Collectr) · P/M
**O quê.** O import CSV genérico só reconhece 3 jogos — `const games =
["pokemon", "lorcana", "onepiece"]` em `shared.js:9276` e de novo em `:9338` — e
`mapCsvGame` (`shared.js:2519`) conhece 5 nomes. Quem importa planilha de
Magic ou Yu-Gi-Oh! (os dois maiores catálogos do site!) não casa nada. Derivar
a lista do registro `GAMES` (`src/game.js`) e ampliar os aliases de nome de
jogo usados pelo Collectr/TCGplayer.
**Por quê.** O export do Collectr é pago (Pro) — quem paga uma vez pra sair de
lá precisa ser recebido de braços abertos. É a feature de **aquisição** mais
barata do plano.
**Cuidado.** A prévia antes de gravar já existe; estender os testes de CSV em
`tests/` pros jogos novos.

### M6 — O botão morto do tile vira ação (ou sai) · P–M
**O quê.** Quando a página não passa suporte a wishlist, o tile renderiza um
botão `disabled` "Adicionar a um binder (em breve)" (`shared.js:5374`). Botão
morto em tela nobre é anti-feeling puro. Duas saídas: (a) remover o placeholder
até a feature existir (P); (b) ligar de verdade — popover "escolher binder +
primeiro slot livre", a API dos binders (`binders-all-v1`) já existe (M).
**Por quê.** É o tipo de detalhe que as reviews 5 estrelas do Collectr citam ao
contrário ("tudo que aparece funciona").

### M7 — Celebração de set 100% + realce dourado · P/M
**O quê.** (a) O realce dourado nos cards de set/artista completos — item já
pendente no ROADMAP ("como o dourado da Pokédex"). (b) Uma micro-celebração
única no momento em que um set chega a 100% (glow + confete discreto de 1,5s,
uma vez só, com flag local pra não repetir; desligada com
`prefers-reduced-motion`).
**Por quê.** Completar um set é O momento do hobby e hoje passa em silêncio.
Badges já cobrem o prêmio durável; falta o instante. Gamificação de milestone é
aposta explícita de Collectr e Rare Candy.

### M8 — Pastas/Showcase sincronizam entre aparelhos (ou avisam que não) · M
**O quê.** `collection-folders-v1` é local-only "por ora" (`collection.js:16`),
enquanto Listas, Binders e Decks sincronizam — e a UI não diz qual é qual.
Usuário organiza o Showcase no celular, abre no desktop: sumiu. Caminho ideal:
incluir as pastas no sync (o padrão LWW + tombstone já tem 17 mergers; é mais
um). Caminho mínimo: aviso "este recurso fica só neste aparelho" na UI.
**Por quê.** Quebra de expectativa silenciosa é o que mais destrói confiança —
e confiança é a tese do produto.
**Cuidado.** Testes de merge em `tests/` cobrem o padrão; payload de sync tem
teto de 5 MB — pastas são leves (id → nome/ordem).

### M9 — Ninguém fica sem saída: rodapé, Artistas e Backup · P
**O quê.** Três becos sem saída: (a) o rodapé só existe em 12 páginas
(`FOOTER_PAGES`, `shared.js:2403`) — deslogado em `/sets` ou `/cards` não há
caminho pra Ajuda/Privacidade/Termos; (b) a página Artistas fica inalcançável
em Digimon, Yu-Gi-Oh!, Riftbound e Union Arena porque a subnav deles cai no
mínimo (`EXPLORE_SUBNAV`, `shared.js:2150`); (c) `backup.html` só é alcançável
pelo dropdown de quem já está logado. Normalizar o rodapé nas páginas de
catálogo, completar a subnav e dar um link visível pro backup.
**Por quê.** "Aprende-se em 1 minuto" (o elogio padrão ao Collectr) exige que
toda tela tenha saída óbvia.

### M10 — Faxina de confiança: Configurações e a vitrine da home · P
**O quê.** (a) `settings.html:89` ainda diz "O perfil público entra no ar em
breve" — ele está no ar, com Function própria e OG dinâmico; (b) há duas seções
"Privacidade" com o **mesmo** `id="settingsPrivacy"` (`settings.html:149` e
`:209`) — HTML inválido, âncora quebrada, e o usuário procura a opção na seção
errada — unificar; (c) a seção de marketplaces da home referencia
`assets/shops/*.webp` que não existem (a pasta só tem um README), então os
logos caem no fallback de texto — baixar/otimizar os logos ou tirar a seção até
tê-los. De quebra: `news.js:23` força o changelog a pt/en — quem usa o site em
espanhol merece ao menos o fallback correto declarado.
**Por quê.** São 30 minutos de trabalho que pagam em credibilidade cada vez que
alguém abre essas telas.

---

## 3. As 10 features (F1–F10)

Novas, priorizando as que reusam o que o site já tem.

### F1 — Analisador de Troca · M/G
**O quê.** Dois painéis "Eu dou" / "Eu recebo": adicionar cartas por busca (com
atalho "da minha coleção"), condição por item, soma dos dois lados com a fórmula
única (`cardValue`, `shared.js:1130`), veredito ("equilibrada" / "favorável a
você em R$ X, Y%"), histórico local das análises e **export como imagem** pros
grupos (a cozinha canvas de `shared.js:8366` já faz PNG de binder/graded/
vendas/medalha).
**Por quê.** Ferramenta-assinatura do Collectr (com histórico desde 2025);
Dragon Shield e Dex têm versões simples. No Brasil, troca em grupo de WhatsApp
é o coração do hobby — e o print do veredito é distribuição orgânica com a
marca Sleevu no rodapé.
**Cuidado.** Feature isolada: chave local nova (`trade-checks-v1`), zero
mudança nos stores existentes.

### F2 — Sparkline de preço no preview da carta · M
**O quê.** Mini-gráfico de 30–60 dias dentro do preview da carta
(`createCardPreview`), usando o `price-history.generated.json` que o build já
publica (60 pontos diários). Só aparece com ≥2 pontos — mesma filosofia do
gráfico da comunidade, que "nasce invisível e enche com o uso".
**Por quê.** Dragon Shield tem 30d por carta; no Collectr, histórico é o carro-
chefe do **Pro**. Aqui seria grátis — é literalmente o argumento de marketing do
projeto ("todo mundo cobra pelo gráfico") aplicado onde o usuário mais olha.
**Cuidado.** Carregar o chunk de histórico sob demanda ao abrir o preview (não
no boot); render com o mesmo caminho de gráfico já existente.

### F3 — "Vale a pena gradear?" · P/M
**O quê.** O card já mostra raw (com condição) e PSA 9/10 (PPT). Falta a
leitura pronta: linha "Prêmio de grading: PSA 10 ≈ 4,2× o raw (+R$ 310)" no
bloco graded do preview, com nota de honestidade ("antes das taxas de
graduação") e atalho pro "+ Graded" que já existe.
**Por quê.** PriceCharting cobra por recomendação de grading; Collectr tem o
Compare Grades. O Sleevu tem os dois números na tela e não faz a conta — é
apresentação, não dado novo.

### F4 — Itens selados e manuais · M
**O quê.** Rastrear o que não é carta solta: booster box, ETB, lata — e
qualquer item que o catálogo não tenha. Escopo mínimo fiel às decisões do
projeto: nome, jogo, quantidade, **preço manual** e custo pago; sem foto
(decisão "sem upload por item") e sem preço automático (decisão "nada de
backend em runtime"). Vive num store novo (`manual-items-v1`) e aparece no
Portfólio como **seção própria** ("Selados e manuais") — **fora** da fórmula
patrimonial num primeiro momento, pra não tocar o invariante "o total do
Portfólio bate com a Coleção no centavo". Somar ao patrimônio é decisão
explícita posterior (exigiria mexer na fórmula única com teste).
**Por quê.** "Catálogo com lacuna e sem opção de item manual" é reclamação
recorrente do Collectr; selado é metade do hobby de investimento e o Sleevu
hoje ignora por completo.

### F5 — Troca casada (Trade Finder) · M/G
**O quê.** A metade que falta do `find_sellers`: no perfil público de outra
pessoa, um bloco "Match de troca" — o que **ela** tem à venda que **você**
deseja × o que **você** tem à venda que **ela** deseja. Fecha abrindo o
Analisador de Troca (F1) com os dois lados preenchidos.
**Por quê.** É o "Trade Finder entre amigos" do Dex, que ninguém mais tem — e o
Sleevu já tem a infra de perfis públicos, vendas e wishlist.
**Cuidado.** Exige expor a wishlist no payload do perfil público — **opt-in
explícito** em Configurações → Privacidade, migração aditiva no
`public_profiles`.

### F6 — "Vendas reais" a um clique · P
**O quê.** Ao lado dos marketplaces do card, um link "Vendas concluídas (eBay)"
— a mesma URL do eBay que `MARKETS` (`shared.js:4912`) já monta (inclusive com
"PSA 9" pra slabs), com `LH_Sold=1&LH_Complete=1`. Uma linha de código, sem
API.
**Por quê.** Desconfiança no preço é a reclamação nº 1 do Collectr, e a
resposta do mercado inteiro é "mostre as vendas reais". Vira também o caminho
natural pra afiliado eBay no futuro, o modelo de receita que o Collectr validou.

### F7 — Compartilhar carta como imagem (modo story) · M
**O quê.** PNG 4:5/9:16 de **uma** carta: nome, set, número, variação recente e
preço na moeda do usuário, com a marca no rodapé. A cozinha canvas já gera
vitrines de binder/graded/vendas/medalha/retrospectiva — falta o formato que
mais circula em grupo.
**Por quê.** O Collectr aposta em deep links de showcase; no BR o que viaja é
imagem no WhatsApp/Instagram. Cada print é aquisição gratuita.
**Cuidado.** Canvas + imagem de carta = risco de taint: usar a imagem do
próprio cache/CORS-safe ou o layout sem foto (como a retrospectiva anual já
resolve).

### F8 — "Continuar de onde parou" · P/M
**O quê.** Bloco no Hub pessoal (e na home logada) com os últimos 3–5 lugares
visitados: "voltar ao set Prismatic Evolutions (73% completo)", últimas cartas
abertas. Chave local nova com teto pequeno; se vazia, o bloco não existe.
**Por quê.** O custo de retomar uma sessão de cadastro é o atrito nº 1 de quem
cataloga coleção grande. Nenhum concorrente faz isso bem — e é barato.

### F9 — Transições de página (View Transitions) · P
**O quê.** O site é multi-página e a navegação "pisca". Cross-document View
Transitions (`@view-transition { navigation: auto }` + `view-transition-name`
estável no header/tabbar) dão sensação de app com CSS puro. Navegador sem
suporte ignora — progressive enhancement de risco zero por construção.
**Por quê.** "Zero lag / parece app" é o elogio central ao Collectr; esta é a
versão web disso pelo menor preço possível. Combina com o prefetch que o
`speculation-rules.json` já faz.
**Cuidado.** Respeitar `prefers-reduced-motion`; validar com
`scripts/smoke-pages.mjs` (24 páginas em navegador real).

### F10 — Números vivos (count-up + tabular-nums) · P
**O quê.** O patrimônio e os KPIs "contam" até o valor no primeiro paint
(400–600ms, uma vez por carga) e o delta pisca suave ao mudar. Junto:
`font-variant-numeric: tabular-nums` em todo número de dinheiro (o valor para
de "dançar" quando atualiza). Desligado com `prefers-reduced-motion` e nos
modos sensível/Colecionador.
**Por quê.** É o micro-feeling que faz Robinhood/Collectr parecerem "vivos" —
duas horas de trabalho, percebido em toda visita.

---

## 4. Ordem sugerida

Pacotes pequenos, cada um mesclável sozinho:

1. **Faxina + quick wins (1 sessão):** M10, M9, M6a (remover o botão morto),
   F6. Zero risco, o site inteiro fica mais "inteiro".
2. **O gancho diário (1–2 sessões):** M1, M2, F10. É o coração da diferença de
   feeling pro Collectr e usa só dado que já existe.
3. **Momentos (1–2 sessões):** M7, F9, F8.
4. **Catálogo forte (várias sessões, incremental):** M5, M3, M4 — um jogo por
   PR nas facetas.
5. **Preço confiável (2–3 sessões):** F2, F3.
6. **Apostas de diferenciação (projetos):** F1, F4, M8, F7, F5 — nessa ordem;
   F5 depende de F1 pra fechar o ciclo.

## 4b. Estado de execução

**Pacote 1 — entregue em 2026-08-27**, com três ajustes descobertos no código
(o plano foi escrito sobre a auditoria; o código tem a palavra final):

- **M6a** ✔ — o botão desabilitado "binder (em breve)" saiu do tile (slot
  vazio, como os botões opt-in); ícone e chaves i18n órfãos removidos.
- **F6** ✔ — chip "eBay (vendidos)" (`LH_Sold=1&LH_Complete=1`) entre os
  marketplaces internacionais do card, com o mesmo tag "PSA 9" das graduadas.
- **M10a/b** ✔ — hint obsoleto do perfil alinhado ao i18n; as duas seções
  "Privacidade" (id duplicado) viraram uma; comentário em `news.js` declara o
  fallback es→pt como deliberado.
- **M10c** ✖ *adiado* — os logos das lojas são curadoria manual por decisão
  registrada no próprio `assets/shops/README.md` (fundo transparente, receita
  dos logos de jogo), e o proxy do agente confirma: os sites das lojas são
  inalcançáveis daqui. O fallback de texto é deliberado e não quebra nada —
  mas atenção: os 404 dos `.webp` fazem o `smoke-pages.mjs` acusar FALHA em
  `index` e `login` até os arquivos entrarem. Fica com o Fernando.
- **M9c** ✔ — Backup ganhou porta visível: seção "Seus dados" nas
  Configurações + link "Exportar / Importar" no rodapé (só logado, seguindo a
  regra "deslogado não vê atalho morto" do `initPageNav`).
- **M9a** ✖ *não se faz* — o rodapé fora das telas de uso contínuo é decisão
  de produto datada (2026-07-12, comentário do `initSiteFooter`); "Início"
  está sempre no menu e leva ao rodapé completo. Reabrir só com motivo novo.
- **M9b** ✖ *não se aplica* — os `indexes-artists.json` de Digimon/YGO/
  Riftbound/Union Arena estão **vazios** (`[]`); a subnav atual já segue a
  regra "Artistas só onde há dado". A auditoria errou nesse ponto.

**Pacote 2 — entregue em 2026-08-27**, com um redirecionamento do Fernando:
**nada de movers/finanças no Hub pessoal** — a visão financeira fica
concentrada no Portfólio. O pacote inteiro mudou de endereço:

- **M1** ✔ — variação do DIA no cartão do patrimônio do **Portfólio**
  (`#grandDelta`): seta + R$ + % calculados dos MESMOS pontos do gráfico
  (`chartHistory`, uma fórmula só), pintados depois do snapshot do dia. Diz
  "hoje" quando o ponto anterior é de ontem; visita espaçada mostra
  "variação desde {data}". Modo privacidade borra só o R$ e preserva o %.
- **M2** ✔ *reescopo* — a auditoria supunha movers semanais; o
  `price-movers.generated.json` **já é diário** (vs snapshot anterior) e a
  seção do Portfólio já abre em "Minhas cartas" por impacto no bolso — ou
  seja, o "movers de hoje" do Collectr já existia. Feito: comentários
  desatualizados ("build semanal", "da semana") corrigidos; nada de seção
  nova no Hub.
- **F10** ✔ — números vivos no Portfólio: o patrimônio "assenta" animando do
  retrato instantâneo até o valor fresco (600 ms, 1× por carga; troca seca
  com `prefers-reduced-motion`, sem retrato ou em troca de filtro — contar a
  partir do zero animaria um número que nunca foi verdade), e
  `font-variant-numeric: tabular-nums` nos valores (stat cards, composição,
  insights, movers) — o número não "dança" no scrub nem na atualização.
- Validação: 151 testes, check/check-mobile, smoke de 24 páginas e teste
  visual com dado semeado (chip verde "▲ +R$ 71,40 (+2,1%) hoje" ao lado da
  variação de faixa do gráfico, sem duplicar; blur do modo privacidade
  conferido por computed style).

**Pacote 3 — entregue em 2026-08-28** (M7, F9, F8 + pedidos do Fernando no
caminho):

- **M7** ✔ — realce dourado nos cards de set/artista 100% (`.complete`, o
  mesmo ouro da `.pokedex-card.owned`, por contagem exata — 149/150 arredonda
  pra 100% e não vale) + celebração na TRANSIÇÃO pra 100% na página do set:
  pulso dourado na barra + confete de ~1,5s, uma vez por set por navegador
  (`tcg-set-celebrated-v1`), nada além do estado dourado com
  `prefers-reduced-motion`.
- **F8** ✔ — "Continuar de onde parou" no Hub pessoal: o detail.js grava os
  últimos sets visitados (`tcg-recent-sets-v1`, teto 8, local-only) com o
  progresso DA VISITA, e o Hub mostra até 4 cartões (chip do jogo, barra,
  N/M · %). Sem histórico, a seção não existe.
- **F9** ✔ — View Transitions cross-document (crossfade de 150ms), com
  desligamento explícito no movimento reduzido (a rede `*` do fim do CSS não
  alcança os pseudo-elementos `::view-transition-*`).
- **Extra (pedido)** ✔ — logar leva pro Hub pessoal: o fallback do
  `returnTarget` (login.js) virou `/dashboard`, e o link mágico que aterrissa
  na home segue pro Hub (boot do shared.js); quem foi barrado numa página
  específica continua voltando pra ela.
- **Extra (pedido)** ✔ — fora o h2 "Sets" duplicado da página de sets (o
  título da página já diz Sets; chave i18n órfã removida).
- **Extra (pedido)** ✔ — modo compacto parou de encavalar preço × botões: a
  coluna de ações virou `max-content` nos três templates (o nº de botões varia
  por página — a Coleção tem 5, a busca 4 — e o fixo de 122px vazava). As
  linhas seguem alinhadas: o − escondido reserva o lugar e o ×N é absoluto.
- **Extra (pedido)** ✔ — fileira de jogos do desktop em UMA linha com setas
  ‹ › de rolagem quando transborda (`initChipRowScroll`), só no ponteiro fino
  (no toque o dedo rola; ≤600px usa o select suspenso).
- Validação: 151 testes, check/check-mobile, smoke 23/24 (a falha é o 404
  pré-existente dos logos de loja) e testes de navegador dirigidos: login→Hub,
  celebração 75%→100% (28 partículas, sem repetir no reload), set dourado na
  lista, "Continuar" visível no Hub, zero sobreposição no compacto e setas
  aparecendo/rolando com 13 jogos.

## 5. Como implementar sem quebrar (vale pra todos os itens)

- **Rodar sempre:** `node --test tests/*.test.mjs`, `node scripts/check.mjs`
  (sintaxe + i18n pt/en/es — chave nova exige os três, o CI quebra),
  `node scripts/check-mobile.mjs`. Mudança de shell/CSS: `smoke-pages.mjs`
  (Playwright) e, se tocar no split de CSS, `diff-computed-style.mjs`.
- **Invariantes que nenhum item pode tocar:** fórmula única de valor no cliente
  (a borda devolve dado, nunca total); local-first (localStorage é a fonte da
  verdade); catálogo versionado congela, nunca esvazia; sem upload de foto por
  carta; sem backend de preço em runtime.
- **Padrões do projeto:** chave nova de `localStorage` sempre prefixada e com
  migração aditiva; feature que depende de dado ausente **não aparece** (a
  regra das facetas e do gráfico da comunidade); animação nova respeita
  `prefers-reduced-motion`; dinheiro novo na tela respeita `data-sensitive` e o
  Modo Colecionador.
- **Progressive enhancement por padrão:** F9/F10 são CSS/JS que degradam pra
  nada; M1/M2 não nascem sem histórico; F2 não nasce sem 2 pontos.

## 6. Menções honrosas (avaliadas e deixadas fora do top 20)

- **Scanner IA** (câmera): o "uau" do Collectr, mas custo alto (API paga tipo
  Ximilar) e conflita com o custo previsível do projeto. Reavaliar se houver
  receita.
- **Alerta de preço diário**: o push da wishlist roda só segunda
  (`push-wishlist.yml`); subir a frequência é barato, mas melhor depois de M1/M2
  provarem o apetite por variação diária.
- **E-mail de resumo semanal**: loop de retenção do Card Ladder/PriceCharting —
  já descartado no PORTFOLIO.md por falta de infra de e-mail em massa.
- **Otimizador de carrinho da wishlist** (estilo Wants List do Cardmarket):
  matadora, mas exige preço por vendedor, que nenhuma fonte atual dá.
- **Streaks/desafios semanais** (Rare Candy): as badges sazonais já cobrem;
  streak diário pode soar caça-níquel num produto cuja marca é "sem pegadinha".
- **Widgets/badging de PWA**: suporte de plataforma ainda irregular; a variação
  no título da aba (`document.title`) seria o primeiro passo barato.
