// Export de listas em texto (src/export-liga.js). Lógica PURA: recebe entradas +
// cartas do catálogo e devolve string — sem DOM, sem localStorage. É o que
// permite testar linha a linha em node (tests/liga-export.test.mjs).
//
// Três formatos:
//   liga  — "Compra por Lista" da Liga (ligamagic/ligapokemon/ligaonepiece...),
//           o motivo da feature: colar lá e comprar tudo de uma vez.
//   texto — "<qtd> <nome>", que o import de deck do PRÓPRIO site já lê
//           (parseDeckText, src/decks.js) — uma lista vira deck sem conversão.
//   csv   — Moxfield no Magic (interop com Moxfield/Archidekt); nos demais
//           jogos, o CSV padrão do site.
//
// O formato da Liga aceita tags por carta:
//   <qtd> <nome> [QUALIDADE=SP] [EDICAO=M10] [IDIOMA=PT] [EXTRAS=FOIL]
// e no Pokémon a edição é dispensada em favor do número impresso "(NNN/TTT)",
// que é como a Liga identifica a carta lá.
(function () {
  "use strict";

  // Escala de qualidade da Liga: M/NM/SP/MP/HP/D. É EXATAMENTE a mesma escala
  // que o site usa na coleção (CARD_CONDITIONS), então não há de-para a fazer.
  const QUALIDADE_PADRAO = "NM";

  // Sufixo de idioma do id (-pt/-ja/-zh...) -> código da Liga. EN é o default
  // dela e sai omitido — linha mais curta, mesmo resultado.
  const IDIOMA_POR_SUFIXO = { pt: "PT", ja: "JP", "zh-cn": "CN", "zh-tw": "CN", zh: "CN" };
  function idiomaDaCarta(cardId) {
    const m = /-(pt|ja|zh-cn|zh-tw|zh)$/.exec(String(cardId || ""));
    return m ? IDIOMA_POR_SUFIXO[m[1]] : "";
  }

  // Nome limpo pra busca da Liga. Os catálogos de TCGCSV (One Piece, Gundam,
  // FAB, Digimon...) carregam o tratamento no PRÓPRIO nome — "Monkey D. Luffy
  // (Alternate Art)" —, e a Liga não acha a carta com esse sufixo. O tratamento
  // não se perde: vira EXTRAS quando reconhecido.
  const SUFIXO_TRATAMENTO = /\s*[([]([^)\]]*)[)\]]\s*$/;
  function nomeLimpo(nome) {
    return String(nome || "").replace(SUFIXO_TRATAMENTO, "").trim();
  }
  function tratamentoDoNome(nome) {
    const m = SUFIXO_TRATAMENTO.exec(String(nome || ""));
    return m ? m[1].trim() : "";
  }

  // Número impresso no padrão da Liga pro Pokémon: "078/084", com zero à
  // esquerda nos dois lados (é como está impresso na carta).
  function pad3(v) {
    const s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) ? s.padStart(3, "0") : s;
  }
  function numeroPokemon(card) {
    if (!card || !card.number) return "";
    const total = card.setTotal ? pad3(card.setTotal) : "";
    return total ? `(${pad3(card.number)}/${total})` : `(${pad3(card.number)})`;
  }

  // EXTRAS: o vocabulário da Liga é curto e minúsculo. Só entra o que ela
  // entende — inventar token faz a linha inteira não casar lá.
  const EXTRAS_POR_VARIANTE = {
    foil: "foil", "holofoil": "foil", holo: "foil", reverse: "reverse holo",
    etched: "etched foil", "surge foil": "surge foil"
  };
  function extrasDaEntrada(entry, card) {
    const out = [];
    const v = String(entry.v || "").toLowerCase();
    if (v) {
      const achou = EXTRAS_POR_VARIANTE[v] || (/foil/.test(v) ? "foil" : "");
      if (achou) out.push(achou);
    }
    const trat = tratamentoDoNome(card && card.name).toLowerCase();
    if (trat && /alt|extended|borderless|full art|showcase|textless/.test(trat)) out.push(trat);
    return out;
  }

  // Sigla da edição. Magic: sai do id "mtg-<set>-<num>", que é o código oficial
  // do Scryfall — o mesmo que a Liga usa. Nos outros jogos o id não carrega
  // sigla confiável, e mandar o NOME do set faria a Liga casar errado: melhor
  // omitir e deixar a busca dela resolver pelo nome da carta.
  function edicaoDaCarta(card, game) {
    if (game !== "magic") return "";
    const m = /^mtg-([a-z0-9]+)-/i.exec(String(card && card.id));
    return m ? m[1].toUpperCase() : "";
  }

  // Uma linha da Liga.
  function linhaLiga(entry, card, game) {
    const qtd = entry.q == null ? 1 : entry.q;
    const nome = nomeLimpo(card ? card.name : entry.id);
    const partes = [`${qtd} ${nome}`];

    if (game === "pokemon") {
      const num = numeroPokemon(card);
      if (num) partes[0] += ` ${num}`;
    }
    partes.push(`[QUALIDADE=${entry.c || QUALIDADE_PADRAO}]`);

    const ed = edicaoDaCarta(card, game);
    if (ed) partes.push(`[EDICAO=${ed}]`);

    const idioma = idiomaDaCarta(card ? card.id : entry.id);
    if (idioma) partes.push(`[IDIOMA=${idioma}]`);

    const extras = extrasDaEntrada(entry, card);
    if (extras.length) partes.push(`[EXTRAS=${extras.join(", ")}]`);

    return partes.join(" ");
  }

  function paraLiga(entries, byId, game) {
    return (entries || []).map((e) => linhaLiga(e, byId[e.id], game)).join("\n");
  }

  // Texto puro: o mesmo "<qtd> <nome>" que o parseDeckText do site lê de volta.
  function paraTexto(entries, byId) {
    return (entries || []).map((e) => {
      const card = byId[e.id];
      return `${e.q == null ? 1 : e.q} ${card ? card.name : e.id}`;
    }).join("\n");
  }

  // CSV. Magic sai no cabeçalho do Moxfield (interop direta com
  // Moxfield/Archidekt); os demais jogos, no CSV do site (";" e BOM ficam a
  // cargo de quem baixa, como no buildCollectionCsv).
  function csvCell(value) {
    const s = value == null ? "" : String(value);
    return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function paraCsv(entries, byId, game) {
    const magic = game === "magic";
    const head = magic
      ? "Count,Name,Edition,Condition,Language,Foil"
      : "Quantidade;Nome;Set;Número;Variante;Condição";
    const sep = magic ? "," : ";";
    const linhas = (entries || []).map((e) => {
      const card = byId[e.id] || {};
      const qtd = e.q == null ? 1 : e.q;
      const cond = e.c || QUALIDADE_PADRAO;
      if (magic) {
        // "foil"/"etched" no campo Foil; vazio = normal, é o contrato do
        // Moxfield. A variante do Scryfall é "Etched" (sem "foil" no nome), por
        // isso ela é testada ANTES e por conta própria.
        const vv = String(e.v || "").toLowerCase();
        const foil = /etched/.test(vv) ? "etched" : (/foil/.test(vv) ? "foil" : "");
        const ed = edicaoDaCarta(card, game);
        const idioma = idiomaDaCarta(card.id) || "English";
        return [qtd, nomeLimpo(card.name || e.id), ed, cond, idioma, foil].map(csvCell).join(sep);
      }
      return [qtd, card.name || e.id, card.set || "", card.number || "", e.v || "", cond].map(csvCell).join(sep);
    });
    return [head].concat(linhas).join("\n");
  }

  function exportar(formato, entries, byId, game) {
    if (formato === "texto") return paraTexto(entries, byId);
    if (formato === "csv") return paraCsv(entries, byId, game);
    return paraLiga(entries, byId, game);
  }

  window.TCGExportLiga = { exportar, paraLiga, paraTexto, paraCsv, nomeLimpo, numeroPokemon, edicaoDaCarta, idiomaDaCarta };
})();
