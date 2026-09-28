-- ============================================================================
-- Apoiador sem anúncio (2026-09-28) — docs/PLANO-ADS.md, seção 10 e decisão 3
--
-- POR QUE: quem apoia o Sleevu (Pix ou Ko-fi) navega sem NENHUM anúncio —
-- nem AdSense, nem trilho, nem a vitrine da casa pedindo apoio. Valor
-- decidido em 2026-09-28: cada apoio a partir de R$ 10 (ou o mensal do Ko-fi)
-- = 30 dias, SOMANDO quando a pessoa apoia de novo antes de vencer. Não é
-- plano pago: nenhuma função fica trancada, e os links de loja continuam.
--
-- ONDE MORA: tabela própria, e não uma coluna em `profiles` como o plano
-- previa. Dois motivos: (1) `profiles` só tem linha pra conta que escolheu um
-- @ — quem apoia sem @ ficaria sem onde gravar; (2) a policy de UPDATE de
-- `profiles` (criada no dashboard, fora do repo) é "dono edita a própria
-- linha", e cada coluna sensível ali precisa de um trigger de guarda (é o que
-- o `profiles_admin_guard` faz com o is_admin). Aqui a tabela nasce TRANCADA:
-- RLS ligada e nenhum privilégio pra anon/authenticated — ninguém lê nem
-- escreve pela API. A leitura passa só pela `apoio_status()`, que devolve a
-- data da PRÓPRIA conta, e a escrita só pelas RPCs do /admin.
--
-- Quem apaga a conta (`delete_account`, que remove o auth.users) leva a linha
-- junto (on delete cascade).
--
-- O que faz:
--   1) tabela `apoiadores` (user_id, ate): vale até o FIM do dia `ate`, no
--      fuso de São Paulo (o mesmo das outras RPCs do painel).
--   2) apoio_status(): a data da conta logada, ou null. O src/ads.js e as
--      Configurações chamam pelo `adminRpc` do shared.js.
--   3) admin_apoiador(quem, dias): soma `dias` (padrão 30) pra conta achada
--      pelo e-mail ou pelo @. Soma a partir do vencimento se ainda vale, ou a
--      partir de hoje se já venceu. dias = 0 encerra hoje (pra desfazer
--      engano). Gate _is_admin().
--   4) admin_apoiadores(): quem apoia ou apoiou nos últimos 60 dias, pra aba
--      Mercado › Vitrine do /admin. Mostra o @ ou o e-mail mascarado.
--
-- ADITIVA e SEM ORDEM com o JS: antes de ser aplicada, a `apoio_status` dá
-- 404, o front trata como "não apoia" e todo mundo vê a vitrine como hoje; o
-- /admin mostra "aplique a 20260928c" na seção de apoiadores.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select to_regclass('public.apoiadores');                   -- apoiadores
--   select public.admin_apoiadores();                          -- null fora do admin
--   Logado no site, pelo console: TCGShared.adminRpc("apoio_status", 0, {})
--   devolve null (ninguém marcado ainda) em vez de undefined (404).
-- ============================================================================

-- ── 1) Tabela ───────────────────────────────────────────────────────────────
create table if not exists public.apoiadores (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ate        date not null,
  updated_at timestamptz not null default now()
);
alter table public.apoiadores enable row level security;
revoke all on public.apoiadores from public, anon, authenticated;

-- ── 2) A própria data ───────────────────────────────────────────────────────
create or replace function public.apoio_status()
returns date language sql stable security definer set search_path = public as $$
  select ate from apoiadores where user_id = auth.uid()
$$;
revoke all on function public.apoio_status() from public, anon;
grant execute on function public.apoio_status() to authenticated;

-- ── 3) Marcar / estender / encerrar (admin) ─────────────────────────────────
create or replace function public.admin_apoiador(p_quem text, p_dias int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  quem text := lower(trim(coalesce(p_quem, '')));
  uid  uuid;
  novo date;
begin
  if not _is_admin() then return null; end if;
  if p_dias is null or p_dias < 0 or p_dias > 366 then
    return jsonb_build_object('erro', 'dias');
  end if;
  -- "@" no meio = e-mail; senão é o @ do perfil (com ou sem o @ na frente).
  if position('@' in quem) > 1 then
    select id into uid from auth.users where lower(email) = quem;
  elsif quem <> '' then
    select user_id into uid from profiles where lower(handle) = ltrim(quem, '@');
  end if;
  if uid is null then return jsonb_build_object('erro', 'nao-achei'); end if;

  if p_dias = 0 then
    update apoiadores set ate = hoje - 1, updated_at = now() where user_id = uid;
  else
    -- Novo (ou vencido): hoje conta como o 1º dia, então 30 dias vão até
    -- hoje + 29. Ainda valendo: soma no fim, sem perder o que sobrava.
    insert into apoiadores as a (user_id, ate) values (uid, hoje - 1 + p_dias)
    on conflict (user_id) do update
      set ate = greatest(a.ate, hoje - 1) + p_dias, updated_at = now();
  end if;
  select ate into novo from apoiadores where user_id = uid;
  return jsonb_build_object('ate', novo);
end $$;
revoke all on function public.admin_apoiador(text, int) from public, anon;
grant execute on function public.admin_apoiador(text, int) to authenticated;

-- ── 4) Lista (admin) ────────────────────────────────────────────────────────
create or replace function public.admin_apoiadores()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not _is_admin() then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('quem', x.quem, 'ate', x.ate, 'ativo', x.ate >= hoje) order by x.ate desc)
      from (
        -- e-mail mascarado sem regex: um cifrão aqui dentro quebra a colagem
        -- no SQL Editor (tests/analytics-2-1.test.mjs).
        select coalesce('@' || p.handle, left(u.email, 1) || '…' || substr(u.email, position('@' in u.email))) as quem, a.ate
          from apoiadores a
          join auth.users u on u.id = a.user_id
          left join profiles p on p.user_id = a.user_id
         where a.ate >= hoje - 60
      ) x
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_apoiadores() from public, anon;
grant execute on function public.admin_apoiadores() to authenticated;
