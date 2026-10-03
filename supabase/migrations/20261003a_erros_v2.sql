-- ============================================================================
-- 20261003a — erros de JS v2 no /admin: celular × desktop (docs/PLANO-TECNICO.md,
-- D0/D3).
--
-- POR QUE: a `error_summary` (20260723a) agrupa por mensagem E pela fonte com
-- o hash da leva (`shared.<hash>.js:93:2765`), então o mesmo bug vira uma linha
-- por deploy — e o site sobe várias levas por dia; olha só 7 dias, devolve 50
-- linhas e conta erro de robô. E o evento não dizia o aparelho, que era a
-- pergunta da campanha paga ("quebrou no celular ou no desktop?").
--
-- O QUE FAZ: cria a `admin_erros(days)` (o nome segue o
-- `admin_*` que o shared.adminRpc aceita), só leitura, mesmo portão de
-- admin. O aparelho vem do próprio jserror quando ele já traz (`props.d`, o
-- envio v2 de 2026-10-03) e, nos eventos de antes, do pageview do MESMO
-- navegador anônimo — o cruzamento vale RETROATIVO, então a campanha inteira
-- aparece separada. Robô sai pelos dois lados (o `bot` do evento e o do
-- pageview, que traz o `webdriver`). A assinatura é a mensagem com número
-- trocado por N + o primeiro quadro sem o hash; a classe é a mesma régua das
-- consultas da Fase 0 do plano.
--
-- Devolve, numa chamada:
--   totais       por aparelho: erros, navegadores com erro, pageviews e
--                visitantes do período (a taxa sai daí, não do volume)
--   serie        por dia × aparelho: erros e pageviews
--   assinaturas  até 200, mais frequentes primeiro: classe, tipo, mensagem,
--                fonte de exemplo (com hash, pro scripts/decodifica-erro.mjs),
--                vezes, navegadores, celular/desktop/sem info, primeiro e
--                último, as levas, as páginas, os navegadores e os apps
--                embutidos que mais aparecem
--
-- ADITIVA e sem ordem com o JS: a aba Qualidade usa a v2 quando ela existe e
-- cai na tabela antiga (com o aviso pra aplicar esta) quando não.
--
-- Conferir depois de aplicar (logado como admin no app, ou aqui com o uid do
-- dono num set_config):
--   select jsonb_pretty(public.admin_erros(10) -> 'totais');
-- ============================================================================

create or replace function public.admin_erros(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ini timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 400)));
  r jsonb;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then return null; end if;

  with aparelho as (
    -- classe do aparelho e robô, pelo pageview do mesmo navegador anônimo
    select anon,
           mode() within group (order by props->>'d') as d,
           bool_or(bot or coalesce(props->>'wd', '') = '1') as robo
    from events
    where name = 'pageview' and anon is not null and ts >= ini - interval '30 days'
    group by anon
  ),
  erro as (
    select e.ts, e.path, e.anon,
           coalesce(nullif(e.props->>'d', ''), a.d) as d,
           e.bot or coalesce(a.robo, false) as robo,
           coalesce(nullif(e.props->>'k', ''), 'js') as k,
           left(regexp_replace(coalesce(e.props->>'m', ''), '[0-9]+', 'N', 'g'), 160) as msg,
           coalesce(e.props->>'s', '') as fonte,
           -- 1º quadro: o `f` do v2 já vem limpo; do v1, a URL:linha:coluna da
           -- fonte sem a origem e sem o hash — os dois caem na mesma assinatura
           regexp_replace(regexp_replace(
             coalesce(e.props->'f'->>0, substring(e.props->>'s' from '(https?://[^ ()@]+:[0-9]+:[0-9]+)'), e.props->>'s', ''),
             '^https?://(www\.)?sleevu\.app/', ''), '\.[0-9a-f]{8}\.(js|css)', '.\1', 'g') as quadro,
           nullif(e.props->>'v', '') as leva,
           nullif(e.props->>'b', '') as b,
           nullif(e.props->>'iab', '') as iab
    from events e
    left join aparelho a on a.anon = e.anon
    where e.name = 'jserror' and e.ts >= ini
  ),
  gente as (
    select *,
      case
        when k in ('terceiro', 'recurso', 'csp', 'armazenamento', 'falha') then k
        when msg ~* '(failed to fetch|load failed|networkerror when attempting|network request failed|network connection was lost|internet connection appears to be offline)' then 'rede'
        when msg ~* '^script error' or quadro ~* '(googlesyndication|cloudflareinsights|challenges\.cloudflare|gstatic\.com)' then 'terceiro'
        when quadro ~* '(chrome|moz|safari|safari-web)-extension:|webkit-masked-url:' then 'extensao'
        when msg ~* '(unexpected token .<|expected expression, got .<|dynamically imported module|importing a module script failed)' then 'leva velha'
        when msg ~* '(quotaexceeded|quota has been exceeded|operation is insecure|access is denied for this document)' then 'armazenamento'
        when msg ~* 'resizeobserver loop' then 'ruido'
        else 'investigar'
      end as classe
    from erro
    where not robo
  ),
  pv as (
    select ts::date as dia, coalesce(props->>'d', '?') as d, count(*) as views, count(distinct anon) as visitantes
    from events
    where name = 'pageview' and not bot and coalesce(props->>'wd', '') <> '1' and ts >= ini
    group by 1, 2
  ),
  assinatura as (
    select classe, k, msg, quadro,
           min(fonte) as fonte,
           count(*) as vezes,
           count(distinct anon) as navegadores,
           count(*) filter (where d = 'm') as celular,
           count(*) filter (where d = 'd') as desktop,
           count(*) filter (where d is null or d not in ('m', 'd')) as sem_info,
           min(ts) as primeiro,
           max(ts) as ultimo,
           (array_agg(distinct leva) filter (where leva is not null))[1:6] as levas,
           (array_agg(distinct path) filter (where path is not null))[1:8] as paginas
    from gente
    group by classe, k, msg, quadro
    order by count(*) desc
    limit 200
  ),
  marcas as (
    -- navegadores e apps embutidos de cada assinatura (os 3 mais comuns)
    select g.msg, g.quadro, g.k,
           (select coalesce(jsonb_agg(jsonb_build_object('b', x.b, 'n', x.n) order by x.n desc), '[]'::jsonb)
              from (select b, count(*) as n from gente g2 where g2.msg = g.msg and g2.quadro = g.quadro and g2.k = g.k and b is not null group by b order by 2 desc limit 3) x) as navegadores,
           (select coalesce(jsonb_agg(jsonb_build_object('iab', x.iab, 'n', x.n) order by x.n desc), '[]'::jsonb)
              from (select iab, count(*) as n from gente g2 where g2.msg = g.msg and g2.quadro = g.quadro and g2.k = g.k and iab is not null group by iab order by 2 desc limit 3) x) as apps
    from (select distinct msg, quadro, k from assinatura) g
  )
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(days, 30), 400)),
    'desde', ini,
    'gerado', now(),
    'totais', (
      select coalesce(jsonb_object_agg(d, jsonb_build_object('erros', erros, 'navegadores', navegadores, 'views', views, 'visitantes', visitantes)), '{}'::jsonb)
      from (
        select coalesce(t.d, p.d) as d, coalesce(t.erros, 0) as erros, coalesce(t.navegadores, 0) as navegadores,
               coalesce(p.views, 0) as views, coalesce(p.visitantes, 0) as visitantes
        from (select coalesce(nullif(d, ''), '?') as d, count(*) as erros, count(distinct anon) as navegadores
              from gente group by 1) t
        full join (select d, sum(views) as views,
                          (select count(distinct anon) from events
                            where name = 'pageview' and not bot and coalesce(props->>'wd', '') <> '1'
                              and ts >= ini and coalesce(props->>'d', '?') = pvd.d) as visitantes
                   from pv pvd group by d) p on p.d = t.d
      ) z
    ),
    'serie', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'd', d, 'erros', erros, 'views', views) order by dia, d), '[]'::jsonb)
      from (
        select coalesce(e.dia, p.dia) as dia, coalesce(e.d, p.d) as d, coalesce(e.erros, 0) as erros, coalesce(p.views, 0) as views
        from (select ts::date as dia, coalesce(nullif(d, ''), '?') as d, count(*) as erros from gente group by 1, 2) e
        full join pv p on p.dia = e.dia and p.d = e.d
      ) s
    ),
    'assinaturas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'classe', a.classe, 'k', a.k, 'msg', a.msg, 'quadro', a.quadro, 'fonte', a.fonte,
               'vezes', a.vezes, 'navegadores', a.navegadores,
               'celular', a.celular, 'desktop', a.desktop, 'sem_info', a.sem_info,
               'primeiro', a.primeiro, 'ultimo', a.ultimo,
               'levas', coalesce(to_jsonb(a.levas), '[]'::jsonb), 'paginas', coalesce(to_jsonb(a.paginas), '[]'::jsonb),
               'browsers', m.navegadores, 'apps', m.apps
             ) order by a.vezes desc), '[]'::jsonb)
      from assinatura a
      join marcas m on m.msg = a.msg and m.quadro = a.quadro and m.k = a.k
    )
  ) into r;
  return r;
end $$;
revoke all on function public.admin_erros(int) from public, anon;
grant execute on function public.admin_erros(int) to authenticated;
