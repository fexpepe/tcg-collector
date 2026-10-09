-- ============================================================================
-- 20261009b — apagar a conta tira a conta das estatísticas de uso
--
-- POR QUE: com sessão, o events_guard grava em cada evento o `uid` (a conta
-- do JWT) desde a 20260914a. É o que separa no /admin quem está logado e a
-- retenção por conta. A política de privacidade (revisada em 2026-10-09,
-- docs/PLANO-ANALYTICS-3.md, achado A11) passou a dizer isso e a prometer
-- que, ao apagar a conta, esse vínculo some junto. A RPC delete_account (fora
-- do repo) apaga coleção, links e o auth.users, mas não mexia em `events`:
-- o uid ficava lá, órfão.
--
-- O QUE FAZ:
--   1. trigger AFTER DELETE em auth.users: `events.uid = null` da conta que
--      saiu. Vale pra delete_account, pro painel do Supabase e pra qualquer
--      outro caminho que apague o usuário. Falha aqui NUNCA impede apagar a
--      conta (exception → segue): a estatística não pode segurar a LGPD;
--   2. índice parcial em events(uid): o update do trigger e as contagens de
--      logados do /admin deixam de varrer a tabela inteira;
--   3. limpeza retroativa: as contas já apagadas antes desta migração.
--
-- O evento continua (com o id aleatório do navegador, que não leva a
-- ninguém): as contagens de visita do passado não mudam, só deixam de
-- contar aquela conta como "logado".
--
-- ADITIVA e sem ordem com o JS. Pode aplicar duas vezes.
-- REGRA de sempre: nenhum cifrão dentro de corpo de função.
--
-- Conferir depois de aplicar:
--   select tgname from pg_trigger where tgname = 'eventos_sem_conta';            -- 1 linha
--   select count(*) from public.events e where e.uid is not null
--     and not exists (select 1 from auth.users u where u.id = e.uid);            -- 0
-- ============================================================================

create index if not exists events_uid_idx on public.events (uid) where uid is not null;

create or replace function public._eventos_sem_conta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update events set uid = null where uid = old.id;
  return old;
exception when others then
  return old;
end $$;
revoke all on function public._eventos_sem_conta() from public, anon, authenticated;

drop trigger if exists eventos_sem_conta on auth.users;
create trigger eventos_sem_conta after delete on auth.users
  for each row execute function public._eventos_sem_conta();

-- As contas que já foram apagadas.
update public.events e set uid = null
 where e.uid is not null
   and not exists (select 1 from auth.users u where u.id = e.uid);
