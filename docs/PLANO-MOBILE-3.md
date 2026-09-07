# Plano — Paridade celular × desktop (passe 3)

## Como foi feito

Auditoria em Chromium real de 25 telas do site, cada uma em 390px (toque) e
1280px, com sessão e coleção de exemplo. Além de olhar lado a lado, um script
mediu por tela: rolagem horizontal, elementos saindo da viewport, alvos de
toque abaixo de 36px, texto abaixo de 11px e rótulos cortados por reticências.
Nenhuma tela rolava de lado; os problemas são de ritmo, alvo e corte.

## O que o desktop tinha e o celular não refletia

| # | Tela(s) | No desktop | No celular (antes) |
|---|---|---|---|
| 1 | Pokédex, Sets, Trainers, Artists, Wishlist, Sales | Resumo em UMA fileira de 3 números | 3 cartões altos empilhados, uma tela inteira antes do conteúdo (Pokédex com 10.700px) |
| 2 | Hub | Cartão "412/1025 Pokémon na Pokédex" (v2) | Rótulo cortado: "Pokémon in the Po…" |
| 3 | Pokédex | Chips de geração com contagem (Gen I · Kanto 120/151, v2) | Escondidos dentro de "Filtros ▾" — a progressão por geração não aparecia |
| 4 | Pokédex | Botão "Já tenho" no card (v1) | 28px de altura, abaixo do piso de toque do site (44px) |
| 5 | Explorar | Jogo / Ordenar / Versões numa linha com a busca | Bloco flutuando à direita sob o título, rótulos soltos |
| 6 | Sets, Trainers | Chips de idioma pequenos numa linha | 4 chips de 44px em 2 linhas, empurrando a lista |
| 7 | Coleção | Tile com 5 ações (Lista, pasta, ♥, −, +) | Os 5 não cabiam no tile de 2 colunas: o + e o badge ×N saíam pela borda |
| 8 | Sales & Trades | 6 botões de ação numa fileira + percentuais | Fileiras desiguais, botões de larguras diferentes |
| 9 | Sets | Cabeçalho de série clicável (▾ Série · N sets →) | 25px / 16px de altura — alvo de toque de texto |
| 10 | Medalhas | Selo de raridade e botão de compartilhar | Selo em 9px; compartilhar com 26px |

Coisas que PARECEM diferentes mas são decisão consciente e ficaram como estão:
o resumo do Graded vira esteira horizontal com snap (o 2º cartão aparece
"espiando" de propósito); a subnav Cartas/Sets/Pokédex/… rola de lado com
degradê nas pontas; a busca sai da faixa do título e vai pro header.

## Plano (aplicado neste passe)

Tudo em CSS, num bloco só no fim do `styles.css` ("Paridade celular"), mais
uma mudança de marcação na Pokédex:

1. **Resumo em fileira** (≤720px): `.stats-grid` em 3 colunas compactas
   (número 22px, rótulo 12px em 2 linhas). O Hub mantém as 2 colunas dele e
   deixa o rótulo quebrar linha em vez de cortar. Resolve 1 e 2.
2. **Chips de geração fora do toolbar** (`pokedex.html`): viram fileira própria
   (`.master-filter`, a mesma dos chips de idioma). Resolve 3.
3. **Fileiras de chips rolam de lado** (≤720px): `.master-filter` em uma
   linha, sangrando até a borda, sem barra. Resolve 3 e 6.
4. **Controles do Explorar em grade 2×2** (≤720px). Resolve 5.
5. **Ações do tile dividem a linha** (≤560px), com teto de 34px por botão —
   com 3 botões nada muda; com 5, encolhem o necessário. Resolve 7.
6. **Sales em 2 colunas** + percentuais em 3 (≤560px). Resolve 8.
7. **Alvos de toque** (toque ou ≤700px): "Já tenho" 36px, cabeçalho de série
   44px, compartilhar medalha 36px, selo 10px. Resolve 4, 9 e 10.

## Fora deste passe

- Portfólio: no celular "Esconder valores / Exportar CSV" ficam acima do
  "← Hub"; é só ordem, sem perda de função.
- Rótulo dentro do donut do Hub ("distintas") mede 5,5px no SVG mas escala
  com o gráfico — legível na prática.
- Nomes de artista/treinador cortados com reticências: igual no desktop.
- Links de rodapé (Sobre, FAQ…) com 20px: rodapé, não ação principal.
