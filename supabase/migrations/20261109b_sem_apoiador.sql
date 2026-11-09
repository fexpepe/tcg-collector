-- ============================================================================
-- Fim do "apoiador sem anúncio" (2026-11-09) — desfaz a 20260928c
--
-- POR QUE: decisão do Fernando em 2026-11-09 — o Sleevu fica 100% grátis e se
-- paga só com anúncio. Não existe mais período sem anúncio comprado com Pix ou
-- Ko-fi (o "cada apoio de R$ 10+ = 30 dias sem anúncio" da 20260928c): todo
-- mundo vê o catálogo igual. O Pix e o Ko-fi da página inicial continuam como
-- ajuda voluntária, sem nada em troca, e não gravam nada no banco.
--
-- O front já não chama nada disto desde a mesma PR: o src/ads.js não pergunta
-- mais `apoio_status`, as Configurações perderam o selo e o /admin perdeu a
-- seção "Marcar apoio". A porta logada do shared.js (RPC_LOGADA) deixou de
-- aceitar `apoio_*`.
--
-- SEM ORDEM com o JS: aplicada antes do deploy, o JS antigo (cache do service
-- worker, app instalado) recebe 404 na `apoio_status` e trata todo mundo como
-- "não apoia" — exatamente o comportamento novo. O /admin antigo mostraria o
-- aviso "aplique a 20260928c" na aba Vitrine até o deploy chegar.
--
-- DESTRUTIVA: apaga a tabela `apoiadores` com o que estiver nela. Se quiser
-- guardar quem apoiou (pra agradecer, por exemplo), rode antes no SQL Editor:
--   select public.admin_apoiadores();   -- logado como admin, pelo site
-- ou, direto no SQL Editor:
--   select a.user_id, u.email, a.ate from public.apoiadores a
--     join auth.users u on u.id = a.user_id order by a.ate desc;
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- Conferir depois de aplicar:
--   select to_regclass('public.apoiadores');                    -- null
--   select proname from pg_proc
--    where proname in ('apoio_status', 'admin_apoiador', 'admin_apoiadores');  -- 0 linhas
-- ============================================================================

drop function if exists public.apoio_status();
drop function if exists public.admin_apoiador(text, int);
drop function if exists public.admin_apoiadores();
drop table if exists public.apoiadores;
