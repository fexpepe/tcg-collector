-- ============================================================================
-- Blog: um post, três idiomas (2026-10-06) — docs/BLOG.md
--
-- POR QUE: o post nascia num idioma só (coluna `lang`) e a bandeirinha do site
-- não mexia nele. O Fernando quer o blog nas mesmas línguas do site (pt, en,
-- es), com o post acompanhando a bandeirinha. Antes, a mesma matéria em três
-- línguas seriam três posts soltos, os três na lista ao mesmo tempo.
--
-- COMO: o post continua sendo UMA linha. Os campos de sempre (title, body_md…)
-- são a versão no idioma ORIGINAL (`lang`), e `traducoes` guarda as outras:
--   { "en": { title, subtitle, excerpt, body_md, cover_alt, seo_title, seo_desc },
--     "es": { … } }
-- Endereço, capa, jogo, categoria, assuntos e datas são do post, não da
-- versão. Coluna e não tabela à parte: salvar continua sendo um PATCH só (a
-- trava otimista do editor por updated_at vale pras três versões juntas), a
-- RLS é a mesma e o histórico guarda as versões juntas.
--
-- O trigger (o mesmo da 20260930b, refeito aqui) passa a:
--   - limpar `traducoes`: só pt/en/es, nunca o idioma original, só os campos
--     acima, mesmos tetos das colunas, e versão sem título nem texto some;
--   - montar `versoes`, o resumo leve de cada tradução que a LISTA precisa
--     (título, linha fina, resumo, descrição da capa, tempo de leitura) —
--     a lista não baixa o texto inteiro das três versões;
--   - juntar em `card_refs` as cartas citadas em QUALQUER versão.
-- O histórico (post_revisions) passa a guardar `traducoes` junto.
--
-- Endereços (functions/blog/): /blog/<slug> é a versão original e
-- /blog/en/<slug>, /blog/es/<slug>, /blog/pt/<slug> as traduções, com hreflang
-- entre elas.
--
-- DEPENDE da 20260930b (aplicar ela antes, no mesmo SQL Editor). Aditiva e
-- idempotente: rodar de novo não estraga nada.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'posts'
--      and column_name in ('traducoes', 'versoes');                       -- 2 linhas
--   select column_name from information_schema.columns
--    where table_name = 'post_revisions' and column_name = 'traducoes';   -- 1 linha
-- ============================================================================

alter table public.posts add column if not exists traducoes jsonb not null default '{}'::jsonb;
-- Calculada pelo trigger (o que vier do cliente é ignorado), como card_refs.
alter table public.posts add column if not exists versoes jsonb not null default '{}'::jsonb;
alter table public.post_revisions add column if not exists traducoes jsonb not null default '{}'::jsonb;

create or replace function public.posts_before_write()
returns trigger language plpgsql set search_path = public as $$
declare
  palavras int;
  limpo jsonb := '{}'::jsonb;
  leve jsonb := '{}'::jsonb;
  idioma text;
  bruto jsonb;
  v jsonb;
  corpos text;
begin
  new.slug := lower(new.slug);
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;

  -- Traduções: só os idiomas do site, nunca o original (a versão original são
  -- as colunas), só os campos conhecidos e com os tetos das colunas. Chave
  -- estranha ou valor que não é objeto é ignorado; campo grande demais é erro
  -- 23514, o mesmo dos CHECKs (o editor já sabe explicar esse código).
  if new.traducoes is null or jsonb_typeof(new.traducoes) <> 'object' then
    new.traducoes := '{}'::jsonb;
  end if;
  for idioma, bruto in select key, value from jsonb_each(new.traducoes) loop
    if idioma not in ('pt', 'en', 'es') or idioma = new.lang or jsonb_typeof(bruto) <> 'object' then
      continue;
    end if;
    v := jsonb_build_object(
      'title',     coalesce(bruto->>'title', ''),
      'subtitle',  coalesce(bruto->>'subtitle', ''),
      'excerpt',   coalesce(bruto->>'excerpt', ''),
      'body_md',   coalesce(bruto->>'body_md', ''),
      'cover_alt', coalesce(bruto->>'cover_alt', ''),
      'seo_title', coalesce(bruto->>'seo_title', ''),
      'seo_desc',  coalesce(bruto->>'seo_desc', '')
    );
    if length(v->>'title') > 200 or length(v->>'subtitle') > 300 or length(v->>'excerpt') > 400
       or length(v->>'body_md') > 200000 or length(v->>'cover_alt') > 300
       or length(v->>'seo_title') > 120 or length(v->>'seo_desc') > 320 then
      raise exception 'tradução (%) com campo acima do limite', idioma using errcode = '23514';
    end if;
    -- Versão sem título e sem texto não é versão (aba aberta e largada).
    if btrim(v->>'title') = '' and btrim(v->>'body_md') = '' then
      continue;
    end if;
    limpo := limpo || jsonb_build_object(idioma, v);
    palavras := coalesce(array_length(regexp_split_to_array(btrim(v->>'body_md'), '\s+'), 1), 0);
    leve := leve || jsonb_build_object(idioma, jsonb_build_object(
      'title', v->'title', 'subtitle', v->'subtitle', 'excerpt', v->'excerpt', 'cover_alt', v->'cover_alt',
      'reading_min', greatest(1, round(palavras / 220.0)::int)
    ));
  end loop;
  new.traducoes := limpo;
  new.versoes := leve;

  -- Cartas citadas: ::card[jogo/id] e ::cards[jogo/id, jogo/id, …] SOZINHOS
  -- na linha — a mesma regra do src/blog-render.js, que só desenha o bloco
  -- assim (a sintaxe citada no meio de uma frase não é carta). Vale o texto
  -- de TODAS as versões (a tradução pode citar uma carta a mais). `+` e não
  -- `{1,N}`: o regex do Postgres recusa repetição acima de 255 ("invalid
  -- repetition count"), e o teto real já é o do body_md.
  -- Cada corpo começa numa linha nova (o \n na frente é o que separa).
  select new.body_md || coalesce(string_agg(E'\n' || (e.value->>'body_md'), '' order by e.key), '')
    into corpos
    from jsonb_each(new.traducoes) e;
  select coalesce(array_agg(distinct ref order by ref), '{}')
    into new.card_refs
    from (
      select btrim(item) as ref
        from regexp_matches(corpos, '(?:^|\n)[ \t]*::cards?\[([^\]\n]+)\][ \t]*(?=\r?\n|\Z)', 'g') as m,
             unnest(string_to_array(m[1], ',')) as item
    ) s
   where ref ~ '^[a-z0-9]{2,20}/[A-Za-z0-9._:-]{1,80}\Z';
  if cardinality(new.card_refs) > 300 then
    new.card_refs := new.card_refs[1:300];
  end if;

  -- ~220 palavras por minuto; nunca menos de 1. Da versão original (cada
  -- tradução tem o seu em `versoes`).
  palavras := coalesce(array_length(regexp_split_to_array(btrim(new.body_md), '\s+'), 1), 0);
  new.reading_min := greatest(1, round(palavras / 220.0)::int);

  -- Primeira publicação carimba a data. Despublicar e publicar de novo mantém
  -- a data original (o editor pode trocá-la à mão, inclusive pro futuro).
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;

-- Histórico: a versão ANTERIOR passa a levar as traduções junto (mexer só no
-- inglês também guarda uma versão).
create or replace function public.posts_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.title is distinct from new.title or old.body_md is distinct from new.body_md
       or old.traducoes is distinct from new.traducoes then
      insert into post_revisions (post_id, title, body_md, traducoes)
        values (old.id, old.title, old.body_md, coalesce(old.traducoes, '{}'::jsonb));
      delete from post_revisions
       where post_id = old.id
         and id not in (select id from post_revisions where post_id = old.id order by saved_at desc, id desc limit 40);
    end if;
    -- Só vale guardar o endereço antigo se ele chegou a ser público.
    if old.slug <> new.slug and old.published_at is not null then
      insert into post_redirects (old_slug, post_id) values (old.slug, new.id)
        on conflict (old_slug) do update set post_id = excluded.post_id, created_at = now();
    end if;
  end if;
  -- O endereço em uso não pode continuar sendo redirecionamento de outro post
  -- (post novo que reaproveita um endereço antigo, ou a volta pro original).
  delete from post_redirects where old_slug = new.slug;
  return null;
end $$;
revoke all on function public.posts_after_write() from public, anon, authenticated;
