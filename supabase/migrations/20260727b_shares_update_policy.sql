-- ============================================================================
-- Migração aditiva: permite ao DONO atualizar (e garante que possa apagar) as
-- próprias linhas de `shares`.
--
-- Sintoma: "republicar" um deck criava uma linha NOVA em vez de atualizar a
-- existente — a galeria ficava com duas entradas do mesmo deck, e a antiga não
-- tinha como ser removida pela interface.
--
-- Causa: a tabela nasceu com policies de INSERT e SELECT (e DELETE), mas nunca
-- teve UPDATE. Sem ela, o PostgREST recusa qualquer PATCH e o cliente só
-- conseguia inserir de novo — o código do decks.js até documentava isso como
-- limitação ("a tabela não tem update público").
--
-- Com o UPDATE liberado, republicar vira "salvar público": o id do share NÃO
-- muda, então o link que já foi compartilhado continua valendo e a página
-- pré-renderizada /deck/<slug> mantém o mesmo endereço.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu).
-- ============================================================================

-- UPDATE: só o dono, e ele não pode "doar" a linha pra outro usuário (o WITH
-- CHECK impede trocar o user_id na atualização).
drop policy if exists "shares_update_own" on public.shares;
create policy "shares_update_own" on public.shares
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: idempotente — recria a policy do dono caso ela não exista neste
-- projeto (é o que permite "despublicar" pela interface).
drop policy if exists "shares_delete_own" on public.shares;
create policy "shares_delete_own" on public.shares
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- Verificação (logado no site): editar um deck já publicado e clicar em
-- "Salvar público" deve manter a MESMA URL e não criar linha nova —
--
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?kind=eq.deck&select=id,title&limit=20" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
-- deve continuar com uma linha por deck.
-- ============================================================================
