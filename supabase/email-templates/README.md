# E-mail de login (magic link) com SMTP próprio — runbook

O SMTP embutido do Supabase manda ~2-4 e-mails/hora e cai em spam — não serve
pra ter usuários de verdade. Este runbook configura o Resend (free: 3.000
e-mails/mês, máx 100/dia, 1 domínio) como SMTP do Supabase, mandando de
`login@sleevu.app`.

## 1. Resend (~10 min)

1. Criar conta em <https://resend.com> (pode entrar com GitHub).
2. **Domains → Add Domain** → `sleevu.app` (região: qualquer; us-east-1 ok).
3. O Resend mostra os registros DNS (SPF + MX em `send.sleevu.app` e DKIM em
   `resend._domainkey.sleevu.app`). Adicionar todos na **Cloudflare → sleevu.app
   → DNS → Records**, exatamente como mostrados (TXT/MX não têm proxy).
4. De volta no Resend, **Verify** — propaga em poucos minutos.
5. **API Keys → Create API Key**: permissão *Sending access*, domínio
   `sleevu.app`. Copiar a chave (só aparece uma vez). Guardar em
   `~/.resend-smtp.key` no PC (fora do repo).

## 2. Supabase — SMTP (~5 min)

Dashboard do projeto `dlnalopazitfdgnmdguu` → **Project Settings →
Authentication → SMTP Settings** (ou Authentication → Emails → SMTP):

| Campo | Valor |
|---|---|
| Enable Custom SMTP | ligado |
| Sender email | `login@sleevu.app` |
| Sender name | `Sleevu` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a API key do Resend |

Depois, em **Authentication → Rate Limits**: subir *Rate limit for sending
emails* de 30/h pra **60/h** (o teto real do Resend free é 100/dia; ao fazer
upgrade do Resend, subir aqui junto).

## 3. Supabase — Templates

**Authentication → Email Templates** → colar o HTML de `magic-link.html`
(desta pasta) nos **DOIS** templates:

- **Magic Link** (logins seguintes)
- **Confirm signup** (primeiro login de um e-mail novo)

Assunto dos dois (uma linha só, colada inteira no campo **Subject**):

```
{{ with .Data }}{{ if eq (printf "%v" .lang) "en" }}Your sign-in link — Sleevu{{ else if eq (printf "%v" .lang) "es" }}Tu enlace de acceso — Sleevu{{ else }}Seu link de entrada — Sleevu{{ end }}{{ else }}Seu link de entrada — Sleevu{{ end }}
```

Se o painel recusar a condição no assunto, deixe o assunto fixo
`Seu link de entrada — Sleevu` (o corpo continua no idioma certo).

### Como o idioma chega ao e-mail

O modelo é um só, nos três idiomas. Ele lê `.Data.lang`, que é o
`user_metadata.lang` da conta (documentação do Supabase: `.Data` "contains
metadata from `auth.users.user_metadata`"). `en` e `es` têm o texto no próprio
modelo; qualquer outra coisa (conta sem o campo, valor estranho) cai em
português. O código do idioma é só condição, nunca aparece no e-mail.

Quem grava o `lang`:

- **Conta nova:** o pedido do link manda `data: { lang }` no `POST /auth/v1/otp`,
  e o Supabase grava na criação. É o e-mail do **Confirm signup**.
- **Conta que já existe** (e quem entrou pelo Google): o Supabase **ignora** o
  `data` do `/otp` pra conta confirmada. O site grava com a sessão aberta
  (`PUT /auth/v1/user`) na primeira página depois do deploy e a cada troca de
  idioma, só quando o idioma guardado difere do da interface. É o e-mail do
  **Magic Link**. Até a pessoa abrir o site logada uma vez, o e-mail dela sai em
  português (o padrão).

A ordem não importa: o site pode ir ao ar antes de o modelo novo ser colado (o
modelo antigo ignora o `lang`), e o e-mail só muda de idioma quando o modelo
novo entrar no painel.

## 4. Enquanto estiver no painel: Turnstile

**Authentication → Attack Protection → Enable CAPTCHA protection** →
Turnstile → colar o secret de `~/.turnstile-secret`. O front já manda o token
desde o deploy v210 — só falta esse toggle.

## 5. Teste

1. Sair da conta no sleevu.app e pedir um link de login.
2. Conferir: chegou na inbox (não no spam), remetente `Sleevu
   <login@sleevu.app>`, visual do template ok, e o link loga de fato.
3. Repetir com um e-mail de outro provedor (Outlook/iCloud) pra validar a
   deliverability fora do Gmail.
4. Opcional: pedir um link de login usando o endereço que o
   <https://www.mail-tester.com> fornece e ver o score (esperado 9-10/10 com
   SPF+DKIM verificados).

## Quando escalar

O free do Resend segura ~100 logins/dia. Passando disso com folga, Resend Pro
(US$ 20/mês, 50k/mês) e subir o rate limit do Supabase junto. O Supabase free
segura ~1-2k usuários sincronizando; depois, Supabase Pro (US$ 25/mês).
