// Trava do live update do app (scripts/lib/trava-live-update.mjs). Cada teste
// tenta abrir um caminho que a trava fecha — gatilho automático, job sem o
// ambiente, `confere` sem dente, CLI do Capgo em outro arquivo — e confere que
// o check.mjs quebraria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTA, gatilhos, confereTravaLiveUpdate, arquivosDeAutomacao } from "../scripts/lib/trava-live-update.mjs";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
// Checkout Windows (autocrlf) traz CRLF; as trocas abaixo assumem LF.
const PORTA_REAL = readFileSync(join(RAIZ, PORTA), "utf8").replace(/\r\n/g, "\n");

const so = (texto) => confereTravaLiveUpdate({ [PORTA]: texto });
const troca = (de, para) => {
  assert.ok(PORTA_REAL.includes(de), `o teste procura um trecho que sumiu da porta: ${de}`);
  return PORTA_REAL.replace(de, para);
};
const acusa = (erros, pedaco) => assert.ok(
  erros.some((e) => e.includes(pedaco)),
  `esperava um erro com "${pedaco}", veio: ${JSON.stringify(erros, null, 2)}`
);

test("o repositório como está passa na trava", () => {
  assert.deepEqual(confereTravaLiveUpdate(arquivosDeAutomacao(RAIZ)), []);
});

test("a porta como está passa sozinha", () => {
  assert.deepEqual(so(PORTA_REAL), []);
});

test("gatilhos: bloco, lista inline, valor solto e lista em bloco", () => {
  assert.deepEqual(gatilhos("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n"), ["push", "workflow_dispatch"]);
  assert.deepEqual(gatilhos("on: [push, workflow_dispatch]\n"), ["push", "workflow_dispatch"]);
  assert.deepEqual(gatilhos("on: workflow_dispatch # só à mão\n"), ["workflow_dispatch"]);
  assert.deepEqual(gatilhos("on:\n  - push\n  - workflow_dispatch\n"), ["push", "workflow_dispatch"]);
  assert.deepEqual(gatilhos("name: x\n"), []);
});

test("gatilho automático na porta quebra: push, tag, cron, lista inline", () => {
  acusa(so(troca("on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:")), "SÓ workflow_dispatch");
  acusa(so(troca("on:\n  workflow_dispatch:", "on:\n  push:\n    tags: ['v*']\n  workflow_dispatch:")), "SÓ workflow_dispatch");
  acusa(so(troca("on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:")), "SÓ workflow_dispatch");
  acusa(so(troca("on:\n  workflow_dispatch:", "on:\n  workflow_run:\n    workflows: [Deploy]\n  workflow_dispatch:")), "SÓ workflow_dispatch");
  const inline = PORTA_REAL.replace(/^on:\n(?:[ \t]+.*\n|\n)*/m, "on: [push, workflow_dispatch]\n");
  acusa(so(inline), "SÓ workflow_dispatch");
});

test("sem o campo de confirmação quebra", () => {
  acusa(so(troca("      confirmacao:", "      confirma:")), "confirmacao");
});

test("publicar fora do ambiente ou sem depender do confere quebra", () => {
  acusa(so(troca("    environment: app-live-update\n", "")), "fora do ambiente");
  acusa(so(troca("    needs: confere\n", "")), "sem `needs: confere`");
  acusa(so(troca("    needs: confere\n", "    needs: [outro]\n")), "sem `needs: confere`");
});

test("needs em lista e environment em mapa continuam valendo", () => {
  const lista = troca("    needs: confere\n", "    needs:\n      - confere\n");
  assert.deepEqual(so(lista), []);
  const mapa = troca("    environment: app-live-update\n", "    environment:\n      name: app-live-update\n");
  assert.deepEqual(so(mapa), []);
});

test("desvio que publica com o confere vermelho quebra", () => {
  acusa(so(troca("    needs: confere\n", "    needs: confere\n    if: ${{ always() }}\n")), "always()");
  acusa(so(troca("    needs: confere\n", "    needs: confere\n    if: ${{ !cancelled() }}\n")), "always()");
  acusa(so(troca("      - name: Confere o pedido\n", "      - name: Confere o pedido\n        continue-on-error: true\n")), "continue-on-error");
});

test("confere sem dente quebra: cada checagem conta", () => {
  // Apaga o `if` e deixa o echo: a mensagem de erro sozinha não engana a guarda.
  acusa(so(troca('if [ "$CONFIRMACAO" != "PUBLICAR" ]; then', 'if false; then')), "palavra PUBLICAR");
  acusa(so(troca('if [ "$GITHUB_REF" != "refs/heads/main" ]; then', 'if false; then')), "pedido só da main");
  acusa(so(troca("*,required_reviewers,*)", "*)")), "aprovação manual");
  acusa(so(troca("bypass=$(printf '%s' \"$dados\" | jq -r '.can_admins_bypass'", "bypass=$(echo false")), "admin sem atalho");
  acusa(so(troca("  confere:\n", "  confere-velho:\n")), "sumiu o job `confere`");
});

test("segredo no confere ou no topo do workflow quebra", () => {
  acusa(so(troca("          CONFIRMACAO: ${{ inputs.confirmacao }}\n",
    "          CONFIRMACAO: ${{ inputs.confirmacao }}\n          T: ${{ secrets.CAPGO_TOKEN }}\n")), "roda ANTES da aprovação");
  acusa(so(troca("permissions:\n  contents: read\n", "permissions:\n  contents: read\n\nenv:\n  T: ${{ secrets.CAPGO_TOKEN }}\n")), "env do topo");
});

test("CLI, token ou ambiente do Capgo fora da porta quebram", () => {
  const casos = {
    ".github/workflows/deploy.yml": "jobs:\n  x:\n    steps:\n      - run: npx --yes @capgo/cli@8.64.1 bundle upload\n",
    "codemagic.yaml": "workflows:\n  ios:\n    environment:\n      vars:\n        T: $CAPGO_TOKEN\n",
    ".github/workflows/sem-sufixo.yml": "jobs:\n  x:\n    env:\n      T: ${{ secrets.CAPGO }}\n",
    ".github/workflows/outro.yml": "jobs:\n  x:\n    environment: app-live-update\n",
    "package.json (scripts)": JSON.stringify({ "app:publica": "capgo bundle upload --channel production" }),
    "scripts/publica.mjs": "execSync('npx @capgo/cli bundle upload')\n"
  };
  const erros = confereTravaLiveUpdate(casos);
  for (const caminho of Object.keys(casos)) acusa(erros, caminho);
});

test("dependência do plugin (e da CLI) no package.json não conta; só o comando nos scripts", () => {
  const raiz = mkdtempSync(join(tmpdir(), "trava-live-update-"));
  try {
    writeFileSync(join(raiz, "package.json"), JSON.stringify({
      scripts: { "app:web": "node scripts/app-web.mjs" },
      dependencies: { "@capgo/capacitor-updater": "7.0.0" },
      devDependencies: { "@capgo/cli": "8.64.1" }
    }));
    mkdirSync(join(raiz, ".github/workflows"), { recursive: true });
    writeFileSync(join(raiz, ".github/workflows/ci.yml"), "on:\n  push:\njobs:\n  t:\n    runs-on: ubuntu-latest\n");
    assert.deepEqual(confereTravaLiveUpdate(arquivosDeAutomacao(raiz)), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
