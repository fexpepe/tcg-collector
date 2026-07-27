-- ============================================================================
-- Endurecimento: esconde `shares.user_id` de quem NÃO está logado.
--
-- Achado da auditoria de 2026-07-27: a leitura de `shares` é pública (é o que
-- faz a galeria da comunidade funcionar sem conta), e o PostgREST deixa o
-- cliente escolher as colunas. Então qualquer um fazia
--
--   GET /rest/v1/shares?select=id,user_id,kind
--
-- e obtinha o UUID do dono de cada publicação. Com isso dá pra correlacionar
-- "este deck, esta pasta e esta coleção são da MESMA pessoa" e contar quantos
-- usuários o site tem. Não é dado pessoal direto, mas é exposição sem uso.
--
-- RLS é row-level, não column-level — o corte certo é privilégio de COLUNA.
--
-- Por que `authenticated` mantém o acesso: a tela "Publicados por você"
-- (listMyShares no shared.js) filtra por user_id=eq.<uid>, e filtrar exige
-- SELECT na coluna. Um usuário logado enumerar UUIDs é bem menos exposto que a
-- internet inteira — e é o preço de manter aquela tela funcionando.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu).
-- ============================================================================

-- Anon perde a coluna, mas segue lendo o resto (galeria pública intacta).
revoke select (user_id) on public.shares from anon;

-- Garante explicitamente as colunas que a galeria pública consome.
grant select (id, kind, game, title, data, created_at) on public.shares to anon;

-- ============================================================================
-- Verificação:
--
--   # deve falhar com 42501 (permissão negada na coluna)
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?select=id,user_id&limit=1" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # deve continuar funcionando (é o que a galeria pede)
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?kind=eq.deck&select=id,title,game,created_at&limit=5" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
-- E no site, logado: Meus Decks → "Publicados por você" tem que continuar
-- listando (é a tela que depende do filtro por user_id).
-- ============================================================================
