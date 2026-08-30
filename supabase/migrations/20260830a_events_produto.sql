-- ============================================================================
-- Eventos de produto (E6 do docs/PLANO-UX-2.md)
--
-- ADITIVA e SEGURA de aplicar a qualquer momento: só amplia a whitelist de
-- nomes que o trigger `events_guard` aceita. Nada de novo é gravado enquanto o
-- front não disparar esses nomes — e o front NÃO os dispara ainda, de
-- propósito: sem esta migração o `events_guard` faz `return null` e o INSERT
-- some sem erro nenhum, então subir o JS antes daria a impressão de que o
-- analytics funciona, medindo zero. Aplicar isto PRIMEIRO, depois o JS.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
--
-- `create or replace function` preserva o trigger `events_guard` que já aponta
-- pra ela e preserva a ACL (o revoke da 20260723a continua valendo) — não
-- precisa recriar nem re-revogar nada.
--
-- Os cinco nomes novos, e por que só estes cinco: cada um é uma AÇÃO CONCLUÍDA
-- que a pessoa escolheu fazer, não um clique de caminho. É o que permite dizer
-- "quantos importaram de fato", que é a pergunta que hoje se responde no
-- palpite. Sem parâmetro nenhum além do `props` que já existe.
--
--   export_done   — export concluído (backup .json ou planilha .csv)
--   import_done   — import concluído (backup, Dex ou CSV genérico)
--   deck_created  — deck criado no editor
--   backup_done   — backup baixado
--   share_created — link de compartilhamento gerado
--
-- Conferir depois de aplicar (deve devolver os 7 nomes):
--   select p.prosrc from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'events_guard';
-- ============================================================================

create or replace function public.events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or new.name not in (
    'pageview', 'jserror',
    'export_done', 'import_done', 'deck_created', 'backup_done', 'share_created'
  ) then return null; end if;
  if length(coalesce(new.path, '')) > 80
     or length(coalesce(new.anon, '')) > 64
     or length(coalesce(new.game, '')) > 32 then return null; end if;
  if pg_column_size(new.props) > 4096 then return null; end if;
  if not _rate_ok('events', 60) then return null; end if;
  return new;
end $$;

revoke all on function public.events_guard() from public, anon, authenticated;
