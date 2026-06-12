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
- cada carta mostra uma bandeirinha do seu idioma (Inglês, Japonês, Chinês, Português-BR) e a imagem no idioma da própria carta;
- a página Sets tem um filtro mestre por origem — Internacional (inglês e demais ocidentais), Japonês e Chinês — e mostra a data de lançamento de cada set no canto da imagem;
- na Pokédex, filtra por geração (chips), por região/local (Kanto, Johto…) e por tipo (Fogo, Voador…);
- na página de um Pokémon, mostra tipos, região, geração, botão de favoritar e as formas alternativas;
- aba **Treinadores** (no menu Pokémon) agrupando as cartas de Treinador por nome, com filtro por origem (Internacional/Japonês/Chinês).

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

O site publicado usa o **catálogo completo da TCGdex** em quatro idiomas (en, ja, zh-tw, pt). O workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) roda a cada push e toda segunda-feira: sincroniza os catálogos (com cache incremental entre execuções), mescla tudo com `scripts/merge-catalogs.mjs` (ids com sufixo de idioma; espécies canonizadas via dexId usando o catálogo en), troca as páginas para o modo manifest (chunks por set carregados via fetch) e publica no GitHub Pages via artifact — nada de dados gerados vai para o git. Localmente o app continua usando o catálogo de exemplo (`data/cards.js`).

## Próximos passos recomendados

- **Binders**: criar fichários 2x2 e 3x3, nas categorias Owned e Wanted, com slots preenchidos arrastando/escolhendo cartas do catálogo;
- **Portfolio**: valor estimado da coleção usando os preços da TCGdex (Cardmarket EUR / TCGplayer USD, por variante), com possibilidade de portfolios separados e uma visão agregada (o sync precisará capturar o campo `pricing`);
- adicionar IndexedDB se a coleção crescer muito;
- gerar índice de busca com MiniSearch/FlexSearch;
- adicionar sync automático com GitHub Actions quando o app for para host.
