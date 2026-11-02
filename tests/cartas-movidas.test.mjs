// Registro das cartas que mudaram de SET (2026-11-02, scripts/lib/
// cartas-movidas.mjs): o que entra, como o prerender resolve no catálogo de
// hoje e onde o deploy roda. O 301 na borda, de ponta a ponta, está no
// tests/games-rota.test.mjs.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agrupaPorSet, paginasDoJogo, enderecosDasCartas } from "../scripts/lib/paginas-de-set.mjs";
import { cartasQueMudaramDeSet, juntaNoRegistro, destinosDasMovidas } from "../scripts/lib/cartas-movidas.mjs";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DC1 = "Data Carddass — ナルティメットカードバトル 第１弾";
const DC2 = "Data Carddass — ナルティメットカードバトル 第２弾";
const dc = (id, name, number, set, setId, extra) => ({ id, name, number, set, setId, language: "ja", ...extra });
const BASE = [
  dc("nrt-dc-dn-001", "Naruto Uzumaki", "DN-001", DC1, "nrt-dc-s01"),
  dc("nrt-dc-dn-051", "Nine-Tails Naruto", "DN-051", DC1, "nrt-dc-s01"),
  dc("nrt-dc-dn-101", "Sasuke Uchiha", "DN-101", DC2, "nrt-dc-s02")
];
const troca = (cards, id, mudanca) => cards.map((c) => (c.id === id ? { ...c, ...mudanca } : c));

test("a página de set e o endereço da carta saem com a régua do prerender", () => {
  const paginas = paginasDoJogo("naruto", agrupaPorSet([...BASE, dc("nrt-dc-x", "Aposentada", "X-1", DC1, "nrt-dc-s01", { retired: true })]));
  assert.deepEqual(paginas.map((p) => `${p.url}/${p.slug}`), ["naruto-data-carddass/data-carddass-1", "naruto-data-carddass/data-carddass-2"]);
  const enderecos = enderecosDasCartas(paginas);
  assert.equal(enderecos.get("naruto|nrt-dc-dn-051"), "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp");
  assert.equal(enderecos.has("naruto|nrt-dc-x"), false, "aposentada não forma página");
  // O prerender usa esta mesma função (a régua copiada divergiria no 1º ajuste).
  assert.match(ler("scripts/prerender-catalog.mjs"), /paginasDoJogo\(game, byName,/);
});

test("entra só a carta que foi pra OUTRO set que segue existindo", () => {
  const movida = troca(BASE, "nrt-dc-dn-051", { set: DC2, setId: "nrt-dc-s02" });
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, movida),
    { "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051" });
  // Mudou de endereço dentro do set (nome, número): o cartaParecida resolve.
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, troca(BASE, "nrt-dc-dn-051", { name: "Kyubi Naruto" })), {});
  // Carta nova e carta que saiu do catálogo: nada a redirecionar.
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, [...BASE, dc("nrt-dc-dn-052", "Kakashi", "DN-052", DC1, "nrt-dc-s01")]), {});
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, BASE.slice(1)), {});
  // Set renomeado: TODAS as cartas mudam de set, e o antigo deixa de existir.
  // É caso do setRenomeado; registrar carta por carta incharia o mapa.
  const renomeado = BASE.map((c) => (c.set === DC2 ? { ...c, set: "Data Carddass — Card Battle Vol. 2" } : c));
  assert.deepEqual(cartasQueMudaramDeSet("naruto", BASE, renomeado), {});
});

test("o registro junta em ordem, e o mesmo endereço fica com a carta mais recente", () => {
  const r = juntaNoRegistro({ "j/b/x": "id-1", "j/a/y": "id-2" }, { "j/b/x": "id-3", "j/0/z": "id-4" });
  assert.deepEqual(Object.keys(r), ["j/0/z", "j/a/y", "j/b/x"]);
  assert.equal(r["j/b/x"], "id-3");
  assert.deepEqual(juntaNoRegistro(null, null), {});
});

test("o prerender resolve o registro no catálogo de hoje", () => {
  const registro = {
    // Mudou duas vezes (1 -> 2 -> 3): os dois endereços antigos vão pro de hoje.
    "naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051",
    "naruto-data-carddass/data-carddass-2/nine-tails-naruto-dn-051-jp": "nrt-dc-dn-051",
    // O endereço antigo voltou a ser de uma carta: ela vence, sem 301.
    "naruto-data-carddass/data-carddass-1/naruto-uzumaki-dn-001-jp": "nrt-dc-dn-101",
    // Id que saiu do catálogo, endereço torto e jogo que não existe: fora.
    "naruto-data-carddass/data-carddass-1/sumiu-dn-999-jp": "nrt-dc-dn-999",
    "naruto-data-carddass/data-carddass-1": "nrt-dc-dn-051",
    "nao-existe/x/y": "nrt-dc-dn-051"
  };
  const DC3 = "Data Carddass — ナルティメットカードバトル 第３弾";
  const hoje = troca(BASE, "nrt-dc-dn-051", { set: DC3, setId: "nrt-dc-s03" });
  const porUrl = destinosDasMovidas(registro, paginasDoJogo("naruto", agrupaPorSet(hoje)));
  assert.deepEqual([...porUrl.keys()], ["naruto-data-carddass"]);
  assert.deepEqual(porUrl.get("naruto-data-carddass"), {
    "data-carddass-1/nine-tails-naruto-dn-051-jp": "naruto-data-carddass/data-carddass-3/nine-tails-naruto-dn-051-jp",
    "data-carddass-2/nine-tails-naruto-dn-051-jp": "naruto-data-carddass/data-carddass-3/nine-tails-naruto-dn-051-jp"
  });
  // A carta que voltou pro endereço registrado não ganha 301 pra si mesma.
  assert.equal(destinosDasMovidas(registro, paginasDoJogo("naruto", agrupaPorSet(BASE))).get("naruto-data-carddass")["data-carddass-1/nine-tails-naruto-dn-051-jp"], undefined);
});

// As 39 cartas que a PR #224 trocou entre o 第1弾 e o 第2弾. Antes dela entrar,
// cada chave é o endereço vivo da própria carta (o prerender não gera 301);
// depois, é 301 pro set novo.
test("o registro versionado traz as cartas do Data Carddass da #224", () => {
  const registro = JSON.parse(ler("data/cartas-movidas.json"));
  assert.equal(registro["naruto-data-carddass/data-carddass-1/nine-tails-naruto-dn-051-jp"], "nrt-dc-dn-051");
  assert.ok(Object.keys(registro).length >= 39);
  for (const [chave, id] of Object.entries(registro)) {
    const partes = chave.split("/");
    assert.equal(partes.length, 3, chave);
    assert.ok(jogoDaUrl(partes[0]), `jogo desconhecido: ${chave}`);
    assert.match(partes[1] + "/" + partes[2], /^[a-z0-9-]+\/[a-z0-9-]+$/, chave);
    assert.ok(typeof id === "string" && id, chave);
  }
  assert.deepEqual(Object.keys(registro), [...Object.keys(registro)].sort(), "em ordem (o diff do snapshot fica limpo)");
});

// O registro compara o disco com o HEAD. Depois do commit do snapshot o HEAD
// já é o catálogo novo e nada mais muda de set: o passo tem que vir ANTES, e
// o commit tem que levar o arquivo junto.
test("o deploy registra entre o lint e o commit do snapshot, e não publica o registro", () => {
  const deploy = ler(".github/workflows/deploy.yml");
  const lint = deploy.indexOf("run: node scripts/lint-catalog.mjs");
  const registra = deploy.indexOf("run: node scripts/registra-cartas-movidas.mjs");
  const snapshot = deploy.indexOf("- name: Versiona snapshot do catálogo");
  const prerender = deploy.indexOf("run: node scripts/prerender-catalog.mjs");
  assert.ok(lint > 0 && registra > lint && snapshot > registra && prerender > snapshot, "ordem: lint, registro, snapshot, prerender");
  assert.match(deploy.slice(snapshot, prerender), /git add data /, "o snapshot leva data/ (e o registro junto)");
  const remove = /- name: Remove arquivos que não vão para o site[\s\S]*?\n\s*rm -rf ([^\n]+)/.exec(deploy);
  assert.ok(remove && remove[1].split(/\s+/).includes("data/cartas-movidas.json"));
});
