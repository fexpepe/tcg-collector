# Regras do Claude neste repositório

Arquitetura e como rodar estão no [README.md](README.md); plano e decisões no
[ROADMAP.md](ROADMAP.md). Aqui ficam só as regras de **trabalho** do Claude.

## Feature pronta = PR aberta na main, sem perguntar

Toda vez que uma feature (ou correção) terminar **completa**, o Claude sobe
sozinho uma pull request para a `main` remota — não espera o Fernando pedir.
"Completa" quer dizer, nesta ordem:

1. O código faz o que foi pedido, sem partes deixadas "pra depois".
2. Os checks que o CI roda passam localmente:
   ```bash
   node --test tests/*.test.mjs
   node scripts/check.mjs          # sintaxe + i18n pt/en/es + ordem de scripts
   node scripts/check-mobile.mjs   # guardas de layout mobile
   node scripts/split-indexes.mjs --check   # só se mexeu em data/indexes*.js
   ```
3. Mudança visual foi conferida renderizando (a tela real via `npx http-server`
   ou um trecho com o `styles.css` real), em desktop e, quando afeta o celular,
   em ~390px.

Aí o fluxo é:

- Commit na branch de trabalho (`claude/<assunto>-<id>`), mensagem em
  português explicando o **porquê**, não só o quê.
- `git fetch origin main` e rebase por cima antes de subir — a `main` anda
  sozinha (snapshot do catálogo, D1) e o push é recusado se ficar pra trás.
- `git push -u origin <branch>` e abrir a PR para `main` com título curto e
  descrição do que mudou, o que foi conferido e o que ficou de fora.
- Uma feature = uma PR. Pedidos separados na mesma conversa viram PRs
  separadas (ou commits separados na mesma PR só quando são a mesma feature).

**Push direto na `main` só quando o pedido disser isso explicitamente**
("subir na main", "aplicar e subir no git main"). Sem esse pedido, o caminho é
a PR.

Se a feature ficou pela metade (bloqueio, dúvida que muda o resultado), não
abre PR: commita na branch, sobe a branch e diz o que falta.

## Carta, set, linha ou jogo novo no catálogo

Segue o [docs/CATALOGO.md](docs/CATALOGO.md). Jogo ou linha nova só vira PR com
a ficha da seção 4.1 preenchida na descrição, os itens do checklist 4.2 feitos
(ou marcados "não se aplica", com o motivo) e os orçamentos de arquivos e de
peso medidos (seção 7). A maior parte dos esquecimentos não quebra nada no CI e
vai calada pro ar.

## Convenções que já valem no código

- Comentários e mensagens de commit em **português**, no tom do resto do
  código (explicam a decisão e o bug que motivou, com data quando ajuda).
- Sem build e sem bundler: HTML estático + JS global + `styles.css` único.
  CSS novo entra perto das regras do mesmo componente, com comentário.
- Texto de interface passa pelo i18n (`src/i18n.js`, pt/en/es) — chave nova
  entra nos três idiomas, senão o `check.mjs` reclama.
- Ícones em SVG inline (traço, `currentColor`), nunca emoji nem glifo de
  texto em botão.
- Alvo de toque mínimo de 44px no celular; campo de texto com 16px no toque
  (iOS dá zoom abaixo disso).

## App (mobile/) anda junto com o site

O app (Capacitor, [mobile/README.md](mobile/README.md)) roda o mesmo código do
site, servido de dentro do aparelho, sem a borda da Cloudflare. Página nova
entra no app sozinha. O que **não** entra sozinho:

- **Endereço novo servido pela borda** (Function nova, regra nova no
  `_redirects`): precisa entrar no `destino()` da ponte
  (`mobile/web/app-nativo.js`), com o caso no `tests/app-web.test.mjs`. Senão,
  no app, o endereço abre a página de erro.
- **Arquivo novo que só existe no servidor** fora de `/data/` e `/api/` (gerado
  no deploy): precisa entrar no `SERVIDOR` da ponte.
- **Link pra outra pessoa** (compartilhar): sai de `SLEEVU.origem`, nunca de
  `location.origin`, que no app é o endereço do aparelho.

Mexeu em `mobile/`, na ponte ou no `scripts/app-web.mjs`: o
`app-nativo.yml` compila Android e iOS na PR. Se a mudança aparece na tela,
confira no ensaio do pacote no navegador (receita no `mobile/README.md`).

**Tag `vX.Y.Z` dispara build de LOJA no Codemagic.** O Claude não cria nem
sobe tag de versão sem o Fernando pedir aquela versão na conversa.
