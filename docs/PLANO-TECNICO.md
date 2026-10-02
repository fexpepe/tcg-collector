# Plano — Passe técnico: erros, medição e celular × desktop

2026-10-02. A campanha paga dos últimos 10 dias trouxe o maior volume de gente
nova que o site já teve, e o /admin (Técnico › Qualidade) passou a mostrar uma
lista de erros. Este plano faz três coisas, nesta ordem:

1. **Fase 0** — como descobrir, com os dados que já estão no banco, quais erros
   aconteceram, com quem (celular × desktop, campanha × orgânico) e se ainda
   acontecem. Sem deploy, ~1 hora.
2. **Fase 1** — a lista de soluções, com o que já foi confirmado em produção
   nesta passada e o que depende da Fase 0.
3. **Fase 2** — melhorias na detecção, separando celular e desktop em tudo.

## Resumo

- **Nenhum erro de JS aparece em navegação normal**: 42 páginas × 3 perfis
  (desktop 1366px, Android 412px, iPhone 390px) em Chromium real, sem um
  `pageerror`. O que o painel mostra vem de rede instável, de outros motores
  (Safari, navegadores embutidos de app), de fluxos com conta/dados ou de levas
  antigas — a Fase 0 diz qual.
- **O próprio rastreio gera erro** (confirmado): todo envio de medição é um
  `fetch` sem `.catch()`. Quando a rede pisca, a aba fecha no meio ou um
  bloqueador barra o Supabase, vira `Failed to fetch` (Chrome) / `Load failed`
  (Safari) — e o reportador manda isso pro painel. É ruído que esconde o resto.
- **Câmbio quebrado pra visitante novo** (confirmado daqui): a AwesomeAPI, sem
  chave, respondeu `429 QuotaExceeded` sem CORS. Sem câmbio no cache (todo
  visitante da campanha), o popup da carta perde a seção de cotação inteira
  (Cardmarket e TCGplayer); só sobra o PSA com "—".
- **A tela pula no celular** (confirmado): CLS de até **0,89** nas telas de
  jogo, set e carta a 412px — 0,79–0,89 em toda tela de jogo (o bom é ≤ 0,1);
  no desktop, 0,07–0,20. Três causas medidas: cabeçalho que encolhe de 76 pra
  59px quando o app sobe, blocos de texto pros robôs que somem/descem, e
  listas que crescem e empurram o rodapé.
- **Early Hints velhos** (confirmado): a borda manda o 103 com o CSS de
  deploys anteriores — 36 KB baixados à toa na primeira visita, ou 404.
- **O monitor de uptime não roda a cada 30 min**: o GitHub rodou o cron 4 a 7
  vezes por dia (56 vezes de 22/09 a 02/10). Uma queda de horas passaria batida.
- **Detecção**: o `jserror` não diz aparelho, navegador nem leva, agrupa o
  mesmo bug em várias linhas (o hash do arquivo muda a cada deploy), conta
  erro de robô, olha só 7 dias e só 50 linhas. Dá pra separar celular ×
  desktop **do que já aconteceu** cruzando com o pageview do mesmo navegador
  (consultas da Fase 0) — e o `jserror` v2 passa a mandar isso direto.

---

## 1. Como foi feito

- Leitura do caminho do erro: `logClientError` (src/shared.js) → `events`
  (`name = 'jserror'`, props `m` e `s`) → `events_guard` → RPC
  `error_summary` → aba Qualidade (src/admin.js); e da aba Medição
  (`admin_health`, `analytics_sentinela`).
- **Varredura de produção** em Chromium 141 (Playwright), 42 páginas em 3
  perfis — desktop 1366×900, Android (Pixel 7, 412px, toque) e iPhone 13
  (390px, user-agent de iOS; o motor continua sendo o do Chrome). Toda escrita
  de medição (`/rest/v1/events`, `increment_*`, `consent_tally`, beacon do
  Cloudflare) foi interceptada e respondida localmente: **nada desta passada
  entrou no painel**. O corpo do `jserror` que o site *tentaria* mandar foi
  guardado — é exatamente o que o painel mostraria.
- Medição de CLS por elemento (quem pulou, de onde pra onde), antes e depois
  de rolar; e uma primeira visita no perfil de celular do Lighthouse (CPU 4×
  mais lenta, ~1,6 Mbps, 150 ms) contra o desktop.
- Simulação de falha de rede nos envios de medição (o que um bloqueador de
  anúncio ou um 4G caindo fazem).
- Posições minificadas traduzidas pelo `.map` publicado
  (`scripts/decodifica-erro.mjs`, novo, ver Fase 0).
- Cabeçalhos de produção com `curl --http2` (o 103 aparece aí), API de câmbio,
  histórico do healthcheck e do uptime no GitHub Actions.

**O que não deu pra ver daqui**: as linhas do painel (a RPC só responde pra
sessão de admin), o Safari de verdade (WebKit), navegador embutido de app de
verdade e os fluxos com conta e coleção. Por isso a Fase 0 vem antes de
qualquer correção que dependa do dado.

---

## 2. O que o painel mostra hoje (e o que ele não consegue mostrar)

| # | Lacuna | Efeito na leitura |
|---|---|---|
| L1 | O `jserror` manda só mensagem + 1 linha da pilha. Sem aparelho, navegador, sistema, leva (build), app embutido, logado ou campanha | Não dá pra dizer se é celular ou desktop, nem se é um navegador só |
| L2 | `error_summary` agrupa por mensagem **e** `arquivo.<hash>.js:linha:coluna` | O mesmo bug vira uma linha por deploy — e o site sobe várias levas por dia. O teto de 50 linhas enche de repetição |
| L3 | Janela fixa de 7 dias na tabela (o seletor 7/30/90 não vale pra ela) | A campanha teve 10; os 3 primeiros dias não aparecem |
| L4 | Nem a tabela nem o contador "Erros de JS" da Qualidade filtram `bot` | Erro de robô (renderizador de buscador, Playwright de terceiros) conta igual a erro de gente |
| L5 | Falha de envio da própria medição vira erro (ver S1) | O topo da lista tende a ser "Failed to fetch"/"Load failed", que não é bug de tela |
| L6 | Só pega erro depois do `shared.js`: nada do `boot.js`/i18n antes dele, nada do service worker, nada de arquivo que não carregou (script, CSS, imagem), nada de CSP | Justamente as falhas de boot e de deploy, que deixam a tela em branco, não aparecem |
| L7 | Erro dentro de script de outro domínio chega como `Script error.`, sem fonte | Não dá pra separar AdSense, Turnstile e beacon do que é nosso |
| L8 | Falha tratada não gera nada: câmbio que não veio, chunk de catálogo pulado, armazenamento cheio, saída de emergência ("Esta tela não terminou de carregar"), login recusado (captcha, limite de e-mail, OAuth), busca da borda fora do ar, imagem sem nenhuma fonte | O usuário sente; o painel fica zerado |
| L9 | Desempenho (LCP, CLS, INP) só existe no Cloudflare Web Analytics, fora do /admin | O CLS de 0,8 no celular não aparece em lugar nenhum que se olhe todo dia |
| L10 | Limite de 60 eventos/min **por IP** no `events_guard`, compartilhado por todos os eventos | Operadora de celular põe muita gente atrás do mesmo IP (CGNAT): pico de campanha pode descartar evento calado — do celular, justamente |
| L11 | Uptime pelo cron do GitHub (`*/30`) rodou 4–7×/dia | Queda de horas sem e-mail |

---

## 3. Fase 0 — identificar os erros que aconteceram (sem deploy)

### 3.1 Retrato do painel

Antes de qualquer correção, salvar o que o painel mostra hoje (print ou cópia
das tabelas): **Técnico › Qualidade** (Erros de JS) e **Técnico › Medição**
(eventos parados), nos períodos de 7 e 30 dias. É a linha de base pra comparar
depois do S1 — ele vai derrubar boa parte da lista, e é preciso saber o que
sumiu por correção e o que sumiu por ruído.

### 3.2 Consultas no SQL Editor do Supabase

Só leitura; colar uma por vez. O `jserror` não traz o aparelho, mas o pageview
do **mesmo navegador anônimo** traz (`props.d`: `m` = toque, celular/tablet;
`d` = ponteiro, desktop) — o cruzamento pelo `anon` separa celular e desktop
**retroativamente**, pros 10 dias da campanha. Limite: erro de quem desligou a
medição vem sem `anon` e cai em "sem aparelho". Robô sai pelos dois lados: o
`bot` do próprio evento (user-agent) e o do pageview (`webdriver`). Dias em UTC.
As cinco foram rodadas num Postgres de verdade (PGlite) contra dados com
resposta conhecida.

**Q1 — Assinaturas de erro, gente × robô, celular × desktop, com classe.** A
mensagem tem números trocados por `N` e a fonte perde o hash, pra cada bug
virar uma linha só.

```sql
with aparelho as (
  select anon,
         mode() within group (order by props->>'d') as d,
         bool_or(bot or coalesce(props->>'wd', '') = '1') as robo
  from events
  where name = 'pageview' and anon is not null and ts >= now() - interval '40 days'
  group by anon
),
erro as (
  select e.ts, e.path, e.anon,
         e.bot or coalesce(a.robo, false) as robo,
         a.d,
         left(regexp_replace(coalesce(e.props->>'m', ''), '[0-9]+', 'N', 'g'), 140) as msg,
         regexp_replace(coalesce(e.props->>'s', ''), '\.[0-9a-f]{8}\.js', '.js', 'g') as fonte
  from events e
  left join aparelho a on a.anon = e.anon
  where e.name = 'jserror' and e.ts >= now() - interval '10 days'
),
classe as (
  select *,
    case
      when msg ~* '(failed to fetch|load failed|networkerror when attempting|network request failed|network connection was lost|internet connection appears to be offline)' then 'rede'
      when msg ~* '^script error' or fonte ~* '(googlesyndication|cloudflareinsights|challenges\.cloudflare|gstatic\.com)' then 'terceiro'
      when fonte ~* '^(chrome|moz|safari|safari-web)-extension:|webkit-masked-url:' then 'extensao'
      when msg ~* '(unexpected token .<|expected expression, got .<|dynamically imported module|importing a module script failed)' then 'leva velha'
      when msg ~* '(quotaexceeded|quota has been exceeded|operation is insecure|access is denied for this document)' then 'armazenamento'
      when msg ~* 'resizeobserver loop' then 'ruido'
      else 'investigar'
    end as classe
  from erro
)
select classe, msg,
       min(fonte) as fonte_exemplo,
       count(*) filter (where not robo) as vezes_gente,
       count(distinct anon) filter (where not robo) as navegadores,
       count(*) filter (where not robo and d = 'm') as celular,
       count(*) filter (where not robo and d = 'd') as desktop,
       count(*) filter (where not robo and d is null) as sem_aparelho,
       count(*) filter (where robo) as de_robo,
       min(ts)::date as primeiro,
       max(ts) as ultimo,
       string_agg(distinct path, ', ') as paginas
from classe
group by classe, msg
order by 4 desc
limit 60;
```

**Q2 — Taxa de erro por dia e aparelho** (erros a cada mil pageviews e % dos
visitantes do dia que viram algum erro). É o número que diz se o celular está
pior que o desktop, independente de quanta gente cada um teve.

```sql
with aparelho as (
  select anon,
         mode() within group (order by props->>'d') as d,
         bool_or(bot or coalesce(props->>'wd', '') = '1') as robo
  from events
  where name = 'pageview' and anon is not null and ts >= now() - interval '40 days'
  group by anon
),
pv as (
  select ts::date as dia, props->>'d' as d, count(*) as views, count(distinct anon) as visitantes
  from events
  where name = 'pageview' and not bot and coalesce(props->>'wd', '') <> '1' and ts >= now() - interval '10 days'
  group by 1, 2
),
er as (
  select e.ts::date as dia, a.d, count(*) as erros, count(distinct e.anon) as afetados
  from events e
  join aparelho a on a.anon = e.anon
  where e.name = 'jserror' and not e.bot and not a.robo and e.ts >= now() - interval '10 days'
  group by 1, 2
)
select pv.dia,
       case pv.d when 'm' then 'celular' when 'd' then 'desktop' else 'sem info' end as aparelho,
       pv.views,
       pv.visitantes,
       coalesce(er.erros, 0) as erros,
       coalesce(er.afetados, 0) as navegadores_com_erro,
       round(1000.0 * coalesce(er.erros, 0) / nullif(pv.views, 0), 1) as erros_por_mil_views,
       round(100.0 * coalesce(er.afetados, 0) / nullif(pv.visitantes, 0), 1) as pct_visitantes_com_erro
from pv
left join er on er.dia = pv.dia and er.d is not distinct from pv.d
order by pv.dia, 2;
```

**Q3 — Campanha × orgânico.** A origem é a da primeira visita no período:
`utm_source` quando o link trazia, senão o host de quem mandou (`ref:…` —
`l.instagram.com`, `m.facebook.com`…), senão "(direto)". Nem todo navegador
embutido de app manda referrer: se a campanha não tinha utm, parte dela cai em
"(direto)".

```sql
with primeira as (
  select distinct on (anon) anon,
         coalesce(props->>'u', case when props ? 'r' then 'ref:' || (props->>'r') end, '(direto)') as fonte,
         coalesce(props->>'c', '') as campanha,
         props->>'d' as d
  from events
  where name = 'pageview' and not bot and coalesce(props->>'wd', '') <> '1'
    and anon is not null and ts >= now() - interval '10 days'
  order by anon, ts
),
er as (
  select anon, count(*) as erros
  from events
  where name = 'jserror' and not bot and ts >= now() - interval '10 days'
  group by anon
)
select p.fonte, p.campanha,
       case p.d when 'm' then 'celular' when 'd' then 'desktop' else 'sem info' end as aparelho,
       count(*) as visitantes,
       count(er.anon) as com_erro,
       round(100.0 * count(er.anon) / count(*), 1) as pct_com_erro,
       coalesce(sum(er.erros), 0) as erros
from primeira p
left join er on er.anon = p.anon
group by 1, 2, 3
order by visitantes desc
limit 40;
```

**Q4 — Ainda acontece?** Cada erro por leva (o arquivo com hash da fonte). A
leva no ar é o hash do `shared.<hash>.js` no código-fonte da home (hoje,
2026-10-02, `shared.a9fc7e26`). Erro que não tem linha na leva atual já foi
corrigido — ou ainda não reapareceu; o "último" ajuda a decidir.

```sql
select left(regexp_replace(coalesce(props->>'m', ''), '[0-9]+', 'N', 'g'), 120) as msg,
       coalesce(substring(props->>'s' from '/src/([a-z0-9-]+\.[0-9a-f]{8})\.js'), '(fora do nosso código)') as arquivo_da_leva,
       count(*) as vezes,
       min(ts) as primeiro,
       max(ts) as ultimo
from events
where name = 'jserror' and not bot and ts >= now() - interval '10 days'
group by 1, 2
order by 1, 5 desc;
```

**Q5 — Portão de login × conta nova, por aparelho e provedor.** Não é erro de
JS, mas é onde a campanha mais pode ter perdido gente sem nada aparecer: se o
celular bate no login muito mais do que cria conta, e quase nada entra pelo
Google, é o sinal do S5.

```sql
with aparelho as (
  select anon, mode() within group (order by props->>'d') as d
  from events
  where name = 'pageview' and anon is not null and ts >= now() - interval '40 days'
  group by anon
)
select case a.d when 'm' then 'celular' when 'd' then 'desktop' else 'sem info' end as aparelho,
       count(*) filter (where e.name = 'login_gate') as bateram_no_login,
       count(*) filter (where e.name = 'signup') as contas_novas,
       count(*) filter (where e.name = 'signup' and e.props->>'m' = 'google') as pelo_google,
       count(*) filter (where e.name = 'signup' and e.props->>'m' = 'email') as pelo_email
from events e
left join aparelho a on a.anon = e.anon
where e.name in ('login_gate', 'signup') and not e.bot and e.ts >= now() - interval '10 days'
group by 1
order by 1;
```

### 3.3 Traduzir a fonte pro código

A fonte do painel é o arquivo minificado (`shared.a9fc7e26.js:93:2765`). O
deploy publica o `.map` ao lado, e o `scripts/decodifica-erro.mjs` faz a
tradução — aceita o texto como o painel guarda:

```bash
node scripts/decodifica-erro.mjs "    at No (https://sleevu.app/src/shared.a9fc7e26.js:93:2765)"
# → src/shared.js:3948:7
#     fetch(`${SUPABASE_URL}/rest/v1/events`, {
```

Leva que já saiu do ar dá 404 no `.map`: cada deploy tem endereço próprio e
permanente (Cloudflare › Pages › tcg-collector › Deployments, o do dia do
erro), e `--origem https://<id>.tcg-collector.pages.dev` troca o domínio.

### 3.4 Classificar (dicionário de assinaturas)

| Classe | Como aparece no painel | O que é | O que fazer |
|---|---|---|---|
| rede | `Failed to fetch` (Chrome, Android), `Load failed` (Safari — iPhone/iPad/Mac), `NetworkError when attempting to fetch resource.` (Firefox); fonte `at No (…shared.a9fc7e26.js:93:2765)` na leva de 02/10 (a posição muda a cada deploy) ou `promise` | Um envio de medição que falhou (S1, confirmado). A mensagem já entrega o navegador: `Load failed` é Safari | S1. O que sobrar com essa cara depois dele é rede de verdade |
| terceiro | `Script error.` sem fonte; fonte em `googlesyndication`, `cloudflareinsights`, `challenges.cloudflare` | Erro dentro de script de outro domínio (AdSense pra quem aceitou anúncio, Turnstile do login, beacon) | Só contar e separar (D1) |
| extensão | fonte `chrome-extension://`, `moz-extension://`, `safari-web-extension://`, `webkit-masked-url://` | Extensão do navegador da pessoa | Filtrar no cliente (D1) |
| leva velha | `Unexpected token '<'`, `expected expression, got '<'`; ou leva que não é a do ar (Q4) | Página aberta antes de um deploy pedindo arquivo que saiu do ar — o 404 volta em HTML | S6 |
| boot | Mensagem com `SLEEVU`, `TCGShared`, `catalogReady`, `of 'shared'` | O app não subiu. O caso do SW entregando leva velha foi corrigido em 29/09 (sw v266) | "Último" anterior a 29/09: resolvido. Depois disso: investigar |
| armazenamento | `QuotaExceededError`, `The quota has been exceeded`, `The operation is insecure`, `Access is denied for this document` | localStorage cheio ou bloqueado (o theme.js já troca o bloqueado por memória) | Contar (D4) |
| investigar | o resto | Pode ser bug nosso | Traduzir a fonte (3.3) e reproduzir no navegador/aparelho da maioria (Q1) |

### 3.5 Cruzar com o que existe fora do banco

- **Cloudflare Web Analytics › Core Web Vitals**, filtrando *Device type* =
  Mobile e Desktop, por caminho: é dado de campo do CLS/LCP/INP. A *Debug
  View* mostra o elemento que pulou — deve bater com a tabela do S3.
- **Cloudflare › Pages › tcg-collector › Functions › Metrics**: exceções e
  CPU das Functions (`/games/…`, `/api/search`, perfis) nos 10 dias.
- **Search Console › Experiência › Core Web Vitals** (Celular × Computador) e
  [pagespeed.web.dev](https://pagespeed.web.dev) pra `/`, `/games/pokemon`,
  `/games/pokemon/base-set` e uma carta — os "dados de campo" do Chrome, quando
  existirem pra origem.
- **Supabase › Logs**. *Auth*: limite de e-mail (`over_email_send_rate_limit`,
  429) e captcha recusado na semana da campanha. *API (edge logs)*, com o
  aparelho no user-agent — no Logs Explorer (ajustar se algum campo reclamar;
  no plano gratuito os logs ficam só 1 dia, no Pro, 7):

  ```sql
  select cast(timestamp as datetime) as quando, request.method, request.path,
         response.status_code, h.user_agent
  from edge_logs
  cross join unnest(metadata) as m
  cross join unnest(m.request) as request
  cross join unnest(m.response) as response
  cross join unnest(request.headers) as h
  where response.status_code >= 400
  order by timestamp desc
  limit 200
  ```
- **Câmbio no 4G**: abrir `https://economia.awesomeapi.com.br/last/USD-BRL` no
  navegador do celular, no 4G e no Wi-Fi. `QuotaExceeded` no 4G confirma o S2
  pra quem está atrás do IP compartilhado da operadora.

### 3.6 Reproduzir

Pras assinaturas "investigar" com mais navegadores na Q1: o aparelho e o
navegador da maioria, de verdade — iPhone com Safari, Android com Chrome e
Samsung Internet — e o **navegador embutido do Instagram** (mandar o link
numa DM pra si mesmo e abrir por lá), que é onde o anúncio abre.

### 3.7 Saída da Fase 0

Uma tabela que decide a ordem da Fase 1:

| Assinatura | Classe | Celular | Desktop | Navegadores | Primeiro / último | Leva | Código (3.3) | Situação |
|---|---|---|---|---|---|---|---|---|

---

## 4. Fase 1 — lista de soluções

Prioridade: **P0** = vale fazer enquanto a campanha ainda traz gente; **P1** =
logo depois; **P2** = quando der. "Confirmado" = medido nesta passada em
produção; "hipótese" = depende da Fase 0 ou de aparelho real.

### P0

**S1. O rastreio que gera o próprio erro** — confirmado, celular e desktop.

- *Evidência*: com o POST de `/rest/v1/events` falhando (como faz um
  bloqueador de anúncio ou um 4G caindo), toda página registrou dois
  `Uncaught (in promise) TypeError: Failed to fetch`, e o site tentou mandar
  ao painel `{"m":"Failed to fetch","s":"at No (…/shared.a9fc7e26.js:93:2765)"}`.
  Traduzido: `src/shared.js:3948`, o `fetch` do `mandaEvento`; o segundo é o
  `fetch` do próprio `logClientError` (4145).
- *Correção*: `.catch(() => {})` nos seis envios "dispara e esquece" do
  `shared.js` — `consent_tally` (3844), `mandaEvento` (3948),
  `logClientError` (4145), `logCardView` (4237), `contributePrice` (4277) e
  `logDeckView` (4316). O `try/catch` em volta deles só pega erro síncrono.
- *Conferir*: a mesma simulação, zero `pageerror`; no painel, "rede" cai
  depois do deploy (Q4 por leva).
- *Esforço*: pequeno.

**S2. Câmbio de terceiro no caminho crítico** — confirmado daqui; o alcance em
usuário real é hipótese (3.5).

- *Evidência*: `GET economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL` →
  `429 {"code":"QuotaExceeded"}`, sem `Access-Control-Allow-Origin` — no
  navegador vira erro de CORS e o `fetch` rejeita. A cotação só vem do cache
  de 24–48h do navegador, que o visitante novo não tem. Comparado com câmbio
  simulado: a carta perde a seção "Cotação de mercado" de Cardmarket e
  TCGplayer; só fica o PSA, com "—". A nova tentativa (1,5 s depois) bate no
  mesmo limite. A chamada sem chave tem cota (a documentação fala em limite
  pra requisição não autenticada; com chave gratuita, 100 mil por mês). Se a
  cota contar por IP, como é o comum, o celular é o mais exposto: a operadora
  põe muita gente — de vários sites que usam a mesma API — atrás do mesmo IP.
- *Correção*: (a) o build busca o câmbio uma vez por deploy (com chave
  gratuita da AwesomeAPI em secret — 100 mil pedidos/mês — ou outra fonte) e
  publica `data/fx.generated.json`; o cliente usa isso como piso quando a API
  falha ou demora, e nunca fica sem converter. (b) Melhor ainda: `/api/cambio`
  numa Function com cache de borda de 1h, chave no servidor, sem CORS e sem o
  limite por IP do usuário. Os dois juntos: Function como fonte, o arquivo do
  build como reserva.
- *Conferir*: carta aberta numa sessão limpa com a API bloqueada mostra os
  preços em R$; o contador `falha:cambio` (D4) fica em zero.
- *Esforço*: médio.

**S3. A tela pula no celular (CLS)** — confirmado; causa medida elemento a
elemento.

| Tela | Desktop 1366 | Android 412 | iPhone 390 | O que pula |
|---|---|---|---|---|
| `/games/<jogo>` (Sets) | 0,09 | 0,79–0,89 | até 0,79 | Cabeçalho 76→59px + o `.jogo-indice` (texto pros robôs), que aparece no topo e desce quando o app desenha a grade |
| `/games/<jogo>/<set>` | 0,12–0,14 | 0,17–0,89 | 0,87 | `.set-indice` some (73px→0) e o cabeçalho de resultados e a grade descem 106px |
| Carta | 0,07–0,20 | 0,23–0,86 | 0,85 | Cabeçalho + `details.seo-carta` + painel da carta |
| `/condition` | 0 | 0,60 | 0,76 | Cabeçalho + `aside.fer-card` some |
| `/help` | 0,42 | 0 | 0,80 | As 8 seções nascem vazias (`data-i18n-html`) e crescem de 17 pra ~160px quando o JS traduz |
| `/lancamentos` | 0,73 | 0,44 | 0,43 | A lista nasce com 94px e vai a ~600px depois do fetch; o rodapé, que estava na tela, desce |
| `/novidades` | 0,12 | 0,24 | 0,30 | Igual: o changelog empurra o rodapé |
| Demais páginas | ≤ 0,01 | 0,02–0,08 | 0,02–0,09 | Só o cabeçalho |

(Bom é ≤ 0,1; ruim, > 0,25. O valor oscila entre rodadas porque depende de o
navegador pintar antes do app subir — em celular mais lento isso acontece
sempre.)

- *Cabeçalho*: a ≤860px a `.header-actions` tem estilo de fileira do rodapé
  do drawer (borda em cima, 12px de padding, seletor de idioma de 38px). Até o
  `shared.js` montar o drawer, ela aparece **dentro** do cabeçalho, com o
  seletor vazio — 76px; com o app no ar, 59px. Correção: enquanto
  `html:not([data-app])`, esconder essa fileira no celular e reservar a
  altura do cabeçalho do app.
- *Blocos de índice* (`.jogo-indice`, `.set-indice`, `details.seo-carta`):
  servem a robô sem JS e hoje estão na primeira dobra antes do boot. Mantê-los
  no fim do `<main>` e reservar a altura do que o app vai desenhar (grade,
  cabeçalho do set) no estado pré-boot — eles continuam no HTML, só que fora da
  tela no primeiro paint e sem sair do fluxo depois.
- *Listas e rodapé*: `main` com altura mínima de uma tela, pra o rodapé nunca
  estar no primeiro paint de uma página cujo conteúdo chega por fetch
  (`/lancamentos`, `/novidades`); esqueleto com a altura típica da lista.
- *Ajuda*: o texto em português (o idioma padrão) no HTML, já no build; o JS
  só troca pra en/es.
- *Conferir*: a medição por elemento (Fase 2, D8) ≤ 0,1 a 412px e a 1366px nas
  telas da tabela; depois, o Core Web Vitals do Cloudflare por aparelho.
- *Esforço*: médio (CSS + marcação das telas montadas na borda). Mudança
  visual: conferir em 390px e desktop, como sempre.

**S4. Early Hints com o CSS de deploys anteriores** — confirmado.

- *Evidência*: `curl --http2 -sS -D - -o /dev/null https://sleevu.app/hub`
  mostra o 103 com `</styles.ed9c7605.css>` e o 200 com
  `</styles.4c8f9efd.css>` (o certo). O velho ainda vem do cache da CDN
  (`cf-cache-status: HIT`, idade ~22h, 36 KB comprimidos) — baixado à toa,
  com prioridade alta, na primeira visita, que é a de quem chega pela
  campanha. No Chromium, antes do HTML, saem pedidos sem referer (o sinal do
  103) pelo `styles.ed9c7605.css` em toda página, e em `/games/*`, `/pokedex`,
  `/explore`, `/cards`, `/decks`, `/lancamentos`, `/artists` e `/trainers`
  também pelo `styles.3bbf3d51.css` e pelo `styles.e9f506da.css`, que dão 404
  em HTML ("Refused to apply style…" no console). O Cloudflare guarda o `Link`
  que viu por URL e repete no 103; com várias levas por dia, ele fica pra trás.
- *Correção*: testar, nesta ordem: (a) purgar o cache das páginas HTML no fim
  do deploy (o `deploy.yml` já tem `CLOUDFLARE_API_TOKEN`; precisa da
  permissão *Cache Purge*) e conferir se o 103 acompanha; (b) se não
  acompanhar, desligar o Early Hints na zona — o ganho é um round-trip na
  primeira visita, e o custo hoje é um CSS velho no lugar do novo.
- *Conferir*: depois de um deploy, o 103 de `/`, `/hub`, `/games/pokemon` e
  `/pokedex` com o mesmo hash do 200 (vira check do healthcheck, D8).
- *Esforço*: pequeno (configuração + um passo no deploy).

### P1

**S5. Login com Google dentro do app do Instagram/Facebook/TikTok** —
hipótese forte; conferir em aparelho (5 min) e na Q5.

- O Google recusa OAuth em navegador embutido (erro 403
  `disallowed_useragent`), e é aí que o anúncio abre. A pessoa toca em
  "Continuar com Google", vê uma página de erro do Google e não volta — nada
  disso chega ao painel. O link por e-mail funciona.
- *Correção*: reconhecer o navegador embutido pelo user-agent (`FBAN`,
  `FBAV`, `FB_IAB`, `Instagram`, `BytedanceWebview`/`musical_ly`, `Line/`) e,
  no /login, trocar o botão do Google por uma linha curta: "Pra entrar com o
  Google, abra no navegador (⋯ › Abrir no navegador) — ou receba o link por
  e-mail aqui". Marcar `iab` no pageview e no `login_gate` (D1).
- *Esforço*: pequeno.

**S6. Arquivo de leva que saiu do ar** — risco estrutural; frequência pela
classe "leva velha" da Q1.

- O site sobe várias levas por dia, e o Pages só serve a atual: os dois CSS do
  S4 que dão 404 são de levas de dias atrás. Página com service worker já
  recarrega sozinha quando a leva nova assume (desde 14/09) e não recebe mais
  HTML de leva velha (29/09). Sobra quem não tem SW no comando — primeira
  visita, navegador embutido do iOS, aba que ficou aberta durante o deploy —
  pedindo um módulo sob demanda (`card-rescue`, scanner, importação) que já
  não existe.
- *Correção*: o deploy publica também os `src/*.js` e `styles*.css` com hash
  das últimas levas (do R2 ou do cache do runner) por alguns dias; e o
  carregador de módulo, quando um arquivo nosso com hash falha, recarrega a
  página uma vez (com trava em `sessionStorage`).
- *Esforço*: médio.

**S7. Monitor de uptime de verdade** — confirmado (L11).

- Um monitor externo gratuito (UptimeRobot ou Better Stack, a cada 1–5 min)
  em `/`, `/games/pokemon`, `/api/search?q=pikachu` e no REST do Supabase,
  com alerta por e-mail/push. O `uptime.yml` fica como segunda camada.
- *Esforço*: pequeno, fora do código.

**S8. Primeira visita lenta no celular** — confirmado em laboratório.

| Página | Celular (4× CPU, 4G ruim): LCP · CLS · bloqueio | Desktop: LCP · CLS |
|---|---|---|
| `/` | 1,5 s · 0,02 · 160 ms | 0,6 s · 0 |
| `/hub` | 3,7 s · 0,02 · 110 ms | 0,8 s · 0 |
| `/games/pokemon` | 2,8 s · 0,82 · 250 ms | 0,8 s · 0,09 |
| `/games/pokemon/base-set` | **6,9 s** · 0,89 · 430 ms | 1,7 s · 0,12 |
| Carta (Charizard 4/102) | 3,3 s · 0,86 · 460 ms | 1,9 s · 0,07 |
| `/explore?q=charizard` | **5,9 s** · 0,05 · 360 ms | 1,7 s · 0,03 |

(LCP bom é ≤ 2,5 s.) A grade de cartas só começa a pedir imagem depois que o
JS desenha; no 4G, a imagem do LCP sai tarde. Candidatos: a borda já monta o
HTML da tela do set — incluir a primeira fileira de imagens com
`fetchpriority="high"`; pré-carregar a imagem principal da carta; e seguir
tirando código frio do núcleo (o `shared.js` tem 265 KB minificados, e o
bloqueio no celular passa de 400 ms nas telas de set e carta).

### P2

- **S9. Logos de loja 404 na home** — confirmado: `shop_myp.webp`,
  `shop_tcgplayer.webp` e `shop_pricecharting.webp` não existem em
  `assets/shops/` (o HTML já prevê o texto no lugar). São três 404 em toda
  visita à home. Subir os arquivos ou tirar os `<img>` até eles existirem.
- **S10. Imagem de carta sem nenhuma fonte na busca** — confirmado: em
  `/explore?q=pikachu` e `?q=charizard`, espelho e origem dão 404 pra promos do
  Pokémon (`mcd14/15/17/18`, `2023sv`, `2024sv`, `tk-hs-r`, `ex5.5`) e pra
  cartas em português (`cel25`, `swsh11` TG, `xy2`, `xy12`) — o tile fica no
  placeholder cinza. A contagem por host e por set (D4, "imagem") diz onde
  vale curar.
- **S11. CSP barrando o script inline do Cloudflare** — confirmado, toda
  página fora do catálogo: a detecção de robô do Cloudflare (JS Detections)
  injeta um `<script>` inline que a CSP recusa (o `_vitrine-csp.js` já
  documenta). Não quebra nada, mas é um erro de console por página e vira
  ruído quando os relatórios de CSP (D2) entrarem. Desligar a JS Detections em
  Security › Bots, se nada a usa, ou filtrar.

---

## 5. Fase 2 — melhorias na detecção (celular × desktop em tudo)

**D0. Painel atual, só SQL** (migração; pode ir antes de qualquer JS).
`error_summary_v2(days, aparelho)`: aparelho pelo cruzamento com o pageview do
mesmo `anon` (o mesmo da Q1, então vale **retroativo**, pros 10 dias da
campanha); `not bot` também pelo pageview; assinatura = mensagem normalizada +
primeiro quadro sem hash; período do seletor (7/30/90); 200 linhas
paginadas; colunas celular/desktop, navegadores, % dos visitantes do aparelho,
primeira e última leva. O contador "Erros de JS" (vem da `admin_dashboard`)
passa a filtrar robô.

**D1. `jserror` v2 no cliente** (sem migração: o nome já está na whitelist e
os campos cabem nos 4 KB de `props`).

| Campo | Valor | Pra quê |
|---|---|---|
| `d` | `m`/`d` (`pointer: coarse`, igual ao pageview) | Celular × desktop sem depender do cruzamento |
| `b` | família + versão maior: `chrome 141`, `safari 18`, `samsung 27`, `firefox 131`… | "Só no Safari 16" vira pergunta de uma linha |
| `o` | `android`, `ios`, `windows`, `mac`, `linux` | Separa iPad de Mac, Android de desktop com toque |
| `iab` | `instagram`, `facebook`, `tiktok`… (só se embutido) | O público do anúncio pago |
| `v` | o build da página (`<meta name="sleevu-build">`, que o `shared.js` já lê) | "Corrigido?" deixa de depender do hash na fonte |
| `k` | `js`, `promise`, `recurso`, `csp`, `boot` | Tipo de falha |
| `f` | até 3 quadros da pilha, sem hash | Agrupa o mesmo bug entre levas. Hoje, na rejeição de promise, o `stack.split("\n")[1]` pega o 2º quadro no Safari e no Firefox (a pilha deles não começa pela mensagem) |
| `lg`, `pwa`, `vw` | logado, app instalado, largura arredondada | Recortes do painel |

E no comportamento: falha dos próprios envios não vira erro (depois do S1, nem
acontece); fonte de extensão e `ResizeObserver loop` não vão; `Script error.`
vai marcado como terceiro; teto por sessão (não só por página); e um
coletor mínimo no primeiro script síncrono (o `theme.js`, que no deploy vira o
`boot.js`) guarda o que quebrar **antes** do `shared.js` (hoje invisível) pra
ele mandar depois. Sem user-agent cru, sem query, sem IP — o mesmo grão
agregável do pageview.

**D2. Falha de recurso e de CSP.** Ouvinte de `error` em fase de captura pra
`<script>`/`<link>`/`<img>` com o nosso host (arquivo com hash que não veio =
"leva velha"), e `securitypolicyviolation` (diretiva + host barrado). Os dois
entram como `jserror` com `k` próprio — e a CSP ganha `report-to` apontando
pra uma Function que conta por dia (pega também o que acontece sem JS).

**D3. Aba Qualidade v2** (src/admin.js). Chave **Todos | Celular | Desktop**
no topo; cartões "erros a cada mil visitas" e "% dos visitantes com erro" por
aparelho, com a variação contra o período anterior; linhas por dia (celular ×
desktop) com marca de deploy; tabela com chip de classe e barrinha celular ×
desktop por linha; selo "nova" pra assinatura vista pela primeira vez nas
últimas 48h; ao abrir a linha: páginas, navegadores, levas e o **código
traduzido no próprio navegador** (o admin baixa o `.map` da mesma origem e faz
a conta do `decodifica-erro`).

**D4. Falhas silenciosas** (evento `falha`, migração de whitelist, com
`d`/`b`/`o`/`iab`/`v`): `cambio`, `catalogo` (chunk pulado), `armazenamento`
(o aviso de disco cheio), `boot` (a saída de emergência apareceu — hoje só o
CSS sabe), `login` (`captcha`, `limite`, `oauth`, `erro`), `busca` (a borda
caiu e o catálogo local assumiu), `imagem` (cadeia esgotada, amostrada, com o
host), `sw` (instalação falhou), `sync` (envio/recebimento da nuvem falhou).
No painel: cartão "falhas por tipo × aparelho".

**D5. Desempenho de campo no /admin** (evento `vitals` ao sair da página:
LCP, CLS, INP, FCP, TTFB, com `d` e a página; amostrado). Aba "Desempenho" com
o p75 por página × aparelho e a meta (LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms)
pintada de verde/vermelho. É o S3 e o S8 medidos em gente, todo dia.

**D6. Sentinela de erro no healthcheck.** RPC anônima que devolve só sinais
agregados — "a taxa do celular dobrou contra a semana anterior", "assinatura
nova em N+ navegadores", "falha de câmbio acima de X%" — e o healthcheck
diário falha com o nome do sinal (e-mail do GitHub), como já faz com evento
parado.

**D7. Limite por IP medido.** O `_rate_ok` conta o que descarta, por dia e
escopo; a aba Medição mostra "eventos descartados pelo limite". Se for
relevante no celular (CGNAT), o limite do `pageview`/`jserror` sobe ou passa a
considerar o `anon`.

**D8. Varredura sintética no CI.** A varredura desta passada vira
`scripts/varredura-producao.mjs` e roda depois do deploy, em desktop 1366 e
celular 412/390, com a medição interceptada: falha com `pageerror`, 4xx/5xx de
arquivo nosso, saída de emergência visível, 103 com hash diferente do 200 e
CLS > 0,25 nas telas da tabela do S3; o desempenho com CPU/rede limitadas sai
como relatório semanal.

**D9. Uptime externo** (é o S7).

---

## 6. Ordem de execução

| # | Entrega | O que leva | Quando |
|---|---|---|---|
| 0 | Fase 0 (consultas, decodificador, painéis do Cloudflare/Supabase, celular no 4G, Instagram) | este plano | agora |
| 1 | PR: S1 + D1 (cliente) | `shared.js`, `theme.js` | hoje — o resto da campanha já chega medido por aparelho |
| 2 | Configuração: S4 (Early Hints) + S7 (monitor) + S11 | Cloudflare, deploy.yml | junto |
| 3 | PR: S2 (câmbio na Function + arquivo do build) | Function, build, `shared.js` | em seguida |
| 4 | PR: S3 (cabeçalho pré-boot, blocos de índice, rodapé, ajuda) | CSS, telas da borda, `help.html` | em seguida; conferir 390px e desktop |
| 5 | PR: D0 + D3 (SQL antes do JS, como sempre) | migração + `admin.js` | depois da Fase 0 dizer o que importa |
| 6 | PR: S5 (login em app embutido) | `login.js`, i18n | junto com o 5 |
| 7 | PR: D2 + D4 + D5 (migração de whitelist antes) | `shared.js`, Function de CSP | semana seguinte |
| 8 | PR: D6 + D7 + D8 | healthcheck, migração, script | semana seguinte |
| 9 | S6, S8, S9, S10 | deploy, telas, catálogo | conforme a Fase 0 e o D5 mostrarem o peso |

## 7. Como saber se melhorou

- **Erros a cada mil visitas, celular e desktop** (Q2 hoje, D3 depois): cair
  pelo menos à metade depois do S1 — o que sobrar é erro de verdade, e aí a
  meta é por assinatura.
- **% de visitantes com erro por aparelho**: o celular não pode ficar acima do
  desktop.
- **CLS p75 no celular ≤ 0,1** nas telas `/games/…` (Cloudflare por aparelho
  e o D5); **LCP p75 ≤ 2,5 s** no set e no Explorar.
- **Falha de câmbio = 0** depois do S2.
- **Conta nova no celular ÷ portão de login no celular** (Q5) antes × depois do
  S5.

## 8. Fora deste plano

- O aviso de anúncios ocupa ~23% da tela do celular na primeira visita ao
  catálogo (visto em `/games/pokemon` a 412px). É decisão de produto, não erro
  técnico — mas é a primeira coisa que o visitante da campanha vê.
- Safari de verdade e navegadores embutidos de verdade não passaram pela
  varredura (Chromium com user-agent de iPhone não reproduz bug do WebKit). A
  Fase 0 diz se precisa; a Q1 já mostra, pela mensagem (`Load failed`), quanto
  do erro é Safari.
- Fluxos com conta e coleção (sync, scanner com câmera, importação) ficaram de
  fora da varredura anônima; o D4 cobre as falhas deles daqui pra frente.
