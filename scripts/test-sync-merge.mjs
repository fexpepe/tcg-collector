// Teste unitário do merge de sync com timestamps por carta (LWW + tombstone).
// Carrega o src/shared.js num sandbox com stubs e captura as funções internas
// mergeData/mergeCollection/mergeWishlist injetando uma linha de captura — sem
// alterar o arquivo de produção. Roda com: node scripts/test-sync-merge.mjs
// Sandbox compartilhado (tests/lib): stubs de navegador atualizados num lugar só.
import { loadShared } from "../tests/lib/shared-sandbox.mjs";

const sandbox = loadShared("window.__test = { mergeData, mergeCollection, mergeWishlist };");
const { mergeData } = sandbox.window.__test;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const NOW = Date.now();
const T1 = NOW - 3000, T2 = NOW - 2000, T3 = NOW - 1000;

// 1) Exclusão propaga: A apagou a carta (del>mod), B ainda tem (sem ts/legado).
{
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "x-1": T2 } } };
  const remote = { collection: { "x-1": { normal: { NM: 1 } } }, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("exclusao propaga sobre carta legada (sem mod-ts)", !m.collection["x-1"] && m.collectionMeta.del["x-1"] === T2);
}

// 2) Edição mais nova revive: del em T1, mas a outra ponta editou em T3 > T1.
{
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "x-1": T1 } } };
  const remote = { collection: { "x-1": { normal: { NM: 2 } } }, collectionMeta: { mod: { "x-1": T3 }, del: {} } };
  const m = mergeData(local, remote);
  check("edicao (mod>del) revive a carta", !!m.collection["x-1"] && m.collection["x-1"].normal.NM === 2);
}

// 3) Sem deleções: união normal, quantidade pelo máximo.
{
  const local = { collection: { "x-1": { normal: { NM: 1 } } }, collectionMeta: { mod: { "x-1": T1 }, del: {} } };
  const remote = { collection: { "x-1": { normal: { NM: 3 }, holo: { NM: 1 } } }, collectionMeta: { mod: { "x-1": T2 }, del: {} } };
  const m = mergeData(local, remote);
  check("uniao mantem maior qty e une variantes", m.collection["x-1"].normal.NM === 3 && m.collection["x-1"].holo.NM === 1);
}

// 4) Carta nova só num lado (com mod) sobrevive.
{
  const local = { collection: { "y-9": { normal: { NM: 1 } } }, collectionMeta: { mod: { "y-9": T2 }, del: {} } };
  const remote = { collection: {}, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("carta adicionada num lado aparece", !!m.collection["y-9"]);
}

// 5) Dados legados sem nenhuma meta: nada é apagado (compat retro).
{
  const local = { collection: { "a-1": { normal: { NM: 1 } } } };
  const remote = { collection: { "b-2": { normal: { NM: 1 } } } };
  const m = mergeData(local, remote);
  check("sem meta nenhuma: une e nao apaga (compat)", !!m.collection["a-1"] && !!m.collection["b-2"]);
}

// 6) Tombstone antigo (>1 ano) é podado.
{
  const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "z-1": old } } };
  const remote = { collection: {}, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("tombstone com mais de 1 ano e podado", !("z-1" in m.collectionMeta.del));
}

// 7) Wishlist: exclusão propaga.
{
  const local = { wishlist: {}, wishlistMeta: { mod: {}, del: { "w-1": T2 } } };
  const remote = { wishlist: { "w-1": ["normal"] }, wishlistMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("wishlist: exclusao propaga", !m.wishlist["w-1"]);
}

// 8) Wishlist: união de variantes desejadas quando ambas vivas.
{
  // Semântica atual (documentada no mergeWishlist): timestamps DIFERENTES =
  // LWW por carta (remover uma variante num aparelho propaga); união só no
  // empate/sem timestamp (migração de dados antigos).
  const local = { wishlist: { "w-2": ["normal"] }, wishlistMeta: { mod: { "w-2": T1 }, del: {} } };
  const remote = { wishlist: { "w-2": ["holo"] }, wishlistMeta: { mod: { "w-2": T2 }, del: {} } };
  const m = mergeData(local, remote);
  check("wishlist: LWW quando os timestamps diferem", m.wishlist["w-2"].join(",") === "holo");

  const tieL = { wishlist: { "w-3": ["normal"] }, wishlistMeta: { mod: { "w-3": T1 }, del: {} } };
  const tieR = { wishlist: { "w-3": ["holo"] }, wishlistMeta: { mod: { "w-3": T1 }, del: {} } };
  const mt = mergeData(tieL, tieR);
  check("wishlist: união no empate de timestamp", mt.wishlist["w-3"].sort().join(",") === "holo,normal");
}

console.log(`\n  ${pass} passou, ${fail} falhou`);
process.exit(fail ? 1 : 0);
