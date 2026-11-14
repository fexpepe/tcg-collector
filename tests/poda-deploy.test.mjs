// Poda do deploy (scripts/poda-deploy.mjs + scripts/lib/poda-deploy.mjs): o
// que sai da árvore que sobe pro Cloudflare Pages porque nada no site pede.
//
// Existe por causa de 14/11/2026: a main chegou a 18.903 arquivos (o Pages
// recusa acima de 20.000; a guarda do deploy.yml falha acima de 19.000) e
// uns 750 deles subiam sem uso. As amarras daqui de baixo são as que, se
// soltarem, apagam do ar um arquivo que alguém pede: o lado GERADO que o
// game.js e o shared.js carregam em produção tem de ser o mesmo que a poda
// preserva, e o healthcheck não pode conferir um arquivo que a poda tira.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PARES_CRUS, crusDoModoDev, juntaReferencias, logosSemUso, novasReferencias } from "../scripts/lib/poda-deploy.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checkout Windows (autocrlf) traz CRLF; as regras abaixo comparam com LF.
const ler = (rel) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

// ── Crus do modo dev ────────────────────────────────────────────────────────

test("crus: sai o cru que tem o par gerado do lado, só em pasta com manifest", () => {
  const pasta = [
    "manifest.generated.js", "cards.js",
    "indexes.generated.js", "indexes.js",
    "pricing.generated.js", "pricing.js",
    "indexes-sets.json", "indexes-sets.generated.json",
    "indexes-artists.json", // sem o par gerado: fica
    "search-index.json", "cmdk-names.generated.json", "price-history.generated.json"
  ];
  assert.deepEqual(crusDoModoDev(pasta), ["cards.js", "indexes-sets.json", "indexes.js", "pricing.js"]);
  // Sem o manifest.generated.js a pasta não está em modo manifest: nada sai.
  assert.deepEqual(crusDoModoDev(pasta.filter((n) => n !== "manifest.generated.js")), []);
  // O cru sem o par (o pricing.generated.js não foi escrito) fica.
  assert.deepEqual(crusDoModoDev(["manifest.generated.js", "cards.js", "pricing.js"]), ["cards.js"]);
});

test("crus: o lado gerado que a poda preserva é o que produção e app carregam", () => {
  // src/game.js: o FILE de cada dataset no modo manifest.
  const game = ler("src/game.js");
  const doGame = new Map([...game.matchAll(/"[a-z-]+":\s*MANIFEST \? "([^"]+)"\s*: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const [cru, gerado] of PARES_CRUS) {
    assert.equal(doGame.get(cru), gerado, `src/game.js: em modo manifest o ${cru} virou outro arquivo que não ${gerado} — a poda apagaria o que a página pede`);
  }
  assert.match(game, /"indexes-" \+ key \+ \(MANIFEST \? "\.generated\.json" : "\.json"\)/,
    "src/game.js: a fatia de índice em modo manifest deixou de ser indexes-<chave>.generated.json");
  // src/shared.js: a carga cruzada de jogos (loadGameCatalog).
  const shared = ler("src/shared.js");
  assert.match(shared, /manifestMode\s*\?\s*\["manifest\.generated\.js", "indexes\.generated\.js"\]\s*:\s*\["cards\.js", "indexes\.js"\]/,
    "src/shared.js: a carga cruzada mudou de arquivo — confira a poda (scripts/lib/poda-deploy.mjs)");
  assert.match(shared, /manifestMode \? "pricing\.generated\.js" : "pricing\.js"/);
});

test("deploy.yml: a poda roda com o MANIFEST ligado, depois do hash e antes do rm e da conta", () => {
  const yml = ler(".github/workflows/deploy.yml");
  const pos = (s) => { const i = yml.indexOf(s); assert.ok(i >= 0, `deploy.yml sem "${s}"`); return i; };
  const manifest = pos("sed -i 's|var MANIFEST = false|var MANIFEST = true|' src/game.js");
  const prerender = pos("run: node scripts/prerender-catalog.mjs");
  const hash = pos("run: node scripts/hash-assets.mjs");
  const poda = pos("run: node scripts/poda-deploy.mjs");
  const rm = pos("- name: Remove arquivos que não vão para o site");
  const conta = pos("- name: Conta arquivos (teto de 20.000 do Pages)");
  assert.ok(manifest < poda && prerender < poda && hash < poda, "a poda tem de rodar depois de tudo que lê data/");
  assert.ok(poda < rm, "a poda tem de rodar antes do rm, que apaga scripts/");
  assert.ok(rm < conta);
});

test("healthcheck e uptime não conferem arquivo que a poda tira do ar", () => {
  for (const arq of ["scripts/healthcheck.mjs", ".github/workflows/uptime.yml"]) {
    const t = ler(arq);
    const crus = [...t.matchAll(/["'/](?:cards|indexes|pricing)\.js["']|indexes-[a-z]+\.json/g)].map((m) => m[0]);
    assert.deepEqual(crus, [], `${arq} pede arquivo cru do modo dev (${crus.join(", ")}), que não sobe mais`);
  }
});

// ── Logos de set ────────────────────────────────────────────────────────────

test("logos: referências saem do JSON, de URL absoluta, de caminho relativo e com escape", () => {
  const refs = novasReferencias();
  juntaReferencias('[{"id":"10e-1","setLogo":"data/magic/set-logos/10e.svg"},{"setLogo":"data/magic/set-logos/con_.svg"}]', refs);
  juntaReferencias('<img src="https://sleevu.app/data/set-logos/en/sv1.png" alt="">', refs);
  juntaReferencias('{"logo":"set-logos/solto.webp"}', refs);
  juntaReferencias('"data/set-logos/ja/%E3%81%82.png" e data/fab/set-logos/1HB.webp?v=2.', refs);
  assert.deepEqual([...refs.cheias].sort(), [
    "data/fab/set-logos/1HB.webp",
    "data/magic/set-logos/10e.svg",
    "data/magic/set-logos/con_.svg",
    "data/set-logos/en/sv1.png",
    "data/set-logos/ja/あ.png"
  ]);
  assert.deepEqual([...refs.soltas], ["solto.webp"]);
});

test("logos: sai só o que ninguém cita, e na dúvida fica", () => {
  const refs = novasReferencias();
  juntaReferencias('"data/magic/set-logos/10e.svg" "set-logos/solto.svg" "data/set-logos/en/sv1.png"', refs);
  const logos = [
    "data/magic/set-logos/10e.svg", // citado
    "data/magic/set-logos/aa1.svg", // ninguém cita: sai
    "data/magic/set-logos/solto.svg", // citado solto (sem data/ antes): fica
    "data/magic/set-logos/com espaço.svg", // nome que pediria escape: fica
    "data/set-logos/en/sv1.png",
    "data/set-logos/ja/x.png", // a pasta inteira sairia: segura
    "data/set-logos/ja/y.png"
  ];
  const { sai, resumo } = logosSemUso(logos, refs);
  assert.deepEqual(sai, ["data/magic/set-logos/aa1.svg"]);
  assert.deepEqual(resumo, [
    { pasta: "data/magic/set-logos/", sai: 1, total: 4, segurou: false },
    { pasta: "data/set-logos/ja/", sai: 0, total: 2, segurou: true }
  ]);
  // Varredura vazia (nenhuma referência achada): algo deu errado, nada sai.
  assert.deepEqual(logosSemUso(logos, novasReferencias()).sai, []);
});

// ── O script de ponta a ponta, numa raiz de mentira ─────────────────────────

function montaRaiz() {
  const dir = mkdtempSync(join(tmpdir(), "poda-deploy-"));
  const arquivos = {
    "data/manifest.generated.js": 'window.TCG_MANIFEST = {"sets":[{"file":"data/sets/en/base1.json","logo":"data/set-logos/en/base1.png"}]};',
    "data/cards.js": "window.TCG_CARDS = [];",
    "data/indexes.js": "window.TCG_INDEXES = {};",
    "data/indexes.generated.js": "window.TCG_INDEXES = {};",
    "data/pokemon-names.js": "window.X = {};",
    "data/sets/en/base1.json": "[]",
    "data/set-logos/en/base1.png": "png",
    "data/set-logos/en/orfao.png": "png",
    "data/magic/manifest.generated.js": "window.TCG_MANIFEST = {\"sets\":[]};",
    "data/magic/pricing.js": "window.TCG_PRICING = {};",
    "data/magic/pricing.generated.js": "window.TCG_PRICING = {};",
    "data/magic/indexes-sets.json": "{}",
    "data/magic/indexes-sets.generated.json": "{}",
    "data/magic/sets/10e.json": '[{"setLogo":"data/magic/set-logos/10e.svg"}]',
    "data/magic/set-logos/10e.svg": "<svg/>",
    "data/magic/set-logos/aa1.svg": "<svg/>",
    "data/naruto/cards.js": "window.TCG_CARDS = [];", // sem manifest: fica
    "games/magic/10th-edition-en.html": '<img src="/data/magic/set-logos/10e.svg">',
    "index.html": "<!doctype html>"
  };
  for (const [nome, corpo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(dir, nome)), { recursive: true });
    writeFileSync(join(dir, nome), corpo, "utf8");
  }
  return dir;
}
const roda = (dir, ...args) => execFileSync(process.execPath, [join(RAIZ, "scripts", "poda-deploy.mjs"), ...args], { cwd: dir, encoding: "utf8" });

test("poda-deploy.mjs: apaga crus e logos sem uso, e o --dry-run não apaga nada", () => {
  const dir = montaRaiz();
  try {
    const ensaio = roda(dir, "--dry-run");
    assert.match(ensaio, /ensaio, nada apagado/);
    assert.ok(existsSync(join(dir, "data/cards.js")) && existsSync(join(dir, "data/magic/set-logos/aa1.svg")));

    const saida = roda(dir);
    assert.match(saida, /4 arquivo\(s\) crus do modo dev em 2 pasta\(s\) de jogo \+ 2 logo\(s\) de set sem referência de 4/);
    const some = ["data/cards.js", "data/indexes.js", "data/magic/pricing.js", "data/magic/indexes-sets.json",
      "data/magic/set-logos/aa1.svg", "data/set-logos/en/orfao.png"];
    const fica = ["data/manifest.generated.js", "data/indexes.generated.js", "data/pokemon-names.js", "data/naruto/cards.js",
      "data/magic/pricing.generated.js", "data/magic/indexes-sets.generated.json", "data/magic/set-logos/10e.svg",
      "data/set-logos/en/base1.png", "data/sets/en/base1.json"];
    for (const f of some) assert.ok(!existsSync(join(dir, f)), `${f} devia ter saído`);
    for (const f of fica) assert.ok(existsSync(join(dir, f)), `${f} devia ter ficado`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
