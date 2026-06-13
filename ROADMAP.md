# Roadmap & estado do projeto

Resumo do que já existe e do que vem a seguir, para retomar o contexto em qualquer
sessão (local ou na nuvem) só pelo Git. Complementa o `README.md` (que documenta a
arquitetura) — aqui é o **plano** e as **decisões**.

Tese do projeto: um colecionador de Pokémon TCG **grátis, open source, local-first,
em português, com valores localizados pro Brasil**. Não é concorrente do Collectr — é
a alternativa livre. No futuro, só o salvar na nuvem poderá ser um extra pago opcional;
todo o resto continua livre.

---

## ✅ Já implementado

- **Home** com manifesto ("por que existe"), seção de roadmap, apoio (café/Pix/Ko-fi)
  e rodapé com aviso de marcas. ⚠️ Pix e Ko-fi ainda são placeholders (ver pendências).
- **Wishlist "Eu quero"** (`tcg-collector-wishlist-v1`): coração por variante nos tiles,
  página `wishlist.html`, e "comprei!" (marcar como tenho move da wishlist pra coleção).
- **Preço BR manual + Portfólio**: campos de preço em R$ por condição no preview da carta,
  links de busca Liga/LigaBRA/MYP, e `portfolio.html` com valor da coleção (condições sem
  preço estimadas do NM), custo da wishlist e cartas mais valiosas. `tcg-collector-prices-v1`.
- **Preview por variante**: abrir um tile mostra só a variante clicada (não empilha
  Holo/1st Ed/Unlimited); "Marcar como tenho" age só naquela variante.
- **Nome da carta com código** ("Charizard (4/102)") + **busca tolerante** (`matchesCardQuery`):
  casa por nome, código ("4/102" ou "4") e nome+código; memoizada por carta.
- **Filtro de status** (página de detalhe): Todas / Tenho / Faltando / **Quero**.
- **Filtro de raridade** (multi-seleção, chip "Todas"): buckets Comuns e raras /
  Descontinuadas / Ultra Rare / Illustration Rare / Special Illustration; entende en/pt/ja.
- **Chinês = Tradicional (zh-tw)** rotulado na UI. zh-cn (simplificado) ainda não dá: é
  esqueleto sem imagens na TCGdex.
- **TCG Pocket (digital) excluído** do sync (`DIGITAL_SERIES = ["tcgp"]`); flag
  `--include-digital` pra incluir.
- **PWA instalável e offline**: `manifest.json` + `icon.svg` + `apple-touch-icon.png`;
  service worker pré-cacheia o app shell e cacheia dados/imagens.
- **Imagens otimizadas e resilientes**: webp (grid usa `low.webp` ~17KB), fallback EN pra
  `images.pokemontcg.io` via de-para versionado `data/set-id-map.js` (gerado por
  `scripts/build-set-id-map.mjs`); cartas sem imagem vão pro fim da lista.
- **Pokédex**: contorno dourado nos Pokémon que já tenho; roda **só com índices** (não
  baixa o catálogo) e usa sprite pequeno (~1KB) no grid.
- **SEO/perf**: `sitemap.xml`, `robots.txt`, preconnect, `fetchSetChunks` com concorrência
  limitada.

---

## 🔜 Próximos passos (em ordem de prioridade)

### 1. Preferência de idioma de carta — ALTÍSSIMO impacto
**Problema:** o catálogo mistura 4 idiomas (en/ja/zh-tw/pt) em tudo. O seletor pt/en só
troca a interface, não quais cartas aparecem. Resultado: ruído visual (mesma carta repetida
em 4 línguas) e "progresso" sempre ~0% (é `tenho ÷ 48.058` de todas as línguas; completar
uma espécie exigiria ter as 4 versões).

**Proposta:** preferência global de idioma de carta ("PT-BR", "Internacional/EN", "Todos")
no `localStorage`, aplicada como padrão nas listas e **nos contadores de progresso**. Vira
"você tem 312/1025 em PT-BR" — útil de verdade. Destrava os itens 2 e 3.

### 2. Sets/Artistas/Treinadores sem baixar o catálogo — alto
Hoje ainda baixam as ~48k cartas (a busca casa campos de carta, então não dá index-only de
graça como a Pokédex). Fechar isso = **enriquecer os índices no build** (`merge-catalogs.mjs`):
guardar por set logo/símbolo/data/total e um texto de busca por grupo. Com o item 1, dá pra
baixar só os chunks do idioma escolhido.

### 3. Ajustes de UX da página Sets — médio
- Sets abre filtrado em "Inglês" por padrão (`selectedLangRegion = "english"` em `app.js`) —
  deveria seguir a preferência de idioma (item 1) ou começar em "Todos".
- Realce de "completo" (100%) nos cards de set/artista, como o dourado da Pokédex.

### 4. Plugar Pix e Ko-fi reais na home — trivial
Em `index.html`, seção de apoio: trocar `data-pix="SUA-CHAVE-PIX-AQUI"` pela chave Pix real
e o `href` do Ko-fi (`https://ko-fi.com/fexpepe`) pelo link real. Marcados com `<!-- TODO -->`.

### 5. Binders 2×2 / 3×3 — recurso-assinatura (do plano original)
Fichários visuais de "tenho" e "quero" (slots preenchidos por clique), com exportar como
imagem pra compartilhar. O botão placeholder já existe nos tiles.

---

## 💡 Backlog / ideias

- **Worker de preços BR** (Cloudflare Worker opcional): busca preço médio por condição na
  LigaBRA/LigaPokémon e preenche `tcg-collector-prices-v1` (fonte registrada, editável). MYP
  só deep link (tem anti-bot). CORS impede fazer direto do navegador.
- **Preços internacionais TCGdex** (Cardmarket EUR / TCGplayer USD) capturados no sync como
  artefato separado dos chunks + conversão pra R$ via API de câmbio, como fallback de quem
  não registrou preço manual.
- **zh-cn (chinês simplificado)**: adicionar ao deploy quando a TCGdex tiver imagens.
- **Prioridade na wishlist**: ordenar a página Quero por "mais quero".
- **Raridade em zh-tw**: a TCGdex traz a maioria das cartas zh sem raridade (campo vazio).

---

## Notas de arquitetura (atalhos)

- Sem build/bundler: HTML estático + JS global em `src/*.js`, `shared.js` é o núcleo
  (stores, i18n, render, preview, busca, imagens, service worker).
- Stores no `localStorage`: coleção `…-collection-v3`, wishlist `…-wishlist-v1`,
  preços `…-prices-v1`, favoritos `…-favorites-v1`, idioma da UI `…-ui-lang-v1`.
- Catálogo: local usa `data/cards.js` (amostra); produção gera o catálogo completo da
  TCGdex no deploy (modo manifest, chunks por set) — nada de dados gerados vai pro git
  (exceto `data/set-id-map.js`, que é registro curado).
- Export/import: um JSON só com coleção + wishlist + preços; tolerante quando não há
  catálogo carregado (página Pokédex).
