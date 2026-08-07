-- ============================================================================
-- Migração aditiva: libera o slug `unionarena` (Union Arena, TCGCSV cat. 81)
-- nas whitelists de jogo do banco. Aplicar no SQL Editor do Supabase (projeto
-- dlnalopazitfdgnmdguu).
--
-- Agora são DUAS famílias de whitelist — a 20260724a só precisava mexer na
-- primeira, e é fácil esquecer a segunda:
--   1. card_views + increment_card_view  (20260723a/20260724a)
--   2. contribute_price                  (20260807a — Preço da Comunidade)
-- Sem isto, no Union Arena a view de carta e a contribuição de preço são
-- rejeitadas EM SILÊNCIO (as funções só dão `return`), sem erro nenhum na tela.
-- ============================================================================

-- 1) CHECK de jogos válidos do card_views (dropa só o(s) CHECK que mencionam
--    `game`, como a 20260723a/20260724a).
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
  check (game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','jump']));

-- increment_card_view: mesma whitelist na validação de entrada.
create or replace function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','jump'])) then return; end if;
  if p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then return; end if;
  if not _rate_ok('cardview', 120) then return; end if;
  insert into card_views (game, card_id, views) values (p_game, p_card_id, 1)
  on conflict (game, card_id) do update set views = card_views.views + 1;
end $$;
grant execute on function public.increment_card_view(text, text) to anon, authenticated;

-- 2) contribute_price (Preço da Comunidade). Corpo IDÊNTICO ao da 20260807a —
--    só a lista de jogos muda.
create or replace function public.contribute_price(
  p_game text, p_card_id text, p_variant text, p_cond text,
  p_kind text, p_company text, p_grade text, p_value_brl numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if auth.uid() is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','jump'])) then return; end if;
  if p_card_id is null or p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then return; end if;
  if p_variant is null or length(p_variant) < 1 or length(p_variant) > 40 then return; end if;
  if p_cond is null or p_cond !~ '^[A-Za-z0-9 +-]{1,12}$' then return; end if;
  if not (p_kind = any (array['listed','sold'])) then return; end if;
  if not (coalesce(p_company, '') = any (array['','psa','bgs','cgc','sgc','tag'])) then return; end if;
  if coalesce(p_grade, '') !~ '^([0-9]{1,2}(\.[0-9])?)?$' then return; end if;
  v := round(p_value_brl, 2);
  if v is null or v <= 0 or v > 1000000 then return; end if;
  if not _rate_ok('commprice', 60) then return; end if;
  insert into community_prices (user_id, game, card_id, variant, cond, kind, company, grade, month, value_brl)
  values (auth.uid(), p_game, p_card_id, p_variant, p_cond, p_kind, coalesce(p_company, ''), coalesce(p_grade, ''), date_trunc('month', now())::date, v)
  on conflict (user_id, game, card_id, variant, cond, kind, company, grade, month)
  do update set value_brl = excluded.value_brl, updated_at = now();
end $$;

-- Reafirma o fechamento da 20260807b. `create or replace` PRESERVA a ACL da
-- função existente, então em produção isto é redundante — mas num banco onde a
-- função nascesse aqui ela viria com EXECUTE pra PUBLIC (a armadilha que a
-- 20260807b documentou). Repetir é barato; descobrir de novo, não.
revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from public;
revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from anon;
grant  execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verificação (depois de aplicar):
--
--   # 1) view de carta do Union Arena: 204 e a linha aparece em card_views.
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/increment_card_view" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"unionarena","p_card_id":"ua-576966"}'
--
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/card_views?game=eq.unionarena&select=card_id,views" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # 2) contribuição anônima segue 404 (o fechamento da 20260807b continua de pé)
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/contribute_price" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"unionarena","p_card_id":"ua-576966","p_variant":"Normal","p_cond":"NM","p_kind":"listed","p_company":"","p_grade":"","p_value_brl":10}'
-- ============================================================================
