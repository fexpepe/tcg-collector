// Importação de backup JSON (validar → planejar → aplicar → desfazer), via
// sandbox de vm (tests/lib/shared-sandbox.mjs). Roda com: node --test tests/
//
// O que se prova aqui é o contrato que a página de backup promete: arquivo
// incompatível não muda nada; mesclar soma (carta do arquivo vence a mesma
// carta local, carta só-local fica); substituir troca; ids desconhecidos
// sobrevivem; gravação que falha no meio volta TUDO; desfazer restaura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = `window.__test = {
  validateBackupPayload, planBackupImport, applyBackupImport, readLocalBackupState,
  undoLastImport, lastImportSnapshot, createCollectionStore, BACKUP_BLOCKS, PRE_IMPORT_KEY,
  get SYNC_KEYS() { return SYNC_KEYS; }
};`;
function fresh(seed, ls) {
  ls = ls || makeLocalStorage(seed || {});
  const sb = loadShared(EXPOSE, { localStorage: ls });
  return { ls, api: sb.window.__test, flush: sb.__flushTimers, sb };
}
// Objetos vindos do sandbox são de outro realm (protótipos diferentes): o
// deepStrictEqual os rejeita mesmo iguais — compara pela forma serializada.
const j = (x) => JSON.parse(JSON.stringify(x));
const COL = "tcg-collector-pokemon-collection-v3";
const META = "tcg-collector-pokemon-collection-meta-v1";
const WL = "tcg-collector-pokemon-wishlist-v1";
const v3 = (collection, extra) => Object.assign({ version: 3, exportedAt: "2026-09-01T10:00:00.000Z", collection }, extra || {});

test("validar: versão desconhecida, estrutura errada e tipos errados são rejeitados sem tocar em nada", () => {
  const { api, ls } = fresh({ [COL]: JSON.stringify({ "base1-2": { Holo: { NM: 1 } } }) });
  const antes = JSON.stringify(ls._dump());
  const rejeita = (payload) => assert.throws(() => api.validateBackupPayload(payload), /incompatible/);
  rejeita({ version: 99, collection: {} });
  rejeita({ version: "abc", collection: {} });
  rejeita({ version: 3, collection: "nope" });
  rejeita({ version: 3, collection: [] });
  rejeita({});
  rejeita([]);
  rejeita(null);
  rejeita({ version: 3, collection: {}, decks: [] });        // bloco com tipo errado
  rejeita({ version: 3, collection: {}, wishlist: "x" });
  rejeita({ version: 3, collection: {}, favorites: {} });
  assert.equal(JSON.stringify(ls._dump()), antes, "validar nunca grava");
});

test("validar: aceita v3, v2 e v1; ids desconhecidos são preservados; resumo conta cartas e cópias", () => {
  const { api } = fresh();
  const p3 = api.validateBackupPayload(v3(
    { "base1-4": { Holo: { NM: 2, SP: 1 } }, "zzz-outro-catalogo-1": { Normal: { NM: 1 } }, "__proto__": { Normal: { NM: 1 } } },
    { wishlist: { "base1-2": ["Holo"] }, decks: { decks: [{ id: "d1", updatedAt: 5 }] } }
  ));
  assert.deepEqual(j(Object.keys(p3.collection).sort()), ["base1-4", "zzz-outro-catalogo-1"]);
  assert.equal(p3.summary.cards, 2);
  assert.equal(p3.summary.copies, 4);
  assert.equal(p3.summary.wishlist, 1);
  assert.equal(p3.summary.decks, 1);
  assert.deepEqual(j(p3.summary.blocks), ["decks"]);

  const p2 = api.validateBackupPayload({ version: 2, collection: { "x-1": { Normal: 3 } } });
  assert.deepEqual(j(p2.collection), { "x-1": { Normal: { NM: 3 } } });

  const p1 = api.validateBackupPayload({ ownedCardIds: ["x-1", "x-2"] });
  assert.deepEqual(j(p1.collection), { "x-1": { Normal: { NM: 1 } }, "x-2": { Normal: { NM: 1 } } });
  assert.equal(p1.summary.version, 1);
});

test("planejar (mesclar): carta só-local fica, carta do arquivo vence a mesma carta, carta nova entra", () => {
  const { api } = fresh({
    [COL]: JSON.stringify({ A: { Holo: { NM: 1 } }, B: { Holo: { NM: 1 } } }),
    [META]: JSON.stringify({ mod: { A: 1000, B: 1000 }, del: { C: 2000 } })
  });
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 3 } }, C: { Normal: { NM: 1 } } }));
  const plan = api.planBackupImport(parsed, "merge", api.readLocalBackupState());
  assert.deepEqual(j(plan[COL]), { A: { Holo: { NM: 1 } }, B: { Holo: { NM: 3 } }, C: { Normal: { NM: 1 } } });
  // Carimbos: o que veio do arquivo é "agora" (vence a nuvem no próximo sync);
  // o tombstone local de C foi vencido pela importação (não reaparece).
  assert.equal(plan[META].mod.A, 1000);
  assert.ok(plan[META].mod.B > 1000 && plan[META].mod.C > 1000);
  assert.equal(plan[META].del.C, undefined);
});

test("planejar (substituir): coleção vira exatamente o arquivo; bloco ausente no arquivo não entra no plano", () => {
  const { api } = fresh({
    [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }),
    "tcg-collector-decks-all-v1": JSON.stringify({ decks: [{ id: "local", updatedAt: 1 }] })
  });
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 2 } } }));
  const plan = api.planBackupImport(parsed, "replace", api.readLocalBackupState());
  assert.deepEqual(j(plan[COL]), { B: { Holo: { NM: 2 } } });
  assert.equal(plan["tcg-collector-decks-all-v1"], undefined, "decks locais ficam como estão");
});

test("planejar: cada bloco exportado tem caminho de volta, em mesclar e em substituir", () => {
  const { api } = fresh();
  const local = api.readLocalBackupState();
  api.BACKUP_BLOCKS.forEach((k) => {
    const parsed = api.validateBackupPayload(v3({}, { [k]: { updatedAt: 1 } }));
    assert.ok(api.SYNC_KEYS[k] in api.planBackupImport(parsed, "merge", local), `${k} (mesclar)`);
    assert.ok(api.SYNC_KEYS[k] in api.planBackupImport(parsed, "replace", local), `${k} (substituir)`);
  });
  // favoritos: união ao mesclar, arquivo ao substituir
  const { api: api2 } = fresh({ "tcg-collector-favorites-v1": JSON.stringify(["a"]) });
  const parsed = api2.validateBackupPayload(v3({}, { favorites: ["b"] }));
  assert.deepEqual(j(api2.planBackupImport(parsed, "merge", api2.readLocalBackupState())["tcg-collector-favorites-v1"]), ["a", "b"]);
  assert.deepEqual(j(api2.planBackupImport(parsed, "replace", api2.readLocalBackupState())["tcg-collector-favorites-v1"]), ["b"]);
});

test("aplicar: grava o plano, guarda a cópia anterior e desfazer restaura com carimbos novos", () => {
  const { api, ls } = fresh({
    [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }),
    [META]: JSON.stringify({ mod: { A: 1000 }, del: {} })
  });
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 2 } } }, { wishlist: { W: ["Holo"] } }));
  api.applyBackupImport(api.planBackupImport(parsed, "replace", api.readLocalBackupState()));
  assert.deepEqual(JSON.parse(ls.getItem(COL)), { B: { Holo: { NM: 2 } } });
  assert.deepEqual(JSON.parse(ls.getItem(WL)), { W: ["Holo"] });
  const foto = JSON.parse(ls.getItem(api.PRE_IMPORT_KEY));
  assert.equal(foto.keys[COL], JSON.stringify({ A: { Holo: { NM: 1 } } }));
  assert.equal(foto.keys[WL], null, "chave que não existia é lembrada como ausente");
  assert.ok(api.lastImportSnapshot().savedAt > 0);

  assert.equal(api.undoLastImport(), true);
  assert.deepEqual(JSON.parse(ls.getItem(COL)), { A: { Holo: { NM: 1 } } });
  assert.equal(ls.getItem(WL), null, "chave ausente antes volta a ficar ausente");
  assert.equal(ls.getItem(api.PRE_IMPORT_KEY), null);
  const meta = JSON.parse(ls.getItem(META));
  assert.ok(meta.mod.A > 1000, "carta restaurada é carimbada como 'agora' pra vencer a nuvem");
  assert.ok(meta.del.B > 0, "carta que só a importação trouxe ganha tombstone");
});

test("aplicar: falha no meio da gravação volta TODAS as chaves e não deixa cópia órfã", () => {
  const ls = makeLocalStorage({ [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }) });
  const { api } = fresh(null, ls);
  const antes = JSON.stringify(ls._dump());
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === WL) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } return setItem(k, v); };
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 2 } } }, { wishlist: { W: ["Holo"] } }));
  assert.throws(() => api.applyBackupImport(api.planBackupImport(parsed, "merge", api.readLocalBackupState())), (e) => e.code === "rolledback");
  // (compara ordenado: remover e repor uma chave muda a ordem do dump, não o conteúdo)
  const ordenado = (dump) => JSON.stringify(Object.fromEntries(Object.entries(dump).sort()));
  assert.equal(ordenado(ls._dump()), ordenado(JSON.parse(antes)), "coleção anterior intacta");
});

test("aplicar: se nem a reposição cabe, avisa que ficou pela metade e MANTÉM a cópia pro desfazer", () => {
  const ls = makeLocalStorage({ [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }), [WL]: JSON.stringify({ W0: ["Holo"] }) });
  const { api } = fresh(null, ls);
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === WL) throw new Error("quota"); return setItem(k, v); }; // nem o valor antigo volta
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 2 } } }, { wishlist: { W: ["Holo"] } }));
  assert.throws(() => api.applyBackupImport(api.planBackupImport(parsed, "merge", api.readLocalBackupState())), (e) => e.code === "partial");
  assert.deepEqual(JSON.parse(ls.getItem(COL)), { A: { Holo: { NM: 1 } } }, "o que deu pra repor foi reposto");
  const foto = JSON.parse(ls.getItem(api.PRE_IMPORT_KEY));
  assert.equal(foto.keys[WL], JSON.stringify({ W0: ["Holo"] }), "a cópia anterior fica pro Desfazer");
  ls.setItem = setItem;
  assert.equal(api.undoLastImport(), true);
  assert.deepEqual(JSON.parse(ls.getItem(WL)), { W0: ["Holo"] });
});

test("aplicar: sem espaço nem pra cópia de segurança, aborta antes de tocar em qualquer chave", () => {
  const ls = makeLocalStorage({ [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }) });
  const { api } = fresh(null, ls);
  const antes = JSON.stringify(ls._dump());
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === api.PRE_IMPORT_KEY) throw new Error("quota"); return setItem(k, v); };
  const parsed = api.validateBackupPayload(v3({ B: { Holo: { NM: 2 } } }));
  assert.throws(() => api.applyBackupImport(api.planBackupImport(parsed, "merge", api.readLocalBackupState())), (e) => e.code === "snapshot");
  assert.equal(JSON.stringify(ls._dump()), antes);
});

test("ids desconhecidos sobrevivem à exportação (toObject devolve tudo que está guardado)", () => {
  const { api } = fresh();
  const st = api.createCollectionStore("pokemon");
  st.replace({ "zzz-outro-catalogo-1": { Normal: { NM: 1 } }, "base1-4": { Holo: { NM: 1 } } });
  assert.deepEqual(j(Object.keys(st.toObject()).sort()), ["base1-4", "zzz-outro-catalogo-1"]);
});
