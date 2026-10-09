// Tela de Sets (2026-10-08): custo que crescia com o tamanho da coleção.
// 1. owned.size percorre a coleção inteira (dois arrays por carta) e a
//    Vitrine o lia em CADA cartão de set: medido em Node, 12, 76 e 338 ms por
//    página de 60 cartões com 1, 5 e 20 mil cartas. Agora uma conta por render.
// 2. O "refino de valor" baixava, em série, o chunk de todo set visível com
//    carta sua e redesenhava a grade inteira — pra um valor que só muda com
//    preço MANUAL e que nem aparece na grade do celular. Conferido em
//    produção com 4.470 cartas em 150 sets e um preço manual: 39 chunks antes;
//    agora 1 no desktop (o do set com preço manual, mesmo valor final) e 0 na
//    grade do celular.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(raiz, "src/app.js"), "utf8");

function corpo(nome) {
  const i = app.search(new RegExp(`^ {2}(?:async )?function ${nome}\\s*\\(`, "m"));
  assert.ok(i >= 0, `${nome} existe`);
  return app.slice(i, app.indexOf("\n  }\n", i) + 4);
}

test("o tamanho da coleção é contado uma vez por render, não por cartão", () => {
  assert.ok(corpo("render").includes("tamanhoDaColecao = null;"));
  for (const nome of ["createSetCard", "createHero"]) {
    const c = corpo(nome);
    assert.ok(!c.includes("owned.size"), `${nome} voltou a ler owned.size`);
  }
  assert.ok(corpo("createSetCard").includes("const semColecao = !colecaoTem();"));
});

test("o refino de valor só baixa set com preço manual, só quando o valor aparece, e não redesenha a grade", () => {
  const refino = corpo("refineVisibleSets");
  assert.ok(refino.includes("if (!manifestMode() || !valorAparece()) return;"));
  assert.ok(refino.includes("const manuais = idsComPrecoManual();") && refino.includes("if (!manuais.size) return;"));
  assert.ok(refino.includes(".some((id) => manuais.has(id))"));
  assert.ok(refino.includes("pintaValor(key, value);"));
  assert.ok(!/\brender\(/.test(refino), "o refino voltou a redesenhar a grade inteira");
  const aparece = corpo("valorAparece");
  assert.ok(aparece.includes('"(max-width: 720px)"') && aparece.includes('"is-list"') && aparece.includes('"data-collector-mode"'));
});
