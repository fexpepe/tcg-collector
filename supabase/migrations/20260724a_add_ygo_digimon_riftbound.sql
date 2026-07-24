-- ============================================================================
-- Migração aditiva: libera os slugs dos 3 jogos novos (Yu-Gi-Oh!, Digimon,
-- Riftbound) na whitelist de card_views / increment_card_view. A 20260723a já
-- foi aplicada, então este arquivo só ESTENDE a lista — sem ele, as views de
-- carta desses jogos são rejeitadas em silêncio (increment_card_view valida o
-- jogo). Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu).
-- ============================================================================

-- Recria o CHECK de jogos válidos do card_views com os 3 novos (dropa só o(s)
-- CHECK que mencionam `game`, como a 20260723a).
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
  check (game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','naruto','hxh','jump']));

-- increment_card_view: mesma whitelist na validação de entrada.
create or replace function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','naruto','hxh','jump'])) then return; end if;
  if p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then return; end if;
  if not _rate_ok('cardview', 120) then return; end if;
  insert into card_views (game, card_id, views) values (p_game, p_card_id, 1)
  on conflict (game, card_id) do update set views = card_views.views + 1;
end $$;
grant execute on function public.increment_card_view(text, text) to anon, authenticated;
