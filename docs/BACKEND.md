# Backend — o que existe hoje

O site é **local-first e estático** (Cloudflare Pages). O backend é uma camada
**opcional**: quem não cria conta continua com tudo no `localStorage`, e nenhum
recurso do app depende de login. São três peças independentes:

1. **Supabase** — Auth, Postgres e RLS: conta, sync da coleção, perfil público,
   decks publicados, contadores, push e analytics.
2. **Cloudflare Pages Functions** — API na borda (`functions/`): busca em D1,
   "só as minhas cartas" e o Open Graph do perfil público.
3. **Build-time** — preços e catálogo entram no site como arquivo estático,
   gerados pelo GitHub Actions. Nenhum preço é servido por backend em runtime.

O SQL novo é versionado em [`supabase/migrations/`](../supabase/migrations/) —
o repo é a fonte da verdade, o SQL Editor é só o meio de aplicar. Ver o
[README de lá](../supabase/migrations/README.md) pro que está aplicado.

Projeto: `dlnalopazitfdgnmdguu`. As chaves do front (URL + publishable) são
públicas por design — quem protege é a RLS.

---

## 1. Supabase

### Tabelas

| Tabela | O que guarda | Leitura |
|---|---|---|
| `collections` | PK (`user_id`, `game`); `data` jsonb = o "save" daquele jogo | só o dono |
| `profiles` | identidade e preferências: `handle`, `display_name`, `is_public`, `show_values`, `is_admin` | só o dono |
| `public_profiles` | payload **curado** do perfil público: coleção + vendas (+ preços se `show_values`) | pontual, via RPC |
| `shares` | links publicados: `kind` ∈ {collection, binder, deck} | pública (colunas liberadas) |
| `card_views` | PK (game, card_id); contador de visitas por carta | pública |
| `deck_views` | PK `share_id` → `shares`; visitas por deck | pública |
| `community_prices` | 1 ponto por usuário×carta×variante×condição×tipo×[graduadora+nota]×mês, em BRL | **nenhuma** (RLS sem policy; só RPC agrega) |
| `events` | analytics first-party: `name`, `path`, `anon`, `game`, `props` | **nenhuma** (só insert) |
| `rate_limits` | janela por IP usada pelas RPCs | interna |
| `push_subs` | PK (user_id, endpoint); assinaturas de web push | só o dono |
| `push_sender_key` | só o **SHA-256** da chave do robô | nenhuma (sem policy, de propósito) |

Regras que valem em todas: RLS ligada, escrita do dono via `auth.uid() = user_id`,
`anon` nunca insere onde há dono. Limites de abuso: 5 MB em `collections.data`,
2 MB em `shares.data` e `public_profiles.data`, e no máximo 100 shares por
usuário (trigger).

**Privacidade do perfil público**: `profiles` (privado) e `public_profiles`
(curado) são tabelas separadas de propósito. O cliente só escreve na segunda
quando `is_public`, e **deleta** a linha quando o perfil volta a privado.
Binders, pastas, histórico e custos nunca entram nela. Desde a migração
`20260727c`, a leitura anônima de `shares` é liberada **coluna a coluna** — o
`user_id` fica de fora.

**Privacidade do Preço da Comunidade**: `community_prices` é a tabela mais
fechada do banco — RLS ligada e **nenhuma policy**, nem SELECT pro próprio dono.
A escrita exige `auth.uid()` (anônimo não contribui) e o `anon` não tem EXECUTE
na RPC: o `grant execute ... to authenticated` da `20260807a` **não** era uma
restrição, porque o Postgres já concede EXECUTE a PUBLIC por padrão — foi por
isso que a `20260807b` teve que fazer `revoke ... from public, anon`. A
contribuição manda só (carta, valor, mês); nunca quem, quantidade ou coleção. O
preço pago ("Paguei") **não** é contribuído — é o dado mais sensível dos três,
porque revela o que a pessoa negociou, e ficaria atrás de um opt-in próprio.

### RPCs

| RPC | Pra quê |
|---|---|
| `handle_available(p_handle)` | valida formato, lista de reservados e unicidade do @ |
| `get_public_profile(p_handle)` | leitura pontual do perfil público (substituiu o SELECT amplo) |
| `find_sellers(p_card_ids)` | cruza a wishlist com quem tem à venda, sobre dados já públicos |
| `increment_card_view(...)` | +1 visita numa carta, com whitelist de jogo e throttle por IP |
| `increment_deck_view(uuid)` | +1 visita num deck; exige share existente com `kind='deck'` |
| `deck_views_for(uuid[])` | lê até 200 contagens numa chamada (ordenação "Mais vistos") |
| `contribute_price(...)` | grava/atualiza o ponto do usuário em `community_prices` (upsert pela PK = 1 voto por pessoa) |
| `community_price_for(game, card_id)` | mediana + média aparada por (variante, tipo, nota, mês), **só bucket com n ≥ 3** |
| `analytics_summary(days)` | números do `/admin`; devolve null pra quem não é admin |
| `error_summary(...)` | erros de JS agregados, no mesmo painel |
| `delete_account()` | apaga shares + collections + o usuário, filtrando por `auth.uid()` |

Contadores **nunca** aceitam insert direto: escrever é privilégio da RPC
(`security definer`), com throttle por IP no servidor e 1 view/sessão no cliente.
Sem a tabela ou a RPC, a galeria degrada sozinha em vez de quebrar.

### O que sincroniza

O blob de cada linha de `collections` é montado a partir de `SYNC_KEYS`
([src/shared.js](../src/shared.js)): as chaves **por jogo** (coleção, wishlist,
preços, histórico) mais as **globais** (binders, decks, listas, pastas, vendas,
graded, tags, vendidos, custos, preço-alvo, favoritos). As globais são gravadas
redundantemente em cada linha de jogo e reconciliadas no merge.

O sync é **multi-jogo**: todo pull/push percorre os slugs, não só o jogo da
sessão — senão carta marcada no PC num jogo não chegava no celular. O merge é
last-write-wins por bloco, com tombstones. No primeiro login o local é
**mesclado** com a nuvem, nunca sobrescrito.

Fotos de binder (IndexedDB) **não** sobem: o blob leva só metadados.

---

## 2. API na borda (Cloudflare Pages Functions)

| Rota | O que faz |
|---|---|
| `GET /api/search` | busca no jogo inteiro (ou `game=all`) respondida por D1, em poucos KB — no lugar de baixar o `search-index.json` inteiro (8 MB no Magic) |
| `POST /api/collection` | devolve as cartas e os preços **exatamente dos ids** que a pessoa tem, no lugar dos chunks inteiros dos sets |
| `GET /users/<handle>` | serve a SPA com Open Graph, título e canonical dinâmicos do perfil. Handle inexistente devolve **404 de verdade**; se a consulta ao Supabase falhar, serve a shell com `noindex` (indisponibilidade temporária não pode apagar perfis reais do índice) |

Duas regras de projeto:

- **A borda devolve dado, não total.** A fórmula do valor vive só no cliente. Se
  a borda somasse por conta própria existiriam duas fórmulas, e mais cedo ou mais
  tarde elas discordariam — é exatamente o bug de "o valor da Coleção não bate
  com o do Hub" que já custou caro.
- **Degradar, nunca quebrar.** O cliente trata qualquer resposta não-ok
  (inclusive o 503 de "API desligada") como sinal pra cair no caminho estático de
  sempre. Por isso a função pode existir em produção antes do banco.

O D1 é criado e carregado pelo próprio deploy (`build-d1.mjs` + `deploy-d1.mjs`)
a partir do **mesmo** catálogo do site. Sem permissão de D1 no token, o passo
explica o que falta e sai com sucesso.

---

## 3. Preço

Preço nunca passa por backend em runtime: é puxado no build e gravado em
`data/**/pricing*.js`, servido estático. Mantém o site estático, o token seguro
como secret do CI e o custo previsível.

Fontes: TCGplayer (USD) e Cardmarket (EUR) vindas do sync de cada jogo,
PokemonPriceTracker (preços JP e graded, por crédito) e AwesomeAPI (câmbio).

**MYP (Brasil) — pendente do token.** `scripts/sync-myp.mjs` já lê
`MYP_API_TOKEN` e pagina `/{jogo}/precos`; o front já lê `TCG_PRICING.b` e mostra
a linha "Brasil · MYP", com o BR tendo prioridade no valor. O passo do deploy é
no-op enquanto o secret não existir. O que falta está no [ROADMAP](../ROADMAP.md).

---

## 4. Web push (queda de preço)

`push_subs` guarda as assinaturas; `push_sender_key` guarda **só o hash** da
chave do robô, e as RPCs `push_targets`/`push_prune` são gated por esse hash
(chave errada devolve zero linhas). O sender é `scripts/send-wishlist-push.mjs`,
disparado pelo workflow `push-wishlist.yml` (segunda, 09:00 UTC): cruza quedas
≥5% dos deltas de preço com a wishlist sincronizada, respeita o idioma da
assinatura e limpa endpoints 404/410. VAPID: chave pública no front, privada em
secret.

---

## 5. Analytics e /admin

Anônimo e first-party: `logPageview` manda 1 evento por carregamento com um uuid
de primeira parte do `localStorage`. A tabela `events` **não tem select** — nem o
dono lê evento cru; o que existe é o agregado das RPCs, e só pra quem tem
`is_admin`. Erros de JS entram como `name='jserror'` no mesmo lugar e aparecem no
painel. A política de privacidade divulga essas estatísticas.

---

## Runbooks

### Login com Google

O botão só navega pro endpoint do Supabase; os tokens voltam no hash e o
`initAuth` do `shared.js` consome — mesmo caminho do link mágico. Quando o Google
não funciona, o problema é **configuração**, em um destes três lugares:

1. **Google Cloud Console** — tela de consentimento publicada (em "Testing" só
   entram os testadores); credencial de *Aplicativo da Web*; origens autorizadas
   `https://sleevu.app`; **URI de redirecionamento**
   `https://dlnalopazitfdgnmdguu.supabase.co/auth/v1/callback` (é o Supabase que
   recebe a volta do Google, **não** o sleevu.app — o campo que mais se erra).
2. **Supabase → Authentication → Providers → Google** — provedor ligado com o
   Client ID e o Secret. Desligado produz `Unsupported provider` na volta.
3. **Supabase → Authentication → URL Configuration** — Site URL
   `https://sleevu.app` e Redirect URLs cobrindo `https://sleevu.app/**` (mais
   `http://localhost:*/**` pra testar). Fora da allow-list o Supabase **não dá
   erro visível**: redireciona pro Site URL, e parece um login que não fez nada.

O `login.js` mostra o motivo real (captcha, rate-limit, genérico) — é por onde
começar o diagnóstico.

### Atalho da última conta ("Continuar como Fernando")

Quem já entrou pelo Google **neste navegador** volta à tela de login e vê o
próprio nome e e-mail num botão só: um clique e está dentro. É lembrança
**local**, não uma consulta ao Google.

- **Onde mora**: `localStorage["sleevu-ultima-conta-v1"]` —
  `{ email, nome, via, ts }`. Gravada no `consumeAuthRedirect` (shared.js), que
  é por onde TODO login passa e o único ponto em que o `user` vem inteiro (o
  `setSession` enxuga o objeto pra caber no cookie de 4KB).
- **`via`** sai do `app_metadata.provider`: `google` ganha o atalho, `email`
  (link mágico) só ganha o campo de e-mail já preenchido. Oferecer o botão do
  Google a quem nunca usou Google mandaria a pessoa pra um fluxo que pode nem
  existir com aquele endereço.
- **Sobrevive ao logout de propósito** — é justamente o caso que ela serve.
  Some em três situações: "Entrar com outra conta" (o único jeito visível, e o
  que importa em computador compartilhado), exclusão da conta
  (`deleteAccountFlow` chama o `forgetLastAccount`; o wipe genérico varre só
  `tcg-`) e limpeza dos dados do site.
- **`login_hint`**: o clique manda `oauthSignIn("google", { login_hint: email })`
  e o GoTrue repassa pro `/authorize` do Google todo parâmetro de query que não
  seja dele. É o que faz o Google já abrir com a conta certa — e pular o seletor
  pra quem segue logado lá. Se um dia for ignorado, cai no seletor de sempre.
- **Sem foto**: a do Google viria de `lh3.googleusercontent.com` e a CSP é
  `img-src 'self'` — além de virar um ping pro Google só por abrir o login. O
  avatar é a inicial do nome.

Isto **não** é o One Tap do Google (aquele balãozinho que aparece sozinho no
canto). O One Tap exigiria, além do Client ID no front: `script-src` e
`frame-src` liberando `accounts.google.com` na CSP, `Cross-Origin-Opener-Policy`
em `same-origin-allow-popups` (hoje é `same-origin`, que quebra o popup dele),
`https://sleevu.app` nas *origens JavaScript autorizadas* do Google Cloud
Console, o Client ID na lista de *Authorized Client IDs* do provedor Google no
Supabase e a troca do credential por sessão via
`POST /auth/v1/token?grant_type=id_token` (com nonce). O atalho acima entrega o
mesmo clique único sem nada disso.

### E-mail do link mágico (SMTP próprio)

Ativo via **Resend** (`login@sleevu.app`, `smtp.resend.com:465`, domínio
verificado com SPF/DKIM). O runbook completo — DNS, credenciais, rate limits e
teste de deliverability — está em
[`supabase/email-templates/README.md`](../supabase/email-templates/README.md).

Pendência: o template de `magic-link.html` está colado no **Confirm signup**, mas
não na aba **Magic Link** — quem já tem conta ainda recebe o padrão em inglês.

Armadilha conhecida: endereço `@example.com` é **recusado pelo Resend** e vira um
`500 Error sending confirmation email`, que parece SMTP quebrado e não é. Testar
com um alias `+algo` de um e-mail real.

### Turnstile

Widget `sleevu-login` na conta Cloudflare, sitekey pública no `login.html`,
secret no Supabase (**Authentication → Attack Protection**). Já houve um
incidente em que o secret salvo era inválido e **todo** login falhava com
`captcha_failed` mascarado por mensagem genérica — o diagnóstico foi chamar
`/auth/v1/otp` direto e ler o `error_code`.

---

## Escala e custo

O free do Supabase segura ~1–2k usuários sincronizando; o free do Resend, ~100
logins/dia. Passando disso com folga: Resend Pro (US$ 20/mês) e Supabase Pro
(US$ 25/mês), subindo o rate limit de e-mail junto. Nada disso muda o modelo —
conta e sync continuam grátis pro usuário.
