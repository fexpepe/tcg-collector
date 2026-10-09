-- ============================================================================
-- 20261009a — /admin v3: resumo com período anterior, páginas por ÁREA do
-- site, web × app (Android/iOS), marcos nos gráficos, números das lojas de
-- app e o contador de eventos que o guard descarta.
--
-- POR QUE (docs/PLANO-ANALYTICS-3.md tem a análise inteira):
--   1. Todo número do painel é um retrato SEM régua: "312 visitantes" não diz
--      se é bom ou ruim. A admin_pulso devolve o período atual e o anterior
--      do MESMO tamanho, cortado na mesma hora do dia (comparar hoje às 10h
--      com um dia inteiro dá queda falsa toda manhã), e a série dos dois.
--   2. O painel só via página por página (top 20 da admin_dashboard). Quem
--      quer saber se o CATÁLOGO segura gente ou se a COLEÇÃO é onde se fica
--      precisa da página agrupada por área, com entrada, saída e rejeição por
--      visita. A admin_paginas recebe o mapa página → área do próprio
--      admin.js (uma fonte só: área nova é uma linha no JS, não migração).
--   3. O app (Capacitor, Android e iOS) vai mandar eventos pelo mesmo cano.
--      O pageview ganha `pl` (android|ios) e `av` (versão do app) no cliente;
--      aqui a admin_plataformas separa web × app instalado (PWA) × Android ×
--      iOS e soma tudo, com retenção por plataforma e a adoção de versão.
--      Os números que só a loja tem (instalações, desinstalações, nota,
--      travamentos) entram em `app_store_daily`: à mão pelo painel, ou por um
--      robô futuro com chave (app_store_import, mesmo desenho do push).
--   4. O guard descarta CALADO (nome fora da lista, tamanho, ritmo) e nada
--      conta o que sumiu — foi assim que o search_hit ficou 16 dias sem
--      chegar sem ninguém saber por quê. Agora cada descarte soma em
--      `events_descartes` (dia × motivo × nome), lido em Técnico › Medição.
--   5. Marcos (campanha, deploy, lançamento, viralizou): uma data com um
--      texto, desenhada como linha vertical em todo gráfico de tempo. O pico
--      de 22–30/09 só se lê com "campanha paga" escrito em cima.
--   6. O utm_content (anúncio) e o tipo de clique pago (`k`) chegam desde
--      06/10 e nenhuma RPC lia: admin_anuncios compara peça contra peça.
--
-- O QUE MUDA NO events_guard: cópia fiel da 20261006a (whitelist, tetos,
-- limite por visitante, uid, robô) + o registro de cada descarte. ESTA
-- MIGRAÇÃO CONTÉM A 20261006a: aplicada esta, a 06a não precisa rodar — e
-- NÃO rode a 06a DEPOIS desta (ela tiraria o contador de descartes, sem
-- quebrar nada além disso).
--
-- ADITIVA e sem ordem com o JS: sem ela, as abas novas do /admin mostram o
-- aviso "aplique a 20261009a" e o resto do painel segue igual. Pode aplicar
-- duas vezes.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select proname from pg_proc where proname in ('admin_pulso', 'admin_paginas',
--     'admin_plataformas', 'admin_descartes', 'admin_notas', 'admin_anuncios') order by 1;  -- 6 linhas
--   select pg_get_functiondef('public.events_guard()'::regprocedure) ~ '_descarta' as conta_descartes; -- true
-- ============================================================================

-- ── 0) Plataforma de um pageview ────────────────────────────────────────────
-- App nativo (o shared.js manda pl=android|ios quando roda no Capacitor) >
-- app instalado da web (PWA, s=1) > navegador. Um navegador só é UMA
-- plataforma por pageview; por pessoa, a admin_plataformas escolhe a de maior
-- prioridade (no Android, a PWA e o Chrome dividem o mesmo localStorage).
create or replace function public._plat(p jsonb)
returns text language sql immutable as $$
  select case
    when p->>'pl' in ('android', 'ios') then p->>'pl'
    when p->>'s' = '1' then 'pwa'
    else 'web'
  end
$$;

-- ── 1) Eventos descartados pelo guard ───────────────────────────────────────
-- Um contador por dia × motivo × nome. Nome fora da lista vem do CLIENTE:
-- ganha linha própria só se parece nome de evento (minúsculas e _) e o dia
-- ainda tem menos de 20 nomes assim — é o que diz QUAL evento novo subiu no
-- JS antes da migração. O resto cai em '(outro)', com o último recusado em
-- `exemplo`: uma linha por nome inventado deixaria qualquer um encher a
-- tabela. Trancada pra API (RLS sem policy, sem grant).
create table if not exists public.events_descartes (
  dia     date        not null,
  motivo  text        not null,   -- lista | tamanho | ritmo | ritmo_ip
  nome    text        not null,
  n       int         not null default 0,
  exemplo text,
  ultimo  timestamptz not null default now(),
  primary key (dia, motivo, nome)
);
alter table public.events_descartes enable row level security;
revoke all on public.events_descartes from public, anon, authenticated;

-- Falha aqui NUNCA vira erro no insert: o evento já ia ser descartado, e a
-- contagem é só pra saber disso. (Variáveis com v_: `nome` sozinho seria
-- ambíguo com a coluna, o erro cairia no exception e nada contaria.)
create or replace function public._descarta(p_motivo text, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_dia     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nome    text := left(coalesce(p_nome, '?'), 40);
  v_exemplo text;
begin
  if p_motivo = 'lista' and (
       v_nome !~ '^[a-z][a-z0-9_]{2,29}\Z'
       or (not exists (select 1 from events_descartes d where d.dia = v_dia and d.motivo = 'lista' and d.nome = v_nome)
           and (select count(*) from events_descartes d where d.dia = v_dia and d.motivo = 'lista' and d.nome <> '(outro)') >= 20)) then
    v_exemplo := v_nome;
    v_nome := '(outro)';
  end if;
  insert into events_descartes as e (dia, motivo, nome, n, exemplo, ultimo)
  values (v_dia, p_motivo, v_nome, 1, v_exemplo, now())
  on conflict (dia, motivo, nome) do update
    set n = e.n + 1, exemplo = coalesce(excluded.exemplo, e.exemplo), ultimo = now();
exception when others then
  return;
end $$;
revoke all on function public._descarta(text, text) from public, anon, authenticated;

-- O guard: cópia fiel da 20261006a + o _descarta em cada saída.
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h  json;
  ua text;
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created',
    'scan_open', 'scan_done', 'card_added', 'collection_first', 'login_gate',
    'store_click', 'signup', 'search_empty', 'share_open', 'pwa_install',
    'ad_view', 'ad_click',
    'page_time', 'search_hit', 'onboard_state', 'exp_view', 'push_sent'
  ) then
    perform _descarta('lista', new.name);
    return null;
  end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then
    perform _descarta('tamanho', new.name);
    return null;
  end if;
  if pg_column_size(new.props) > 4096 then
    perform _descarta('tamanho', new.name);
    return null;
  end if;
  -- 60/min POR VISITANTE (anon) dentro do mesmo IP, e um teto de 600/min
  -- pro IP inteiro (o freio contra quem gira o anon pra fugir do limite).
  if not _rate_ok('events:' || left(coalesce(new.anon, ''), 64), 60) then
    perform _descarta('ritmo', new.name);
    return null;
  end if;
  if not _rate_ok('events', 600) then
    perform _descarta('ritmo_ip', new.name);
    return null;
  end if;

  new.uid := auth.uid();

  h  := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ua := coalesce(h->>'user-agent', '');
  new.bot := (
    ua = ''
    or ua ~* 'bot(/|;|\)|\s|\Z)'
    or ua ~* '(crawl|spider|slurp|headless|phantomjs|lighthouse|pagespeed|scrapy|python-requests|python/|aiohttp|httpx|curl/|wget/|go-http-client|java/|okhttp|libwww|facebookexternalhit|bytespider|perplexity|anthropic|openai|semrush|ahrefs|mj12|petalbot|uptimerobot|betteruptime|statuscake|pingdom|site24x7)'
    or coalesce(new.props->>'wd', '') = '1'
  );
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

-- ── 2) Marcos dos gráficos ──────────────────────────────────────────────────
create table if not exists public.admin_notas (
  id         bigserial primary key,
  dia        date        not null,
  texto      text        not null check (length(texto) between 1 and 80),
  tipo       text        not null default 'outro'
             check (tipo in ('campanha', 'deploy', 'lancamento', 'imprensa', 'problema', 'outro')),
  created_at timestamptz not null default now()
);
alter table public.admin_notas enable row level security;
revoke all on public.admin_notas from public, anon, authenticated;

create or replace function public.admin_notas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  return (select coalesce(jsonb_agg(row_to_json(x) order by x.dia desc, x.id desc), '[]'::jsonb) from (
    select id, dia, texto, tipo from admin_notas order by dia desc, id desc limit 500) x);
end $$;
revoke all on function public.admin_notas() from public, anon;
grant execute on function public.admin_notas() to authenticated;

create or replace function public.admin_nota_save(p_dia date, p_texto text, p_tipo text default 'outro')
returns bigint language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  if not _is_admin() then return null; end if;
  if p_dia is null or p_dia < date '2026-01-01' or p_dia > (now() at time zone 'America/Sao_Paulo')::date + 366 then return null; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then return null; end if;
  insert into admin_notas (dia, texto, tipo)
  values (p_dia, left(trim(p_texto), 80),
          case when p_tipo in ('campanha', 'deploy', 'lancamento', 'imprensa', 'problema') then p_tipo else 'outro' end)
  returning id into novo;
  return novo;
end $$;
revoke all on function public.admin_nota_save(date, text, text) from public, anon;
grant execute on function public.admin_nota_save(date, text, text) to authenticated;

create or replace function public.admin_nota_delete(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  delete from admin_notas where id = p_id;
  return found;
end $$;
revoke all on function public.admin_nota_delete(bigint) from public, anon;
grant execute on function public.admin_nota_delete(bigint) to authenticated;

-- ── 3) Números das lojas de app ─────────────────────────────────────────────
-- O que só o Play Console e o App Store Connect sabem: quem viu a página da
-- loja, quem instalou, quem desinstalou, aparelhos ativos, nota, avaliações
-- e a taxa de travamento (% das sessões). Fluxos (impressões, visitas,
-- instalações, desinstalações, avaliações novas) somam no período; estoques
-- (ativos, nota, travamentos) valem o último dia com dado — a conta é do
-- admin.js, aqui é um valor por dia × loja × métrica.
create table if not exists public.app_store_daily (
  dia        date    not null,
  loja       text    not null check (loja in ('play', 'appstore')),
  metrica    text    not null check (metrica in ('impressoes', 'visitas_loja', 'instalacoes', 'desinstalacoes',
                                                 'ativos', 'nota', 'avaliacoes', 'travamentos')),
  valor      numeric not null check (valor >= 0 and valor < 1e12),
  fonte      text    not null default 'painel' check (fonte in ('painel', 'robo')),
  updated_at timestamptz not null default now(),
  primary key (dia, loja, metrica)
);
alter table public.app_store_daily enable row level security;
revoke all on public.app_store_daily from public, anon, authenticated;

-- Grava (ou apaga, com valor nulo) UM número de UM dia. Do painel.
create or replace function public.admin_app_loja_save(p_dia date, p_loja text, p_metrica text, p_valor numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _is_admin() then return null; end if;
  if p_dia is null or p_dia < date '2026-01-01' or p_dia > (now() at time zone 'America/Sao_Paulo')::date then return false; end if;
  if p_loja not in ('play', 'appstore') or p_metrica not in ('impressoes', 'visitas_loja', 'instalacoes',
       'desinstalacoes', 'ativos', 'nota', 'avaliacoes', 'travamentos') then return false; end if;
  if p_valor is null then
    delete from app_store_daily where dia = p_dia and loja = p_loja and metrica = p_metrica;
    return true;
  end if;
  if p_valor < 0 or p_valor >= 1e12 or (p_metrica = 'nota' and p_valor > 5) or (p_metrica = 'travamentos' and p_valor > 100) then
    return false;
  end if;
  insert into app_store_daily (dia, loja, metrica, valor, fonte) values (p_dia, p_loja, p_metrica, p_valor, 'painel')
  on conflict (dia, loja, metrica) do update set valor = excluded.valor, fonte = 'painel', updated_at = now();
  return true;
end $$;
revoke all on function public.admin_app_loja_save(date, text, text, numeric) from public, anon;
grant execute on function public.admin_app_loja_save(date, text, text, numeric) to authenticated;

-- Robô futuro (GitHub Action lendo a API do Play Console / App Store
-- Connect): a credencial é uma chave cujo SHA-256 mora na tabela trancada,
-- o mesmo desenho do push_sender_key. Tabela vazia = ninguém importa.
-- Pra ligar (no SQL Editor, com a chave crua guardada só no GitHub Secret):
--   insert into public.app_store_robo values (encode(sha256(convert_to('<chave>', 'UTF8')), 'hex'));
create table if not exists public.app_store_robo (chave_sha256 text primary key);
alter table public.app_store_robo enable row level security;
revoke all on public.app_store_robo from public, anon, authenticated;

-- p_linhas = [{"dia":"2026-11-01","loja":"play","metrica":"instalacoes","valor":12}, …]
-- Devolve quantas linhas gravou (null = chave errada). Até 1.000 por chamada.
create or replace function public.app_store_import(p_key text, p_linhas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; x jsonb;
begin
  if p_key is null or not exists (select 1 from app_store_robo
       where chave_sha256 = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    return null;
  end if;
  if not _rate_ok('appstore', 30) then return null; end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then return 0; end if;
  for x in select value from jsonb_array_elements(p_linhas) limit 1000 loop
    begin
      if (x->>'loja') in ('play', 'appstore')
         and (x->>'metrica') in ('impressoes', 'visitas_loja', 'instalacoes', 'desinstalacoes', 'ativos', 'nota', 'avaliacoes', 'travamentos')
         and (x->>'dia') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z'
         and (x->>'valor') ~ '^[0-9]{1,11}(\.[0-9]{1,4})?\Z' then
        insert into app_store_daily (dia, loja, metrica, valor, fonte)
        values ((x->>'dia')::date, x->>'loja', x->>'metrica', (x->>'valor')::numeric, 'robo')
        on conflict (dia, loja, metrica) do update set valor = excluded.valor, fonte = 'robo', updated_at = now();
        n := n + 1;
      end if;
    exception when others then
      null;   -- linha ruim não derruba o lote
    end;
  end loop;
  return n;
end $$;
revoke all on function public.app_store_import(text, jsonb) from public;
grant execute on function public.app_store_import(text, jsonb) to anon, authenticated;

-- ── 4) Resumo com o período anterior (Visão geral › Resumo) ─────────────────
-- Atual = os `days` dias até agora (hoje incluso, parcial). Anterior = os
-- `days` dias imediatamente antes, cortados na MESMA hora do dia de agora:
-- às 10h, hoje tem 10h de dado, e o último dia do período anterior também.
-- A série diária cobre os dois períodos inteiros (2 × days dias, do mais
-- antigo pro de hoje) — o admin.js desenha o anterior como linha fantasma.
create or replace function public.admin_pulso(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
      (select count(*) from ev where ev.jan = j.jan and name = 'jserror')::int as erros,
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
      count(*) filter (where name = 'jserror')::int as erros,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas
    from ev group by dia
  ),
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
    'migration', '20261009a',
    'atual', (select to_jsonb(k) - 'jan' from kpi k where k.jan = 'a'),
    'anterior', (select to_jsonb(k) - 'jan' from kpi k where k.jan = 'b'),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(x.dia, 'YYYY-MM-DD'),
        'visitantes', coalesce(p.visitantes, 0), 'pageviews', coalesce(p.pageviews, 0), 'logados', coalesce(p.logados, 0),
        'visitas', coalesce(v.visitas, 0), 'ativacoes', coalesce(e.ativacoes, 0), 'cliques_loja', coalesce(e.cliques_loja, 0),
        'erros', coalesce(e.erros, 0), 'cartas', coalesce(e.cartas, 0), 'contas', coalesce(c.contas, 0)
      ) order by x.dia), '[]'::jsonb)
      from dias x left join pv_dia p using (dia) left join ev_dia e using (dia)
      left join vis_dia v using (dia) left join ct_dia c using (dia)),
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

-- ── 5) Páginas e áreas do site (grupo Páginas) ──────────────────────────────
-- p_areas = {"collection": "colecao", "sets": "catalogo", …} — o mapa vem do
-- admin.js (AREAS); página fora dele cai em 'outros'. Por visita (30 min):
-- entrada (1ª página), saída (última), rejeição (visita de uma página só que
-- entrou ali). Por área, visitantes DISTINTOS (não a soma das páginas: quem
-- viu Sets e Detalhe é uma pessoa no Catálogo).
create or replace function public.admin_paginas(days int default 30, p_areas jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d       int;
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  ini     timestamptz;
  ant     timestamptz;
  ant_fim timestamptz;
  areas   jsonb := case when jsonb_typeof(p_areas) = 'object' and pg_column_size(p_areas) <= 8192 then p_areas else '{}'::jsonb end;
  res     jsonb;
begin
  if not _is_admin() then return null; end if;
  d       := greatest(1, least(coalesce(days, 30), 365));
  ini     := (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant     := (hoje - (2 * d - 1))::timestamp at time zone 'America/Sao_Paulo';
  ant_fim := now() - make_interval(days => d);

  with pv as (
    select anon, uid, ts, coalesce(nullif(path, ''), '?') as path, coalesce(props, '{}'::jsonb) as props,
           (ts at time zone 'America/Sao_Paulo')::date as dia,
           case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
    from events where name = 'pageview' and not bot and anon is not null and ts >= ant
  ),
  pva as (
    select pv.*, coalesce(nullif(left(areas->>pv.path, 24), ''), 'outros') as area from pv
  ),
  m as (
    select *, case when lag(ts) over w is null or ts - lag(ts) over w > interval '30 minutes' then 1 else 0 end as nova
    from pva window w as (partition by anon order by ts)
  ),
  s as (select *, sum(nova) over (partition by anon order by ts rows unbounded preceding) as sid from m),
  s2 as (
    select *,
      row_number() over v as pos,
      count(*) over (partition by anon, sid) as tam,
      lead(area) over v as prox_area,
      first_value(props) over v as p0
    from s window v as (partition by anon, sid order by ts rows between unbounded preceding and unbounded following)
  ),
  a as (select * from s2 where jan = 'a'),
  b as (select * from s2 where jan = 'b'),
  tempo as (
    select coalesce(nullif(path, ''), '?') as path,
           round(percentile_cont(0.5) within group (order by least(_int(props->>'ms'), 1800000)))::bigint as mediana_ms,
           sum(least(_int(props->>'ms'), 1800000))::bigint as total_ms
    from events where name = 'page_time' and not bot and ts >= ini group by 1
  ),
  por_pag as (
    select path, max(area) as area,
      count(*)::int as views, count(distinct anon)::int as visitantes,
      count(*) filter (where pos = 1)::int as entradas,
      count(*) filter (where pos = tam)::int as saidas,
      count(*) filter (where tam = 1)::int as rejeicoes,
      count(distinct (anon, sid))::int as visitas,
      count(*) filter (where props->>'d' = 'm')::int as celular
    from a group by path
  ),
  pag_b as (select path, count(*)::int as views, count(distinct anon)::int as visitantes from b group by path),
  por_area as (
    select area,
      count(*)::int as views, count(distinct anon)::int as visitantes, count(distinct uid)::int as logados,
      count(*) filter (where pos = 1)::int as entradas,
      count(*) filter (where pos = tam)::int as saidas,
      count(*) filter (where tam = 1)::int as rejeicoes,
      count(distinct (anon, sid))::int as visitas,
      count(*) filter (where props->>'d' = 'm')::int as celular
    from a group by area
  ),
  area_b as (select area, count(*)::int as views, count(distinct anon)::int as visitantes from b group by area),
  -- Tempo por área = soma do tempo visível das páginas dela; o total é o
  -- que conta ("onde as horas vão"), a mediana por página fica na tabela.
  tempo_area as (
    select coalesce(nullif(left(areas->>t.path, 24), ''), 'outros') as area, sum(t.total_ms)::bigint as total_ms
    from tempo t group by 1
  ),
  -- Caminhos: da área de uma página pra área da próxima, na mesma visita.
  fluxo as (
    select area as de, coalesce(prox_area, '(saiu)') as para, count(*)::int as n from a group by 1, 2
  ),
  ent_canal as (
    select area, _canal(p0->>'r', p0->>'u') as canal, count(*)::int as n from a where pos = 1 group by 1, 2
  ),
  dia_area as (
    select dia, area, count(*)::int as views, count(distinct anon)::int as visitantes from a group by 1, 2
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'visitas', (select count(distinct (anon, sid)) from a),
    'visitantes', (select count(distinct anon) from a),
    'visitas_ant', (select count(distinct (anon, sid)) from b),
    'paginas', (select coalesce(jsonb_agg(row_to_json(x) order by x.views desc), '[]'::jsonb) from (
       select p.*, coalesce(pb.views, 0) as views_ant, coalesce(pb.visitantes, 0) as visitantes_ant,
              t.mediana_ms, t.total_ms
       from por_pag p left join pag_b pb using (path) left join tempo t using (path)) x),
    'areas', (select coalesce(jsonb_agg(row_to_json(x) order by x.views desc), '[]'::jsonb) from (
       select p.*, coalesce(ab.views, 0) as views_ant, coalesce(ab.visitantes, 0) as visitantes_ant, ta.total_ms
       from por_area p left join area_b ab using (area) left join tempo_area ta using (area)) x),
    'fluxo', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
       select * from fluxo order by n desc limit 80) x),
    'entradas_canal', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from ent_canal x),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(dia, 'YYYY-MM-DD'), 'area', area,
                'views', views, 'visitantes', visitantes) order by dia, area), '[]'::jsonb) from dia_area)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_paginas(int, jsonb) from public, anon;
grant execute on function public.admin_paginas(int, jsonb) to authenticated;

-- ── 6) Web × app (grupo App e plataformas) ──────────────────────────────────
-- Duas unidades, de propósito:
--   - por PAGEVIEW (páginas, visitantes, logados, a série por dia): cada
--     página conta na plataforma em que foi vista;
--   - por NAVEGADOR (ativações, cartas, cliques, erros, tempo, retenção):
--     cada navegador anônimo cai numa plataforma só, a de maior prioridade
--     que ele usou no período (ios > android > pwa > web). No app nativo o
--     localStorage é do app, então o anon de lá nunca se mistura com a web.
-- Soma web + app: navegadores distintos (cada aparelho conta uma vez) e
-- contas distintas — a conta logada em mais de uma plataforma aparece em
-- `contas_multi`, que é a ponte entre site e app.
create or replace function public.admin_plataformas(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini  timestamptz;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d   := greatest(1, least(coalesce(days, 30), 365));
  ini := (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo';

  with pv as (
    select anon, uid, ts, _plat(coalesce(props, '{}'::jsonb)) as pl, coalesce(props, '{}'::jsonb) as props,
           (ts at time zone 'America/Sao_Paulo')::date as dia
    from events where name = 'pageview' and not bot and ts >= ini
  ),
  pa as (
    select anon,
      case when bool_or(pl = 'ios') then 'ios' when bool_or(pl = 'android') then 'android'
           when bool_or(pl = 'pwa') then 'pwa' else 'web' end as pl,
      count(*) as views
    from pv where anon is not null group by anon
  ),
  ev as (
    select e.name, e.anon, e.ts, coalesce(e.props, '{}'::jsonb) as props, pa.pl
    from events e join pa using (anon)
    where not e.bot and e.ts >= ini
      and e.name in ('collection_first', 'card_added', 'store_click', 'jserror', 'page_time', 'signup', 'scan_open')
  ),
  primeira as (
    select anon, min(ts) as first_ts from events
    where name = 'pageview' and not bot and anon in (select anon from pa) group by anon
  ),
  pt as (
    select anon, pl, ts, least(_int(props->>'ms'), 1800000) as ms,
      case when lag(ts) over w is null or ts - lag(ts) over w > interval '30 minutes' then 1 else 0 end as nova
    from ev where name = 'page_time'
    window w as (partition by anon order by ts)
  ),
  pt_s as (select anon, pl, ms, sum(nova) over (partition by anon order by ts rows unbounded preceding) as sid from pt),
  visitas_t as (select anon, sid, max(pl) as pl, sum(ms) as ms from pt_s group by anon, sid),
  -- Retenção: quem chegou nos últimos 120 dias, pela plataforma da 1ª visita.
  coorte as (
    select anon, first_dia, pl from (
      select distinct on (anon) anon, (ts at time zone 'America/Sao_Paulo')::date as first_dia,
             _plat(coalesce(props, '{}'::jsonb)) as pl
      from events where name = 'pageview' and not bot and anon is not null
      order by anon, ts
    ) z where first_dia >= hoje - 120
  ),
  volta as (
    select c.anon,
      bool_or(x.dia - c.first_dia = 1) as d1,
      bool_or(x.dia - c.first_dia between 7 and 13) as d7
    from coorte c
    join (select distinct anon, (ts at time zone 'America/Sao_Paulo')::date as dia
          from events where name = 'pageview' and not bot and anon in (select anon from coorte)) x using (anon)
    group by c.anon
  ),
  ret as (
    select c.pl,
      count(*) filter (where hoje - c.first_dia >= 2)::int as el1,
      count(*) filter (where hoje - c.first_dia >= 2 and coalesce(v.d1, false))::int as d1,
      count(*) filter (where hoje - c.first_dia >= 14)::int as el7,
      count(*) filter (where hoje - c.first_dia >= 14 and coalesce(v.d7, false))::int as d7
    from coorte c left join volta v using (anon) group by c.pl
  ),
  por_pv as (
    select pl, count(*)::int as pageviews, count(distinct anon)::int as visitantes, count(distinct uid)::int as logados
    from pv group by pl
  ),
  por_nav as (
    select pa.pl, count(*)::int as navegadores, sum(pa.views)::int as pageviews_nav,
      count(*) filter (where f.first_ts >= ini)::int as novos
    from pa left join primeira f using (anon) group by pa.pl
  ),
  por_ev as (
    select pl,
      count(distinct anon) filter (where name = 'collection_first')::int as ativacoes,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas,
      count(*) filter (where name = 'store_click')::int as cliques_loja,
      count(*) filter (where name = 'jserror')::int as erros,
      count(*) filter (where name = 'signup')::int as contas,
      count(*) filter (where name = 'scan_open')::int as scans
    from ev group by pl
  ),
  por_tempo as (
    select pl, count(*)::int as visitas, round(percentile_cont(0.5) within group (order by ms))::bigint as tempo_ms
    from visitas_t group by pl
  ),
  plats as (select * from (values ('web', 1), ('pwa', 2), ('android', 3), ('ios', 4)) v(pl, ord)),
  versoes as (
    select pl, left(coalesce(nullif(props->>'av', ''), '?'), 20) as av,
      count(distinct anon)::int as navegadores, count(*)::int as pageviews,
      min(dia) as primeiro, max(dia) as ultimo
    from pv where pl in ('android', 'ios') group by 1, 2
  ),
  multi as (select uid from pv where uid is not null group by uid having count(distinct pl) >= 2)
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'plataformas', (select coalesce(jsonb_agg(jsonb_build_object(
        'pl', p.pl,
        'pageviews', coalesce(a.pageviews, 0), 'visitantes', coalesce(a.visitantes, 0), 'logados', coalesce(a.logados, 0),
        'navegadores', coalesce(n.navegadores, 0), 'pageviews_nav', coalesce(n.pageviews_nav, 0), 'novos', coalesce(n.novos, 0),
        'ativacoes', coalesce(e.ativacoes, 0), 'cartas', coalesce(e.cartas, 0), 'cliques_loja', coalesce(e.cliques_loja, 0),
        'erros', coalesce(e.erros, 0), 'contas', coalesce(e.contas, 0), 'scans', coalesce(e.scans, 0),
        'visitas', coalesce(t.visitas, 0), 'tempo_ms', t.tempo_ms,
        'el1', coalesce(r.el1, 0), 'd1', coalesce(r.d1, 0), 'el7', coalesce(r.el7, 0), 'd7', coalesce(r.d7, 0)
      ) order by p.ord), '[]'::jsonb)
      from plats p left join por_pv a using (pl) left join por_nav n using (pl) left join por_ev e using (pl)
      left join por_tempo t using (pl) left join ret r using (pl)),
    'total', jsonb_build_object(
      'navegadores', (select count(*) from pa),
      'pageviews', (select count(*) from pv),
      'contas', (select count(distinct uid) from pv where uid is not null),
      'contas_multi', (select count(*) from multi),
      'contas_app', (select count(distinct uid) from pv where uid is not null and pl in ('android', 'ios'))
    ),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(dia, 'YYYY-MM-DD'), 'pl', pl,
                'visitantes', visitantes, 'pageviews', pageviews) order by dia, pl), '[]'::jsonb) from (
       select dia, pl, count(distinct anon)::int as visitantes, count(*)::int as pageviews from pv group by 1, 2) x),
    'versoes', (select coalesce(jsonb_agg(row_to_json(v) order by v.ultimo desc, v.navegadores desc), '[]'::jsonb) from versoes v),
    'lojas', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(dia, 'YYYY-MM-DD'), 'loja', loja,
                'metrica', metrica, 'valor', valor, 'fonte', fonte) order by dia, loja, metrica), '[]'::jsonb)
              from app_store_daily where dia >= hoje - (d - 1)),
    'lojas_ultimo', (select max(dia) from app_store_daily)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_plataformas(int) from public, anon;
grant execute on function public.admin_plataformas(int) to authenticated;

-- ── 7) Medição: o que o guard descartou e o que chegou ──────────────────────
-- `recebidos` = cada nome que chegou no período (com o último): o admin.js
-- compara com a lista do que o site MANDA e acusa o nome que nunca chegou —
-- coisa que a _sentinela não vê (ela só olha nomes que já chegaram).
create or replace function public.admin_descartes(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  res  jsonb;
begin
  if not _is_admin() then return null; end if;
  d := greatest(1, least(coalesce(days, 30), 365));
  select jsonb_build_object(
    'days', d,
    'descartes', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
       select motivo, nome, sum(n)::int as n, max(ultimo) as ultimo,
              (array_agg(exemplo order by ultimo desc) filter (where exemplo is not null))[1] as exemplo
       from events_descartes where dia >= hoje - (d - 1) group by motivo, nome) x),
    'serie', (select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
       select to_char(dia, 'YYYY-MM-DD') as day, sum(n)::int as n from events_descartes
       where dia >= hoje - (d - 1) group by dia) x),
    'recebidos', (select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) from (
       select name as nome, count(*)::int as n, max(ts) as ultimo from events
       where ts >= (hoje - (d - 1))::timestamp at time zone 'America/Sao_Paulo' and not bot group by name) x),
    'desde', (select min(dia) from events_descartes)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_descartes(int) from public, anon;
grant execute on function public.admin_descartes(int) to authenticated;

-- ── 8) Anúncios (utm_content) e clique pago ─────────────────────────────────
-- Desde 06/10 o pageview leva `a` (utm_content, a PEÇA do anúncio) e `k` (o
-- nome do parâmetro de clique pago: gclid, gbraid, wbraid, fbclid). Nada
-- lia. Pela 1ª visita de cada navegador (como a admin_campaigns): quem cada
-- peça trouxe e o que essa gente fez depois.
create or replace function public.admin_anuncios()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not _is_admin() then return null; end if;
  return (
    with primeira as (
      select distinct on (anon) anon, (ts at time zone 'America/Sao_Paulo')::date as first_dia,
             lower(left(coalesce(props->>'u', ''), 30)) as fonte, lower(left(coalesce(props->>'c', ''), 30)) as campanha,
             lower(left(coalesce(props->>'a', ''), 30)) as anuncio, lower(left(coalesce(props->>'k', ''), 10)) as clique,
             coalesce(nullif(props->>'d', ''), '?') as dv
      from events where name = 'pageview' and not bot and anon is not null
      order by anon, ts
    ),
    vindos as (select * from primeira where anuncio <> '' or clique <> ''),
    acoes as (
      select e.anon,
        bool_or(e.name = 'collection_first') as ativou,
        bool_or(e.name = 'signup' or (e.name = 'pageview' and e.uid is not null)) as conta,
        bool_or(e.name = 'store_click') as loja,
        count(*) filter (where e.name = 'pageview') as views,
        bool_or(e.name = 'pageview' and (e.ts at time zone 'America/Sao_Paulo')::date - v.first_dia between 7 and 13) as d7
      from events e join vindos v using (anon) where not e.bot group by e.anon
    )
    select jsonb_build_object(
      'anuncios', (select coalesce(jsonb_agg(row_to_json(x) order by x.visitantes desc), '[]'::jsonb) from (
         select v.fonte, v.campanha, v.anuncio, count(*)::int as visitantes,
                count(*) filter (where v.dv = 'm')::int as celular,
                count(*) filter (where a.views >= 2)::int as engajados,
                count(*) filter (where a.ativou)::int as ativados,
                count(*) filter (where a.conta)::int as contas,
                count(*) filter (where a.loja)::int as loja,
                count(*) filter (where hoje - v.first_dia >= 14)::int as el7,
                count(*) filter (where hoje - v.first_dia >= 14 and a.d7)::int as d7,
                min(v.first_dia) as desde, max(v.first_dia) as ate
         from vindos v left join acoes a using (anon) where v.anuncio <> ''
         group by 1, 2, 3) x),
      'cliques', (select coalesce(jsonb_agg(row_to_json(x) order by x.visitantes desc), '[]'::jsonb) from (
         select v.clique, count(*)::int as visitantes, count(*) filter (where a.ativou)::int as ativados,
                count(*) filter (where a.conta)::int as contas
         from vindos v left join acoes a using (anon) where v.clique <> '' group by 1) x)
    )
  );
end $$;
revoke all on function public.admin_anuncios() from public, anon;
grant execute on function public.admin_anuncios() to authenticated;
