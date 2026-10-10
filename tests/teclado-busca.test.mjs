// "Buscar" no teclado do celular fecha o teclado (2026-10-10, teste do
// Fernando no Galaxy S10 e no iPhone): as buscas do site filtram enquanto a
// pessoa digita, então o Enter não fazia nada e o teclado seguia por cima dos
// resultados. O src/shared.js tira o foco do campo de busca no keyup do
// Enter, só em tela de toque.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

// Carrega o shared.js guardando os ouvintes que ele põe no document.
function carrega({ toque }) {
  const ouvintes = {};
  loadShared("", {
    antes(sb) {
      const mm = sb.matchMedia;
      sb.matchMedia = (q) => (q === "(pointer: coarse)" ? { ...mm(q), matches: toque } : mm(q));
      sb.document.addEventListener = (tipo, fn) => { (ouvintes[tipo] ||= []).push(fn); };
    }
  });
  return ouvintes;
}

// Campo de mentira: conta os blur.
function campo(tagName, attrs = {}) {
  const el = {
    tagName,
    type: attrs.type || "text",
    blurs: 0,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    blur() { el.blurs++; }
  };
  return el;
}

const solta = (ouvintes, key, target) => (ouvintes.keyup || []).forEach((fn) => fn({ key, target }));

test("no toque, Enter em campo de busca fecha o teclado (type=search ou enterkeyhint=search)", () => {
  const o = carrega({ toque: true });
  const pagina = campo("INPUT", { type: "search", enterkeyhint: "search" });
  const paleta = campo("INPUT", { type: "text", enterkeyhint: "search" }); // a paleta é type=text
  const semDica = campo("INPUT", { type: "search" }); // buscas montadas no JS sem enterkeyhint
  solta(o, "Enter", pagina);
  solta(o, "Enter", paleta);
  solta(o, "Enter", semDica);
  assert.deepEqual([pagina.blurs, paleta.blurs, semDica.blurs], [1, 1, 1]);
});

test("só o Enter, e só em campo de busca: nome de pasta, textarea e outras teclas ficam", () => {
  const o = carrega({ toque: true });
  const busca = campo("INPUT", { type: "search" });
  const nome = campo("INPUT", { type: "text" });
  const texto = campo("TEXTAREA", { enterkeyhint: "search" });
  solta(o, "a", busca);
  solta(o, "Enter", nome);
  solta(o, "Enter", texto);
  solta(o, "Enter", null);
  assert.deepEqual([busca.blurs, nome.blurs, texto.blurs], [0, 0, 0]);
});

test("é no keyup: o keydown fica livre pro ouvinte da página e pro envio do formulário", () => {
  // Um blur no keydown tiraria o foco antes do keypress, que é de onde nasce
  // o envio do <form> da busca do topo — a busca não aconteceria.
  const o = carrega({ toque: true });
  assert.equal((o.keyup || []).length, 1);
  const busca = campo("INPUT", { type: "search" });
  (o.keydown || []).forEach((fn) => fn({ key: "Enter", target: busca, preventDefault() {} }));
  assert.equal(busca.blurs, 0);
});

test("com mouse (desktop) o Enter não mexe no foco: a pessoa continua digitando", () => {
  const o = carrega({ toque: false });
  assert.equal((o.keyup || []).length, 0);
});
