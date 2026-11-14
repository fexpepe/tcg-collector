// Página Vintage (vintage.html, 2026-11-12): o acervo dos jogos que saíram de
// linha, separado da grade "Jogos" (hub.html), que ficou só com os que estão
// em atividade.
//
// Por quê: o vintage é o diferencial do Sleevu (ROADMAP: trazer de volta os
// TCGs mortos) e o catálogo dele cresce rápido. Eram 16 tiles numa seção no
// pé do hub, em ordem de lançamento e nada mais; com 30, 40, 50 jogos isso
// vira uma parede sem leitura. Aqui cada jogo tem começo e FIM, e quem é fã
// de uma marca quer ver só os jogos dela, na ordem em que saíram. Então:
//   - linha do tempo: cada jogo é uma barra do lançamento ao encerramento,
//     numa régua de anos comum;
//   - marca: um seletor por franquia (Dragon Ball, Naruto…) que vira a
//     "história da marca em cartas" — só os jogos dela, com o resumo de cada
//     um (o do "Sobre", data/sobre/<endereço>.json) e o jogo que continua hoje;
//   - por marca: a mesma régua, agrupada por franquia;
//   - grade: os logos lado a lado, pra quem reconhece pelo logo.
// Em qualquer uma, a linha inteira é o link do jogo: Vintage > jogo, os
// mesmos dois cliques de Jogos > jogo.
//
// A LISTA é HTML (vintage.html), como no hub: sem este arquivo ela segue
// inteira, em ordem de lançamento, com os links. Aqui só se reordena, esconde
// e mede o que já está na página; nada de catálogo é buscado pra desenhar.
// O estado mora no endereço (?marca=, ?ver=, ?ordem=), então o link copiado
// abre na mesma visão e o Voltar desfaz a marca.
(function (root) {
  "use strict";

  // Franquias. `nome` é nome próprio (não se traduz, como o nome dos jogos).
  // `hoje` é o endereço (/games/<url>) do jogo da marca que está em atividade,
  // quando o Sleevu tem um: fecha a história com "continua hoje". Toda marca
  // citada num data-marcas do vintage.html tem de estar aqui, e todo `hoje`
  // tem de estar em HOJE (o tests/vintage.test.mjs confere os dois).
  var MARCAS = {
    "dragon-ball": { nome: "Dragon Ball", hoje: "dragon-ball-fusion-world" },
    "naruto": { nome: "Naruto", hoje: "naruto-card-game" },
    "one-piece": { nome: "One Piece", hoje: "one-piece-card-game" },
    "gundam": { nome: "Gundam", hoje: "gundam-card-game" },
    "saint-seiya": { nome: "Saint Seiya" },
    "hunter-x-hunter": { nome: "Hunter × Hunter" },
    "evangelion": { nome: "Evangelion" },
    "toriko": { nome: "Toriko" },
    "kuroko-no-basket": { nome: "Kuroko no Basket" },
    "harry-potter": { nome: "Harry Potter" },
    "lord-of-the-rings": { nome: "The Lord of the Rings" },
    "warcraft": { nome: "Warcraft" }
  };
  // Os jogos em atividade citados acima: [jogo do app, nome, logo], iguais aos
  // do registro (functions/_lib/jogos.js). Cópia curta de propósito: a página
  // não carrega o registro, e são quatro linhas.
  var HOJE = {
    "dragon-ball-fusion-world": ["dbfw", "Dragon Ball Fusion World", "assets/games/game_dbfw-v2.webp"],
    "naruto-card-game": ["narutocg", "Naruto Card Game (2027)", "assets/games/game_naruto_2027.webp"],
    "one-piece-card-game": ["onepiece", "One Piece Card Game", "assets/games/game_onepiece.webp"],
    "gundam-card-game": ["gundam", "Gundam Card Game", "assets/games/game_gundam-v2.webp"]
  };

  var ORDENS = ["inicio", "recente", "fim", "duracao", "nome"];
  var VISOES = ["tempo", "marcas", "grade"];

  // "1988-11" -> 1988,83 (ano com fração). Sem mês, o começo vale o início do
  // ano e o fim vale o FIM do ano: "1988"–"1997" cobre os dez anos inteiros.
  // Com mês, o fim vale o fim daquele mês (o jogo ainda saiu nele).
  function instante(data, ehFim) {
    var m = /^(\d{4})(?:-(\d{2}))?/.exec(String(data || ""));
    if (!m) return NaN;
    var ano = Number(m[1]);
    if (!m[2]) return ehFim ? ano + 1 : ano;
    var mes = Math.min(12, Math.max(1, Number(m[2])));
    return ano + (ehFim ? mes : mes - 1) / 12;
  }

  // Régua dos anos pros jogos à vista: começa e termina num múltiplo do passo
  // (5 em 5 anos no acervo inteiro, 2 em 2 ou ano a ano numa marca só), pra as
  // marcas da régua caírem em ano redondo e a grade de fundo das barras não
  // precisar de deslocamento.
  function escala(jogos) {
    var ini = Infinity, fim = -Infinity;
    for (var i = 0; i < jogos.length; i++) {
      if (jogos[i].ini < ini) ini = jogos[i].ini;
      if (jogos[i].end > fim) fim = jogos[i].end;
    }
    if (!isFinite(ini) || !isFinite(fim)) return null;
    var a = Math.floor(ini), b = Math.ceil(fim);
    var passo = b - a > 16 ? 5 : b - a > 8 ? 2 : 1;
    a = Math.floor(a / passo) * passo;
    b = Math.ceil(b / passo) * passo;
    if (b === a) b = a + passo;
    return { inicio: a, fim: b, passo: passo, divisoes: (b - a) / passo };
  }

  // Ordem das linhas. Empate cai sempre na ordem do HTML (a de lançamento).
  function ordena(jogos, ordem) {
    var chave = {
      inicio: function (a, b) { return a.ini - b.ini || a.end - b.end; },
      recente: function (a, b) { return b.ini - a.ini || b.end - a.end; },
      fim: function (a, b) { return b.end - a.end || b.ini - a.ini; },
      duracao: function (a, b) { return (b.end - b.ini) - (a.end - a.ini); },
      nome: function (a, b) { return a.nome.localeCompare(b.nome, undefined, { sensitivity: "base", numeric: true }); }
    }[ordem] || function () { return 0; };
    return jogos.slice().sort(function (a, b) { return chave(a, b) || a.pos - b.pos; });
  }

  // "1988–2014" dos jogos dados (anos cheios, como o selo de cada linha).
  function periodoDe(jogos) {
    var a = Infinity, b = -Infinity;
    jogos.forEach(function (j) {
      a = Math.min(a, Number(String(j.inicio).slice(0, 4)));
      b = Math.max(b, Number(String(j.fim).slice(0, 4)));
    });
    if (!isFinite(a) || !isFinite(b)) return "";
    return a === b ? String(a) : a + "–" + b;
  }

  // Jogo de várias marcas (o crossover Miracle Battle; o Carddass Masters, uma
  // coleção por série) entra no
  // filtro de cada uma, mas na visão "por marca" fica num grupo só dele: a
  // linha é uma só e não pode aparecer em dois grupos.
  function grupoDe(jogo) {
    return jogo.marcas.length === 1 ? jogo.marcas[0] : "";
  }

  root.SleevuVintage = { MARCAS: MARCAS, HOJE: HOJE, ORDENS: ORDENS, VISOES: VISOES, instante: instante, escala: escala, ordena: ordena, periodoDe: periodoDe, grupoDe: grupoDe };

  // ── Daqui pra baixo, só no navegador, com a lista na página ───────────────
  if (typeof document === "undefined") return;
  var lista = document.getElementById("vtLista");
  if (!lista) return;

  var shared = root.TCGShared || {};
  var t = shared.t || function (k) { return k; };
  var tn = shared.tn || function (k, n) { return t(k + (n === 1 ? ".one" : ".other"), { n: n }); };
  var lang = String(shared.getLanguage ? shared.getLanguage() : "pt").slice(0, 2);
  var locale = shared.getLocale ? shared.getLocale() : undefined;
  var esc = shared.escapeHtml || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  };
  var numero = function (n) { try { return Number(n).toLocaleString(locale); } catch (e) { return String(n); } };
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  var jogos = Array.prototype.map.call(lista.querySelectorAll(".vt-jogo"), function (li, pos) {
    var a = li.querySelector(".vt-linha");
    var nome = li.querySelector(".vt-nome");
    return {
      li: li, a: a, pos: pos,
      url: String(a.getAttribute("href") || "").replace(/^\/games\//, ""),
      nome: nome ? nome.textContent.trim() : "",
      inicio: li.getAttribute("data-inicio"), fim: li.getAttribute("data-fim"),
      ini: instante(li.getAttribute("data-inicio"), false), end: instante(li.getAttribute("data-fim"), true),
      marcas: String(li.getAttribute("data-marcas") || "").split(/\s+/).filter(Boolean)
    };
  }).filter(function (j) { return isFinite(j.ini) && isFinite(j.end); });
  if (!jogos.length) return;

  // Cor do jogo na barra e no anel da linha: o mesmo carimbo do hub.js
  // (data-game-accent troca o --accent daquele elemento). Respeita "cores por
  // jogo" das Configurações: desligado, tudo fica no neutro da página.
  var coresLigadas = !shared.gameColorsEnabled || shared.gameColorsEnabled();
  function carimbaCor(el, game) {
    if (coresLigadas && /^[a-z]+$/.test(game || "")) el.setAttribute("data-game-accent", game);
  }
  jogos.forEach(function (j) { carimbaCor(j.a, j.a.getAttribute("data-game")); });

  var elFiltros = document.getElementById("vtFiltros");
  var elMarcas = document.getElementById("vtMarcas");
  var elSeletor = document.getElementById("vtSeletor");
  var elBotao = document.getElementById("vtMarcaBotao");
  var elValor = document.getElementById("vtMarcaValor");
  var elPainel = document.getElementById("vtMarcaPainel");
  var elBusca = document.getElementById("vtMarcaBusca");
  var elSemMarca = document.getElementById("vtMarcaVazio");
  var elOrdem = document.getElementById("vtOrdem");
  var elVisao = document.getElementById("vtVisao");
  var elMarca = document.getElementById("vtMarca");
  var elEixo = document.getElementById("vtEixo");
  var elNumeros = document.getElementById("vtNumeros");
  var elVazio = document.getElementById("vtVazio");
  var elAcervo = document.getElementById("vtAcervo") || lista.parentNode;
  var tituloDaPagina = document.title;

  // ── Estado no endereço ────────────────────────────────────────────────────
  var estado = { marca: "", ordem: "inicio", visao: "tempo" };
  function leEstado() {
    var sp = new URLSearchParams(location.search);
    var marca = sp.get("marca") || "";
    estado.marca = Object.prototype.hasOwnProperty.call(MARCAS, marca) ? marca : "";
    estado.ordem = ORDENS.indexOf(sp.get("ordem")) >= 0 ? sp.get("ordem") : "inicio";
    estado.visao = VISOES.indexOf(sp.get("ver")) >= 0 ? sp.get("ver") : "tempo";
  }
  // Só o que foge do padrão entra na barra: /vintage puro é a visão inicial.
  function gravaEstado(empilha) {
    var sp = new URLSearchParams(location.search);
    var poe = function (nome, valor, padrao) { if (valor && valor !== padrao) sp.set(nome, valor); else sp.delete(nome); };
    poe("marca", estado.marca, "");
    poe("ordem", estado.ordem, "inicio");
    poe("ver", estado.visao, "tempo");
    var busca = sp.toString();
    var destino = location.pathname + (busca ? "?" + busca : "") + location.hash;
    try { history[empilha ? "pushState" : "replaceState"](null, "", destino); } catch (e) { /* file:// e afins: segue sem endereço */ }
  }

  // ── Seletor de marca ──────────────────────────────────────────────────────
  // Um campo na linha dos filtros que abre um painel com todas as marcas, em
  // ordem alfabética (é como se procura um nome numa lista), cada uma com o
  // número de jogos. Eram chips; com 11 marcas já tomavam duas fileiras.
  var contagemPorMarca = {};
  jogos.forEach(function (j) { j.marcas.forEach(function (m) { contagemPorMarca[m] = (contagemPorMarca[m] || 0) + 1; }); });
  var marcasNaPagina = Object.keys(contagemPorMarca).filter(function (m) { return MARCAS[m]; }).sort(function (a, b) {
    return MARCAS[a].nome.localeCompare(MARCAS[b].nome, undefined, { sensitivity: "base" });
  });
  // A partir de quantas marcas o painel ganha o campo de busca.
  var BUSCA_A_PARTIR_DE = 13;
  function desenhaOpcoes() {
    var opcao = function (slug, rotulo, n, extra) {
      return '<button type="button" class="vt-opcao' + (extra || "") + '" data-marca="' + esc(slug) + '" aria-pressed="' + (estado.marca === slug) + '">'
        + '<span class="vt-opcao-nome">' + esc(rotulo) + '</span><span class="vt-opcao-n">' + n + "</span></button>";
    };
    elMarcas.innerHTML = opcao("", t("vt.allBrands"), jogos.length, " vt-opcao--todas")
      + marcasNaPagina.map(function (m) { return opcao(m, MARCAS[m].nome, contagemPorMarca[m]); }).join("");
    elBusca.hidden = marcasNaPagina.length < BUSCA_A_PARTIR_DE;
  }
  // Sem acento e em minúsculas: "pokemon" acha "Pokémon".
  function semAcento(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function filtraOpcoes() {
    var termo = semAcento(elBusca.value).trim();
    var achou = 0;
    Array.prototype.forEach.call(elMarcas.querySelectorAll(".vt-opcao"), function (b) {
      var slug = b.getAttribute("data-marca") || "";
      // "Todas as marcas" some enquanto se digita: a busca é por um nome.
      var mostra = slug ? semAcento(MARCAS[slug].nome).indexOf(termo) >= 0 : !termo;
      b.hidden = !mostra;
      if (mostra && slug) achou++;
    });
    elSemMarca.hidden = achou > 0;
  }
  function painelAberto() { return !elPainel.hidden; }
  function abrePainel() {
    elPainel.hidden = false;
    elBotao.setAttribute("aria-expanded", "true");
    elBusca.value = "";
    filtraOpcoes();
    // O foco entra no painel: na busca quando ela existe, senão na opção
    // marcada (o teclado segue dali com as setas).
    var alvo = elBusca.hidden ? elMarcas.querySelector('.vt-opcao[aria-pressed="true"]') : elBusca;
    if (alvo && alvo.focus) alvo.focus({ preventScroll: true });
  }
  function fechaPainel(devolveFoco) {
    if (!painelAberto()) return;
    elPainel.hidden = true;
    elBotao.setAttribute("aria-expanded", "false");
    if (devolveFoco) elBotao.focus({ preventScroll: true });
  }

  // ── Contagem de sets e cartas (publicada pelo build, quando existe) ───────
  // data/game-pages/contagem.json = { "<endereço>": [sets, cartas] }, escrito
  // pelo prerender-catalog.mjs no deploy. Em desenvolvimento o arquivo não
  // existe: a página fica sem os números, e nada mais muda.
  var contagem = null;
  function poeContagem() {
    if (!contagem) return;
    jogos.forEach(function (j) {
      var c = contagem[j.url];
      if (!c || !(c[1] > 0)) return;
      var texto = j.li.querySelector(".vt-texto");
      if (!texto || texto.querySelector(".vt-conta")) return;
      var span = document.createElement("span");
      span.className = "vt-conta";
      span.textContent = tn("vt.n.sets", c[0], { n: numero(c[0]) }) + " · " + tn("vt.n.cards", c[1], { n: numero(c[1]) });
      texto.appendChild(span);
    });
  }

  // ── Resumo de cada jogo, na história da marca ─────────────────────────────
  // O texto é o `resumo` do "Sobre" do jogo: uma fonte só, já nos três
  // idiomas e com as fontes conferidas. Busca só os jogos da marca aberta.
  var resumos = {};
  function poeResumo(j) {
    var dado = resumos[j.url];
    if (!dado || typeof dado.then === "function") return;
    var texto = j.li.querySelector(".vt-texto");
    if (!texto || texto.querySelector(".vt-resumo")) return;
    var r = dado.resumo;
    var frase = r && typeof r === "object" ? (r[lang] != null ? r[lang] : r.pt) : r;
    if (!frase) return;
    var span = document.createElement("span");
    span.className = "vt-resumo";
    span.textContent = frase;
    // Sempre antes da contagem de sets e cartas, chegue quem chegar primeiro.
    texto.insertBefore(span, texto.querySelector(".vt-conta"));
  }
  function buscaResumos(visiveis) {
    visiveis.forEach(function (j) {
      if (resumos[j.url]) { poeResumo(j); return; }
      resumos[j.url] = fetch("data/sobre/" + encodeURIComponent(j.url) + ".json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (dado) { resumos[j.url] = dado || {}; poeResumo(j); })
        .catch(function () { resumos[j.url] = {}; });
    });
  }

  // ── Régua dos anos ────────────────────────────────────────────────────────
  function desenhaEixo(e) {
    var anos = elEixo.querySelector(".vt-eixo-anos");
    if (!e || estado.visao === "grade") { elEixo.hidden = true; return; }
    var html = "";
    for (var ano = e.inicio; ano <= e.fim; ano += e.passo) {
      var p = (ano - e.inicio) / (e.fim - e.inicio);
      html += '<span class="vt-eixo-ano" data-p="' + (p * 100).toFixed(3) + '">' + ano + "</span>";
    }
    anos.innerHTML = html;
    // Régua com muitas marcas (uma marca de 2 em 2 anos chega a dez): no
    // celular o CSS mostra uma sim, uma não, pra os anos não encostarem.
    elEixo.classList.toggle("vt-eixo--denso", anos.children.length > 7);
    Array.prototype.forEach.call(anos.children, function (el) { el.style.left = el.getAttribute("data-p") + "%"; });
    elEixo.hidden = false;
  }

  // ── A marca aberta: nome, período e o jogo que continua hoje ──────────────
  function desenhaMarca(visiveis) {
    var m = MARCAS[estado.marca];
    if (!m) { elMarca.hidden = true; elMarca.innerHTML = ""; document.title = tituloDaPagina; return; }
    var proprios = visiveis.filter(function (j) { return j.marcas.length === 1; }).length;
    var cross = visiveis.length - proprios;
    var fatos = [periodoDe(visiveis)];
    if (proprios) fatos.push(tn("vt.n.games", proprios, { n: proprios }));
    if (cross) fatos.push(tn("vt.n.cross", cross, { n: cross }));
    var hoje = m.hoje && HOJE[m.hoje];
    elMarca.innerHTML = '<div class="vt-marca-cab">'
      + '<p class="vt-marca-eyebrow">' + esc(t("vt.brandEyebrow")) + "</p>"
      + '<h2 class="vt-marca-nome">' + esc(m.nome) + "</h2>"
      + '<p class="vt-marca-fatos">' + fatos.filter(Boolean).map(esc).join(" · ") + "</p>"
      + "</div>"
      + (hoje
        ? '<a class="vt-marca-hoje" href="/games/' + esc(m.hoje) + '">'
          + '<span class="vt-logo-box"><img class="vt-logo" src="' + esc(hoje[2]) + '" alt="" decoding="async"></span>'
          + '<span class="vt-marca-hoje-texto"><small>' + esc(t("vt.today")) + "</small><b>" + esc(hoje[1]) + "</b></span>"
          + CHEVRON + "</a>"
        : "");
    var link = elMarca.querySelector(".vt-marca-hoje");
    if (link && hoje) carimbaCor(link, hoje[0]);
    elMarca.hidden = false;
    document.title = t("vt.brandTitle", { marca: m.nome });
  }

  // ── Números do acervo ─────────────────────────────────────────────────────
  function desenhaNumeros(visiveis) {
    var partes = [tn("vt.n.games", visiveis.length, { n: visiveis.length })];
    if (!estado.marca) partes.push(tn("vt.n.brands", marcasNaPagina.length, { n: marcasNaPagina.length }));
    var per = periodoDe(visiveis);
    if (per) partes.push(per);
    if (contagem) {
      var cartas = visiveis.reduce(function (s, j) { return s + ((contagem[j.url] || [])[1] || 0); }, 0);
      if (cartas) partes.push(tn("vt.n.cards", cartas, { n: numero(cartas) }));
    }
    elNumeros.textContent = partes.join(" · ");
    elNumeros.hidden = !visiveis.length;
  }

  // ── Cabeçalho de grupo da visão "por marca" ───────────────────────────────
  function cabecalhoDoGrupo(slug, doGrupo) {
    var li = document.createElement("li");
    li.className = "vt-grupo";
    var fatos = periodoDe(doGrupo) + " · " + tn("vt.n.games", doGrupo.length, { n: doGrupo.length });
    if (slug) {
      li.innerHTML = '<button type="button" class="vt-grupo-btn" data-marca="' + esc(slug) + '">'
        + '<span class="vt-grupo-nome">' + esc(MARCAS[slug].nome) + "</span>"
        + '<span class="vt-grupo-fatos">' + esc(fatos) + "</span>" + CHEVRON + "</button>";
    } else {
      li.innerHTML = '<span class="vt-grupo-btn vt-grupo-btn--fixo"><span class="vt-grupo-nome">' + esc(t("vt.multi")) + "</span>"
        + '<span class="vt-grupo-fatos">' + esc(fatos) + "</span></span>";
    }
    return li;
  }

  // ── Desenho ───────────────────────────────────────────────────────────────
  function desenha() {
    var visiveis = jogos.filter(function (j) { return !estado.marca || j.marcas.indexOf(estado.marca) >= 0; });
    var emOrdem = ordena(visiveis, estado.ordem);
    // Agrupar só faz sentido com o acervo inteiro: numa marca aberta, "por
    // marca" é a própria linha do tempo.
    var agrupa = estado.visao === "marcas" && !estado.marca;

    Array.prototype.forEach.call(lista.querySelectorAll(".vt-grupo"), function (li) { li.remove(); });
    jogos.forEach(function (j) { j.li.hidden = visiveis.indexOf(j) < 0; });

    var frag = document.createDocumentFragment();
    if (agrupa) {
      // Grupos na ordem do primeiro jogo de cada um (a ordem escolhida já está
      // em `emOrdem`); o dos jogos de várias marcas fecha a lista.
      var ordemDosGrupos = [];
      var porGrupo = {};
      emOrdem.forEach(function (j) {
        var g = grupoDe(j);
        if (!porGrupo[g]) { porGrupo[g] = []; if (g) ordemDosGrupos.push(g); }
        porGrupo[g].push(j);
      });
      if (porGrupo[""]) ordemDosGrupos.push("");
      ordemDosGrupos.forEach(function (g) {
        frag.appendChild(cabecalhoDoGrupo(g, porGrupo[g]));
        porGrupo[g].forEach(function (j) { frag.appendChild(j.li); });
      });
    } else {
      emOrdem.forEach(function (j) { frag.appendChild(j.li); });
    }
    // Os escondidos vão pro fim, na ordem do HTML (não somem do documento).
    jogos.forEach(function (j) { if (j.li.hidden) frag.appendChild(j.li); });
    lista.appendChild(frag);

    var e = escala(visiveis);
    if (e) {
      elAcervo.style.setProperty("--vt-divs", String(e.divisoes));
      visiveis.forEach(function (j) {
        j.li.style.setProperty("--vt-i", ((j.ini - e.inicio) / (e.fim - e.inicio)).toFixed(4));
        j.li.style.setProperty("--vt-f", ((j.end - e.inicio) / (e.fim - e.inicio)).toFixed(4));
      });
    }
    elAcervo.classList.toggle("vt-acervo--grade", estado.visao === "grade");
    elAcervo.classList.toggle("vt-acervo--marca", !!estado.marca);
    desenhaEixo(e);
    desenhaMarca(visiveis);
    desenhaNumeros(visiveis);
    if (estado.marca) buscaResumos(visiveis);
    elVazio.hidden = visiveis.length > 0;

    Array.prototype.forEach.call(elMarcas.querySelectorAll(".vt-opcao"), function (b) {
      b.setAttribute("aria-pressed", String((b.getAttribute("data-marca") || "") === estado.marca));
    });
    // O campo mostra a marca escolhida (ou "Todas") e fica contornado com o
    // filtro ligado.
    elValor.textContent = estado.marca ? MARCAS[estado.marca].nome : t("vt.all");
    if (estado.marca) elBotao.setAttribute("data-ativa", ""); else elBotao.removeAttribute("data-ativa");
    Array.prototype.forEach.call(elVisao.querySelectorAll("[data-visao]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-visao") === estado.visao));
    });
    elOrdem.value = estado.ordem;
  }

  function escolheMarca(slug) {
    var nova = Object.prototype.hasOwnProperty.call(MARCAS, slug) ? slug : "";
    if (nova === estado.marca) return;
    estado.marca = nova;
    gravaEstado(true);
    desenha();
  }

  // ── Liga tudo ─────────────────────────────────────────────────────────────
  leEstado();
  desenhaOpcoes();
  elFiltros.hidden = false;
  elAcervo.classList.add("vt-acervo--pronto");
  desenha();

  elBotao.addEventListener("click", function () { if (painelAberto()) fechaPainel(false); else abrePainel(); });
  elMarcas.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".vt-opcao") : null;
    if (!b) return;
    escolheMarca(b.getAttribute("data-marca") || "");
    fechaPainel(true);
  });
  elBusca.addEventListener("input", filtraOpcoes);
  // Fecha ao clicar fora e no Esc; as setas andam pelas opções à vista, e o
  // Enter na busca escolhe a primeira que sobrou.
  document.addEventListener("pointerdown", function (ev) {
    if (painelAberto() && !elSeletor.contains(ev.target)) fechaPainel(false);
  });
  elSeletor.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && painelAberto()) { ev.stopPropagation(); fechaPainel(true); return; }
    if (!painelAberto()) return;
    var opcoes = Array.prototype.filter.call(elMarcas.querySelectorAll(".vt-opcao"), function (b) { return !b.hidden; });
    if (!opcoes.length) return;
    if (ev.key === "Enter" && ev.target === elBusca) { ev.preventDefault(); opcoes[0].click(); return; }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    var i = opcoes.indexOf(document.activeElement);
    var prox = ev.key === "ArrowDown" ? (i + 1) % opcoes.length : (i <= 0 ? opcoes.length - 1 : i - 1);
    opcoes[prox].focus();
  });
  // O foco saiu do seletor pelo Tab: o painel não fica aberto pra trás.
  elSeletor.addEventListener("focusout", function (ev) {
    if (painelAberto() && ev.relatedTarget && !elSeletor.contains(ev.relatedTarget)) fechaPainel(false);
  });
  lista.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button.vt-grupo-btn") : null;
    if (!b) return;
    escolheMarca(b.getAttribute("data-marca") || "");
    // A marca abre no topo da lista: sem isto, quem clicou num grupo lá
    // embaixo ficaria olhando o rodapé de uma lista que encolheu.
    var topo = elMarca.hidden ? elFiltros : elMarca;
    if (topo.scrollIntoView) topo.scrollIntoView({ block: "start" });
  });
  elOrdem.addEventListener("change", function () {
    estado.ordem = ORDENS.indexOf(elOrdem.value) >= 0 ? elOrdem.value : "inicio";
    gravaEstado(false);
    desenha();
  });
  elVisao.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-visao]") : null;
    if (!b) return;
    estado.visao = b.getAttribute("data-visao");
    gravaEstado(false);
    desenha();
  });
  window.addEventListener("popstate", function () { leEstado(); desenha(); });

  // A régua gruda logo abaixo do cabeçalho do site, que tem altura diferente
  // no desktop e no celular (lá ele é a barra de busca) e não publica a
  // medida: lê do próprio cabeçalho, e de novo quando a janela muda.
  var cabecalho = document.querySelector(".app-header");
  function grudaEixo() {
    if (cabecalho) elEixo.style.top = Math.round(cabecalho.getBoundingClientRect().height) + "px";
  }
  grudaEixo();
  window.addEventListener("resize", grudaEixo);

  fetch("data/game-pages/contagem.json")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (dado) {
      if (!dado || typeof dado !== "object") return;
      contagem = dado;
      poeContagem();
      desenhaNumeros(jogos.filter(function (j) { return !j.li.hidden; }));
    })
    .catch(function () { /* sem contagem: a página segue sem os números */ });
})(typeof globalThis !== "undefined" ? globalThis : window);
