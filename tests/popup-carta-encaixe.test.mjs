// Popup da carta no celular: a carta encolhe pra −/Tenho/+ e Pastas / Lista
// de Desejo caberem inteiros ao abrir (2026-10-10, teste do Fernando no
// Galaxy S10 e no PWA do iPhone 16 — a fileira de baixo abria cortada no pé
// do painel). A função mora dentro do módulo do popup no src/shared.js; o
// teste tira ela do fonte e roda com medidas de mentira.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fonte = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

// Corpo da função por contagem de chaves (não tem string com chave dentro).
function extrai(nome) {
  const ini = fonte.indexOf(`function ${nome}(`);
  assert.ok(ini > 0, `${nome} sumiu do shared.js`);
  let i = fonte.indexOf("{", ini), prof = 0;
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") prof++;
    else if (fonte[i] === "}" && --prof === 0) break;
  }
  return fonte.slice(ini, i + 1);
}
const encaixa = new Function("getComputedStyle", `${extrai("encaixaCartaNoPainel")}; return encaixaCartaNoPainel;`)(
  (el) => ({ paddingBottom: `${el.pb}px` })
);

// Painel de mentira: rects fixos (o que importa é a conta, não o layout).
function painel({ top = 14, altura = 652, pb = 18, cartaH = 394, fimBottom, semFileira = false }) {
  const props = {};
  const rect = (r) => ({ getBoundingClientRect: () => r });
  const panel = {
    pb,
    style: { setProperty: (k, v) => { props[k] = v; } },
    getBoundingClientRect: () => ({ top, bottom: top + altura, height: altura }),
    querySelector: (sel) => {
      if (sel.startsWith(".preview-image-wrap img")) return rect({ height: cartaH });
      if (sel === ".preview-actions-row") return semFileira ? null : rect({ bottom: fimBottom });
      if (sel === ".preview-own-row") return rect({ bottom: fimBottom });
      return null;
    }
  };
  return { modal: { querySelector: (s) => (s === ".card-preview-panel" ? panel : null) }, props };
}

test("fileira passando da borda: a carta perde exatamente o que falta (largura pela moldura 63/88)", () => {
  // S10 no app (360×680): borda útil em 648, fileira terminando em 677 → faltam 29px.
  const { modal, props } = painel({ fimBottom: 677 });
  encaixa(modal);
  assert.equal(props["--carta-w"], `${Math.floor((394 - 29) * 63 / 88)}px`); // 261px
});

test("já cabe: não mexe na carta (celular alto, Android grande)", () => {
  const { modal, props } = painel({ altura: 869, fimBottom: 775 });
  encaixa(modal);
  assert.deepEqual(props, {});
});

test("tela minúscula: a carta para no piso de 45% do painel em vez de virar selo", () => {
  // Faltando 300px, a carta iria a 94px de altura; o piso segura em 0,45 × 520.
  const { modal, props } = painel({ altura: 520, cartaH: 394, fimBottom: 14 + 520 - 18 + 300 });
  encaixa(modal);
  assert.equal(props["--carta-w"], `${Math.floor(520 * 0.45 * 63 / 88)}px`);
});

test("sem a fileira Pastas / Lista (defensivo), mede pela fileira do Tenho", () => {
  const { modal, props } = painel({ fimBottom: 658, semFileira: true });
  encaixa(modal);
  assert.equal(props["--carta-w"], `${Math.floor((394 - 10) * 63 / 88)}px`);
});

test("roda DEPOIS de a ficha descer pra baixo dos botões, e só no bloco do celular", () => {
  // Medida antes, a ficha "Detalhes" (~220px) ainda estava entre a carta e os
  // botões e a carta encolhia demais (achado no ensaio: 210px em vez de 261).
  const desce = fonte.indexOf('acoes.insertAdjacentElement("afterend", det)');
  const chama = fonte.indexOf("encaixaCartaNoPainel(modal);");
  assert.ok(desce > 0 && chama > desce, "a chamada tem que vir depois da ficha descer");
  const bloco = fonte.slice(fonte.lastIndexOf("(max-width: 720px)", desce), chama);
  assert.ok(bloco.includes("(max-width: 720px)"), "mesmo corte de 720px do CSS do popup");
  // O CSS do celular usa o --carta-w e centraliza a carta (inline, encostava à esquerda).
  const regra = css.slice(css.indexOf("var(--carta-w, 100%)") - 200, css.indexOf("var(--carta-w, 100%)") + 30);
  assert.match(regra, /display: block;/);
});
