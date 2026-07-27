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
-- ATENÇÃO — a primeira versão deste arquivo NÃO FUNCIONAVA. Ela fazia só
--   revoke select (user_id) ... from anon;
-- e no PostgreSQL isso é um NO-OP quando o papel já tem SELECT no nível da
-- TABELA: o privilégio amplo continua valendo e o privilégio de coluna nem é
-- consultado. É preciso derrubar o SELECT da tabela ANTES e então conceder
-- coluna a coluna. Se você aplicou a versão antiga, aplique esta por cima —
-- é idempotente.
--
-- RLS não resolve isto: RLS é row-level; o corte por coluna é privilégio.
--
-- Por que `authenticated` mantém o acesso: a tela "Publicados por você"
-- (listMyShares no shared.js) filtra por user_id=eq.<uid>, e filtrar exige
-- SELECT na coluna. Um usuário logado enumerar UUIDs é bem menos exposto que a
-- internet inteira — e é o preço de manter aquela tela funcionando.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu).
-- ============================================================================

-- 1) Derruba o SELECT AMPLO do anônimo. Sem este passo, o grant por coluna
--    abaixo não muda nada.
revoke select on public.shares from anon;

-- 2) Devolve só o que a galeria pública precisa. `user_id` fica de fora.
grant select (id, kind, game, title, data, created_at) on public.shares to anon;

-- 3) O PostgREST guarda o schema (e os privilégios) em cache; sem o reload a
--    mudança só valeria no próximo restart do serviço.
notify pgrst, 'reload schema';

-- ============================================================================
-- Verificação (rodar DEPOIS de aplicar):
--
--   # 1) deve FALHAR agora (permission denied for column user_id / 42501)
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?select=id,user_id&limit=1" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # 2) deve CONTINUAR funcionando (é exatamente o que a galeria pede)
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/shares?kind=eq.deck&select=id,title,game,created_at&limit=5" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
-- E no site, logado: Meus Decks -> "Publicados por você" tem que continuar
-- listando (é a tela que depende do filtro por user_id).
-- ============================================================================
