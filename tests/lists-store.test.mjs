// Testes do store de Listas e do merge de sync (src/shared.js), via sandbox de
// vm (tests/lib/shared-sandbox.mjs). Roda com: node --test tests/
// Ver docs/LISTAS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

// O shared.js roda dentro de um vm: arrays criados lá têm OUTRO Array.prototype,
// e deepStrictEqual compara protótipo. Array.from traz o valor pro realm daqui.
const arr = (x) => Array.from(x || []);

function fresh(seed) {
  const ls = makeLocalStorage(seed);
  const sb = loadShared(
    "window.__test = { createListStore, mergeLists, mergeData, readTagsData };",
    { localStorage: ls }
  );
  return { ls, api: sb.window.__test, flush: sb.__flushTimers };
}

const LISTS_KEY = "tcg-collector-lists-all-v1";

test("create: aplica defaults, corta o nome e recusa cor inválida", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "  " + "x".repeat(60) + "  ", color: "javascript:alert(1)", game: "magic" });
  assert.equal(l.name.length, 40, "nome cortado em 40");
  assert.equal(l.color, "#3b6fe0", "cor inválida cai no default");
  assert.equal(l.game, "magic");
  assert.equal(l.linked, false, "avulsa é o default (nunca mexe na coleção sem pedir)");
  assert.equal(l.entries.length, 0);
});

test("addEntry: soma no mesmo par (carta, variante) e separa variantes", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "Hobbit" });
  st.addEntry(l.id, "mtg-hob-283", { v: "Foil", c: "NM" });
  st.addEntry(l.id, "mtg-hob-283", { v: "Foil", q: 2 });
  st.addEntry(l.id, "mtg-hob-283", { v: "Normal" });

  assert.equal(l.entries.length, 2, "Foil e Normal são linhas distintas");
  assert.equal(st.entry(l.id, "mtg-hob-283", "Foil").q, 3, "somou 1+2");
  assert.equal(st.countOf(l.id), 4, "3 foil + 1 normal");
});

test("setEntryQty: zero remove a linha", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "x" });
  st.addEntry(l.id, "op-705924", { v: "Foil", q: 5 });
  st.setEntryQty(l.id, "op-705924", "Foil", 0);
  assert.equal(l.entries.length, 0);
});

test("marcador (v nulo) casa com qualquer variante — é a forma migrada das tags", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "vinda de tag" });
  st.addEntry(l.id, "swsh5-1", { v: null });

  assert.equal(st.has(l.id, "swsh5-1", "Reverse"), true, "marcador cobre a variante");
  assert.equal(st.has(l.id, "swsh5-1", null), true);
  assert.deepEqual(arr(st.listsWith("swsh5-1", "Holo")), [l.id]);

  // Desmarcar a partir de um tile com variante remove o marcador (senão o
  // check do popover ficava aceso sem jeito de apagar).
  assert.equal(st.toggleEntry(l.id, "swsh5-1", { v: "Reverse" }), false);
  assert.equal(st.has(l.id, "swsh5-1", "Reverse"), false);
});

test("toggleEntry: liga e desliga o par exato", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "x" });
  assert.equal(st.toggleEntry(l.id, "1-1", { v: "Foil" }), true);
  assert.equal(st.toggleEntry(l.id, "1-1", { v: "Foil" }), false);
  assert.equal(st.entriesOf(l.id).length, 0);
});

test("sem variante (tile agrupado) opera no nível da CARTA — direção inversa do marcador", () => {
  const { api } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "x" });
  st.addEntry(l.id, "base1-4", { v: "Foil", q: 2 });

  // Pergunta sem variante enxerga a entrada Foil (antes: desmarcado no popover
  // agrupado, e o clique criava um marcador DUPLICADO — countOf virava 3).
  assert.equal(st.has(l.id, "base1-4", null), true, "entrada com variante conta no nível da carta");
  assert.deepEqual(arr(st.listsWith("base1-4", null)), [l.id]);

  // Desmarcar sem variante remove TODAS as entradas da carta (é o que o
  // checkbox afirma), não cria segundo registro.
  assert.equal(st.toggleEntry(l.id, "base1-4", { v: null }), false);
  assert.equal(st.entriesOf(l.id).length, 0, "Foil saiu junto — nada de marcador extra");

  // E marcar de novo sem variante cria o marcador normalmente.
  assert.equal(st.toggleEntry(l.id, "base1-4", { v: null }), true);
  assert.equal(st.countOf(l.id), 1);
});

test("remove: deixa tombstone e persiste no localStorage", () => {
  const { ls, api, flush } = fresh();
  const st = api.createListStore();
  const l = st.create({ name: "some" });
  st.remove(l.id);
  flush();
  const raw = JSON.parse(ls._dump()[LISTS_KEY]);
  assert.equal(raw.lists.length, 0);
  assert.ok(raw.deleted[l.id] > 0, "tombstone gravado (senão a lista volta do outro device)");
});

test("store é instância única por página (popover do tile e página de listas)", () => {
  const { api } = fresh();
  const a = api.createListStore();
  const b = api.createListStore();
  const l = a.create({ name: "compartilhada" });
  assert.equal(b.get(l.id).name, "compartilhada", "b enxerga o que a criou");
  assert.equal(b.list().length, 1);
});

test("blob corrompido não derruba o store", () => {
  const { api } = fresh({ [LISTS_KEY]: "{{{não é json" });
  const st = api.createListStore();
  assert.equal(st.list().length, 0);
  assert.ok(st.create({ name: "nova" }), "segue utilizável");
});

test("mergeLists: LWW POR LISTA — editar listas diferentes em 2 devices não perde", () => {
  const { api } = fresh();
  const local = {
    lists: [
      { id: "ls_a", name: "A editada no PC", updatedAt: 200, entries: [{ id: "c1", v: "Normal", q: 1 }] },
      { id: "ls_b", name: "B antiga", updatedAt: 50, entries: [] }
    ],
    deleted: {}
  };
  const remote = {
    lists: [
      { id: "ls_a", name: "A antiga", updatedAt: 100, entries: [] },
      { id: "ls_b", name: "B editada no celular", updatedAt: 300, entries: [{ id: "c2", v: "Foil", q: 2 }] }
    ],
    deleted: {}
  };
  const out = api.mergeLists(local, remote);
  const byId = Object.fromEntries(out.lists.map((l) => [l.id, l]));
  assert.equal(byId.ls_a.name, "A editada no PC", "A: local mais novo vence");
  assert.equal(byId.ls_b.name, "B editada no celular", "B: remoto mais novo vence");
  assert.equal(byId.ls_b.entries.length, 1, "as entradas vêm junto da lista vencedora");
});

test("mergeLists: exclusão propaga, edição posterior revive", () => {
  const { api } = fresh();
  // Timestamps REAIS (não 100/500): o merge poda tombstone com mais de 1 ano.
  const hoje = Date.now();
  const ontem = hoje - 24 * 3600e3;
  const semanaPassada = hoje - 7 * 24 * 3600e3;
  const apagadaNoCelular = { lists: [], deleted: { ls_x: ontem, ls_y: ontem } };
  const aindaNoPc = {
    lists: [
      { id: "ls_x", name: "apagada mesmo", updatedAt: semanaPassada, entries: [] },
      { id: "ls_y", name: "editada depois de apagar", updatedAt: hoje, entries: [] }
    ],
    deleted: {}
  };
  const out = api.mergeLists(aindaNoPc, apagadaNoCelular);
  assert.deepEqual(arr(out.lists).map((l) => l.id), ["ls_y"], "x fica apagada; y revive por ter edição mais nova");
  assert.equal(out.deleted.ls_x, ontem, "tombstone mantido pra propagar aos outros devices");
});

test("mergeLists: tombstone vencido (>1 ano) é podado — o mapa não cresce pra sempre", () => {
  const { api } = fresh();
  const antigo = Date.now() - 400 * 24 * 3600e3;
  const out = api.mergeLists({ lists: [], deleted: { ls_velha: antigo } }, { lists: [], deleted: {} });
  assert.equal(out.deleted.ls_velha, undefined);
});

test("mergeLists: ausente dos dois lados vira undefined (não cria a chave à toa)", () => {
  const { api } = fresh();
  assert.equal(api.mergeLists(undefined, undefined), undefined);
  // E pelo caminho real do sync, junto do resto do snapshot.
  const merged = api.mergeData({ collection: {} }, { collection: {} });
  assert.ok(!("lists" in merged) || merged.lists === undefined, "mergeData não inventa lists");
});

// --- Migração das tags (F5) -------------------------------------------------
const TAGS_KEY = "tcg-collector-collection-tags-v1";
const TAGS_SEED = JSON.stringify({
  tags: [{ id: "t_abc", name: "Favoritas", color: "#e23030" },
         { id: "t_def", name: "Trocar", color: "#3fae5a" }],
  assign: { "swsh5-1": ["t_abc"], "base1-4": ["t_abc", "t_def"] },
  updatedAt: 1
});

test("migração: cada tag vira lista vinculada com entradas marcadoras", () => {
  const { api } = fresh({ [TAGS_KEY]: TAGS_SEED });
  const st = api.createListStore();
  const nomes = arr(st.list()).map((l) => l.name).sort();
  assert.deepEqual(nomes, ["Favoritas", "Trocar"]);

  const fav = arr(st.list()).find((l) => l.name === "Favoritas");
  assert.equal(fav.linked, true, "tag marcava carta que a pessoa TEM");
  assert.equal(fav.fromTag, "t_abc", "proveniência registrada (é o que evita duplicar)");
  assert.equal(fav.game, null, "tags eram cross-game");
  assert.deepEqual(arr(fav.entries).map((e) => e.id).sort(), ["base1-4", "swsh5-1"]);
  // v/q nulos: tag não tinha versão nem quantidade, e inventar "1 Normal NM"
  // seria fabricar dado de coleção que ninguém digitou.
  assert.equal(fav.entries[0].v, null);
  assert.equal(fav.entries[0].q, null);
});

test("migração: marcador conta 1 cópia e casa com qualquer variante", () => {
  const { api } = fresh({ [TAGS_KEY]: TAGS_SEED });
  const st = api.createListStore();
  const fav = arr(st.list()).find((l) => l.name === "Favoritas");
  assert.equal(st.countOf(fav.id), 2, "duas cartas, uma cópia cada");
  assert.equal(st.has(fav.id, "swsh5-1", "Reverse"), true);
});

test("migração é idempotente — reler não duplica", () => {
  const ls = makeLocalStorage({ [TAGS_KEY]: TAGS_SEED });
  const sb1 = loadShared("window.__test = { createListStore };", { localStorage: ls });
  sb1.window.__test.createListStore();
  sb1.__flushTimers();
  // Segunda "visita" (outro carregamento de página) sobre o mesmo storage.
  const sb2 = loadShared("window.__test = { createListStore };", { localStorage: ls });
  const st2 = sb2.window.__test.createListStore();
  assert.equal(st2.list().length, 2, "continuam duas listas, não quatro");
});

test("migração não ressuscita lista apagada de propósito", () => {
  const ls = makeLocalStorage({ [TAGS_KEY]: TAGS_SEED });
  const sb1 = loadShared("window.__test = { createListStore };", { localStorage: ls });
  const st1 = sb1.window.__test.createListStore();
  const alvo = arr(st1.list()).find((l) => l.name === "Favoritas");
  st1.remove(alvo.id);
  sb1.__flushTimers();

  const sb2 = loadShared("window.__test = { createListStore };", { localStorage: ls });
  const nomes = arr(sb2.window.__test.createListStore().list()).map((l) => l.name);
  assert.deepEqual(nomes, ["Trocar"], "o tombstone é a memória de que foi apagada");
});

test("migração preserva o blob de tags (device antigo continua lendo)", () => {
  const ls = makeLocalStorage({ [TAGS_KEY]: TAGS_SEED });
  const sb = loadShared("window.__test = { createListStore };", { localStorage: ls });
  sb.window.__test.createListStore();
  sb.__flushTimers();
  assert.equal(ls._dump()[TAGS_KEY], TAGS_SEED, "o legado congela, não some");
});

test("perfil público: readTagsData enxerga listas E tags não migradas, sem duplicar", () => {
  const { api } = fresh({ [TAGS_KEY]: TAGS_SEED });
  const st = api.createListStore();
  st.create({ name: "Lista nova", game: "magic" });
  const d = api.readTagsData();
  const nomes = arr(d.tags).map((x) => x.name).sort();
  assert.deepEqual(nomes, ["Favoritas", "Lista nova", "Trocar"], "sem a tag original duplicando a lista migrada");
  // A carta aponta para as listas migradas, não para os ids de tag antigos.
  assert.ok(arr(d.assign["base1-4"]).every((id) => String(id).startsWith("ls_")));
});

test("mergeData: passa lists adiante quando existe de um lado só", () => {
  const { api } = fresh();
  const merged = api.mergeData(
    { lists: { lists: [{ id: "ls_1", name: "só local", updatedAt: 10, entries: [] }], deleted: {} } },
    {}
  );
  assert.equal(merged.lists.lists.length, 1, "cliente antigo sem a chave não apaga a lista");
});
