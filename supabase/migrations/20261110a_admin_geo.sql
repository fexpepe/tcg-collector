-- ============================================================================
-- 20261110a — /admin: DE ONDE vêm os visitantes (país) e o mapa-múndi.
--
-- POR QUE: o painel sabia de onde a visita veio na internet (canal, origem,
-- campanha) e nada de onde ela veio no MUNDO. País só existia no Cloudflare
-- Web Analytics, que não cruza com nada daqui (ativação, conta, área do
-- site) e some junto com quem desliga a medição. O pedido de 2026-11-10 é um
-- mapa no Resumo e na Audiência; o mapa precisa do dado, e o dado não era
-- gravado.
--
-- O QUE MUDA NO events_guard: cópia fiel da 20261009a (lista de nomes, tetos,
-- limite por visitante e por IP, uid, robô, contador de descartes) + o
-- carimbo do PAÍS no pageview:
--   - vem do cabeçalho `cf-ipcountry`, que a borda do Cloudflare põe em toda
--     requisição que chega ao Supabase (o mesmo caminho do `cf-connecting-ip`
--     que o _client_ip já lê). São só as 2 letras do país (BR, PT, US…),
--     gravadas em props.co. O endereço IP continua NÃO sendo guardado;
--   - nunca vem do cliente: um `co` mandado no corpo é jogado fora. O valor
--     sempre quer dizer "carimbado pela borda";
--   - XX (desconhecido) e T1 (Tor) não são país: ficam sem carimbo;
--   - o APP das lojas (pl = android | ios) fica SEM país, de propósito. A
--     declaração de dados do Play e da App Store diz "sem localização"
--     (docs/PLANO-ANALYTICS-3.md, 4.6), e país tirado do IP conta como
--     localização aproximada nas duas. Pra medir país no app: tirar a
--     condição do `pl` aqui E mudar a declaração nas lojas, nessa ordem.
-- Só o pageview leva: é ele que conta visitante, e os outros eventos se
-- ligam a ele pelo `anon`.
--
-- SEM HISTÓRICO: o país começa a ser gravado quando esta migração é aplicada.
-- O mapa nasce vazio e enche a partir daí; a admin_geo devolve a COBERTURA
-- (quantas páginas do período têm país) e desde quando, pro painel não
-- mostrar variação contra um período que não tinha o dado.
--
-- SE O MAPA FICAR VAZIO depois de um dia: o cabeçalho não está chegando ao
-- PostgREST (não deu pra conferir daqui, o banco de produção não é lido
-- pelas sessões). A consulta de conferir, no fim, diz se chegou. O plano B é
-- o cliente mandar o país que a borda do site já põe no <html data-pais> das
-- páginas de catálogo, e o guard aceitar — não foi feito agora porque custa
-- bytes no shared.js (que vive no teto) e cobre só o catálogo.
--
-- ADITIVA e sem ordem com o JS: sem ela, o Resumo e a Audiência mostram o
-- aviso "aplique a 20261110a" no lugar do mapa e o resto do painel segue
-- igual. Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select pg_get_functiondef('public.events_guard()'::regprocedure) ~ 'cf-ipcountry' as carimba_pais;  -- true
--   select proname, proconfig from pg_proc where proname = 'admin_geo';   -- 1 linha, statement_timeout=30s
-- E uns minutos depois (precisa de uma visita de verdade no site):
--   select props->>'co' as pais, count(*) from events
--    where name = 'pageview' and ts > now() - interval '1 hour' group by 1 order by 2 desc;
--   -- linhas com sigla = chegou; só a linha nula = o cabeçalho não chega (ver acima)
-- ============================================================================

-- ── 1) O guard: cópia fiel da 20261009a + o país do pageview ────────────────
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h  json;
  ua text;
  co text;
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created',
    'scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate',
    'store_click', 'signup', 'search_empty', 'share_open', 'pwa_install',
    'ad_view', 'ad_click',
    'page_time', 'search_hit', 'onboard_state', 'exp_view', 'push_sent'
  ) then
    perform _descarta('lista', new.name);
    return null;
  end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then
    perform _descarta('tamanho', new.name);
    return null;
  end if;
  if pg_column_size(new.props) > 4096 then
    perform _descarta('tamanho', new.name);
    return null;
  end if;
  -- 60/min POR VISITANTE (anon) dentro do mesmo IP, e um teto de 600/min
  -- pro IP inteiro (o freio contra quem gira o anon pra fugir do limite).
  if not _rate_ok('events:' || left(coalesce(new.anon, ''), 64), 60) then
    perform _descarta('ritmo', new.name);
    return null;
  end if;
  if not _rate_ok('events', 600) then
    perform _descarta('ritmo_ip', new.name);
    return null;
  end if;

  new.uid := auth.uid();

  h  := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ua := coalesce(h->>'user-agent', '');
  new.bot := (
    ua = ''
    or ua ~* 'bot(/|;|\)|\s|\Z)'
    or ua ~* '(crawl|spider|slurp|headless|phantomjs|lighthouse|pagespeed|scrapy|python-requests|python/|aiohttp|httpx|curl/|wget/|go-http-client|java/|okhttp|libwww|facebookexternalhit|bytespider|perplexity|anthropic|openai|semrush|ahrefs|mj12|petalbot|uptimerobot|betteruptime|statuscake|pingdom|site24x7)'
    or coalesce(new.props->>'wd', '') = '1'
  );

  -- País do pageview (ver o cabeçalho): as 2 letras do cf-ipcountry, nunca o
  -- que o cliente mandar, e nada no app das lojas.
  -- Só mexe em props nulo ou OBJETO: tirar chave de um jsonb que é número ou
  -- lista dá erro, e o guard nunca pode recusar um insert que antes entrava.
  if new.name = 'pageview' and (new.props is null or jsonb_typeof(new.props) = 'object') then
    co := upper(coalesce(h->>'cf-ipcountry', ''));
    if co ~ '^[A-Z][A-Z]\Z' and co not in ('XX', 'T1')
       and coalesce(new.props->>'pl', '') not in ('android', 'ios') then
      new.props := (coalesce(new.props, '{}'::jsonb) - 'co') || jsonb_build_object('co', co);
    elsif new.props ? 'co' then
      new.props := new.props - 'co';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

-- ── 2) Visitantes por país (Resumo e Audiência) ─────────────────────────────
-- Mesma janela da admin_pulso: atual = os `days` dias até agora; anterior =
-- os `days` dias antes, cortados na mesma hora do dia. Cada visitante cai em
-- UM país por período (o mais frequente nas páginas dele: quem viajou não
-- conta dobrado), e as páginas, a conta logada e a ativação dele vão juntas.
-- Só lê a janela (2 × days), nunca o histórico inteiro — é a consulta leve
-- do Resumo. `statement_timeout` no próprio create: RPC nova do painel nasce
-- com os 8 s do papel (20261031a).
create or replace function public.admin_geo(days int default 30)
returns jsonb language plpgsql stable security definer
set search_path = public set statement_timeout = '30s' as $$
declare
  d       int;
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  ini     timestamptz;
  ant     timestamptz;
  ant_fim timestamptz;
  res     jsonb;
begin
  if not _is_admin() then return null; end if;
  d       := greatest(1, least(coalesce(days, 30), 365));
  ini     := (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant     := (hoje - (2 * d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant_fim := now() - make_interval(days => d);

  with pv as (
    select ts, anon, uid, nullif(props->>'co', '') as co, props->>'d' as dev,
           (ts at time zone 'America/Sao_Paulo')::date as dia,
           case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
    from events
    where not bot and name = 'pageview' and ts >= ant and anon is not null
      -- o app das lojas não leva país (ver o guard): fora da conta e da cobertura
      and coalesce(props->>'pl', '') not in ('android', 'ios')
  ),
  quem as (
    select anon, jan, mode() within group (order by co) as co
    from pv where co is not null and jan is not null
    group by anon, jan
  ),
  atv as (
    select distinct anon from events
    where not bot and name = 'collection_first' and ts >= ini and anon is not null
  ),
  por_a as (
    select q.co,
      count(distinct q.anon)::int as visitantes,
      count(*)::int as pageviews,
      count(*) filter (where p.dev = 'm')::int as celular,
      count(distinct p.uid)::int as logados,
      count(distinct q.anon) filter (where q.anon in (select anon from atv))::int as ativacoes
    from quem q join pv p on p.anon = q.anon and p.jan = 'a'
    where q.jan = 'a'
    group by q.co
  ),
  por_b as (select co, count(*)::int as visitantes from quem where jan = 'b' group by co),
  topo as (select co from por_a order by visitantes desc, co limit 5),
  serie as (
    select dia, case when co in (select co from topo) then co else '(outros)' end as co,
           count(distinct anon)::int as visitantes
    from pv where jan = 'a' and co is not null
    group by 1, 2
  ),
  cob as (
    select count(*) filter (where jan = 'a')::int as pageviews,
           count(*) filter (where jan = 'a' and co is not null)::int as com_pais,
           count(distinct anon) filter (where jan = 'a')::int as visitantes,
           min(ts) filter (where co is not null) as desde
    from pv
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'migration', '20261110a',
    'cobertura', (select jsonb_build_object(
        'pageviews', c.pageviews, 'com_pais', c.com_pais,
        'visitantes', c.visitantes, 'visitantes_com_pais', (select count(*) from quem where jan = 'a'),
        'desde', to_char(c.desde at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
        -- O período anterior só compara se o país já era gravado desde o
        -- começo dele (o 1º carimbo da janela cai no 1º dia e meio).
        'comparavel', coalesce(c.desde < ant + interval '36 hours', false)
      ) from cob c),
    'paises', (select coalesce(jsonb_agg(jsonb_build_object(
        'co', x.co, 'visitantes', x.visitantes, 'visitantes_ant', x.visitantes_ant, 'pageviews', x.pageviews,
        'celular', x.celular, 'logados', x.logados, 'ativacoes', x.ativacoes
      ) order by x.visitantes desc, x.visitantes_ant desc, x.co), '[]'::jsonb)
      from (
        select coalesce(a.co, b.co) as co, coalesce(a.visitantes, 0) as visitantes, coalesce(b.visitantes, 0) as visitantes_ant,
               coalesce(a.pageviews, 0) as pageviews, coalesce(a.celular, 0) as celular,
               coalesce(a.logados, 0) as logados, coalesce(a.ativacoes, 0) as ativacoes
        from por_a a full join por_b b on b.co = a.co
      ) x),
    'topo', (select coalesce(jsonb_agg(t.co), '[]'::jsonb) from (select co from por_a order by visitantes desc, co limit 5) t),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'co', s.co, 'visitantes', s.visitantes)
        order by s.dia, s.co), '[]'::jsonb) from serie s)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_geo(int) from public, anon;
grant execute on function public.admin_geo(int) to authenticated;
