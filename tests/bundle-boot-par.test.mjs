// Régua do par theme.js+game.js (scripts/bundle-boot.mjs --check), que roda no
// CI e no deploy antes de fundir os dois no src/boot.js.
//
// O teste existe por causa de 16/09/2026: "Listas" virou "Pastas" e o
// listas.html ficou como redirecionamento puro (só um location.replace no
// <head>, sem theme.js nem game.js). A régua exigia o par de TODA página da
// raiz, então ela reprovou o redirecionamento — o deploy parou de publicar no
// passo de fundir, e o site ficou congelado no build anterior (os sets novos do
// catálogo, entre eles as duas coleções de 30 anos, não saíram).
//
// A régua segue valendo onde ela protege de verdade: página que TEM boot e
// perdeu o formato (uma tag só, ordem trocada, script de terceiro no meio) é
// erro duro — é isso que mudaria a ordem de execução sem ninguém notar.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(raiz, "scripts", "bundle-boot.mjs");

const PAGINA_COM_BOOT = `<!doctype html>
<html><head>
    <script src="src/theme.js"><\/script>
    <script src="src/game.js" data-catalog="cards"><\/script>
</head><body></body></html>`;

// Redirecionamento puro: troca de endereço no <head>, sem tema pra pintar nem
// jogo pra resolver (o listas.html de verdade).
const PAGINA_SEM_BOOT = `<!doctype html>
<html><head>
    <meta http-equiv="refresh" content="0; url=pastas">
    <script>location.replace("pastas" + location.search);<\/script>
</head><body></body></html>`;

// Meia página: tem theme.js e perdeu o game.js — o caso que a régua protege.
const PAGINA_MEIO_PAR = `<!doctype html>
<html><head>
    <script src="src/theme.js"><\/script>
</head><body></body></html>`;

// Roda o --check numa raiz de mentira; devolve { ok, saida }.
function confere(paginas) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-boot-"));
  for (const [nome, corpo] of Object.entries(paginas)) writeFileSync(join(dir, nome), corpo, "utf8");
  try {
    return { ok: true, saida: execFileSync(process.execPath, [SCRIPT, "--check"], { cwd: dir, encoding: "utf8" }) };
  } catch (e) {
    return { ok: false, saida: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

test("página de redirecionamento puro (sem theme.js e sem game.js) não reprova", () => {
  const r = confere({ "index.html": PAGINA_COM_BOOT, "listas.html": PAGINA_SEM_BOOT });
  assert.equal(r.ok, true, `--check devia passar, mas falhou:\n${r.saida}`);
  assert.match(r.saida, /listas\.html/); // sai no log, como página fora da régua
});

test("página com metade do par ainda é erro duro", () => {
  const r = confere({ "index.html": PAGINA_COM_BOOT, "meia.html": PAGINA_MEIO_PAR });
  assert.equal(r.ok, false, "--check devia reprovar a página com só uma das duas tags");
  assert.match(r.saida, /meia\.html/);
});

test("todas as páginas com o par passam", () => {
  const r = confere({ "index.html": PAGINA_COM_BOOT, "sets.html": PAGINA_COM_BOOT });
  assert.equal(r.ok, true, `--check devia passar, mas falhou:\n${r.saida}`);
  assert.match(r.saida, /2 páginas com o par/);
});

// A /games (games.html, 2026-09-30) é página ESTÁTICA do prerender que mora na
// raiz: carrega só o theme.js, de propósito, como as de set e de carta, e leva
// data-idioma-fixo no <html>. Foi ela que derrubou o primeiro preview da
// mudança pra /games, no passo de fundir.
const PAGINA_ESTATICA = `<!doctype html>
<html lang="pt-BR" data-idioma-fixo>
  <head>
    <script src="/src/theme.js"><\/script>
    <link rel="stylesheet" href="/styles.css">
  </head><body></body></html>`;

test("página estática do prerender (data-idioma-fixo) fica fora da régua", () => {
  const r = confere({ "index.html": PAGINA_COM_BOOT, "games.html": PAGINA_ESTATICA });
  assert.equal(r.ok, true, `--check devia passar, mas falhou:\n${r.saida}`);
  assert.match(r.saida, /games\.html/); // sai no log, como página fora da régua
});

test("meia página do app continua erro mesmo com uma estática ao lado", () => {
  const r = confere({ "index.html": PAGINA_COM_BOOT, "games.html": PAGINA_ESTATICA, "meia.html": PAGINA_MEIO_PAR });
  assert.equal(r.ok, false);
  assert.match(r.saida, /meia\.html/);
  assert.doesNotMatch(r.saida, /formato esperado: .*games\.html/);
});
