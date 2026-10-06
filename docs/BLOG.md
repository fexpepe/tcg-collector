# Blog

Área de artigos do Sleevu: **/blog** (lista), **/blog/&lt;endereço&gt;** (post),
**/blog/&lt;idioma&gt;/&lt;endereço&gt;** (as traduções) e **/blog-editor** (onde
se escreve). Os posts moram no Supabase e são escritos pelo próprio site —
publicar é instantâneo, sem commit nem deploy.

## Peças

| Onde | O quê |
|---|---|
| `supabase/migrations/20260930b_blog.sql` | tabelas, RLS, triggers, bucket de imagens, papel de editor |
| `supabase/migrations/20261006a_blog_traducoes.sql` | as versões em outros idiomas (`traducoes`, `versoes`), aplicada DEPOIS da 20260930b |
| `src/blog-render.js` | **o** renderizador: Markdown enxuto → HTML seguro, mais cabeçalho do artigo, índice, carta embutida, cartão da lista, compartilhar, "leia também" |
| `functions/blog/[slug].js` | a página do post, montada na borda (SEO, hreflang, cartas do D1, 301, 404) |
| `functions/blog/{pt,en,es}/[slug].js` | as traduções: só dizem o idioma e chamam o `paginaDoPost` do `[slug].js` |
| `functions/blog/index.js` | a lista, montada na borda (filtros da URL já aplicados) |
| `functions/blog/feed.xml.js` | o RSS |
| `functions/blog/_comum.js` | Supabase anônimo, cartas do D1, cache de borda |
| `blog.html` / `blog-post.html` | as cascas (o `blog-post.html` só existe pra Function preencher) |
| `src/blog.js` | o que depende de quem lê: preço na moeda dele, Tenho/Quero, preview, filtros, compartilhar |
| `blog-editor.html` / `src/blog-editor.js` | o editor (texto em pt fixo, como o /admin) |
| `src/i18n-blog.js` | textos de interface da lista e do post (pt/en/es) |

**Um renderizador, dois lugares.** O `src/blog-render.js` é script clássico
(pendura `SleevuBlog` no `globalThis`, sem DOM nem `shared.js`): o navegador o
carrega por `<script>` e as Functions fazem `import "../../src/blog-render.js"`.
É isso que garante que a prévia do editor é a página publicada. No deploy o
`hash-assets.mjs` renomeia o arquivo e reescreve o import das Functions (e
reprova o build se algum import apontar pra arquivo que não existe).

## Idiomas (desde 2026-10-06)

O blog fala as línguas do site (pt, en, es) e **o post acompanha a
bandeirinha** (pedido do Fernando). Um post é UMA linha da tabela:

- as colunas de sempre (`title`, `body_md`…) são a versão no idioma
  **original** (`lang`);
- `traducoes` guarda as outras, cada uma com título, linha fina, resumo,
  texto, descrição da capa e SEO. Endereço, capa, jogo, categoria, assuntos e
  datas são do post, valem pras três;
- `versoes` é o resumo leve de cada tradução (sem o texto), calculado pelo
  trigger — é o que a lista e o sitemap leem.

**Endereços.** `/blog/<slug>` é a original e `/blog/<idioma>/<slug>` cada
tradução, com canonical própria e hreflang entre elas (x-default na original).
Pedir `/blog/<idioma>/<slug>` no idioma original dá 301 pro endereço sem
prefixo; tradução que não existe dá 302 pra original.

**Quem lê vai pra versão da bandeirinha.** A borda põe no `<html>` o mapa
idioma → endereço (`data-versoes`), e o `src/theme.js`, que roda antes da
primeira pintura, troca de endereço quando a língua de quem lê tem versão.
Robô não sai do lugar (cada versão é indexada no seu endereço) e o "Ver no
site" do editor (`?fresco=1`) também não. No post, "Leia em" leva às outras
versões — o clique troca o idioma do SITE, senão a página de destino mandaria
de volta. Sem a versão de quem lê, o post sai na original com um aviso.

**Lista.** A borda desenha cada post na original (ela não sabe quem lê); o
`src/blog.js` redesenha na língua de quem lê. Post sem essa versão sai na
original, com a etiqueta do idioma em que está ("In Portuguese").

**No editor**, as abas de idioma em cima do título trocam os campos de texto
que o formulário edita. Versão nova começa com o texto da original (cartas,
imagens e estrutura já no lugar): é só trocar o texto pelo traduzido. Trocar o
"Idioma original" pra um idioma que já tem tradução faz as duas trocarem de
lugar. Salvar grava as três versões juntas (um PATCH só, a mesma trava
otimista), e o histórico guarda as traduções junto.

**Sem ordem com a migração.** Antes da 20261006a, as colunas novas não
existem e o PostgREST responde 400: a borda, o `blog.js` e o sitemap pedem de
novo sem elas e seguem só com as originais. O editor avisa pra aplicar.

## Quem escreve

Papel **próprio**, `blog_editores`, desconectado do `is_admin` (decisão do
Fernando, 2026-09-30): dá pra entregar o blog a outra pessoa sem que ela veja o
/admin, e ser admin não dá acesso ao blog. A tabela é trancada — não se lê nem
se escreve pela API; quem entra e quem sai é decidido no SQL Editor:

```sql
-- pôr alguém (o nome é o que aparece como autor por padrão)
insert into public.blog_editores (user_id, nome)
select id, 'Nome que assina' from auth.users where email = 'pessoa@exemplo.com';

-- tirar
delete from public.blog_editores
 where user_id = (select id from auth.users where email = 'pessoa@exemplo.com');
```

A migração já põe a conta do dono (a única com `is_admin` no dia). Quem é
editor vê "Escrever e editar" em /blog e "Editar este post" em cada post; o
endereço direto é /blog-editor.

## Escrever

A barra do editor escreve a sintaxe; o botão **?** mostra o resumo:

```
## Título de seção        ### Subtítulo         (# vira ##: o H1 é o título do post)
**negrito**  *itálico*  ~~riscado~~  `código`  [texto](https://… ou /sets)
- lista    1. numerada    (2 espaços antes = sub-item)    > citação    ---
![descrição](url "legenda")                    imagem, sozinha na linha
::card[pokemon/base1-4]                        uma carta em destaque
::cards[pokemon/base1-4, pokemon/base1-2]      grade de cartas
:::dica Título  …  :::                          caixa (dica, info, alerta)
| a | b |  +  |---|---|                        tabela
```

- **Cartas** vão por id (`jogo/id`), nunca com preço escrito: a imagem, o nome
  e o preço vêm do catálogo na hora (a borda escreve US$ de referência; o
  navegador troca pela moeda de quem lê). O seletor de cartas do editor usa a
  mesma busca da borda (`/api/search`).
- **Imagens** (capa e corpo) vão pro bucket `blog-media`. O editor reduz no
  aparelho antes de subir: WebP de até 1600 px e uma versão de 640 px, com as
  medidas no nome (`…-w1600h900.webp`) — é daí que a página tira
  width/height (não pula ao carregar) e o `srcset` do celular. GIF sobe como
  veio. Colar ou soltar uma imagem no texto também sobe.
- **Segurança**: nada do texto vira HTML cru. Link só http(s)/mailto/caminho
  do site; imagem só de host liberado na CSP (lista `IMG_HOSTS`, travada contra
  o `_headers` por teste). O teste do renderizador roda ataques conhecidos e um
  fuzz de 3 mil textos.

## Publicar, agendar, histórico

- **Salvar rascunho** / **Publicar**. Com data de publicação no futuro o botão
  vira **Agendar**: o post fica publicado no banco mas invisível (a RLS só
  mostra data passada) e aparece sozinho quando a data chega.
- **Despublicar** volta a rascunho; a data original fica.
- Cada salvamento guarda a versão ANTERIOR de título+texto (as 40 mais novas);
  **Histórico** carrega uma delas no editor (só vale depois de salvar).
- Trocar o endereço de um post que já foi ao ar deixa o antigo respondendo 301.
- O texto fica guardado no aparelho até ser salvo no site; ao reabrir o post,
  o editor oferece recuperar. Se outra aba (ou outra pessoa) salvou o post
  depois que você abriu, o editor avisa em vez de sobrescrever.

## SEO e cache

- A borda entrega o post com título, descrição, canonical, Open Graph (capa),
  JSON-LD `BlogPosting` + `BreadcrumbList` e o texto no HTML.
- Os posts entram no `sitemap-blog.xml` no build (com `lastmod`), um dos
  arquivos do índice `sitemap.xml`; no Search Console, esse sitemap mostra
  quantos posts o Google indexou. O RSS (`/blog/feed.xml`) pega post novo na
  hora.
- Cache: a borda guarda a página por 2 min (`s-maxage`), o navegador revalida
  sempre. `?fresco=1` remonta na hora (é o "Ver no site" do editor).
- A CSP das páginas montadas na borda vem do `_headers` porque a Function parte
  de um `env.ASSETS.fetch` da casca. Resposta montada do zero não herdaria.

## Armadilhas

1. **`<base href="/">` no post.** Os passos de build só entendem caminho
   relativo (`src/…`), e o post mora em `/blog/<slug>`. Por isso a casca tem
   `<base href="/">` — e com ela um `#secao` levaria pra home. O renderizador
   prefixa as âncoras com o caminho do post (`ancora` no `render()`). O
   skip-link não precisa de nada aqui: o `initPageNav` do `shared.js` trata o
   clique dele (foco no `<main>`) em toda página com `<base>`.
2. **Sem `$` dentro de `$$…$$`** na migração (o SQL Editor quebra): o fim do
   texto nos regex do trigger é `\Z`. E o regex do Postgres recusa repetição
   acima de 255 (`{1,6000}` quebrava todo insert).
3. **Tabela de jogos repetida.** A borda não tem o `shared.js`, então o
   renderizador carrega rótulo e cor de cada jogo. Jogo novo no `GAME_COLOR`
   sem entrar no `GAMES` do renderizador reprova o teste (aconteceu com o Star
   Wars no mesmo dia).
4. **Nada do blog no núcleo além do mínimo.** O `shared.js` viaja em toda
   página e vive colado no teto do `check-size`: helpers do blog lá dentro
   estouraram o orçamento por 16 bytes. O endereço e a chave publicável do
   Supabase que o blog usa moram no `src/blog-render.js` (teste trava contra
   os do `shared.js`); do núcleo, o blog só usa o `authedFetch` (o fetch com
   sessão, que renova o token) e os links do menu.
5. **Function não importa de `scripts/`, `docs/`, `tests/` nem `supabase/`.**
   O deploy apaga essas pastas ANTES do `wrangler pages deploy`, que é quando
   as Functions são empacotadas — passa em todo teste local e quebra só lá. O
   `jsonLdSeguro` mora em `functions/_lib/json-ld.js` por isso. O teste
   `deploy-referencias` lê a lista do próprio `deploy.yml` e reprova.

## Verificar localmente

Sem as Functions (http-server), `/blog` e `/blog-post?slug=<endereço>` caem no
caminho do navegador, que busca no Supabase e desenha com o mesmo
renderizador. Antes da migração a lista diz "nenhum post ainda". Pra testar
com dados, dá pra subir um Supabase de mentira que siga a regra da RLS (foi
assim que o blog foi conferido em 2026-09-30).
