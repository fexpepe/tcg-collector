# Anúncios — plano de receita sem estragar o app

Proposta de 27/09/2026, com as decisões do Fernando fechadas no mesmo dia
(seção 14). **Nada disto está no ar**: o desenho está aprovado e a
implementação começa pela fase 0. O objetivo é pagar o site (domínio, R2, D1, créditos
da PPT, horas de trabalho) sem trair a tese do ROADMAP ("grátis, sem plano
pro, sem limite") e sem piorar a experiência de quem usa o app todo dia.

---

## A proposta em uma tela

1. **Três fontes de receita, nesta ordem de prioridade:**
   - **afiliados** nos links de loja que o popup da carta **já tem**
     (TCGplayer, eBay; Amazon/Mercado Livre depois). Custo de UX: zero;
   - **display programático** com **Google AdSense, só com blocos manuais**
     (Auto ads e vinheta desligados) nas páginas de **descoberta** — catálogo,
     sets, cartas, decks públicos;
   - **venda direta pra lojas**, pelo mesmo espaço, quando houver tráfego pra
     vender. O espaço nasce preparado pra isso (seção 8).
2. **Onde a pessoa trabalha não tem anúncio.** Coleção, Portfólio, Binders,
   Wishlist, editor de deck, scanner, login, configurações e **qualquer popup
   ou modal** ficam limpos. Anúncio só onde a pessoa está navegando.
3. **Formato de "respiro" no feed, nunca por cima do conteúdo.** Uma faixa
   rotulada "Publicidade" entre linhas da grade, com a moldura do próprio site;
   um trilho lateral só em telas ≥1888 px, na margem que hoje fica vazia. Sem
   pop-up, sem vinheta, sem âncora grudada (no celular a tabbar flutuante já
   mora no rodapé), sem vídeo.
4. **Por que AdSense e não uma rede "gamer":** as redes de nicho que os sites
   de TCG usam (Nitro na Moxfield, Playwire na Limitless, Mediavine no EDHREC)
   pedem ~100 mil pageviews/mês ou tráfego majoritário dos EUA. Com o público
   brasileiro e o tamanho atual, **AdSense é a única porta aberta** — e é o que
   a própria LigaPokémon usa. O plano já traz a escada de troca (seção 3).
5. **Expectativa honesta:** com 10 mil pageviews/mês o display rende algo como
   **US$ 12–35/mês**; com 50 mil, **US$ 60–175**. Anúncio sozinho não paga o
   projeto nesse tamanho — por isso afiliados e venda direta vêm junto, e por
   isso não vale a pena comprar receita com experiência pior.

Os mockups (tela real + espaço proposto) foram renderizados sobre o
`styles.css` de verdade, em 1440 px, 1920 px e 390 px — descritos na seção 6.

---

## 1. O que o código já tem (e o que bloqueia)

O Sleevu foi preparado pra isto antes de existir o plano:

| peça | onde | estado |
|---|---|---|
| consentimento `ads` **opt-in** | `CONSENT_DEFAULT` no `shared.js` | pronto — o comentário já diz que o script do anunciante fica atrás de `hasConsent("ads")` |
| banner de loja parceira (imagem + link, sem terceiro) | `PARTNER_AD` / `initPartnerBanner` | pronto, desligado (`enabled: false`) |
| clique de saída pra loja medido | evento `store_click` (analytics v2) | no ar — é o número pra levar a uma loja |
| `utm_source=sleevu` nos links BR | `comUtm` | no ar — a Liga/MYP já enxergam o tráfego que mandamos |
| Pix / Ko-fi | home e menu de conta | no ar |
| service worker não mexe em requisição de terceiro | `sw.js`, handler de `fetch` | ok — só intercepta a própria origem e os hosts de imagem |
| crawler do AdSense liberado | `robots.txt` (`User-agent: *` + `Allow: /`) | ok |

O que **bloqueia** hoje:

- **CSP.** O `_headers` é `script-src 'self'` sem nonce. O AdSense **só
  suporta CSP estrita com nonce** (`'nonce-…' 'strict-dynamic'`); lista de
  domínios não é suportada porque os domínios mudam
  ([AdSense 16283098](https://support.google.com/adsense/answer/16283098)).
  Resolução na seção 10.
- **Política de privacidade.** O texto atual promete "não usamos rastreadores
  ou anúncios" e "por isso o Sleevu não tem aquele banner de consentimento".
  Tem que ser reescrito **antes** do primeiro anúncio, nos três idiomas.
- **`ads.txt`** não existe (hoje `/ads.txt` devolve HTML). Sem ele o AdSense
  mostra "ganhos em risco".

---

## 2. Quanto dá pra ganhar (números honestos)

RPM = receita por mil pageviews. As faixas abaixo são estimativa (fontes de
blog/indústria, confiança baixa), com o público suposto em ~60% Brasil, ~30%
EUA e ~10% resto:

| pageviews/mês | AdSense | rede premium de nicho |
|---|---|---|
| 10 mil | ~US$ 12–35 | não elegível |
| 50 mil | ~US$ 60–175 | só Journey (se houver tráfego EUA) |
| 500 mil | ~US$ 600–1.750 | ~US$ 1.750–4.000 |

Por que o Brasil pesa: display programático paga ~US$ 0,30–2 por mil
impressões aqui, contra US$ 2–6 por mil sessões em games nos EUA. Por isso o
site em inglês e espanhol importa pra receita, não só pra alcance.

**Afiliado** não tem tabela — depende de quantos cliques viram compra. A
conta que o /admin já permite fazer:

```
receita/mês ≈ store_click (por loja) × taxa de compra × ticket médio × comissão
```

Comissões verificadas: TCGplayer **3,5%** (via Impact, primeira-atribuição,
janela de 48 h, sobre o carrinho inteiro); eBay Partner Network **3%** em
cartas colecionáveis (janela de 24 h); Amazon BR **8%** em "Brinquedos e
Jogos"; Mercado Livre **8%** em "Brinquedos e Hobbies". Cardmarket só tem
indicação de usuário com teto de €10/mês — não compensa. LigaPokémon/LigaMagic
e MYP **não têm programa público**: é conversa direta, e o `utm_source` que já
vai nos links é o argumento.

**Consequência pro plano:** a receita não justifica nenhum formato agressivo.
A regra é "o máximo que não custa retenção", medido (seção 12).

---

## 3. Qual rede — e a escada de troca

| rede | entrada (2026) | serve pra nós? |
|---|---|---|
| **Google AdSense** | sem mínimo de tráfego | **agora** — é a única que aceita o site hoje |
| Google Ad Manager (grátis) | precisa de conta AdSense | **depois**, pra misturar venda direta + AdSense de reserva |
| Journey by Mediavine | 1.000 sessões/mês **de EUA/CA/UK/AU** | se o tráfego em inglês crescer |
| Nitro (Moxfield, Cardsrealm) | ~100 mil pageviews (menores aprovados à mão) | a rede "nerd" certa quando houver volume |
| Playwire (Limitless, MasterDuelMeta) | 100 mil (self-service) | idem |
| Mediavine (EDHREC, PokeBeach) | US$ 5 mil/ano de receita de anúncio | bem depois |
| Raptive (YGOPRODeck, lorcana.gg) | 25 mil **e** 50% do tráfego de EUA/UK/CA/AU/NZ | não — a regra de geografia barra |
| Ezoic | 250 mil usuários/mês desde fev/2026 | não |
| Monumetric, Freestar, Snigel, Venatus | 10 mil a 2 milhões + restrições | não |
| Carbon / EthicalAds | público dev | não é o nosso público |

O que os sites de TCG de fato rodam (pelo `ads.txt` de cada um, lido em
27/09/2026): Nitro na Moxfield; Playwire na Limitless e MasterDuelMeta;
Mediavine no EDHREC e PokeBeach; Raptive em YGOPRODeck, onepiece.gg e
lorcana.gg; **AdSense puro na LigaPokémon, no Collectr e no pkmncards**. O
Scryfall não tem anúncio: vive de parceria com TCGplayer e Cardmarket.

**A escada:**

1. **Agora:** AdSense, blocos manuais.
2. **~100 mil pageviews/mês** (ou 1.000 sessões/mês de país anglófono, pra
   Journey): testar Nitro ou Playwire **em A/B contra o AdSense** e ficar com o
   que der mais RPM sem piorar as métricas da seção 12. São as que conhecem o
   público de TCG e trazem anunciante de games.
3. **Dois ou três anunciantes diretos fechados:** Google Ad Manager na frente
   (segmentação por chave-valor `jogo=pokemon`, relatório por campanha), com
   AdSense preenchendo o que não foi vendido.

A troca de rede não pode custar código de página: todo anúncio passa por um
**espaço** com fornecedor configurável (seção 10). Trocar AdSense por Nitro é
trocar uma linha de configuração, não mexer em 20 HTML.

---

## 4. Princípios (não reabrir sem motivo novo)

1. **Descoberta, sim; trabalho, não.** Anúncio onde a pessoa navega (catálogo,
   set, carta, decks públicos). Onde ela cadastra, organiza ou decide
   (coleção, binders, deck, portfólio, scanner, popups), nenhum.
2. **Nada cobre conteúdo.** Sem pop-up, vinheta/intersticial, âncora grudada,
   vídeo com som ou autoplay. No AdSense isso quer dizer **Auto ads
   desligado** — a vinheta dele dispara no clique em link interno e, desde
   março/2026, também por ociosidade e ao voltar pra aba.
3. **Espaço reservado, zero salto.** O espaço nasce com altura fixa. Se não
   vier anúncio, entra a vitrine da casa no mesmo lugar — nunca um buraco que
   encolhe e empurra a grade.
4. **Rotulado e explicado.** "Publicidade" em cima e um "Por que anúncios?"
   que leva pra uma resposta curta no FAQ (o que paga, como apoiar).
5. **Com cara de Sleevu.** Moldura com os tokens do tema (`--surface`,
   `--line`, raio 14 px), claro e escuro; o criativo mora dentro dela.
6. **Pouco e espaçado.** Teto de 3 por página, distância mínima entre dois,
   nunca na primeira tela do celular. Densidade bem abaixo dos 30% da altura
   de conteúdo que a Coalition for Better Ads usa como limite no celular.
7. **Peso fora do núcleo.** O carregador é um módulo à parte, baixado só em
   página com espaço, depois do conteúdo. O `shared.js` não ganha nada além de
   uma chamada. LCP continua sendo a carta/grade, nunca o anúncio.
8. **O dado do usuário não vai pro anunciante.** Segmentação é pelo
   **contexto da página** (jogo, set), nunca pela coleção, wishlist ou perfil.
   Personalização do Google só com consentimento explícito.
9. **Não brigamos com adblock.** Sem parede, sem aviso insistente. Quem
   bloqueia vê o site inteiro, igual. O site precisa funcionar idêntico com o
   módulo de anúncio bloqueado — isso vira teste.
10. **Economia de dados manda.** `navigator.connection.saveData` ligado =
    nenhum anúncio programático (só a vitrine da casa, que é leve e local).

---

## 5. Onde entra — mapa de páginas

| grupo | páginas | anúncio |
|---|---|---|
| **A — chegada pela busca** | `/card/<slug>`, `/set/<slug>`, `/deck/<slug>`, páginas de artista (pré-renderizadas) | sim — é onde chega o visitante do Google, que não é o usuário diário |
| **B — catálogo no app** | `detail` (set/artista/Pokémon), `sets`, `cards`, `explore`, `decks`, `pokedex`, `artists`, `trainers`, `lancamentos`, `novidades`, `lore` | sim, faixa no feed |
| **C — pessoais** | `collection`, `portfolio`, `wishlist`, `binders`, `pastas`, `sales`, `my-decks`, `dashboard`, `badges` | **não** (decidido, seção 14) |
| **D — perfis e links compartilhados** | `/users/<handle>`, links `?s=` | **não** — é a vitrine de alguém |
| **zero** | `index` (landing), `hub`, `login`, `account`, `settings`, `backup`, `admin`, `about`/`help`/`faq`/`privacy`/`terms`, `404`, scanner, todo popup/modal, `primeiros-passos`, imagens exportadas de binder | **nunca** |

A landing fica limpa porque é a página de conversão ("Começar, é grátis") — e
porque é o primeiro contato de quem ainda não confia no site.

---

## 6. Formatos e posições

### Desktop (1440 px, grade de 5 colunas)

- **Faixa no feed** ocupando a linha inteira da grade (`grid-column: 1 / -1`),
  depois da **3ª linha** e então a cada **8 linhas**; teto de 3. Com a página
  de 60 cartas isso dá 2 faixas por página. Criativo 728×90 (ou responsivo
  970×90), altura reservada ~130 px com o rótulo. No mockup, a faixa fica
  entre duas linhas de cartas com a mesma borda e raio dos tiles e lê como
  "respiro", não como invasão.
- **Páginas pré-renderizadas** (`/card`, `/set`, `/deck`): um retângulo
  300×250 depois do bloco de preço/informações e outro antes da lista de
  outras versões/cartas.

### Tela larga (≥1888 px)

- **Trilho lateral** (aprovado): um 160×600 fixo (sticky) na margem direita.
  O conteúdo tem teto de 1440 px (`--content-w`), então a 1920 px sobram
  240 px de cada lado **sem nada**. O anúncio mora nesse vazio: a grade não
  perde coluna. Em telas menores o trilho simplesmente não existe. Se no uso
  real parecer poluído, é o primeiro formato a sair.

### Celular (390 px, grade de 2 colunas)

- **Faixa no feed** com **300×250** (o retângulo médio, o formato que mais
  paga no celular) ocupando as duas colunas, depois da **4ª linha** (8 cartas,
  ~2 telas de rolagem) e então a cada **10 linhas**; teto de 3. Nunca na
  primeira tela: quem abre o set vê cartas, não anúncio.
- **Sem âncora.** A tabbar flutuante já é o rodapé; um banner grudado junto
  dela deixaria quase um quinto da tela ocupado o tempo todo.
- **Pré-renderizadas:** um 300×250 abaixo do preço.
- O link "Por que anúncios?" ganha área de toque de 44 px (regra do repo).

### Popup da carta (os dois)

- **Nenhum anúncio programático.** É a tela mais "de trabalho" do app, e a
  política do Google não quer anúncio em tela de ação/navegação.
- O que entra ali é **afiliado** nos chips que já existem (seção 7) e, na fase
  de venda direta, uma **"Oferta de loja parceira"**: um cartão discreto acima
  de "Marketplace BR" — logo, nome da loja, "a partir de R$ 14,90 · NM",
  botão "Ver na loja", rótulo "Loja parceira · patrocinado". É o espaço mais
  valioso do site pra vender a uma loja: aparece na carta exata que a pessoa
  está olhando.

### Quando não há anúncio

Antes do consentimento, sem preenchimento do AdSense
(`data-ad-status="unfilled"`), com `saveData`, ou com o módulo bloqueado: o
espaço mostra a **vitrine da casa** (servida do próprio site, sem terceiro):
"Apoie o Sleevu" (Pix/Ko-fi), "Instale o app", "Conheça o scanner" e, pras
lojas, "Anuncie aqui". Mesma altura — a grade não pula.

---

## 7. Afiliados — a receita que já está pronta pra ligar

O `brMarketplaceLinks` já monta os chips "Marketplace BR" e "Marketplace EUA"
no popup de toda carta, e o `store_click` já conta os cliques. Falta pouco:

1. **TCGplayer** — cadastrar no programa (Impact) e trocar a URL de busca pelo
   link rastreado. É o chip com mais intenção de compra pro público EUA.
2. **eBay** — eBay Partner Network: `campid` na URL de busca e na de
   "vendidos". Cobre vintage e graded, onde o TCGplayer não chega.
3. **PriceCharting** — tem programa próprio; conferir antes.
4. **Liga / MYP / LigaBRA** — sem programa público. O `utm_source=sleevu` já
   está lá justamente pra essa conversa: "mandamos N pessoas no mês,
   procurando estas cartas" (o /admin tem o número por loja e por jogo).
5. **Amazon BR / Mercado Livre (8%)** — pra acessório, não pra carta avulsa:
   sleeves, fichário e caixa, no momento em que faz sentido (ex.: ao montar um
   binder ou deck). Fica pra depois da fase 1 — é tela de trabalho e exige
   cuidado pra não virar vitrine.

O ajuste de código é na função `comUtm` (que vira `linkDeLoja`): a tabela de
parâmetros de afiliado por loja mora num lugar só, testada. **Transparência
(decidido):** uma linha discreta embaixo dos chips ("Links de loja podem
render comissão ao Sleevu — o preço pra você não muda") e uma seção na
política de privacidade. O afiliado **não muda a ordem nem quais lojas
aparecem**: a lista continua sendo a que serve a quem procura a carta. A
Moxfield vai além e deixa o usuário escolher a loja; fica anotado como ideia.

---

## 8. Venda direta pra lojas — o futuro já no desenho

A diferença do Sleevu pra uma rede de anúncio é saber **o contexto de toda
página**: o jogo (`currentGame()`), o set, o idioma do site e o da carta. Uma
loja de Lorcana não quer aparecer pra quem coleciona Yu-Gi-Oh!. Isso vira
produto:

| formato | o que a loja compra | onde aparece |
|---|---|---|
| **Patrocínio de jogo** | "todas as páginas de One Piece por um mês" | faixas no feed + trilho, só naquele jogo |
| **Lançamento** | a semana do set novo (a página mais quente do mês) | faixa na página do set + oferta no popup das cartas dele |
| **Loja parceira no popup** | aparecer na carta exata ("a partir de R$ X") | cartão de oferta no popup (seção 6) |
| **Diretório de lojas** | presença fixa numa página "Onde comprar" por jogo/cidade | página própria, sem invadir o resto |

Como funciona sem terceiro nenhum:

- As campanhas moram num JSON versionado (`data/ads.json`): loja, jogo(s),
  idioma, início/fim, peso, espaços, imagem em `/assets/partners/` (imutável:
  troca de arte = arquivo novo, como os logos). O `PARTNER_AD` de hoje vira o
  primeiro caso desse formato.
- Contagem **first-party**: dois eventos novos no `events_guard` (`ad_view`,
  visto de verdade com 50% na tela por 1 s, e `ad_click`), agregados por
  campanha. É argumento de venda: "sem pixel, sem rastreio, e o número é o
  mesmo que você vê no seu analytics pelo `utm_source`".
- Link com `rel="sponsored noopener"` e rótulo "Patrocinado".
- Preço: começar por pacote mensal fixo por jogo, calculado a partir do que o
  /admin mede (pageviews por jogo + `store_click`) — algo como 2–3× o que o
  AdSense pagaria pelas mesmas impressões, porque é exclusivo e segmentado.
- Página `/anuncie` com o kit de mídia (público, números, formatos, contato).
- Quando houver dois ou três anunciantes, o mesmo espaço passa a chamar o
  Google Ad Manager (seção 3) em vez do JSON — a página não muda.

Candidatos naturais: as lojas que já recebem nosso tráfego (Liga, MYP,
LigaBRA), lojas físicas de TCG, marcas de acessório (sleeves, fichários) e
organizadores de torneio.

---

## 9. Privacidade e consentimento

**Brasil (LGPD).** O guia de cookies da ANPD (out/2022) diz que cookie de
publicidade se apoia em **consentimento** — legítimo interesse raramente cabe
— e que o banner precisa de "recusar tudo" com o mesmo peso de "aceitar". O
Google não faz isso por nós: a ferramenta de mensagens dele tem mensagem pra
UE/EUA, não pra LGPD.

**UE/Reino Unido/Suíça.** Anúncio personalizado exige CMP certificado pelo
Google (IAB TCF) desde jan/2024. O "Privacidade e mensagens" do próprio
AdSense resolveria, mas é script do Google rodando ANTES do consentimento — o
contrário da decisão 2. **Decidido na fase 1:** nesses países o Sleevu não
chama rede de anúncio nenhuma (o país vem da borda do Cloudflare,
`<html data-pais>`); fica a vitrine da casa e dos parceiros, sem cookie. O
tráfego de lá é pequeno; se um dia pesar, aí entra um CMP.

**Como fica no Sleevu:**

- **Aviso pequeno, não parede**, só na primeira página **com espaço de
  anúncio** (a landing não pergunta nada): cartão no canto inferior esquerdo
  no desktop; no celular, acima da tabbar. Duas opções do mesmo tamanho —
  "Aceitar anúncios personalizados" / "Só contextuais" — e "Saiba mais".
- **Aceitou** → `setConsent("ads", true)` e AdSense personalizado.
- **Recusou** → só **vitrine da casa e parceiros diretos** (sem cookie de
  terceiro), e **nenhum script do Google carrega** (decidido, seção 14).
  Anúncio "não personalizado" do Google também grava cookie de frequência e
  fraude, então só volta à mesa com uma leitura jurídica da LGPD.
- **Configurações → Privacidade** ganha o interruptor "Anúncios
  personalizados", ao lado do de estatísticas (o `settings.js` já tem o
  padrão).
- **Política de privacidade e Termos** reescritos nos 3 idiomas (seções
  `thirdparty`, `cookies`, nova seção `ads`, afiliados), com data, e uma
  entrada em Novidades explicando **por que** o site passou a ter anúncios e
  quais regras ele segue. Público nerd perdoa anúncio; não perdoa surpresa.

---

## 10. Arquitetura técnica

Segue o padrão do repo: sem build, JS global, módulo frio fora do `shared.js`.

```
src/ads.js           módulo sob demanda (como scan.js e backup-import.js)
data/ads.json        config: liga/desliga, espaços, cadeia de fornecedores,
                     campanhas diretas — é também o KILL SWITCH (chega em ≤1 h
                     pelo cache de data/*, sem deploy de código)
ads.txt              google.com, pub-XXXXXXXX, DIRECT, f08c47fec0942fa0
functions/_vitrine-csp.js  nonce da CSP, só nas rotas com anúncio (uma
                     Function por página de catálogo chama este módulo)
```

**O espaço.** Um `<aside class="vtr-espaco vtr-faixa">` com a posição e o
criativo em `data-vitrine-*` (o que existe desde a fase 0 está descrito no
README, seção "Vitrine"). O `ads.js` escolhe o fornecedor pela cadeia do
`ads.json` — `direto → adsense → casa` — e só pede o anúncio quando o espaço
chega a ~1 tela de distância (`IntersectionObserver`). O script do AdSense
desce uma vez, depois do `load` e em ocioso, e só se: a página tem espaço,
há consentimento, não há `saveData` e o `ads.json` está ligado.

**Na grade.** As grades já são re-renderizadas a cada filtro/ordem. A regra de
posição (depois da linha N, a cada M linhas, teto T) é uma função pura, por
colunas visíveis, testada com `node:test`. Filtrar reposiciona as faixas
existentes; **não** pede anúncio novo (o AdSense proíbe atualizar anúncio sem
pedido do usuário, e não precisamos disso).

**CSP — a peça mais delicada.** Até a fase 0 a política era única pro site
todo. A fase 1 separa por rota (como ficou de fato: ver "O que mudou no
caminho" da fase 1, seção 13):

- **rotas sem anúncio** (login, conta, coleção, configurações, tudo do grupo
  C/zero): **continuam exatamente com a CSP de hoje**. Nenhum script de
  terceiro onde vive a sessão;
- **rotas com anúncio**: a CSP estrita que o Google suporta
  (`script-src 'nonce-…' 'strict-dynamic' …; object-src 'none'; base-uri
  'none'`), com o nonce posto por uma Function por página
  (`functions/_vitrine-csp.js`) que carimba o mesmo
  valor no header e em cada `<script>` via `HTMLRewriter` — o padrão que o
  `functions/detail.js` e o `functions/users/[handle].js` já usam. Os HTML do
  repo não mudam.

Pontos pra conferir no preview antes de confiar: (1) resposta de Function
montada a partir do `env.ASSETS.fetch` **mantém** as regras do `_headers`
(conferido no `/detail`), então os outros cabeçalhos de segurança seguem
valendo e só a CSP é trocada; (2) o service worker guarda header e corpo
juntos, então o par nonce/HTML continua coerente na página servida do cache;
(3) Functions no plano grátis têm cota diária de requisições — com muito
tráfego nas páginas pré-renderizadas, o plano pago do Workers (~US$ 5/mês)
entra na conta. Alternativa considerada e descartada: CSP por hash com
`strict-dynamic` exigiria trocar todo `<script src>` do `<head>` por um
carregador (scripts inseridos pelo parser são bloqueados nesse modo), mexendo
em 30 páginas e na ordem que o `check.mjs` vigia.

**Páginas pré-renderizadas.** O `prerender-catalog.mjs` ganha os espaços no
molde de `/card`, `/set` e `/deck`, e o `<script>` do carregador.

**Medição.** `ad_view` e `ad_click` na whitelist do `events_guard` (migração
nova) e no `EVENTOS` do `shared.js`; painel no /admin por espaço e campanha.
A receita do AdSense vem do próprio AdSense, com **um bloco por
tipo de espaço × aparelho** (ex.: `set-feed-mob`), pra comparar RPM por
posição.

**i18n.** Chaves novas nos três idiomas: rótulo ("Publicidade" /
"Advertisement" / "Publicidad" — o AdSense só aceita esse rótulo ou "Links
patrocinados"), "Por que anúncios?", aviso de consentimento, interruptor,
vitrine da casa, entrada do FAQ, textos legais.

**Guardas no CI.** `check-mobile.mjs`: a vitrine reserva altura e o link tem
44 px. Testes: posição na grade, cadeia de fornecedor, kill switch, "sem
consentimento não carrega script do Google", e o site boota igual com
`src/ads.js` bloqueado. `check.mjs` já pega chave faltando.

**Apoiador sem anúncio** (decidido). Quem apoia pelo Pix ou pelo Ko-fi navega
sem **nenhum** anúncio: nem AdSense, nem trilho, nem a oferta patrocinada do
popup, nem a vitrine da casa pedindo apoio (não faz sentido pedir a quem já
apoiou). Os links de loja continuam, porque não são anúncio: são o caminho
pra comprar a carta. Nenhuma função do app fica trancada — não é plano pro.

- **Onde mora:** `profiles.apoiador_ate` (data). Vale até o fim do dia
  gravado; vazio ou vencido = anúncios normais. Data, e não um sim/não, porque
  o Pix é avulso: cada apoio compra um período, e o Ko-fi mensal só renova a
  data.
- **Quem grava:** só o dono do site. O mesmo trigger que protege o
  `is_admin` (`profiles_admin_guard`, ver docs/BACKEND.md) passa a devolver
  `apoiador_ate` ao valor anterior em escrita vinda da API — sem isso, a
  policy "dono edita a própria linha" deixava qualquer conta se marcar como
  apoiadora com um PATCH. No começo a marcação é à mão (SQL Editor ou um
  campo no /admin); webhook do Ko-fi numa Function é passo posterior.
- **Como o app lê:** junto do perfil que o login já carrega; o `ads.js`
  confere antes de montar qualquer espaço. Deslogado não tem como ser
  apoiador, então vê anúncio — e o aviso "Por que anúncios?" diz como
  apoiar e entrar.
- **O que aparece pra quem apoia:** um selo discreto no menu de conta
  ("Apoiador · sem anúncios até 27/10") e, no lugar dos espaços, nada — a
  grade fica exatamente como é hoje.

**App instalado.** PWA rodando no navegador é site pra política do AdSense.
Se um dia o Sleevu for pra Play Store embrulhado (TWA/WebView), aí vale a API
de WebView pra anúncios — reavaliar nesse momento.

---

## 11. Aprovação no AdSense — o risco real

A política do Google proíbe anúncio em "conteúdo gerado automaticamente sem
revisão ou curadoria manual" e em telas "sem conteúdo do publisher ou de baixo
valor" ou usadas pra navegação/ação
([11112688](https://support.google.com/publisherpolicies/answer/11112688)).
Milhares de páginas montadas a partir de APIs são exatamente o que o revisor
olha com desconfiança. O que joga a favor e o que fazer:

- As páginas pré-renderizadas de carta **já foram escritas pra não serem
  rasas** (parágrafo com fatos que variam por carta, preço, versões) — manter
  anúncio só onde há esse conteúdo; carta sem imagem nem preço não ganha
  espaço.
- Conteúdo editorial ajuda na aprovação e no SEO ao mesmo tempo: Lore,
  Lançamentos, Novidades e guias curtos ("condição NM × SP na prática", "como
  reconhecer carta falsa", "vale a pena graduar?").
- Sobre, Ajuda, FAQ, Privacidade e Termos já existem — é o que o revisor pede.
- Pedir a aprovação **com os espaços só nos grupos A e B** e a política nova
  publicada. As telas pessoais nunca entram (e o robô nem as vê).

---

## 12. Métricas e guarda-corpos

**Receita:** RPM por espaço e aparelho, taxa de preenchimento,
visibilidade (meta >70%), CTR — CTR alto demais é sinal de clique acidental e
risco de política, não de sucesso.

**Experiência (o que manda):** o lançamento é **gradual com grupo de
controle** — 50% dos visitantes (pelo hash do id anônimo que o analytics já
tem) veem anúncio por 2–4 semanas. Compara-se, entre os dois grupos: páginas
por sessão, retorno em 7 dias, `card_added`, `signup`, instalação do PWA, e
CLS/LCP (Cloudflare Web Analytics).

**Critério de recuo, combinado antes:** se o grupo com anúncio cair mais que
~5% em retorno de 7 dias ou em cadastro de carta, reduz densidade (menos
faixas, só grupo A) antes de ligar pra todo mundo. CLS acima de 0,1 em
qualquer página com espaço é bug, não custo.

---

## 13. Fases

### Fase 0 — Fundação (nenhum anúncio de terceiro ainda) ✔ 2026-09-27
- [x] Política de privacidade (seção nova "Publicidade e links de loja", com
      `id="anuncios"`), Termos e FAQ "Por que o Sleevu tem um espaço de
      anúncio?" (pt/en/es), mais uma entrada em Novidades explicando o porquê
- [x] Espaço (CSS `vtr-*` numa folha por área, tokens, claro/escuro, 44 px) +
      `src/ads.js` com posição na grade, trilho e vitrine da casa
- [x] `data/ads.json` com kill switch; espaços no grupo B (grupo A foi pra
      fase 1, ver abaixo)
- [x] Aviso de consentimento (dormente até a cadeia ter `adsense`) +
      interruptor em Configurações → Privacidade
- [x] `ad_view`/`ad_click` (migração `20260927a` + `EVENTOS`) e aba
      Mercado › Vitrine no /admin
- [x] Afiliados TCGplayer e eBay nos chips + nota de comissão — **IDs vazios**
      até o cadastro nos programas (Impact e eBay Partner Network, é do
      Fernando); com os IDs, é preencher o `AFILIADOS` no `shared.js`
- [x] Testes (`tests/vitrine.test.mjs`) e guardas de CI (check.mjs guarda 9:
      `ads.js` proibido em página pessoal/conta/institucional)

O que mudou no caminho, e por quê:

- **Grupo A (páginas pré-renderizadas) foi pra fase 1.** Elas só carregam o
  `theme.js` (sem `shared.js`, sem tradução, com CSS próprio no molde) e vão
  precisar da CSP com nonce de qualquer jeito — entram junto.
- **Sem o criativo "instale o app".** O convite de instalação já existe
  (`initInstallInvite`) e aparece uma vez só, pra quem tem 10+ cartas, de
  propósito. Repetir o pedido na vitrine desfaria essa decisão.
- **Trilho a partir de 1888 px**, não 1800: a moldura tem 184 px (o 160×600 +
  borda), e com a folga até a grade e até a borda a conta fecha em 1888.
- **Galeria de decks só com trilho.** Ela recria o próprio contêiner a cada
  render, então não há grade estável pra faixa.
- **Prefixo `vtr-` no CSS e aba `anuncios` no /admin**, não "vitrine": essa
  palavra já é a aba de coleções em cards da Coleção, e a guarda de CSS por
  área do `check.mjs` a leria como a classe.
- **Medido na tela real** (1440, 1920 e 390 px, claro e escuro): o CLS da
  página de set é o mesmo com e sem vitrine; no desktop a 1ª faixa cai na 4ª–5ª
  linha (as cartas fora da tela têm altura estimada pelo `content-visibility`,
  então a medida é aproximada — ajusta-se no `primeira` do JSON).

### Fase 1 — AdSense
- [ ] Conta AdSense (é do Fernando) + linha no `ads.txt` + `<meta
      name="google-adsense-account">` no `index.html`; **3 blocos de display
      de tamanho fixo** (728×90, 300×250, 160×600); **Auto ads, vinheta e
      âncora desligados**. Com o `ca-pub` e os 3 IDs, é preencher o `adsense`
      do `data/ads.json` — o teste de vitrine exige os três lugares com o
      mesmo `pub`
- [ ] Espaços no grupo A (páginas pré-renderizadas de carta, set, deck e
      artista), no molde do `prerender-catalog.mjs` — PR própria
- [x] Fornecedor `adsense` no `ads.js`, dormente até o `ca-pub` (2026-09-28)
- [x] CSP por rota com nonce; conferido no runtime local do Cloudflare
      (`wrangler pages dev` sobre o build de produção): 0 violação nas 9
      páginas, pt e en
- [x] UE/UK/CH sem rede de anúncio (no lugar do CMP, seção 9)
- [ ] Apoiador sem anúncio (seção 10): `profiles.apoiador_ate` + guarda no
      trigger + leitura no `ads.js` + selo no menu de conta. Entra **antes**
      do lançamento a 100%: a saída pra quem não quer anúncio tem que existir
      no dia em que o anúncio chega (o Archidekt faz o mesmo com o Patreon).
      PR própria; depende do valor do período (seção 14, em aberto)
- [ ] Pedido de aprovação; lançamento a 50% com grupo de controle; ajustar
      densidade pelos números; então 100%

O que mudou no caminho, e por quê:

- **Uma Function por página, não `_middleware.js`.** Middleware roda em toda
  requisição do site (asset, `data/*`, API) e gasta a cota diária de Functions
  à toa. Cada página de catálogo ganhou um arquivo de 3 linhas em
  `functions/` que chama o `_vitrine-csp.js`; o `/detail` já tinha Function e
  só passou a embrulhar a resposta. Um teste garante que toda página com
  `ads.js` tem a rota, e que nenhuma rota põe a CSP larga numa página sem
  vitrine.
- **O `_headers` global não mudou.** A Function parte da CSP que o asset já
  traz e troca só `script-src` (nonce + `strict-dynamic`) e soma `https:` em
  imagem, iframe e conexão. `object-src`, `base-uri`, `frame-ancestors`,
  `form-action` e `worker-src` ficam iguais — conferido por teste contra o
  `_headers` real.
- **Dois scripts precisaram do nonce na mão.** Com `strict-dynamic`, script
  escrito por `document.write` conta como "do parser": o `theme.js` repassa o
  próprio nonce pro `<script>` do i18n (sem isso a página mostrava as chaves
  cruas). E o `<link rel="preload" as="script">` do i18n em português também
  recebe o nonce na borda.
- **Sem 304 nas páginas com nonce.** O HTML guardado teria o nonce velho e o
  cabeçalho novo, o nonce novo: todos os scripts bloqueados. A Function busca
  o asset sem `If-None-Match`, tira `ETag`/`Last-Modified` e responde
  `private, no-cache`.
- **Um bloco por FORMATO, não por espaço × aparelho.** A faixa de 728×90 só
  cabe no desktop e o 300×250 é o do celular (e da grade estreita), então o
  formato já separa o aparelho; o trilho é o terceiro. Se o RPM por página
  importar, dá pra ramificar o `blocos` do JSON depois sem mudar o desenho.
- **Faixa recolocada vira casa.** O AdSense proíbe atualizar anúncio sem ação
  da pessoa, e mover o iframe no DOM recarrega. Então, quando um filtro
  reposiciona as faixas, a que já tinha anúncio pedido troca pelo conteúdo da
  casa (mesma altura, nada salta) — nunca pede outro sozinha.
- **Sem anúncio, a caixa vira casa.** `unfilled`, bloqueador, script que não
  carrega ou 10 s sem resposta: o mesmo espaço mostra a vitrine da casa.
  Espaço vazio com rótulo "Publicidade" parece site quebrado.
- **Conferido com um `adsbygoogle.js` falso** no runtime local: aceitou
  (desktop e 390 px), sem anúncio, bloqueador, recusou (script nem desce),
  não respondeu (aviso, script não desce), Alemanha (nem aviso, nem script) e
  filtro depois do anúncio pedido (vira casa, um pedido só).

### Fase 2 — Rede premium (≥ ~100 mil pageviews/mês)
- [ ] Candidatura à Nitro e/ou Playwire (ou Journey, se o tráfego anglófono
      bater 1.000 sessões/mês); A/B contra o AdSense; `ads.txt` atualizado

### Fase 3 — Venda direta
- [ ] Página `/anuncie` com kit de mídia; primeiras campanhas por jogo e
      lançamento via `ads.json`; oferta de loja parceira no popup
- [ ] Com 2–3 anunciantes: Google Ad Manager na frente, AdSense de reserva

---

## 14. Decisões do Fernando (27/09/2026 — não reabrir sem motivo novo)

1. **Páginas pessoais com anúncio? Não.** Coleção, Portfólio, Wishlist,
   Binders, Pastas, Vendas, Meus decks, Hub pessoal e Badges ficam sem
   anúncio. É onde o usuário fiel passa o tempo e onde a política do Google é
   mais restritiva. Motivo novo pra reabrir seria o /admin mostrar que o
   catálogo sozinho não sustenta a receita — e mesmo aí a conversa começa
   pelo Hub pessoal, nunca pelas telas de cadastro.
2. **Quem recusa o consentimento vê anúncio não personalizado do Google?
   Não.** Recusou = vitrine da casa e parceiros diretos, e o script do Google
   nem carrega. Só volta à mesa com uma leitura jurídica da LGPD sobre os
   cookies de frequência/fraude do anúncio não personalizado.
3. **Apoiador navega sem anúncio? Sim.** Pix ou Ko-fi compram um período sem
   anúncio (`profiles.apoiador_ate`, seção 10), sem trancar função nenhuma.
   Entra na fase 1, antes do lançamento a 100%.
4. **Afiliado nos links de loja? Sim**, com a linha de transparência embaixo
   dos chips e na política. Não muda preço, ordem nem quais lojas aparecem.
   Entra na fase 0.
5. **Trilho lateral em tela larga? Sim** (≥1888 px, na margem vazia). Se
   parecer poluído no uso real, é o primeiro a sair.

**Ainda em aberto (não bloqueia a fase 0):**

- **Quanto vale o período de apoiador.** Sugestão pra começar: qualquer apoio
  a partir de R$ 10 (ou o mensal do Ko-fi) = 30 dias sem anúncio, somando
  quando a pessoa apoia de novo antes de vencer. Precisa estar definido antes
  da fase 1, porque vai no texto do "Por que anúncios?".

---

## Fontes (consultadas em 27/09/2026)

- AdSense, participação na receita: <https://support.google.com/adsense/answer/180195>
- AdSense, CSP (só estrita com nonce): <https://support.google.com/adsense/answer/16283098>
- GPT, CSP: <https://developers.google.com/publisher-tag/guides/content-security-policy>
- AdSense, vinhetas (gatilhos de 2026): <https://support.google.com/adsense/answer/16531962>
- Políticas de publisher (conteúdo automático, telas sem conteúdo): <https://support.google.com/publisherpolicies/answer/11112688>
- Posicionamento e clique acidental / atualização de anúncio: <https://support.google.com/adsense/answer/1346295>
- CMP certificado (UE/UK/CH): <https://support.google.com/adsense/answer/13554116>
- Privacidade e mensagens: <https://support.google.com/adsense/answer/10924669>
- Ad Manager e AdSense de reserva: <https://support.google.com/admanager/answer/7084151>, <https://support.google.com/admanager/answer/1670087>
- Requisitos Journey/Mediavine: <https://www.mediavine.com/mediavine-requirements/>
- Raptive 25 mil + geografia: <https://www.searchenginejournal.com/raptive-drops-traffic-requirement-by-75-to-25000-views/558780/>
- Ezoic 250 mil: <https://support.ezoic.com/kb/article/getting-started-ezoics-requirements>
- Nitro × Playwire × Venatus (requisitos): <https://blog.nitropay.com/nitro-vs-playwire-vs-venatus-which-ad-network-is-right-for-gaming-publishers/>
- TCGplayer afiliado: <https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program>
- eBay Partner Network, cartas: <https://partnernetwork.ebay.com/page/trading-cards>
- Amazon Associados BR, tabela: <https://associados.amazon.com.br/welcome/compensation>
- ANPD, guia de cookies: <https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf>
- Cloudflare Pages, `_headers` (`!` pra tirar header; Functions não recebem): <https://developers.cloudflare.com/pages/configuration/headers/>
- RPM (confiança baixa): <https://www.digitalapplied.com/blog/display-advertising-benchmarks-2026-data-points>, <https://toolsignal.site/articles/blog-display-ad-rpm-by-niche-2026>

Não verificado: participação da Nitro, taxas da Card Kingdom, regras da
Journey pra site fora do WordPress, se o CMP do Google é grátis, AdSense em
app da Play Store (TWA), e o `ads.txt` de LigaMagic, Cardmarket e TCGplayer
(bloqueados pra leitura automática).
