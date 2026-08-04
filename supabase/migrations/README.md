# Migrações do Supabase

O SQL que vive no banco (RLS, RPCs, triggers) passa a ser versionado AQUI antes
de ir pro dashboard — o repo é a fonte da verdade, o SQL Editor é só o meio de
aplicar. (As migrações antigas, criadas direto no dashboard, estão descritas em
`docs/BACKEND.md` e na auditoria de 2026-06-18; o ideal é exportá-las pra cá aos
poucos.)

## Pendentes de aplicar

Nenhuma. Todas as migrações deste diretório estão aplicadas em produção
(verificado por curl — ver a lista abaixo).

### Já aplicadas (verificado em produção)

- `20260804a` — visitas por deck (`deck_views` + `increment_deck_view` +
  `deck_views_for`). Aplicada e testada em 2026-08-04: a RPC de leitura
  responde `[]`, a leitura anônima da tabela funciona, INSERT direto é negado
  pela RLS (42501) e uuid inexistente não cria linha. É o que faz o "Em
  destaque" da galeria de decks ser por popularidade.

- `20260723a` — rate limit por IP em `events`/`increment_card_view`,
  `get_public_profile`, `error_summary`. Confirmado: as tabelas respondem e o
  guard de `events` descarta nome fora da whitelist.
- `20260723b` — lockdown de `public_profiles`. Confirmado: leitura anônima
  devolve `[]`.
- `20260724a` — slugs de YGO/Digimon/Riftbound no CHECK de `card_views`.
- `20260727a` — `kind='deck'` liberado em `shares` (destravou o publicar).
- `20260727b` — policy de UPDATE (e DELETE) do dono em `shares`. Aplicada em
  2026-08-04; republicar deixa de duplicar o deck na galeria. O teste de
  comportamento é logado (curl anônimo não exercita policy de
  `authenticated`): republicar um deck deve manter UMA linha por deck.
- `20260727c` — `user_id` fora da leitura ANÔNIMA de `shares`. Aplicada e
  verificada em 2026-08-04: pedir `user_id` devolve 42501, e as duas queries
  REAIS do app seguem funcionando pra visitante sem conta — o select da
  galeria (com os `data->>`) e o do viewer de deck (`data` inteiro). Conferir
  essas duas importa: o `revoke select` derruba o acesso amplo, então uma
  coluna esquecida no `grant` quebraria a galeria sem que o teste do
  `user_id` percebesse.

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
