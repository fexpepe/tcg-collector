# Migrações do Supabase

O SQL que vive no banco (RLS, RPCs, triggers) passa a ser versionado AQUI antes
de ir pro dashboard — o repo é a fonte da verdade, o SQL Editor é só o meio de
aplicar. (As migrações antigas, criadas direto no dashboard, estão descritas em
`docs/BACKEND.md` e na auditoria de 2026-06-18; o ideal é exportá-las pra cá aos
poucos.)

## Pendentes de aplicar

- `20261001a` — libera os slugs `wow` (World of Warcraft TCG) **e** `lotr`
  (The Lord of the Rings TCG, Decipher 2001–2007) nas DUAS whitelists de jogo:
  `card_views`/`increment_card_view` e `contribute_price` (cópia da
  `20260930d` com o `lotr` a mais; fora do cabeçalho e dos exemplos de
  `curl`, só a lista muda, conferido por diff). A lista é a inteira, com o
  `swu`, o `cyberpunk` e o `wow`, então ela SUBSTITUI a `20260930d` (ver
  abaixo, "NÃO aplicar"). Sem ordem com a `20260930b` (blog). Conferir com o
  par de `curl` do fim do arquivo: a view de `lotr-1r1` tem de **criar a
  linha** no `card_views` (o 204 sozinho não prova nada) e a contribuição
  anônima segue 401; o mesmo vale pro `wow-16485` com `"p_game":"wow"`.

- `20260930b` — blog (`20260930b_blog.sql`; o `b` porque a `20260930a` do mesmo
  dia é a do Star Wars). Cria o papel de editor do blog (`blog_editores`,
  tabela trancada, SEPARADA do `is_admin`), a tabela `posts` com RLS
  (visitante lê só o publicado com data passada; editor lê e escreve tudo), o
  histórico (`post_revisions`), o redirecionamento de endereço antigo
  (`post_redirects`) e o bucket público `blog-media` no Storage, com escrita
  só de editor. A semente põe a conta com `is_admin` (a do dono) como editor.
  Aditiva e sem ordem com o JS: antes dela, `/blog` diz "nenhum post ainda" e
  o `/blog-editor` pede pra aplicar. Ver `docs/BLOG.md`.

  Testada em 2026-09-30 no PGlite com esqueleto do Supabase (papéis
  anon/authenticated, `auth.uid()`, `profiles`, `storage.buckets/objects`),
  aplicada duas vezes seguidas: 18 cenários — semente, `blog_me`, tabela de
  editores ilegível, só editor cria/edita/apaga, rascunho e agendado
  invisíveis pro anon, `card_refs` do corpo (forjado ignorado), histórico
  podado em 40, 301 só pra endereço que já foi ao ar, Storage só no bucket
  do blog, e admin tirado da lista vira leitor comum (papéis desconectados).

  Conferir depois de aplicar:
  ```sql
  select count(*) from public.blog_editores;                                  -- 1 (o dono)
  select to_regclass('public.posts'), to_regclass('public.post_revisions');   -- não nulos
  select public, file_size_limit from storage.buckets where id = 'blog-media'; -- t | 5242880
  ```
  E, logado: `/blog-editor` abre a lista de posts (vazia) em vez do aviso.
  Pra pôr outra pessoa como editora: `docs/BLOG.md`, seção "Quem escreve".

- `20260928b` — precisão do scanner (`20260928b_scanner_precisao.sql`; o `b` porque
  a `20260928a` do mesmo dia é a do Analytics 2.1): recria a `admin_funnel` da `20260923a`
  com todas as chaves de antes e mais `ambiguas`, `pela_foto`, `trocou` e
  `digitou` (em `scan`) e `ambiguas`/`trocou` (em cada linha de
  `scan_jogos`), somando os contadores novos do `scan_done` (`amb`, `vis`,
  `troca`, `dig` — ver docs/BACKEND.md). Aditiva e sem ordem com o JS: o
  `scan_done` já está na whitelist e props novas passam; até ela entrar, o
  `/admin` mostra o aviso "aplique a 20260928b" na seção Precisão do scanner.
  Quem aplicou pelo link da branch, quando o arquivo ainda se chamava
  `20260928a_scanner_precisao.sql`, já está com ela: o SQL é o mesmo.

  Testada em 2026-09-28 no PGlite (Postgres em WASM) com um esqueleto
  (auth.uid, profiles, events): sem admin devolve null; com admin, as chaves
  antigas continuam e as novas somam; `scan_done` do JS antigo (sem os campos)
  conta zero; valor forjado (`"x"`, `"<script>"`, `-1`) é ignorado sem
  derrubar a RPC.

  Conferir depois de aplicar:
  ```sql
  select p.prosrc like '%pela_foto%' from pg_proc p where p.proname = 'admin_funnel'; -- true
  ```
  E, logado como admin, abrir `/admin` › Funil: a seção "Precisão do scanner"
  troca o aviso pelos números.

- `20260914a` — painel `/admin` 2.0. Três coisas num arquivo só, todas
  aditivas: (1) `events.uid`/`events.bot` preenchidos pelo `events_guard`
  (mesma whitelist de nomes da `20260830a`); (2) trigger `profiles_admin_guard`,
  que impede uma conta de marcar o próprio `is_admin` pela API; (3) RPC
  `admin_dashboard(days)`, que alimenta as abas novas. O front já está
  preparado pra ausência dela: sem a RPC, o `/admin` mostra o painel antigo com
  um aviso amarelo; com ela, as abas aparecem sozinhas.

  Testada em 2026-09-14 num PostgreSQL 16 local com um esqueleto do esquema
  (auth.users, profiles, collections, shares, deck_views, card_views, events):
  nome fora da whitelist descartado; `Googlebot/`, `HeadlessChrome` e
  `props.wd=1` viram `bot=true` e `CUBOT_X18` (celular) não; JWT de usuário
  preenche `uid`; UPDATE/INSERT de `is_admin` com JWT `authenticated` não sobe e
  pelo SQL sobe; RPC devolve null pra não-admin e o jsonb completo pra admin.

  Conferir depois de aplicar:
  ```sql
  select column_name from information_schema.columns
   where table_name = 'events' and column_name in ('uid', 'bot');   -- 2 linhas
  select tgname from pg_trigger where tgname in ('events_guard', 'profiles_admin_guard'); -- 2
  ```
  E, logado como admin, abrir `/admin`: as abas aparecem e o aviso amarelo some.

### Já aplicadas (verificado em produção)

- `20260929a` — robôs retroativos (`20260929a_robos_retroativos.sql`): tira da
  série de crescimento a rajada de julho/agosto. O "visitantes únicos em 30
  dias" do `/admin` (e do kit de parceiros) tinha um platô de exatos 30 dias
  (~28/07 a ~27/08, perto de 4.300 contra algumas centenas de verdade): milhares
  de navegadores que apareceram de uma vez e nunca voltaram — a assinatura de
  robô que executa JavaScript, em que cada página num navegador limpo nasce
  com um uuid novo. Entraram como gente porque antes da `20260914a` não havia
  `bot` e o pageview não levava contexto nenhum (nem aparelho, nem idioma, nem
  webdriver; user-agent nunca é guardado), então a regra é de comportamento:
  navegador **de passagem** (toda a história em 30 minutos, nunca voltou), que
  **não fez nada** além de ver página, com a 1ª visita numa **avalanche** (hora
  acima de max(25, 5 × a mediana das horas vizinhas), ou dia que, fora essas
  horas, ainda passa de max(150, 5 × a mediana dos dias vizinhos) — vizinhos =
  14 dias pra cada lado), e só **antes de 2026-09-15**. Até **27/07** a régua é
  mais apertada (10 por hora, 60 por dia): até o commit `09aa548` o localhost
  contava como visita, inclusive os navegadores automáticos de teste e de
  captura de tela, que abrem cada página num contexto limpo. Os eventos deles
  viram `bot=true` — nada é apagado —, a lista fica em `robos_retro` (trancada,
  pra desfazer) e a `metrics_daily` é refeita do 1º dia atingido até 30 dias
  depois do último, junto com a `events_daily`. O `card_views` (contador sem
  navegador) não tem como ser corrigido. Aplicada em 2026-09-29.
  **Verificado em produção, sem login:** a tabela `robos_retro` e a função
  `_robos_retro_candidatos` respondem **401 permission denied** (42501) pro
  anon — igual à `apoiadores` de controle e contra o **404** de antes (PGRST205
  na tabela, PGRST202 na função) —, então existem e estão fechadas. O SQL
  Editor avisa "destructive operations" e "table without RLS" pro
  `_serie_antes`: é a tabela TEMPORÁRIA do relatório (só existe naquela
  execução e a API não enxerga) e o update só liga o `bot` — o botão é **Run
  without RLS**; o "enable RLS" acrescenta um comando que o arquivo não
  precisa.

  Testada em 2026-09-29 no PGlite com as funções reais da `20260928a`
  (`metrics_snapshot`, `events_rollup`) e 120 dias sintéticos — base humana
  com gente que volta e que usa, uma rajada de 3.600 robôs em horas de 28/07,
  outra de 520 diluída no dia 20/08 (abaixo do piso por hora), três sessões de
  dev em julho (42 navegadores em 3 horas, 90 diluídos num dia, 48 em 6 horas
  abaixo das duas réguas), dois picos de gente de verdade (um dia cheio em
  julho, um viral em agosto) e robôs já marcados depois do corte: marcou os
  4.252 robôs das rajadas e das duas primeiras sessões (da terceira, 11 de 48
  — é o limite: abaixo de 10 por hora e 60 por dia não se separa de gente) e 42
  humanos de passagem das horas e dias de avalanche (nenhum que voltou, usou o
  site ou veio dos picos de gente); o MAU corrigido ficou a no máximo 4% do
  real e os dias fora das rajadas não mudaram; o robô depois do corte ficou
  intacto; reaplicar mudou zero dias; colar por cima da 1ª versão do arquivo
  (a de 4 parâmetros, sem a régua de dev) funcionou; a receita de desfazer
  devolveu a série de antes, dia a dia.

  A lista do que foi marcado, por dia (só leitura):
  ```sql
  select (primeira at time zone 'America/Sao_Paulo')::date as dia, motivo,
         count(*) as navegadores, sum(pageviews) as pageviews
    from public.robos_retro group by 1, 2 order by 1;
  ```
  No `/admin` › Visão geral › Crescimento (e no kit de parceiros), o platô sai
  da curva; em Técnico › Qualidade, esses dias aparecem como robô. Se um dia
  marcado tiver sido gente de verdade (campanha, post que viralizou), a receita
  de desfazer do cabeçalho devolve tudo, e o bloco 3 aceita limites mais
  apertados — `_robos_retro_candidatos(date '2026-09-15', 60, 300, 5)` — ou
  sem a régua de dev — `_robos_retro_candidatos(p_trava => date '2026-06-01')`.

- `20260928c` — apoiador sem anúncio (`20260928c_apoiador.sql`): tabela
  `apoiadores` (user_id, ate) TRANCADA pra API (RLS sem policy, sem grant),
  `apoio_status()` (a data da própria conta, pro `ads.js` e as
  Configurações), `admin_apoiador(quem, dias)` e `admin_apoiadores()` (aba
  Mercado › Vitrine do `/admin`). Aplicada em 2026-09-29. **Verificado em
  produção, sem login:** as três RPCs respondem **401 permission denied**
  (42501) pro anon — contra **404** de uma função inexistente, o que prova
  que existem e estão fechadas — e ler a tabela `apoiadores` pelo REST também
  volta 42501 (nenhum privilégio pro anon). Antes de aplicar, a mesma
  `apoio_status` dava 404 e o site tratava todo mundo como "não apoia".

  Antes, testada no PGlite com um esqueleto (auth.users, auth.uid, profiles,
  _is_admin): não-admin recebe null; soma no fim quando ainda vale e recomeça
  de hoje quando venceu; acha pelo e-mail (conta sem @, sem linha em
  `profiles`) ou pelo @ sem diferenciar maiúscula; 0 dias encerra; e-mail
  desconhecido e dias fora de 0..366 voltam erro; anon/authenticated não têm
  privilégio na tabela; apagar o auth.users leva a linha; reaplicar o arquivo
  é inofensivo.

- `20260927a` — vitrine (o espaço de anúncio das páginas de catálogo,
  `src/ads.js`, docs/PLANO-ADS.md): a whitelist do `events_guard` ganha
  `ad_view` e `ad_click` (cópia fiel da `20260923a`) e entra a RPC
  `admin_vitrine(days)` da aba Mercado › Vitrine do `/admin`. Aplicada em
  2026-09-28. **Verificado com as probes do `verifica-setup.mjs`** (com
  `user-agent` de robô, pra linha de teste nascer `bot=true` e ficar fora dos
  painéis): `ad_view` e `ad_click` gravam (42501 no RETURNING, igual ao
  `pageview` de controle), o nome inventado é descartado (`201 []`), e a RPC
  responde **401 permission denied** pro anon — contra **404 PGRST202** de uma
  função inexistente, o que prova que ela existe e está fechada.

  Antes, testada no PGlite (Postgres em WASM): a RPC soma servidos, vistos e
  cliques por criativo, posição, página, jogo e dia, e um POST forjado (prop
  que não é array, item-objeto, `<script>`, rótulo de 500 caracteres) é
  ignorado sem derrubar a RPC.

  Ficou registrado o tropeço da primeira tentativa: o texto colado no SQL
  Editor chegou cortado na linha 100 (de 164) e o Postgres respondeu
  `unterminated dollar-quoted string at or near "$$"` — o `end $$;` que fecha a
  função estava no pedaço que não veio. Nada foi aplicado pela metade (o
  Postgres analisa o lote inteiro antes de executar). Copiar pelo botão "Copy
  raw file" do GitHub trouxe o arquivo inteiro.

- `20260830a` — amplia a whitelist do trigger `events_guard` com cinco eventos
  de produto (E6). Aplicada em 2026-08-30. **Verificado por três probes** do
  `scripts/verifica-setup.mjs`: `export_done` grava, um nome inventado é
  descartado, e `pageview` (que sempre funcionou) serve de controle positivo.

  Fica registrado o erro que quase virou uma migração desnecessária: o teste
  usava `Prefer: return=representation`, que vira `INSERT ... RETURNING`, e o
  PostgreSQL aplica as políticas de **SELECT** à linha retornada. A tabela
  `events` não tem política de SELECT — isso é o desenho, não um defeito: nem o
  dono lê evento cru. Então a linha entra e o RETURNING não consegue lê-la de
  volta, e o erro é `42501 new row violates row-level security policy`, que
  parece recusa e é o **oposto**: só acontece se houve linha. Eu li isso como
  "existe uma segunda whitelist na política de RLS" e cheguei a escrever a
  migração `20260830b` pra consertar o que não estava quebrado. O dump completo
  das políticas (uma só: `events_insert_anyone`, INSERT, PERMISSIVE, PUBLIC,
  `with check (true)`) derrubou a teoria, e o controle positivo com `pageview`
  fechou. A `20260830b` foi apagada.

- `20260930c` — libera o slug `cyberpunk` (Cyberpunk TCG) nas DUAS whitelists
  de jogo: `card_views`/`increment_card_view` e `contribute_price` (cópia da
  `20260930a`; fora do cabeçalho e dos exemplos de `curl`, só a lista muda,
  conferido por diff). A lista é a inteira e contém o `swu`. Aplicada em
  2026-09-30 e verificada por curl: `increment_card_view` com `cyberpunk`
  responde 204 **e cria a linha** (`{"card_id":"cpk-714162","views":1}`); o
  jogo inventado também dá 204 mas não cria nada; o `swu` segue com as linhas
  dele; a contribuição anônima segue **401**. Sem prova direta, como nas
  anteriores: o `contribute_price` logado com `cyberpunk`.

- `20260930a` — libera o slug `swu` (Star Wars: Unlimited, 15º jogo) nas DUAS
  whitelists de jogo: `card_views`/`increment_card_view` e `contribute_price`
  (cópia da `20260924a`, corpo idêntico conferido por diff). Aplicada em
  2026-09-30 e verificada por curl: `increment_card_view` com `swu` responde
  204 **e cria a linha** (`{"game":"swu","card_id":"swu-540407","views":1}`); o
  jogo inventado também dá 204 mas não cria nada; a contribuição anônima segue
  **401**. Sem prova direta, como nas anteriores: o `contribute_price` logado
  com `swu` (fecha contribuindo um preço numa carta do Star Wars pelo site).

- `20260930d` — **NÃO aplicar: a `20261001a` já cobre o `wow`.** O WoW TCG e o
  LOTR TCG entraram em sessões paralelas entre 30/09 e 01/10/2026, e cada
  migração de jogo reescreve a lista INTEIRA (`docs/CATALOGO.md`, 4.5 e 5.5).
  A `20261001a` é a `20260930d` com o `lotr` a mais (conferido por diff);
  rodada DEPOIS dela, a `20260930d` tiraria o `lotr` das duas whitelists em
  silêncio. Se ela já tiver sido aplicada antes da `20261001a`, não faz mal:
  a `20261001a` reescreve por cima com os dois. O arquivo fica como registro,
  com o mesmo aviso no topo.

- `20260924a` — **NÃO aplicar: a `20260930a` já cobre o `dbc`.** Ela liberaria
  o slug `dbc` (Dragon Ball Carddass) nas DUAS whitelists de jogo, mas a
  `20260930a` (Star Wars), aplicada em 2026-09-30, reescreve as mesmas três
  coisas (o CHECK de `card_views`, `increment_card_view` e `contribute_price`)
  com a lista completa, que já tem o `dbc` e o `swu`. Conferido por diff no
  mesmo dia: fora o `'swu'` nas três listas, o SQL executável das duas é
  idêntico. A lista da `20260924a` é essa mesma sem o `swu`, então aplicá-la
  agora tiraria o Star Wars das duas whitelists, e view de carta e Preço da
  Comunidade do `swu` passariam a ser descartados em silêncio (as funções só
  dão `return`). Colada inteira, hoje ela deve parar no CHECK (a linha
  `swu-540407` do teste de 30/09 viola a lista sem `swu`) e o SQL Editor
  desfazer o lote todo, mas é proteção por acaso: rodada em pedaços, as
  funções trocam sem erro nenhum. Ficou em "Pendentes de aplicar" até
  2026-09-30 porque as duas nasceram em sessões paralelas e cada migração de
  jogo reescreve a lista inteira (`docs/CATALOGO.md`, seção 5.5). O arquivo
  fica como registro, com o mesmo aviso no topo; a próxima migração de jogo
  copia a `20260930a`. O teste local de 2026-09-24 (PostgreSQL 16 com
  esqueleto: `dbc` grava; jogo inventado e id com `$` ou com quebra de linha
  no fim são descartados) vale pro corpo que está no ar, que é o mesmo.

  Em produção, em 2026-09-30, o `card_views` ainda não tinha linha do `dbc`
  (e do `swu`, só a do teste): com poucas horas de whitelist, a ausência não
  prova nada. A primeira linha do `dbc` fecha a prova, só lendo:
  ```bash
  curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/card_views?game=eq.dbc&select=card_id,views&limit=5" \
    -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
  ```

- `20260807c` — libera o slug `unionarena` (Union Arena, 13º jogo) nas DUAS
  whitelists de jogo: `card_views`/`increment_card_view` e `contribute_price`.
  Aplicada em 2026-08-07. Verificado: `increment_card_view` com
  `p_game=unionarena` responde 204 **e cria a linha** (`{"game":"unionarena",
  "card_id":"ua-576966","views":1}`); o controle com um jogo inventado também
  responde 204 mas **não** cria linha nenhuma — é isso que prova que a whitelist
  está filtrando, e não que a função virou passa-tudo. A contribuição anônima
  segue **401**, então o fechamento da `20260807b` sobreviveu ao
  `create or replace` (como esperado: replace preserva a ACL).
  O que ficou SEM prova direta: a whitelist do `contribute_price` para
  `unionarena` — testá-la exige um JWT de usuário logado. Fecha contribuindo um
  preço em qualquer carta do Union Arena pelo site.

- `20260807b` — revoga de PUBLIC/anon o EXECUTE de `contribute_price`.
  Aplicada em 2026-08-07: chamada anônima passou de HTTP 204 (executava e
  caía na guarda) pra **401 / 42501 permission denied**; a RPC de leitura
  continua 200 `[]` pra visitante sem conta.

- `20260807a` — base do Preço da Comunidade (`community_prices` +
  `contribute_price` + `community_price_for`). Aplicada em 2026-08-07:
  o agregado anônimo responde `[]`, a tabela crua devolve `[]` (RLS sem policy
  filtra tudo — é o comportamento certo, apesar de o comentário do arquivo
  dizer "negado") e a escrita anônima não grava. Ver a `b`, que fecha o EXECUTE
  que o PostgreSQL dá a PUBLIC por padrão.

- `20260804a` — visitas por deck (`deck_views` + `increment_deck_view` +
  `deck_views_for`). Aplicada e testada em 2026-08-04: a RPC de leitura
  responde `[]`, a leitura anônima da tabela funciona, INSERT direto é negado
  pela RLS (42501) e uuid inexistente não cria linha. É o que faz o "Em
  destaque" da galeria de decks ser por popularidade.

- `20260723a` — rate limit por IP em `events`/`increment_card_view`,
  `get_public_profile`, `error_summary`. Confirmado: as tabelas respondem e o
  guard de `events` descarta nome fora da whitelist.
- `20260723b` — lockdown de `public_profiles`. Confirmado: leitura anônima
  devolve `[]`.
- `20260724a` — slugs de YGO/Digimon/Riftbound no CHECK de `card_views`.
- `20260727a` — `kind='deck'` liberado em `shares` (destravou o publicar).
- `20260727b` — policy de UPDATE (e DELETE) do dono em `shares`. Aplicada em
  2026-08-04; republicar deixa de duplicar o deck na galeria. O teste de
  comportamento é logado (curl anônimo não exercita policy de
  `authenticated`): republicar um deck deve manter UMA linha por deck.
- `20260727c` — `user_id` fora da leitura ANÔNIMA de `shares`. Aplicada e
  verificada em 2026-08-04: pedir `user_id` devolve 42501, e as duas queries
  REAIS do app seguem funcionando pra visitante sem conta — o select da
  galeria (com os `data->>`) e o do viewer de deck (`data` inteiro). Conferir
  essas duas importa: o `revoke select` derruba o acesso amplo, então uma
  coluna esquecida no `grant` quebraria a galeria sem que o teste do
  `user_id` percebesse.

Como aplicar: SQL Editor do dashboard (colar o arquivo inteiro) ou
`supabase db push` com o CLI ligado ao projeto `dlnalopazitfdgnmdguu`.

## Verificação pós-aplicação

```bash
# Depois da B: paginar a tabela deve voltar VAZIO (antes voltava todo mundo)
curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/public_profiles?select=handle&limit=5" \
  -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
```

```bash
# A RPC pontual deve continuar respondendo (troque o handle por um real)
curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/get_public_profile?p_handle=fexpepe" \
  -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
```

E no site: abrir um perfil público deslogado, a wishlist ("quem tem à venda")
e o /admin (seção "Erros de JS" aparece depois da A).
