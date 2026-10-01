-- ============================================================================
-- Migração aditiva: libera o slug `mbc` (Miracle Battle Carddass, Bandai
-- 2009–2015 — o crossover da Jump que virou jogo próprio em 2026-10-01) nas
-- whitelists de jogo do banco. Aplicar no SQL Editor do Supabase (projeto
-- dlnalopazitfdgnmdguu).
--
-- Cópia da 20261001d (Weiß Schwarz, já aplicada) com `mbc` na lista — as
-- mesmas DUAS famílias de whitelist:
--   1. card_views + increment_card_view  (corpo da 20260923a, com a linha do
--      card_views_daily)
--   2. contribute_price                  (corpo da 20260807c)
-- Sem isto, no Miracle Battle a view de carta é rejeitada EM SILÊNCIO (as
-- funções só dão `return`). O jogo é vintage, sem preço, então o Preço da
-- Comunidade quase não vai ser usado, mas a lista é uma só e anda junto.
--
-- As cartas do Miracle Battle que eram linha do One Piece, do Naruto e do HxH
-- mantêm o id (op-mb-*, nrt-mb-*, hxh-mb-*); as views antigas delas ficam nas
-- linhas onepiece/naruto/hxh do card_views e as novas contam no mbc. Nada a
-- migrar aqui: é contador de "mais vistas", recomeça no jogo novo.
--
-- Sem cifrão dentro dos corpos de função (lição da 20260923a): o editor do
-- Supabase se perde com `$` solto num corpo `$$…$$`. As âncoras de fim das
-- regex usam `\Z`, que no PostgreSQL casa só no fim da string.
-- ============================================================================

-- 1) CHECK de jogos válidos do card_views (dropa só o(s) CHECK que mencionam
--    `game`, como as anteriores).
do $$
declare con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.card_views'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%game%'
  loop
    execute format('alter table public.card_views drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.card_views add constraint card_views_game_check
  check (game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','jump']));

-- increment_card_view: corpo IDÊNTICO ao da 20261001d (e das anteriores) — só a lista de jogos muda.
create or replace function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','jump'])) then return; end if;
  if p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z' then return; end if;
  if not _rate_ok('cardview', 120) then return; end if;
  insert into card_views (game, card_id, views) values (p_game, p_card_id, 1)
  on conflict (game, card_id) do update set views = card_views.views + 1;
  insert into card_views_daily (game, card_id, day, views)
  values (p_game, p_card_id, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (game, card_id, day) do update set views = card_views_daily.views + 1;
end $$;
grant execute on function public.increment_card_view(text, text) to anon, authenticated;

-- 2) contribute_price (Preço da Comunidade). Corpo da 20260807c com a lista
--    de jogos nova e as âncoras `$` trocadas por `\Z`.
create or replace function public.contribute_price(
  p_game text, p_card_id text, p_variant text, p_cond text,
  p_kind text, p_company text, p_grade text, p_value_brl numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if auth.uid() is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','jump'])) then return; end if;
  if p_card_id is null or p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z' then return; end if;
  if p_variant is null or length(p_variant) < 1 or length(p_variant) > 40 then return; end if;
  if p_cond is null or p_cond !~ '^[A-Za-z0-9 +-]{1,12}\Z' then return; end if;
  if not (p_kind = any (array['listed','sold'])) then return; end if;
  if not (coalesce(p_company, '') = any (array['','psa','bgs','cgc','sgc','tag'])) then return; end if;
  if coalesce(p_grade, '') !~ '^([0-9]{1,2}(\.[0-9])?)?\Z' then return; end if;
  v := round(p_value_brl, 2);
  if v is null or v <= 0 or v > 1000000 then return; end if;
  if not _rate_ok('commprice', 60) then return; end if;
  insert into community_prices (user_id, game, card_id, variant, cond, kind, company, grade, month, value_brl)
  values (auth.uid(), p_game, p_card_id, p_variant, p_cond, p_kind, coalesce(p_company, ''), coalesce(p_grade, ''), date_trunc('month', now())::date, v)
  on conflict (user_id, game, card_id, variant, cond, kind, company, grade, month)
  do update set value_brl = excluded.value_brl, updated_at = now();
end $$;

-- Reafirma o fechamento da 20260807b (ver o comentário na 20260807c).
revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from public;
revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from anon;
grant  execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verificação (depois de aplicar):
--
--   # 1) view de carta do Miracle Battle (mb-db01-01, Mestre Kame do Dragon Ball
--   #    Kai): 204 E a linha aparece em card_views (204 sozinho não prova nada:
--   #    jogo inválido também devolve 204).
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/increment_card_view" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"mbc","p_card_id":"mb-db01-01"}'
--
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/card_views?game=eq.mbc&select=card_id,views" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # 2) contribuição anônima segue 401 (o fechamento da 20260807b continua de pé)
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/contribute_price" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"mbc","p_card_id":"mb-db01-01","p_variant":"Normal","p_cond":"NM","p_kind":"listed","p_company":"","p_grade":"","p_value_brl":10}'
-- ============================================================================
