# App do Sleevu (Android e iOS)

O app é o **mesmo código do site**, empacotado com o [Capacitor 8](https://capacitorjs.com).
O HTML, o JS e o CSS vão dentro do app. O catálogo (`data/`, ~550 MB e muda todo
dia) e as APIs da borda (`/api/*`) continuam no `https://sleevu.app`, e o app
busca pela rede, como o site.

A stack foi decidida em 2026-10-08: GitHub + Cloudflare (site), **Codemagic**
(build e envio às lojas) e **Capgo** (só o live update). O Capgo completo, com build
e push, ficou de fora por risco de depender de um fornecedor só.

## O que mora onde

| Caminho | O que é |
|---|---|
| `mobile/package.json` | Capacitor, o plugin do Capgo, o `@capacitor/app` e o `@capacitor/browser` (login), com versões fixas. `npm ci` usa o `package-lock.json` |
| `mobile/capacitor.config.json` | `appId` **`app.sleevu`** (permanente nas lojas), `webDir` `www`, live update `atBackground` |
| `mobile/android/`, `mobile/ios/` | Projetos nativos versionados. iOS usa Swift Package Manager (sem CocoaPods) |
| `mobile/web/app-nativo.js` | A **ponte**: 1º script de toda página do app (ver abaixo) |
| `mobile/assets/` | Fontes do ícone e da splash, geradas do `icon.svg` do site |
| `mobile/www/` | O pacote montado. **Gerado**, fora do git |
| `scripts/app-web.mjs` + `scripts/lib/app-web.mjs` | Monta o `www/` a partir do site |
| `codemagic.yaml` (raiz) | Build de loja. O Codemagic exige o arquivo na raiz |
| `.github/workflows/app-nativo.yml` | CI: compila Android e iOS quando o app muda |
| `.github/workflows/app-live-update.yml` | A única porta do live update (PR #171) |

O deploy do site apaga `mobile/` e `codemagic.yaml` antes de publicar. Push que só
mexe no app não republica o site.

## Como o site roda dentro do app

O app serve as páginas de dentro do aparelho: `capacitor://localhost` no iOS e
`https://localhost` no Android. O que no site a borda da Cloudflare faz, aqui
fica a cargo de duas peças.

**A montagem (`npm run app:web`)** copia as páginas, `src/`, `styles.css` e
`assets/`, e muda o mínimo:
- põe o `game.js` em modo manifest, com o `dataDir` de cada jogo apontando pro `sleevu.app`;
- tira a vitrine (`src/ads.js`): AdSense em WebView viola a política do Google, e o
  "apoie: R$10 = 30 dias sem anúncio" é desbloqueio pago fora da loja;
- põe na frente de cada `env(safe-area-inset-*)` a medida que o Capacitor injeta
  (`--safe-area-inset-*`), porque a WebView do Android anterior à 140 erra o `env()`.

Painéis de administração (admin, parceiro, editor do blog) ficam fora.

**A ponte (`mobile/web/app-nativo.js`)** roda antes de tudo em cada página e cuida
de quatro coisas:
1. **Avisa o Capgo** (`notifyAppReady`). Sem o aviso em 10 s, o Capgo desfaz o live update.
2. **Endereço bonito.** O Capacitor serve o `index.html` pra todo caminho sem ponto.
   - A ponte, no `index.html`, descobre a página que a borda serviria (`/sets`,
     `/games/<jogo>/<set>`, `/users/<handle>`, os 301 do `_redirects`) e vai pra ela.
   - A página nova devolve o endereço bonito pra barra antes do `game.js` ler o
     `location.pathname`.
   - A tabela de rotas é o `destino()` dela; `tests/app-web.test.mjs` trava cada caso.
3. **Pedidos ao servidor.** `fetch`, XHR, `sendBeacon` e as imagens do catálogo
   (`data/set-logos/…` dentro de `innerHTML`, `src`, `srcset`) saem pro `sleevu.app`.
4. **Sem service worker, sem Web Push e sem convite de "instalar"**: quem atualiza o
   código é o Capgo.
5. **Botão "voltar" do Android**: volta no histórico (o que também fecha o popup
   da carta); na 1ª tela, minimiza o app.

**O site sabe que está no app** e muda três coisas:
- os links de compartilhar saem com `SLEEVU.origem`, que vem do `window.SLEEVU_APP`
  da ponte (o `sleevu.app`, nunca o endereço do aparelho);
- medição e rastreio de erro contam o app como produção, pelo
  `emProducao()`/`appNativo()` do `shared.js` (`Capacitor.isNativePlatform()`):
  - o pageview leva a plataforma (`pl`) e a versão do binário (`av`, do
    `@capacitor/app`);
  - o erro leva o commit do pacote (`<meta name="sleevu-build" content="app-<sha>">`);
  - os detalhes estão no `docs/PLANO-ANALYTICS-3.md`, seção 4;
- o `<html>` ganha `data-iab="app"`, e a página de login vira o botão que abre o login no navegador (ver Login).

**Do lado do servidor** entra só o CORS. O catálogo estático manda
`Access-Control-Allow-Origin: *` (no `_headers`). As APIs `/api/*` liberam só as
duas origens do app (`functions/api/_middleware.js`): o D1 cobra por linha lida.

## Login

O app **não** faz login dentro dele, por dois motivos:
- o Turnstile (o captcha do link mágico) não roda na origem do app;
- o Google recusa login em WebView embutido.

O caminho:
1. **A página de login do app** (`html[data-iab="app"]`) mostra só um texto e o
   botão **Entrar**, que chama `SLEEVU_APP.entrar()` na ponte.
2. **A ponte gera um segredo PKCE** e guarda no `localStorage` por 30 min.
   Depois abre o login **do site** no navegador do sistema (plugin Browser:
   Custom Tab no Android, Safari no iOS), em
   `https://sleevu.app/login?app=<desafio>&m=s256&p=<android|ios>`.
3. **Lá o login é o de sempre** (Turnstile e Google funcionam), com um aviso de
   que é o app.
   - O `login.js` guarda o pedido no `sessionStorage`.
   - O `shared.js` (`voltaDoLogin`) manda o link mágico e o Google voltarem pra
     **`app.sleevu://login?code=…`**, com o desafio.
   - No iOS o Google some (ver Limites).
4. **O sistema abre o app pela volta.** O esquema `app.sleevu` está registrado
   no `AndroidManifest.xml` e no `Info.plist`.
   - A ponte troca o código pela sessão (`/auth/v1/token?grant_type=pkce`) com o
     segredo e vai pra `/login.html#access_token=…`.
   - Dali em diante é o caminho do site: `consumeAuthRedirect`, sincronização e Hub.
5. **Quem interceptar o link de volta não entra**: tem o código, mas não o
   segredo. O link do e-mail tem que ser aberto **no celular do app**; em
   outro aparelho, a troca não acontece.

Falhas que voltam pra página de login com aviso:
- código sem segredo;
- segredo vencido;
- troca recusada pelo Supabase.

Recusa do próprio Supabase (link vencido) mostra o motivo, como no site.

## Rodar

```bash
cd mobile
npm ci
npm run sync          # monta o www/ e copia pros projetos nativos
npx cap open android  # Android Studio
npx cap open ios      # Xcode (só no macOS)
```

**Sem Android Studio:** o CI (`app-nativo.yml`) gera um APK de debug em toda PR
que mexe no app, no artefato `sleevu-debug-apk` (fica 7 dias). Ele instala em
qualquer Android, com "fontes desconhecidas", e fala com produção.

**Ensaio no navegador** (o jeito mais rápido de ver uma mudança da ponte):
1. Monte o pacote apontando pra um servidor local:
   `node scripts/app-web.mjs --origem http://localhost:8790 --saida <pasta>`.
2. Sirva a pasta com a regra do Capacitor: caminho sem ponto = `index.html`.
3. Na porta 8790, deixe um repasse pro `sleevu.app` que devolva os cabeçalhos de
   CORS (fazendo o papel do `_headers` e do middleware).

## Publicar

| O que mudou | Caminho |
|---|---|
| Só HTML/JS/CSS do site | **Live update**: workflow `app-live-update.yml`, à mão, versão X.Y.Z e canal, com aprovação do Fernando no GitHub |
| Algo nativo (plugin, permissão, ícone, `capacitor.config.json`, versão do Capacitor) | **Loja**: tag `vX.Y.Z` → Codemagic gera, assina e envia (Play: teste interno, como rascunho; iOS: TestFlight) |

- **Versão vem da tag.** A tag vira o `versionName` / `CFBundleShortVersionString`, e
  o contador do Codemagic vira o `versionCode` / `CFBundleVersion`.
- **Live update não pode depender de nativo novo.** JS que chama um plugin que o
  binário instalado não tem quebra o app. O plugin vai primeiro pela loja.
- **O canal do Capgo bloqueia update entre versões principais**, então um pacote 2.x
  não chega a um app 1.x.

## Configuração fora do repositório

- **Codemagic**:
  - conectar o repositório;
  - keystore de upload com o nome `sleevu_upload`;
  - grupo `google_play` com `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`;
  - integração da App Store Connect com o nome `sleevu_asc`.

  A **primeira** versão vai à mão no Play Console, porque a API da Play só aceita
  envio depois que o app existe lá.
- **Google Play, conta pessoal**: teste fechado com 12 testadores por 14 dias seguidos
  antes de liberar a produção.
- **Capgo**: app `app.sleevu`, canais `production` (padrão de download) e `beta`
  (padrão de upload). Feito em 2026-10-08.
- **GitHub**: ambiente `app-live-update`, com o Fernando como revisor obrigatório, sem
  atalho de admin, só a `main` e o segredo `CAPGO_TOKEN`. Feito em 2026-10-09.
- **Supabase, login no app**: em **Authentication → URL Configuration → Redirect
  URLs**, incluir **`app.sleevu://login`**. Sem isso o Supabase ignora a volta pro
  app e manda pro endereço padrão do site: a pessoa entra no SITE, não no app.
- **R2 (`img.sleevu.app`)**: incluir `capacitor://localhost` e `https://localhost` no
  CORS do bucket. Sem isso, exportar imagem (binder, grade) com carta espelhada falha
  no app; o resto não depende disso.

## Limites conhecidos (próximos passos)

1. **Entrar com Apple.** Login social no app obriga o "Entrar com Apple" junto
   (regra 4.8 da App Store). Até ele existir, o login aberto pelo app no **iOS**
   esconde o Google e fica só o e-mail. Precisa da conta Apple: a capacidade
   "Sign in with Apple" no ID `app.sleevu` e o provedor Apple no Supabase.
2. **Push nativo** (FCM/APNs). O Web Push não existe na WebView.
3. **Bloqueios de loja já mapeados**:
   - denunciar e bloquear conteúdo de outros usuários;
   - o "apoie" como compra dentro do app;
   - o `delete_account` versionado.
4. **Endereços que só a borda resolve**: apelido (`/games/magic`) e o 301 do
   compartilhar (`/games/<jogo>/_id/<id>`). Os links do próprio app nunca usam esses
   endereços; aberto de fora, cai na página de erro.
5. **Caminho com ponto no último pedaço**: `/users/h/personagens/Mr.%20Mime` não
   reabre depois de recarregar, porque o Capacitor procura um arquivo. O app não
   recarrega no lugar: o Capgo volta pra raiz.

## Ícone e splash

As fontes ficam em `mobile/assets/`, geradas do `icon.svg`, com fundo `#0d0e12`. Pra
regerar:

```bash
cd mobile
npx --yes @capacitor/assets@3.0.5 generate --android --ios --assetPath assets
```

A ferramenta reescreve `mipmap-anydpi-v26/ic_launcher*.xml` com inset de 16,7%, e
isso deixa o "S" pequeno. Depois de rodar, é preciso:
- devolver esses dois arquivos ao formato de fundo em cor
  (`@color/ic_launcher_background`, `#0D0E12`) com a frente sem inset;
- gerar as `ic_launcher_foreground.png` no tamanho da camada adaptável (108 dp: 432 px
  no xxxhdpi), a partir de `assets/icon-foreground.png`.
