-- ============================================================================
-- Migração aditiva: libera kind='deck' na tabela `shares`.
--
-- Sintoma: publicar deck falhava SEMPRE ("Não deu pra publicar agora"), em toda
-- conta e em todo jogo. A galeria da comunidade estava no ar desde 6d09ca0 mas
-- nunca recebeu um deck: `shares?kind=eq.deck` volta [] enquanto
-- kind=eq.collection e kind=eq.binder trazem linhas normalmente.
--
-- Causa: o CHECK da coluna `kind` foi criado quando só existiam dois tipos de
-- compartilhamento (collection e binder). O construtor de decks passou a
-- inserir kind='deck' e bate no CHECK — o PostgREST devolve 400 e o
-- createShare do shared.js transformava isso no aviso genérico.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu).
-- ============================================================================

-- Dropa o(s) CHECK que restringem `kind` (mesmo padrão da 20260724a: descobre
-- pelo catálogo em vez de chutar o nome da constraint).
do $$
declare con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.shares'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.shares drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.shares add constraint shares_kind_check
  check (kind = any (array['collection', 'binder', 'deck']));

-- ============================================================================
-- Verificação (depois de aplicar, logado no site): publicar um deck deve
-- devolver um link. Pelo terminal, a listagem pública passa a trazer linhas:
--
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?kind=eq.deck&select=id,game,title&limit=5" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
-- O RLS de `shares` já cobre o tipo novo (as policies são por user_id, não por
-- kind), então não há nada a mudar em permissão.
-- ============================================================================
