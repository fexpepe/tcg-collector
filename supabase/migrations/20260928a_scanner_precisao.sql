-- ============================================================================
-- Precisão do scanner (2026-09-28) — admin_funnel com a taxa de erro
--
-- POR QUE: o funil do scanner dizia se a leitura ACHOU uma carta, não se era
-- a CERTA. O código impresso não identifica uma carta só em boa parte do
-- catálogo (mesmo set + número em 30 % do One Piece, 54 % do Digimon), e o
-- scanner passou a desempatar pela foto (src/scan.js, conferirPelaFoto). Pra
-- saber se isso funciona — e quanto o scanner erra —, o `scan_done` ganhou
-- quatro contadores em props, e esta migração os soma no /admin:
--
--   amb    leituras com mais de uma carta pro mesmo código
--   vis    dessas, em quantas a foto mudou qual vem primeiro
--   troca  leituras em que a pessoa trocou o 1º resultado por outra opção
--          (conta uma vez por leitura): o scanner errou a carta
--   dig    buscas digitadas na folha de correção: o scanner não serviu
--
-- ADITIVA e SEGURA de aplicar a qualquer momento, antes ou depois do JS: o
-- `scan_done` já está na whitelist do events_guard (props novas passam, o teto
-- é o tamanho de 4 KB), e o /admin mostra "aplique a 20260928a" enquanto a
-- RPC antiga não devolve as chaves novas. O que faz: recria a admin_funnel da
-- 20260923a com TODAS as chaves de antes, mais 'ambiguas', 'pela_foto',
-- 'trocou' e 'digitou' em `scan`, e 'ambiguas'/'trocou' em cada linha de
-- `scan_jogos`. Mesmo gate is_admin, mesmo revoke/grant.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
-- (pelo botão "Copy raw file" do GitHub — ver o tropeço da 20260927a no
-- README desta pasta).
--
-- Conferir depois de aplicar:
--   select p.prosrc like '%pela_foto%' from pg_proc p
--    where p.proname = 'admin_funnel';                          -- true
-- E, logado como admin, abrir /admin › Funil: a seção "Precisão do scanner"
-- troca o aviso pelos números.
-- ============================================================================

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
        case when props->>'t1'    ~ '^[0-9]{1,10}\Z' then (props->>'t1')::bigint else 0 end as t1,
        -- precisão (20260928a): leituras com mais de uma carta, as que a foto
        -- reordenou, as que a pessoa trocou o 1º e as buscas digitadas
        case when props->>'amb'   ~ '^[0-9]{1,7}\Z' then (props->>'amb')::int   else 0 end as amb,
        case when props->>'vis'   ~ '^[0-9]{1,7}\Z' then (props->>'vis')::int   else 0 end as vis,
        case when props->>'troca' ~ '^[0-9]{1,7}\Z' then (props->>'troca')::int else 0 end as troca,
        case when props->>'dig'   ~ '^[0-9]{1,7}\Z' then (props->>'dig')::int   else 0 end as dig
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
        'secas',     (select count(*)::int from num where name = 'scan_done' and adicionou = 0),
        -- novos (20260928a): a precisão
        'ambiguas',  (select coalesce(sum(amb), 0)::int   from num where name = 'scan_done'),
        'pela_foto', (select coalesce(sum(vis), 0)::int   from num where name = 'scan_done'),
        'trocou',    (select coalesce(sum(troca), 0)::int from num where name = 'scan_done'),
        'digitou',   (select coalesce(sum(dig), 0)::int   from num where name = 'scan_done')
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
               count(*) filter (where adicionou = 0)::int as secas,
               coalesce(sum(amb), 0)::int as ambiguas, coalesce(sum(troca), 0)::int as trocou
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
