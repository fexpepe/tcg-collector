-- ============================================================================
-- Robôs retroativos (2026-09-29): tira da série a rajada de julho/agosto
--
-- O gráfico de crescimento do /admin (e do kit de parceiros) tem um platô de
-- EXATOS 30 dias — de ~28/07 a ~27/08 os "visitantes únicos em 30 dias" pulam
-- de algumas centenas pra ~4.300 e depois despencam de volta. Platô com a
-- largura da janela é a assinatura de uma rajada: milhares de navegadores
-- que apareceram de uma vez, nunca voltaram e saíram da conta 30 dias depois.
-- É o que faz um robô que EXECUTA JavaScript (crawler que renderiza a página,
-- teste automatizado em produção): cada página num navegador limpo nasce com
-- um uuid anônimo novo, e cada uuid novo conta como um visitante.
--
-- Por que isso entrou como gente: antes da 20260914a não existia a coluna
-- `bot` (tudo nasceu false) e o pageview não levava contexto — nem aparelho,
-- nem idioma, nem origem, nem o flag de webdriver; o user-agent nunca é
-- guardado. O único sinal que sobrou nesses eventos é o COMPORTAMENTO.
--
-- A regra (_robos_retro_candidatos), conservadora de propósito:
--   1. "de passagem": toda a história do navegador cabe em 30 minutos — uma
--      visita só, e nunca mais voltou;
--   2. não fez NADA além de ver página (qualquer evento de produto — carta
--      cadastrada, scanner, conta, link, clique em loja… — tira da lista);
--   3. a primeira visita caiu numa AVALANCHE de navegadores de passagem: uma
--      hora com mais de max(25, 5 × a mediana das horas vizinhas), ou um dia
--      que, fora essas horas, ainda teve mais de max(150, 5 × a mediana dos
--      dias vizinhos) — vizinhos = 14 dias pra cada lado. Hora normal do site
--      tem 0 a 3;
--   4. só antes de 2026-09-15: dali em diante o events_guard já marca robô
--      pelo user-agent e pelo webdriver, e a regra não mexe.
-- Quem visitou de verdade numa hora de avalanche e caiu nos três primeiros
-- critérios sai junto — é o custo, e ele é pequeno: é gente que, pela própria
-- definição, abriu uma página e foi embora.
--
-- Julho tem uma fonte a mais, e por isso régua mais apertada ATÉ 27/07: até
-- o commit 09aa548 (27/07, 18h58), toda página aberta em localhost durante o
-- desenvolvimento entrava como visita real — inclusive a dos navegadores
-- automáticos de teste e de captura de tela, que abrem cada página num
-- contexto limpo (um visitante novo por página). O evento não guarda de que
-- endereço veio, então de novo só o comportamento separa; mas, com o
-- tráfego de dev sabidamente dentro, até essa data a avalanche começa em 10
-- por hora ou 60 por dia (o site real mal passava de 1 por hora).
--
-- O que muda: os eventos desses navegadores (antes do corte) viram bot=true —
-- nada é APAGADO —, a lista vai pra `robos_retro` (trancada, é o que permite
-- desfazer) e a série é refeita: metrics_daily do 1º dia atingido até 30 dias
-- depois do último (a janela do MAU), e events_daily dos dias atingidos. As
-- abas que calculam na hora (retenção, audiência, funil) se corrigem sozinhas.
-- O que NÃO dá pra corrigir: o contador público card_views (um número por
-- carta, sem navegador) — as "mais visitadas" de sempre seguem com as views
-- do robô.
--
-- Reaplicar é inofensivo: a regra enxerga o que ela mesma já marcou como se
-- não tivesse marcado (a régua não muda e a lista sai igual), a lista não
-- duplica e o update só pega o que ainda não era robô — reaplicar muda zero
-- dias.
--
-- ANTES de aplicar, dá pra ver o que sairia (só leitura, depois dos blocos 1
-- e 2 existirem):
--   select (primeira at time zone 'America/Sao_Paulo')::date as dia, motivo,
--          count(*) as navegadores, sum(pageviews) as pageviews
--     from public._robos_retro_candidatos() group by 1, 2 order by 1;
--
-- DESFAZER (tudo volta como estava):
--   update public.events e set bot = false from public.robos_retro r
--    where e.anon = r.anon and e.bot and e.ts < timestamptz '2026-09-15 03:00+00';
--   select public.metrics_snapshot(d::date)
--     from generate_series(date '2026-06-01', current_date, interval '1 day') d;
--   select public.events_rollup(d::date)
--     from generate_series(date '2026-06-01', date '2026-09-15', interval '1 day') d;
--   truncate public.robos_retro;
--
-- REGRA DESTE ARQUIVO (a mesma da 20260928a): nenhum cifrão dentro de corpo
-- de função — confunde o SQL Editor do Supabase.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu), colando o
-- arquivo INTEIRO (o botão "Copy raw file" do GitHub — colar pedaço já deu
-- "unterminated dollar-quoted string"):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
-- O resultado mostrado no fim é o antes × depois de cada dia que mudou.
-- ============================================================================

-- ── 1) A lista do que foi marcado (trancada, como apoiadores/consent_daily) ─
create table if not exists public.robos_retro (
  anon        text primary key,
  primeira    timestamptz not null,
  pageviews   int not null,
  motivo      text not null,          -- 'hora' ou 'dia': qual avalanche pegou
  marcado_em  timestamptz not null default now()
);
alter table public.robos_retro enable row level security;
revoke all on public.robos_retro from public, anon, authenticated;

-- ── 2) A regra ──────────────────────────────────────────────────────────────
-- Devolve os navegadores de passagem que caíram numa avalanche, com o motivo.
-- Os limites viram parâmetro pra quem quiser conferir mais apertado ou mais
-- frouxo antes de aplicar (o bloco 3 usa os padrões). `p_trava` é o 1º dia
-- em que o site passou a contar só produção (o localhost entrava até a
-- véspera): antes dele valem os pisos de dev. O drop é da 1ª versão (4
-- parâmetros, sem a régua de dev): se ela chegou a ser colada, as duas
-- conviveriam e a chamada sem argumento do bloco 3 ficaria ambígua.
drop function if exists public._robos_retro_candidatos(date, int, int, numeric);
create or replace function public._robos_retro_candidatos(
  p_ate date default date '2026-09-15',
  p_piso_hora int default 25,
  p_piso_dia int default 150,
  p_fator numeric default 5,
  p_trava date default date '2026-07-28',
  p_piso_hora_dev int default 10,
  p_piso_dia_dev int default 60
)
returns table (anon text, primeira timestamptz, pageviews int, motivo text)
language sql stable set search_path = public as $$
  with
  -- Toda pageview de gente, de qualquer data: quem voltou DEPOIS do corte
  -- também voltou, e não é de passagem. O que ESTA regra já marcou conta como
  -- antes da marca: a prévia, a aplicação e a reaplicação veem o mesmo mundo
  -- (sem isso, a régua caía depois da correção e reaplicar marcava mais).
  pv as (
    select e.anon, e.ts from events e
    where e.name = 'pageview' and e.anon is not null
      and (not e.bot or e.anon in (select r.anon from robos_retro r))
  ),
  por_anon as (
    select pv.anon, min(pv.ts) as primeira, max(pv.ts) as ultima, count(*)::int as pageviews
    from pv group by pv.anon
  ),
  -- Fez qualquer coisa além de ver página (e de dar erro de JS): é gente
  -- usando o site, e fica de fora sempre.
  agiu as (
    select distinct e.anon from events e
    where e.anon is not null and e.name not in ('pageview', 'jserror')
  ),
  passagem as (
    select a.anon, a.primeira, a.pageviews,
           date_trunc('hour', a.primeira at time zone 'America/Sao_Paulo') as hora,
           (a.primeira at time zone 'America/Sao_Paulo')::date as dia
    from por_anon a
    where a.primeira < (p_ate::timestamp at time zone 'America/Sao_Paulo')
      and a.ultima - a.primeira <= interval '30 minutes'
      and not exists (select 1 from agiu g where g.anon = a.anon)
  ),
  -- Contagem por hora e por dia COM os zeros: a régua é o normal do site, e
  -- o normal de um site pequeno é hora sem ninguém de passagem.
  horas as (
    select h as hora
    from generate_series((select min(p.hora) from passagem p), p_ate::timestamp - interval '1 hour', interval '1 hour') h
  ),
  por_hora as (
    select h.hora, count(p.anon)::int as n
    from horas h left join passagem p on p.hora = h.hora
    group by h.hora
  ),
  dias as (
    select d::date as dia
    from generate_series((select min(p.dia) from passagem p)::timestamp, (p_ate - 1)::timestamp, interval '1 day') d
  ),
  -- A régua é LOCAL: a mediana das horas e dos dias num raio de 14 dias. Um
  -- p95 do período inteiro ficava alto demais em julho (medido contra
  -- setembro, com mais gente) e deixava rajada de dev passar; a mediana
  -- também não se mexe com as próprias rajadas. O piso absoluto depende da
  -- data: até a véspera da trava de produção, o de dev.
  med_hora as (
    select d.dia,
      (select percentile_cont(0.5) within group (order by h.n) from por_hora h
        where h.hora >= (d.dia - 14)::timestamp and h.hora < (d.dia + 15)::timestamp) as med
    from dias d
  ),
  hora_ruim as (
    select h.hora from por_hora h join med_hora m on m.dia = h.hora::date
    where h.n > greatest(case when h.hora < p_trava::timestamp then p_piso_hora_dev else p_piso_hora end::numeric, p_fator * m.med)
  ),
  -- O dia conta pelo que SOBRA fora das horas de avalanche: rajada de poucas
  -- horas já sai por elas e não leva junto quem visitou de manhã; o que sobra
  -- alto é rajada diluída no dia (abaixo do piso de cada hora).
  resto as (
    select p.dia, p.anon from passagem p
    where p.hora not in (select hora from hora_ruim)
  ),
  por_dia as (
    select d.dia, count(r.anon)::int as n
    from dias d left join resto r on r.dia = d.dia
    group by d.dia
  ),
  dia_ruim as (
    select d.dia from por_dia d
    where d.n > greatest(case when d.dia < p_trava then p_piso_dia_dev else p_piso_dia end::numeric,
      p_fator * (select percentile_cont(0.5) within group (order by x.n) from por_dia x
                 where x.dia between d.dia - 14 and d.dia + 14))
  )
  select p.anon, p.primeira, p.pageviews,
         case when p.hora in (select hora from hora_ruim) then 'hora' else 'dia' end
  from passagem p
  where p.hora in (select hora from hora_ruim) or p.dia in (select dia from dia_ruim)
$$;
revoke all on function public._robos_retro_candidatos(date, int, int, numeric, date, int, int) from public, anon, authenticated;

-- ── 3) A correção ───────────────────────────────────────────────────────────
-- A série de antes, pro relatório do fim.
drop table if exists pg_temp._serie_antes;
create temp table _serie_antes as
  select day, (data->>'mau')::int as mau, (data->>'pageviews')::int as pageviews
  from public.metrics_daily;

do $$
declare
  hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  corte timestamptz := date '2026-09-15'::timestamp at time zone 'America/Sao_Paulo';
  v_ini date;
  v_fim date;
  d     date;
begin
  insert into public.robos_retro (anon, primeira, pageviews, motivo)
  select c.anon, c.primeira, c.pageviews, c.motivo from public._robos_retro_candidatos() c
  on conflict (anon) do nothing;

  update public.events e set bot = true
  from public.robos_retro r
  where e.anon = r.anon and not e.bot and e.ts < corte;

  select min((r.primeira at time zone 'America/Sao_Paulo')::date),
         max((r.primeira at time zone 'America/Sao_Paulo')::date)
    into v_ini, v_fim
  from public.robos_retro r;
  if v_ini is null then
    raise notice 'Nenhuma avalanche de navegadores de passagem antes de 2026-09-15: nada a corrigir.';
    return;
  end if;

  -- Série de crescimento: o MAU de cada dia olha 30 dias pra trás, então o
  -- estrago vai até 30 dias depois do último dia atingido. Dia passado só
  -- refaz os campos de evento (o retrato de coleção do dia fica).
  if to_regprocedure('public.metrics_snapshot(date)') is not null then
    for d in select g::date from generate_series(v_ini::timestamp, least(hoje, v_fim + 30)::timestamp, interval '1 day') g loop
      perform public.metrics_snapshot(d);
    end loop;
  end if;
  -- Resumo diário dos eventos (20260928a), se existir: +1 dia porque a visita
  -- de 30 minutos pode atravessar a meia-noite.
  if to_regprocedure('public.events_rollup(date)') is not null then
    for d in select g::date from generate_series(v_ini::timestamp, (v_fim + 1)::timestamp, interval '1 day') g loop
      perform public.events_rollup(d);
    end loop;
  end if;
end $$;

-- ── 4) Relatório: cada dia da série que mudou, antes × depois ──────────────
select m.day as dia,
       a.mau as mau_antes, (m.data->>'mau')::int as mau_depois,
       a.pageviews as pageviews_antes, (m.data->>'pageviews')::int as pageviews_depois,
       (select count(*) from public.robos_retro r
         where (r.primeira at time zone 'America/Sao_Paulo')::date = m.day) as navegadores_marcados
from public.metrics_daily m
join _serie_antes a using (day)
where a.mau is distinct from (m.data->>'mau')::int
   or a.pageviews is distinct from (m.data->>'pageviews')::int
order by m.day;

-- Conferir depois de aplicar:
--   select count(*), min(primeira), max(primeira) from public.robos_retro;
--   select motivo, count(*) from public.robos_retro group by 1;
-- E, no /admin › Visão geral › Crescimento, o platô de julho/agosto sai da
-- curva; em Técnico › Qualidade, esses dias passam a aparecer como robô.
