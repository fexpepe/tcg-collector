-- ============================================================================
-- Analytics v2 (2026-09-23)
--
-- POR QUE: o /admin respondia "quanta gente veio" e "o que cadastram", mas não
-- as perguntas que decidem se o Sleevu vira negócio:
--   - quantas pessoas SAEM da carta pra comprar na Liga/MYP/TCGplayer — o
--     número que se leva pra uma loja numa conversa de parceria. Não era
--     medido em lugar nenhum;
--   - quais cartas estão EM ALTA agora — o `card_views` é um contador
--     acumulado desde sempre, sem data, então "mais vista esta semana" não
--     existia;
--   - quem VOLTA, por canal, por jogo, por aparelho — havia só "voltou em
--     outro dia" e uma coorte de 7 dias, sem curva e sem recorte;
--   - crescimento mês a mês — o painel recalcula tudo a partir do `events` na
--     janela, então não tinha série histórica.
--
-- ADITIVA e SEGURA de aplicar a qualquer momento. Não mexe na
-- `admin_dashboard` nem em dado existente. O que faz:
--
--   1) events_guard: whitelist ganha 5 nomes (ver abaixo). Cópia fiel da
--      20260919a — só a lista cresce.
--   2) card_views_daily + increment_card_view: a MESMA view de carta que já
--      soma no contador acumulado passa a somar também por dia.
--   3) metrics_daily + metrics_snapshot(): um retrato por dia dos números
--      principais, pra ter curva de crescimento. Agendado no pg_cron quando a
--      extensão existe; o admin_growth também preenche os dias que faltarem.
--   4) RPCs novas do /admin, todas com o mesmo gate is_admin e o mesmo grão
--      agregado (nada identifica pessoa):
--        admin_stores(days)     cliques de saída pras lojas
--        admin_retention(days)  coortes, D1/D7/D30, jornada e recortes
--        admin_demand(days)     índice de demanda por carta, em alta, buscas
--                               sem resultado
--        admin_growth(days)     série diária + viralidade dos links
--   5) admin_funnel recriada com os campos de antes MAIS scanner por jogo,
--      tempo até a 1ª carta e conversão do portão de login.
--
-- ORDEM IMPORTA: aplicar este SQL ANTES de subir o JS. Nome fora da whitelist
-- faz o `events_guard` devolver null e o INSERT some sem erro nenhum (mesma
-- armadilha documentada na 20260830a e na 20260919a).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Os cinco nomes novos:
--
--   store_click   clique num link de loja no preview da carta. props:
--                   s   loja (liga | ligabra | myp | ebay | ebaysold |
--                       tcgplayer | pricecharting)
--                   g   jogo da carta · c  id da carta · gr  1 = graduada
--                   d   m/d (toque/ponteiro)
--                 Um clique = um evento; ninguém clica 60 lojas por minuto.
--   signup        conta NOVA criada (1ª volta do login com created_at recente).
--                   m   provedor (email | google)
--   search_empty  busca que não achou carta, set, Pokémon nem ilustrador.
--                   q   termo normalizado, até 40 caracteres · g  jogo filtrado
--                 Uma vez por termo por aba, depois de 1,5 s sem digitar.
--   share_open    alguém abriu um link compartilhado (coleção/fichário/deck).
--                   k   tipo · nv  1 = visitante que chegou AGORA (uuid
--                       anônimo criado nesta página) — é o que mede viralidade.
--   pwa_install   o navegador instalou o app (evento `appinstalled`).
--
-- O pageview também ganha props (não precisa de migração, props é livre):
--   s = 1 quando aberto como app instalado; u/c = utm_source/utm_campaign
--   quando a URL traz. O CANAL de cada visitante sai da 1ª pageview dele.
--
-- Conferir depois de aplicar:
--   select p.prosrc like '%store_click%' from pg_proc p
--    where p.proname = 'events_guard';                         -- true
--   select count(*) from public.metrics_daily;                 -- ~120 linhas
--   select jobname from cron.job where jobname = 'sleevu-metrics-daily';
--     (só se o pg_cron estiver habilitado em Database › Extensions)
-- ============================================================================

-- ── 1) events_guard: só a whitelist muda ────────────────────────────────────
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h  json;
  ua text;
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created',
    'scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate',
    'store_click', 'signup', 'search_empty', 'share_open', 'pwa_install'
  ) then return null; end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then return null; end if;
  if pg_column_size(new.props) > 4096 then return null; end if;
  if not _rate_ok('events', 60) then return null; end if;

  new.uid := auth.uid();

  h  := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ua := coalesce(h->>'user-agent', '');
  new.bot := (
    ua = ''
    or ua ~* 'bot(/|;|\)|\s|\Z)'
    or ua ~* '(crawl|spider|slurp|headless|phantomjs|lighthouse|pagespeed|scrapy|python-requests|python/|aiohttp|httpx|curl/|wget/|go-http-client|java/|okhttp|libwww|facebookexternalhit|bytespider|perplexity|anthropic|openai|semrush|ahrefs|mj12|petalbot|uptimerobot|betteruptime|statuscake|pingdom|site24x7)'
    or coalesce(new.props->>'wd', '') = '1'
  );
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

-- Índice pro que as RPCs novas mais fazem: "todos os eventos deste uuid".
create index if not exists events_anon_idx on public.events (anon, ts) where anon is not null;

-- ── 2) Views de carta por DIA ───────────────────────────────────────────────
-- O contador acumulado (card_views) continua existindo e alimentando o "mais
-- vistas" público; esta tabela é privada (sem policy, sem grant) e só as RPCs
-- do admin leem. Dia no horário de Brasília, como o resto do painel.
create table if not exists public.card_views_daily (
  game    text not null,
  card_id text not null,
  day     date not null,
  views   int  not null default 0,
  primary key (game, card_id, day)
);
create index if not exists card_views_daily_day_idx on public.card_views_daily (day desc);
alter table public.card_views_daily enable row level security;
revoke all on public.card_views_daily from public, anon, authenticated;

-- Corpo IDÊNTICO ao da 20260807c (whitelist de jogos, formato do id, rate
-- limit) + a linha do dia. Um insert a mais por view, na mesma chamada.
create or replace function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','jump'])) then return; end if;
  if p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z' then return; end if;
  if not _rate_ok('cardview', 120) then return; end if;
  insert into card_views (game, card_id, views) values (p_game, p_card_id, 1)
  on conflict (game, card_id) do update set views = card_views.views + 1;
  insert into card_views_daily (game, card_id, day, views)
  values (p_game, p_card_id, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (game, card_id, day) do update set views = card_views_daily.views + 1;
end $$;
grant execute on function public.increment_card_view(text, text) to anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Canal de aquisição a partir do referrer (só o host, como o beacon grava) e
-- do utm_source. Usado pra classificar a PRIMEIRA pageview de cada visitante.
create or replace function public._canal(p_ref text, p_utm text)
returns text language sql immutable as $$
  select case
    when coalesce(p_utm, '') <> '' then 'campanha'
    when coalesce(p_ref, '') = '' then 'direto'
    when p_ref ~* '(chatgpt|openai|perplexity|claude\.ai|gemini|copilot)' then 'ia'
    when p_ref ~* '(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|brave|baidu|startpage|qwant)\.' then 'busca'
    -- Sem cifrão nas regex: um cifrão solto dentro do corpo da função confunde
    -- o editor do Supabase ("unterminated dollar-quoted string", 24/09/2026).
    -- Os hosts curtos (t.co, t.me, x.com) vão por igualdade.
    when lower(p_ref) in ('t.co', 't.me', 'x.com', 'mobile.x.com') then 'social'
    when p_ref ~* '(instagram|facebook|(^|\.)fb\.|twitter|tiktok|reddit|youtube|youtu\.be|discord|whatsapp|wa\.me|threads|telegram|pinterest|linkedin|bsky|kwai|twitch)' then 'social'
    else 'site'
  end
$$;

-- Admin? (o mesmo teste que as outras RPCs fazem inline).
create or replace function public._is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where user_id = auth.uid() and is_admin)
$$;
revoke all on function public._is_admin() from public, anon, authenticated;

-- ── 3) Série diária ─────────────────────────────────────────────────────────
create table if not exists public.metrics_daily (
  day        date primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.metrics_daily enable row level security;
revoke all on public.metrics_daily from public, anon, authenticated;

-- Retrato de UM dia (Brasília). Tudo que vem do `events` dá pra recalcular
-- pra qualquer dia passado; o que vem do estado das coleções (colecionadores,
-- cópias, desejos…) só existe "agora", então só entra no retrato do dia de
-- HOJE. O merge (`||`) no conflito preserva esses campos quando o dia é
-- recalculado depois — refazer ontem não apaga o que o retrato de ontem viu.
create or replace function public.metrics_snapshot(p_day date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  dia  date := coalesce(p_day, (now() at time zone 'America/Sao_Paulo')::date);
  ini  timestamptz;
  fim  timestamptz;
  dados jsonb;
begin
  if dia > hoje then return; end if;
  ini := dia::timestamp at time zone 'America/Sao_Paulo';
  fim := least(now(), (dia + 1)::timestamp at time zone 'America/Sao_Paulo');

  with pv as (
    select anon, uid, ts from events
    where name = 'pageview' and not bot and ts >= ini - interval '29 days' and ts < fim
  ),
  ev as (
    select name, anon, props from events
    where ts >= ini and ts < fim and not bot
      and name in ('collection_first', 'scan_done', 'card_added', 'store_click',
                   'share_created', 'share_open', 'signup', 'search_empty', 'pwa_install')
  ),
  -- props vem do cliente: número que não for inteiro vira 0, não erro.
  n as (
    select name, anon, props,
      case when props->>'n'   ~ '^[0-9]{1,7}\Z' then (props->>'n')::int   else 0 end as n,
      case when props->>'add' ~ '^[0-9]{1,7}\Z' then (props->>'add')::int else 0 end as adicionou
    from ev
  )
  select jsonb_build_object(
    'dau',        (select count(distinct anon) from pv where anon is not null and ts >= ini),
    'wau',        (select count(distinct anon) from pv where anon is not null and ts >= ini - interval '6 days'),
    'mau',        (select count(distinct anon) from pv where anon is not null),
    'dau_users',  (select count(distinct uid) from pv where uid is not null and ts >= ini),
    'mau_users',  (select count(distinct uid) from pv where uid is not null),
    'pageviews',  (select count(*) from pv where ts >= ini),
    'novos',      (select count(*) from (
                     select anon from events
                     where name = 'pageview' and not bot and anon is not null and ts < fim
                     group by anon having min(ts) >= ini) z),
    'contas',     (select count(*) from auth.users where created_at < fim),
    'contas_novas', (select count(*) from auth.users where created_at >= ini and created_at < fim),
    'ativacoes',  (select count(*) from n where name = 'collection_first'),
    'scans',      (select count(*) from n where name = 'scan_done'),
    'cartas_scan',(select coalesce(sum(adicionou), 0) from n where name = 'scan_done'),
    'cartas_add', (select coalesce(sum(n), 0) from n where name = 'card_added'),
    'cliques_loja', (select count(*) from n where name = 'store_click'),
    'shares_criados', (select count(*) from n where name = 'share_created'),
    'shares_abertos', (select count(*) from n where name = 'share_open'),
    'buscas_vazias', (select count(*) from n where name = 'search_empty'),
    'instalacoes',   (select count(*) from n where name = 'pwa_install')
  ) into dados;

  if dia = hoje then
    with cartas as (
      select c.user_id, c.game, e1.key as card_id,
        (select coalesce(sum(
           case
             when jsonb_typeof(e2.value) = 'object' then
               (select coalesce(sum(t.v::numeric), 0)
                from jsonb_each_text(e2.value) t(k, v)
                where t.v ~ '^[0-9]+(\.[0-9]+)?\Z')
             when jsonb_typeof(e2.value) = 'number' then (e2.value)::text::numeric
             else 0
           end), 0)
         from jsonb_each(e1.value) e2) as copias
      from collections c
      cross join lateral jsonb_each(c.data->'collection') e1
      where jsonb_typeof(c.data->'collection') = 'object'
        and jsonb_typeof(e1.value) = 'object'
    )
    select dados || jsonb_build_object(
      'colecionadores',   (select count(distinct user_id) from cartas where copias > 0),
      'copias',           (select coalesce(sum(copias), 0)::bigint from cartas where copias > 0),
      'cartas_distintas', (select count(distinct (game, card_id)) from cartas where copias > 0),
      'desejos',          (select count(*) from collections c
                             cross join lateral jsonb_object_keys(c.data->'wishlist') k
                            where jsonb_typeof(c.data->'wishlist') = 'object'),
      'decks',            (select count(*) from shares where kind = 'deck'),
      'shares',           (select count(*) from shares),
      'price_points',     (select count(*) from community_prices),
      'push_subs',        (select count(*) from push_subs)
    ) into dados;
  end if;

  insert into metrics_daily (day, data, updated_at) values (dia, dados, now())
  on conflict (day) do update set data = metrics_daily.data || excluded.data, updated_at = now();
end $$;
revoke all on function public.metrics_snapshot(date) from public, anon, authenticated;

-- Retroativo: o que o `events` já tem dos últimos 120 dias.
do $$
declare d date;
begin
  for d in select g::date from generate_series(
      ((now() at time zone 'America/Sao_Paulo')::date - 119)::timestamp,
      ((now() at time zone 'America/Sao_Paulo')::date)::timestamp, interval '1 day') g
  loop
    perform public.metrics_snapshot(d);
  end loop;
end $$;

-- Agenda diária (03:05 UTC = 00:05 em Brasília): fecha o dia de ontem e abre
-- o de hoje. Só se o pg_cron estiver habilitado; sem ele o admin_growth
-- preenche os buracos quando o painel abre — perde só os campos de coleção
-- dos dias em que ninguém abriu o painel.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sleevu-metrics-daily';
    -- Comando entre aspas simples, e não num dollar-quote aninhado: é outra
    -- coisa que o editor do Supabase pode partir no meio.
    perform cron.schedule('sleevu-metrics-daily', '5 3 * * *',
      'select public.metrics_snapshot(((now() at time zone ''America/Sao_Paulo'')::date - 1)); select public.metrics_snapshot();');
  end if;
end $$;

-- ── 4a) admin_stores: cliques de saída pras lojas ───────────────────────────
create or replace function public.admin_stores(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  date;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := hoje - (d - 1);

  with ck as (
    select anon, (ts at time zone 'America/Sao_Paulo')::date as dia,
      coalesce(nullif(props->>'s', ''), '?') as s,
      coalesce(nullif(props->>'g', ''), game, '?') as g,
      nullif(props->>'c', '') as c,
      coalesce(props->>'gr', '') = '1' as gr,
      coalesce(nullif(props->>'d', ''), '?') as dv
    from events
    where name = 'store_click' and not bot
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  ),
  -- Lojas brasileiras: é com elas que a conversa de parceria acontece.
  br as (select unnest(array['liga', 'ligabra', 'myp']) as s)
  select jsonb_build_object(
    'days', d,
    'total',     (select count(*) from ck),
    'pessoas',   (select count(distinct anon) from ck),
    'br',        (select count(*) from ck where s in (select s from br)),
    'cartas',    (select count(distinct (g, c)) from ck where c is not null),
    'graduadas', (select count(*) from ck where gr),
    'celular',   (select count(*) from ck where dv = 'm'),
    -- Denominador da taxa de saída. Views contam SEM consentimento (é o
    -- contador público); cliques só COM — então a taxa é um piso.
    'views_carta', (select coalesce(sum(views), 0) from card_views_daily where day >= ini),
    'lojas', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select s, count(*)::int as cliques, count(distinct anon)::int as pessoas,
             count(distinct (g, c))::int as cartas
      from ck group by s) x),
    'lojas_jogo', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select s, g, count(*)::int as cliques, count(distinct anon)::int as pessoas
      from ck group by s, g) x),
    'daily', (select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
      select to_char(gs.dia, 'YYYY-MM-DD') as day,
        (select count(*) from ck where ck.dia = gs.dia and ck.s in (select s from br))::int as br,
        (select count(*) from ck where ck.dia = gs.dia and ck.s not in (select s from br))::int as fora
      from (select g::date as dia from generate_series(ini::timestamp, hoje::timestamp, interval '1 day') g) gs) x),
    'top', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select g as game, c as card_id, count(*)::int as cliques, count(distinct anon)::int as pessoas,
             count(*) filter (where s in (select s from br))::int as br,
             count(*) filter (where s not in (select s from br))::int as fora
      from ck where c is not null group by g, c order by count(*) desc limit 60) x),
    -- Pro CSV por loja (relatório de parceiro). O corte de privacidade
    -- (poucas pessoas) é aplicado no cliente, na hora de exportar.
    'export', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select s, g as game, c as card_id, count(*)::int as cliques, count(distinct anon)::int as pessoas
      from ck where c is not null group by s, g, c order by s, count(*) desc limit 5000) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stores(int) from public, anon;
grant execute on function public.admin_stores(int) to authenticated;

-- ── 4b) admin_retention: coortes, taxas, jornada e recortes ─────────────────
-- A unidade é o VISITANTE (uuid anônimo first-party, só com consentimento).
-- A 1ª pageview de cada um define dia de entrada, canal, aparelho e jogo.
--
--   D1  = voltou no dia seguinte            (elegível: entrou há 2+ dias)
--   D7  = voltou entre o 7º e o 13º dia     (elegível: entrou há 14+ dias)
--   D30 = voltou entre o 30º e o 59º dia    (elegível: entrou há 60+ dias)
--
-- Janelas em vez de "exatamente no dia N": com o volume de hoje, o dia exato
-- dá zero ou um e não se lê nada.
create or replace function public.admin_retention(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  date;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := hoje - (d - 1);

  with
  primeira as (
    select distinct on (anon) anon, ts as first_ts,
      (ts at time zone 'America/Sao_Paulo')::date as first_dia,
      coalesce(game, 'hub') as game, coalesce(props, '{}'::jsonb) as props
    from events
    where name = 'pageview' and not bot and anon is not null
    order by anon, ts
  ),
  -- 180 dias de coorte: dá o D30 de quem entrou há até meio ano.
  coorte as (select * from primeira where first_dia >= hoje - 180),
  evc as (
    select e.anon, e.name, e.uid, e.props, (e.ts at time zone 'America/Sao_Paulo')::date as dia
    from events e join coorte c on c.anon = e.anon
    where not e.bot
  ),
  dias as (select distinct anon, dia from evc where name = 'pageview'),
  acoes as (
    select anon,
      count(*) filter (where name = 'pageview')                           as views,
      bool_or(name = 'collection_first')                                  as ativou,
      coalesce(sum(case when name = 'card_added' and props->>'n' ~ '^[0-9]{1,7}\Z'
                        then (props->>'n')::int end), 0)                  as cartas,
      bool_or(name in ('share_created', 'deck_created'))                  as criou,
      bool_or(name = 'signup' or (name = 'pageview' and uid is not null)) as conta,
      bool_or(name = 'pwa_install' or (name = 'pageview' and props->>'s' = '1')) as app
    from evc group by anon
  ),
  ret as (
    select anon,
      bool_or(x.dia - c.first_dia = 1)               as d1,
      bool_or(x.dia - c.first_dia between 7 and 13)  as d7,
      bool_or(x.dia - c.first_dia between 30 and 59) as d30,
      bool_or(x.dia - c.first_dia >= 7)              as voltou7
    from dias x join coorte c using (anon) group by anon
  ),
  pa as (
    select c.anon, c.first_dia, c.game,
      coalesce(nullif(c.props->>'d', ''), '?')                                    as device,
      _canal(c.props->>'r', c.props->>'u')                                        as canal,
      coalesce(nullif(c.props->>'u', ''), nullif(c.props->>'r', ''), '(direto)') as origem,
      coalesce(a.views, 0) as views, coalesce(a.ativou, false) as ativou, coalesce(a.cartas, 0) as cartas,
      coalesce(a.criou, false) as criou, coalesce(a.conta, false) as conta, coalesce(a.app, false) as app,
      coalesce(r.d1, false) as d1, coalesce(r.d7, false) as d7, coalesce(r.d30, false) as d30,
      coalesce(r.voltou7, false) as voltou7,
      (hoje - c.first_dia) >= 2  as el1,
      (hoje - c.first_dia) >= 14 as el7,
      (hoje - c.first_dia) >= 60 as el30
    from coorte c left join acoes a using (anon) left join ret r using (anon)
  ),
  janela as (select * from pa where first_dia >= ini),
  -- Recortes (sempre sobre quem ENTROU na janela).
  dims as (
    select 'canal' as dim, canal as k, janela.* from janela
    union all select 'origem', origem, janela.* from janela
    union all select 'device', device, janela.* from janela
    union all select 'game', game, janela.* from janela
    union all select 'app', case when app then 'app' else 'navegador' end, janela.* from janela
    union all select 'ativacao', case when ativou then 'ativou' else 'nao' end, janela.* from janela
  ),
  grupos as (
    select dim, k,
      count(*)::int                               as n,
      count(*) filter (where ativou)::int         as ativou,
      count(*) filter (where cartas >= 10)::int   as dez,
      count(*) filter (where conta)::int          as contas,
      count(*) filter (where el7)::int            as el7,
      count(*) filter (where el7 and d7)::int     as d7,
      row_number() over (partition by dim order by count(*) desc) as rn
    from dims group by dim, k
  ),
  -- Matriz de coorte SEMANAL (segunda a domingo), 10 semanas.
  sem as (
    select c.anon, date_trunc('week', c.first_dia)::date as semana,
      ((date_trunc('week', x.dia)::date - date_trunc('week', c.first_dia)::date) / 7) as k
    from coorte c join dias x using (anon)
    where c.first_dia >= date_trunc('week', hoje)::date - 63
  ),
  matriz as (select semana, k, count(distinct anon)::int as n from sem group by semana, k),
  -- DAU/MAU: média de visitantes por dia nos últimos 30 dias ÷ visitantes
  -- únicos nos mesmos 30. Mede o hábito — 20%+ é hábito de verdade.
  ult30 as (
    select anon, (ts at time zone 'America/Sao_Paulo')::date as dia from events
    where name = 'pageview' and not bot and anon is not null
      and ts >= (hoje - 29)::timestamp at time zone 'America/Sao_Paulo'
  )
  select jsonb_build_object(
    'days', d,
    'taxas', (select jsonb_build_object(
        'coorte', count(*),
        'el1',  count(*) filter (where el1),  'd1',  count(*) filter (where el1 and d1),
        'el7',  count(*) filter (where el7),  'd7',  count(*) filter (where el7 and d7),
        'el30', count(*) filter (where el30), 'd30', count(*) filter (where el30 and d30))
      from pa where first_dia >= hoje - 120),
    'stickiness', (select jsonb_build_object(
        'dau_medio', (select round(avg(n)::numeric, 1) from (select dia, count(distinct anon) as n from ult30 group by dia) z),
        'mau', (select count(distinct anon) from ult30))),
    'jornada', (select jsonb_build_object(
        'visitantes', count(*),
        'engajados',  count(*) filter (where views >= 2),
        'ativados',   count(*) filter (where ativou),
        'dez',        count(*) filter (where cartas >= 10),
        'contas',     count(*) filter (where conta),
        'voltaram',   count(*) filter (where voltou7),
        'el7',        count(*) filter (where hoje - first_dia >= 7),
        'criaram',    count(*) filter (where criou))
      from janela),
    'cohorts', (select coalesce(jsonb_agg(jsonb_build_object(
        'semana', to_char(s.semana, 'YYYY-MM-DD'),
        'ret', (select jsonb_agg(coalesce(m.n, 0) order by kk)
                from generate_series(0, (date_trunc('week', hoje)::date - s.semana) / 7) kk
                left join matriz m on m.semana = s.semana and m.k = kk)
      ) order by s.semana), '[]'::jsonb)
      from (select distinct semana from matriz) s),
    'grupos', (select coalesce(jsonb_object_agg(dim, arr), '{}'::jsonb) from (
        select dim, jsonb_agg(jsonb_build_object('k', k, 'n', n, 'ativou', ativou, 'dez', dez,
                                                 'contas', contas, 'el7', el7, 'd7', d7) order by n desc) as arr
        from grupos where rn <= 15 group by dim) z)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_retention(int) from public, anon;
grant execute on function public.admin_retention(int) to authenticated;

-- ── 4c) admin_demand: o que está sendo procurado ────────────────────────────
-- Índice de demanda = views + 5 × cliques em loja + 10 × contas com a carta
-- na wishlist. Pesos pela intenção: olhar é barato, sair pra comprar é
-- intenção forte, pôr na wishlist é intenção declarada e duradoura. É uma
-- ordenação, não uma medida — os três números vão junto pra quem quiser
-- ler de outro jeito.
create or replace function public.admin_demand(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  date;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := hoje - (d - 1);

  with
  vw as (select game as g, card_id as c, sum(views)::int as v
         from card_views_daily where day >= ini group by 1, 2),
  vp as (select game as g, card_id as c, sum(views)::int as v
         from card_views_daily where day >= ini - d and day < ini group by 1, 2),
  cq as (select coalesce(nullif(props->>'g', ''), game) as g, props->>'c' as c, count(*)::int as n
         from events
         where name = 'store_click' and not bot and coalesce(props->>'c', '') <> ''
           and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
         group by 1, 2),
  wl as (select c.game as g, k as c, count(distinct c.user_id)::int as n
         from collections c cross join lateral jsonb_object_keys(c.data->'wishlist') k
         where jsonb_typeof(c.data->'wishlist') = 'object'
         group by 1, 2),
  todas as (select g, c from vw union select g, c from cq union select g, c from wl),
  sc as (
    select t.g as game, t.c as card_id,
      coalesce(vw.v, 0) as views, coalesce(vp.v, 0) as views_antes,
      coalesce(cq.n, 0) as cliques, coalesce(wl.n, 0) as desejos,
      coalesce(vw.v, 0) + 5 * coalesce(cq.n, 0) + 10 * coalesce(wl.n, 0) as indice
    from todas t
    left join vw on vw.g = t.g and vw.c = t.c
    left join vp on vp.g = t.g and vp.c = t.c
    left join cq on cq.g = t.g and cq.c = t.c
    left join wl on wl.g = t.g and wl.c = t.c
  ),
  -- Em alta: últimos 7 dias contra os 7 anteriores, independente da janela.
  -- Piso de 5 views pra uma carta com 1 → 3 não virar "+200%".
  a7 as (select game as g, card_id as c, sum(views)::int as v from card_views_daily where day > hoje - 7 group by 1, 2),
  b7 as (select game as g, card_id as c, sum(views)::int as v from card_views_daily where day > hoje - 14 and day <= hoje - 7 group by 1, 2),
  buscas as (
    select lower(props->>'q') as q, coalesce(nullif(props->>'g', ''), '') as g, anon
    from events
    where name = 'search_empty' and not bot and coalesce(props->>'q', '') <> ''
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  )
  select jsonb_build_object(
    'days', d,
    'top', (select coalesce(jsonb_agg(row_to_json(x) order by x.indice desc), '[]'::jsonb) from (
      select * from sc where indice > 0 order by indice desc limit 60) x),
    'by_game', (select coalesce(jsonb_agg(row_to_json(x) order by x.game, x.indice desc), '[]'::jsonb) from (
      select game, card_id, views, cliques, desejos, indice from (
        select sc.*, row_number() over (partition by game order by indice desc) as rn from sc where indice > 0) r
      where rn <= 8) x),
    'jogos', (select coalesce(jsonb_agg(row_to_json(x) order by x.indice desc), '[]'::jsonb) from (
      select game, sum(views)::int as views, sum(views_antes)::int as views_antes,
             sum(cliques)::int as cliques, sum(desejos)::int as desejos, sum(indice)::int as indice
      from sc group by game) x),
    'em_alta', (select coalesce(jsonb_agg(row_to_json(x) order by x.ratio desc, x.agora desc), '[]'::jsonb) from (
      select a7.g as game, a7.c as card_id, a7.v as agora, coalesce(b7.v, 0) as antes,
             round((a7.v + 1)::numeric / (coalesce(b7.v, 0) + 1), 2) as ratio
      from a7 left join b7 on b7.g = a7.g and b7.c = a7.c
      where a7.v >= 5
      order by ratio desc, a7.v desc limit 25) x),
    'buscas', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
      select q, g as game, count(*)::int as n, count(distinct anon)::int as pessoas
      from buscas group by q, g order by count(*) desc limit 60) x),
    'buscas_total', (select count(*) from buscas)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_demand(int) from public, anon;
grant execute on function public.admin_demand(int) to authenticated;

-- ── 4d) admin_growth: série diária e viralidade ─────────────────────────────
-- VOLATILE de propósito: antes de ler, preenche os dias que faltam na série
-- (sem pg_cron, é isto que mantém a curva inteira) e refaz ontem e hoje.
create or replace function public.admin_growth(days int default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  date;
  dia  date;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := hoje - (d - 1);

  for dia in select g::date from generate_series((hoje - 119)::timestamp, hoje::timestamp, interval '1 day') g loop
    if dia >= hoje - 1 or not exists (select 1 from metrics_daily m where m.day = dia) then
      perform metrics_snapshot(dia);
    end if;
  end loop;

  with
  so as (
    select anon, coalesce(props->>'nv', '') = '1' as novo, coalesce(props->>'k', '?') as k
    from events
    where name = 'share_open' and not bot
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  ),
  novos as (select distinct anon from so where novo and anon is not null),
  ativados as (
    select distinct e.anon from events e join novos n on n.anon = e.anon
    where e.name = 'collection_first'
  )
  select jsonb_build_object(
    'days', d,
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD')) || data order by day), '[]'::jsonb)
              from metrics_daily where day >= hoje - 400),
    'viral', jsonb_build_object(
      'aberturas',   (select count(*) from so),
      'novos',       (select count(*) from novos),
      'ativados',    (select count(*) from ativados),
      'compartilhadores', (select count(distinct anon) from events
                           where name = 'share_created' and not bot
                             and ts >= ini::timestamp at time zone 'America/Sao_Paulo'),
      'por_tipo', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
        select k, count(*)::int as n, count(*) filter (where novo)::int as novos from so group by k) x))
  ) into res;
  return res;
end $$;
revoke all on function public.admin_growth(int) from public, anon;
grant execute on function public.admin_growth(int) to authenticated;

-- ── 5) admin_funnel: campos de antes + scanner por jogo e conversões ────────
-- Todas as chaves da 20260919a continuam com o mesmo formato (o admin.js
-- antigo segue funcionando); as novas vêm no fim.
create or replace function public.admin_funnel(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d   int;
  ini timestamptz;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    return null;
  end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
         - make_interval(days => d - 1);

  return (
    with ev as (
      select name, anon, uid, game, ts, props from events
      where ts >= ini and not bot
        and name in ('scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate',
                     'signup', 'pwa_install')
    ),
    num as (
      select name, anon, game, props,
        case when props->>'n'     ~ '^[0-9]{1,7}\Z' then (props->>'n')::int     else 0 end as n,
        case when props->>'lido'  ~ '^[0-9]{1,7}\Z' then (props->>'lido')::int  else 0 end as lido,
        case when props->>'achou' ~ '^[0-9]{1,7}\Z' then (props->>'achou')::int else 0 end as achou,
        case when props->>'add'   ~ '^[0-9]{1,7}\Z' then (props->>'add')::int   else 0 end as adicionou,
        case when props->>'ms'    ~ '^[0-9]{1,10}\Z' then (props->>'ms')::bigint else 0 end as ms,
        case when props->>'t1'    ~ '^[0-9]{1,10}\Z' then (props->>'t1')::bigint else 0 end as t1
      from ev
    ),
    gate as (select anon, min(ts) as ts from ev where name = 'login_gate' and anon is not null group by anon)
    select jsonb_build_object(
      'days', d,
      'scan', jsonb_build_object(
        'aberturas', (select count(*)::int from ev where name = 'scan_open'),
        'pessoas',   (select count(distinct anon)::int from ev where name = 'scan_open'),
        'sessoes',   (select count(*)::int from num where name = 'scan_done'),
        'tentativas',(select coalesce(sum(n), 0)::int     from num where name = 'scan_done'),
        'leu',       (select coalesce(sum(lido), 0)::int  from num where name = 'scan_done'),
        'achou',     (select coalesce(sum(achou), 0)::int from num where name = 'scan_done'),
        'adicionou', (select coalesce(sum(adicionou), 0)::int from num where name = 'scan_done'),
        'secas',     (select count(*)::int from num where name = 'scan_done' and adicionou = 0)
      ),
      'cadastro', (select coalesce(jsonb_agg(row_to_json(x) order by x.cartas desc), '[]'::jsonb) from (
        select
          coalesce(props->>'via', 'ui')        as via,
          count(*)::int                        as rajadas,
          coalesce(sum(n), 0)::int             as cartas,
          count(distinct anon)::int            as pessoas,
          round(percentile_cont(0.5) within group (
            order by case when ms > 0 and n >= 5 then n::numeric / (ms::numeric / 60000) end
          )::numeric, 1)                       as cartas_min
        from num where name = 'card_added'
        group by 1) x),
      'ativados',  (select count(distinct anon)::int from ev where name = 'collection_first'),
      'gate',      (select count(*)::int from ev where name = 'login_gate'),
      'gate_pessoas', (select count(distinct anon)::int from ev where name = 'login_gate'),
      'gate_paginas', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
        select coalesce(props->>'p', '?') as pagina, count(*)::int as n
        from ev where name = 'login_gate' group by 1 limit 12) x),

      -- ── novos (20260923a) ──
      -- Scanner por jogo: onde o OCR/catálogo falha mais.
      'scan_jogos', (select coalesce(jsonb_agg(row_to_json(x) order by x.sessoes desc), '[]'::jsonb) from (
        select coalesce(game, '?') as game, count(*)::int as sessoes, count(distinct anon)::int as pessoas,
               coalesce(sum(n), 0)::int as tentativas, coalesce(sum(lido), 0)::int as leu,
               coalesce(sum(achou), 0)::int as achou, coalesce(sum(adicionou), 0)::int as adicionou,
               count(*) filter (where adicionou = 0)::int as secas
        from num where name = 'scan_done' group by 1) x),
      -- Mediana do tempo entre abrir o scanner e pôr a 1ª carta na coleção.
      'scan_t1_ms', (select round(percentile_cont(0.5) within group (order by t1))::bigint
                     from num where name = 'scan_done' and t1 > 0),
      -- Dos que bateram no login, quantos entraram DEPOIS (conta nova ou
      -- pageview logada).
      'gate_conv', (select count(*)::int from gate g
                    where exists (select 1 from events e where e.anon = g.anon and e.ts >= g.ts
                                    and (e.name = 'signup' or (e.name = 'pageview' and e.uid is not null)))),
      'signups', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
        select coalesce(props->>'m', '?') as m, count(*)::int as n from ev where name = 'signup' group by 1) x),
      'instalacoes', (select count(*)::int from ev where name = 'pwa_install')
    )
  );
end $$;
revoke all on function public.admin_funnel(int) from public, anon;
grant execute on function public.admin_funnel(int) to authenticated;
