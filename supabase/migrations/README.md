# Migrações do Supabase

O SQL que vive no banco (RLS, RPCs, triggers) passa a ser versionado AQUI antes
de ir pro dashboard — o repo é a fonte da verdade, o SQL Editor é só o meio de
aplicar. (As migrações antigas, criadas direto no dashboard, estão descritas em
`docs/BACKEND.md` e na auditoria de 2026-06-18; o ideal é exportá-las pra cá aos
poucos.)

## Pendentes de aplicar

Ordem obrigatória (o front já está preparado para qualquer momento da A, mas a
B só pode entrar depois do deploy):

1. **`20260723a_rpc_rate_limits_errors.sql`** — aditiva, aplicar já.
   Cria `get_public_profile`, torna `find_sellers` SECURITY DEFINER, adiciona
   rate limit por IP em `events` (trigger) e `increment_card_view` (recriada),
   e cria `error_summary` pro painel /admin.
2. **Deploy do front** (push na main) com as mudanças de 2026-07-23
   (fetchPublicProfile via RPC com fallback; error tracking; aviso de quota).
3. **`20260723b_public_profiles_lockdown.sql`** — SÓ depois do deploy.
   Fecha a leitura pública direta de `public_profiles` (anti-scraping).

Como aplicar: SQL Editor do dashboard (colar o arquivo inteiro) ou
`supabase db push` com o CLI ligado ao projeto `dlnalopazitfdgnmdguu`.

## Verificação pós-aplicação

```bash
# Depois da B: paginar a tabela deve voltar VAZIO (antes voltava todo mundo)
curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/public_profiles?select=handle&limit=5" \
  -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
```

```bash
# A RPC pontual deve continuar respondendo (troque o handle por um real)
curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/get_public_profile?p_handle=fexpepe" \
  -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
```

E no site: abrir um perfil público deslogado, a wishlist ("quem tem à venda")
e o /admin (seção "Erros de JS" aparece depois da A).
