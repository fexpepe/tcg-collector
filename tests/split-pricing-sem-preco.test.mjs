// Jogo SEM preço não grava chunk de preço (2026-11-14). Os vintage, o Naruto
// Mythos e a Kayou ganhavam um "{}" por set (471 arquivos no deploy de 14/11)
// e tiravam o espaço do Dragon Ball Super Masters debaixo do teto de 18.000
// do "Conta arquivos". O teste roda o split-pricing DE VERDADE numa cópia
// mínima do repositório: um jogo com preço (mantém os chunks e a flag `pc`) e
// um sem (nenhum chunk e o manifest sem `pc`, mesmo que viesse com ela do
// cache do build anterior).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function copiaMinima() {
  const dir = mkdtempSync(join(tmpdir(), "split-pricing-"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  copyFileSync(join(raiz, "scripts", "split-pricing.mjs"), join(dir, "scripts", "split-pricing.mjs"));
  for (const f of ["sync-common.mjs", "history-shards.mjs", "bonus-cards.mjs", "pricing.mjs"]) {
    copyFileSync(join(raiz, "scripts", "lib", f), join(dir, "scripts", "lib", f));
  }
  return dir;
}

function jogo(dir, slug, { cartas, precos, manifestExtra = {} }) {
  const base = join(dir, "data", slug);
  mkdirSync(join(base, "sets"), { recursive: true });
  writeFileSync(join(base, "sets", "S1.json"), JSON.stringify(cartas));
  const manifest = { sets: [{ id: "S1", name: "Set 1", file: `data/${slug}/sets/S1.json` }], ...manifestExtra };
  writeFileSync(join(base, "manifest.generated.js"), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`);
  writeFileSync(join(base, "pricing.generated.js"), `window.TCG_PRICING = ${JSON.stringify(precos)};\n`);
}

const manifestDe = (dir, slug) => {
  const t = readFileSync(join(dir, "data", slug, "manifest.generated.js"), "utf8");
  return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
};

test("jogo sem preço: nenhum chunk de preço e o manifest sem pc; jogo com preço segue igual", () => {
  const dir = copiaMinima();
  try {
    // dbc (vintage, sem preço) chega com pc e hs de um build antigo, e com o
    // chunk "{}" que o build antigo gravou.
    jogo(dir, "dbc", { cartas: [{ id: "dbc-h01-1", setId: "S1" }], precos: {}, manifestExtra: { pc: 1, hs: 4 } });
    mkdirSync(join(dir, "data", "dbc", "pricing-chunks"), { recursive: true });
    writeFileSync(join(dir, "data", "dbc", "pricing-chunks", "S1.json"), "{}");
    jogo(dir, "fab", { cartas: [{ id: "fab-1", setId: "S1" }, { id: "fab-2", setId: "S1" }], precos: { "fab-1": { u: 2.5 } } });

    const log = execFileSync(process.execPath, [join(dir, "scripts", "split-pricing.mjs")], { cwd: dir, encoding: "utf8" });
    assert.match(log, /data\/dbc\/ — sem preço/);

    assert.equal(existsSync(join(dir, "data", "dbc", "pricing-chunks")), false, "o chunk vazio antigo tem de sumir");
    const mDbc = manifestDe(dir, "dbc");
    assert.equal("pc" in mDbc, false);
    assert.equal("hs" in mDbc, false);
    assert.equal(mDbc.sets.length, 1);

    const chunk = JSON.parse(readFileSync(join(dir, "data", "fab", "pricing-chunks", "S1.json"), "utf8"));
    assert.deepEqual(chunk, { "fab-1": { u: 2.5 } });
    assert.equal(manifestDe(dir, "fab").pc, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
