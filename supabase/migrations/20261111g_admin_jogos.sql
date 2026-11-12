-- ============================================================================
-- 20261111g — /admin: o CONTEÚDO por jogo (grupo Conteúdo › Jogos, o Resumo e
-- o kit Para parceiros).
--
-- POR QUE: em 2026-11-11 o Fernando procurou no painel "quais jogos estão
-- sendo mais acessados, mais interações, mais adições nas coleções" e não
-- achou. O que existia estava espalhado (mosaico de páginas por jogo no fim
-- do Resumo; Mercado › Conteúdo com o ESTOQUE das coleções salvas) e duas
-- perguntas não tinham resposta nenhuma:
--   - quantas cartas ENTRARAM nas coleções no período, por jogo — a Conteúdo
--     mostra o que está guardado desde sempre, e só de quem tem conta;
--   - quanta gente FEZ alguma coisa em cada jogo (cadastrou, abriu o
--     scanner, clicou em loja, montou deck…), e não só olhou.
-- O dado já chegava: todo evento sai com o jogo da página aberta (coluna
-- `game`, o currentGame() do shared.js) e o `card_added` existe desde a
-- 20260919a. Faltava ler por jogo — então vale RETROATIVO, sem mexer no site.
--
-- O jogo de cada evento é o da PÁGINA em que a pessoa estava, não o da
-- carta: o cadastro feito no scanner, no catálogo ou na página do set cai no
-- jogo certo; o feito numa página sem jogo cai em `hub`. O clique em loja é a
-- exceção — ele leva o jogo da carta em props.g, como na admin_demand.
--
-- RPC nova `admin_jogos(days)`, na janela da admin_pulso: atual = os `days`
-- dias até agora; anterior = os `days` dias antes, cortados na mesma hora do
-- dia. Por jogo, nos dois períodos: visitantes, páginas, logados, cartas
-- cadastradas, quem cadastrou, ativações, quem INTERAGIU (fez alguma ação de
-- produto, entre os visitantes do jogo), scanner, cliques em loja, decks,
-- importações, links e o tempo mediano por visitante; e as cartas abertas
-- (card_views_daily, por dia inteiro — é contador diário). Mais: por onde as
-- cartas entraram (manual, scanner, planilha, lista) e as séries por dia dos
-- 6 jogos com mais visitantes e dos 6 com mais cartas cadastradas.
--
-- Só lê a janela (2 × days), nunca o histórico inteiro, e nasce com
-- `statement_timeout = 30s` (a 20261031a não alcança função criada depois).
--
-- ADITIVA e sem ordem com o JS: sem ela, a aba Jogos mostra o aviso "aplique
-- a 20261111g", o Resumo cai no recorte por jogo antigo (só páginas) e o kit
-- sai sem a coluna de cartas cadastradas. Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select proname, proconfig from pg_proc where proname = 'admin_jogos';  -- 1 linha, statement_timeout=30s
-- ============================================================================

create or replace function public.admin_jogos(days int default 30)
returns jsonb language plpgsql stable security definer
set search_path = public set statement_timeout = '30s' as $$
declare
  d       int;
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  ini     timestamptz;
  ant     timestamptz;
  ant_fim timestamptz;
  ini_d   date;
  res     jsonb;
begin
  if not _is_admin() then return null; end if;
  d       := greatest(1, least(coalesce(days, 30), 365));
  ini     := (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant     := (hoje - (2 * d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant_fim := now() - make_interval(days => d);
  ini_d   := hoje - (d - 1);

  with ev as (
    select ts, name, anon, uid, coalesce(props, '{}'::jsonb) as props,
           -- O clique em loja diz o jogo da carta; o resto, o da página.
           case when name = 'store_click' and coalesce(props->>'g', '') <> '' then left(props->>'g', 32)
                else coalesce(nullif(game, ''), 'hub') end as jogo,
           (ts at time zone 'America/Sao_Paulo')::date as dia,
           case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
    from events
    where not bot and ts >= ant
      and name in ('pageview', 'page_time', 'card_added', 'collection_first', 'scan_open', 'store_click',
                   'deck_created', 'import_done', 'export_done', 'share_created')
  ),
  -- Quem olhou e quem fez: visitante = teve página do jogo; interagiu = um
  -- desses visitantes fez uma ação de produto no mesmo jogo (a taxa nunca
  -- passa de 100%: ação sem página do jogo não entra no numerador).
  vis as (select distinct jogo, jan, anon from ev where name = 'pageview' and anon is not null and jan is not null),
  fez as (
    select distinct jogo, jan, anon from ev
    where anon is not null and jan is not null
      and name in ('card_added', 'collection_first', 'scan_open', 'store_click', 'deck_created',
                   'import_done', 'export_done', 'share_created')
  ),
  interagiu as (
    select v.jogo, v.jan, count(*)::int as n
    from vis v join fez f on f.jogo = v.jogo and f.jan = v.jan and f.anon = v.anon
    group by 1, 2
  ),
  por as (
    select jogo, jan,
      count(distinct anon) filter (where name = 'pageview')::int as visitantes,
      count(*) filter (where name = 'pageview')::int as pageviews,
      count(distinct uid) filter (where name = 'pageview')::int as logados,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas,
      count(distinct anon) filter (where name = 'card_added')::int as cadastraram,
      count(distinct anon) filter (where name = 'collection_first')::int as ativacoes,
      count(*) filter (where name = 'scan_open')::int as scans,
      count(*) filter (where name = 'store_click')::int as cliques_loja,
      count(*) filter (where name = 'deck_created')::int as decks,
      count(*) filter (where name = 'import_done')::int as importacoes,
      count(*) filter (where name = 'share_created')::int as links
    from ev where jan is not null
    group by jogo, jan
  ),
  -- Tempo de cada visitante nas páginas do jogo (soma do período), e a
  -- mediana entre os visitantes. Página aberta e esquecida tem teto de 30 min.
  tempo as (
    select jogo, jan, round(percentile_cont(0.5) within group (order by ms))::bigint as tempo_ms
    from (
      select jogo, jan, anon, sum(least(_int(props->>'ms'), 1800000)) as ms
      from ev where name = 'page_time' and anon is not null and jan is not null
      group by 1, 2, 3
    ) t
    group by 1, 2
  ),
  -- Cartas abertas: contador por DIA (card_views_daily), então os dois
  -- períodos são dias inteiros — como na aba Demanda.
  abertas as (
    select game as jogo,
      coalesce(sum(views) filter (where day >= ini_d), 0)::int as a,
      coalesce(sum(views) filter (where day < ini_d), 0)::int as b
    from card_views_daily where day >= ini_d - d
    group by game
  ),
  jogos as (
    select jogo from por union select jogo from abertas
  ),
  linhas as (
    select j.jogo as game,
      coalesce(a.visitantes, 0) as visitantes, coalesce(b.visitantes, 0) as visitantes_ant,
      coalesce(a.pageviews, 0) as pageviews, coalesce(b.pageviews, 0) as pageviews_ant,
      coalesce(a.logados, 0) as logados,
      coalesce(a.cartas, 0) as cartas, coalesce(b.cartas, 0) as cartas_ant,
      coalesce(a.cadastraram, 0) as cadastraram, coalesce(b.cadastraram, 0) as cadastraram_ant,
      coalesce(a.ativacoes, 0) as ativacoes,
      coalesce(ia.n, 0) as interagiram, coalesce(ib.n, 0) as interagiram_ant,
      coalesce(a.scans, 0) as scans, coalesce(a.cliques_loja, 0) as cliques_loja, coalesce(b.cliques_loja, 0) as cliques_loja_ant,
      coalesce(a.decks, 0) as decks, coalesce(a.importacoes, 0) as importacoes, coalesce(a.links, 0) as links,
      ta.tempo_ms, tb.tempo_ms as tempo_ms_ant,
      coalesce(ab.a, 0) as abertas, coalesce(ab.b, 0) as abertas_ant
    from jogos j
    left join por a on a.jogo = j.jogo and a.jan = 'a'
    left join por b on b.jogo = j.jogo and b.jan = 'b'
    left join interagiu ia on ia.jogo = j.jogo and ia.jan = 'a'
    left join interagiu ib on ib.jogo = j.jogo and ib.jan = 'b'
    left join tempo ta on ta.jogo = j.jogo and ta.jan = 'a'
    left join tempo tb on tb.jogo = j.jogo and tb.jan = 'b'
    left join abertas ab on ab.jogo = j.jogo
  ),
  -- Totais SEM somar os jogos: quem visitou dois jogos é um visitante só.
  totais as (
    select j.jan,
      (select count(distinct anon) from vis where vis.jan = j.jan)::int as visitantes,
      (select count(distinct v.anon) from vis v join fez f on f.jogo = v.jogo and f.jan = v.jan and f.anon = v.anon
        where v.jan = j.jan)::int as interagiram,
      (select coalesce(sum(least(_int(props->>'n'), 100000)), 0) from ev where ev.jan = j.jan and name = 'card_added')::bigint as cartas,
      (select count(distinct anon) from ev where ev.jan = j.jan and name = 'card_added')::int as cadastraram
    from (values ('a'), ('b')) j(jan)
  ),
  -- Por onde as cartas entraram (props.via do card_added), no período atual.
  vias as (
    select jogo as game,
      case when props->>'via' in ('ui', 'scan', 'csv', 'lista') then props->>'via' else 'ui' end as via,
      coalesce(sum(least(_int(props->>'n'), 100000)), 0)::bigint as cartas,
      count(distinct anon)::int as pessoas
    from ev where name = 'card_added' and jan = 'a'
    group by 1, 2
  ),
  topo_v as (select game from linhas where visitantes > 0 order by visitantes desc, pageviews desc, game limit 6),
  topo_c as (select game from linhas where cartas > 0 order by cartas desc, cadastraram desc, game limit 6),
  serie_v as (
    select dia, case when jogo in (select game from topo_v) then jogo else '(outros)' end as game,
           count(distinct anon)::int as n
    from ev where jan = 'a' and name = 'pageview' and anon is not null
    group by 1, 2
  ),
  serie_c as (
    select dia, case when jogo in (select game from topo_c) then jogo else '(outros)' end as game,
           coalesce(sum(least(_int(props->>'n'), 100000)), 0)::bigint as n
    from ev where jan = 'a' and name = 'card_added'
    group by 1, 2
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'migration', '20261111g',
    'jogos', (select coalesce(jsonb_agg(to_jsonb(l) order by l.visitantes desc, l.cartas desc, l.abertas desc, l.game), '[]'::jsonb)
      from linhas l
      where l.visitantes + l.visitantes_ant + l.cartas + l.cartas_ant + l.abertas + l.abertas_ant + l.cliques_loja + l.cliques_loja_ant > 0),
    'atual', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'a'),
    'anterior', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'b'),
    'vias', (select coalesce(jsonb_agg(to_jsonb(v) order by v.game, v.cartas desc), '[]'::jsonb) from vias v),
    'topo_visitantes', (select coalesce(jsonb_agg(game), '[]'::jsonb) from (select game from linhas where visitantes > 0 order by visitantes desc, pageviews desc, game limit 6) t),
    'topo_cartas', (select coalesce(jsonb_agg(game), '[]'::jsonb) from (select game from linhas where cartas > 0 order by cartas desc, cadastraram desc, game limit 6) t),
    'serie_visitantes', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'game', s.game, 'n', s.n) order by s.dia, s.game), '[]'::jsonb) from serie_v s),
    'serie_cartas', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'game', s.game, 'n', s.n) order by s.dia, s.game), '[]'::jsonb) from serie_c s)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_jogos(int) from public, anon;
grant execute on function public.admin_jogos(int) to authenticated;
