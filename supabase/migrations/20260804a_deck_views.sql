-- Visitas por DECK publicado — o sinal que faltava pro "Em destaque" da galeria
-- ser destaque de verdade (antes era só o mais recente, porque não havia como
-- ordenar por popularidade).
--
-- Espelha o card_views (migration card_views_and_find_sellers + o throttle da
-- 20260723a), pelas mesmas razões:
--   * leitura PÚBLICA: a galeria é aberta a visitante sem conta;
--   * escrita SÓ pela RPC (security definer), nunca por insert direto: senão
--     qualquer um escreveria qualquer contagem;
--   * throttle por IP na RPC + throttle de 1 view/deck/sessão no cliente.
--
-- Aplicar no SQL Editor (ver README desta pasta). Enquanto não aplicada, a
-- galeria degrada sozinha: sem a tabela/RPC o fetch dá 404, as visitas ficam
-- zeradas e o destaque volta a ser o primeiro da ordem escolhida.

-- ── Tabela ───────────────────────────────────────────────────────────────────
-- share_id referencia shares(id): deck apagado leva a contagem com ele (o
-- histórico de visita de um deck que não existe mais não serve pra nada).
create table if not exists public.deck_views (
  share_id uuid primary key references public.shares (id) on delete cascade,
  views bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.deck_views enable row level security;

-- Leitura pública; escrita direta NEGADA (não existe policy de insert/update,
-- e a RPC abaixo é security definer, então ela passa por cima da RLS).
drop policy if exists "deck_views public read" on public.deck_views;
create policy "deck_views public read" on public.deck_views for select using (true);

-- Índice pra "mais vistos": a galeria pede os N maiores.
create index if not exists deck_views_views_idx on public.deck_views (views desc);

-- ── RPC de incremento ────────────────────────────────────────────────────────
-- _rate_ok já existe (criada na 20260723a) e limita por IP+bucket.
-- 60/min é folgado pra uso normal (uma pessoa não abre 60 decks por minuto) e
-- corta script de inflar contagem.
-- O insert só passa se o share EXISTE e é kind='deck': sem isso a tabela viraria
-- depósito de uuid inventado.
drop function if exists public.increment_deck_view(uuid);
create function public.increment_deck_view(p_share_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_share_id is null then return; end if;
  if not _rate_ok('deckview', 60) then return; end if;
  if not exists (select 1 from shares where id = p_share_id and kind = 'deck') then return; end if;
  insert into deck_views (share_id, views) values (p_share_id, 1)
  on conflict (share_id) do update
    set views = deck_views.views + 1, updated_at = now();
end $$;
grant execute on function public.increment_deck_view(uuid) to anon, authenticated;

-- ── Leitura em lote ──────────────────────────────────────────────────────────
-- A galeria lista até 60 decks e precisa da contagem de todos numa tacada. Um
-- select direto com `in.(...)` daria na mesma, mas a RPC deixa o contrato num
-- lugar só (e não expõe a tabela a filtro arbitrário).
-- STABLE: não escreve nada.
drop function if exists public.deck_views_for(uuid[]);
create function public.deck_views_for(p_ids uuid[])
returns table (share_id uuid, views bigint)
language sql stable security definer set search_path = public as $$
  select v.share_id, v.views
  from deck_views v
  where v.share_id = any (coalesce(p_ids, array[]::uuid[]))
  limit 200
$$;
grant execute on function public.deck_views_for(uuid[]) to anon, authenticated;
