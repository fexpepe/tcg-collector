# Migrações do Supabase

O SQL que vive no banco (RLS, RPCs, triggers) passa a ser versionado AQUI antes
de ir pro dashboard — o repo é a fonte da verdade, o SQL Editor é só o meio de
aplicar. (As migrações antigas, criadas direto no dashboard, estão descritas em
`docs/BACKEND.md` e na auditoria de 2026-06-18; o ideal é exportá-las pra cá aos
poucos.)

## Pendentes de aplicar

- `20260924a` — libera o slug `dbc` (Dragon Ball Carddass, 15º slug) nas DUAS
  whitelists de jogo, como a `20260807c` fez com o Union Arena:
  `card_views`/`increment_card_view` (corpo da `20260923a`, com o
  `card_views_daily`) e `contribute_price`. Sem ela, view de carta e preço da
  comunidade do `dbc` são descartados em silêncio. Já sem cifrão dentro dos
  corpos (âncoras com `\Z`).

  Testada em 2026-09-24 num PostgreSQL 16 local com esqueleto (card_views com o
  CHECK antigo, card_views_daily, community_prices, `_rate_ok`, `auth.uid`):
  `dbc` grava em card_views e card_views_daily; jogo inventado, id com `$` e id
  com quebra de linha no fim são descartados; `contribute_price` grava `NM` e
  `LP`/`psa`/`9.5` e recusa `cond` com `$`. Conferir em produção com os `curl`
  do rodapé do arquivo.

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
