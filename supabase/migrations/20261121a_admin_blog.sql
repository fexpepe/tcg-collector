-- ============================================================================
-- 20261121a — /admin: o BLOG post por post (Conteúdo › Blog).
--
-- POR QUE: em 2026-11-21 o Fernando perguntou se dá pra saber quantas pessoas
-- abriram cada post do blog, de onde vieram e que tipo de post rende mais,
-- pra decidir o que escrever. Não dava: o `path` do evento é o 1º segmento do
-- endereço (analyticsPath), então /blog (a lista) e /blog/<post> viravam o
-- mesmo "blog" — o painel sabia quanta gente passou pelo blog e nada de QUAL
-- post. Por URL só existia no Cloudflare Web Analytics, que não cruza com
-- nada daqui (canal da visita, tempo de leitura, o que a pessoa fez depois).
--
-- O QUE MUDA: desde este deploy o cliente (mandaEvento, src/shared.js) manda
-- em props.bp, em todo evento de uma página de post, o que vem depois de
-- /blog/ no endereço: "<post>" na versão original e "<idioma>/<post>" na
-- tradução (/blog/en/<post>). Esta migração cria a `admin_blog(days)`, que lê
-- isso junto da tabela `posts` (título, categoria, jogo, assuntos):
--   - 'posts': TODO post publicado, com leitores (navegadores) e leituras
--     (páginas) nos dois períodos, quantas visitas COMEÇARAM nele, quantos
--     leitores seguiram pra fora do blog na mesma visita, o tempo mediano com
--     a aba à vista, as cartas marcadas e os cliques em loja feitos na página
--     do post, e quantos criaram conta depois de ler. Post sem leitura vem
--     com zero: o que ninguém abre também é resposta;
--   - 'categorias', 'jogos' e 'tags': o mesmo por TIPO de post, com quantos
--     posts publicados cada um tem (leitura por post é a régua justa: a
--     categoria com dez posts soma mais que a com dois);
--   - 'canais', 'origens', 'post_canal' e 'post_origem': de onde veio a
--     VISITA em que o post foi lido (a 1ª página dela: busca, rede social,
--     IA, campanha, outro site, direto), no blog inteiro e por post. A
--     origem é o domínio de onde veio ou, no link com etiqueta, "fonte /
--     campanha" (utm_source / utm_campaign);
--   - 'paises', 'aparelhos' e 'versoes' (o idioma da versão lida);
--   - 'lista': quem abriu a lista /blog e quantos deles abriram um post;
--   - 'serie': leitores e leituras por dia;
--   - 'atual' e 'anterior': os totais SEM somar os posts (quem leu dois posts
--     é um leitor só);
--   - 'desde': o 1º evento com bp na janela (horário de Brasília), e
--     'comparavel': se o período anterior inteiro já tinha o post gravado (a
--     mesma régua das linhas na admin_jogos). Antes disso, a comparação com o
--     período anterior não diz nada.
--
-- Só conta o endereço que É de um post publicado: o bp vem do cliente, e o
-- que não casa com um `slug` da tabela (endereço errado, rascunho aberto pelo
-- editor) fica de fora. A barra no fim e o prefixo de idioma são tirados
-- aqui, não no cliente (o shared.js vive no teto de peso).
--
-- SEM HISTÓRICO: o evento antigo não guardou o post e não há como
-- reconstruir. A leitura de antes do deploy (e a de quem ainda roda o JS
-- velho em cache) continua contada só como "blog" nas abas de Páginas.
--
-- O guard (events_guard, a cópia da 20261110a) não muda: ele não filtra as
-- chaves de props, só o tamanho (4 KB), então o bp já entra hoje. Por isso é
-- ADITIVA e sem ordem com o JS: o JS antes desta = o bp chega e ninguém lê (a
-- aba Blog avisa "aplique a 20261121a"); esta antes do JS = tudo zerado.
-- Aplicada depois, ela lê o bp de tudo que chegou desde o deploy, na janela.
-- Pode aplicar duas vezes.
--
-- Só lê a janela (2 × days), numa passada só em events, com
-- `statement_timeout = 30s` como as outras RPCs novas.
--
-- REGRA de sempre: nenhum cifrão dentro de corpo de função (o SQL Editor do
-- Supabase se perde, 24/09/2026). Fim de texto em regex é \Z.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select proname, proconfig from pg_proc where proname = 'admin_blog';  -- 1 linha, statement_timeout=30s
--   -- uns minutos depois de abrir um post do blog no site (com a medição ligada
--   -- e num navegador que não seja o da equipe):
--   select props->>'bp' as post, name, count(*) from events
--    where path = 'blog' and ts > now() - interval '1 hour' group by 1, 2 order by 3 desc;
-- ============================================================================

create or replace function public.admin_blog(days int default 30)
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

  with bruto as (
    select ts, name, anon, coalesce(nullif(path, ''), '?') as path, coalesce(props, '{}'::jsonb) as props,
           (ts at time zone 'America/Sao_Paulo')::date as dia,
           case when ts >= ini then 'a' when ts < ant_fim then 'b' end as jan
    from events
    where not bot and ts >= ant and anon is not null
      and name in ('pageview', 'page_time', 'card_added', 'store_click', 'signup')
  ),
  -- Só quem passou pelo blog na janela: o resto do site não entra nas contas
  -- de visita (é o que deixa a RPC leve com o blog pequeno e o site grande).
  quem as (select distinct anon from bruto where name = 'pageview' and path = 'blog'),
  -- O post do evento: props.bp é "<post>" ou "<idioma>/<post>", como veio do
  -- endereço. Sai a barra do fim e o prefixo de idioma; o ->> só acha a chave
  -- em props OBJETO (número e lista, que o guard deixa entrar, ficam sem post).
  cru as (
    select b.*,
           case when b.path = 'blog' then nullif(left(regexp_replace(coalesce(b.props->>'bp', ''), '/+\Z', ''), 120), '') end as bp
    from bruto b join quem q on q.anon = b.anon
  ),
  pub as (
    select slug, title, category, coalesce(nullif(game, ''), '(geral)') as jogo, tags, lang, reading_min, published_at
    from posts where status = 'published' and published_at <= now()
  ),
  -- `slug` só quando o endereço é de um post publicado (o bp vem do cliente).
  ev as (
    select c.ts, c.name, c.anon, c.path, c.props, c.dia, c.jan, c.bp,
           p.slug, p.category, p.jogo, p.tags,
           case when p.slug is null then null when c.bp ~ '^(pt|en|es)/' then left(c.bp, 2) else p.lang end as versao
    from cru c
    left join pub p on p.slug = case when c.bp ~ '^(pt|en|es)/' then substr(c.bp, 4) else c.bp end
  ),
  -- Visitas (30 min sem página = visita nova), como na admin_paginas, só que
  -- entre quem passou pelo blog. Em cada página: a posição na visita, a 1ª
  -- página dela (de onde a visita veio) e o que veio DEPOIS.
  m as (
    select *, case when lag(ts) over w is null or ts - lag(ts) over w > interval '30 minutes' then 1 else 0 end as nova
    from ev where name = 'pageview' window w as (partition by anon order by ts)
  ),
  s as (select *, sum(nova) over (partition by anon order by ts rows unbounded preceding) as sid from m),
  s2 as (
    select *,
      row_number() over (partition by anon, sid order by ts) as pos,
      first_value(props) over (partition by anon, sid order by ts) as p0,
      count(*) filter (where path <> 'blog') over (partition by anon, sid order by ts rows between 1 following and unbounded following) as fora_depois,
      lead(slug) over (partition by anon, sid order by ts) as prox_slug
    from s
  ),
  -- Cada leitura de post (uma página de post publicada), com o canal e a
  -- origem da VISITA em que ela aconteceu.
  lidas as (
    select anon, ts, dia, jan, slug, category, jogo, tags, versao, props, pos, fora_depois,
           _canal(p0->>'r', p0->>'u') as canal,
           -- Link com etiqueta: "fonte / campanha" (utm_source / utm_campaign),
           -- que é o que separa uma publicação da outra na mesma rede.
           case when coalesce(p0->>'u', '') <> ''
                  then left(p0->>'u', 40) || case when coalesce(p0->>'c', '') <> '' then ' / ' || left(p0->>'c', 40) else '' end
                when coalesce(p0->>'r', '') <> '' then left(p0->>'r', 60)
                else '(direto)' end as origem
    from s2 where slug is not null and jan is not null
  ),
  por as (
    select slug, jan,
      count(distinct anon)::int as leitores,
      count(*)::int as leituras,
      count(*) filter (where pos = 1)::int as entradas,
      count(distinct anon) filter (where fora_depois > 0)::int as seguiram
    from lidas group by 1, 2
  ),
  -- Tempo de cada leitor no post (soma do período, com o teto de 30 min por
  -- página esquecida aberta) e a mediana entre os leitores.
  tempo_leitor as (
    select slug, jan, anon, sum(least(_int(props->>'ms'), 1800000)) as ms
    from ev where name = 'page_time' and slug is not null and jan is not null
    group by 1, 2, 3
  ),
  tempo as (
    select slug, jan, round(percentile_cont(0.5) within group (order by ms))::bigint as tempo_ms
    from tempo_leitor group by 1, 2
  ),
  -- O que foi feito NA página do post: carta marcada (Tenho) e clique em loja.
  acoes as (
    select slug, jan,
      coalesce(sum(least(_int(props->>'n'), 100000)) filter (where name = 'card_added'), 0)::bigint as cartas,
      count(*) filter (where name = 'store_click')::int as lojas
    from ev where slug is not null and jan is not null and name in ('card_added', 'store_click')
    group by 1, 2
  ),
  -- Conta criada DEPOIS da 1ª leitura do post, no mesmo período.
  primeira as (select slug, jan, anon, min(ts) as t0 from lidas group by 1, 2, 3),
  contas as (select anon, jan, ts from ev where name = 'signup' and jan is not null),
  cad as (
    select p.slug, p.jan, count(distinct p.anon)::int as cadastros
    from primeira p join contas c on c.anon = p.anon and c.jan = p.jan and c.ts >= p.t0
    group by 1, 2
  ),
  linhas as (
    select p.slug, p.title, p.category, p.jogo, p.lang, p.reading_min, to_jsonb(p.tags) as tags,
      to_char(p.published_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as publicado,
      coalesce(a.leitores, 0) as leitores, coalesce(b.leitores, 0) as leitores_ant,
      coalesce(a.leituras, 0) as leituras, coalesce(b.leituras, 0) as leituras_ant,
      coalesce(a.entradas, 0) as entradas, coalesce(a.seguiram, 0) as seguiram,
      ta.tempo_ms,
      coalesce(ac.cartas, 0) as cartas, coalesce(ac.lojas, 0) as lojas,
      coalesce(ca.cadastros, 0) as cadastros
    from pub p
    left join por a on a.slug = p.slug and a.jan = 'a'
    left join por b on b.slug = p.slug and b.jan = 'b'
    left join tempo ta on ta.slug = p.slug and ta.jan = 'a'
    left join acoes ac on ac.slug = p.slug and ac.jan = 'a'
    left join cad ca on ca.slug = p.slug and ca.jan = 'a'
  ),
  -- Totais SEM somar os posts: quem leu dois posts é um leitor só.
  totais as (
    select j.jan,
      (select count(distinct anon) from lidas l where l.jan = j.jan)::int as leitores,
      (select count(*) from lidas l where l.jan = j.jan)::int as leituras,
      (select count(*) from lidas l where l.jan = j.jan and l.pos = 1)::int as entradas,
      (select count(distinct anon) from lidas l where l.jan = j.jan and l.fora_depois > 0)::int as seguiram,
      (select count(distinct slug) from lidas l where l.jan = j.jan)::int as posts_lidos,
      (select count(distinct x.anon) from (select anon, jan, min(t0) as t0 from primeira group by 1, 2) x
         join contas c on c.anon = x.anon and c.jan = x.jan and c.ts >= x.t0
        where x.jan = j.jan)::int as cadastros,
      (select round(percentile_cont(0.5) within group (order by t.ms))::bigint
         from (select anon, sum(ms) as ms from tempo_leitor tl where tl.jan = j.jan group by 1) t) as tempo_ms,
      (select coalesce(sum(cartas), 0) from acoes ac where ac.jan = j.jan)::bigint as cartas,
      (select coalesce(sum(lojas), 0) from acoes ac where ac.jan = j.jan)::int as lojas
    from (values ('a'), ('b')) j(jan)
  ),
  desde_x as (select min(ts) as desde from ev where bp is not null),
  -- A lista /blog: página do blog SEM post. Só a partir do 1º evento com
  -- post gravado — antes disso a página de post também chegava sem ele e
  -- entraria aqui como lista.
  lista as (
    select count(distinct anon)::int as visitantes,
           count(distinct anon) filter (where prox_slug is not null)::int as abriram
    from s2
    where jan = 'a' and path = 'blog' and bp is null and ts >= (select desde from desde_x)
  ),
  canais as (
    select canal, count(distinct anon)::int as leitores, count(*)::int as leituras,
           count(distinct anon) filter (where fora_depois > 0)::int as seguiram
    from lidas where jan = 'a' group by 1
  ),
  origens as (
    select origem, canal, count(distinct anon)::int as leitores, count(*)::int as leituras
    from lidas where jan = 'a' group by 1, 2 order by 3 desc, 4 desc, 1 limit 20
  ),
  post_canal as (select slug, canal, count(distinct anon)::int as n from lidas where jan = 'a' group by 1, 2),
  post_origem as (
    select slug, origem, canal, n from (
      select slug, origem, canal, count(distinct anon)::int as n,
             row_number() over (partition by slug order by count(distinct anon) desc, origem) as rk
      from lidas where jan = 'a' group by 1, 2, 3
    ) t where rk <= 5
  ),
  paises as (
    select upper(props->>'co') as co, count(distinct anon)::int as leitores
    from lidas where jan = 'a' and props->>'co' ~ '^[A-Za-z][A-Za-z]\Z'
    group by 1 order by 2 desc, 1 limit 15
  ),
  aparelhos as (
    select case when props->>'d' in ('m', 'd') then props->>'d' else '?' end as k, count(distinct anon)::int as leitores
    from lidas where jan = 'a' group by 1
  ),
  versoes as (
    select versao as lang, count(distinct anon)::int as leitores, count(*)::int as leituras
    from lidas where jan = 'a' group by 1
  ),
  -- Por TIPO de post. `posts` = quantos publicados existem no tipo (a régua
  -- de "leituras por post" é do painel); tipo sem leitura entra com zero.
  categorias as (
    select p.k, p.posts, coalesce(l.leitores, 0) as leitores, coalesce(l.leituras, 0) as leituras,
           coalesce(l.seguiram, 0) as seguiram, coalesce(lb.leitores, 0) as leitores_ant
    from (select category as k, count(*)::int as posts from pub group by 1) p
    left join (select category as k, count(distinct anon)::int as leitores, count(*)::int as leituras,
                      count(distinct anon) filter (where fora_depois > 0)::int as seguiram
               from lidas where jan = 'a' group by 1) l using (k)
    left join (select category as k, count(distinct anon)::int as leitores from lidas where jan = 'b' group by 1) lb using (k)
  ),
  jogos as (
    select p.k, p.posts, coalesce(l.leitores, 0) as leitores, coalesce(l.leituras, 0) as leituras,
           coalesce(l.seguiram, 0) as seguiram, coalesce(lb.leitores, 0) as leitores_ant
    from (select jogo as k, count(*)::int as posts from pub group by 1) p
    left join (select jogo as k, count(distinct anon)::int as leitores, count(*)::int as leituras,
                      count(distinct anon) filter (where fora_depois > 0)::int as seguiram
               from lidas where jan = 'a' group by 1) l using (k)
    left join (select jogo as k, count(distinct anon)::int as leitores from lidas where jan = 'b' group by 1) lb using (k)
  ),
  tags as (
    select p.k, p.posts, coalesce(l.leitores, 0) as leitores, coalesce(l.leituras, 0) as leituras
    from (select left(t, 40) as k, count(*)::int as posts from pub, unnest(tags) t group by 1) p
    left join (select left(t, 40) as k, count(distinct anon)::int as leitores, count(*)::int as leituras
               from lidas, unnest(tags) t where jan = 'a' group by 1) l using (k)
    order by 3 desc, 4 desc, 1 limit 30
  ),
  serie as (
    select dia, count(distinct anon)::int as leitores, count(*)::int as leituras
    from lidas where jan = 'a' group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', d,
    'migration', '20261121a',
    'desde', (select to_char(x.desde at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') from desde_x x),
    -- O período anterior só compara se o post já era gravado desde o começo
    -- dele (o 1º evento da janela cai no 1º dia e meio).
    'comparavel', (select coalesce(x.desde < ant + interval '36 hours', false) from desde_x x),
    'publicados', (select count(*) from pub),
    'atual', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'a'),
    'anterior', (select to_jsonb(t) - 'jan' from totais t where t.jan = 'b'),
    'lista', (select to_jsonb(l) from lista l),
    'posts', (select coalesce(jsonb_agg(to_jsonb(l) order by l.leitores desc, l.leituras desc, l.publicado desc, l.slug), '[]'::jsonb)
      from (select * from linhas order by leitores desc, leituras desc, publicado desc, slug limit 500) l),
    'categorias', (select coalesce(jsonb_agg(to_jsonb(c) order by c.leitores desc, c.leituras desc, c.k), '[]'::jsonb) from categorias c),
    'jogos', (select coalesce(jsonb_agg(to_jsonb(j) order by j.leitores desc, j.leituras desc, j.k), '[]'::jsonb) from jogos j),
    'tags', (select coalesce(jsonb_agg(to_jsonb(t) order by t.leitores desc, t.leituras desc, t.k), '[]'::jsonb) from tags t),
    'canais', (select coalesce(jsonb_agg(to_jsonb(c) order by c.leitores desc, c.canal), '[]'::jsonb) from canais c),
    'origens', (select coalesce(jsonb_agg(to_jsonb(o) order by o.leitores desc, o.leituras desc, o.origem), '[]'::jsonb) from origens o),
    'post_canal', (select coalesce(jsonb_agg(to_jsonb(c) order by c.slug, c.n desc, c.canal), '[]'::jsonb) from post_canal c),
    'post_origem', (select coalesce(jsonb_agg(to_jsonb(o) order by o.slug, o.n desc, o.origem), '[]'::jsonb) from post_origem o),
    'paises', (select coalesce(jsonb_agg(to_jsonb(p) order by p.leitores desc, p.co), '[]'::jsonb) from paises p),
    'aparelhos', (select coalesce(jsonb_agg(to_jsonb(a) order by a.leitores desc, a.k), '[]'::jsonb) from aparelhos a),
    'versoes', (select coalesce(jsonb_agg(to_jsonb(v) order by v.leitores desc, v.lang), '[]'::jsonb) from versoes v),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(s.dia, 'YYYY-MM-DD'), 'leitores', s.leitores, 'leituras', s.leituras) order by s.dia), '[]'::jsonb) from serie s)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_blog(int) from public, anon;
grant execute on function public.admin_blog(int) to authenticated;
