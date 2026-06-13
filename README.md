# TCG Collector MVP

MVP local-first para testar a arquitetura de um colecionador de Pokémon TCG sem backend obrigatório.

## Como abrir

Online: https://fexpepe.github.io/tcg-collector/

Local: abra `index.html` no navegador (home) ou `pokedex.html` (direto no app). A coleção é salva no `localStorage` do próprio navegador. Para servir via HTTP (necessário para o modo manifest e para a PokéAPI em algumas configurações): `npx http-server -p 4173 .`

## O que já faz

- lista cartas de um catálogo local;
- busca por nome, set, artista, raridade, idioma, número e variante;
- filtra por set, idioma e status da coleção;
- rastreia a coleção por variante **e condição** (escala LigaPokémon: M, NM, SP, MP, HP, D) — ao marcar entra como NM por padrão, e o preview da carta tem um stepper por condição; cada cópia fica distinguida por condição (base para o cálculo futuro do valor do portfólio);
- página Coleção com todas as cartas marcadas e filtros por Pokémon, set, idioma e raridade;
- botão rápido "tenho" marca a primeira variante (ou limpa a carta toda);
- mostra progresso básico (cartas distintas com ao menos uma variante);
- exporta/importa a coleção em JSON (formato v2 por variante; importa também o formato v1 antigo);
- seletor de idioma no topo (Português/English) que traduz a interface do site;
- cada carta mostra uma bandeirinha do seu idioma (Inglês, Japonês, Chinês (Tradicional), Português-BR) e a imagem no idioma da própria carta;
- a página Sets tem um filtro mestre por origem — Inglês, Português, Japonês e Chinês (Tradicional) — e mostra a data de lançamento de cada set no canto da imagem;
- na Pokédex, filtra por geração (chips), por região/local (Kanto, Johto…) e por tipo (Fogo, Voador…);
- na página de um Pokémon, mostra tipos, região, geração, botão de favoritar e as formas alternativas;
- aba **Treinadores** (no menu Pokémon) agrupando as cartas de Treinador por nome, com filtro por origem (Internacional/Japonês/Chinês (Tradicional));
- lista **"Eu quero"** (wishlist) por variante: o botão de coração nos tiles marca/desmarca o desejo, a página `wishlist.html` reúne tudo com filtros (Pokémon/set/idioma), e marcar uma carta como "tenho" a move da wishlist para a coleção ("comprei!"). A wishlist fica no `localStorage` (`tcg-collector-wishlist-v1`, `cardId -> [variantes]`) e entra junto no export/import JSON;
- **imagens resilientes a outage**: um service worker ([sw.js](sw.js)) cacheia (cache-first) toda imagem de carta já vista no navegador, então a coleção continua com imagens mesmo se o CDN da TCGdex cair (acontece — é servidor comunitário); só imagens são cacheadas, nunca HTML/JS, pra o app nunca ficar preso numa versão velha após deploy. Além disso, as cartas **EN** têm uma cadeia de fallback no `onerror`: `low.webp` → `high.png` (TCGdex) → `images.pokemontcg.io` (outro host) — cobre a primeira visualização de uma carta nunca vista durante um outage. Cartas pt/ja/zh não têm fonte alternativa, então dependem só do cache;
- **preço BR manual + Portfólio**: no preview da carta, cada variante tem campos de preço em R$ por condição (M/NM/SP/MP/HP/D) e links para conferir o valor na LigaPokémon, LigaBRA e MYP (nenhum tem API pública — o registro é manual, com a fonte e a data guardadas em `tcg-collector-prices-v1` para o futuro preenchimento automático via worker). A página `portfolio.html` soma o valor da coleção (condições sem preço próprio são estimadas do NM: SP 85%, MP 70%, HP 50%, D 30%), conta as cópias precificadas, calcula o custo da wishlist e lista as cartas mais valiosas. Os preços entram no export/import JSON.

Tipos e formas (na página de um Pokémon) vêm da [PokéAPI](https://pokeapi.co/) em runtime (por `dexId`), com cache no `localStorage`; região e geração são derivadas localmente. O filtro de tipo da Pokédex usa um mapa estático `data/pokemon-types.js` (dexId → tipos), gerado por `node scripts/sync-pokemon-types.mjs` a partir do endpoint `/type` da PokéAPI. Sem rede, a página ainda mostra região, geração e favoritar — só os tipos/formas ficam ausentes. Favoritos ficam no `localStorage` (chave `tcg-collector-favorites-v1`), separados das cartas marcadas.

## Como atualizar dados depois

O app usa `data/cards.js` por padrão para funcionar direto via arquivo local. Para gerar um catálogo a partir da TCGdex:

```bash
node scripts/sync-tcgdex.mjs pt                  # catálogo completo em pt
node scripts/sync-tcgdex.mjs en --sets base1     # apenas sets específicos
node scripts/sync-tcgdex.mjs pt --force          # ignora o cache e baixa tudo de novo
node scripts/sync-tcgdex.mjs pt --concurrency 4  # menos requisições paralelas (padrão: 8)
```

O script baixa com requisições paralelas, refaz tentativas com backoff em erros de rede/429/5xx e guarda cada set em `data/.cache/<idioma>/`. Se a execução for interrompida, basta rodar de novo: os sets já baixados vêm do cache e só o que falta é buscado. Cartas que a API não encontra (404) são puladas com aviso, sem abortar o sync.

O sync gera três saídas:

- `data/cards.generated.js` — catálogo completo num arquivo só (funciona via `file://`);
- `data/indexes.generated.js` — agrupamentos prontos de Pokédex, sets e artistas;
- `data/manifest.generated.js` + `data/sets/<idioma>/<setId>.json` — catálogo dividido por set, carregado sob demanda via `fetch`.

Para usar o catálogo completo num arquivo só, troque em todas as páginas:

```html
<script src="data/cards.js"></script>
<script src="data/indexes.js"></script>
```

por:

```html
<script src="data/cards.generated.js"></script>
<script src="data/indexes.generated.js"></script>
```

Para o modo dividido por set (recomendado para catálogos grandes), use:

```html
<script src="data/manifest.generated.js"></script>
<script src="data/indexes.generated.js"></script>
```

Nesse modo as páginas de listagem baixam os chunks em paralelo e a página de detalhe baixa apenas os sets que contêm as cartas exibidas. Como usa `fetch`, precisa ser servido via HTTP (ex.: `npx http-server -p 4173 .`) em vez de aberto direto como arquivo.

A coleção fica no `localStorage` em `tcg-collector-collection-v2` (`cardId -> { variante: quantidade }`). Coleções no formato antigo (`tcg-collector-owned-v1`, lista de ids) são migradas automaticamente na primeira visita — cada carta vira a primeira variante com quantidade 1 — e a chave antiga é mantida como backup.

## Deploy e catálogo em produção

O site publicado usa o **catálogo completo da TCGdex** em quatro idiomas (en, ja, zh-tw, pt). O chinês é o **tradicional** (zh-tw, produto de Taiwan/Hong Kong): o catálogo simplificado (zh-cn, produto da China continental — o que mais se compra no Brasil) ainda é um esqueleto na TCGdex (8 sets com cartas, **nenhuma imagem**, nomes emprestados do tradicional), então não vale a troca por ora; reavaliar quando a TCGdex populá-lo. O workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) roda a cada push e toda segunda-feira: sincroniza os catálogos (com cache incremental entre execuções), mescla tudo com `scripts/merge-catalogs.mjs` (ids com sufixo de idioma; espécies canonizadas via dexId usando o catálogo en), troca as páginas para o modo manifest (chunks por set carregados via fetch) e publica no GitHub Pages via artifact — nada de dados gerados vai para o git. Localmente o app continua usando o catálogo de exemplo (`data/cards.js`).

## Próximos passos recomendados

- **Binders**: criar fichários 2x2 e 3x3, nas categorias Owned e Wanted (reaproveitando a wishlist), com slots preenchidos arrastando/escolhendo cartas do catálogo;
- **Prioridade na wishlist**: estender `tcg-collector-wishlist-v1` para guardar prioridade por variante e ordenar a página Quero por "mais quero";
- **Preços TCGdex**: capturar o campo `pricing` (Cardmarket EUR / TCGplayer USD, por variante) num artefato separado dos chunks (preço muda toda semana; o cache de sets não), convertendo para R$ via API de câmbio como fallback de quem não registrou preço manual;
- **Worker de preços BR**: serviço opcional (Cloudflare Worker) que busca o preço médio por condição na LigaBRA/LigaPokémon e preenche os mesmos campos de `tcg-collector-prices-v1` (fonte registrada, valor sempre editável). MYP fica só como deep link — tem proteção anti-bot;
- **Chinês simplificado (zh-cn)**: adicionar ao deploy quando a TCGdex tiver o catálogo com imagens (hoje só 8 sets sem imagem) — é uma linha no sync + merge;
- adicionar IndexedDB se a coleção crescer muito;
- gerar índice de busca com MiniSearch/FlexSearch;
- adicionar sync automático com GitHub Actions quando o app for para host.
