-- Preço da Comunidade (plano em docs/COMMUNITY-PRICES.md) — a base de dados.
--
-- Um PONTO por usuário × carta × dimensões × mês. É o upsert pela PK que dá as
-- duas garantias centrais do desenho:
--   * DEDUPE: editar o preço substitui o próprio ponto, nunca acumula;
--   * 1 USUÁRIO = 1 VOTO por carta/mês — manipular a mediana exigiria criar
--     contas, não clicar muitas vezes.
--
-- Privacidade (por que as regras são mais duras que no card_views/deck_views):
-- o valor vem de dado PRIVADO do usuário (preço manual, venda realizada).
--   * RLS ligada e SEM NENHUMA policy: nem SELECT — nem o próprio dono lê a
--     tabela crua pela API. Só as RPCs (security definer) tocam nela.
--   * a leitura agregada só devolve bucket com n >= 3: abaixo disso seria
--     (a) estatística ruim e (b) o preço de 1-2 pessoas exposto.
--   * escrita exige login (anon não contribui — também corta spam).
--
-- Degrada sozinho: sem a migração aplicada as RPCs dão 404, o cliente engole e
-- o card simplesmente não mostra o bloco Comunidade.

create table if not exists public.community_prices (
  user_id    uuid not null,
  game       text not null,
  card_id    text not null,
  variant    text not null,
  cond       text not null,             -- NM/SP/... (vocabulário do site)
  kind       text not null,             -- 'listed' (cadastrado) | 'sold' (venda)
  company    text not null default '',  -- graded: psa/bgs/cgc/sgc/tag ('' = raw)
  grade      text not null default '',  -- graded: "10", "9.5"... ('' = raw)
  month      date not null,             -- bucket mensal (1º dia do mês)
  value_brl  numeric(12,2) not null,    -- normalizado em BRL na ESCRITA (cliente converte)
  updated_at timestamptz not null default now(),
  primary key (user_id, game, card_id, variant, cond, kind, company, grade, month)
);

alter table public.community_prices enable row level security;
-- (sem policies de propósito — ver cabeçalho)

-- A leitura agregada filtra por (game, card_id); a PK não começa por eles.
create index if not exists community_prices_card_idx
  on public.community_prices (game, card_id);

-- ── Escrita ──────────────────────────────────────────────────────────────────
-- Validações no MESMO espírito do increment_card_view: whitelist de jogo, regex
-- do id, clamp de valor, _rate_ok (throttle por IP, criado na 20260723a).
drop function if exists public.contribute_price(text, text, text, text, text, text, text, numeric);
create function public.contribute_price(
  p_game text, p_card_id text, p_variant text, p_cond text,
  p_kind text, p_company text, p_grade text, p_value_brl numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if auth.uid() is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','magic','fab','gundam','dbfw','ygo','digimon','riftbound','naruto','hxh','jump'])) then return; end if;
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
grant execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) to authenticated;
-- SEM grant pra anon, de propósito: contribuição exige conta.

-- ── Leitura agregada ─────────────────────────────────────────────────────────
-- Tudo de uma carta numa chamada (o card abre com UMA RPC). Devolve MEDIANA
-- (o que a UI exibe como "preço da comunidade" — robusta a troll e a dedo
-- gordo) e média APARADA (corta topo/fundo 10% quando n >= 10) pra depuração/
-- comparação. Bucket só sai com n >= 3 (ver cabeçalho).
drop function if exists public.community_price_for(text, text);
create function public.community_price_for(p_game text, p_card_id text)
returns table (variant text, cond text, kind text, company text, grade text, month date, n int, median numeric, avg_trimmed numeric)
language sql stable security definer set search_path = public as $$
  with pts as (
    select variant, cond, kind, company, grade, month, value_brl,
           percent_rank() over (partition by variant, cond, kind, company, grade, month order by value_brl) as pr,
           count(*)       over (partition by variant, cond, kind, company, grade, month) as nn
    from community_prices
    where game = p_game and card_id = p_card_id
  )
  select variant, cond, kind, company, grade, month,
         max(nn)::int as n,
         round((percentile_cont(0.5) within group (order by value_brl))::numeric, 2) as median,
         round((avg(value_brl) filter (where nn < 10 or (pr >= 0.1 and pr <= 0.9)))::numeric, 2) as avg_trimmed
  from pts
  group by variant, cond, kind, company, grade, month
  having max(nn) >= 3
  order by month desc
  limit 500
$$;
grant execute on function public.community_price_for(text, text) to anon, authenticated;

-- ============================================================================
-- Verificação (depois de aplicar):
--
--   # leitura anônima do agregado: deve responder [] (não 404)
--   curl -s -X POST "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/community_price_for" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"magic","p_card_id":"mtg-2x2-1"}'
--
--   # contribuição ANÔNIMA: 404/permissão negada (grant é só authenticated)
--   curl -s -X POST "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/contribute_price" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"magic","p_card_id":"mtg-2x2-1","p_variant":"Normal","p_cond":"NM","p_kind":"listed","p_company":"","p_grade":"","p_value_brl":10}'
--
--   # tabela crua: SELECT deve ser negado até logado (RLS sem policy)
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/community_prices?select=value_brl&limit=1" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
-- ============================================================================
