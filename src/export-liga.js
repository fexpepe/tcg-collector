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
// Os DECKS têm formatos próprios (exportarDeck, mais abaixo): Archidekt/
// Moxfield com edição e número, o cadastro de deck da LigaMagic e a Compra
// por Lista montada a partir do deck — e o leitor de linha (lerLinhaDeck) que
// o "Importar lista" usa pra ler tudo isso de volta.
//
// O formato da Liga aceita tags por carta:
//   <qtd> <nome> [QUALIDADE=SP] [EDICAO=M10] [IDIOMA=PT] [EXTRAS=FOIL]
// e no Pokémon a edição é dispensada em favor do número impresso "(NNN/TTT)",
// que é como a Liga identifica a carta lá. As exceções (cartas dos 30 anos que
// a Liga cataloga de outro jeito) vêm do shared.js — ver codigoEspecialLiga.
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

  // Cartas dos 30 anos que a Liga cataloga do jeito dela: o Mew RGB vai só pelo
  // nome, que já traz o código ("Mew - B/RGB"), e a Classic Collection pelo
  // número da carta ANTIGA com o total sem zero ("Gengar (094/30)"). O export
  // mandava "(B/128)" e "(018/030)", que não casam lá (29/09/2026). A regra é a
  // da busca da Liga e mora no shared.js (ligaSpecialCode), junto da tabela dos
  // 30 números — aqui só se consulta. Sem o shared (teste em vm mínimo), vale a
  // regra de sempre. "" = sem número; null = não é exceção.
  function codigoEspecialLiga(card) {
    const shared = window.TCGShared;
    return shared && shared.ligaSpecialCode ? shared.ligaSpecialCode(card) : null;
  }
  function numeroPokemon(card) {
    if (!card || !card.number) return "";
    const especial = codigoEspecialLiga(card);
    if (especial != null) return especial ? `(${especial})` : "";
    // Numero que JA vem "4/102" (fonte que grava o total junto) nao pode ganhar
    // o total de novo: "(4/102/102)" nao casa com nada na Liga. O catalogo de
    // producao grava so "4", mas basta uma fonte fazer diferente pra a linha
    // inteira virar lixo — e o proprio fixture de dev do repo e assim.
    if (String(card.number).indexOf("/") >= 0) return `(${String(card.number).trim()})`;
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
      let achou = EXTRAS_POR_VARIANTE[v] || (/foil/.test(v) ? "foil" : "");
      // Magic: a variante armazenada é "Foil" mesmo quando a impressão é Surge
      // (o acabamento real vive no `treat` — ver variantDisplayLabel no shared).
      // "surge foil" é o único foil especial que a Liga entende; os demais
      // (Galaxy, Halo…) seguem como "foil", que é o que casa lá.
      if (achou === "foil" && /(^|;)surgefoil(;|$)/.test(String((card && card.treat) || ""))) achou = "surge foil";
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

  // ===========================================================================
  // DECKS (2026-10-02). O "Copiar lista" do construtor só levava os nomes, e
  // quem monta o deck aqui pra VENDER precisa levar a edição de cada carta:
  // pro Archidekt/Moxfield e pro cadastro de deck da LigaMagic, onde o
  // comprador vê o preço carta a carta. Pedido de usuário (Victor), com o
  // diálogo de export do Archidekt como modelo — as opções abaixo são as dele.
  //
  // As zonas chegam já resolvidas pela página (src/decks.js), na ordem do jogo:
  //   [{ key, rotulo, scratch, entries: [{ id, qty, variant }] }]
  // `scratch` = rascunho (o Talvez; o Side do Commander), que não faz parte do
  // deck jogado — entra no Archidekt marcado como tal, mas não vai pra Liga.
  // ===========================================================================

  // Sigla oficial do set (a do Scryfall, que Archidekt, Moxfield e Liga usam).
  // `setId` é o código cru; o id "mtg-<set>-<num>" cobre carta sem o campo.
  function siglaMagic(card) {
    if (!card) return "";
    if (card.setId) return String(card.setId).toLowerCase();
    const m = /^mtg-([a-z0-9]+)-/i.exec(String(card.id));
    return m ? m[1].toLowerCase() : "";
  }

  // Categoria do Archidekt por zona. {top} é o que faz a carta virar
  // comandante lá; Sideboard e Maybeboard são as duas categorias especiais que
  // todo deck do Archidekt já tem (com as regras de contagem/preço delas), então
  // vão com o nome exato e sem flag. A zona principal vai SEM categoria: lá a
  // carta sem categoria cai no tipo dela (Creature, Land…), que é o normal.
  const CATEGORIA_ARCHIDEKT = { commander: "Commander{top}", side: "Sideboard", maybe: "Maybeboard" };

  // Marca de acabamento do Archidekt/Moxfield: *F* foil, *E* etched. A
  // variante do Scryfall é "Etched" (sem "foil" no nome), testada antes.
  function marcaAcabamento(variant) {
    const v = String(variant || "").toLowerCase();
    if (/etched/.test(v)) return "*E*";
    return /foil/.test(v) ? "*F*" : "";
  }

  // Opções (todas booleanas, nomes do diálogo do Archidekt):
  //   x    — "1x" em vez de "1"
  //   set  — sigla da edição entre parênteses
  //   num  — número de colecionador (só junto da sigla: "Sol Ring 263" sem a
  //          sigla viraria parte do NOME em qualquer importador)
  //   foil — *F* / *E*
  //   cat  — categoria da zona; desligada, as zonas saem em blocos com
  //          cabeçalho, como o texto de sempre
  function linhaArchidekt(e, card, zona, op) {
    const partes = [`${e.qty}${op.x ? "x" : ""} ${card ? card.name : e.id}`];
    const sigla = op.set ? siglaMagic(card) : "";
    if (sigla) {
      partes.push(`(${sigla})`);
      if (op.num && card.number) partes.push(String(card.number));
    }
    const marca = op.foil ? marcaAcabamento(e.variant) : "";
    if (marca) partes.push(marca);
    if (op.cat && CATEGORIA_ARCHIDEKT[zona.key]) partes.push(`[${CATEGORIA_ARCHIDEKT[zona.key]}]`);
    return partes.join(" ");
  }

  // Zonas em blocos com cabeçalho — zona única dispensa o cabeçalho, assim o
  // texto cola limpo em qualquer lugar. É o "Copiar lista" de antes, que o
  // importador do site lê de volta pelo rótulo traduzido.
  function emBlocos(zonas, linha) {
    const out = [];
    zonas.forEach((z) => {
      if (!z.entries.length) return;
      if (zonas.length > 1) { if (out.length) out.push(""); out.push(z.rotulo || z.key); }
      z.entries.forEach((e) => out.push(linha(e, z)));
    });
    return out.join("\n");
  }

  function deckArchidekt(zonas, byId, op) {
    const o = op || {};
    const linha = (e, z) => linhaArchidekt(e, byId[e.id], z, o);
    if (!o.cat) return emBlocos(zonas, linha);
    const out = [];
    zonas.forEach((z) => z.entries.forEach((e) => out.push(linha(e, z))));
    return out.join("\n");
  }

  function deckTexto(zonas, byId) {
    return emBlocos(zonas, (e) => `${e.qty} ${(byId[e.id] || {}).name || e.id}`);
  }

  // Cadastro de deck da LigaMagic: "1 Nome [SIGLA]", e o sideboard depois de
  // uma linha em branco — é assim que a Liga separa as duas listas. Rascunho
  // (Talvez, o Side do Commander) fica de fora: lá vira deck com preço, e
  // carta que não é do deck inflaria o total. Comandante vai no topo da lista
  // principal.
  function deckLigaMagic(zonas, byId) {
    const principal = [], side = [];
    zonas.forEach((z) => { if (!z.scratch) (z.key === "side" ? side : principal).push(...z.entries); });
    const linha = (e) => {
      const card = byId[e.id];
      const ed = edicaoDaCarta(card, "magic");
      return `${e.qty} ${nomeLimpo(card ? card.name : e.id)}${ed ? ` [${ed}]` : ""}`;
    };
    const out = principal.map(linha);
    if (side.length) out.push("", ...side.map(linha));
    return out.join("\n");
  }

  // Compra por Lista a partir do deck: as zonas jogadas somadas (a mesma carta
  // no deck e no side é UMA compra), sem o rascunho, em NM — deck não tem
  // condição por cópia.
  function deckCompraLiga(zonas, byId, game) {
    const porChave = new Map();
    zonas.forEach((z) => {
      if (z.scratch) return;
      z.entries.forEach((e) => {
        const k = e.id + "|" + (e.variant || "");
        const atual = porChave.get(k);
        if (atual) atual.q += e.qty;
        else porChave.set(k, { id: e.id, q: e.qty, v: e.variant || "", c: QUALIDADE_PADRAO });
      });
    });
    return paraLiga([...porChave.values()], byId, game);
  }

  function exportarDeck(formato, zonas, byId, game, opcoes) {
    if (formato === "archidekt") return deckArchidekt(zonas, byId, opcoes);
    if (formato === "ligaDeck") return deckLigaMagic(zonas, byId);
    if (formato === "liga") return deckCompraLiga(zonas, byId, game);
    return deckTexto(zonas, byId);
  }

  // Lê UMA linha de lista de deck, nos dialetos que circulam — o inverso dos
  // formatos acima, pra o que sai daqui voltar pelo "Importar lista":
  //   "4 Nome" · "4x Nome"
  //   "1x Nome (set) 123 *F* [Categoria{top}] ^Tag,#cor^"   Archidekt
  //   "1 Nome (SET) 123 *F*"                                Moxfield
  //   "1 Nome [SIGLA]"                                       LigaMagic
  // Devolve null pra linha vazia/comentário; senão { qtd, nome, bruto, sigla,
  // numero, acabamento, categorias }. `bruto` é o nome ANTES de tirar o
  // "(…)" final: no One Piece o "(Alternate Art)" é parte do nome da carta.
  function lerLinhaDeck(raw) {
    let s = String(raw || "").trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return null;
    const m = /^(\d+)\s*[xX]?\s+(.+)$/.exec(s);
    const qtd = m ? Math.min(Number(m[1]) || 1, 99) : 1;   // teto: linha corrompida não vira 9999 cópias
    s = (m ? m[2] : s).trim().replace(/\s*\^[^^]*\^\s*$/, "");   // etiqueta de cor do Archidekt
    let sigla = "", numero = "", acabamento = "", categorias = [];
    const colchete = /\s*\[([^\]]*)\]\s*$/.exec(s);
    if (colchete) {
      s = s.slice(0, colchete.index);
      const dentro = colchete[1].trim();
      // Sigla em maiúsculas é a da Liga ([WAR]); o resto é categoria do
      // Archidekt, que pode vir em lista ("Ramp,Commander{top}").
      if (/^[A-Z0-9]{2,6}$/.test(dentro)) sigla = dentro.toLowerCase();
      else categorias = dentro.split(",").map((c) => c.trim()).filter(Boolean);
    }
    s = s.replace(/\s*\*([A-Za-z]+)\*/g, (_, k) => {
      const K = k.toUpperCase();
      if (K === "F") acabamento = "foil";
      else if (K === "E") acabamento = "etched";
      return "";
    }).replace(/\s+·.*$/, "").trim();
    const bruto = s;
    const ed = /\s+\(([A-Za-z0-9]{2,8})\)(?:\s+([^\s()]+))?$/.exec(s);
    if (ed) { sigla = ed[1].toLowerCase(); numero = ed[2] || ""; s = s.slice(0, ed.index); }
    // Resto de qualquer outro dialeto: "(Nome do Set) 4" no fim.
    s = s.replace(/\s*[([][^)\]]*[)\]]\s*\d*$/, "").trim();
    if (!s) return null;
    return { qtd, nome: s, bruto, sigla, numero, acabamento, categorias };
  }

  window.TCGExportLiga = {
    exportar, paraLiga, paraTexto, paraCsv, nomeLimpo, numeroPokemon, edicaoDaCarta, idiomaDaCarta,
    exportarDeck, lerLinhaDeck
  };
})();
