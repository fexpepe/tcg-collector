-- ============================================================================
-- Migração aditiva: libera os slugs `narutomythos` (NARUTO Mythos Trading Card
-- Game, Cicaboom, 2026) e `narutokayou` (as cartas do Naruto da Kayou, edição
-- em inglês, 2025) nas whitelists de jogo do banco. Aplicar no SQL Editor do
-- Supabase (projeto dlnalopazitfdgnmdguu).
--
-- Cópia da 20261111f (fftcg, já aplicada e conferida) com os dois slugs na
-- lista — só a lista muda. Os dois jogos entraram na mesma PR, então vão na
-- mesma migração (cada uma reescreve a lista INTEIRA; duas migrações em
-- paralelo se apagariam). As mesmas DUAS famílias de whitelist:
--   1. card_views + increment_card_view  (corpo da 20260923a, com a linha do
--      card_views_daily)
--   2. contribute_price                  (corpo da 20260807c)
-- Sem isto, nos jogos novos a view de carta e o Preço da Comunidade são
-- rejeitados EM SILÊNCIO (as funções só dão `return`). Depois desta, nem a
-- 20261111f nem as anteriores podem rodar de novo (tirariam os dois slugs das
-- duas listas).
--
-- A coleção NÃO depende desta migração: a tabela `collections` não tem
-- whitelist de jogo.
--
-- ATENÇÃO (2026-11-13): a 20261113a da PR #296 tem estes dois slugs MAIS o
-- `narutoboruto`. Se ela for aplicada, esta não precisa rodar, e NÃO pode rodar
-- depois dela (tiraria o `narutoboruto` das duas listas).
--
-- Conferir depois de aplicar: os `curl` no fim deste arquivo.
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
  check (game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','dbz','cdm','gcd','gw','narutocg','godzilla','palworld','fftcg','narutomythos','narutokayou','jump']));

-- increment_card_view: corpo IDÊNTICO ao da 20261111f (e das anteriores) — só a lista de jogos muda.
create or replace function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','dbz','cdm','gcd','gw','narutocg','godzilla','palworld','fftcg','narutomythos','narutokayou','jump'])) then return; end if;
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
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','swu','cyberpunk','sorcery','dbfw','ygo','digimon','riftbound','unionarena','naruto','hxh','dbc','wow','lotr','harrypotter','weiss','mbc','dbz','cdm','gcd','gw','narutocg','godzilla','palworld','fftcg','narutomythos','narutokayou','jump'])) then return; end if;
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
--   # 1) view de carta dos dois jogos: 204 E a linha aparece em card_views
--   #    com o game certo (204 sozinho não prova nada: jogo inválido também
--   #    devolve 204). nmy-s1e1-l133v1 é a Legendary do Naruto do Konoha
--   #    Shidō; nky-hs1-nrsa01-se-001l5, o Sasuke SE do Heaven Scroll 1.
--   curl -s -o /dev/null -w "%{http_code}
" -X POST --     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/increment_card_view" --     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" --     -d '{"p_game":"narutomythos","p_card_id":"nmy-s1e1-l133v1"}'
--
--   curl -s -o /dev/null -w "%{http_code}
" -X POST --     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/increment_card_view" --     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" --     -d '{"p_game":"narutokayou","p_card_id":"nky-hs1-nrsa01-se-001l5"}'
--
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/card_views?game=in.(narutomythos,narutokayou)&select=game,card_id,views" --     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # 2) contribuição anônima segue 401 (o fechamento da 20260807b continua de pé)
--   curl -s -o /dev/null -w "%{http_code}
" -X POST --     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/contribute_price" --     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" --     -d '{"p_game":"narutomythos","p_card_id":"nmy-s1e1-l133v1","p_variant":"Normal","p_cond":"NM","p_kind":"listed","p_company":"","p_grade":"","p_value_brl":10}'
-- ============================================================================
