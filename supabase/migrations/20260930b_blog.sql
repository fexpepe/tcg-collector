-- ============================================================================
-- Blog (2026-09-30) — docs/BLOG.md
--
-- POR QUE: o Sleevu ganha uma área de artigos (/blog), com posts escritos e
-- editados pelo próprio site (/blog-editor), sem commit. A página publicada é
-- montada na borda (functions/blog/[slug].js) a partir desta tabela, então
-- publicar é instantâneo e o Google recebe o HTML pronto.
--
-- QUEM ESCREVE: um papel PRÓPRIO, `blog_editores`, desconectado do is_admin
-- (pedido do Fernando): dá pra entregar o blog a outra pessoa sem que ela veja
-- o /admin, e o admin não vira editor por tabela. Tabela e não coluna em
-- `profiles` pelos mesmos dois motivos da `apoiadores` (20260928c): `profiles`
-- só tem linha pra quem escolheu um @, e a policy de UPDATE dela é "dono
-- edita a própria linha" — cada coluna sensível ali precisaria de um trigger
-- de guarda. Aqui a tabela nasce TRANCADA: nenhum privilégio pela API; quem
-- entra e quem sai é decidido no SQL Editor.
--
--   Pôr alguém:
--     insert into public.blog_editores (user_id, nome)
--     select id, 'Nome que assina os posts' from auth.users
--      where email = 'pessoa@exemplo.com';
--   Tirar:
--     delete from public.blog_editores
--      where user_id = (select id from auth.users where email = 'pessoa@exemplo.com');
--
-- A semente lá embaixo põe a conta do dono (hoje a única com is_admin). É o
-- ÚNICO ponto em que os dois papéis se tocam: depois dela, tirar o admin não
-- tira o blog e vice-versa, e nenhuma policy daqui olha o is_admin.
--
-- O que faz:
--   1) `blog_editores` + is_blog_editor() (usada pelas policies) e blog_me()
--      (o editor pergunta "sou editor?" e recebe o nome que assina).
--   2) `posts`: rascunho/publicado, publicação agendada (published_at no
--      futuro = ainda não aparece), SEO, capa, jogo, categoria, tags. O
--      trigger calcula o que o cliente não deve decidir: card_refs (as cartas
--      citadas no corpo, pro "aparece nestes artigos"), tempo de leitura,
--      updated_at e a data da primeira publicação.
--   3) `post_revisions`: a versão ANTERIOR de título+corpo a cada salvamento
--      (as 40 mais novas por post), pra desfazer pelo editor.
--   4) `post_redirects`: trocar o endereço de um post já publicado guarda o
--      antigo, e a borda responde 301 pro novo — link compartilhado e página
--      indexada não morrem.
--   5) bucket `blog-media` no Storage: leitura pública (capas e imagens do
--      corpo), escrita só de editor. É curadoria de quem escreve o blog, não
--      upload de usuário (o veto de foto por carta/slab continua de pé).
--
-- ADITIVA e SEM ORDEM com o JS: antes de aplicada, /blog mostra "nenhum post
-- ainda" (a tabela dá 404 e a borda trata como lista vazia) e o /blog-editor
-- avisa "aplique a 20260930b".
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select count(*) from public.blog_editores;                          -- 1 (o dono)
--   select to_regclass('public.posts'), to_regclass('public.post_revisions');
--   select public, file_size_limit from storage.buckets where id = 'blog-media'; -- t | 5242880
-- E, logado no site: /blog-editor abre a lista (vazia) em vez do aviso.
-- ============================================================================

-- ── 1) Quem escreve ─────────────────────────────────────────────────────────
create table if not exists public.blog_editores (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Nome que assina os posts (pré-preenche o campo "Autor" do editor; cada
  -- post guarda o seu, então trocar aqui não reescreve os antigos).
  nome       text not null default '' check (length(nome) <= 80),
  created_at timestamptz not null default now()
);
alter table public.blog_editores enable row level security;
revoke all on public.blog_editores from public, anon, authenticated;

-- SECURITY DEFINER porque a tabela acima é ilegível pela API: é a função que
-- olha lá dentro, e só pela conta da própria requisição (auth.uid()).
create or replace function public.is_blog_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blog_editores where user_id = auth.uid())
$$;
revoke all on function public.is_blog_editor() from public, anon;
grant execute on function public.is_blog_editor() to authenticated;

-- null = não é editor. O editor chama pelo adminRpc do shared.js — mesma
-- convenção de 404 = migração pendente.
create or replace function public.blog_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', nome) from blog_editores where user_id = auth.uid()
$$;
revoke all on function public.blog_me() from public, anon;
grant execute on function public.blog_me() to authenticated;

-- ── 2) Posts ────────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  -- Endereço: /blog/<slug>. Só minúscula, dígito e hífen simples — a borda
  -- confia no formato pra montar a URL canônica.
  slug         text not null unique
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 100),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  title        text not null default '' check (length(title) <= 200),
  subtitle     text not null default '' check (length(subtitle) <= 300),
  excerpt      text not null default '' check (length(excerpt) <= 400),
  body_md      text not null default '' check (length(body_md) <= 200000),
  -- Capa: só https (o Storage do blog ou outro host liberado na CSP).
  cover_url    text not null default '' check (cover_url = '' or cover_url ~ '^https://[^\s"<>]+$'),
  cover_alt    text not null default '' check (length(cover_alt) <= 300),
  -- '' = assunto geral. Formato, e não lista de jogos: jogo novo não pede
  -- migração aqui (as listas de jogo do banco já são duas — ver 20260924a).
  game         text not null default '' check (game = '' or game ~ '^[a-z0-9]{2,20}$'),
  -- Mesma lógica: as categorias vivem no front (src/i18n-blog.js).
  category     text not null default 'guias' check (category ~ '^[a-z]{3,20}$'),
  tags         text[] not null default '{}'
               check (cardinality(tags) <= 12 and length(array_to_string(tags, ',')) <= 400),
  lang         text not null default 'pt' check (lang in ('pt', 'en', 'es')),
  featured     boolean not null default false,
  seo_title    text not null default '' check (length(seo_title) <= 120),
  seo_desc     text not null default '' check (length(seo_desc) <= 320),
  author_name  text not null default '' check (length(author_name) <= 80),
  -- Calculados pelo trigger (o que vier do cliente é ignorado).
  card_refs    text[] not null default '{}',
  reading_min  int not null default 1,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A lista pública ordena pelos publicados mais novos; o "aparece nestes
-- artigos" da carta procura por card_refs @> '{jogo/id}'.
create index if not exists posts_publicados_idx on public.posts (published_at desc) where status = 'published';
create index if not exists posts_card_refs_idx on public.posts using gin (card_refs);

create or replace function public.posts_before_write()
returns trigger language plpgsql set search_path = public as $$
declare
  palavras int;
begin
  new.slug := lower(new.slug);
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;

  -- Cartas citadas: ::card[jogo/id] e ::cards[jogo/id, jogo/id, …] SOZINHOS
  -- na linha — a mesma regra do src/blog-render.js, que só desenha o bloco
  -- assim (a sintaxe citada no meio de uma frase não é carta). `+` e não
  -- `{1,N}`: o regex do Postgres recusa repetição acima de 255 ("invalid
  -- repetition count"), e o teto real já é o do body_md.
  select coalesce(array_agg(distinct ref order by ref), '{}')
    into new.card_refs
    from (
      select btrim(item) as ref
        from regexp_matches(new.body_md, '(?:^|\n)[ \t]*::cards?\[([^\]\n]+)\][ \t]*(?=\r?\n|\Z)', 'g') as m,
             unnest(string_to_array(m[1], ',')) as item
    ) s
   where ref ~ '^[a-z0-9]{2,20}/[A-Za-z0-9._:-]{1,80}\Z';
  if cardinality(new.card_refs) > 300 then
    new.card_refs := new.card_refs[1:300];
  end if;

  -- ~220 palavras por minuto; nunca menos de 1.
  palavras := coalesce(array_length(regexp_split_to_array(btrim(new.body_md), '\s+'), 1), 0);
  new.reading_min := greatest(1, round(palavras / 220.0)::int);

  -- Primeira publicação carimba a data. Despublicar e publicar de novo mantém
  -- a data original (o editor pode trocá-la à mão, inclusive pro futuro).
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;

drop trigger if exists posts_before_write on public.posts;
create trigger posts_before_write before insert or update on public.posts
  for each row execute function public.posts_before_write();

alter table public.posts enable row level security;
-- Visitante (e conta comum) só lê o que já está no ar. A data no futuro é o
-- agendamento: o post aparece sozinho quando ela passa, sem ninguém publicar.
drop policy if exists posts_leitura_publica on public.posts;
create policy posts_leitura_publica on public.posts for select to anon, authenticated
  using (status = 'published' and published_at is not null and published_at <= now());
-- Editor lê tudo (rascunhos e agendados) e escreve. `(select …)` faz o
-- Postgres avaliar a função uma vez por consulta, não uma por linha.
drop policy if exists posts_editor_le on public.posts;
create policy posts_editor_le on public.posts for select to authenticated
  using ((select public.is_blog_editor()));
drop policy if exists posts_editor_cria on public.posts;
create policy posts_editor_cria on public.posts for insert to authenticated
  with check ((select public.is_blog_editor()));
drop policy if exists posts_editor_altera on public.posts;
create policy posts_editor_altera on public.posts for update to authenticated
  using ((select public.is_blog_editor())) with check ((select public.is_blog_editor()));
drop policy if exists posts_editor_apaga on public.posts;
create policy posts_editor_apaga on public.posts for delete to authenticated
  using ((select public.is_blog_editor()));
-- TRUNCATE passa por cima da RLS: nenhum papel da API precisa dele.
revoke insert, update, delete on public.posts from anon;
revoke truncate on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

-- ── 3) Histórico ────────────────────────────────────────────────────────────
create table if not exists public.post_revisions (
  id       bigint generated always as identity primary key,
  post_id  uuid not null references public.posts (id) on delete cascade,
  saved_at timestamptz not null default now(),
  saved_by uuid default auth.uid(),
  title    text not null default '',
  body_md  text not null default ''
);
create index if not exists post_revisions_post_idx on public.post_revisions (post_id, saved_at desc);
alter table public.post_revisions enable row level security;
revoke all on public.post_revisions from public, anon, authenticated;
grant select on public.post_revisions to authenticated;
drop policy if exists post_revisions_editor_le on public.post_revisions;
create policy post_revisions_editor_le on public.post_revisions for select to authenticated
  using ((select public.is_blog_editor()));

-- ── 4) Endereço antigo → novo ───────────────────────────────────────────────
create table if not exists public.post_redirects (
  old_slug   text primary key,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.post_redirects enable row level security;
revoke all on public.post_redirects from public, anon, authenticated;
grant select on public.post_redirects to anon, authenticated;
drop policy if exists post_redirects_leitura on public.post_redirects;
create policy post_redirects_leitura on public.post_redirects for select to anon, authenticated
  using (true);

-- Depois de gravar: histórico e redirecionamento. SECURITY DEFINER porque as
-- duas tabelas não aceitam escrita pela API — só este trigger escreve nelas.
create or replace function public.posts_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.title is distinct from new.title or old.body_md is distinct from new.body_md then
      insert into post_revisions (post_id, title, body_md) values (old.id, old.title, old.body_md);
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

drop trigger if exists posts_after_write on public.posts;
create trigger posts_after_write after insert or update on public.posts
  for each row execute function public.posts_after_write();

-- ── 5) Imagens ──────────────────────────────────────────────────────────────
-- 5 MB por arquivo; o editor já reduz pra WebP de até 1600 px antes de subir
-- (uma capa sai com ~150-300 KB), então o teto só barra engano.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-media', 'blog-media', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Bucket público: a leitura do arquivo pela URL pública não passa por policy.
-- A de SELECT abaixo é a LISTAGEM (a galeria de imagens do editor).
drop policy if exists blog_media_editor_le on storage.objects;
create policy blog_media_editor_le on storage.objects for select to authenticated
  using (bucket_id = 'blog-media' and (select public.is_blog_editor()));
drop policy if exists blog_media_editor_sobe on storage.objects;
create policy blog_media_editor_sobe on storage.objects for insert to authenticated
  with check (bucket_id = 'blog-media' and (select public.is_blog_editor()));
drop policy if exists blog_media_editor_troca on storage.objects;
create policy blog_media_editor_troca on storage.objects for update to authenticated
  using (bucket_id = 'blog-media' and (select public.is_blog_editor()))
  with check (bucket_id = 'blog-media' and (select public.is_blog_editor()));
drop policy if exists blog_media_editor_apaga on storage.objects;
create policy blog_media_editor_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'blog-media' and (select public.is_blog_editor()));

-- ── Semente: a conta do dono ────────────────────────────────────────────────
insert into public.blog_editores (user_id, nome)
select p.user_id, coalesce(nullif(p.display_name, ''), p.handle, '')
  from public.profiles p
 where p.is_admin
on conflict (user_id) do nothing;
