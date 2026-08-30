# Banner de parceria

Slot único, servido do PRÓPRIO site — imagem e link, sem script nem rastreio de
terceiros, então não mexe no CSP nem na privacidade. Está em
`PARTNER_AD`/`initPartnerBanner` no `src/shared.js`, hoje com `enabled: false`
(nada é exibido).

Pra ligar, preencha o objeto lá:

```js
const PARTNER_AD = {
  enabled: true,
  position: "bottom",                          // "bottom" (acima do rodapé) ou "top"
  image: "assets/partners/jornada-games.webp",
  href: "https://…",                           // destino do link
  alt: "Jornada Games — loja parceira"
};
```

O link sai com `rel="sponsored noopener"` e `target="_blank"`: patrocinado
declarado, que é o que o Google pede e o que é honesto com quem clica.

## Arquivos

- `jornada-games.webp` — Jornada Games. Fonte 2000×261 com alfa, escalada pra
  1000×131 (o banner é largo; 512 ficaria borrado). **Guardado, não ligado**:
  o `PARTNER_AD` continua `enabled: false` até a decisão sobre destino e
  posição — banner patrocinado aparece em TODAS as páginas do site, e isso não
  é coisa de ligar por conta própria.
