// Artistas e Treinadores (artists.html / trainers.html) — redesenho de
// 2026-10-17. As duas telas eram uma grade de 7 colunas com o nome cortado
// ("Aaron'…", "Acade…"), uma inicial no lugar de imagem e "0%" em tudo pra quem
// não tem conta; a ordem alfabética punha `"Big M…`, `0313` e `2017 P…` no topo
// e o "Artista desconhecido" (13 mil cartas sem ilustrador) aparecia como se
// fosse uma pessoa. Este módulo é dono do desenho das duas; o app.js continua
// dono dos dados (índice `{ name, cardIds }`, filtros, busca) e chama daqui:
//   liga(ctx)      uma vez, com o catálogo em mãos;
//   itens(lista)   tira o "sem nome", ordena, agrupa e devolve o que a grade
//                  desenha;
//   desenha(item)  o elemento de cada artista/treinador (ou cabeçalho de era);
//   pintou(grade)  depois de cada render/append: resumo, eras, rodapé e capas.
// Só artists.html e trainers.html carregam este arquivo, então Sets e Pokédex
// (que dividem o app.js) não pagam nada dele — nem o CSS (área "entidades").
//
// Versão B, "Índice por era" (o molde do Bill's Archive): uma LINHA por
// artista com a carta-capa, o nome inteiro, os anos e o nº de sets, e a
// lista agrupada pela era em que a pessoa estreou — com os chips de era no
// topo pra pular direto pra uma delas.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, tn, escapeHtml, escapeAttribute, detailUrl, localizedImg } = shared;

  // "Artista desconhecido" é o rótulo que o build dá à carta SEM ilustrador
  // (scripts: groupToIndex) — não é gente e não entra na lista; vira uma linha
  // no pé, com o link pras cartas, que continuam existindo.
  const SEM_NOME = /^(artista desconhecido|unknown)/i;
  const ORDEM_KEY = "tcg-ent-ordem";
  const CAPAS_KEY = "tcg-ent-capas-v1";
  // Quantas cartas de cada um vão pra borda escolher a capa: as dos sets mais
  // recentes (uma por set) e outras espalhadas pelo resto da obra — a mais
  // valiosa entre elas é a capa. Uma amostra, e não todas: o 5ban tem 5.762.
  const AMOSTRA = { recentes: 6, espalhadas: 6 };
  // Teto da /api/collection por requisição (functions/api/collection.js).
  const MAX_IDS = 1200;

  let ctx = null;
  let ordem = lerPref(ORDEM_KEY, "era");
  // Chip de era escolhido. Não fica salvo: é navegação desta visita.
  let eraEscolhida = "";
  let ultimo = { itens: [], semNome: null, temColecao: false, eras: [] };
  const porChave = new Map(); // chave -> item (o da última lista)

  function lerPref(chave, padrao) {
    try { return localStorage.getItem(chave) || padrao; } catch (e) { return padrao; }
  }
  function gravaPref(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* storage bloqueado: vale só nesta visita */ }
  }
  const fmt = (n) => Number(n || 0).toLocaleString(shared.getLocale());

  // ── Ano de cada carta, pelo set ─────────────────────────────────────────
  // O índice só tem ids; o ano sai do manifest (data de lançamento de cada
  // set). O set está no próprio id em todo jogo que tem artista: base1-4,
  // sv03.5-001-pt, 14-152 (Lorcana), hp-qc-20-premium, mtg-sld-910 (Magic,
  // cujo set no manifest é só "sld"). O prefixo mais longo que é um set ganha.
  let lancamentos = null;
  const setDoIdMemo = new Map();
  function mapaDeLancamentos() {
    if (lancamentos) return lancamentos;
    lancamentos = new Map();
    const man = ctx && ctx.manifest ? ctx.manifest() : null;
    ((man && man.sets) || []).forEach((s) => {
      const data = String(s.release || s.releaseDate || "");
      if (!s.id || !data) return;
      const antes = lancamentos.get(s.id);
      if (!antes || data < antes) lancamentos.set(s.id, data);
    });
    return lancamentos;
  }
  function setDoId(id) {
    if (setDoIdMemo.has(id)) return setDoIdMemo.get(id);
    const mapa = mapaDeLancamentos();
    const partes = String(id).replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "").split("-");
    let achado = "";
    for (let k = partes.length - 1; k >= 1 && !achado; k--) {
      const c = partes.slice(0, k).join("-");
      if (mapa.has(c)) achado = c;
      else if (c.startsWith("mtg-") && mapa.has(c.slice(4))) achado = c.slice(4);
    }
    setDoIdMemo.set(id, achado);
    return achado;
  }
  const dataDoId = (id) => mapaDeLancamentos().get(setDoId(id)) || "";

  // ── Eras ────────────────────────────────────────────────────────────────
  // Pokémon: as gerações do card game, pela DATA do primeiro set de cada uma
  // — com a régua do mercado da carta, porque o mesmo set sai no Japão meses
  // antes (o XY japonês é de jul/2013, o inglês de out/2013). As séries do
  // manifest não servem: misturam promos, kits e McDonald's com as gerações.
  // [chave, começo no ocidente (en/pt), começo na Ásia (ja/zh)]
  const ERAS_POKEMON = [
    ["original", "", ""],
    ["ex", "2003-07-01", "2003-01-01"],
    ["dp", "2007-05-01", "2006-09-28"],
    ["bw", "2011-04-25", "2010-09-18"],
    ["xy", "2013-10-12", "2013-07-12"],
    ["sm", "2017-02-03", "2016-12-09"],
    ["swsh", "2019-11-15", "2019-12-06"],
    ["sv", "2023-03-31", "2023-01-20"],
    ["mega", "2025-09-25", "2025-08-01"]
  ];
  function eraPokemon(id, data) {
    const asia = /^(ja|zh)/.test(shared.cardLanguageFromId(id) || "");
    let i = 0;
    for (let k = 1; k < ERAS_POKEMON.length; k++) if (data >= ERAS_POKEMON[k][asia ? 2 : 1]) i = k;
    return i;
  }

  // Obra de cada um: primeiro e último ano, nº de sets e a era de estreia
  // (índice em ERAS_POKEMON no Pokémon; o ANO de estreia nos outros jogos, que
  // viram faixas no itens()). Memo por chave: mesmos ids, mesma resposta.
  const obraMemo = new Map();
  function obra(item) {
    const k = chave(item);
    if (obraMemo.has(k)) return obraMemo.get(k);
    const pokemon = ctx && ctx.game === "pokemon";
    let min = "", max = "", era = Infinity;
    const sets = new Set();
    (item.cardIds || []).forEach((id) => {
      const d = dataDoId(id);
      if (!d) return;
      sets.add(setDoId(id));
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
      if (pokemon) era = Math.min(era, eraPokemon(id, d));
    });
    const anos = min ? (min.slice(0, 4) === max.slice(0, 4) ? min.slice(0, 4) : `${min.slice(0, 4)}–${max.slice(0, 4)}`) : "";
    const r = { anos, nSets: sets.size, estreia: min ? Number(min.slice(0, 4)) : 0, era: pokemon && era !== Infinity ? era : -1 };
    obraMemo.set(k, r);
    return r;
  }

  // Era de cada item da lista, como { chave, rotulo }. Fora do Pokémon: ano
  // de estreia se o jogo cabe em 10 anos (Lorcana: 2023…2026), senão faixas
  // de 5 (Magic: 1993–1997, 1998–2002…).
  function erasDaLista(gente) {
    const pokemon = ctx && ctx.game === "pokemon";
    const anos = gente.map((item) => obra(item).estreia).filter(Boolean);
    const de = Math.min.apply(null, anos), ate = Math.max.apply(null, anos);
    const porAno = anos.length && ate - de <= 9;
    return (item) => {
      const o = obra(item);
      if (pokemon) {
        return o.era < 0 ? { chave: "z", rotulo: t("ent.era.none") } : { chave: `p${o.era}`, rotulo: t(`ent.era.${ERAS_POKEMON[o.era][0]}`) };
      }
      if (!o.estreia) return { chave: "z", rotulo: t("ent.era.none") };
      if (porAno) return { chave: `y${o.estreia}`, rotulo: String(o.estreia) };
      const ini = de + Math.floor((o.estreia - de) / 5) * 5;
      return { chave: `y${ini}`, rotulo: `${ini}–${Math.min(ini + 4, ate)}` };
    };
  }

  // ── Chave, iniciais e ordem ─────────────────────────────────────────────
  // A capa depende das cartas que entram: o Treinador "Iono" em inglês e em
  // japonês são listas diferentes. O recorte (idioma/região) vai na chave.
  function chave(item) {
    const recorte = ctx && ctx.recorte ? ctx.recorte() : "";
    return `${ctx ? ctx.game : ""}|${ctx ? ctx.view : ""}|${recorte}|${item.name}`;
  }
  // Nome sem o que vem antes da primeira letra/número (`"Big Mama" Tagawa`
  // ordena no B) — só pra ordenar e pras iniciais; o nome mostrado é o real.
  const semPontaSolta = (s) => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "");
  function iniciais(nome) {
    const palavras = semPontaSolta(nome).split(/[\s&/]+/).filter(Boolean);
    const letra = (p) => (p.match(/[\p{L}\p{N}]/u) || [""])[0];
    return ((letra(palavras[0] || "") + letra(palavras[1] || "")) || "?").toUpperCase();
  }
  const az = (a, b) => semPontaSolta(a.name).localeCompare(semPontaSolta(b.name), shared.getLocale(), { sensitivity: "base", numeric: true });
  const porCartas = (a, b) => b.totalCount - a.totalCount || az(a, b);
  const ORDENS = {
    // Por era: dentro de cada era, quem tem mais cartas primeiro.
    era: porCartas,
    cartas: porCartas,
    az,
    // Na minha coleção: quem tem mais cartas suas primeiro; empate pelo quanto
    // falta pra fechar.
    minhas: (a, b) => b.ownedCount - a.ownedCount || (b.ownedCount / b.totalCount) - (a.ownedCount / a.totalCount) || az(a, b)
  };

  function liga(c) {
    ctx = c;
    lancamentos = null;
    setDoIdMemo.clear();
    obraMemo.clear();
    leCapasDaSessao();
    montaTopo();
  }

  // Mesma pessoa com grafias diferentes vira UMA linha (shared.artistKey; a
  // página do artista filtra pela mesma chave). Fica o nome da grafia com mais
  // cartas — a que o catálogo mais usa. Os ids não se repetem entre grafias
  // (cada carta tem um só texto de artista), então as contas só somam.
  function juntaGrafias(lista) {
    const porNome = new Map();
    lista.forEach((item) => {
      const k = shared.artistKey(item.name);
      const atual = porNome.get(k);
      if (!atual) { porNome.set(k, item); return; }
      const maior = item.totalCount > atual.totalCount ? item : atual;
      porNome.set(k, Object.assign({}, maior, {
        cards: (atual.cards || []).concat(item.cards || []),
        cardIds: (atual.cardIds || []).concat(item.cardIds || []),
        totalCount: atual.totalCount + item.totalCount,
        ownedCount: atual.ownedCount + item.ownedCount
      }));
    });
    return Array.from(porNome.values());
  }

  function itens(lista) {
    const artistas = ctx && ctx.view === "artists";
    let semNome = null;
    let gente = [];
    (artistas ? juntaGrafias(lista || []) : (lista || [])).forEach((item) => {
      if (artistas && SEM_NOME.test(item.name)) semNome = item;
      else gente.push(item);
    });
    const temColecao = gente.some((item) => item.ownedCount > 0);
    const usada = ORDENS[ordem] && (ordem !== "minhas" || temColecao) ? ordem : "era";
    gente.sort(ORDENS[usada]);

    // Eras: contadas sobre a lista inteira (o chip diz quantos há em cada uma
    // mesmo com outra escolhida), em ordem cronológica.
    const eraDe = erasDaLista(gente);
    const eras = new Map();
    gente.forEach((item) => {
      const e = eraDe(item);
      item.eraChave = e.chave;
      const atual = eras.get(e.chave) || { chave: e.chave, rotulo: e.rotulo, n: 0, de: 9999, ate: 0 };
      atual.n += 1;
      const o = obra(item);
      if (o.estreia) { atual.de = Math.min(atual.de, o.estreia); atual.ate = Math.max(atual.ate, o.estreia); }
      eras.set(e.chave, atual);
    });
    const listaDeEras = Array.from(eras.values()).sort((a, b) => a.chave.localeCompare(b.chave, "en", { numeric: true }));
    if (eraEscolhida && !eras.has(eraEscolhida)) eraEscolhida = "";
    if (eraEscolhida) gente = gente.filter((item) => item.eraChave === eraEscolhida);

    ultimo = { itens: gente, semNome, temColecao, ordem: usada, eras: listaDeEras };
    porChave.clear();
    gente.forEach((item) => porChave.set(chave(item), item));
    if (usada !== "era" || listaDeEras.length < 2) return gente;

    // Por era: cabeçalho de cada uma e os dela embaixo.
    const sufixo = artistas ? "artists" : "trainers";
    const out = [];
    listaDeEras.forEach((era) => {
      const membros = gente.filter((item) => item.eraChave === era.chave);
      if (!membros.length) return;
      out.push({ type: "ent-era-head", era, texto: tn(`ent.debuted.${sufixo}`, era.n, { n: fmt(era.n) }) });
      out.push(...membros);
    });
    return out;
  }

  // ── Cabeçalho de era e linha ────────────────────────────────────────────
  function desenha(item) {
    if (item.type === "ent-era-head") {
      const h = document.createElement("h2");
      h.className = "ent-era-head";
      const anos = item.era.de <= item.era.ate && item.era.de !== 9999 && !/^y/.test(item.era.chave)
        ? `<span class="ent-era-anos">${item.era.de === item.era.ate ? item.era.de : `${item.era.de}–${item.era.ate}`}</span>` : "";
      h.innerHTML = `<span class="ent-era-nome">${escapeHtml(item.era.rotulo)}</span>${anos}<span class="ent-era-n">${escapeHtml(item.texto)}</span>`;
      return h;
    }
    return linha(item);
  }

  function linha(item) {
    const k = chave(item);
    const el = document.createElement("a");
    const completo = item.totalCount > 0 && item.ownedCount >= item.totalCount;
    el.className = `ent-row${completo ? " is-complete" : ""}`;
    el.href = detailUrl(ctx && ctx.view === "trainers" ? "trainer" : "artist", item.name);
    el.dataset.entK = k;
    const o = obra(item);
    const meta = [];
    if (o.anos) meta.push(o.anos);
    if (o.nSets) meta.push(tn("ent.sets", o.nSets, { n: fmt(o.nSets) }));
    const pct = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    // Progresso só pra quem tem carta daquele artista: "0%" em 438 linhas não
    // diz nada a quem chega e desanima quem está começando.
    const progresso = item.ownedCount > 0
      ? `<span class="ent-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}"><span class="ent-prog-bar"><i style="width:${pct}%"></i></span><span class="ent-prog-txt">${escapeHtml(t("ent.owned", { o: fmt(item.ownedCount), t: fmt(item.totalCount) }))}</span></span>`
      : "";
    el.innerHTML = `<span class="ent-capa" aria-hidden="true">${capaHtml(k, item)}</span>`
      + `<span class="ent-corpo"><span class="ent-nome">${escapeHtml(item.name)}</span>`
      + (meta.length ? `<span class="ent-meta">${escapeHtml(meta.join(" · "))}</span>` : "")
      + `${progresso}</span>`
      + `<span class="ent-qtd"><strong>${escapeHtml(fmt(item.totalCount))}</strong>${escapeHtml(tn("ent.lbl.cards", item.totalCount))}</span>`;
    return el;
  }

  // A carta-capa (a mais valiosa da amostra). Sem capa ainda (ou sem a
  // borda): as iniciais, no lugar exato onde a carta entra — nada pula.
  function capaHtml(k, item) {
    const c = capas.get(k);
    if (!c || !c.imgs || !c.imgs.length) {
      return `<span class="ent-mono${c && c.estado === "sem" ? "" : " is-loading"}">${escapeHtml(iniciais(item.name))}</span>`;
    }
    return localizedImg(c.imgs[0], { className: "ent-c", loading: "lazy", thumb: true, sizes: "64px", alt: "" });
  }

  // ── Capas pela borda ────────────────────────────────────────────────────
  // A capa é uma carta de verdade do artista/treinador. O índice não traz
  // imagem nem preço, e baixar os chunks dos sets pra isso era o custo que a
  // tela tirou em 2026-10 (238 requisições no Magic). A /api/collection devolve
  // carta e preço de uma lista de ids numa requisição só: pedimos uma amostra
  // de cada linha que chega perto da tela, e a mais valiosa vira a capa.
  // Borda fora (503, rede): ficam as iniciais, e a página não pergunta de novo.
  const capas = new Map(); // chave -> { imgs: [url…], estado: "ok"|"sem" }
  const fila = new Map(); // chave -> item
  let espera = 0;
  let bordaFora = false;
  let io = null;

  // Na sessão, pra voltar da página do artista sem pedir tudo de novo. Só o que
  // a borda respondeu: "sem" por borda fora não fica guardado.
  function leCapasDaSessao() {
    try {
      const salvo = JSON.parse(sessionStorage.getItem(CAPAS_KEY) || "{}");
      Object.keys(salvo).forEach((k) => {
        const imgs = Array.isArray(salvo[k] && salvo[k].i) ? salvo[k].i : [];
        capas.set(k, { imgs, estado: imgs.length ? "ok" : "sem", daBorda: true });
      });
    } catch (e) { /* sessão sem storage: pede de novo, só isso */ }
  }
  function gravaCapasNaSessao() {
    try {
      const out = {};
      capas.forEach((c, k) => { if (c.daBorda) out[k] = { i: c.imgs }; });
      sessionStorage.setItem(CAPAS_KEY, JSON.stringify(out));
    } catch (e) { /* cheio: a próxima visita pede de novo */ }
  }

  function amostra(item) {
    const ids = item.cardIds || [];
    const { recentes, espalhadas } = AMOSTRA;
    if (ids.length <= recentes + espalhadas) return ids.slice();
    const comData = ids.map((id) => [id, dataDoId(id)]).sort((a, b) => b[1].localeCompare(a[1]));
    const out = [], sets = new Set();
    for (const [id] of comData) {
      if (out.length >= recentes) break;
      const s = setDoId(id) || id;
      if (sets.has(s)) continue;
      sets.add(s);
      out.push(id);
    }
    const escolhidas = new Set(out);
    const resto = comData.map(([id]) => id).filter((id) => !escolhidas.has(id));
    for (let i = 0; i < espalhadas && resto.length; i++) {
      out.push(resto[Math.floor(((i + 0.5) * resto.length) / espalhadas)]);
    }
    return out;
  }

  // Peso pra escolher a capa: a maior referência da carta em qualquer versão
  // (USD/EUR andam perto o bastante pra ORDENAR; não é valor mostrado).
  function peso(p) {
    if (!p) return 0;
    let m = Math.max(p.u || 0, p.uf || 0, p.e || 0);
    if (p.v) Object.keys(p.v).forEach((v) => { m = Math.max(m, p.v[v] || 0); });
    return m;
  }

  function enfileira(el) {
    const k = el.dataset.entK;
    if (!k || capas.has(k) || fila.has(k)) return;
    const item = porChave.get(k);
    if (!item) return;
    if (bordaFora) { capas.set(k, { imgs: [], estado: "sem" }); pinta(k); return; }
    fila.set(k, item);
    clearTimeout(espera);
    espera = setTimeout(pede, 60);
  }

  async function pede() {
    if (!fila.size || !ctx) return;
    const lote = [];
    let n = 0;
    for (const [k, item] of fila) {
      const ids = amostra(item);
      if (n + ids.length > MAX_IDS && lote.length) break;
      lote.push([k, item, ids]);
      n += ids.length;
    }
    lote.forEach(([k]) => fila.delete(k));
    if (fila.size) espera = setTimeout(pede, 0);
    const ids = [...new Set(lote.flatMap(([, , i]) => i))];
    const cartas = new Map();
    let precos = {};
    try {
      const r = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [ctx.game]: ids })
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      ((j.c && j.c[ctx.game]) || []).forEach((c) => cartas.set(c.id, c));
      precos = (j.p && j.p[ctx.game]) || {};
    } catch (e) {
      bordaFora = true;
    }
    lote.forEach(([k, , amostraIds]) => {
      const candidatas = amostraIds.map((id) => cartas.get(id)).filter((c) => c && c.image)
        .map((c) => ({ img: c.image, peso: peso(precos[c.id] || precos[shared.basePricingId(c.id)]), data: c.setReleaseDate || "" }))
        .sort((a, b) => b.peso - a.peso || b.data.localeCompare(a.data));
      // Duas de reserva: se a 1ª não carregar, a linha não fica sem capa.
      const imgs = [...new Set(candidatas.map((c) => c.img))].slice(0, 3);
      capas.set(k, { imgs, estado: imgs.length ? "ok" : "sem", daBorda: !bordaFora });
      pinta(k);
    });
    gravaCapasNaSessao();
  }

  function pinta(k) {
    const item = porChave.get(k);
    if (!item) return;
    document.querySelectorAll(`[data-ent-k="${CSS.escape(k)}"] .ent-capa`).forEach((capa) => {
      capa.innerHTML = capaHtml(k, item);
    });
  }

  // A capa que não carregou (a cadeia de fallback do shared desistiu) dá a vez
  // à próxima da amostra; sem próxima, voltam as iniciais.
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!img || !img.classList || !img.classList.contains("ent-c") || img.hasAttribute("data-img-fallbacks")) return;
    const el = img.closest("[data-ent-k]");
    const c = el && capas.get(el.dataset.entK);
    if (!c || !c.imgs.length) return;
    // Espera o retry do shared (ele tenta a mesma URL mais uma vez).
    setTimeout(() => {
      if (!img.isConnected || img.classList.contains("is-loaded")) return;
      c.imgs.shift();
      if (!c.imgs.length) c.estado = "sem";
      pinta(el.dataset.entK);
    }, 3500);
  }, true);

  function observa(grade) {
    const novos = grade.querySelectorAll("[data-ent-k]:not([data-ent-obs])");
    if (!("IntersectionObserver" in window)) { novos.forEach(enfileira); return; }
    if (!io) {
      io = new IntersectionObserver((entradas) => {
        entradas.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          enfileira(e.target);
        });
      }, { rootMargin: "600px 0px" });
    }
    novos.forEach((el) => { el.setAttribute("data-ent-obs", ""); io.observe(el); });
  }

  // ── Topo (resumo, ordem, eras) e rodapé ─────────────────────────────────
  function montaTopo() {
    const topo = document.getElementById("entTopo");
    if (!topo || topo.dataset.montado) return;
    topo.dataset.montado = "1";
    const muda = (tipo, valor) => {
      if (tipo === "ordem") { ordem = valor; gravaPref(ORDEM_KEY, ordem); } else eraEscolhida = valor;
      if (ctx && ctx.onChange) ctx.onChange();
    };
    topo.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-ent-ordem], [data-ent-era]");
      if (!chip || chip.getAttribute("aria-pressed") === "true") return;
      if (chip.hasAttribute("data-ent-ordem")) muda("ordem", chip.dataset.entOrdem);
      else muda("era", chip.dataset.entEra);
    });
    // No celular os dois viram <select> lado a lado (uma linha só, como a
    // Coleção e o perfil): chips de era numa faixa própria comiam a tela antes
    // da lista — o mesmo motivo de a faixa de eras ter saído da tela de Sets.
    topo.addEventListener("change", (event) => {
      const sel = event.target.closest("select[data-ent-sel]");
      if (sel) muda(sel.dataset.entSel, sel.value);
    });
  }
  const opcao = (valor, rotulo, atual) => `<option value="${escapeAttribute(valor)}"${valor === atual ? " selected" : ""}>${escapeHtml(rotulo)}</option>`;

  function pintaTopo() {
    const resumo = document.getElementById("entResumo");
    const ordemEl = document.getElementById("entOrdem");
    const erasEl = document.getElementById("entEras");
    const { itens: lista, temColecao } = ultimo;
    const sufixo = ctx && ctx.view === "trainers" ? "trainers" : "artists";
    if (resumo) {
      const totalCartas = lista.reduce((s, i) => s + i.totalCount, 0);
      // Rótulos sem o número (o número vai em <strong>): tn só escolhe a forma.
      const pares = [[lista.length, tn(`ent.lbl.${sufixo}`, lista.length)], [totalCartas, tn("ent.lbl.cards", totalCartas)]];
      // Contado na lista que está na tela (com a era escolhida, só ela); zero
      // não aparece — "0 com cartas suas" numa era vazia só soa como bronca.
      const comCartas = temColecao ? lista.filter((i) => i.ownedCount > 0).length : 0;
      if (comCartas) {
        const completos = lista.filter((i) => i.totalCount > 0 && i.ownedCount >= i.totalCount).length;
        pares.push([comCartas, t(`ent.lbl.withYours.${sufixo}`)]);
        if (completos) pares.push([completos, tn("ent.lbl.complete", completos)]);
      }
      const html = pares.map(([n, rotulo]) => `<span class="ent-num"><strong>${escapeHtml(fmt(n))}</strong> ${escapeHtml(rotulo)}</span>`).join("");
      if (resumo.innerHTML !== html) resumo.innerHTML = html;
    }
    // Os botões só são redesenhados se mudaram: o onAppend do scroll infinito
    // chama de novo, e trocar os botões tiraria o foco de quem usa o teclado.
    const idioma = shared.getLanguage();
    if (ordemEl) {
      const opcoes = ["era", "cartas", "az"].concat(temColecao ? ["minhas"] : []);
      const assinatura = `${opcoes.join(",")}|${ultimo.ordem}|${idioma}`;
      if (ordemEl.dataset.assinatura !== assinatura) {
        ordemEl.dataset.assinatura = assinatura;
        ordemEl.innerHTML = `<span class="ent-ordem-rot">${escapeHtml(t("ent.sort"))}</span>` + opcoes.map((o) =>
          `<button type="button" class="chip" data-ent-ordem="${o}" aria-pressed="${o === ultimo.ordem}">${escapeHtml(t(`ent.sort.${o}`))}</button>`).join("")
          + `<select class="ent-sel" data-ent-sel="ordem" aria-label="${escapeAttribute(t("ent.sort"))}">${opcoes.map((o) => opcao(o, t(`ent.sort.${o}`), ultimo.ordem)).join("")}</select>`;
      }
    }
    if (erasEl) {
      const eras = ultimo.eras;
      erasEl.hidden = eras.length < 2;
      const assinatura = `${eras.map((e) => `${e.chave}:${e.n}`).join(",")}|${eraEscolhida}|${idioma}`;
      if (!erasEl.hidden && erasEl.dataset.assinatura !== assinatura) {
        erasEl.dataset.assinatura = assinatura;
        const total = eras.reduce((s, e) => s + e.n, 0);
        const chip = (chaveEra, rotulo, n) => `<button type="button" class="chip" data-ent-era="${escapeAttribute(chaveEra)}" aria-pressed="${chaveEra === eraEscolhida}">${escapeHtml(rotulo)} <span class="ent-eras-n">${escapeHtml(fmt(n))}</span></button>`;
        const rotuloSel = (rotulo, n) => `${rotulo} (${fmt(n)})`;
        erasEl.innerHTML = chip("", t("ent.era.all"), total) + eras.map((e) => chip(e.chave, e.rotulo, e.n)).join("")
          + `<select class="ent-sel" data-ent-sel="era" aria-label="${escapeAttribute(t("ent.erasAria"))}">${opcao("", t("ent.era.allEras"), eraEscolhida)}${eras.map((e) => opcao(e.chave, rotuloSel(e.rotulo, e.n), eraEscolhida)).join("")}</select>`;
      }
    }
    const rodape = document.getElementById("entRodape");
    if (rodape) {
      const s = ultimo.semNome;
      rodape.hidden = !s;
      if (s) {
        rodape.innerHTML = `${escapeHtml(tn("ent.unknown", s.totalCount, { n: fmt(s.totalCount) }))} <a href="${escapeAttribute(detailUrl("artist", s.name))}">${escapeHtml(t("ent.unknownSee"))}</a>`;
      }
    }
  }

  function pintou(grade) {
    pintaTopo();
    if (grade) observa(grade);
  }

  window.SleevuEntidades = { liga, itens, desenha, pintou };
})();
