-- ============================================================================
-- Funil de ativação (item 7 do plano de MAU)
--
-- POR QUE: o analytics de hoje mede visita por página, visualização por carta
-- e cinco AÇÕES CONCLUÍDAS (export/import/deck/backup/share). Nenhum deles
-- responde o caminho — "abriu o scanner → leu o código → achou a carta →
-- adicionou" — nem "quanto tempo leva pra cadastrar N cartas", nem "dos que
-- chegaram, quantos chegaram a usar". Enquanto isso faltar, ligar campanha de
-- instalação traz tráfego que ninguém sabe ler, e a coorte que passou não
-- volta pra ser medida depois.
--
-- ADITIVA e SEGURA de aplicar a qualquer momento: amplia a whitelist do
-- `events_guard` e CRIA uma RPC nova. Não mexe na `admin_dashboard` (que
-- continua valendo inteira) nem em dado existente.
--
-- ORDEM IMPORTA: aplicar este SQL ANTES de subir o JS. Nome fora da whitelist
-- faz o `events_guard` devolver null e o INSERT some sem erro nenhum — o
-- painel mostraria zero e pareceria que ninguém usa o scanner. (É a mesma
-- armadilha que a 20260830a já documenta.)
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Os cinco nomes novos — e por que são AGREGADOS:
--
--   scan_open        abriu o scanner. Denominador do funil.
--   scan_done        resumo da sessão de scanner, em props:
--                      n     tentativas de leitura
--                      lido  quantas extraíram um código
--                      achou quantas casaram com o catálogo
--                      add   cartas que foram pra coleção
--                      ms    duração da sessão
--   card_added       resumo de uma RAJADA de cadastro, em props:
--                      via   ui | scan | csv | lista
--                      n     cartas novas na rajada
--                      ms    duração  → n/ms é o "100 cartas em quanto tempo"
--   collection_first a primeira carta da vida daquele navegador (ativação)
--   login_gate       bateu no portão de login (props.p = página)
--
-- O `events_guard` aceita 60 eventos por MINUTO por IP e descarta o resto
-- SILENCIOSAMENTE. Um evento por carta estouraria isso com 15 cartas/min e
-- apagaria a medição de quem abre um booster inteiro — justamente quem o funil
-- existe pra enxergar. Daí o resumo: 2 eventos por sessão de scanner, não 4
-- por carta. Nenhum limite novo é preciso.
--
-- Conferir depois de aplicar (deve devolver os 12 nomes):
--   select p.prosrc from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'events_guard';
-- ============================================================================

-- ── 1) events_guard: só a whitelist muda ────────────────────────────────────
-- Cópia fiel da versão da 20260914a (caps, rate limit, uid e bot idênticos):
-- só a lista de nomes cresce. `create or replace` preserva o trigger e a ACL.
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h  json;
  ua text;
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created',
    'scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate'
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
    or ua ~* 'bot(/|;|\)|\s|$)'
    or ua ~* '(crawl|spider|slurp|headless|phantomjs|lighthouse|pagespeed|scrapy|python-requests|python/|aiohttp|httpx|curl/|wget/|go-http-client|java/|okhttp|libwww|facebookexternalhit|bytespider|perplexity|anthropic|openai|semrush|ahrefs|mj12|petalbot|uptimerobot|betteruptime|statuscake|pingdom|site24x7)'
    or coalesce(new.props->>'wd', '') = '1'
  );
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

-- ── 2) admin_funnel(days): RPC NOVA, ao lado da admin_dashboard ─────────────
-- RPC separada em vez de `create or replace` na admin_dashboard: aquela é uma
-- função de ~200 linhas e reescrevê-la inteira só pra somar uns campos é risco
-- sem retorno — um erro de transcrição derrubaria o painel todo. Mesmo gate de
-- is_admin, mesmo grão agregado: nada aqui identifica pessoa ou coleção.
--
-- `_num` existe porque props é JSON vindo do cliente: valor que não for número
-- inteiro tem de virar 0, não derrubar a query com erro de cast.
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
      select name, anon, uid, props from events
      where ts >= ini and not bot
        and name in ('scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate')
    ),
    -- Cast defensivo: props vem do cliente.
    num as (
      select name, anon, props,
        case when props->>'n'     ~ '^[0-9]{1,7}$' then (props->>'n')::int     else 0 end as n,
        case when props->>'lido'  ~ '^[0-9]{1,7}$' then (props->>'lido')::int  else 0 end as lido,
        case when props->>'achou' ~ '^[0-9]{1,7}$' then (props->>'achou')::int else 0 end as achou,
        case when props->>'add'   ~ '^[0-9]{1,7}$' then (props->>'add')::int   else 0 end as adicionou,
        case when props->>'ms'    ~ '^[0-9]{1,10}$' then (props->>'ms')::bigint else 0 end as ms
      from ev
    )
    select jsonb_build_object(
      'days', d,
      -- FUNIL DO SCANNER, em números absolutos: cada passo é subconjunto do
      -- anterior, então a queda entre dois é onde o produto perde a pessoa.
      'scan', jsonb_build_object(
        'aberturas', (select count(*)::int from ev where name = 'scan_open'),
        'pessoas',   (select count(distinct anon)::int from ev where name = 'scan_open'),
        'sessoes',   (select count(*)::int from num where name = 'scan_done'),
        'tentativas',(select coalesce(sum(n), 0)::int     from num where name = 'scan_done'),
        'leu',       (select coalesce(sum(lido), 0)::int  from num where name = 'scan_done'),
        'achou',     (select coalesce(sum(achou), 0)::int from num where name = 'scan_done'),
        'adicionou', (select coalesce(sum(adicionou), 0)::int from num where name = 'scan_done'),
        -- Sessões que não puseram nenhuma carta na coleção: abrir e desistir é
        -- o sinal mais barato de que o scanner não está entregando.
        'secas',     (select count(*)::int from num where name = 'scan_done' and adicionou = 0)
      ),
      -- CADASTRO por caminho, com o RITMO. `cartas_min` é a mediana de
      -- cartas/minuto entre as rajadas de 5+ cartas (rajada curta é ruído: o
      -- tempo é dominado por achar a carta, não por cadastrar).
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
      -- ATIVAÇÃO e ATRITO.
      'ativados',  (select count(distinct anon)::int from ev where name = 'collection_first'),
      'gate',      (select count(*)::int from ev where name = 'login_gate'),
      'gate_pessoas', (select count(distinct anon)::int from ev where name = 'login_gate'),
      'gate_paginas', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
        select coalesce(props->>'p', '?') as pagina, count(*)::int as n
        from ev where name = 'login_gate' group by 1 limit 12) x)
    )
  );
end $$;

revoke all on function public.admin_funnel(int) from public, anon;
grant execute on function public.admin_funnel(int) to authenticated;
