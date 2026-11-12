-- ============================================================================
-- 20261112b — /admin: as LINHAS de cada jogo (Conteúdo › Jogos e o Resumo).
--
-- POR QUE: em 2026-11-12 o Fernando perguntou se a aba Jogos separa o Naruto
-- vintage e mostra o acesso real de cada jogo. O NARUTO CARD GAME de 2027 já
-- é jogo próprio (narutocg, desde 11/11), mas o jogo `naruto` junta quatro
-- jogos de verdade — o Card Game 2002~2006 (o principal), o Data Carddass
-- (nrt-dc), o CCG da Bandai US (nrt-ccg) e o 疾風伝 (nrt-scg) — e o evento só
-- guardava o JOGO da página. O `path` vira "sets"/"detail" (analyticsPath) e
-- a linha se perdia. O `onepiece` tem o mesmo caso (Carddass, opcd; Card
-- Game 2002, op2002).
--
-- O QUE MUDA: desde este deploy o cliente (mandaEvento, src/shared.js) manda
-- a linha da página em props.ln — só onde o ENDEREÇO diz a linha
-- (/games/<url>) e só nos jogos com linhas: a chave da linha, ou "" no jogo
-- principal. Esta migração refaz a `admin_jogos(days)` IGUAL à 20261111g e
-- acrescenta o recorte por linha:
--   - 'linhas': por jogo × linha, nos dois períodos — visitantes, páginas,
--     cartas cadastradas, quem cadastrou, quem interagiu, cliques em loja e o
--     tempo mediano. Só nos jogos que têm algum evento com ln na janela. O
--     que não tem ln (evento de antes do deploy, de quem ainda roda o JS
--     velho em cache, ou de página do jogo que não é de linha: scanner,
--     lançamentos) cai na linha '?', "sem linha registrada";
--   - 'linhas_desde': o 1º evento com ln na janela (horário de Brasília), e
--     'linhas_comparavel': se o período anterior inteiro já tinha linha (a
--     mesma régua do país na admin_geo). Antes disso, a régua contra o
--     período anterior não diz nada.
-- O clique em loja leva o jogo da CARTA (props.g); a linha só vale quando a
-- carta é do jogo da página — senão o ln é de outro jogo e vai pro '?'.
--
-- SEM HISTÓRICO: o evento antigo não guardou a linha e não há como
-- reconstruir (o `path` não tem o endereço). As cartas abertas
-- (card_views_daily) seguem só por jogo.
--
-- O guard (events_guard, a cópia da 20261110a) não muda: ele não filtra as
-- chaves de props, só o tamanho (4 KB), então o ln já entra hoje. Por isso
-- é ADITIVA e sem ordem com o JS: o JS antes desta = o ln chega e ninguém lê
-- (a aba Jogos avisa "aplique a 20261112b"); esta antes do JS = 'linhas'
-- vazio. Aplicada depois, ela lê o ln de tudo que chegou desde o deploy, na
-- janela. Pode aplicar duas vezes.
--
-- Só lê a janela (2 × days), numa passada só em events, e mantém o
-- `statement_timeout = 30s` da 20261111g.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026).
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select proname, proconfig from pg_proc where proname = 'admin_jogos';  -- 1 linha, statement_timeout=30s
--   select pg_get_functiondef('public.admin_jogos(int)'::regprocedure) ~ '20261112b' as tem_linhas;  -- true
--   -- uns minutos depois de uma visita a /games/naruto-ccg:
--   select props->>'ln' as linha, count(*) from events
--    where game = 'naruto' and ts > now() - interval '1 hour' group by 1 order by 2 desc;
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
    select ts, name, anon, uid, props, jogo, dia, jan,
           -- A linha da página (props.ln, desde 2026-11-12; "" = o jogo
           -- principal). No clique em loja, só quando a carta é do jogo da
           -- página. O ->> só acha a chave em props OBJETO: número e lista
           -- (o guard deixa entrar) ficam sem linha, sem erro.
           case when props->>'ln' is not null and (name <> 'store_click' or jogo = coalesce(nullif(game, ''), 'hub'))
                then left(props->>'ln', 16) end as linha
    from (
      select ts, name, anon, uid, game, coalesce(props, '{}'::jsonb) as props,
             -- O clique em loja diz o jogo da carta; o resto, o da página.
             case when name = 'store_click' and coalesce(props->>'g', '') <> '' then left(props->>'g', 32)
                  else coalesce(nullif(game, ''), 'hub') end as jogo,
             (ts at time zone 'America/Sao_Paulo')::date as dia,
             case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
      from events
      where not bot and ts >= ant
        and name in ('pageview', 'page_time', 'card_added', 'collection_first', 'scan_open', 'store_click',
                     'deck_created', 'import_done', 'export_done', 'share_created')
    ) e
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
  ),
  -- ── Por LINHA (20261112b) ────────────────────────────────────────────────
  -- Só os jogos com algum evento com ln na janela; dentro deles, o evento
  -- sem ln vira a linha '?' (antes do deploy, JS velho em cache, ou página
  -- do jogo que não é de linha). As mesmas réguas do recorte por jogo.
  evl as (
    select jogo, coalesce(linha, '?') as ln, jan, name, anon, props
    from ev
    where jan is not null and jogo in (select distinct jogo from ev where linha is not null)
  ),
  vis_l as (select distinct jogo, ln, jan, anon from evl where name = 'pageview' and anon is not null),
  fez_l as (
    select distinct jogo, ln, jan, anon from evl
    where anon is not null
      and name in ('card_added', 'collection_first', 'scan_open', 'store_click', 'deck_created',
                   'import_done', 'export_done', 'share_created')
  ),
  interagiu_l as (
    select v.jogo, v.ln, v.jan, count(*)::int as n
    from vis_l v join fez_l f on f.jogo = v.jogo and f.ln = v.ln and f.jan = v.jan and f.anon = v.anon
    group by 1, 2, 3
  ),
  por_l as (
    select jogo, ln, jan,
      count(distinct anon) filter (where name = 'pageview')::int as visitantes,
      count(*) filter (where name = 'pageview')::int as pageviews,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas,
      count(distinct anon) filter (where name = 'card_added')::int as cadastraram,
      count(*) filter (where name = 'store_click')::int as cliques_loja
    from evl
    group by 1, 2, 3
  ),
  tempo_l as (
    select jogo, ln, jan, round(percentile_cont(0.5) within group (order by ms))::bigint as tempo_ms
    from (
      select jogo, ln, jan, anon, sum(least(_int(props->>'ms'), 1800000)) as ms
      from evl where name = 'page_time' and anon is not null
      group by 1, 2, 3, 4
    ) t
    group by 1, 2, 3
  ),
  chaves_l as (select distinct jogo, ln from por_l),
  linhas_l as (
    select k.jogo as game, k.ln as linha,
      coalesce(a.visitantes, 0) as visitantes, coalesce(b.visitantes, 0) as visitantes_ant,
      coalesce(a.pageviews, 0) as pageviews, coalesce(b.pageviews, 0) as pageviews_ant,
      coalesce(a.cartas, 0) as cartas, coalesce(b.cartas, 0) as cartas_ant,
      coalesce(a.cadastraram, 0) as cadastraram,
      coalesce(ia.n, 0) as interagiram, coalesce(ib.n, 0) as interagiram_ant,
      coalesce(a.cliques_loja, 0) as cliques_loja, coalesce(b.cliques_loja, 0) as cliques_loja_ant,
      ta.tempo_ms
    from chaves_l k
    left join por_l a on a.jogo = k.jogo and a.ln = k.ln and a.jan = 'a'
    left join por_l b on b.jogo = k.jogo and b.ln = k.ln and b.jan = 'b'
    left join interagiu_l ia on ia.jogo = k.jogo and ia.ln = k.ln and ia.jan = 'a'
    left join interagiu_l ib on ib.jogo = k.jogo and ib.ln = k.ln and ib.jan = 'b'
    left join tempo_l ta on ta.jogo = k.jogo and ta.ln = k.ln and ta.jan = 'a'
  ),
  desde_l as (select min(ts) as desde from ev where linha is not null)
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'migration', '20261112b',
    'jogos', (select coalesce(jsonb_agg(to_jsonb(l) order by l.visitantes desc, l.cartas desc, l.abertas desc, l.game), '[]'::jsonb)
      from linhas l
      where l.visitantes + l.visitantes_ant + l.cartas + l.cartas_ant + l.abertas + l.abertas_ant + l.cliques_loja + l.cliques_loja_ant > 0),
    'atual', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'a'),
    'anterior', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'b'),
    'vias', (select coalesce(jsonb_agg(to_jsonb(v) order by v.game, v.cartas desc), '[]'::jsonb) from vias v),
    'topo_visitantes', (select coalesce(jsonb_agg(game), '[]'::jsonb) from (select game from linhas where visitantes > 0 order by visitantes desc, pageviews desc, game limit 6) t),
    'topo_cartas', (select coalesce(jsonb_agg(game), '[]'::jsonb) from (select game from linhas where cartas > 0 order by cartas desc, cadastraram desc, game limit 6) t),
    'serie_visitantes', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'game', s.game, 'n', s.n) order by s.dia, s.game), '[]'::jsonb) from serie_v s),
    'serie_cartas', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'game', s.game, 'n', s.n) order by s.dia, s.game), '[]'::jsonb) from serie_c s),
    'linhas', (select coalesce(jsonb_agg(to_jsonb(l) order by l.game, l.visitantes desc, l.cartas desc, l.linha), '[]'::jsonb)
      from linhas_l l
      where l.visitantes + l.visitantes_ant + l.cartas + l.cartas_ant + l.cliques_loja + l.cliques_loja_ant > 0),
    'linhas_desde', (select to_char(x.desde at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') from desde_l x),
    -- O período anterior só compara se a linha já era gravada desde o
    -- começo dele (o 1º evento da janela cai no 1º dia e meio).
    'linhas_comparavel', (select coalesce(x.desde < ant + interval '36 hours', false) from desde_l x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_jogos(int) from public, anon;
grant execute on function public.admin_jogos(int) to authenticated;
