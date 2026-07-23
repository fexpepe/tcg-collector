-- ============================================================================
-- Migração A (ADITIVA — pode aplicar a qualquer momento, antes do deploy do front)
--
-- 1) get_public_profile: leitura PONTUAL de perfil público por handle, pra
--    substituir o SELECT direto na tabela (que permite paginar/raspar todos os
--    perfis com a anon key). O front e a Pages Function já chamam esta RPC com
--    fallback pro SELECT direto enquanto ela não existir.
-- 2) find_sellers vira SECURITY DEFINER (hoje é INVOKER sobre public_profiles;
--    quando a migração B fechar a leitura pública da tabela, ele pararia de
--    enxergar as linhas). Só muda o contexto de execução — o corpo fica igual.
-- 3) Rate limiting server-side por IP (tabela rate_limits + _rate_ok) para as
--    escritas anônimas: events (trigger) e increment_card_view (recriada).
--    O throttle de sessionStorage no cliente é burlável por qualquer script.
-- 4) error_summary: agregado dos erros de JS (events name='jserror') pro /admin,
--    com o mesmo gate is_admin do analytics_summary.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu) ou via
-- `supabase db push`. Depois confira: os avisos do advisor sobre SECURITY
-- DEFINER nas funções novas são esperados (mesmo padrão das existentes).
-- ============================================================================

-- ── 1) Leitura pontual de perfil público ────────────────────────────────────
-- STABLE de propósito: permite chamar via GET no PostgREST (a Pages Function
-- usa GET pra manter o cache de borda do Cloudflare).
create or replace function public.get_public_profile(p_handle text)
returns table (handle text, display_name text, show_values boolean, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.handle, p.display_name, p.show_values, p.data, p.updated_at
  from public.public_profiles p
  where p_handle ~ '^[a-zA-Z0-9_]{3,24}$'
    and p.handle = lower(p_handle)
  limit 1
$$;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ── 2) find_sellers sobrevive ao lockdown da tabela ─────────────────────────
alter function public.find_sellers(text[]) security definer;
alter function public.find_sellers(text[]) set search_path = public;

-- ── 3) Rate limiting por IP ─────────────────────────────────────────────────
-- Contadores por (bucket, minuto). RLS ligada SEM policies = invisível via API;
-- só as funções SECURITY DEFINER abaixo tocam nela.
create table if not exists public.rate_limits (
  bucket text not null,
  minute timestamptz not null,
  hits   int  not null default 1,
  primary key (bucket, minute)
);
alter table public.rate_limits enable row level security;

-- IP do cliente a partir dos headers que o gateway do Supabase repassa ao
-- PostgREST. Cai em 'unknown' se não houver (ex.: SQL Editor) — nesse caso o
-- rate limit vira um teto global por minuto, ainda útil contra flood.
create or replace function public._client_ip()
returns text language plpgsql stable as $$
declare h json;
begin
  h := coalesce(current_setting('request.headers', true), '{}')::json;
  return coalesce(nullif(h->>'cf-connecting-ip', ''),
                  nullif(split_part(h->>'x-forwarded-for', ',', 1), ''),
                  'unknown');
exception when others then
  return 'unknown';
end $$;
revoke all on function public._client_ip() from public, anon, authenticated;

-- true = dentro do limite; false = estourou. Falha interna = true (fail-open:
-- infra quebrada não pode derrubar o produto). Limpeza oportunista (~1% das
-- chamadas) mantém a tabela pequena sem precisar de cron.
create or replace function public._rate_ok(p_scope text, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if random() < 0.01 then
    delete from rate_limits where minute < now() - interval '15 minutes';
  end if;
  insert into rate_limits (bucket, minute)
    values (p_scope || ':' || md5(_client_ip()), date_trunc('minute', now()))
    on conflict (bucket, minute) do update set hits = rate_limits.hits + 1
    returning hits into n;
  return n <= p_max;
exception when others then
  return true;
end $$;
revoke all on function public._rate_ok(text, int) from public, anon, authenticated;

-- Guard de INSERT em events: whitelist de nomes, caps de tamanho e 60/min por
-- IP. Inválido/estourou = descarta SILENCIOSAMENTE (return null) — analytics
-- nunca vira 4xx no cliente, e spam não infla DAU/MAU nem "cartas em alta".
create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or new.name not in ('pageview', 'jserror') then return null; end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then return null; end if;
  if pg_column_size(new.props) > 4096 then return null; end if;
  if not _rate_ok('events', 60) then return null; end if;
  return new;
end $$;
revoke all on function public.events_guard() from public, anon, authenticated;

drop trigger if exists events_guard on public.events;
create trigger events_guard before insert on public.events
  for each row execute function public.events_guard();

-- increment_card_view recriada com throttle server-side (120 views/min por IP)
-- além da validação de entrada. DROP+CREATE porque CREATE OR REPLACE não pode
-- mudar o tipo de retorno caso a atual retorne algo diferente de void.
drop function if exists public.increment_card_view(text, text);
create function public.increment_card_view(p_game text, p_card_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_card_id is null then return; end if;
  if not (p_game = any (array['pokemon','lorcana','onepiece','naruto','hxh','jump'])) then return; end if;
  if p_card_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then return; end if;
  if not _rate_ok('cardview', 120) then return; end if;
  insert into card_views (game, card_id, views) values (p_game, p_card_id, 1)
  on conflict (game, card_id) do update set views = card_views.views + 1;
end $$;
grant execute on function public.increment_card_view(text, text) to anon, authenticated;

-- ── 4) Erros de JS agregados pro /admin ─────────────────────────────────────
create or replace function public.error_summary(days int default 7)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then null
    else (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select props->>'m' as message,
               props->>'s' as source,
               count(*)::int as hits,
               count(distinct anon)::int as users,
               max(ts) as last_seen
        from events
        where name = 'jserror' and ts > now() - make_interval(days => days)
        group by 1, 2
        order by hits desc
        limit 50
      ) x
    )
  end
$$;
grant execute on function public.error_summary(int) to authenticated;
