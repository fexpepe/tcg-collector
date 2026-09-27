-- ============================================================================
-- Vitrine (2026-09-27) — o espaço de anúncio das páginas de catálogo
--
-- POR QUE: a fase 0 do docs/PLANO-ADS.md põe um espaço rotulado entre as
-- cartas (src/ads.js) antes de existir anúncio de terceiro. O espaço só vale
-- alguma coisa se der pra MEDIR: quantas vezes foi servido, quantas foi visto
-- de verdade e quantas foi clicado — por criativo, por posição, por página e
-- por jogo. É esse número que diz quanto estoque a fase 1 (AdSense) tem pra
-- vender e que se leva pra uma loja na venda direta (fase 3).
--
-- ADITIVA e SEGURA de aplicar a qualquer momento. O que faz:
--
--   1) events_guard: whitelist ganha 'ad_view' e 'ad_click'. Cópia fiel da
--      20260923a — só a lista cresce.
--   2) admin_vitrine(days): RPC do /admin (aba Mercado › Vitrine), com o
--      mesmo gate is_admin e o mesmo grão agregado das outras.
--
-- ORDEM IMPORTA: aplicar este SQL ANTES de subir o JS. Nome fora da whitelist
-- faz o `events_guard` devolver null e o INSERT some sem erro nenhum (mesma
-- armadilha documentada na 20260830a, 20260919a e 20260923a).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Os dois nomes novos:
--
--   ad_view    UM evento por página (não um por espaço): o resumo sai quando a
--              aba some (pagehide/visibilitychange). Um por espaço estouraria
--              os 60 eventos/min do _rate_ok justamente em quem navega rápido.
--              props:
--                sv  espaços SERVIDOS: ["f1:apoie", "t:conta"] — posição:criativo
--                v   espaços VISTOS (metade na tela por 1 s), mesmo formato
--                d   m/d (toque/ponteiro)
--              Posições: f1, f2, f3 (faixas no feed, de cima pra baixo) e t
--              (trilho lateral, só em tela ≥1888 px).
--   ad_click   clique num link/botão de dentro do espaço.
--                s   posição · c  criativo · d  m/d
--
-- Conferir depois de aplicar:
--   select p.prosrc like '%ad_view%' from pg_proc p
--    where p.proname = 'events_guard';                         -- true
--   select public.admin_vitrine(30);                            -- null fora do admin
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
    'store_click', 'signup', 'search_empty', 'share_open', 'pwa_install',
    'ad_view', 'ad_click'
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

-- ── 2) admin_vitrine: servidas, vistas e cliques ────────────────────────────
-- Os arrays vêm do cliente, então nada aqui confia no formato: prop que não é
-- array vira vazio, item fora do padrão "posição:criativo" é descartado, e os
-- rótulos são cortados — um POST forjado não quebra o painel nem o polui com
-- texto comprido.
create or replace function public.admin_vitrine(days int default 30)
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

  with vw as (
    select anon, (ts at time zone 'America/Sao_Paulo')::date as dia,
      coalesce(nullif(path, ''), '?') as path, coalesce(nullif(game, ''), '?') as g,
      case when jsonb_typeof(props->'sv') = 'array' then props->'sv' else '[]'::jsonb end as sv,
      case when jsonb_typeof(props->'v')  = 'array' then props->'v'  else '[]'::jsonb end as v
    from events
    where name = 'ad_view' and not bot
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  ),
  -- Uma linha por espaço servido/visto. O regex descarta item malformado ou
  -- comprido demais (posição ≤ 8, criativo ≤ 24 — o mesmo ID_OK do ads.js).
  servidas as (
    select vw.dia, vw.path, vw.g, left(split_part(x, ':', 1), 8) as s, left(split_part(x, ':', 2), 24) as c
    from vw, jsonb_array_elements_text(vw.sv) x where x ~ '^[a-z0-9]{1,8}:[a-z0-9-]{1,24}$'
  ),
  vistas as (
    select vw.dia, vw.path, vw.g, left(split_part(x, ':', 1), 8) as s, left(split_part(x, ':', 2), 24) as c
    from vw, jsonb_array_elements_text(vw.v) x where x ~ '^[a-z0-9]{1,8}:[a-z0-9-]{1,24}$'
  ),
  ck as (
    select anon, (ts at time zone 'America/Sao_Paulo')::date as dia,
      coalesce(nullif(path, ''), '?') as path, coalesce(nullif(game, ''), '?') as g,
      left(coalesce(nullif(props->>'s', ''), '?'), 8) as s,
      left(coalesce(nullif(props->>'c', ''), '?'), 24) as c
    from events
    where name = 'ad_click' and not bot
      and ts >= ini::timestamp at time zone 'America/Sao_Paulo'
  )
  select jsonb_build_object(
    'days', d,
    'paginas',  (select count(*) from vw),
    'pessoas',  (select count(distinct anon) from vw),
    'servidas', (select count(*) from servidas),
    'vistas',   (select count(*) from vistas),
    'cliques',  (select count(*) from ck),
    'criativos', (select coalesce(jsonb_agg(row_to_json(x) order by x.vistas desc, x.servidas desc), '[]'::jsonb) from (
      select k.c,
        (select count(*) from servidas where servidas.c = k.c)::int as servidas,
        (select count(*) from vistas where vistas.c = k.c)::int as vistas,
        (select count(*) from ck where ck.c = k.c)::int as cliques
      from (select c from servidas union select c from ck) k) x),
    'espacos', (select coalesce(jsonb_agg(row_to_json(x) order by x.s), '[]'::jsonb) from (
      select k.s,
        (select count(*) from servidas where servidas.s = k.s)::int as servidas,
        (select count(*) from vistas where vistas.s = k.s)::int as vistas,
        (select count(*) from ck where ck.s = k.s)::int as cliques
      from (select s from servidas union select s from ck) k) x),
    'paginas_top', (select coalesce(jsonb_agg(row_to_json(x) order by x.servidas desc), '[]'::jsonb) from (
      select k.path,
        (select count(*) from servidas where servidas.path = k.path)::int as servidas,
        (select count(*) from vistas where vistas.path = k.path)::int as vistas,
        (select count(*) from ck where ck.path = k.path)::int as cliques
      from (select path from servidas union select path from ck) k) x),
    'jogos', (select coalesce(jsonb_agg(row_to_json(x) order by x.servidas desc), '[]'::jsonb) from (
      select k.g,
        (select count(*) from servidas where servidas.g = k.g)::int as servidas,
        (select count(*) from vistas where vistas.g = k.g)::int as vistas,
        (select count(*) from ck where ck.g = k.g)::int as cliques
      from (select g from servidas union select g from ck) k) x),
    'daily', (select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
      select to_char(gs.dia, 'YYYY-MM-DD') as day,
        (select count(*) from vistas where vistas.dia = gs.dia)::int as vistas,
        (select count(*) from ck where ck.dia = gs.dia)::int as cliques
      from (select g::date as dia from generate_series(ini::timestamp, hoje::timestamp, interval '1 day') g) gs) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_vitrine(int) from public, anon;
grant execute on function public.admin_vitrine(int) to authenticated;
