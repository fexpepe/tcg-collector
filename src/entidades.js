// Artistas e Treinadores (artists.html / trainers.html) — redesenho de
// 2026-10-17. As duas telas eram uma grade de 7 colunas com o nome cortado
// ("Aaron'…", "Acade…"), uma inicial no lugar de imagem e "0%" em tudo pra quem
// não tem conta; a ordem alfabética punha `"Big M…`, `0313` e `2017 P…` no topo
// e o "Artista desconhecido" (13 mil cartas sem ilustrador) aparecia como se
// fosse uma pessoa. Este módulo é dono do desenho das duas; o app.js continua
// dono dos dados (índice `{ name, cardIds }`, filtros, busca) e chama daqui:
//   liga(ctx)      uma vez, com o catálogo em mãos;
//   itens(lista)   tira o "sem nome", ordena e devolve o que a grade desenha;
//   desenha(item)  o elemento de cada artista/treinador;
//   pintou(grade)  depois de cada render/append: resumo, rodapé e capas.
// Só artists.html e trainers.html carregam este arquivo, então Sets e Pokédex
// (que dividem o app.js) não pagam nada dele — nem o CSS (área "entidades").
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
  // valiosa entre elas é a capa. Uma amostra, e não todas: o 5ban tem 5.762
  // cartas. O destaque leva amostra maior porque mostra a "Mais valiosa" por
  // escrito: com 8, o Kouki Saitou saía com um Geodude de R$ 14.
  const AMOSTRA = { recentes: 6, espalhadas: 6 };
  const AMOSTRA_DESTAQUE = { recentes: 10, espalhadas: 30 };
  // Teto da /api/collection por requisição (functions/api/collection.js).
  const MAX_IDS = 1200;

  let ctx = null;
  let ordem = lerPref(ORDEM_KEY, "cartas");
  let ultimo = { itens: [], semNome: null, temColecao: false };
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

  // Primeiro e último ano da obra (ou das impressões, no Treinador). Memo por
  // chave: a mesma lista de ids dá sempre o mesmo intervalo.
  const anosMemo = new Map();
  function anos(item) {
    const k = chave(item);
    if (anosMemo.has(k)) return anosMemo.get(k);
    let min = "", max = "";
    (item.cardIds || []).forEach((id) => {
      const d = dataDoId(id);
      if (!d) return;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    });
    const r = min ? (min.slice(0, 4) === max.slice(0, 4) ? min.slice(0, 4) : `${min.slice(0, 4)}–${max.slice(0, 4)}`) : "";
    anosMemo.set(k, r);
    return r;
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
  const ORDENS = {
    cartas: (a, b) => b.totalCount - a.totalCount || az(a, b),
    az,
    // Na minha coleção: quem tem mais cartas suas primeiro; empate pelo quanto
    // falta pra fechar.
    minhas: (a, b) => b.ownedCount - a.ownedCount || (b.ownedCount / b.totalCount) - (a.ownedCount / a.totalCount) || az(a, b)
  };

  function liga(c) {
    ctx = c;
    lancamentos = null;
    setDoIdMemo.clear();
    anosMemo.clear();
    leCapasDaSessao();
    montaTopo();
    // Câmbio pro preço da carta mais valiosa (destaque). Falhou: fica o nome.
    Promise.resolve(shared.loadFxRates()).then(() => {
      cambioPronto = true;
      document.querySelectorAll("[data-ent-grande]").forEach((el) => {
        const top = el.querySelector(".ent-topcard");
        if (top) top.innerHTML = topCardHtml(el.dataset.entK);
      });
    }).catch(() => {});
  }

  // Mesma pessoa com grafias diferentes vira UM cartão (shared.artistKey; a
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

  // Quantos vão pro destaque do topo (o "Top 8" do lorcana.gg): só na ordem
  // "Mais cartas", sem busca e com lista grande o bastante pra ter um resto.
  const DESTAQUE = 8;

  function itens(lista) {
    const artistas = ctx && ctx.view === "artists";
    let semNome = null;
    const gente = [];
    (artistas ? juntaGrafias(lista || []) : (lista || [])).forEach((item) => {
      if (artistas && SEM_NOME.test(item.name)) semNome = item;
      else gente.push(item);
    });
    const temColecao = gente.some((item) => item.ownedCount > 0);
    const usada = ORDENS[ordem] && (ordem !== "minhas" || temColecao) ? ordem : "cartas";
    gente.sort(ORDENS[usada]);
    ultimo = { itens: gente, semNome, temColecao, ordem: usada };
    porChave.clear();
    gente.forEach((item) => porChave.set(chave(item), item));
    const buscando = ctx && ctx.busca ? Boolean(ctx.busca()) : false;
    if (usada !== "cartas" || buscando || gente.length < DESTAQUE * 2) return gente;
    const sufixo = artistas ? "artists" : "trainers";
    return [
      { type: "ent-top", itens: gente.slice(0, DESTAQUE), titulo: t(`ent.top.${sufixo}`, { n: DESTAQUE }) },
      { type: "ent-head", titulo: t(`ent.rest.${sufixo}`) }
    ].concat(gente.slice(DESTAQUE));
  }

  // ── Destaque, cabeçalho e cartão ────────────────────────────────────────
  function desenha(item) {
    if (item.type === "ent-top") return desenhaTopo(item);
    if (item.type === "ent-head") {
      const h = document.createElement("h2");
      h.className = "ent-sec-head";
      h.textContent = item.titulo;
      return h;
    }
    return cartao(item, false);
  }

  // O topo é UM item da grade (ocupa a linha toda): no celular vira uma
  // fileira que rola de lado, como as vitrines das outras telas.
  function desenhaTopo(item) {
    const sec = document.createElement("section");
    sec.className = "ent-top";
    sec.setAttribute("aria-label", item.titulo);
    sec.innerHTML = `<h2 class="ent-sec-head ent-top-head">${escapeHtml(item.titulo)}</h2><div class="ent-top-row"></div>`;
    const fila = sec.querySelector(".ent-top-row");
    item.itens.forEach((it, i) => fila.appendChild(cartao(it, true, i + 1)));
    return sec;
  }

  function cartao(item, grande, posicao) {
    const k = chave(item);
    const el = document.createElement("a");
    const completo = item.totalCount > 0 && item.ownedCount >= item.totalCount;
    el.className = `ent-card${grande ? " ent-card-g" : ""}${completo ? " is-complete" : ""}`;
    el.href = detailUrl(ctx && ctx.view === "trainers" ? "trainer" : "artist", item.name);
    el.dataset.entK = k;
    if (grande) el.dataset.entGrande = "1";
    const periodo = anos(item);
    const meta = [tn("count.cards", item.totalCount, { n: fmt(item.totalCount) })];
    if (periodo) meta.push(periodo);
    const pct = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    // Progresso só pra quem tem carta daquele artista: "0%" em 438 cartões não
    // diz nada a quem chega e desanima quem está começando.
    const progresso = item.ownedCount > 0
      ? `<span class="ent-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}"><span class="ent-prog-bar"><i style="width:${pct}%"></i></span><span class="ent-prog-txt">${escapeHtml(t("ent.owned", { o: fmt(item.ownedCount), t: fmt(item.totalCount) }))}</span></span>`
      : "";
    const rank = posicao ? `<span class="ent-rank">${posicao}</span>` : "";
    el.innerHTML = `<span class="ent-capa" aria-hidden="true">${rank}${capaHtml(k, item)}</span>`
      + `<span class="ent-corpo"><span class="ent-nome">${escapeHtml(item.name)}</span>`
      + `<span class="ent-meta">${escapeHtml(meta.join(" · "))}</span>`
      + (grande ? `<span class="ent-topcard">${topCardHtml(k)}</span>` : "")
      + `${progresso}</span>`;
    return el;
  }

  // "Destaque: Regirock ☆ · R$ 4.045" nos cartões do Top 8 — o que o
  // colecionador quer saber de um artista além de quanto ele desenhou. É a
  // mais valiosa da AMOSTRA (40 cartas), não da obra inteira: por isso o
  // rótulo não diz "a mais valiosa". O preço some no Modo Colecionador (sem
  // preço no site) e enquanto o câmbio não chega.
  let cambioPronto = false;
  function topCardHtml(k) {
    const c = capas.get(k);
    if (!c || !c.top) return "";
    const nome = `<span class="ent-topcard-nome">${escapeHtml(c.top.nome)}</span>`;
    if (!c.top.usd || !cambioPronto || shared.collectorModeEnabled()) return `${escapeHtml(t("ent.topCard"))} ${nome}`;
    const cur = shared.getCurrency();
    const v = shared.convertMoney(c.top.usd, "USD", cur);
    // Preço ANTES do nome: num cartão estreito o nome longo é o que corta
    // ("Gardevoir & Sylveon GX…"), nunca o valor.
    const preco = v == null ? "" : `<span class="ent-topcard-preco">${escapeHtml(shared.formatMoney(cur, v))}</span> · `;
    return `${escapeHtml(t("ent.topCard"))} ${preco}${nome}`;
  }

  // Até 3 cartas em leque (a mais valiosa na frente). Sem capa ainda (ou sem
  // a borda): as iniciais, no lugar exato onde o leque entra — nada pula.
  function capaHtml(k, item) {
    const c = capas.get(k);
    if (!c || !c.imgs || !c.imgs.length) {
      return `<span class="ent-mono${c && c.estado === "sem" ? "" : " is-loading"}">${escapeHtml(iniciais(item.name))}</span>`;
    }
    const pos = c.imgs.length === 1 ? ["f"] : c.imgs.length === 2 ? ["f", "r"] : ["f", "l", "r"];
    // A da frente por último no HTML: fica por cima sem z-index.
    const ordemNoHtml = pos.map((p, i) => [p, c.imgs[i]]).reverse();
    return `<span class="ent-fan ent-fan-${c.imgs.length}">${ordemNoHtml.map(([p, url]) =>
      localizedImg(url, { className: `ent-c ent-c-${p}`, loading: "lazy", thumb: true, sizes: "120px", alt: "" })).join("")}</span>`;
  }

  // ── Capas pela borda ────────────────────────────────────────────────────
  // A capa é uma carta de verdade do artista/treinador. O índice não traz
  // imagem nem preço, e baixar os chunks dos sets pra isso era o custo que a
  // tela tirou em 2026-10 (238 requisições no Magic). A /api/collection devolve
  // carta e preço de uma lista de ids numa requisição só: pedimos uma amostra
  // de cada cartão que chega perto da tela, e a mais valiosa vira a capa.
  // Borda fora (503, rede): fica a inicial, e a página não pergunta de novo.
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
        const s = salvo[k] || {};
        const imgs = Array.isArray(s.i) ? s.i : [];
        capas.set(k, { imgs, estado: imgs.length ? "ok" : "sem", top: s.n ? { nome: s.n, usd: s.u || 0 } : null, daBorda: true });
      });
    } catch (e) { /* sessão sem storage: pede de novo, só isso */ }
  }
  function gravaCapasNaSessao() {
    try {
      const out = {};
      capas.forEach((c, k) => {
        if (!c.daBorda) return;
        out[k] = c.top ? { i: c.imgs, n: c.top.nome, u: c.top.usd } : { i: c.imgs };
      });
      sessionStorage.setItem(CAPAS_KEY, JSON.stringify(out));
    } catch (e) { /* cheio: a próxima visita pede de novo */ }
  }

  function amostra(item, grande) {
    const ids = item.cardIds || [];
    const { recentes, espalhadas } = grande ? AMOSTRA_DESTAQUE : AMOSTRA;
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
  function emDolar(p) {
    if (!p) return 0;
    let m = Math.max(p.u || 0, p.uf || 0);
    if (p.v) Object.keys(p.v).forEach((v) => { m = Math.max(m, p.v[v] || 0); });
    return m;
  }
  const peso = (p) => Math.max(emDolar(p), (p && p.e) || 0);

  function enfileira(el) {
    const k = el.dataset.entK;
    if (!k || capas.has(k) || fila.has(k)) return;
    const item = porChave.get(k);
    if (!item) return;
    if (bordaFora) { capas.set(k, { imgs: [], estado: "sem" }); pinta(k); return; }
    fila.set(k, [item, Boolean(el.dataset.entGrande)]);
    clearTimeout(espera);
    espera = setTimeout(pede, 60);
  }

  async function pede() {
    if (!fila.size || !ctx) return;
    const lote = [];
    let n = 0;
    for (const [k, [item, grande]] of fila) {
      const ids = amostra(item, grande);
      if (n + ids.length > MAX_IDS && lote.length) break;
      lote.push([k, item, ids]);
      n += ids.length;
    }
    lote.forEach(([k]) => fila.delete(k));
    if (fila.size) espera = setTimeout(pede, 0);
    const ids = [...new Set(lote.flatMap(([, , i]) => i))];
    let cartas = new Map(), precos = {};
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
        .map((c) => {
          const p = precos[c.id] || precos[shared.basePricingId(c.id)];
          return { img: c.image, nome: c.name, usd: emDolar(p), peso: peso(p), data: c.setReleaseDate || "" };
        })
        .sort((a, b) => b.peso - a.peso || b.data.localeCompare(a.data));
      const imgs = [...new Set(candidatas.map((c) => c.img))].slice(0, 3);
      const top = candidatas[0] ? { nome: candidatas[0].nome, usd: candidatas[0].usd } : null;
      capas.set(k, { imgs, estado: imgs.length ? "ok" : "sem", top, daBorda: !bordaFora });
      pinta(k);
    });
    gravaCapasNaSessao();
  }

  function pinta(k) {
    const item = porChave.get(k);
    if (!item) return;
    document.querySelectorAll(`[data-ent-k="${CSS.escape(k)}"]`).forEach((el) => {
      const capa = el.querySelector(".ent-capa");
      if (capa) {
        Array.from(capa.children).forEach((n) => { if (!n.classList.contains("ent-rank")) n.remove(); });
        capa.insertAdjacentHTML("beforeend", capaHtml(k, item));
      }
      const top = el.querySelector(".ent-topcard");
      if (top) top.innerHTML = topCardHtml(k);
    });
  }

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

  // ── Topo (resumo + ordem) e rodapé ──────────────────────────────────────
  function montaTopo() {
    const topo = document.getElementById("entTopo");
    if (!topo || topo.dataset.montado) return;
    topo.dataset.montado = "1";
    const ordemEl = topo.querySelector("#entOrdem");
    if (!ordemEl) return;
    ordemEl.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-ent-ordem]");
      if (!chip || chip.getAttribute("aria-pressed") === "true") return;
      ordem = chip.dataset.entOrdem;
      gravaPref(ORDEM_KEY, ordem);
      if (ctx && ctx.onChange) ctx.onChange();
    });
  }

  function pintaTopo() {
    const resumo = document.getElementById("entResumo");
    const ordemEl = document.getElementById("entOrdem");
    const { itens: lista, temColecao } = ultimo;
    const sufixo = ctx && ctx.view === "trainers" ? "trainers" : "artists";
    if (resumo) {
      const totalCartas = lista.reduce((s, i) => s + i.totalCount, 0);
      // Rótulos sem o número (o número vai em <strong>): tn só escolhe a forma.
      const pares = [[lista.length, tn(`ent.lbl.${sufixo}`, lista.length)], [totalCartas, tn("ent.lbl.cards", totalCartas)]];
      if (temColecao) {
        const comCartas = lista.filter((i) => i.ownedCount > 0).length;
        const completos = lista.filter((i) => i.totalCount > 0 && i.ownedCount >= i.totalCount).length;
        pares.push([comCartas, t(`ent.lbl.withYours.${sufixo}`)]);
        if (completos) pares.push([completos, tn("ent.lbl.complete", completos)]);
      }
      const html = pares.map(([n, rotulo]) => `<span class="ent-num"><strong>${escapeHtml(fmt(n))}</strong> ${escapeHtml(rotulo)}</span>`).join("");
      if (resumo.innerHTML !== html) resumo.innerHTML = html;
    }
    if (ordemEl) {
      // Redesenha só se mudou: o onAppend do scroll infinito chama de novo, e
      // trocar os botões tiraria o foco de quem navega pelo teclado.
      const opcoes = ["cartas", "az"].concat(temColecao ? ["minhas"] : []);
      const assinatura = `${opcoes.join(",")}|${ultimo.ordem}|${shared.getLanguage()}`;
      if (ordemEl.dataset.assinatura !== assinatura) {
        ordemEl.dataset.assinatura = assinatura;
        ordemEl.innerHTML = `<span class="ent-ordem-rot">${escapeHtml(t("ent.sort"))}</span>` + opcoes.map((o) =>
          `<button type="button" class="chip" data-ent-ordem="${o}" aria-pressed="${o === ultimo.ordem}">${escapeHtml(t(`ent.sort.${o}`))}</button>`).join("");
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
