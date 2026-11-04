-- ============================================================================
-- 20261104a — alarme de medição parada conta PESSOAS, não eventos
--
-- POR QUE: em 2026-11-04 a aba Medição do /admin (e o healthcheck diário)
-- acusou "parou" em Cartas cadastradas (card_added: 0 em 48h, 27,5
-- esperados) e Cliques em loja (store_click: 0, 8,2 esperados). Nada estava
-- quebrado. Conferido antes de escrever isto: o site em produção manda os
-- dois eventos (teste no site real com o envio interceptado), o events_guard
-- aceita os nomes, `events_descartes` está zerado e as visitas de quem está
-- logado seguem chegando. O que a consulta por visitante mostrou:
--   - em 31/10 entraram 109 card_added, quase todos de UMA pessoa
--     cadastrando a coleção numa noite (110 dos dela em 21 dias). Cada
--     rajada de cadastro vira um evento, então uma noite de trabalho vale 100
--     eventos, e a média dos 14 dias foi a 13,6/dia por causa dela;
--   - no store_click, um só visitante fez 22 cliques, 19 num dia;
--   - as 4–5 contas que faziam esses eventos não voltaram depois de 31/10.
-- A `_sentinela` contava EVENTOS. Pra pageview isso serve (muita gente, cada
-- uma com poucas páginas), mas card_added e store_click vêm em rajada de
-- poucas pessoas. Com uma ou duas pessoas por dia, dois dias sem ninguém é
-- normal, e a conta de "zero com 6 esperados é raro" (Poisson, e^-6) só vale
-- quando os 6 são independentes. 100 cadastros de uma pessoa só não são.
--
-- O QUE MUDA:
--   1. A unidade do alarme passa a ser PESSOA × DIA: o mesmo visitante (anon)
--      conta uma vez por dia em cada evento, faça 1 ou 100. "Dia" é contado
--      pra trás a partir de agora (0 e 1 = as últimas 48h), não o dia do
--      calendário, pra janela de 48h ter exatamente dois.
--   2. O tráfego que escala o esperado também vira pessoas × dia de pageview
--      (quem recarrega 50 páginas não infla o tráfego). Regra e limites são
--      os mesmos de antes, agora em pessoas: alarme = 3+ pessoas por dia
--      faziam, ninguém fez em 48h e eram esperadas 6+. O pageview segue com
--      a exceção da 20261004a: esperado = média × 2, sem escalar por ele.
--   3. `_sentinela()` ganha 3 colunas (pessoas48h, pessoas_dia,
--      esperado_pessoas) e o `alerta` passa a sair delas. As colunas antigas,
--      em eventos, continuam iguais, então o admin.js de antes segue certo
--      até o deploy (só o status muda de regra). Mudar o retorno exige drop +
--      create, como na 20261004a.
--   4. Índice novo `events_humano_ts_anon_idx (ts, name, anon) where not
--      bot`: a passada por nome precisa do anon e continua saindo só do
--      índice (index-only scan), como a 20261017a deixou. Ele faz tudo o que o
--      `events_humano_ts_idx` fazia (mesmo começo, mesmo filtro), então o
--      velho sai, pra não pesar dois índices em todo insert no `events`.
--   5. `admin_health()` recriada pra levar as colunas novas ao painel, com o
--      `statement_timeout = 30s` da 20261031a no próprio create (create or
--      replace apaga o ajuste). A `analytics_sentinela()` NÃO é recriada: lê
--      `_sentinela() where alerta` e mantém os 15 s da 20261017a. O contrato
--      anônimo não muda (só os NOMES em alarme).
--
-- O que se perde, de propósito: com o tráfego de hoje, card_added e o
-- store_click por loja quase nunca chegam a 3 pessoas por dia, então a
-- sentinela para de vigiá-los. É honesto: com 1–2 pessoas por dia, 48h zeradas
-- não provam nada. Medição quebrada de verdade (nome fora da whitelist,
-- migração faltando, script fora do ar) derruba também os eventos de muita
-- gente (pageview, page_time, ad_view), e esses seguem vigiados. Que o site
-- manda o card_added e o store_click, quem garante é o teste do funil no CI.
--
-- ADITIVA e sem ordem com o JS. Depende da 20261017a (aplicada em
-- 2026-10-17) e da 20261004a. Pode aplicar duas vezes. O `create index`
-- segura os inserts no `events` por alguns segundos (o envio do site é
-- fire-and-forget e espera); CONCURRENTLY não dá, o SQL Editor roda tudo numa
-- transação.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select public.analytics_sentinela();   -- [] (card_added e store_click saem)
--   select alvo, ultimas48h, pessoas48h, pessoas_dia, esperado_pessoas, alerta
--     from public._sentinela() order by pessoas_dia desc;
--   select indexname from pg_indexes
--    where indexname in ('events_humano_ts_anon_idx', 'events_humano_ts_idx');  -- só o _anon_
--   select proname, proconfig from pg_proc
--    where proname in ('analytics_sentinela', 'admin_health');  -- 15s e 30s
-- ============================================================================

-- ── 1) Índice com o anon (o velho sai: este cobre tudo o que ele cobria) ────
create index if not exists events_humano_ts_anon_idx on public.events (ts, name, anon) where not bot;
drop index if exists public.events_humano_ts_idx;

-- ── 2) _sentinela: eventos (pra tela de antes) + pessoas (pro alarme) ───────
drop function if exists public._sentinela();
create function public._sentinela()
returns table (alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz,
               esperado48h numeric, pessoas48h int, pessoas_dia numeric,
               esperado_pessoas numeric, alerta boolean)
language sql stable security definer set search_path = public as $$
  -- Primeiro uma linha por evento × pessoa × dia (`quem` = visitante + dia
  -- contado pra trás a partir de agora), depois a soma por evento. No ensaio
  -- com 270 mil linhas isto levou 187 ms; o count(distinct) direto, 463 ms.
  with por_pessoa as (
    -- Sem `props` aqui de propósito: só ts, name, anon e bot, tudo no índice
    -- parcial.
    select name, quem,
      count(*) filter (where ts >= now() - interval '48 hours') as n48,
      count(*) filter (where ts < now() - interval '48 hours') as n_antes,
      max(ts) as ultimo
    from (
      select name, ts,
             coalesce(anon, '') || '/' || floor(extract(epoch from now() - ts) / 86400)::int as quem
      from events
      where not bot and ts >= now() - interval '16 days'
        and name not in ('jserror', 'push_sent')
    ) e
    group by name, quem
  ),
  por_nome as (
    select name as alvo,
      sum(n48)::int as ultimas48h, sum(n_antes) as antes,
      count(*) filter (where n48 > 0)::int as pessoas48h,
      count(*) filter (where n_antes > 0) as pessoas_antes,
      max(ultimo) as ultimo
    from por_pessoa group by name
  ),
  loja_pessoa as (
    -- O store_click por loja (s = loja do clique); o total já veio no por_nome.
    select 'store_click:' || coalesce(props->>'s', '?') as alvo, quem,
      count(*) filter (where ts >= now() - interval '48 hours') as n48,
      count(*) filter (where ts < now() - interval '48 hours') as n_antes,
      max(ts) as ultimo
    from (
      select props, ts,
             coalesce(anon, '') || '/' || floor(extract(epoch from now() - ts) / 86400)::int as quem
      from events
      where not bot and ts >= now() - interval '16 days' and name = 'store_click'
    ) e
    group by 1, 2
  ),
  por_loja as (
    select alvo,
      sum(n48)::int as ultimas48h, sum(n_antes) as antes,
      count(*) filter (where n48 > 0)::int as pessoas48h,
      count(*) filter (where n_antes > 0) as pessoas_antes,
      max(ultimo) as ultimo
    from loja_pessoa group by alvo
  ),
  agg as (
    select * from por_nome
    union all
    select * from por_loja
  ),
  -- Agregado sem group by: sempre uma linha, zerada se não houve pageview.
  trafego as (
    select coalesce(sum(ultimas48h), 0) as pv48, coalesce(sum(antes), 0) as pv_antes,
           coalesce(sum(pessoas48h), 0) as gente48, coalesce(sum(pessoas_antes), 0) as gente_antes
    from por_nome where alvo = 'pageview'
  ),
  conta as (
    select a.alvo, a.ultimas48h, round(a.antes::numeric / 14, 1) as media_dia, a.ultimo,
      -- Em eventos, a conta da 20261004a sem mudança (é o que a tela antiga mostra).
      round(case when a.alvo = 'pageview' or t.pv_antes = 0 then a.antes::numeric / 7
                 else a.antes::numeric * t.pv48 / t.pv_antes end, 1) as esperado48h,
      -- Em pessoas: a mesma conta, com pessoas × dia no lugar de eventos.
      a.pessoas48h, round(a.pessoas_antes::numeric / 14, 1) as pessoas_dia,
      round(case when a.alvo = 'pageview' or t.gente_antes = 0 then a.pessoas_antes::numeric / 7
                 else a.pessoas_antes::numeric * t.gente48 / t.gente_antes end, 1) as esperado_pessoas
    from agg a cross join trafego t
  )
  select alvo, ultimas48h, media_dia, ultimo, esperado48h, pessoas48h, pessoas_dia, esperado_pessoas,
         pessoas_dia >= 3 and pessoas48h = 0 and esperado_pessoas >= 6 as alerta
  from conta
$$;
revoke all on function public._sentinela() from public, anon, authenticated;

-- ── 3) admin_health: cópia da 20261004a + as colunas de pessoas ─────────────
-- O `set statement_timeout` repete o da 20261031a: create or replace o apaga.
create or replace function public.admin_health()
returns jsonb language plpgsql stable security definer set search_path = public
set statement_timeout = '30s' as $$
begin
  if not _is_admin() then return null; end if;
  return jsonb_build_object(
    'alvos', (select coalesce(jsonb_agg(jsonb_build_object(
                'alvo', alvo, 'ultimas48h', ultimas48h, 'media_dia', media_dia, 'ultimo', ultimo,
                'esperado48h', esperado48h, 'pessoas48h', pessoas48h, 'pessoas_dia', pessoas_dia,
                'esperado_pessoas', esperado_pessoas, 'alerta', alerta) order by alvo), '[]'::jsonb)
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
