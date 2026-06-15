# Backend — plano (preço agora, login depois)

O app é **local-first e estático** (Cloudflare Pages). Backend entra como **camada
opcional**, nunca como requisito: o site continua funcionando 100% sem conta.

## Fase 1 — Preço BR (MYP), via build-time

**Decisão:** não usar backend em runtime para preço. O preço BR é puxado **no
build** (GitHub Actions) e gravado em `data/pricing.generated.js`. Mantém o site
estático, o token seguro (secret do CI) e o preço atualiza no cron semanal.

**Já pronto:** `scripts/sync-myp.mjs` (lê `MYP_API_TOKEN`, pagina `/{jogo}/precos`,
salva `data/myp-prices.generated.json`). O front já lê `TCG_PRICING.b = {mn,md,mx}`
(BRL) e mostra a linha "Brasil · MYP" na cotação; `cardValue` prioriza o BR.

**Falta (destrava com o token do MYP):**
1. Solicitar o `X-Api-Token` ao suporte do MYP.
2. Rodar `MYP_API_TOKEN=… node scripts/sync-myp.mjs pokemon` uma vez e inspecionar
   a resposta real (nomes de campos / paginação).
3. Finalizar o **matching** carta↔MYP (por `edition_code`+número e/ou nome) e o
   merge que injeta `b` em `pricing.generated.js`.
4. Adicionar o secret `MYP_API_TOKEN` no GitHub e o passo no `deploy.yml`
   (gated: roda só se o secret existir).

## Fase 2 — Login + sync da coleção (Supabase)

**Decisão:** Supabase (Auth + Postgres + RLS). Login é **opcional**; quem não
entra continua no `localStorage`. Ao entrar, a coleção sincroniza na nuvem.
Sem imagens — só os dados (cardId → variante → quantidade/condição), que são leves.

**Dados que migram para a nuvem (hoje no localStorage):**
`tcg-collector-collection-v3`, `tcg-collector-wishlist-v1`, `tcg-collector-prices-v1`,
`tcg-collector-binders-v1`. Estratégia: ao logar pela 1ª vez, **mesclar** o local
com o da nuvem (sem sobrescrever/perder), depois manter a nuvem como fonte.

**Schema (colar no SQL Editor do Supabase quando criar o projeto):**

```sql
-- Uma linha por usuário guardando o "save" inteiro como JSON (simples e suficiente).
create table public.collections (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,  -- { collection, wishlist, prices, binders }
  updated_at timestamptz not null default now()
);

alter table public.collections enable row level security;

-- Cada usuário só enxerga/edita a própria linha.
create policy "own row - select" on public.collections
  for select using (auth.uid() = user_id);
create policy "own row - insert" on public.collections
  for insert with check (auth.uid() = user_id);
create policy "own row - update" on public.collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Passos quando for construir a Fase 2:**
1. Criar projeto no Supabase (free tier), rodar o SQL acima.
2. Habilitar Auth (e-mail mágico e/ou Google).
3. No front: incluir o supabase-js, botão "Entrar", e sync (carregar ao logar,
   salvar com debounce ao mudar). Manter o modo local como padrão.
4. CSP: liberar `connect-src` para `https://*.supabase.co`.

## Por que não tudo de uma vez
Construir auth+sync especulativo adiciona manutenção e risco (migração de dados,
RLS, conflito local×nuvem). Faz-se quando houver a necessidade real (multi-
dispositivo / contas). O preço (Fase 1) entrega valor antes e sem login.
