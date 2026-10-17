-- ============================================================================
-- 20261017a — alarme de medição parada sem estourar o tempo do anônimo
--
-- POR QUE: em 2026-10-17 o healthcheck ficou vermelho com "medição sem evento
-- parado: HTTP 500" nas duas tentativas. Não era alarme de evento parado: era
-- o Postgres cancelando a consulta (57014, "canceling statement due to
-- statement timeout"). O papel anon do Supabase tem 3 s por comando, e a
-- `_sentinela()` da 20261004a lê 16 dias de `events` TRÊS vezes (todos os
-- nomes, de novo o store_click, de novo o pageview), sempre indo na tabela:
-- abre cada linha, inclusive as de robô (o `not bot` só descarta depois de
-- ler), e precisa do `props` de todas porque a expressão do
-- `store_click:<loja>` está no mesmo select dos outros nomes. Medido de fora
-- no mesmo minuto: 1ª chamada 3,5 s e 500; 2ª 2,0 s; 3ª 0,4 s. Com o cache
-- quente cabe; frio (o healthcheck chama uma vez por dia) passa dos 3 s. O
-- `events` só cresce, então o que hoje oscila no limite amanhã falha sempre.
--
-- O QUE MUDA:
--   1. Índice parcial `events_humano_ts_idx (ts, name) where not bot`: a
--      contagem por nome dos 16 dias sai do ÍNDICE (index-only scan), sem
--      abrir a tabela e sem passar pelas linhas de robô.
--   2. `_sentinela()` reescrita com o mesmo retorno e a mesma regra: UMA
--      passada por nome, que já traz o pageview (o tráfego sai dela, em vez
--      de uma terceira leitura), e o store_click por loja numa segunda, só
--      nas linhas de store_click — as únicas que precisam do `props`.
--   3. `analytics_sentinela()` com `statement_timeout = 15s` na própria
--      função: chamada pela API, o ajuste da função vale no lugar dos 3 s do
--      anon (docs do Supabase, "Timeouts", nível de função). Folga, não
--      remédio — o remédio é o 1 e o 2.
--
-- Mesmo contrato: `_sentinela()` com as mesmas colunas (create or replace,
-- sem drop), `analytics_sentinela()` devolvendo só os NOMES em alarme e a
-- `admin_health()` intocada (lê a `_sentinela` e fica mais rápida junto).
--
-- O `create index` segura os inserts no `events` enquanto monta (segundos);
-- o envio do site é fire-and-forget e espera. Não dá pra usar CONCURRENTLY:
-- o SQL Editor roda o script inteiro numa transação.
--
-- ADITIVA e sem ordem com o JS. Depende da 20261004a (já aplicada em
-- 2026-10-05). Pode aplicar duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select public.analytics_sentinela();   -- [] (e rápido)
--   select indexname from pg_indexes where indexname = 'events_humano_ts_idx';  -- 1 linha
--   select proconfig from pg_proc where proname = 'analytics_sentinela';  -- {statement_timeout=15s}
-- ============================================================================

-- ── 1) Índice só das linhas de gente, na ordem do filtro (ts) ───────────────
create index if not exists events_humano_ts_idx on public.events (ts, name) where not bot;

-- ── 2) _sentinela: duas passadas em vez de três, a grande só no índice ──────
-- O retorno é o da 20261004a, coluna por coluna; a regra também (o `alerta`,
-- o esperado escalado pelos pageviews, o pageview na regra antiga).
create or replace function public._sentinela()
returns table (alvo text, ultimas48h int, media_dia numeric, ultimo timestamptz,
               esperado48h numeric, alerta boolean)
language sql stable security definer set search_path = public as $$
  with por_nome as (
    -- Sem `props` aqui de propósito: só ts, name e bot, tudo no índice parcial.
    select name as alvo,
      count(*) filter (where ts >= now() - interval '48 hours')::int as ultimas48h,
      count(*) filter (where ts < now() - interval '48 hours') as antes,
      max(ts) as ultimo
    from events
    where not bot and ts >= now() - interval '16 days'
      and name not in ('jserror', 'push_sent')
    group by name
  ),
  por_loja as (
    -- O store_click por loja (s = loja do clique); o total já veio no por_nome.
    select 'store_click:' || coalesce(props->>'s', '?') as alvo,
      count(*) filter (where ts >= now() - interval '48 hours')::int as ultimas48h,
      count(*) filter (where ts < now() - interval '48 hours') as antes,
      max(ts) as ultimo
    from events
    where not bot and ts >= now() - interval '16 days' and name = 'store_click'
    group by 1
  ),
  agg as (
    select * from por_nome
    union all
    select * from por_loja
  ),
  -- Agregado sem group by: sempre uma linha, zerada se não houve pageview.
  trafego as (
    select coalesce(sum(ultimas48h), 0) as pv48, coalesce(sum(antes), 0) as pv_antes
    from por_nome where alvo = 'pageview'
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

-- ── 3) Folga de tempo pro robô do healthcheck (anon) ────────────────────────
alter function public.analytics_sentinela() set statement_timeout = '15s';
