-- ============================================================================
-- 20261004a — alarme de medição parada leva o TRÁFEGO em conta
--
-- POR QUE: em 2026-10-04 o healthcheck ficou vermelho com "parou de chegar:
-- scan_open", e nada estava quebrado. A campanha paga (≈22/09 a 30/09) trouxe
-- 200–490 visitantes por dia; em 01/10 ela acabou e o site voltou a 12–19. O
-- scanner era aberto por ~2,8% dos visitantes (53 aberturas em ~1.900), então
-- com ~30 visitantes em 48h o esperado era menos de UMA abertura — e zero é o
-- normal. A regra da 20260928a (média de 3+/dia nos 14 dias anteriores e zero
-- nas últimas 48h) compara com a média da campanha e não sabe que o tráfego
-- caiu: ficaria vermelha todo dia até ~11/10, quando os dias da campanha saem
-- da janela, e qualquer outro evento que zerasse 48h acendia junto. Conferido
-- antes de escrever isto: o cliente em produção manda o scan_open (teste no
-- site real com o envio interceptado) e o events_guard no ar aceita o nome.
--
-- O QUE MUDA: o esperado nas 48h é a contagem dos 14 dias anteriores escalada
-- pela razão de PAGEVIEWS (últimas 48h ÷ 14 dias anteriores, sem robô) — a
-- taxa por página vista do próprio evento, aplicada ao tráfego de agora. O
-- alarme exige, além da regra antiga, esperado >= 6. Seis é o que a regra
-- antiga já supunha (3/dia × 2 dias com o tráfego parado), e zero com 6
-- esperados é raro de verdade (Poisson: e^-6 ≈ 0,25%).
--
-- O `pageview` é a EXCEÇÃO: escalá-lo por ele mesmo daria esperado zero
-- justamente quando ele zera (consentimento quebrado, script fora do ar). Pra
-- ele o esperado é o da regra antiga, média × 2. Se o pageview para, ele
-- acende sozinho — e é o sinal certo, porque todo o resto cai junto.
--
-- `_sentinela()` ganha duas colunas (esperado48h e alerta) — mudar o tipo de
-- retorno exige drop + create, e é a única função dropada aqui. As duas que a
-- leem (analytics_sentinela e admin_health) são recriadas pra usar `alerta`,
-- em vez de cada uma repetir a regra. O contrato anônimo não muda: só os
-- NOMES em alarme, nenhuma contagem. O admin.js já lê `alerta` e ignora a
-- coluna nova.
--
-- ADITIVA e sem ordem com o JS. Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select public.analytics_sentinela();   -- [] hoje (o scan_open sai)
--   select alvo, ultimas48h, media_dia, esperado48h, alerta
--   from public._sentinela() order by media_dia desc;
-- ============================================================================

drop function if exists public._sentinela();

create function public._sentinela()
returns table (alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz,
               esperado48h numeric, alerta boolean)
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
      count(*) filter (where ts < now() - interval '48 hours') as antes,
      max(ts) as ultimo
    from base group by alvo
  ),
  trafego as (
    select count(*) filter (where ts >= now() - interval '48 hours') as pv48,
           count(*) filter (where ts < now() - interval '48 hours') as pv_antes
    from events
    where name = 'pageview' and not bot and ts >= now() - interval '16 days'
  ),
  conta as (
    select a.alvo, a.ultimas48h, round(a.antes::numeric / 14, 1) as media_dia, a.ultimo,
      round(case when a.alvo = 'pageview' or t.pv_antes = 0 then a.antes::numeric / 7
                 else a.antes::numeric * t.pv48 / t.pv_antes end, 1) as esperado48h
    from agg a cross join trafego t
  )
  select alvo, ultimas48h, media_dia, ultimo, esperado48h,
         media_dia >= 3 and ultimas48h = 0 and esperado48h >= 6 as alerta
  from conta
$$;
revoke all on function public._sentinela() from public, anon, authenticated;

-- Pro robô do healthcheck (anon): só os NOMES em alarme, sem contagem nenhuma.
create or replace function public.analytics_sentinela()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(alvo order by alvo), '[]'::jsonb)
  from _sentinela() where alerta
$$;
revoke all on function public.analytics_sentinela() from public;
grant execute on function public.analytics_sentinela() to anon, authenticated;

-- Cópia da 20260928a com o `alerta` vindo da _sentinela e o esperado a mais.
create or replace function public.admin_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  return jsonb_build_object(
    'alvos', (select coalesce(jsonb_agg(jsonb_build_object(
                'alvo', alvo, 'ultimas48h', ultimas48h, 'media_dia', media_dia, 'ultimo', ultimo,
                'esperado48h', esperado48h, 'alerta', alerta) order by alvo), '[]'::jsonb)
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
