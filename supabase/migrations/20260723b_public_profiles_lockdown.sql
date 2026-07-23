-- ============================================================================
-- Migração B (LOCKDOWN — aplicar SÓ DEPOIS de: migração A aplicada + deploy do
-- front que usa get_public_profile. Se aplicar antes, visitante deslogado para
-- de conseguir abrir /users/<handle> até o deploy sair.)
--
-- Fecha a leitura pública direta de public_profiles: hoje qualquer um com a
-- anon key pagina a tabela inteira (handles, nomes, coleções e valores de todo
-- mundo — scraping/enumeração). Depois desta migração, a leitura pública passa
-- a ser exclusivamente:
--   - get_public_profile(handle)  → pontual, por handle exato (migração A);
--   - find_sellers(card_ids)      → agregado, já capado (DEFINER desde a A).
-- O dono continua lendo/escrevendo a própria linha normalmente (o upsert com
-- on_conflict precisa do SELECT da própria linha — coberto pela policy nova).
-- ============================================================================

-- Dropa TODAS as policies de SELECT da tabela (nomes criados pelo dashboard não
-- estão versionados — dropa dinamicamente pra não depender do nome exato).
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'public_profiles' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.public_profiles', pol.policyname);
  end loop;
end $$;

create policy "own row - select" on public.public_profiles
  for select using (auth.uid() = user_id);

-- Verificação (rodar depois):
--   select policyname, cmd, qual from pg_policies where tablename = 'public_profiles';
--   -- deve listar SELECT só com "auth.uid() = user_id"; insert/update/delete intactas.
-- Se existir alguma policy FOR ALL (cmd = 'ALL'), ela NÃO é tocada aqui —
-- confira que ela não abre leitura pública antes de dar o assunto por encerrado.
