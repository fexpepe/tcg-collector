-- ============================================================================
-- 20261112a — /admin: "Erros a cada mil páginas" com a mesma régua em cima e
-- embaixo.
--
-- POR QUE: em 2026-11-12 o Resumo marcou 413,7 erros a cada mil páginas
-- (antes: 96,7). Duas coisas infladas, nenhuma era o site quebrando (96
-- páginas de produção abertas no desktop e 48 no celular: zero erro de JS):
--
-- 1) CSP SÓ-RELATÓRIO DO CLOUDFLARE. O monitor de scripts (Page Shield) põe
--    numa amostra das respostas um Content-Security-Policy-Report-Only com
--    `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'`. Ele
--    acusa o script do próprio site, a conexão com o Supabase, o worker…
--    e não barra nada. O ouvinte do theme.js não olhava a `disposition`:
--    cada página sorteada virava até 8 jserror k=csp (uma /hub reproduzida
--    deu 24 violações). Desde esta data o theme.js larga o só-relatório e o
--    erros.js marca o bloqueio de verdade com `cb`; aqui, CSP sem a marca
--    (todo o histórico) sai da conta. A aba Erros segue mostrando o
--    histórico, na classe csp.
--
-- 2) PÚBLICO DIFERENTE EM CIMA E EMBAIXO. A conta dividia TODO jserror que
--    não fosse robô pelo user-agent pelas páginas de gente, e três públicos
--    entravam só no numerador:
--   - o navegador automatizado com user-agent comum: o pageview dele leva
--     `wd` e o events_guard o grava como bot (fica fora das páginas), mas o
--     jserror não levava a marca e entrava como gente. É o pior caso, porque
--     robô abre página em sequência, cada uma num contexto limpo, e manda até
--     8 erros por página (o teto da sessão não segura sem sessionStorage);
--   - o navegador da equipe (sleevu-equipe-v1): o pageview não sai, o erro
--     sai (é o que deixa o dono ver o próprio erro na aba Erros);
--   - quem desligou a medição: o erro sai sem anon, a página não sai.
-- A aba Qualidade › Erros (admin_erros) já tirava o robô pelo pageview do
-- mesmo navegador; o Resumo não.
--
-- O QUE MUDA: só o `erros` da admin_pulso (atual, anterior e a série por
-- dia). Conta o jserror cujo navegador (anon) tem página de gente na janela
-- — o mesmo público do denominador — e, de CSP, só o marcado `cb`. Tudo o
-- mais sai idêntico (ensaiado). Retroativo: o número do painel se corrige
-- sozinho, sem mexer em dado. O src/erros.js passa a mandar `wd` no jserror
-- (o guard já grava bot por ele), o que limpa o dado cru daqui pra frente.
--
-- Nasce com `statement_timeout = 30s` (o create or replace troca a config
-- que a 20261031a tinha posto). ADITIVA e sem ordem com o JS: o admin.js
-- não lê o `migration` que volta. Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select proconfig from pg_proc where proname = 'admin_pulso';   -- statement_timeout=30s
--   select pg_get_functiondef('public.admin_pulso(int)'::regprocedure) ~ 'er_dia' as nova;  -- true
-- ============================================================================

create or replace function public.admin_pulso(days int default 30)
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

  with ev as (
    select ts, name, anon, uid, coalesce(nullif(path, ''), '?') as path, coalesce(nullif(game, ''), 'hub') as game,
           coalesce(props, '{}'::jsonb) as props,
           (ts at time zone 'America/Sao_Paulo')::date as dia,
           case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
    from events
    where not bot and ts >= ant
      and name in ('pageview', 'collection_first', 'card_added', 'store_click', 'scan_open',
                   'share_created', 'deck_created', 'jserror', 'page_time')
  ),
  pv as (select * from ev where name = 'pageview'),
  -- Erros só de quem também entra no denominador (20261112a): o navegador
  -- precisa ter página de gente na janela. Sem isto entravam no numerador o
  -- robô com webdriver (a página dele é bot, o erro não era), o navegador da
  -- equipe (não manda página) e quem desligou a medição (erro sem anon).
  -- CSP só com a marca cb (bloqueio de verdade): sem ela é de antes de
  -- 12/11, quase tudo o Report-Only do monitor de scripts do Cloudflare.
  er as (
    select * from ev
    where name = 'jserror' and anon in (select anon from pv where anon is not null)
      and not (props->>'k' = 'csp' and coalesce(props->>'cb', '') <> '1')
  ),
  -- Visitas: páginas do mesmo navegador sem pausa de 30 minutos (a mesma
  -- régua da admin_engagement). A 1ª página da visita carrega a origem.
  marcas as (
    select anon, ts, jan, dia, props,
      case when lag(ts) over w is null or ts - lag(ts) over w > interval '30 minutes' then 1 else 0 end as nova
    from pv where anon is not null
    window w as (partition by anon order by ts)
  ),
  entradas as (select * from marcas where nova = 1),
  primeira as (
    select anon, min(ts) as first_ts from events
    where name = 'pageview' and not bot and anon in (select anon from pv where anon is not null)
    group by anon
  ),
  pt as (
    select anon, ts, jan, least(_int(props->>'ms'), 1800000) as ms,
      case when lag(ts) over w is null or ts - lag(ts) over w > interval '30 minutes' then 1 else 0 end as nova
    from ev where name = 'page_time' and anon is not null
    window w as (partition by anon order by ts)
  ),
  pt_s as (select anon, jan, ms, sum(nova) over (partition by anon order by ts rows unbounded preceding) as sid from pt),
  visitas_t as (select anon, sid, min(jan) as jan, sum(ms) as ms from pt_s group by anon, sid),
  kpi as (
    select j.jan,
      (select count(distinct anon) from pv where pv.jan = j.jan and anon is not null)::int as visitantes,
      (select count(*) from pv where pv.jan = j.jan)::int as pageviews,
      (select count(distinct uid) from pv where pv.jan = j.jan and uid is not null)::int as logados,
      (select count(*) from entradas e where e.jan = j.jan)::int as visitas,
      (select count(*) from primeira f
        where f.first_ts >= (case when j.jan = 'a' then ini else ant end)
          and f.first_ts <  (case when j.jan = 'a' then now() else ant_fim end))::int as novos,
      (select count(distinct anon) from ev where ev.jan = j.jan and name = 'collection_first')::int as ativacoes,
      (select coalesce(sum(least(_int(props->>'n'), 100000)), 0) from ev where ev.jan = j.jan and name = 'card_added')::bigint as cartas,
      (select count(*) from ev where ev.jan = j.jan and name = 'store_click')::int as cliques_loja,
      (select count(*) from ev where ev.jan = j.jan and name = 'scan_open')::int as scans,
      (select count(*) from ev where ev.jan = j.jan and name in ('share_created', 'deck_created'))::int as criacoes,
      (select count(*) from er where er.jan = j.jan)::int as erros,
      (select count(*) from auth.users u
        where u.created_at >= (case when j.jan = 'a' then ini else ant end)
          and u.created_at <  (case when j.jan = 'a' then now() else ant_fim end))::int as contas,
      (select round(percentile_cont(0.5) within group (order by ms))::bigint from visitas_t v where v.jan = j.jan) as tempo_ms
    from (values ('a'), ('b')) j(jan)
  ),
  dias as (select (hoje - g)::date as dia from generate_series(0, 2 * d - 1) g),
  pv_dia as (
    select dia, count(*)::int as pageviews, count(distinct anon)::int as visitantes, count(distinct uid)::int as logados
    from pv group by dia
  ),
  ev_dia as (
    select dia,
      count(distinct anon) filter (where name = 'collection_first')::int as ativacoes,
      count(*) filter (where name = 'store_click')::int as cliques_loja,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas
    from ev group by dia
  ),
  er_dia as (select dia, count(*)::int as erros from er group by dia),
  vis_dia as (select dia, count(*)::int as visitas from entradas group by dia),
  ct_dia as (
    select (created_at at time zone 'America/Sao_Paulo')::date as dia, count(*)::int as contas
    from auth.users where created_at >= ant group by 1
  ),
  -- O que mais mudou: contagens do atual × anterior por recorte. A ordem e a
  -- frase ("Coleção +40%") são do admin.js, que corta o volume pequeno.
  mov_pag as (
    select path as k, count(*) filter (where jan = 'a')::int as a, count(*) filter (where jan = 'b')::int as b
    from pv group by path
  ),
  mov_jogo as (
    select game as k, count(*) filter (where jan = 'a')::int as a, count(*) filter (where jan = 'b')::int as b
    from pv group by game
  ),
  mov_canal as (
    select _canal(props->>'r', props->>'u') as k, count(*) filter (where jan = 'a')::int as a,
           count(*) filter (where jan = 'b')::int as b
    from entradas group by 1
  ),
  mov_origem as (
    select left(coalesce(nullif(props->>'u', ''), nullif(props->>'r', ''), '(direto)'), 60) as k,
           count(*) filter (where jan = 'a')::int as a, count(*) filter (where jan = 'b')::int as b
    from entradas group by 1
  ),
  mov_plat as (
    select _plat(props) as k, count(distinct anon) filter (where jan = 'a')::int as a,
           count(distinct anon) filter (where jan = 'b')::int as b
    from pv where anon is not null group by 1
  ),
  -- Campanha que COMEÇOU dentro da série (5+ visitantes): vira marco no
  -- gráfico sem ninguém precisar anotar.
  camp as (
    select left(props->>'u', 30) as fonte, nullif(left(props->>'c', 30), '') as campanha,
           min(dia) as inicio, count(distinct anon)::int as visitantes
    from entradas where coalesce(props->>'u', '') <> '' and coalesce(props->>'u', '') <> 'push'
    group by 1, 2
    having count(distinct anon) >= 5 and min(dia) > hoje - (2 * d - 1)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'migration', '20261112a',
    'atual', (select to_jsonb(k) - 'jan' from kpi k where k.jan = 'a'),
    'anterior', (select to_jsonb(k) - 'jan' from kpi k where k.jan = 'b'),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(x.dia, 'YYYY-MM-DD'),
        'visitantes', coalesce(p.visitantes, 0), 'pageviews', coalesce(p.pageviews, 0), 'logados', coalesce(p.logados, 0),
        'visitas', coalesce(v.visitas, 0), 'ativacoes', coalesce(e.ativacoes, 0), 'cliques_loja', coalesce(e.cliques_loja, 0),
        'erros', coalesce(r.erros, 0), 'cartas', coalesce(e.cartas, 0), 'contas', coalesce(c.contas, 0)
      ) order by x.dia), '[]'::jsonb)
      from dias x left join pv_dia p using (dia) left join ev_dia e using (dia)
      left join vis_dia v using (dia) left join ct_dia c using (dia) left join er_dia r using (dia)),
    'movimento', jsonb_build_object(
      'paginas',     (select coalesce(jsonb_agg(row_to_json(m) order by m.a + m.b desc), '[]'::jsonb) from mov_pag m),
      'jogos',       (select coalesce(jsonb_agg(row_to_json(m) order by m.a + m.b desc), '[]'::jsonb) from mov_jogo m),
      'canais',      (select coalesce(jsonb_agg(row_to_json(m) order by m.a + m.b desc), '[]'::jsonb) from mov_canal m),
      'origens',     (select coalesce(jsonb_agg(row_to_json(m) order by m.a + m.b desc), '[]'::jsonb) from (select * from mov_origem order by a + b desc limit 30) m),
      'plataformas', (select coalesce(jsonb_agg(row_to_json(m) order by m.a + m.b desc), '[]'::jsonb) from mov_plat m)
    ),
    'campanhas', (select coalesce(jsonb_agg(row_to_json(c) order by c.inicio), '[]'::jsonb) from camp c),
    -- Hora × dia da semana (Brasília) cruzados, do período atual: o mapa de
    -- calor da Audiência. Os dois separados (admin_dashboard) não mostram
    -- que o pico de sábado é de manhã e o de terça é à noite.
    'hora_semana', (select coalesce(jsonb_agg(jsonb_build_object('dow', x.dow, 'h', x.h, 'n', x.n)), '[]'::jsonb) from (
       select extract(dow from ts at time zone 'America/Sao_Paulo')::int as dow,
              extract(hour from ts at time zone 'America/Sao_Paulo')::int as h, count(*)::int as n
       from pv where jan = 'a' group by 1, 2) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_pulso(int) from public, anon;
grant execute on function public.admin_pulso(int) to authenticated;
