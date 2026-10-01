# Protótipo do Centering Tool v2

Código de bancada usado pra medir as decisões do [PLANO-CENTERING-V2.md](../PLANO-CENTERING-V2.md)
(2026-10-01). Não é código do site: nada aqui é carregado por página nenhuma, e a
pasta `docs` sai no deploy.

- `geo.mjs` — homografia quadrado→quad (Heckbert), inversa, DLT 8×8 pra comparar, reta robusta.
- `sint.mjs` — carta sintética fotografada por câmera pinhole (sem espessura; a versão com
  espessura nasce em `tests/lib/carta-sintetica.mjs` na F1a).
- `medir.mjs`, `oito.mjs` — refino do corte e das 8 linhas a partir dos cantos.
- `detecta.mjs`, `rotula.mjs`, `auto*.mjs` — detecção automática (Hough + rotulagem por lado).
- `mc.mjs`, `mc2.mjs` — Monte Carlo; `t1.mjs` — um caso de ponta a ponta.

```bash
node docs/centering-prototipo/t1.mjs
```

Os estimadores daqui ainda são os ANTIGOS (pico + parábola em sRGB); o plano troca pelo
centroide em intensidade linear (§6.5). Portar, não copiar. A pasta sai quando a F2 entrar.
