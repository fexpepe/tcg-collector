-- ============================================================================
-- 20261006a — limite de eventos POR VISITANTE, não por IP
--
-- POR QUE: o events_guard descarta calado tudo que passa de 60 eventos por
-- minuto por IP (_rate_ok('events', 60), desde a 20260723a). Celular no
-- Brasil sai pra internet por CGNAT: a operadora põe muita gente atrás do
-- mesmo IPv4, e numa campanha paga (22–30/09, até 490 visitantes/dia, quase
-- tudo celular vindo do Instagram) visitantes diferentes dividem o mesmo
-- balde de 60. Um visitante sozinho já manda pageview + page_time + ad_view +
-- card_added em sequência; o excedente some sem erro nenhum no cliente nem
-- no /admin (docs/PLANO-TECNICO.md, lacuna L10). É justamente o tráfego que a
-- auditoria de aquisição (2026-10-05) precisa medir pra decidir o app nativo.
--
-- O QUE MUDA: só a linha do limite no events_guard.
--   - 60/min por (IP, anon): o mesmo freio de antes pra UM navegador;
--   - 600/min por IP: o teto do IP inteiro, contra quem gira o anon.
-- O resto do guard é cópia fiel da 20260928a (whitelist, tetos de tamanho,
-- uid, marcação de robô). O _rate_ok não muda: o balde é escopo + md5(IP).
-- A tabela rate_limits ganha um balde por visitante ativo por minuto; a
-- limpeza oportunista do _rate_ok (linhas com mais de 15 min) segue valendo.
--
-- ADITIVA e sem ordem com o JS. Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar (a definição no ar tem as duas linhas novas):
--   select pg_get_functiondef('public.events_guard()'::regprocedure)
--          ~ 'events:' as por_visitante;                 -- true
-- ============================================================================

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
  -- 60/min POR VISITANTE (anon) dentro do mesmo IP, e um teto de 600/min
  -- pro IP inteiro (o freio contra quem gira o anon pra fugir do limite).
  if not _rate_ok('events:' || left(coalesce(new.anon, ''), 64), 60) then return null; end if;
  if not _rate_ok('events', 600) then return null; end if;

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
