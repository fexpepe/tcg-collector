-- ============================================================================
-- Analytics 2.1 (2026-09-28)
--
-- Continuação da 20260923a. Quatro blocos, na ordem das prioridades que o
-- Fernando aprovou:
--
--   P1  valor catalogado (R$ em cartas no Sleevu) · valor encaminhado às lojas
--       (quanto valiam as cartas que levaram gente pra loja) · quantos
--       navegadores DESLIGARAM a medição (o fator de correção de tudo) ·
--       alarme de medição parada · tempo de uso por visita
--   P2  retenção por CONTA (junta celular e computador) · buscas mais feitas ·
--       demanda por set e curva de lançamento · custo por campanha ·
--       "Primeiros passos" e alertas de push
--   P3  portal da loja (link privado, só-leitura) · resumo diário + limpeza dos
--       eventos brutos depois de 13 meses · experimentos A/B
--   P4  quem são os usuários: faixas de valor e de tamanho de coleção,
--       concentração, maiores coleções, perfis de uso, dormentes
--
-- ADITIVA. Pode aplicar a qualquer momento; as RPCs recriadas (admin_stores,
-- admin_retention, admin_demand, metrics_snapshot) mantêm todas as chaves de
-- antes e só ganham campos.
--
-- ORDEM: aplicar ANTES do JS (nome fora da whitelist do events_guard some
-- calado — mesma armadilha de sempre).
--
-- REGRA DESTE ARQUIVO: nenhum cifrão dentro de corpo de função. Um cifrão
-- solto lá dentro confunde o SQL Editor do Supabase ("unterminated
-- dollar-quoted string", 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Eventos novos na whitelist:
--   page_time      tempo VISÍVEL numa página, mandado ao sair dela.
--                    ms (tempo) · d (m/d)            — 1 por página vista
--   search_hit     busca que achou algo (par do search_empty).
--                    q (termo) · g (jogo) · n (resultados)
--   onboard_state  estado do "Primeiros passos" no Dashboard, 1x por sessão.
--                    f (feitos) · t (total) · s (ids feitos) · off (dispensou)
--   exp_view       a pessoa viu a variante v do experimento e (1x por sessão)
--   push_sent      o robô do push (GitHub Action) enviou n avisos
-- store_click ganha v (valor da carta em R$, inteiro) — props é livre.
--
-- Conferir depois de aplicar:
--   select public.analytics_sentinela();             -- [] ou a lista de alarmes
--   select count(*) from public.events_daily;        -- > 0 (resumo retroativo)
-- ============================================================================

-- ── 0) events_guard: só a whitelist muda ────────────────────────────────────
-- Cópia fiel da 20260927a (vitrine: ad_view/ad_click continuam) + os cinco
-- nomes da 2.1.
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
    'store_click', 'signup', 'search_empty', 'share_open', 'pwa_install',
    'ad_view', 'ad_click',
    'page_time', 'search_hit', 'onboard_state', 'exp_view', 'push_sent'
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

-- Número inteiro vindo de props (cliente): o que não for inteiro vira 0.
create or replace function public._int(p text)
returns bigint language sql immutable as $$
  select case when p ~ '^[0-9]{1,12}\Z' then p::bigint else 0 end
$$;

-- Quantos itens tem um blob do save (array ou objeto; o resto é 0).
create or replace function public._jcount(j jsonb)
returns int language sql immutable as $$
  select case jsonb_typeof(j)
    when 'array'  then jsonb_array_length(j)
    when 'object' then (select count(*)::int from jsonb_object_keys(j))
    else 0 end
$$;

-- Número de um campo do histórico (history2): c/b/w em R$.
create or replace function public._num(p text)
returns numeric language sql immutable as $$
  select case when p ~ '^-?[0-9]{1,12}(\.[0-9]+)?\Z' then p::numeric else 0 end
$$;

-- ── P1 · 1) Coleção por USUÁRIO ─────────────────────────────────────────────
-- Uma linha por conta com coleção na nuvem. É a base do valor catalogado
-- (metrics_snapshot) e da página Usuários (admin_users).
--
-- VALOR: o último ponto do histórico do portfólio (history2) de cada jogo —
-- o app grava 1 ponto por dia em que a pessoa abre o Portfólio/Dashboard, em
-- R$, e ele sincroniza. É o valor da ÚLTIMA VISITA dela, não o de hoje; conta
-- sem histórico entra com valor 0 (e é contada à parte).
-- Os blobs GLOBAIS (decks, vendas, graded, custos…) vêm repetidos em toda
-- linha de jogo da mesma conta — daí o max() em vez de soma.
create or replace function public._colecao_usuarios()
returns table (
  user_id uuid, jogos text[], copias numeric, distintas int, valor numeric,
  valor_graded numeric, valor_desejos numeric, com_historico boolean, valor_desde date,
  desejos int, decks int, vendas int, vendidas int, graded int, custos int, alvos int,
  listas int, itens_manuais int
) language sql stable security definer set search_path = public as $$
  with linhas as (
    select c.user_id, c.game, c.data,
      (select coalesce(sum(
         case when jsonb_typeof(e2.value) = 'object' then
                (select coalesce(sum(_num(t.v)), 0) from jsonb_each_text(e2.value) t(k, v))
              when jsonb_typeof(e2.value) = 'number' then (e2.value)::text::numeric
              else 0 end), 0)
       from jsonb_each(case when jsonb_typeof(c.data->'collection') = 'object' then c.data->'collection' else '{}'::jsonb end) e1
       cross join lateral jsonb_each(case when jsonb_typeof(e1.value) = 'object' then e1.value else '{}'::jsonb end) e2) as copias,
      (select count(*) from jsonb_each(case when jsonb_typeof(c.data->'collection') = 'object' then c.data->'collection' else '{}'::jsonb end) e1
        where jsonb_typeof(e1.value) = 'object'
          and (select coalesce(sum(case when jsonb_typeof(e2.value) = 'object' then
                  (select coalesce(sum(_num(t.v)), 0) from jsonb_each_text(e2.value) t(k, v))
                  when jsonb_typeof(e2.value) = 'number' then (e2.value)::text::numeric else 0 end), 0)
               from jsonb_each(e1.value) e2) > 0)::int as distintas,
      case when jsonb_typeof(c.data->'history2') = 'array' and jsonb_array_length(c.data->'history2') > 0
           then c.data->'history2'->-1 end as ult
    from collections c
  )
  select l.user_id,
    array_agg(l.game order by l.game) filter (where l.copias > 0),
    sum(l.copias), sum(l.distintas)::int,
    sum(_num(l.ult->>'c') + _num(l.ult->>'b')),
    sum(_num(l.ult->>'b')), sum(_num(l.ult->>'w')),
    bool_or(l.ult is not null),
    max(case when (l.ult->>'d') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z' then (l.ult->>'d')::date end),
    sum(_jcount(l.data->'wishlist'))::int,
    max(_jcount(l.data->'decks')), max(_jcount(l.data->'sales')), max(_jcount(l.data->'sold')),
    max(_jcount(l.data->'graded')), max(_jcount(l.data->'costs')), max(_jcount(l.data->'wishTargets')),
    max(_jcount(l.data->'lists')), max(_jcount(l.data->'manual'))
  from linhas l
  group by l.user_id
$$;
revoke all on function public._colecao_usuarios() from public, anon, authenticated;

-- ── P1 · 2) metrics_snapshot: + valor catalogado ────────────────────────────
-- Igual à 20260923a, mais os campos de VALOR no retrato de hoje e o tempo de
-- uso do dia.
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
                   'share_created', 'share_open', 'signup', 'search_empty', 'pwa_install',
                   'page_time', 'search_hit')
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
    'ativacoes',  (select count(*) from ev where name = 'collection_first'),
    'scans',      (select count(*) from ev where name = 'scan_done'),
    'cartas_scan',(select coalesce(sum(_int(props->>'add')), 0) from ev where name = 'scan_done'),
    'cartas_add', (select coalesce(sum(_int(props->>'n')), 0) from ev where name = 'card_added'),
    'cliques_loja', (select count(*) from ev where name = 'store_click'),
    'valor_encaminhado', (select coalesce(sum(_int(props->>'v')), 0) from ev where name = 'store_click'),
    'shares_criados', (select count(*) from ev where name = 'share_created'),
    'shares_abertos', (select count(*) from ev where name = 'share_open'),
    'buscas',        (select count(*) from ev where name in ('search_hit', 'search_empty')),
    'buscas_vazias', (select count(*) from ev where name = 'search_empty'),
    'instalacoes',   (select count(*) from ev where name = 'pwa_install'),
    'tempo_ms',      (select coalesce(sum(least(_int(props->>'ms'), 1800000)), 0) from ev where name = 'page_time')
  ) into dados;

  if dia = hoje then
    select dados || jsonb_build_object(
      'colecionadores',   (select count(*) from _colecao_usuarios() where copias > 0),
      'copias',           (select coalesce(sum(copias), 0)::bigint from _colecao_usuarios()),
      'cartas_distintas', (select coalesce(sum(distintas), 0)::bigint from _colecao_usuarios()),
      'valor_catalogado', (select round(coalesce(sum(valor), 0))::bigint from _colecao_usuarios()),
      'valor_graded',     (select round(coalesce(sum(valor_graded), 0))::bigint from _colecao_usuarios()),
      'valor_desejos',    (select round(coalesce(sum(valor_desejos), 0))::bigint from _colecao_usuarios()),
      'desejos',          (select coalesce(sum(desejos), 0)::bigint from _colecao_usuarios()),
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
-- Retrato de hoje já com o valor.
select public.metrics_snapshot();

-- ── P1 · 3) Quem DESLIGOU a medição ─────────────────────────────────────────
-- A medição é opt-out (ligada por padrão). Todo número do painel conta só os
-- navegadores que não desligaram — e não se sabia quantos são. Aqui entra
-- APENAS a decisão, no momento em que acontece: um contador por dia, sem
-- identificador, sem página, sem nada (mesmo grão do card_views).
create table if not exists public.consent_daily (
  day       date primary key,
  recusou   int not null default 0,
  reativou  int not null default 0
);
alter table public.consent_daily enable row level security;
revoke all on public.consent_daily from public, anon, authenticated;

create or replace function public.consent_tally(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_on is null then return; end if;
  if not _rate_ok('consent', 10) then return; end if;
  insert into consent_daily (day, recusou, reativou)
  values ((now() at time zone 'America/Sao_Paulo')::date, case when p_on then 0 else 1 end, case when p_on then 1 else 0 end)
  on conflict (day) do update set
    recusou  = consent_daily.recusou  + excluded.recusou,
    reativou = consent_daily.reativou + excluded.reativou;
end $$;
revoke all on function public.consent_tally(boolean) from public;
grant execute on function public.consent_tally(boolean) to anon, authenticated;

-- ── P1 · 4) Alarme de medição parada ────────────────────────────────────────
-- Um evento que chegava todo dia e zerou é quase sempre medição quebrada
-- (nome fora da whitelist, migração não aplicada, link de loja que mudou), não
-- falta de uso. Regra: média de 3+/dia nos 14 dias anteriores e ZERO nas
-- últimas 48h. Por loja também (clique numa loja que zerou = busca dela mudou).
create or replace function public._sentinela()
returns table (alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  with base as (
    select case when name = 'store_click' then 'store_click:' || coalesce(props->>'s', '?') else name end as alvo,
           ts
    from events
    where not bot and ts >= now() - interval '16 days'
      and name not in ('jserror', 'push_sent')
    union all
    select name, ts from events where not bot and ts >= now() - interval '16 days' and name = 'store_click'
  ),
  agg as (
    select alvo,
      count(*) filter (where ts >= now() - interval '48 hours')::int as ultimas48h,
      round((count(*) filter (where ts < now() - interval '48 hours'))::numeric / 14, 1) as media_dia,
      max(ts) as ultimo
    from base group by alvo
  )
  select alvo, ultimas48h, media_dia, ultimo from agg
$$;
revoke all on function public._sentinela() from public, anon, authenticated;

-- Pro robô do healthcheck (anon): só os NOMES em alarme, sem contagem nenhuma.
create or replace function public.analytics_sentinela()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(alvo order by alvo), '[]'::jsonb)
  from _sentinela() where media_dia >= 3 and ultimas48h = 0
$$;
revoke all on function public.analytics_sentinela() from public;
grant execute on function public.analytics_sentinela() to anon, authenticated;

create or replace function public.admin_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  return jsonb_build_object(
    'alvos', (select coalesce(jsonb_agg(jsonb_build_object(
                'alvo', alvo, 'ultimas48h', ultimas48h, 'media_dia', media_dia, 'ultimo', ultimo,
                'alerta', media_dia >= 3 and ultimas48h = 0) order by alvo), '[]'::jsonb)
              from _sentinela()),
    'metrics_ultimo', (select max(day) from metrics_daily),
    'rollup_ultimo', (select max(day) from events_daily),
    'eventos_mais_antigo', (select min(ts) from events),
    'eventos_total', (select count(*) from events),
    'cron', (select case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'ligado' else 'desligado' end)
  );
end $$;
revoke all on function public.admin_health() from public, anon;
grant execute on function public.admin_health() to authenticated;

-- ── P1 · 5) admin_engagement: tempo de uso, consentimento, onboarding, push ─
-- TEMPO: page_time é o tempo VISÍVEL de cada página (aba em segundo plano não
-- conta), mandado ao sair dela. Uma VISITA = páginas do mesmo navegador sem
-- pausa de 30 min. Página com mais de 30 min é cortada em 30 (aba esquecida
-- aberta não pode virar "sessão de 9 horas").
create or replace function public.admin_engagement(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  timestamptz;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo';

  with pt as (
    select anon, ts, path, coalesce(nullif(props->>'d', ''), '?') as dv,
           least(_int(props->>'ms'), 1800000) as ms
    from events where name = 'page_time' and not bot and anon is not null and ts >= ini
  ),
  marcas as (
    select *, case when lag(ts) over (partition by anon order by ts) is null
                     or ts - lag(ts) over (partition by anon order by ts) > interval '30 minutes'
                   then 1 else 0 end as nova
    from pt
  ),
  sess as (
    select anon, sum(nova) over (partition by anon order by ts) as sid, ms, dv from marcas
  ),
  visitas as (
    select anon, sid, sum(ms) as ms, count(*) as paginas, max(dv) as dv from sess group by anon, sid
  ),
  ob as (
    select distinct on (anon) anon, props from events
    where name = 'onboard_state' and not bot and anon is not null and ts >= ini
    order by anon, ts desc
  ),
  push_ab as (
    select anon, ts from events
    where name = 'pageview' and not bot and anon is not null and ts >= ini
      and props->>'u' = 'push'
  )
  select jsonb_build_object(
    'days', d,
    'tempo', jsonb_build_object(
      'visitas',   (select count(*) from visitas),
      'mediana_ms',(select round(percentile_cont(0.5) within group (order by ms))::bigint from visitas),
      'media_ms',  (select round(avg(ms))::bigint from visitas),
      'p90_ms',    (select round(percentile_cont(0.9) within group (order by ms))::bigint from visitas),
      'paginas_visita', (select round(avg(paginas), 1) from visitas),
      'visitas_por_pessoa', (select round(count(*)::numeric / nullif(count(distinct anon), 0), 2) from visitas),
      'por_aparelho', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
         select dv, count(*)::int as visitas,
                round(percentile_cont(0.5) within group (order by ms))::bigint as mediana_ms
         from visitas group by dv) x),
      'faixas', (select coalesce(jsonb_agg(row_to_json(x) order by x.ord), '[]'::jsonb) from (
         select case when ms < 10000 then 1 when ms < 60000 then 2 when ms < 300000 then 3 when ms < 900000 then 4 else 5 end as ord,
                count(*)::int as n
         from visitas group by 1) x),
      'por_pagina', (select coalesce(jsonb_agg(row_to_json(x) order by x.total_ms desc), '[]'::jsonb) from (
         select coalesce(path, '?') as path, count(*)::int as vistas,
                round(percentile_cont(0.5) within group (order by ms))::bigint as mediana_ms,
                sum(ms)::bigint as total_ms
         from pt group by 1 order by sum(ms) desc limit 20) x)
    ),
    'consentimento', jsonb_build_object(
      'recusou',  (select coalesce(sum(recusou), 0) from consent_daily where day >= hoje - (d - 1)),
      'reativou', (select coalesce(sum(reativou), 0) from consent_daily where day >= hoje - (d - 1)),
      'recusou_total',  (select coalesce(sum(recusou), 0) from consent_daily),
      'reativou_total', (select coalesce(sum(reativou), 0) from consent_daily),
      'desde', (select min(day) from consent_daily),
      'visitantes', (select count(distinct anon) from events where name = 'pageview' and not bot and anon is not null and ts >= ini),
      'visitantes_total', (select count(distinct anon) from events where name = 'pageview' and not bot and anon is not null)
    ),
    'onboarding', jsonb_build_object(
      'pessoas', (select count(*) from ob),
      'dispensou', (select count(*) from ob where props->>'off' = '1'),
      'por_feitos', (select coalesce(jsonb_agg(row_to_json(x) order by x.f), '[]'::jsonb) from (
         select _int(props->>'f')::int as f, count(*)::int as n from ob group by 1) x),
      'passos', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
         select p as passo, count(*)::int as n
         from ob cross join lateral unnest(string_to_array(coalesce(props->>'s', ''), ',')) p
         where p <> '' group by p) x)
    ),
    'push', jsonb_build_object(
      'enviados', (select coalesce(sum(_int(props->>'n')), 0) from events where name = 'push_sent' and ts >= ini),
      'aberturas', (select count(*) from push_ab),
      'pessoas', (select count(distinct anon) from push_ab),
      -- clicou numa loja até 1h depois de abrir o aviso
      'loja_1h', (select count(distinct a.anon) from push_ab a
                  where exists (select 1 from events e where e.anon = a.anon and e.name = 'store_click'
                                  and e.ts between a.ts and a.ts + interval '1 hour'))
    ),
    'buscas', jsonb_build_object(
      'achou', (select count(*) from events where name = 'search_hit' and not bot and ts >= ini),
      'vazia', (select count(*) from events where name = 'search_empty' and not bot and ts >= ini)
    )
  ) into res;
  return res;
end $$;
revoke all on function public.admin_engagement(int) from public, anon;
grant execute on function public.admin_engagement(int) to authenticated;

-- ── P1 · 6) admin_stores: + valor encaminhado ───────────────────────────────
-- Igual à 20260923a + `valor` (soma do valor em R$ das cartas clicadas, que o
-- cliente manda em props.v) em cada recorte.
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
      coalesce(nullif(props->>'d', ''), '?') as dv,
      _int(props->>'v') as v
    from events
    where name = 'store_click' and not bot
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  ),
  br as (select unnest(array['liga', 'ligabra', 'myp']) as s)
  select jsonb_build_object(
    'days', d,
    'total',     (select count(*) from ck),
    'pessoas',   (select count(distinct anon) from ck),
    'br',        (select count(*) from ck where s in (select s from br)),
    'cartas',    (select count(distinct (g, c)) from ck where c is not null),
    'graduadas', (select count(*) from ck where gr),
    'celular',   (select count(*) from ck where dv = 'm'),
    'valor',     (select coalesce(sum(v), 0) from ck),
    'valor_br',  (select coalesce(sum(v), 0) from ck where s in (select s from br)),
    'com_valor', (select count(*) from ck where v > 0),
    'views_carta', (select coalesce(sum(views), 0) from card_views_daily where day >= ini),
    'lojas', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select s, count(*)::int as cliques, count(distinct anon)::int as pessoas,
             count(distinct (g, c))::int as cartas, coalesce(sum(v), 0)::bigint as valor
      from ck group by s) x),
    'lojas_jogo', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select s, g, count(*)::int as cliques, count(distinct anon)::int as pessoas, coalesce(sum(v), 0)::bigint as valor
      from ck group by s, g) x),
    'daily', (select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
      select to_char(gs.dia, 'YYYY-MM-DD') as day,
        (select count(*) from ck where ck.dia = gs.dia and ck.s in (select s from br))::int as br,
        (select count(*) from ck where ck.dia = gs.dia and ck.s not in (select s from br))::int as fora,
        (select coalesce(sum(v), 0) from ck where ck.dia = gs.dia)::bigint as valor
      from (select g::date as dia from generate_series(ini::timestamp, hoje::timestamp, interval '1 day') g) gs) x),
    'top', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select g as game, c as card_id, count(*)::int as cliques, count(distinct anon)::int as pessoas,
             count(*) filter (where s in (select s from br))::int as br,
             count(*) filter (where s not in (select s from br))::int as fora,
             max(v)::bigint as valor_carta, coalesce(sum(v), 0)::bigint as valor
      from ck where c is not null group by g, c order by count(*) desc limit 60) x),
    'export', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select s, g as game, c as card_id, count(*)::int as cliques, count(distinct anon)::int as pessoas,
             coalesce(sum(v), 0)::bigint as valor
      from ck where c is not null group by s, g, c order by s, count(*) desc limit 5000) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stores(int) from public, anon;
grant execute on function public.admin_stores(int) to authenticated;

-- ── P2 · 1) admin_retention: + retenção por CONTA ───────────────────────────
-- Corpo da 20260923a + o bloco `contas` (coorte pela 1ª pageview logada).
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
  ),
  -- RETENÇÃO POR CONTA (2.1): a mesma conta em celular e computador é UMA
  -- pessoa. Só vale pra quem entra logado, mas é a retenção de quem importa.
  pu as (
    select uid, (ts at time zone 'America/Sao_Paulo')::date as dia
    from events where name = 'pageview' and not bot and uid is not null
  ),
  primeira_u as (select uid, min(dia) as first_dia from pu group by uid),
  coorte_u as (select * from primeira_u where first_dia >= hoje - 180),
  dias_u as (select distinct pu.uid, pu.dia from pu join coorte_u using (uid)),
  ret_u as (
    select c.uid, c.first_dia,
      bool_or(x.dia - c.first_dia = 1)               as d1,
      bool_or(x.dia - c.first_dia between 7 and 13)  as d7,
      bool_or(x.dia - c.first_dia between 30 and 59) as d30
    from coorte_u c join dias_u x using (uid) group by c.uid, c.first_dia
  ),
  sem_u as (
    select c.uid, date_trunc('week', c.first_dia)::date as semana,
      ((date_trunc('week', x.dia)::date - date_trunc('week', c.first_dia)::date) / 7) as k
    from coorte_u c join dias_u x using (uid)
    where c.first_dia >= date_trunc('week', hoje)::date - 63
  ),
  matriz_u as (select semana, k, count(distinct uid)::int as n from sem_u group by semana, k)
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
    'contas', jsonb_build_object(
      'taxas', (select jsonb_build_object(
          'coorte', count(*),
          'el1',  count(*) filter (where hoje - first_dia >= 2),  'd1',  count(*) filter (where hoje - first_dia >= 2 and d1),
          'el7',  count(*) filter (where hoje - first_dia >= 14), 'd7',  count(*) filter (where hoje - first_dia >= 14 and d7),
          'el30', count(*) filter (where hoje - first_dia >= 60), 'd30', count(*) filter (where hoje - first_dia >= 60 and d30))
        from ret_u where first_dia >= hoje - 120),
      'cohorts', (select coalesce(jsonb_agg(jsonb_build_object(
          'semana', to_char(s.semana, 'YYYY-MM-DD'),
          'ret', (select jsonb_agg(coalesce(m.n, 0) order by kk)
                  from generate_series(0, (date_trunc('week', hoje)::date - s.semana) / 7) kk
                  left join matriz_u m on m.semana = s.semana and m.k = kk)
        ) order by s.semana), '[]'::jsonb)
        from (select distinct semana from matriz_u) s)),
    'grupos', (select coalesce(jsonb_object_agg(dim, arr), '{}'::jsonb) from (
        select dim, jsonb_agg(jsonb_build_object('k', k, 'n', n, 'ativou', ativou, 'dez', dez,
                                                 'contas', contas, 'el7', el7, 'd7', d7) order by n desc) as arr
        from grupos where rn <= 15 group by dim) z)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_retention(int) from public, anon;
grant execute on function public.admin_retention(int) to authenticated;

-- ── P2 · 2) admin_demand: + buscas mais feitas, base por set e séries ───────
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
    'buscas_total', (select count(*) from buscas),
    -- 2.1: o que MAIS se procura (busca que achou algo).
    'buscas_top', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
      select lower(props->>'q') as q, coalesce(nullif(props->>'g', ''), '') as game,
             count(*)::int as n, count(distinct anon)::int as pessoas
      from events
      where name = 'search_hit' and not bot and coalesce(props->>'q', '') <> ''
        and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
      group by 1, 2 order by count(*) desc limit 60) x),
    -- 2.1: base pra DEMANDA POR SET. O banco não sabe o set de uma carta (nos
    -- jogos do TCGCSV o id é id de produto), então vai a lista por carta e o
    -- painel agrupa pelo catálogo. Compacta: [jogo, id, views, cliques, desejos].
    'cartas', (select coalesce(jsonb_agg(jsonb_build_array(game, card_id, views, cliques, desejos) order by indice desc), '[]'::jsonb)
               from (select * from sc where indice > 0 order by indice desc limit 1500) x),
    -- 2.1: CURVA DE LANÇAMENTO. Views por dia (45 dias) das 300 cartas mais
    -- vistas; o painel soma por set e mostra os sets lançados há pouco.
    'series_ini', to_char(hoje - 44, 'YYYY-MM-DD'),
    'series', (select coalesce(jsonb_agg(jsonb_build_array(t.game, t.card_id, (
                  select jsonb_agg(coalesce(v.views, 0) order by gs.dia)
                  from (select g::date as dia from generate_series((hoje - 44)::timestamp, hoje::timestamp, interval '1 day') g) gs
                  left join card_views_daily v on v.game = t.game and v.card_id = t.card_id and v.day = gs.dia))), '[]'::jsonb)
               from (select game, card_id from card_views_daily where day > hoje - 45
                     group by game, card_id order by sum(views) desc limit 300) t)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_demand(int) from public, anon;
grant execute on function public.admin_demand(int) to authenticated;

-- ── P2 · 3) Custo por campanha ──────────────────────────────────────────────
-- O Fernando anota no /admin quanto gastou em cada campanha (utm_source +
-- utm_campaign) e o painel cruza com quem ela trouxe: custo por visitante,
-- por ativação, por conta. Tabela privada; só as RPCs de admin mexem.
create table if not exists public.campaign_costs (
  id         bigserial primary key,
  fonte      text not null,
  campanha   text not null default '',
  valor      numeric(12, 2) not null check (valor >= 0),
  nota       text,
  created_at timestamptz not null default now()
);
alter table public.campaign_costs enable row level security;
revoke all on public.campaign_costs from public, anon, authenticated;

create or replace function public.admin_campaign_save(p_fonte text, p_campanha text, p_valor numeric, p_nota text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  if not _is_admin() then return null; end if;
  if coalesce(trim(p_fonte), '') = '' or p_valor is null or p_valor < 0 then return null; end if;
  insert into campaign_costs (fonte, campanha, valor, nota)
  values (lower(left(trim(p_fonte), 30)), lower(left(trim(coalesce(p_campanha, '')), 30)), p_valor, left(p_nota, 200))
  returning id into novo;
  return novo;
end $$;
revoke all on function public.admin_campaign_save(text, text, numeric, text) from public, anon;
grant execute on function public.admin_campaign_save(text, text, numeric, text) to authenticated;

create or replace function public.admin_campaign_delete(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  delete from campaign_costs where id = p_id;
  return found;
end $$;
revoke all on function public.admin_campaign_delete(bigint) from public, anon;
grant execute on function public.admin_campaign_delete(bigint) to authenticated;

-- Cada campanha (utm_source/utm_campaign da 1ª visita), desde sempre: quem
-- trouxe, quantos ativaram, criaram conta e voltaram — e o custo anotado.
create or replace function public.admin_campaigns()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not _is_admin() then return null; end if;
  return (
    with primeira as (
      select distinct on (anon) anon, (ts at time zone 'America/Sao_Paulo')::date as first_dia,
             lower(props->>'u') as fonte, lower(coalesce(props->>'c', '')) as campanha
      from events where name = 'pageview' and not bot and anon is not null
      order by anon, ts
    ),
    vindos as (select * from primeira where coalesce(fonte, '') <> ''),
    acoes as (
      select e.anon,
        bool_or(e.name = 'collection_first') as ativou,
        bool_or(e.name = 'signup' or (e.name = 'pageview' and e.uid is not null)) as conta,
        bool_or(e.name = 'pageview' and (e.ts at time zone 'America/Sao_Paulo')::date - v.first_dia between 7 and 13) as d7
      from events e join vindos v using (anon) where not e.bot group by e.anon
    ),
    por as (
      select v.fonte, v.campanha, count(*)::int as visitantes,
        count(*) filter (where a.ativou)::int as ativados,
        count(*) filter (where a.conta)::int as contas,
        count(*) filter (where hoje - v.first_dia >= 14)::int as el7,
        count(*) filter (where hoje - v.first_dia >= 14 and a.d7)::int as d7,
        min(v.first_dia) as desde
      from vindos v left join acoes a using (anon) group by v.fonte, v.campanha
    ),
    custo as (select fonte, campanha, sum(valor) as custo from campaign_costs group by fonte, campanha)
    select jsonb_build_object(
      'campanhas', (select coalesce(jsonb_agg(row_to_json(x) order by x.visitantes desc nulls last), '[]'::jsonb) from (
         select coalesce(p.fonte, c.fonte) as fonte, coalesce(p.campanha, c.campanha) as campanha,
                coalesce(p.visitantes, 0) as visitantes, coalesce(p.ativados, 0) as ativados,
                coalesce(p.contas, 0) as contas, coalesce(p.el7, 0) as el7, coalesce(p.d7, 0) as d7,
                p.desde, c.custo
         from por p full join custo c on c.fonte = p.fonte and c.campanha = p.campanha) x),
      'custos', (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
         select id, fonte, campanha, valor, nota, created_at from campaign_costs) x)
    )
  );
end $$;
revoke all on function public.admin_campaigns() from public, anon;
grant execute on function public.admin_campaigns() to authenticated;

-- ── P3 · 1) Portal da loja ──────────────────────────────────────────────────
-- Um link privado por loja (sleevu.app/parceiro?t=…) onde ela vê o tráfego
-- que o Sleevu mandou pra ela: cliques, pessoas, valor das cartas, jogos e as
-- cartas mais procuradas. Só-leitura, revogável, e com o mesmo corte de
-- privacidade do CSV: carta com menos de 3 pessoas vira "outras".
--
-- O token (64 hex, dois gen_random_uuid) É a credencial: quem tem o link vê.
-- A RPC só devolve agregados de UMA loja; token revogado ou errado = null.
create table if not exists public.partner_links (
  id          bigserial primary key,
  token       text not null unique,
  loja        text not null,
  rotulo      text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  last_seen_at timestamptz,
  views       int not null default 0
);
alter table public.partner_links enable row level security;
revoke all on public.partner_links from public, anon, authenticated;

create or replace function public.admin_partner_link_create(p_loja text, p_rotulo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare tk text;
begin
  if not _is_admin() then return null; end if;
  if p_loja is null or p_loja not in ('liga', 'ligabra', 'myp', 'ebay', 'tcgplayer', 'pricecharting', 'cardmarket') then return null; end if;
  tk := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into partner_links (token, loja, rotulo) values (tk, p_loja, left(p_rotulo, 60));
  return tk;
end $$;
revoke all on function public.admin_partner_link_create(text, text) from public, anon;
grant execute on function public.admin_partner_link_create(text, text) to authenticated;

create or replace function public.admin_partner_link_revoke(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  update partner_links set revoked_at = now() where id = p_id and revoked_at is null;
  return found;
end $$;
revoke all on function public.admin_partner_link_revoke(bigint) from public, anon;
grant execute on function public.admin_partner_link_revoke(bigint) to authenticated;

create or replace function public.admin_partner_links()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  return (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
    select id, token, loja, rotulo, created_at, revoked_at, last_seen_at, views from partner_links) x);
end $$;
revoke all on function public.admin_partner_links() from public, anon;
grant execute on function public.admin_partner_links() to authenticated;

create or replace function public.partner_report(p_token text, p_days int default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  lk   partner_links;
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  date;
  res  jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}\Z' then return null; end if;
  if not _rate_ok('partner', 30) then return null; end if;
  select * into lk from partner_links where token = p_token and revoked_at is null;
  if not found then return null; end if;
  update partner_links set views = views + 1, last_seen_at = now() where id = lk.id;
  d   := greatest(7, least(coalesce(p_days, 30), 180));
  ini := hoje - (d - 1);

  with ck as (
    select anon, (ts at time zone 'America/Sao_Paulo')::date as dia,
      coalesce(nullif(props->>'g', ''), game, '?') as g, nullif(props->>'c', '') as c,
      _int(props->>'v') as v
    from events
    where name = 'store_click' and not bot and props->>'s' = lk.loja
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  ),
  cartas as (
    select g, c, count(*)::int as cliques, count(distinct anon)::int as pessoas, coalesce(sum(v), 0)::bigint as valor
    from ck where c is not null group by g, c
  )
  select jsonb_build_object(
    'loja', lk.loja, 'rotulo', lk.rotulo, 'days', d, 'gerado', now(),
    'cliques', (select count(*) from ck),
    'pessoas', (select count(distinct anon) from ck),
    'valor',   (select coalesce(sum(v), 0) from ck),
    'daily', (select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
      select to_char(gs.dia, 'YYYY-MM-DD') as day, (select count(*) from ck where ck.dia = gs.dia)::int as cliques
      from (select g::date as dia from generate_series(ini::timestamp, hoje::timestamp, interval '1 day') g) gs) x),
    'jogos', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select g as game, count(*)::int as cliques, count(distinct anon)::int as pessoas, coalesce(sum(v), 0)::bigint as valor
      from ck group by g) x),
    'cartas', (select coalesce(jsonb_agg(row_to_json(x) order by x.cliques desc), '[]'::jsonb) from (
      select g as game, c as card_id, cliques, pessoas, valor from cartas where pessoas >= 3
      order by cliques desc limit 100) x),
    'outras', (select jsonb_build_object('cartas', count(*), 'cliques', coalesce(sum(cliques), 0))
               from cartas where pessoas < 3)
  ) into res;
  return res;
end $$;
revoke all on function public.partner_report(text, int) from public;
grant execute on function public.partner_report(text, int) to anon, authenticated;

-- ── P3 · 2) Resumo diário + limpeza dos eventos brutos ──────────────────────
-- events cresce sem limite, e guardar para sempre o uuid anônimo de cada
-- visita contradiz a política de privacidade. Daqui em diante: o evento BRUTO
-- fica 13 meses; o RESUMO por dia (quantos, quantas pessoas, por jogo e
-- página) fica pra sempre em events_daily, e a série do metrics_daily também.
--
-- A limpeza só apaga dia que JÁ tem resumo. Hoje o evento mais antigo é de
-- julho/2026 — nada é apagado antes de agosto/2027.
-- Efeito colateral conhecido: quem voltar depois de 13+ meses sem visitar
-- conta de novo como visitante novo (a 1ª visita dele já foi apagada).
create table if not exists public.events_daily (
  day      date not null,
  name     text not null,
  game     text not null default '',
  path     text not null default '',
  n        int  not null,
  pessoas  int  not null,
  usuarios int  not null,
  bots     int  not null default 0,
  primary key (day, name, game, path)
);
alter table public.events_daily enable row level security;
revoke all on public.events_daily from public, anon, authenticated;

create or replace function public.events_rollup(p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare
  ini timestamptz := p_day::timestamp at time zone 'America/Sao_Paulo';
  fim timestamptz := (p_day + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  delete from events_daily where day = p_day;
  insert into events_daily (day, name, game, path, n, pessoas, usuarios, bots)
  select p_day, name, coalesce(game, ''), case when name = 'pageview' then coalesce(path, '') else '' end,
         count(*) filter (where not bot), count(distinct anon) filter (where not bot),
         count(distinct uid) filter (where not bot), count(*) filter (where bot)
  from events where ts >= ini and ts < fim
  group by 1, 2, 3, 4;
end $$;
revoke all on function public.events_rollup(date) from public, anon, authenticated;

create or replace function public.events_purge(p_meses int default 13)
returns int language plpgsql security definer set search_path = public as $$
declare
  corte timestamptz := date_trunc('day', now() - make_interval(months => greatest(13, coalesce(p_meses, 13))));
  dia   date;
  apagados int;
begin
  -- Garante o resumo de todo dia que vai sumir.
  for dia in select distinct (ts at time zone 'America/Sao_Paulo')::date from events where ts < corte loop
    if not exists (select 1 from events_daily where day = dia) then perform events_rollup(dia); end if;
  end loop;
  delete from events where ts < corte;
  get diagnostics apagados = row_count;
  return apagados;
end $$;
revoke all on function public.events_purge(int) from public, anon, authenticated;

-- Resumo retroativo de todo dia que já existe.
do $$
declare dia date;
begin
  for dia in select distinct (ts at time zone 'America/Sao_Paulo')::date from events
             where ts < date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
  loop
    if not exists (select 1 from public.events_daily where day = dia) then perform public.events_rollup(dia); end if;
  end loop;
end $$;

-- Agenda (se o pg_cron existir): resumo de ontem todo dia e limpeza no dia 1.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('sleevu-events-rollup', 'sleevu-events-purge');
    perform cron.schedule('sleevu-events-rollup', '10 3 * * *',
      'select public.events_rollup(((now() at time zone ''America/Sao_Paulo'')::date - 1));');
    perform cron.schedule('sleevu-events-purge', '20 3 1 * *', 'select public.events_purge(13);');
  end if;
end $$;

-- ── P3 · 3) Experimentos A/B ────────────────────────────────────────────────
-- O cliente sorteia a variante e manda exp_view (e, v) uma vez por sessão.
-- Aqui: por experimento × variante, quantas pessoas viram e, DEPOIS de ver,
-- quantas ativaram, criaram conta, clicaram numa loja e voltaram na 2ª semana.
create or replace function public.admin_experiments(days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d   int;
  ini timestamptz;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 90), 365));
  ini := now() - make_interval(days => d);
  return (
    with ex as (
      select distinct on (props->>'e', anon) props->>'e' as e, props->>'v' as v, anon, ts
      from events
      where name = 'exp_view' and not bot and anon is not null and ts >= ini
        and coalesce(props->>'e', '') <> '' and coalesce(props->>'v', '') <> ''
      order by props->>'e', anon, ts
    ),
    res as (
      select ex.e, ex.v, ex.anon, ex.ts,
        exists (select 1 from events x where x.anon = ex.anon and x.name = 'collection_first' and x.ts >= ex.ts) as ativou,
        exists (select 1 from events x where x.anon = ex.anon and x.ts >= ex.ts
                  and (x.name = 'signup' or (x.name = 'pageview' and x.uid is not null))) as conta,
        exists (select 1 from events x where x.anon = ex.anon and x.name = 'store_click' and x.ts >= ex.ts) as loja,
        exists (select 1 from events x where x.anon = ex.anon and x.name = 'pageview' and not x.bot
                  and x.ts >= ex.ts + interval '7 days' and x.ts < ex.ts + interval '14 days') as d7,
        ex.ts < now() - interval '14 days' as el7
      from ex
    )
    select coalesce(jsonb_agg(row_to_json(x) order by x.e, x.v), '[]'::jsonb) from (
      select e, v, count(*)::int as pessoas, min(ts) as inicio,
        count(*) filter (where ativou)::int as ativou, count(*) filter (where conta)::int as conta,
        count(*) filter (where loja)::int as loja,
        count(*) filter (where el7)::int as el7, count(*) filter (where el7 and d7)::int as d7
      from res group by e, v) x
  );
end $$;
revoke all on function public.admin_experiments(int) from public, anon;
grant execute on function public.admin_experiments(int) to authenticated;

-- ── P4) admin_users: quem são os usuários ───────────────────────────────────
-- Só contas com coleção na nuvem (quem nunca logou não tem save aqui).
-- Identificação MÍNIMA: 8 primeiros caracteres do id (pra reconhecer a mesma
-- conta entre visitas ao painel) e o @ só quando o perfil é PÚBLICO. Nada de
-- e-mail: pra entender comportamento não precisa, e painel que mostra e-mail
-- é painel que vaza e-mail.
create or replace function public.admin_users(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d   int;
  ini timestamptz;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := now() - make_interval(days => d);
  return (
    with u as (select * from _colecao_usuarios() where copias > 0),
    atv as (
      select uid, count(*)::int as views, max(ts) as ultimo
      from events where name = 'pageview' and uid is not null and ts >= now() - interval '90 days'
      group by uid
    ),
    b as (
      select u.*, a.created_at, a.last_sign_in_at,
        coalesce(av.views, 0) as views90, av.ultimo,
        coalesce(av.ultimo >= ini, false) as ativo,
        case when p.is_public then p.handle end as handle,
        coalesce(u.valor, 0) as v,
        coalesce(cardinality(u.jogos), 0) as njogos,
        row_number() over (order by coalesce(u.valor, 0) desc) as rk,
        count(*) over () as total
      from u
      join auth.users a on a.id = u.user_id
      left join atv av on av.uid = u.user_id
      left join profiles p on p.user_id = u.user_id
    ),
    faixa_v as (
      select *, case
        when not com_historico then 0 when v < 100 then 1 when v < 500 then 2 when v < 2000 then 3
        when v < 10000 then 4 when v < 50000 then 5 else 6 end as fv,
        case when copias <= 10 then 1 when copias <= 50 then 2 when copias <= 200 then 3
             when copias <= 1000 then 4 when copias <= 5000 then 5 else 6 end as fc
      from b
    )
    select jsonb_build_object(
      'days', d,
      'resumo', (select jsonb_build_object(
          'contas', count(*),
          'com_valor', count(*) filter (where com_historico),
          'valor_total', round(sum(v)),
          'valor_mediano', round((percentile_cont(0.5) within group (order by v) filter (where com_historico))::numeric),
          'valor_medio', round((avg(v) filter (where com_historico))::numeric),
          'copias_total', sum(copias)::bigint,
          'copias_mediana', round(percentile_cont(0.5) within group (order by copias)::numeric),
          'copias_media', round(avg(copias)::numeric),
          'jogos_medio', round(avg(njogos)::numeric, 2),
          'ativos', count(*) filter (where ativo),
          'top1_valor', (select round(coalesce(sum(v), 0)) from b x where x.rk <= greatest(1, ceil(x.total * 0.01))),
          'top10_valor', (select round(coalesce(sum(v), 0)) from b x where x.rk <= greatest(1, ceil(x.total * 0.10))),
          'pct', jsonb_build_object(
             'graded', count(*) filter (where graded > 0), 'decks', count(*) filter (where decks > 0),
             'vendas', count(*) filter (where vendas > 0 or vendidas > 0), 'custos', count(*) filter (where custos > 0),
             'alvos', count(*) filter (where alvos > 0), 'listas', count(*) filter (where listas > 0),
             'manuais', count(*) filter (where itens_manuais > 0), 'desejos', count(*) filter (where desejos > 0),
             'publico', count(*) filter (where handle is not null)))
        from b),
      'faixas_valor', (select coalesce(jsonb_agg(row_to_json(x) order by x.fv), '[]'::jsonb) from (
          select fv, count(*)::int as n, round(sum(v)) as valor, count(*) filter (where ativo)::int as ativos,
                 round(avg(copias)) as copias_media
          from faixa_v group by fv) x),
      'faixas_copias', (select coalesce(jsonb_agg(row_to_json(x) order by x.fc), '[]'::jsonb) from (
          select fc, count(*)::int as n, round(sum(v)) as valor, count(*) filter (where ativo)::int as ativos
          from faixa_v group by fc) x),
      'jogos_n', (select coalesce(jsonb_agg(row_to_json(x) order by x.k), '[]'::jsonb) from (
          select least(njogos, 4) as k, count(*)::int as n, round(avg(v)) as valor_medio from b group by 1) x),
      'combos', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
          select array_to_string(jogos, '+') as combo, count(*)::int as n
          from b where njogos >= 2 group by 1 order by count(*) desc limit 10) x),
      'por_jogo', (select coalesce(jsonb_agg(row_to_json(x) order by x.usuarios desc), '[]'::jsonb) from (
          select g as game, count(*)::int as usuarios from b cross join lateral unnest(jogos) g group by g) x),
      'idade', (select coalesce(jsonb_agg(row_to_json(x) order by x.k), '[]'::jsonb) from (
          select case when now() - created_at < interval '7 days' then 1
                      when now() - created_at < interval '30 days' then 2
                      when now() - created_at < interval '90 days' then 3 else 4 end as k,
                 count(*)::int as n,
                 round(percentile_cont(0.5) within group (order by copias)::numeric) as copias_mediana,
                 round(percentile_cont(0.5) within group (order by v)::numeric) as valor_mediano,
                 count(*) filter (where ativo)::int as ativos
          from b group by 1) x),
      -- Perfis de USO (não exclusivos: a mesma conta pode ser jogador e vendedor).
      'perfis', jsonb_build_array(
          (select jsonb_build_object('k', 'jogador',   'n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where decks > 0),
          (select jsonb_build_object('k', 'vendedor',  'n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where vendas > 0 or vendidas > 0),
          (select jsonb_build_object('k', 'investidor','n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where graded > 0 or custos > 0),
          (select jsonb_build_object('k', 'cacador',   'n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where desejos >= 20 or alvos > 0),
          (select jsonb_build_object('k', 'multijogo', 'n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where njogos >= 2),
          (select jsonb_build_object('k', 'publico',   'n', count(*), 'valor', round(coalesce(sum(v), 0)), 'ativos', count(*) filter (where ativo)) from b where handle is not null)),
      -- Tamanho (exclusivo): uma faixa por conta.
      'tamanho', (select coalesce(jsonb_agg(row_to_json(x) order by x.k), '[]'::jsonb) from (
          select case when copias < 50 then 1 when copias < 500 then 2 when copias < 3000 then 3 else 4 end as k,
                 count(*)::int as n, round(sum(v)) as valor, count(*) filter (where ativo)::int as ativos,
                 round(avg(njogos)::numeric, 1) as jogos_medio
          from b group by 1) x),
      -- Baleias dormentes: coleção de 2 mil reais ou mais que não aparece há 30+ dias.
      -- É a lista de quem vale reativar (push, e-mail, novidade).
      'dormentes', (select jsonb_build_object('n', count(*), 'valor', round(coalesce(sum(v), 0)))
                    from b where v >= 2000 and (ultimo is null or ultimo < now() - interval '30 days')),
      'top', (select coalesce(jsonb_agg(row_to_json(x) order by x.valor desc, x.copias desc), '[]'::jsonb) from (
          select left(user_id::text, 8) as id, handle, jogos, copias::bigint as copias, distintas,
                 round(v) as valor, round(valor_graded) as valor_graded, round(valor_desejos) as valor_desejos,
                 desejos, decks, vendas, vendidas, graded, valor_desde,
                 created_at::date as desde, last_sign_in_at::date as ultimo_login, views90, ativo
          from b order by v desc, copias desc limit 100) x)
    )
  );
end $$;
revoke all on function public.admin_users(int) from public, anon;
grant execute on function public.admin_users(int) to authenticated;
