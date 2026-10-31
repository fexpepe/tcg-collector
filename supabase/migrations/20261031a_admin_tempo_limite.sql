-- /admin: 30 s de tempo-limite nas RPCs do painel (2026-10-31).
--
-- Sintoma: "quase todas as vezes" o /admin abria em "Acesso restrito" na
-- conta de admin, e o painel só aparecia depois de vários F5. O papel
-- `authenticated` do Supabase tem statement_timeout de 8 s, e a
-- admin_dashboard (o portão do painel: é ela que diz se a conta é admin) é a
-- consulta mais pesada do banco — lê os pageviews da janela várias vezes,
-- procura a PRIMEIRA visita de cada visitante em todo o histórico de `events`
-- (o CTE `primeira` não tem corte de data) e abre o jsonb da coleção de todo
-- mundo. Com o cache frio (o painel abre uma vez por dia), passa dos 8 s, o
-- Postgres cancela (57014) e o PostgREST devolve 500; cada F5 aquece mais um
-- pedaço do cache até a consulta caber. É o mesmo desenho da
-- analytics_sentinela na 20261017a (3,5 s frio × 0,4 s quente contra os 3 s do
-- anon). O cliente lia esse 500 como "não é admin": isso foi corrigido no JS
-- (motivo na tela e nova tentativa sozinha); aqui é a folga do banco.
--
-- O `set statement_timeout` na própria função vale pela API REST (doc do
-- Supabase, "Timeouts"). Toda admin_* começa conferindo is_admin, então quem
-- não é admin segue recebendo null na hora: os 30 s só existem pro dono.
--
-- Pega TODAS as admin_* que existirem no banco (e a error_summary e a
-- analytics_summary, que o painel também chama), sem lista na mão. Duas
-- coisas que este ajuste NÃO cobre sozinho:
--   - RPC nova do painel nasce com os 8 s do papel: ponha
--     `set statement_timeout = '30s'` no create dela;
--   - um `create or replace` futuro de uma destas APAGA o ajuste (o SET faz
--     parte da definição da função): repita o SET no próprio create.
--
-- Aditiva e sem ordem com o JS. Pode rodar mais de uma vez.
--
-- Medir antes/depois (SQL Editor; roda como o admin, sem mudar nada):
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
--     from profiles where is_admin limit 1;
--   explain analyze select public.admin_dashboard(30);  -- "Execution Time"
--   rollback;
-- A 1ª rodada do dia é a que importa (cache frio); a 2ª já sai rápida.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (left(p.proname, 6) = 'admin_' or p.proname in ('error_summary', 'analytics_summary'))
  loop
    execute format('alter function %s set statement_timeout = %L', f, '30s');
  end loop;
end $$;

-- Conferir depois de aplicar:
--   select proname, proconfig from pg_proc
--    where left(proname, 6) = 'admin_' or proname in ('error_summary', 'analytics_summary')
--    order by 1;   -- toda linha com statement_timeout=30s no proconfig
