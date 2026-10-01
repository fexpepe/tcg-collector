// Migração do Miracle Battle Carddass pro jogo próprio (mbc), 2026-10-01.
//
// Até essa data, as séries One Piece, Naruto e Hunter × Hunter do Miracle
// Battle eram LINHAS dentro do jogo de cada marca, e quem marcou uma dessas
// cartas a tem guardada na coleção daquele jogo (tcg-collector-onepiece-…).
// Agora a carta é do catálogo do mbc, com o MESMO id: sem esta mudança de
// gaveta ela sumia da conta da pessoa (o catálogo do One Piece não a tem mais),
// e a do mbc nascia vazia.
//
// Só baixa quem tem o que mover: o shared.js (moveMiracleBattle) procura um id
// op-mb-/nrt-mb-/hxh-mb- na coleção e nos desejos dos três jogos e só então
// injeta este arquivo. Roda DEPOIS do pull+merge do boot do sync (o que está no
// localStorage já é o mesclado com a nuvem) e o shared.js sobe o resultado e
// recarrega a página.
//
// Regras, as mesmas do sync, pra a mudança sobreviver a outro aparelho:
//   - coleção e desejos vão pro mbc pelo merge do sync (LWW por carta com o
//     carimbo de quando a carta mudou por último): um aparelho que já migrou e
//     editou a carta no mbc não perde a edição pra cópia velha de outro;
//   - no jogo da marca fica um TOMBSTONE (del = agora): a cópia que ainda está
//     na nuvem, ou num aparelho com o app antigo, não volta. Se um app antigo
//     editar a carta depois disso, a edição é mais nova que o tombstone, volta
//     pro jogo da marca e é trazida pra cá de novo na próxima abertura;
//   - preço manual vai pelo merge de preços; lista e venda realizada guardam o
//     jogo, e a de Miracle Battle passa a dizer mbc.
(function () {
  const S = window.TCGShared;
  if (!S || !S._nucleo) return;
  const { SYNC_KEYS, mergeCollection, mergeWishlist, mergePrices, normalizeMeta, readObject, freezeWritesUntilReload } = S._nucleo;

  const DE = ["onepiece", "naruto", "hxh"];
  const PARA = "mbc";
  const ehMb = (id) => /^(op|nrt|hxh)-mb-/.test(String(id || ""));
  const chave = (base, game) => `tcg-collector-${game}-${base}`;

  // Entradas por id de um objeto: as do Miracle Battle e o resto.
  function separa(obj) {
    const mb = {}, resto = {};
    Object.keys(obj || {}).forEach((id) => { (ehMb(id) ? mb : resto)[id] = obj[id]; });
    return { mb, resto };
  }

  function migra() {
    const agora = Date.now();
    const escritas = {}; // chave -> objeto novo (lido uma vez, escrito no fim)
    const ler = (k) => (k in escritas ? escritas[k] : readObject(k));
    const tocados = new Set();

    // Coleção e desejos: os dois têm o par blob + meta { mod, del }.
    [["collection-v3", "collection-meta-v1", mergeCollection, "collection"],
      ["wishlist-v1", "wishlist-meta-v1", mergeWishlist, "wishlist"]].forEach(([base, baseMeta, merge, campo]) => {
      DE.forEach((g) => {
        const { mb, resto } = separa(ler(chave(base, g)));
        const ids = Object.keys(mb);
        if (!ids.length) return;
        const meta = normalizeMeta(ler(chave(baseMeta, g)));
        const metaMb = { mod: {}, del: {} };
        ids.forEach((id) => {
          if (meta.mod[id]) metaMb.mod[id] = meta.mod[id];
          delete meta.mod[id];
          meta.del[id] = agora;
        });
        const r = merge(ler(chave(base, PARA)) || {}, normalizeMeta(ler(chave(baseMeta, PARA))), mb, metaMb);
        escritas[chave(base, PARA)] = r[campo];
        escritas[chave(baseMeta, PARA)] = r.meta;
        escritas[chave(base, g)] = resto;
        escritas[chave(baseMeta, g)] = meta;
        tocados.add(g);
      });
    });

    // Preço manual (por carta × variante × condição): sem tombstone por carta;
    // o push logo depois deixa a linha da nuvem igual à daqui.
    DE.forEach((g) => {
      const { mb, resto } = separa(ler(chave("prices-v1", g)));
      if (!Object.keys(mb).length) return;
      escritas[chave("prices-v1", PARA)] = mergePrices(ler(chave("prices-v1", PARA)) || {}, mb);
      escritas[chave("prices-v1", g)] = resto;
      tocados.add(g);
    });

    // Listas: cada uma tem o jogo dela. Só Miracle Battle -> mbc; misturada com
    // o resto do jogo da marca -> sem jogo (é o que a lista mista já é).
    const listas = ler(SYNC_KEYS.lists);
    if (listas && Array.isArray(listas.lists)) {
      let mexeu = false;
      listas.lists.forEach((l) => {
        if (!l || !DE.includes(l.game) || !Array.isArray(l.entries)) return;
        const mb = l.entries.filter((e) => e && ehMb(e.id)).length;
        if (!mb) return;
        l.game = mb === l.entries.length ? PARA : null;
        l.updatedAt = agora;
        mexeu = true;
      });
      if (mexeu) escritas[SYNC_KEYS.lists] = listas;
    }

    // Vendas realizadas guardam o jogo da carta (pra achar a carta no histórico).
    const vendidas = ler(SYNC_KEYS.sold);
    if (vendidas && vendidas.items && typeof vendidas.items === "object") {
      let mexeu = false;
      Object.keys(vendidas.items).forEach((sid) => {
        const v = vendidas.items[sid];
        if (v && ehMb(v.cardId) && DE.includes(v.game)) { v.game = PARA; mexeu = true; }
      });
      if (mexeu) { vendidas.updatedAt = agora; escritas[SYNC_KEYS.sold] = vendidas; }
    }

    const chaves = Object.keys(escritas);
    if (!chaves.length) return [];
    // Tudo ou nada: sem espaço no meio, cada chave volta ao que era.
    const antes = {};
    chaves.forEach((k) => { antes[k] = localStorage.getItem(k); });
    try {
      chaves.forEach((k) => localStorage.setItem(k, JSON.stringify(escritas[k])));
    } catch (e) {
      chaves.forEach((k) => {
        try { if (antes[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, antes[k]); } catch (e2) { /* segue */ }
      });
      return [];
    }
    // As stores em memória ainda têm a carta no jogo da marca: nada delas pode
    // gravar por cima até o reload que o shared.js faz em seguida.
    freezeWritesUntilReload();
    return Array.from(tocados).concat(PARA);
  }

  window.TCGMigraMbc = migra;
})();
