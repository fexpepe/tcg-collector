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
