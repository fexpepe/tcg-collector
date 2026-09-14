-- ============================================================================
-- Painel /admin 2.0 (2026-09-14)
--
-- ADITIVA. Pode aplicar antes do deploy do front: o admin.js novo cai pro
-- `analytics_summary` antigo enquanto o `admin_dashboard` não existir, e o
-- beacon antigo continua gravando (as colunas novas têm default).
--
-- O que muda e por quê:
--
-- 1) `events.uid` e `events.bot`. O painel antigo contava DAU/MAU só por uuid
--    anônimo, então "usuário logado ativo" e "visitante" eram a mesma coisa —
--    e o alerta da Cloudflare de 2026-09-11 (97% de tráfego automatizado num
--    dia) mostrou que a gente não sabia quanto do que o painel mede é gente.
--    As duas colunas são preenchidas PELO TRIGGER, nunca pelo cliente:
--      - uid = auth.uid() da requisição (o front passa o JWT quando há sessão;
--        sem JWT fica null). Impossível de forjar pra outro usuário.
--      - bot = user-agent da requisição parece robô, OU o próprio navegador
--        se declarou automatizado (navigator.webdriver → props.wd = 1). Só o
--        FLAG é guardado; o user-agent em si não (é identificador demais).
--    A maioria dos crawlers nem executa JS, então nunca chega aqui — o flag
--    pega os que executam (headless, Lighthouse, monitores) e serve de teto:
--    tudo que o painel chama de "orgânico" é pageview de JS executado, sem
--    webdriver e com user-agent de navegador.
--
-- 2) `events_guard` recriado com a MESMA whitelist da 20260830a (os testes
--    leem a whitelist da migração mais nova que define a função — ver
--    tests/eventos-produto.test.mjs) mais o preenchimento de uid/bot.
--
-- 3) `profiles_admin_guard`: a policy de UPDATE de `profiles` (criada no
--    dashboard, não versionada) é "dono edita a própria linha" — sem restrição
--    de coluna. Qualquer conta logada podia mandar um PATCH marcando o próprio
--    is_admin = true e ler o painel. O trigger devolve is_admin ao valor
--    anterior (ou false no INSERT) sempre que a requisição vem pela API
--    (JWT de anon/authenticated). Pelo SQL Editor e pelo service_role continua
--    livre — é assim que um admin é cadastrado:
--      update public.profiles set is_admin = true
--       where user_id = (select id from auth.users where email = '…');
--
-- 4) `admin_dashboard(days)`: UMA RPC com tudo que o painel novo mostra,
--    versionada aqui (o `analytics_summary` antigo foi criado direto no
--    dashboard e não está no repo). Mesmo gate is_admin; devolve null pros
--    demais. Tudo agregado: nenhum campo identifica pessoa, carta de alguém ou
--    coleção de alguém — o menor grão é (jogo, carta) → quantos usuários.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
-- Depois: abrir /admin logado como admin — o rodapé deixa de avisar que a
-- migração está pendente.
-- ============================================================================

-- ── 1) Colunas novas em events ──────────────────────────────────────────────
alter table public.events add column if not exists uid uuid;
alter table public.events add column if not exists bot boolean not null default false;

-- O painel filtra sempre por ts (janela de dias) e, dentro dela, por nome.
create index if not exists events_ts_idx on public.events (ts desc);
create index if not exists events_name_ts_idx on public.events (name, ts desc);

-- ── 2) events_guard: whitelist + caps + rate limit + uid/bot ────────────────
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h  json;
  ua text;
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created'
  ) then return null; end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then return null; end if;
  if pg_column_size(new.props) > 4096 then return null; end if;
  if not _rate_ok('events', 60) then return null; end if;

  -- Atribuição ao usuário logado: vem do JWT, não do corpo. O cliente não
  -- consegue gravar evento em nome de outra conta.
  new.uid := auth.uid();

  -- Robô ou gente? Só o flag é guardado; o user-agent não.
  h  := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ua := coalesce(h->>'user-agent', '');
  new.bot := (
    ua = ''
    -- "bot" como palavra (Googlebot/, GPTBot/, ClaudeBot;, archive.org_bot) —
    -- e não como pedaço de marca de celular (CUBOT_X18).
    or ua ~* 'bot(/|;|\)|\s|$)'
    or ua ~* '(crawl|spider|slurp|headless|phantomjs|lighthouse|pagespeed|scrapy|python-requests|python/|aiohttp|httpx|curl/|wget/|go-http-client|java/|okhttp|libwww|facebookexternalhit|bytespider|perplexity|anthropic|openai|semrush|ahrefs|mj12|petalbot|uptimerobot|betteruptime|statuscake|pingdom|site24x7)'
    or coalesce(new.props->>'wd', '') = '1'
  );
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

drop trigger if exists events_guard on public.events;
create trigger events_guard before insert on public.events
  for each row execute function public.events_guard();

-- ── 3) is_admin só muda fora da API ─────────────────────────────────────────
create or replace function public.profiles_admin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  papel text;
begin
  -- Requisição via PostgREST carrega o JWT; SQL Editor e CLI não. O
  -- service_role também passa por aqui com JWT, mas com papel próprio.
  papel := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'role';
  if papel in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_admin := false;
    else
      new.is_admin := coalesce(old.is_admin, false);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.profiles_admin_guard() from public, anon, authenticated;

drop trigger if exists profiles_admin_guard on public.profiles;
create trigger profiles_admin_guard before insert or update on public.profiles
  for each row execute function public.profiles_admin_guard();

-- ── 4) admin_dashboard(days) ────────────────────────────────────────────────
-- Uma chamada, um jsonb. Seções:
--   overview   contadores do momento (DAU/WAU/MAU de VISITANTES humanos e de
--              USUÁRIOS logados, contas, coleções, shares, views…)
--   daily      por dia da janela: views humanas, views de robô, visitantes,
--              usuários logados, cadastros
--   paths      páginas mais vistas (humanas) e as mais batidas por robô
--   games      pageviews por jogo · coleção por jogo (usuários, cartas, cópias)
--   cards      cartas mais cadastradas (geral e top por jogo), mais desejadas
--              (wishlist) e mais visitadas (card_views)
--   decks      decks mais vistos e decks publicados por jogo
--   audience   dispositivo, idioma, origem (host do referrer), hora e dia da
--              semana (horário de Brasília)
--   product    eventos de produto da janela (vezes, visitantes, usuários)
--   retention  funil visitante → engajado → logado → conta nova; quem volta
--              em outro dia; quem volta 7+ dias depois da primeira visita
--   bots       o quanto da janela é robô, por dia já está no daily
create or replace function public.admin_dashboard(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d     int;
  ini   timestamptz;
  hoje  timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  res   jsonb;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    return null;
  end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := hoje - make_interval(days => d - 1);

  with
  -- Pageviews humanos da janela — a base de quase tudo.
  pv as (
    select ts, anon, uid, path, game, props
    from events
    where name = 'pageview' and not bot and ts >= ini
  ),
  pvb as (
    select ts, path from events where name = 'pageview' and bot and ts >= ini
  ),
  -- Coleção aberta em (usuário, jogo, carta) → cópias. Tolera os dois formatos
  -- que já existiram: v3 (carta → variante → condição → qty) e o antigo
  -- (carta → variante → qty).
  cartas as (
    select c.user_id, c.game, e1.key as card_id,
      (select coalesce(sum(
         case
           when jsonb_typeof(e2.value) = 'object' then
             (select coalesce(sum(t.v::numeric), 0)
              from jsonb_each_text(e2.value) t(k, v)
              where t.v ~ '^[0-9]+(\.[0-9]+)?$')
           when jsonb_typeof(e2.value) = 'number' then (e2.value)::text::numeric
           else 0
         end), 0)
       from jsonb_each(e1.value) e2) as copias
    from collections c
    cross join lateral jsonb_each(c.data->'collection') e1
    where jsonb_typeof(c.data->'collection') = 'object'
      and jsonb_typeof(e1.value) = 'object'
  ),
  cartas_pos as (select * from cartas where copias > 0),
  desejos as (
    select c.user_id, c.game, k as card_id
    from collections c
    cross join lateral jsonb_object_keys(c.data->'wishlist') k
    where jsonb_typeof(c.data->'wishlist') = 'object'
  ),
  primeira as (
    select anon, min(ts) as first_ts
    from events
    where name = 'pageview' and not bot and anon is not null
    group by anon
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'since', ini,
    'migration', '20260914a',

    'overview', (
      select jsonb_build_object(
        'dau', (select count(distinct anon) from events where name = 'pageview' and not bot and anon is not null and ts >= hoje),
        'wau', (select count(distinct anon) from events where name = 'pageview' and not bot and anon is not null and ts >= hoje - interval '6 days'),
        'mau', (select count(distinct anon) from events where name = 'pageview' and not bot and anon is not null and ts >= hoje - interval '29 days'),
        'dau_users', (select count(distinct uid) from events where name = 'pageview' and uid is not null and ts >= hoje),
        'wau_users', (select count(distinct uid) from events where name = 'pageview' and uid is not null and ts >= hoje - interval '6 days'),
        'mau_users', (select count(distinct uid) from events where name = 'pageview' and uid is not null and ts >= hoje - interval '29 days'),
        'pageviews', (select count(*) from pv),
        'pageviews_bot', (select count(*) from pvb),
        'visitors', (select count(distinct anon) from pv where anon is not null),
        'users_active', (select count(distinct uid) from pv where uid is not null),
        'total_users', (select count(*) from auth.users),
        'new_users', (select count(*) from auth.users where created_at >= ini),
        'signed_in_30d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
        'collections_users', (select count(distinct user_id) from collections),
        'public_profiles', (select count(*) from public_profiles),
        'shares', (select count(*) from shares),
        'decks', (select count(*) from shares where kind = 'deck'),
        'deck_views', (select coalesce(sum(views), 0) from deck_views),
        'card_views', (select coalesce(sum(views), 0) from card_views),
        'push_subs', (select count(*) from push_subs),
        'price_points', (select count(*) from community_prices),
        'errors', (select count(*) from events where name = 'jserror' and ts >= ini)
      )
    ),

    'daily', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
        select to_char(g.day at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day,
          (select count(*) from pv where pv.ts >= g.day and pv.ts < g.day + interval '1 day') as views,
          (select count(*) from pvb where pvb.ts >= g.day and pvb.ts < g.day + interval '1 day') as bots,
          (select count(distinct anon) from pv where anon is not null and pv.ts >= g.day and pv.ts < g.day + interval '1 day') as visitors,
          (select count(distinct uid) from pv where uid is not null and pv.ts >= g.day and pv.ts < g.day + interval '1 day') as users,
          (select count(*) from auth.users u where u.created_at >= g.day and u.created_at < g.day + interval '1 day') as signups
        from generate_series(ini, hoje, interval '1 day') g(day)
      ) x
    ),

    'paths', jsonb_build_object(
      'top', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select path, count(*)::int as views, count(distinct anon)::int as visitors
        from pv group by path order by views desc limit 20) x),
      'bots', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select path, count(*)::int as views
        from pvb group by path order by views desc limit 10) x)
    ),

    'games', jsonb_build_object(
      'views', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select coalesce(game, 'hub') as game, count(*)::int as views, count(distinct anon)::int as visitors
        from pv group by 1 order by views desc) x),
      'collection', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, count(distinct user_id)::int as users, count(distinct card_id)::int as cards,
               sum(copias)::bigint as copies
        from cartas_pos group by game order by users desc, copies desc) x),
      'wishlist', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, count(distinct user_id)::int as users, count(*)::int as wants
        from desejos group by game order by wants desc) x),
      'decks', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select coalesce(game, '?') as game, count(*)::int as decks
        from shares where kind = 'deck' group by 1 order by decks desc) x)
    ),

    'cards', jsonb_build_object(
      'top', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, card_id, count(distinct user_id)::int as users, sum(copias)::bigint as copies
        from cartas_pos group by game, card_id
        order by users desc, copies desc limit 40) x),
      'by_game', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, card_id, users, copies from (
          select game, card_id, count(distinct user_id)::int as users, sum(copias)::bigint as copies,
                 row_number() over (partition by game order by count(distinct user_id) desc, sum(copias) desc) as rn
          from cartas_pos group by game, card_id
        ) r where rn <= 8 order by game, rn) x),
      'wanted', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, card_id, count(distinct user_id)::int as users
        from desejos group by game, card_id order by users desc limit 20) x),
      'viewed', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select game, card_id, views from card_views order by views desc limit 20) x)
    ),

    'decks', jsonb_build_object(
      'top', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select s.id, s.title, s.game, s.created_at, v.views
        from deck_views v join shares s on s.id = v.share_id and s.kind = 'deck'
        order by v.views desc limit 15) x),
      'by_kind', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select kind, count(*)::int as n from shares group by kind order by n desc) x)
    ),

    'audience', jsonb_build_object(
      'devices', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select coalesce(props->>'d', '?') as k, count(*)::int as views
        from pv group by 1 order by views desc) x),
      'langs', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select coalesce(props->>'l', '?') as k, count(distinct anon)::int as visitors, count(*)::int as views
        from pv group by 1 order by views desc limit 8) x),
      'referrers', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select props->>'r' as k, count(*)::int as views, count(distinct anon)::int as visitors
        from pv where coalesce(props->>'r', '') <> '' group by 1 order by views desc limit 15) x),
      'hours', (select coalesce(jsonb_agg(row_to_json(x) order by x.h), '[]'::jsonb) from (
        select extract(hour from ts at time zone 'America/Sao_Paulo')::int as h, count(*)::int as views
        from pv group by 1) x),
      'weekdays', (select coalesce(jsonb_agg(row_to_json(x) order by x.dow), '[]'::jsonb) from (
        select extract(dow from ts at time zone 'America/Sao_Paulo')::int as dow, count(*)::int as views
        from pv group by 1) x)
    ),

    'product', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select name, count(*)::int as n, count(distinct anon)::int as visitors, count(distinct uid)::int as users
      from events
      where ts >= ini and name in ('export_done', 'import_done', 'deck_created', 'backup_done', 'share_created')
      group by name order by n desc) x),

    'retention', (
      select jsonb_build_object(
        'visitors', (select count(distinct anon) from pv where anon is not null),
        'engaged', (
          select count(*) from (
            select anon from pv where anon is not null group by anon having count(*) >= 2
            union
            select distinct anon from events
            where ts >= ini and anon is not null
              and name in ('export_done', 'import_done', 'deck_created', 'backup_done', 'share_created')
          ) e
        ),
        'logged', (select count(distinct anon) from pv where anon is not null and uid is not null),
        'signups', (select count(*) from auth.users where created_at >= ini),
        -- Voltou em OUTRO dia dentro da janela.
        'returning', (
          select count(*) from (
            select anon from pv where anon is not null
            group by anon having count(distinct date_trunc('day', ts at time zone 'America/Sao_Paulo')) >= 2
          ) r
        ),
        -- Coorte: primeira visita há pelo menos 7 dias (e dentro da janela +
        -- 7). "Voltou" = tem pageview 7+ dias depois da primeira.
        'cohort', (select count(*) from primeira where first_ts >= ini - interval '7 days' and first_ts < now() - interval '7 days'),
        'cohort_back7', (
          select count(*) from primeira p
          where p.first_ts >= ini - interval '7 days' and p.first_ts < now() - interval '7 days'
            and exists (select 1 from events e where e.name = 'pageview' and not e.bot
                        and e.anon = p.anon and e.ts >= p.first_ts + interval '7 days')
        ),
        'new_visitors', (select count(*) from primeira where first_ts >= ini)
      )
    )
  ) into res;

  return res;
end $$;

revoke all on function public.admin_dashboard(int) from public, anon;
grant execute on function public.admin_dashboard(int) to authenticated;

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_name = 'events' and column_name in ('uid', 'bot');   -- 2 linhas
--   select tgname from pg_trigger where tgname = 'profiles_admin_guard'; -- 1 linha
-- E, logado como admin, /admin mostra as abas novas sem o aviso de migração.
