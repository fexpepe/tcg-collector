// Importação de dados — backup JSON (validar → prévia → mesclar/substituir →
// desfazer), CSV genérico (TCGplayer, Collectr, ManaBox, Dragon Shield…) e CSV
// do Dex. Saiu do shared.js em 2026-09-14 porque é bloco FRIO: ~700 linhas que
// só rodam quando a pessoa escolhe um arquivo, e que todo mundo baixava em toda
// página (o shared.js estava a 1 KB gz do teto do CI). Padrão do scan.js e do
// ui-editor.js: injetado sob demanda pelo shared (viaBackupImport) e carregado
// estático só pelo backup.html, que precisa do lastImportSnapshot no load.
//
// Depende do núcleo por DOIS caminhos: o export público (window.TCGShared) e o
// saco de internos que o shared expõe de propósito pra este arquivo
// (TCGShared._nucleo: chaves de sync, merges LWW, flush/freeze das gravações).
// Nada aqui é API pública — o que o resto do site chama continua sendo
// TCGShared.importBackupJson/importCsvFile/importDexCsvFile/lastImportSnapshot/
// undoLastImport, que este módulo preenche ao carregar.
//
// Testes: tests/backup-import.test.mjs, tests/csv-import.test.mjs e
// tests/backup-json.test.mjs (via loadBackupImport do shared-sandbox).
(function () {
  const S = window.TCGShared;
  if (!S || !S._nucleo) return;
  const { CARD_CONDITIONS, DEFAULT_CONDITION, GAME_SLUGS, cardVariants, createCollectionStore, defaultVariant, escapeHtml, gameDataDir, gameLabel, getLocale, logEvento, marcaPasso, normalize, notifyStorageFull, setOrigemCadastro, snapshotKeys, t, tn } = S;
  const { SYNC_KEYS, currentGame, currentGameSlug, flushWrites, freezeWritesUntilReload, isUnsafeKey, mergeBinders, mergeCollection, mergeCosts, mergeDecks, mergeFolders, mergeGraded, mergeLists, mergeManual, mergePrices, mergeSales, mergeSold, mergeTags, mergeWishTargets, mergeWishlist, normalizeMeta, readObject } = S._nucleo;

  // --- Helpers PUROS de importação de CSV (Dex/TCGplayer/Collectr) ---
  // No escopo do módulo de propósito: os testes (tests/csv-import.test.mjs)
  // os capturam via sandbox. As partes com rede/UI vivem no menu da conta.
  function mapDexVariant(v) {
    const s = String(v || "").toLowerCase().trim();
    if (!s || s === "normal") return "Normal";
    if (s.indexOf("1st edition") >= 0) return "1st Edition";
    if (s.indexOf("reverse") >= 0) return "Reverse";
    if (s.indexOf("holo") >= 0) return "Holo";
    return "Normal"; // promos diversos → carta base (Normal)
  }
  // Parser CSV com aspas (nomes têm vírgula: "Erika's Venusaur, Holo").
  // Detecta o separador (vírgula/;/tab) pela linha do cabeçalho.
  function parseCsvText(text) {
    text = text.replace(/^﻿/, "");
    // Preambulo "sep=,": convencao do Excel que alguns exportadores emitem na
    // PRIMEIRA linha — o Dragon Shield MV e um deles. Sem tirar, essa linha
    // VIRAVA o cabecalho: o mapeamento voltava tudo -1 e o arquivo inteiro nao
    // importava (nem uma carta, sem mensagem de erro). A linha ainda declara o
    // separador de propria boca, entao ela e melhor fonte que a heuristica.
    let sepDeclarado = "";
    const preambulo = /^sep=(.)\r?\n/i.exec(text);
    if (preambulo) { sepDeclarado = preambulo[1]; text = text.slice(preambulo[0].length); }
    const nl = text.indexOf("\n");
    const firstLine = nl >= 0 ? text.slice(0, nl + 1) : text;
    const sep = sepDeclarado || [",", ";", "\t"].map((s) => [s, firstLine.split(s).length - 1])
      .sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows;
  }
  // Acha o índice de cada campo por SINÔNIMOS de cabeçalho (case-insensitive).
  function mapCsvHeader(header) {
    const h = header.map((c) => String(c || "").trim().toLowerCase());
    const find = (...names) => {
      for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
      return -1;
    };
    return {
      qty: find("quantity", "qty", "count", "quantidade", "amount"),
      name: find("card name", "product name", "name", "card", "nome", "simple name"),
      set: find("set name", "set", "expansion", "edition", "coleção"),
      number: find("card number", "collector number", "number", "num", "número", "no."),
      variant: find("printing", "variance", "variant", "finish", "foil"),
      condition: find("condition", "cond", "condição"),
      language: find("language", "lang", "idioma"),
      game: find("game", "category", "tcg", "jogo")
    };
  }
  function mapCsvCondition(c) {
    const s = String(c || "").toLowerCase();
    if (!s || s.indexOf("near") >= 0 || s === "nm") return "NM";
    if (s.indexOf("mint") === 0 || s === "m") return "M";
    if (s.indexOf("light") >= 0 || s === "sp" || s === "lp" || s.indexOf("slightly") >= 0 || s.indexOf("excellent") >= 0) return "SP";
    if (s.indexOf("moderate") >= 0 || s === "mp" || s.indexOf("played") === 0 || s.indexOf("good") >= 0) return "MP";
    if (s.indexOf("heav") >= 0 || s === "hp") return "HP";
    if (s.indexOf("damag") >= 0 || s === "d" || s.indexOf("poor") >= 0) return "D";
    return "NM";
  }
  function mapCsvLanguage(l) {
    const s = String(l || "").toLowerCase();
    if (s.indexOf("port") >= 0 || s === "pt") return "pt";
    if (s.indexOf("jap") >= 0 || s === "ja" || s === "jp") return "ja";
    if (s.indexOf("trad") >= 0 || s.indexOf("tw") >= 0) return "zh-tw";
    if (s.indexOf("chin") >= 0 || s.indexOf("zh") >= 0) return "zh-cn"; // Chinês padrão = simplificado
    return "en";
  }
  // Nome de jogo dos exports (coluna "Game"/"Product Line" do Collectr e do
  // TCGplayer) → slug. Compara ACHATADO (sem espaço/pontuação) porque cada
  // fonte escreve de um jeito: "Yu-Gi-Oh!", "YuGiOh", "Dragon Ball Super:
  // Fusion World"… O "pok" fica por último — é o mais genérico dos prefixos.
  function mapCsvGame(g) {
    const flat = String(g || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!flat) return "";
    if (flat.includes("lorcana")) return "lorcana";
    if (flat.includes("onepiece")) return "onepiece";
    if (flat.includes("magic") || flat === "mtg") return "magic";
    if (flat.includes("yugioh") || flat === "ygo") return "ygo";
    if (flat.includes("digimon")) return "digimon";
    if (flat.includes("flesh") || flat === "fab") return "fab";
    if (flat.includes("gundam")) return "gundam";
    // Carddass vintage ANTES do Fusion World: "Dragon Ball Carddass" também contém "dragonball".
    if (flat === "dbc" || (flat.includes("dragonball") && flat.includes("carddass"))) return "dbc";
    if (flat.includes("dragonball") || flat.includes("fusionworld") || flat === "dbfw") return "dbfw";
    if (flat.includes("riftbound") || flat.includes("leagueoflegends")) return "riftbound";
    if (flat.includes("unionarena")) return "unionarena";
    if (flat.includes("naruto")) return "naruto";
    if (flat.includes("hunter") || flat === "hxh") return "hxh";
    if (flat.includes("pok")) return "pokemon";
    return ""; // desconhecido: tenta todos
  }
  const csvNorm = (s) => normalize(String(s || "")).replace(/[^a-z0-9]/g, "");
  // Nome de set dos exports vem com prefixo de código ("SV08.5: Prismatic
  // Evolutions", "SWSH09: ..."): compara também sem o prefixo.
  function csvSetKeys(name) {
    const keys = new Set();
    const raw = String(name || "").trim();
    if (!raw) return keys;
    keys.add(csvNorm(raw));
    const noCode = raw.replace(/^[A-Za-z0-9.\-]+\s*:\s*/, "");
    if (noCode !== raw) keys.add(csvNorm(noCode));
    return keys;
  }
  // Printing dos exports: a tabela do Dex + o "Foil" dos jogos TCGCSV (Magic,
  // One Piece, YGO…). "Holofoil" do Pokémon cai em Holo ANTES da checagem de
  // foil, então o comportamento antigo não muda; "Non-Foil"/"Nonfoil" é Normal.
  function mapCsvVariant(v) {
    const s = String(v || "").toLowerCase();
    if (s.indexOf("1st edition") >= 0) return "1st Edition";
    if (s.indexOf("reverse") >= 0) return "Reverse";
    if (s.indexOf("holo") >= 0) return "Holo";
    // ANTES do foil, porque "Etched Foil" casa nos dois. O ManaBox escreve
    // "etched" seco na coluna Foil, e "etched" nao contem "foil": caia em
    // Normal, ou seja, a carta entrava na colecao como se NAO fosse foil.
    // "Etched" e variante propria do catalogo (sync-magic.mjs), e carta que
    // nao a tem cai na variante padrao no import — nada se perde.
    if (s.indexOf("etched") >= 0) return "Etched";
    if (s.indexOf("foil") >= 0 && s.indexOf("non") < 0) return "Foil";
    return "Normal";
  }

  // Preços BR do backup: mantém só valores numéricos positivos de cartas conhecidas.
  function parseImportedPrices(payload, cardsById) {
    const source = payload && payload.prices;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const acceptAll = cardsById.size === 0; // sem catálogo: aceita como vem
    const result = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId) || (!acceptAll && !cardsById.has(cardId)) || !variants || typeof variants !== "object") return;
      Object.entries(variants).forEach(([variant, entry]) => {
        if (isUnsafeKey(variant) || !entry || typeof entry !== "object" || !entry.prices) return;
        const clean = {};
        Object.entries(entry.prices).forEach(([condition, value]) => {
          const amount = Number(value);
          if (amount > 0 && CARD_CONDITIONS.includes(condition)) clean[condition] = Math.round(amount * 100) / 100;
        });
        if (Object.keys(clean).length) {
          result[cardId] = result[cardId] || {};
          result[cardId][variant] = {
            prices: clean,
            source: typeof entry.source === "string" ? entry.source : "manual",
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : ""
          };
        }
      });
    });
    return result;
  }

  // Lista de desejos do backup: cardId -> [variantes válidas da carta].
  function parseImportedWishlist(payload, cardsById) {
    const source = payload && payload.wishlist;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const acceptAll = cardsById.size === 0; // sem catálogo: aceita como vem
    const wishlist = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId)) return;
      const card = cardsById.get(cardId);
      if ((!card && !acceptAll) || !Array.isArray(variants)) return;
      const known = card && card.variants && card.variants.length ? card.variants : null;
      const list = known ? variants.filter((variant) => known.includes(variant)) : variants.filter(Boolean);
      if (list.length) wishlist[cardId] = list;
    });
    return wishlist;
  }

  function parseImportedCollection(payload, cardsById) {
    // Sem catálogo carregado (ex.: página Pokédex, que roda só com índices) não
    // dá para validar contra o catálogo — aceita os ids do backup como vêm.
    const acceptAll = cardsById.size === 0;

    // Formato v1: lista de ids -> 1ª variante, NM ×1.
    if (Array.isArray(payload.ownedCardIds)) {
      const collection = {};
      payload.ownedCardIds.forEach((cardId) => {
        if (!isUnsafeKey(cardId) && (acceptAll || cardsById.has(cardId))) {
          collection[cardId] = { [defaultVariant(cardsById.get(cardId))]: { [DEFAULT_CONDITION]: 1 } };
        }
      });
      return collection;
    }

    if (!payload.collection || typeof payload.collection !== "object" || Array.isArray(payload.collection)) {
      throw new Error("Arquivo sem collection ou ownedCardIds.");
    }

    const isV3 = payload.version >= 3;
    const collection = {};
    Object.entries(payload.collection).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId) || (!acceptAll && !cardsById.has(cardId)) || !variants || typeof variants !== "object") return;
      const entry = {};
      Object.entries(variants).forEach(([variant, value]) => {
        if (isUnsafeKey(variant)) return;
        if (isV3 && value && typeof value === "object") {
          // v3: variante -> condição -> quantidade
          const conditions = {};
          Object.entries(value).forEach(([condition, quantity]) => {
            const parsed = Math.floor(Number(quantity));
            if (parsed > 0 && CARD_CONDITIONS.includes(condition)) conditions[condition] = parsed;
          });
          if (Object.keys(conditions).length) entry[variant] = conditions;
        } else {
          // v2: variante -> quantidade (vira NM)
          const parsed = Math.floor(Number(value));
          if (parsed > 0) entry[variant] = { [DEFAULT_CONDITION]: parsed };
        }
      });
      if (Object.keys(entry).length) collection[cardId] = entry;
    });
    return collection;
  }

  // ── Importação de backup JSON ─────────────────────────────────────────────
  // Três passos separados de propósito: VALIDAR (lê o arquivo inteiro e rejeita
  // sem tocar em nada), PLANEJAR (o que cada chave vai virar, no modo
  // escolhido) e APLICAR (grava tudo ou nada, com cópia recuperável). Antes
  // era um passo só: o arquivo ia direto pros stores, sem prévia, e
  // SUBSTITUÍA a coleção — enquanto a página de backup prometia "as cartas do
  // arquivo são somadas às atuais". Os ids são aceitos como vêm (sem catálogo
  // na mão): carta de outro catálogo/jogo sobrevive à importação e à
  // exportação seguinte, em vez de sumir em silêncio.
  const BACKUP_VERSION_MAX = 3;
  const BACKUP_BLOCKS = ["binders", "decks", "folders", "sales", "graded", "tags", "lists", "sold", "costs", "wishTargets", "manual"];
  const PRE_IMPORT_KEY = "tcg-collector-pre-import-v1";
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function countBlockItems(block, field) {
    const v = block && block[field];
    if (Array.isArray(v)) return v.length;
    return isPlainObject(v) ? Object.keys(v).length : 0;
  }
  // Lança Error("incompatible") pra versão desconhecida ou estrutura errada —
  // nada é gravado. Devolve o conteúdo já saneado + um resumo pra prévia.
  function validateBackupPayload(payload) {
    if (!isPlainObject(payload)) throw new Error("incompatible");
    if (payload.version != null) {
      const v = Number(payload.version);
      if (!Number.isFinite(v) || v < 1 || v > BACKUP_VERSION_MAX) throw new Error("incompatible");
    }
    if (!Array.isArray(payload.ownedCardIds) && !isPlainObject(payload.collection)) throw new Error("incompatible");
    if (payload.wishlist != null && !isPlainObject(payload.wishlist)) throw new Error("incompatible");
    if (payload.prices != null && !isPlainObject(payload.prices)) throw new Error("incompatible");
    if (payload.favorites != null && !Array.isArray(payload.favorites)) throw new Error("incompatible");
    if (payload.dexOwned != null && !Array.isArray(payload.dexOwned)) throw new Error("incompatible");
    BACKUP_BLOCKS.forEach((k) => { if (payload[k] != null && !isPlainObject(payload[k])) throw new Error("incompatible"); });
    const byId = new Map(); // sem catálogo: ids desconhecidos são preservados
    const collection = parseImportedCollection(payload, byId);
    const wishlist = parseImportedWishlist(payload, byId);
    const prices = parseImportedPrices(payload, byId);
    const blocks = {};
    BACKUP_BLOCKS.forEach((k) => { if (isPlainObject(payload[k])) blocks[k] = payload[k]; });
    const favorites = Array.isArray(payload.favorites) ? payload.favorites.filter((x) => typeof x === "string") : null;
    const dexOwned = Array.isArray(payload.dexOwned) ? payload.dexOwned.filter((x) => typeof x === "string") : null;
    let copies = 0;
    Object.values(collection).forEach((variants) => Object.values(variants).forEach((conds) => Object.values(conds).forEach((q) => { copies += q; })));
    return {
      collection, wishlist, prices, blocks, favorites, dexOwned,
      summary: {
        version: payload.version == null ? 1 : Number(payload.version),
        exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : "",
        cards: Object.keys(collection).length,
        copies,
        wishlist: Object.keys(wishlist).length,
        prices: Object.keys(prices).length,
        decks: countBlockItems(blocks.decks, "decks"),
        binders: countBlockItems(blocks.binders, "binders"),
        lists: countBlockItems(blocks.lists, "lists"),
        graded: countBlockItems(blocks.graded, "items"),
        favorites: favorites ? favorites.length : 0,
        dexOwned: dexOwned ? dexOwned.length : 0,
        blocks: Object.keys(blocks)
      }
    };
  }
  // Estado local que a importação vai combinar (mesmas chaves do backupObject).
  function readLocalBackupState() {
    const st = {
      collection: readObject(SYNC_KEYS.collection) || {},
      collectionMeta: normalizeMeta(readObject(SYNC_KEYS.collectionMeta)),
      wishlist: readObject(SYNC_KEYS.wishlist) || {},
      wishlistMeta: normalizeMeta(readObject(SYNC_KEYS.wishlistMeta)),
      prices: readObject(SYNC_KEYS.prices) || {},
      blocks: {},
      favorites: null,
      dexOwned: null
    };
    BACKUP_BLOCKS.forEach((k) => { st.blocks[k] = readObject(SYNC_KEYS[k]); });
    try { const f = JSON.parse(localStorage.getItem(SYNC_KEYS.favorites) || "null"); st.favorites = Array.isArray(f) ? f : null; } catch (e) { st.favorites = null; }
    try { const d = JSON.parse(localStorage.getItem(SYNC_KEYS.dexOwned) || "null"); st.dexOwned = Array.isArray(d) ? d : null; } catch (e) { st.dexOwned = null; }
    return st;
  }
  // mode "merge" (padrão): carta do arquivo vence a versão local da MESMA
  // carta (última gravação = o arquivo, carimbado "agora"); carta que só existe
  // aqui fica. Blocos usam o mesmo merge do sync (decks/binders/listas/vendas
  // realizadas/custos: união por id; pastas/vendas/graded/tags/manual: bloco
  // mais recente). mode "replace": coleção, wishlist e preços deste jogo (e os
  // blocos presentes no arquivo) passam a ser EXATAMENTE o arquivo; bloco que o
  // arquivo não traz não é apagado. Devolve chave -> objeto a gravar.
  function planBackupImport(parsed, mode, local) {
    const merge = mode !== "replace";
    const now = Date.now();
    const stampAll = (obj) => { const mod = {}; Object.keys(obj).forEach((id) => { mod[id] = now; }); return { mod, del: {} }; };
    const out = {};
    if (merge) {
      const c = mergeCollection(local.collection, local.collectionMeta, parsed.collection, stampAll(parsed.collection));
      out[SYNC_KEYS.collection] = c.collection; out[SYNC_KEYS.collectionMeta] = c.meta;
      const w = mergeWishlist(local.wishlist, local.wishlistMeta, parsed.wishlist, stampAll(parsed.wishlist));
      out[SYNC_KEYS.wishlist] = w.wishlist; out[SYNC_KEYS.wishlistMeta] = w.meta;
      out[SYNC_KEYS.prices] = mergePrices(local.prices, parsed.prices);
    } else {
      out[SYNC_KEYS.collection] = parsed.collection; out[SYNC_KEYS.collectionMeta] = stampAll(parsed.collection);
      out[SYNC_KEYS.wishlist] = parsed.wishlist; out[SYNC_KEYS.wishlistMeta] = stampAll(parsed.wishlist);
      out[SYNC_KEYS.prices] = parsed.prices;
    }
    const MERGERS = {
      binders: mergeBinders, decks: mergeDecks, lists: mergeLists, folders: mergeFolders, sales: mergeSales,
      graded: mergeGraded, tags: mergeTags, sold: mergeSold, costs: mergeCosts, wishTargets: mergeWishTargets, manual: mergeManual
    };
    Object.keys(parsed.blocks).forEach((k) => {
      const local0 = local.blocks[k];
      out[SYNC_KEYS[k]] = (merge && local0) ? MERGERS[k](local0, parsed.blocks[k]) : parsed.blocks[k];
    });
    if (parsed.favorites) {
      out[SYNC_KEYS.favorites] = (merge && local.favorites)
        ? Array.from(new Set([].concat(local.favorites, parsed.favorites)))
        : parsed.favorites;
    }
    // Pokédex "já tenho": mesma regra dos favoritos (união no merge, arquivo no replace).
    if (parsed.dexOwned) {
      out[SYNC_KEYS.dexOwned] = (merge && local.dexOwned)
        ? Array.from(new Set([].concat(local.dexOwned, parsed.dexOwned)))
        : parsed.dexOwned;
    }
    return out;
  }
  // Grava o plano: tudo ou nada. Antes, uma foto do que cada chave tinha vai
  // pro PRE_IMPORT_KEY (o "Desfazer importação" da página de backup lê daí);
  // sem espaço nem pra foto, aborta sem tocar em nada (code "snapshot"). Se
  // alguma gravação falhar no meio, volta todas (code "rolledback").
  function applyBackupImport(plan) {
    flushWrites(); // materializa o que a página tinha pendente ANTES da foto
    const keys = Object.keys(plan);
    const foto = { savedAt: Date.now(), game: currentGameSlug(), keys: {} };
    keys.forEach((k) => { foto.keys[k] = localStorage.getItem(k); });
    try { localStorage.setItem(PRE_IMPORT_KEY, JSON.stringify(foto)); }
    catch (e) { throw Object.assign(new Error("snapshot"), { code: "snapshot" }); }
    try {
      keys.forEach((k) => {
        if (plan[k] === undefined) localStorage.removeItem(k);
        else localStorage.setItem(k, JSON.stringify(plan[k]));
      });
    } catch (e) {
      // Volta o que já tinha entrado. Primeiro LIBERA o espaço das chaves novas
      // (foram elas que estouraram a cota), depois repõe os valores antigos um
      // a um — uma reposição que falhe não impede as outras. Se alguma não
      // voltar, a foto FICA guardada: o "Desfazer importação" repõe tudo assim
      // que houver espaço, e o erro diz que ficou pela metade (code "partial").
      let intacto = true;
      keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e2) { /* segue */ } });
      keys.forEach((k) => {
        const v = foto.keys[k];
        if (v == null) return;
        try { localStorage.setItem(k, v); } catch (e2) { intacto = false; }
      });
      if (intacto) { try { localStorage.removeItem(PRE_IMPORT_KEY); } catch (e2) { /* a foto igual ao atual não atrapalha */ } }
      const code = intacto ? "rolledback" : "partial";
      throw Object.assign(new Error(code), { code });
    }
    freezeWritesUntilReload();
  }
  function lastImportSnapshot() {
    const f = readObject(PRE_IMPORT_KEY);
    if (!f || !isPlainObject(f.keys)) return null;
    return { savedAt: Number(f.savedAt) || 0, game: typeof f.game === "string" ? f.game : "", keys: Object.keys(f.keys).length };
  }
  // Desfazer = voltar cada chave ao que era antes da importação, com carimbos
  // NOVOS: sem eles, quem tem conta veria a nuvem (que já recebeu o importado,
  // carimbado como mais novo) trazer tudo de volta no próximo sync. Coleção e
  // wishlist ganham mod=agora no que volta e tombstone no que só a importação
  // trouxe; decks/binders/listas idem por item; blocos LWW só sobem o updatedAt.
  function restampForUndo(key, restored, current, now) {
    const idsOf = (o) => Object.keys(isPlainObject(o) ? o : {});
    if (key === SYNC_KEYS.collection || key === SYNC_KEYS.wishlist) {
      const metaKey = key === SYNC_KEYS.collection ? SYNC_KEYS.collectionMeta : SYNC_KEYS.wishlistMeta;
      const meta = { mod: {}, del: {} };
      idsOf(restored).forEach((id) => { meta.mod[id] = now; });
      idsOf(current).forEach((id) => { if (!meta.mod[id]) meta.del[id] = now; });
      return { [metaKey]: meta };
    }
    const LISTAS = { [SYNC_KEYS.decks]: "decks", [SYNC_KEYS.binders]: "binders", [SYNC_KEYS.lists]: "lists" };
    if (LISTAS[key]) {
      const field = LISTAS[key];
      const base = isPlainObject(restored) ? restored : { [field]: [] };
      const keep = (Array.isArray(base[field]) ? base[field] : []).map((it) => (it && it.id ? Object.assign({}, it, { updatedAt: now }) : it));
      const keepIds = new Set(keep.map((it) => it && it.id));
      const deleted = Object.assign({}, isPlainObject(base.deleted) ? base.deleted : {});
      const cur = isPlainObject(current) && Array.isArray(current[field]) ? current[field] : [];
      cur.forEach((it) => { if (it && it.id && !keepIds.has(it.id)) deleted[it.id] = now; });
      return { [key]: Object.assign({}, base, { [field]: keep, deleted }) };
    }
    if (isPlainObject(restored) && "updatedAt" in restored) return { [key]: Object.assign({}, restored, { updatedAt: now }) };
    return null;
  }
  function undoLastImport() {
    const f = readObject(PRE_IMPORT_KEY);
    if (!f || !isPlainObject(f.keys)) return false;
    flushWrites();
    const now = Date.now();
    const writes = {};
    const carimbos = {};
    Object.keys(f.keys).forEach((k) => {
      const raw = f.keys[k];
      let restored = null;
      try { restored = raw == null ? null : JSON.parse(raw); } catch (e) { restored = null; }
      writes[k] = raw == null ? undefined : raw;
      const extra = restampForUndo(k, restored, readObject(k), now);
      if (extra) Object.keys(extra).forEach((ek) => { carimbos[ek] = JSON.stringify(extra[ek]); });
    });
    // Os carimbos novos entram DEPOIS: a meta da coleção também está na foto
    // (com os carimbos velhos), e a ordem das chaves não pode decidir qual vence.
    Object.assign(writes, carimbos);
    const restore = snapshotKeys(Object.keys(writes));
    try {
      Object.keys(writes).forEach((k) => { if (writes[k] === undefined) localStorage.removeItem(k); else localStorage.setItem(k, writes[k]); });
      localStorage.removeItem(PRE_IMPORT_KEY);
    } catch (e) { restore(); notifyStorageFull(); return false; }
    freezeWritesUntilReload();
    return true;
  }

  async function importJson(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert(t("error.import")); return; }
    let parsed;
    try {
      parsed = validateBackupPayload(JSON.parse(await file.text()));
    } catch (e) {
      // Arquivo que não é JSON, ou é de uma versão/estrutura que este site não
      // conhece: nada foi tocado, e a mensagem diz qual dos dois foi.
      alert(t(e && e.message === "incompatible" ? "error.importIncompatible" : "error.import"));
      return;
    }
    showBackupImportPreview(parsed, (mode) => {
      try {
        applyBackupImport(planBackupImport(parsed, mode, readLocalBackupState()));
      } catch (e) {
        // Sem espaço: ou nem a cópia de segurança coube (nada mudou), ou uma
        // chave falhou no meio e todas voltaram ao que eram ("rolledback") —
        // e, se alguma nem conseguiu voltar ("partial"), a cópia fica guardada
        // pro "Desfazer importação". O arquivo está íntegro em todos os casos.
        if (e && (e.code === "snapshot" || e.code === "rolledback" || e.code === "partial")) {
          alert(t(e.code === "snapshot" ? "error.importSnapshot" : e.code === "partial" ? "error.importPartial" : "error.importRolledBack"));
          notifyStorageFull();
          return;
        }
        alert(t("error.import"));
        return;
      }
      // Confirmação do outro lado do reload: restaurar backup é o momento de
      // maior ansiedade do usuário (os dados dele na mão) e a única resposta
      // era a página recarregar — indistinguível de "não fez nada".
      try { sessionStorage.setItem("tcg-import-ok", "1"); } catch (e) { /* segue sem toast */ }
      logEvento("import_done", { f: "json", mode });
      window.location.reload();
    });
  }

  // Prévia do backup: resumo do que o arquivo traz e a escolha do modo.
  // Mesclar é o padrão (e o que a página de backup promete); substituir é
  // explícito e pede confirmação. Nada é gravado antes do clique.
  function showBackupImportPreview(parsed, onApply) {
    const old = document.querySelector(".csvimport-modal");
    if (old) old.remove();
    const sm = parsed.summary;
    const linhas = [
      tn("backup.preview.cards", sm.cards) + (sm.copies > sm.cards ? ` (${tn("backup.preview.copies", sm.copies)})` : ""),
      sm.wishlist ? tn("backup.preview.wishlist", sm.wishlist) : "",
      sm.decks ? tn("backup.preview.decks", sm.decks) : "",
      sm.binders ? tn("backup.preview.binders", sm.binders) : "",
      sm.lists ? tn("backup.preview.lists", sm.lists) : "",
      sm.graded ? tn("backup.preview.graded", sm.graded) : "",
      sm.prices ? tn("backup.preview.prices", sm.prices) : ""
    ].filter(Boolean);
    const quando = sm.exportedAt ? new Date(sm.exportedAt) : null;
    const dataTxt = quando && !isNaN(quando.getTime()) ? quando.toLocaleString(getLocale()) : "";
    const wrap = document.createElement("div");
    wrap.className = "ts-modal csvimport-modal backup-preview-modal";
    wrap.innerHTML = `<div class="ts-backdrop" data-backup-close></div>
      <div class="ts-panel" role="dialog" aria-modal="true" aria-labelledby="backupPreviewTitle">
        <h3 id="backupPreviewTitle">${escapeHtml(t("backup.preview.title"))}</h3>
        <p>${escapeHtml(t("backup.preview.file", { game: gameLabel(currentGameSlug()), version: sm.version }))}${dataTxt ? ` · ${escapeHtml(dataTxt)}` : ""}</p>
        <ul class="backup-preview-list">${linhas.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        <p class="csvimport-note">${escapeHtml(t("backup.preview.mergeD"))}</p>
        <p class="csvimport-note">${escapeHtml(t("backup.preview.replaceD"))}</p>
        <p class="csvimport-note">${escapeHtml(t("backup.preview.undoNote"))}</p>
        <div class="ts-actions">
          <button type="button" class="secondary" data-backup-close>${escapeHtml(t("csvimport.cancel"))}</button>
          <button type="button" class="secondary" data-backup-mode="replace">${escapeHtml(t("backup.preview.replace"))}</button>
          <button type="button" class="primary" data-backup-mode="merge">${escapeHtml(t("backup.preview.merge"))}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const fechar = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-backup-close]")) { fechar(); return; }
      const btn = e.target.closest("[data-backup-mode]");
      if (!btn) return;
      const mode = btn.dataset.backupMode;
      if (mode === "replace" && !window.confirm(t("backup.preview.replaceConfirm"))) return;
      fechar();
      onApply(mode);
    });
    const primario = wrap.querySelector("[data-backup-mode=\"merge\"]");
    if (primario) primario.focus();
  }

  // Importa o CSV exportado pelo Dex (dextcg.com). Formato: UTF-16, separado
  // por ";", colunas Type;Category;Locale;Series;Set;Id;Name;Variant;Rarity;
  // Quantity;Price. Os IDs são TCGdex (iguais aos do Sleevu), então é só casar
  // id+variante e gravar na coleção do Pokémon. Idempotente (re-importar dá o
  // mesmo resultado): cada (id, variante) fica com a quantidade do CSV.
  // (mapDexVariant vive no escopo do módulo, junto dos helpers de CSV.)
  // ── Importador GENÉRICO de CSV (TCGplayer, Collectr e afins) ────────────
  // Diferente do Dex (ids TCGdex prontos), esses exports só têm nome/set/
  // número — o match é feito contra o NOSSO catálogo baixando apenas os
  // chunks dos sets citados no arquivo (via manifest, igual ao quick-add).
  // Fluxo: parse tolerante -> match -> MODAL de prévia (casadas/não casadas)
  // -> aplicar (idempotente: seta a quantidade-alvo por carta×variante×cond).
  // Os helpers puros (parse/mapeamentos) vivem no escopo do módulo, testáveis.

  // Índice de manifests por jogo (fetch leve; cacheado por sessão de import).
  async function csvGameManifest(game) {
    if (currentGame() === game && window.TCG_MANIFEST) return window.TCG_MANIFEST;
    if (currentGame() === game && Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      // dev: sintetiza um "manifest" com um pseudo-chunk em memória
      return { sets: [], __cards: window.TCG_CARDS };
    }
    try {
      const r = await fetch(gameDataDir(game) + "manifest.generated.js");
      if (!r.ok) return null;
      const tx = await r.text();
      const s = tx.indexOf("{"), e = tx.lastIndexOf("}");
      return s >= 0 ? JSON.parse(tx.slice(s, e + 1)) : null;
    } catch (e) { return null; }
  }

  async function importGenericCsv(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert(t("error.import")); return; }
    try {
      const rows = parseCsvText(await file.text());
      if (rows.length < 2) { alert(t("csvimport.empty")); return; }
      const cols = mapCsvHeader(rows[0]);
      if (cols.name < 0 && (cols.set < 0 || cols.number < 0)) { alert(t("csvimport.badFormat")); return; }

      // Linhas normalizadas do arquivo.
      const items = rows.slice(1).map((r) => ({
        name: cols.name >= 0 ? String(r[cols.name] || "").trim() : "",
        set: cols.set >= 0 ? String(r[cols.set] || "").trim() : "",
        number: cols.number >= 0 ? String(r[cols.number] || "").trim() : "",
        qty: cols.qty >= 0 ? (parseInt(String(r[cols.qty] || "1"), 10) || 0) : 1,
        variant: mapCsvVariant(cols.variant >= 0 ? r[cols.variant] : ""),
        condition: mapCsvCondition(cols.condition >= 0 ? r[cols.condition] : ""),
        language: mapCsvLanguage(cols.language >= 0 ? r[cols.language] : ""),
        game: mapCsvGame(cols.game >= 0 ? r[cols.game] : "")
      })).filter((it) => it.qty > 0 && (it.name || (it.set && it.number)));
      if (!items.length) { alert(t("csvimport.empty")); return; }

      // Match: por jogo, acha os sets citados no manifest e baixa SÓ esses
      // chunks; dentro do chunk casa por número (antes da "/") ou nome exato.
      // TODOS os jogos do registro, na ordem dele (Pokémon primeiro — em
      // linha sem coluna de jogo, o primeiro que casar leva). Antes eram 3
      // fixos e planilha de Magic/YGO não casava nada. Manifests sob demanda
      // e memoizados: linha com jogo declarado só baixa o daquele jogo, e
      // jogo sem manifest (dev, JUMP vazio) devolve null e é pulado.
      const games = GAME_SLUGS;
      const matched = []; const unmatched = [];
      const chunkCache = new Map();
      const fetchChunk = (fileUrl) => {
        if (!chunkCache.has(fileUrl)) {
          chunkCache.set(fileUrl, fetch(fileUrl).then((r) => (r.ok ? r.json() : [])).catch(() => []));
        }
        return chunkCache.get(fileUrl);
      };
      const manifests = new Map();
      const manifestDe = (g) => {
        if (!manifests.has(g)) manifests.set(g, csvGameManifest(g));
        return manifests.get(g);
      };

      for (const it of items) {
        const tryGames = it.game ? [it.game] : games;
        let hit = null;
        for (const g of tryGames) {
          const mf = await manifestDe(g);
          if (!mf) continue;
          const setKeys = csvSetKeys(it.set);
          let pool;
          if (mf.__cards) {
            pool = mf.__cards.filter((c) => !setKeys.size || setKeys.has(csvNorm(c.set)));
          } else {
            let sets = mf.sets.filter((s) => setKeys.has(csvNorm(s.name)));
            // Preferência de idioma da linha; sem set na língua, tenta o resto.
            const langSets = sets.filter((s) => (s.language || "en") === it.language);
            if (langSets.length) sets = langSets;
            if (!sets.length) continue;
            const chunks = await Promise.all(sets.slice(0, 4).map((s) => fetchChunk(s.file)));
            pool = [].concat.apply([], chunks);
          }
          // Número manda (zero-padding tolerado); sem número, nome exato.
          const num = csvNorm(String(it.number).split("/")[0]);
          const nameKey = csvNorm(it.name);
          hit = pool.find((c) => {
            const cNum = csvNorm(String(c.number || "").split("/")[0]);
            if (num) {
              return cNum === num
                || (/^\d+$/.test(num) && /^\d+$/.test(cNum) && parseInt(num, 10) === parseInt(cNum, 10));
            }
            return nameKey && csvNorm(c.name) === nameKey;
          }) || null;
          if (hit) { hit = { card: hit, game: g }; break; }
        }
        if (hit) {
          // Variante que a carta não tem (ex.: "Foil" numa carta só-Holo)
          // cai na padrão da carta — chave alienígena no store não aparece
          // em tile nenhum e viraria cópia invisível.
          const vs = cardVariants(hit.card);
          const variant = vs.includes(it.variant) ? it.variant : defaultVariant(hit.card);
          matched.push({ ...it, variant, cardId: hit.card.id, cardName: hit.card.name, game: hit.game });
        } else unmatched.push(it);
      }

      showCsvImportPreview(items.length, matched, unmatched);
    } catch (e) { alert(t("error.import")); }
  }

  // Prévia: nada é gravado antes do OK. Aplicar é idempotente (seta o alvo).
  function showCsvImportPreview(total, matched, unmatched) {
    const old = document.querySelector(".csvimport-modal");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.className = "ts-modal csvimport-modal";
    const unmatchedHtml = unmatched.length
      ? `<details class="csvimport-miss"><summary>${escapeHtml(t("csvimport.unmatched", { n: unmatched.length }))}</summary>
           <ul>${unmatched.slice(0, 60).map((u) => `<li>${escapeHtml(`${u.name || "?"} · ${u.set || "?"} ${u.number || ""}`)}</li>`).join("")}</ul></details>`
      : "";
    const perGame = GAME_SLUGS
      .map((g) => [g, matched.filter((m) => m.game === g).length])
      .filter(([, n]) => n > 0)
      .map(([g, n]) => `${gameLabel(g)}: ${n}`).join(" · ");
    wrap.innerHTML = `<div class="ts-backdrop" data-csvimport-close></div>
      <div class="ts-panel">
        <h3>${escapeHtml(t("csvimport.title"))}</h3>
        <p>${escapeHtml(t("csvimport.summary", { total, ok: matched.length }))}${perGame ? ` <span class="csvimport-pergame">(${escapeHtml(perGame)})</span>` : ""}</p>
        ${unmatchedHtml}
        <p class="csvimport-note">${escapeHtml(t("csvimport.note"))}</p>
        <div class="ts-actions">
          <button type="button" class="secondary" data-csvimport-close>${escapeHtml(t("csvimport.cancel"))}</button>
          <button type="button" class="primary" data-csvimport-apply ${matched.length ? "" : "disabled"}>${escapeHtml(t("csvimport.apply", { n: matched.length }))}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-csvimport-close]")) { wrap.remove(); return; }
      if (!e.target.closest("[data-csvimport-apply]") || !matched.length) return;
      // Agrega alvo por (jogo, carta, variante, condição) e SETA (idempotente).
      const stores = {};
      const agg = new Map();
      matched.forEach((m) => {
        const k = `${m.game}|${m.cardId}|${m.variant}|${m.condition}`;
        agg.set(k, (agg.get(k) || 0) + m.qty);
      });
      let copies = 0;
      // Funil: tudo o que entrar neste laço é cadastro por importação. Volta
      // pra "ui" no fim, senão o próximo clique na tela seria contado como CSV.
      setOrigemCadastro("csv");
      agg.forEach((target, k) => {
        const [g, id, variant, cond] = k.split("|");
        const st = stores[g] || (stores[g] = createCollectionStore(g));
        st.add(id, variant, cond, target - st.getQuantity(id, variant, cond));
        copies += target;
      });
      setOrigemCadastro("ui");
      flushWrites();
      marcaPasso("csv");
      logEvento("import_done", { f: "csv", n: agg.size });
      wrap.remove();
      alert(t("csvimport.done", { cards: agg.size, copies }));
      window.location.href = "collection";
    });
  }

  async function importDexCsv(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert(t("error.import")); return; }
    try {
      const buf = await file.arrayBuffer();
      const b = new Uint8Array(buf);
      let text;
      if (b[0] === 0xFF && b[1] === 0xFE) text = new TextDecoder("utf-16le").decode(buf);
      else if (b[0] === 0xFE && b[1] === 0xFF) text = new TextDecoder("utf-16be").decode(buf);
      else text = new TextDecoder("utf-8").decode(buf);
      text = text.replace(/^﻿/, "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { alert(t("dex.empty")); return; }
      const header = lines[0].split(";").map((s) => s.trim().toLowerCase());
      const iType = header.indexOf("type"), iId = header.indexOf("id");
      const iVar = header.indexOf("variant"), iQty = header.indexOf("quantity");
      if (iId < 0 || iQty < 0) { alert(t("dex.badFormat")); return; }
      const agg = {}; // id -> variante -> qty
      let copies = 0;
      lines.slice(1).forEach((line) => {
        const r = line.split(";");
        if (iType >= 0 && String(r[iType] || "").trim().toLowerCase() !== "collection") return;
        const id = String(r[iId] || "").trim();
        const qty = parseInt(String(r[iQty] || "0").trim(), 10) || 0;
        // isUnsafeKey: o id vem CRU do arquivo (aqui, ao contrário do CSV
        // genérico, não passa por match com o catálogo) e vira chave de
        // objeto — uma linha "__proto__;…" poluiria o Object.prototype.
        if (!id || isUnsafeKey(id) || qty <= 0) return;
        const variant = mapDexVariant(r[iVar]);
        agg[id] = agg[id] || {};
        agg[id][variant] = (agg[id][variant] || 0) + qty;
      });
      const ids = Object.keys(agg);
      if (!ids.length) { alert(t("dex.empty")); return; }
      // Dex é Pokémon: grava na coleção do jogo pokemon.
      const store = createCollectionStore("pokemon");
      setOrigemCadastro("csv");   // funil: importação do Dex é cadastro por arquivo
      ids.forEach((id) => {
        Object.keys(agg[id]).forEach((variant) => {
          const target = agg[id][variant];
          const cur = store.getQuantity(id, variant, DEFAULT_CONDITION);
          store.add(id, variant, DEFAULT_CONDITION, target - cur); // seta = target
          copies += target;
        });
      });
      setOrigemCadastro("ui");
      flushWrites(); // garante a persistência antes de navegar
      marcaPasso("csv");
      logEvento("import_done", { f: "dex", n: ids.length });
      alert(t("dex.done", { cards: ids.length, copies }));
      window.location.href = "collection?game=pokemon";
    } catch (e) { alert(t("error.import")); }
  }

  // Marcador dos testes: o sandbox injeta a captura de closure aqui.
  window.TCGBackupImport = { importJson, importGenericCsv, importDexCsv, lastImportSnapshot, undoLastImport };
  Object.assign(S, {
    importBackupJson: importJson,
    importCsvFile: importGenericCsv,
    importDexCsvFile: importDexCsv,
    lastImportSnapshot,
    undoLastImport
  });
})();
