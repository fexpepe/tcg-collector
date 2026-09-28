// Scanner de carta pela câmera — fase 1: OCR do CÓDIGO impresso na carta
// (OP01-001, BT1-001, 4/102, MH3 123…) e busca no catálogo. Ver
// docs/PLANO-SCANNER.md pro plano inteiro e os limites conhecidos.
//
// A FOTO NUNCA SAI DO APARELHO: o OCR é o Tesseract.js rodando em WASM dentro
// do navegador (auto-hospedado em assets/vendor/, a CSP é 'self'). Pra rede vai
// só o CÓDIGO lido — o mesmo texto que a pessoa digitaria na busca. E a foto
// também não fica NO aparelho: o quadro congelado no disparo vive num canvas
// em memória só enquanto a leitura roda e é descartado no fim (nada vai pra
// disco, localStorage, IndexedDB ou cache).
//
// ARQUIVO PRÓPRIO, injetado pelo shared.js no primeiro toque no ícone de
// câmera: o shared.js está colado no teto do orçamento de peso e viaja em toda
// página; este arquivo (e os ~3,5 MB do motor) só descem pra quem escaneia.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  // Pasta VERSIONADA no nome (ver o README dela). URL absoluta de propósito: o
  // worker do Tesseract resolve langPath/corePath contra a URL DELE, não a da
  // página — um caminho relativo viraria assets/vendor/…/assets/vendor/….
  const VENDOR = "assets/vendor/tesseract-7.0.0/";
  const BASE = location.origin + "/" + VENDOR;
  const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-. ";
  const FAIXA = 0.24;        // fração INFERIOR da carta onde o código mora em quase todo jogo
  const RODAPE = 0.18;       // fração inferior JUSTA: o rodapé de verdade quando a carta encaixa
  // Folga do recorte em volta da moldura (fração da largura/altura dela, por
  // lado). Ver recorteDaGuia: a carta encaixada NA moldura lia pior que a
  // carta um pouco menor que ela.
  const MARGEM_GUIA = 0.04;
  const LARGURA_OCR = 1400;  // px: o Tesseract lê melhor com ~30-50 px de altura de glifo
  const LARGURA_RODAPE = 1800;   // o rodapé justo vai mais ampliado: o código do One Piece tem ~1,8 mm
  const LARGURA_RODAPE_2 = 1250; // segunda escala do rodapé, só quando a primeira sai insegura
  const CONF_SEGURA = 85;        // confiança (0-100) do Tesseract a partir da qual não se relê

  // ── Extração de código (função PURA; testada em tests/scan-codes.test.mjs) ──
  // Confusões clássicas do OCR em texto que TEM de ser numérico. Só se aplica
  // à parte numérica do código — no prefixo (OP, BT, LOB) a letra é letra.
  function soDigitos(s) {
    return String(s).replace(/O/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
  }
  // Prefixo de código com hífen: letras + dígitos opcionais (OP01, BT1, EXB,
  // LOB, ST01). Dígitos no prefixo passam pela mesma correção, mas a parte de
  // letras é preservada.
  // `sufixoNumerico`: o que vem depois do hífen é só número (OP05-119), e não
  // idioma + número (SHVI-EN001) — muda o quanto se desconfia da última letra.
  function prefixo(s, sufixoNumerico) {
    const m = String(s).match(/^([A-Z]+)([A-Z0-9]*)$/);
    if (!m) return String(s);
    let letras = m[1], resto = m[2];
    // "OPO5" e "BTI": o O/I no fim das letras é 0/1 lido errado. Só O e I (as
    // confusões mais comuns), só com 3+ letras ("EB01" e "PRB01" são reais) e,
    // sem dígito nenhum no prefixo, só com sufixo numérico — o Yu-Gi-Oh tem
    // sets de 4 letras terminados em I/O (SHVI, PRIO), sempre com "-EN".
    const movivel = /[OI]$/.test(letras) && letras.length > 2
      && (/\d/.test(resto) || (sufixoNumerico && letras.length === 3 && !resto));
    if (movivel) {
      resto = letras.slice(-1) + resto;
      letras = letras.slice(0, -1);
    }
    return letras + soDigitos(resto);
  }
  const IDIOMAS = "EN|PT|ES|FR|DE|IT|JA|JP|KO|RU|ZH|CN|TW";
  // PESO de cada candidato — é o que decide a ORDEM da busca, não a posição
  // no texto. O OCR devolve lixo junto com o código: o rodapé do One Piece
  // traz a linha de copyright em JAPONÊS (©尾田栄一郎/集英社…), que o modelo
  // inglês transcreve como letras e dígitos aleatórios — e ela fica à ESQUERDA
  // do código, na mesma linha. Na ordem do texto um "E-12" ou "3/7" inventado
  // ali ia pra busca antes do "OP05-119" de verdade, a borda casava qualquer
  // coisa por prefixo e o scanner "achava" a carta errada.
  //   3 = formato de um jogo conhecido (OP05-, BT1-, -EN001, Union Arena)
  //   2 = formato plausível (fração N/T com total >= 10, Magic, Lorcana, FAB)
  //   1 = código com hífen de prefixo desconhecido
  //   0 = duvidoso (prefixo de UMA letra, fração de total minúsculo)
  // (FORMATOS é declarada abaixo; só é lida em tempo de chamada.)
  function pesoHifen(c) {
    if (FORMATOS.some(([re]) => re.test(c))) return 3;
    return c.indexOf("-") >= 2 ? 1 : 0;
  }
  // `palavras`: [{ini, fim, conf}] do OCR, deslocamentos sobre `texto`. Um
  // candidato herda a MENOR confiança das palavras que o formam; sem palavras
  // (texto digitado, teste), fica 0 e só o peso ordena.
  function extrair(texto, palavras) {
    // Normalização SEM mudar o comprimento (os deslocamentos das palavras
    // continuam valendo): hífens tipográficos e cada espaço em branco viram
    // um caractere só; "0P05-" (O inicial lido como zero) volta a ser "OP05-".
    const up = String(texto || "").toUpperCase().replace(/[‐‑–—]/g, "-").replace(/\s/g, " ")
      .replace(/\b0(?=[A-Z][A-Z0-9]{0,4}-[0-9OILSBZ])/g, "O");
    const alinhado = palavras && palavras.length && up.length === String(texto).length;
    const conf = (ini, fim) => {
      if (!alinhado) return 0;
      let c = 101;
      palavras.forEach((w) => { if (w.ini < fim && w.fim > ini && w.conf < c) c = w.conf; });
      return c > 100 ? 0 : c;
    };
    const out = [];
    const add = (codigo, peso, m) => {
      if (!codigo) return;
      const c = conf(m.index, m.index + m[0].length);
      const j = out.find((x) => x.codigo === codigo);
      if (j) { if (c > j.conf) j.conf = c; return; }
      out.push({ codigo, peso, conf: c, ordem: out.length });
    };
    let m;
    // Union Arena: UE21BT/RLY-1-082
    const reUA = /\b(UE\d{2}[A-Z]{2})\/([A-Z]{2,4})-(\d)-(\d{3})\b/g;
    while ((m = reUA.exec(up))) add(`${m[1]}/${m[2]}-${m[3]}-${m[4]}`, 3, m);
    // Código com hífen: OP01-001, EB01-001, BT1-001, ST01-001, EXB-001,
    // LOB-EN001, FB01-001, P-001, GD01-001. Prefixo com pelo menos uma letra;
    // sufixo com 2-4 dígitos (às vezes precedido do idioma, como no Yu-Gi-Oh)
    // e, colada, a raridade que o OCR às vezes não separa ("OP05-119SR",
    // "OP01-001L", "EB01-001C").
    const reHifen = /\b([A-Z][A-Z0-9]{0,5})-([A-Z]{0,2})([0-9OILSBZ]{2,4})([A-Z]{0,3})\b/g;
    while ((m = reHifen.exec(up))) {
      // Idioma no sufixo (Yu-Gi-Oh: LOB-EN001) é EXATAMENTE 2 letras + 3-4
      // dígitos, e letras que não se confundem com dígito. Qualquer outra
      // letra ali é o OCR confundindo (II9 -> 119) e entra no número.
      let letras = m[2], num = m[3], cauda = m[4];
      const idioma = letras.length === 2 && num.length >= 3 && !/^[OILSBZ]{2}$/.test(letras) ? letras : "";
      if (!idioma) { num = letras + num; letras = ""; }
      // O número tem 3 dígitos em todo jogo com hífen. Quatro sinais com o
      // último sendo LETRA (o "L" de "OP01-001L", o "S" de "OP05-119SR") é a
      // raridade grudada, não um quarto dígito.
      if (num.length === 4 && /[A-Z]$/.test(num) && /^\d{3}$/.test(soDigitos(num.slice(0, 3)))) { cauda = num.slice(3) + cauda; num = num.slice(0, 3); }
      // Com 3+ dígitos a cauda de letras é raridade (SR, L, C, UC, SEC…);
      // com 2, pode ser o terceiro dígito lido como letra.
      const digitos = soDigitos(num.length >= 3 ? num : num + cauda.slice(0, 1));
      if (!/^\d{2,4}$/.test(digitos)) continue; // sobrou letra que não é dígito: não é código
      const c = `${prefixo(m[1], !idioma)}-${idioma}${digitos}`;
      add(c, pesoHifen(c), m);
    }
    // Magic (e quem imprime "CÓDIGO • IDIOMA"), em duas partes: acha o set
    // ("HOB • EN", "MH3 EN") e casa o NÚMERO com ele.
    //   "0123/0281 R" / "MH3 • EN"  ->  "MH3 123";  "0042 R" / "HOB • EN" -> "HOB 42"
    // O número vem logo antes na carta, mas nem sempre no texto: o artista
    // fica na mesma linha do número ("0042 R  JOSU SOLANO" / "HOB EN") e o
    // modo sparse intercala os blocos. Então: número imediatamente antes
    // (peso 2); senão, um número COM ZERO À ESQUERDA ("0042" — o Magic
    // moderno preenche a 4 dígitos) ou uma fração de total >= 100 em qualquer
    // lugar do texto (peso 1). Os dígitos passam pela correção de OCR
    // ("004Z" -> 0042): antes o padrão exigia dígito puro e uma letra no fim
    // deixava "HOB 4" — carta errada — em vez de "HOB 42".
    const reSet = new RegExp(`\\b([A-Z][A-Z0-9]{2,3})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\b`, "g");
    const NUM = "[0-9OILSBZ]";
    const reAntes = new RegExp(`\\b0*(${NUM}{1,4})(?:\\s*\\/\\s*0*(${NUM}{1,4}))?\\s*[A-Z]?\\s*$`);
    const numero = (raw) => { const d = soDigitos(raw); return /^\d+$/.test(d) && parseInt(d, 10) > 0 ? parseInt(d, 10) : 0; };
    while ((m = reSet.exec(up))) {
      const set = m[1];
      const antes = up.slice(Math.max(0, m.index - 24), m.index).match(reAntes);
      // Fração de total pequeno logo antes é poder/resistência ("3/3"), não
      // número de carta: set do Magic tem 100+ cartas.
      const n = antes && !(antes[2] && numero(antes[2]) < 100) ? numero(antes[1]) : 0;
      if (n) { add(`${set} ${n}`, 2, { index: m.index - antes[0].length, 0: antes[0] + m[0] }); continue; }
      let solto;
      const reSolto = new RegExp(`\\b0(${NUM}{2,3})\\b|\\b0*(${NUM}{1,4})\\s*\\/\\s*0*(${NUM}{3,4})\\b`, "g");
      while ((solto = reSolto.exec(up))) {
        const k = solto[1] ? numero("0" + solto[1]) : (numero(solto[3]) >= 100 ? numero(solto[2]) : 0);
        if (k) { add(`${set} ${k}`, 1, solto); break; }
      }
    }
    // Lorcana: "12/204 · EN · 4"  ->  "4 12" (set 4, carta 12)
    const reLorcana = new RegExp(`\\b(\\d{1,3})\\s*\\/\\s*(\\d{3})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\s*[•·.\\-]?\\s*(\\d{1,2})\\b`, "g");
    while ((m = reLorcana.exec(up))) add(`${m[3]} ${parseInt(m[1], 10)}`, 2, m);
    // FAB: WTR001, IRA002 (3 letras + 3 dígitos colados)
    const reFab = /\b([A-Z]{3})(\d{3})\b/g;
    while ((m = reFab.exec(up))) add(m[1] + m[2], 2, m);
    // Fração: 4/102, 009/094, 12/204 (Pokémon, Lorcana, Riftbound, Magic antigo).
    // COMO IMPRESSA primeiro, sem os zeros depois: o catálogo guarda o número
    // do jeito que a carta imprime ("009/094" no Pokémon moderno, "4/102" no
    // antigo) e a busca da borda casa palavra por prefixo — "9" não acha
    // "009". Testado no celular: a Nymble 009/094 saía como 9/94 e não achava.
    // Total abaixo de 10 quase sempre é lixo (barras do texto em japonês).
    const reFrac = /\b([0-9OILSBZ]{1,3})\s*\/\s*([0-9OILSBZ]{1,3})\b/g;
    while ((m = reFrac.exec(up))) {
      const a = soDigitos(m[1]), b = soDigitos(m[2]);
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || parseInt(b, 10) === 0) continue;
      const peso = parseInt(b, 10) >= 10 ? 2 : 0;
      add(`${a}/${b}`, peso, m);
      add(`${parseInt(a, 10)}/${parseInt(b, 10)}`, peso, m);
    }
    out.sort((x, y) => y.peso - x.peso || y.conf - x.conf || x.ordem - y.ordem);
    return out.slice(0, 6);
  }
  // Devolve os candidatos em ORDEM de confiança: o mais específico primeiro.
  // Cada candidato é um texto que a busca entende ("OP05-119", "4/102",
  // "MH3 123" — set e número separados por espaço, como na paleta Ctrl+K).
  function extrairCodigos(texto, palavras) {
    return extrair(texto, palavras).map((x) => x.codigo);
  }
  // Junta os candidatos de VÁRIAS leituras (escalas ou recortes diferentes da
  // mesma carta): quem aparece em mais de uma leitura ganha voto — dois OCRs
  // que erram o mesmo dígito do mesmo jeito é raro. Ordem: peso, votos,
  // confiança, e por fim a leitura mais antiga (a mais ampliada vem primeiro).
  function juntar(leituras) {
    const por = new Map();
    leituras.forEach((lista, i) => (lista || []).forEach((x) => {
      const j = por.get(x.codigo);
      if (j) { j.votos += 1; if (x.conf > j.conf) j.conf = x.conf; if (x.peso > j.peso) j.peso = x.peso; }
      else por.set(x.codigo, { codigo: x.codigo, peso: x.peso, conf: x.conf, votos: 1, leitura: i, ordem: por.size });
    }));
    return Array.from(por.values())
      .sort((x, y) => y.peso - x.peso || y.votos - x.votos || y.conf - x.conf || x.leitura - y.leitura || x.ordem - y.ordem)
      .slice(0, 6);
  }

  // ── Detecção do JOGO (função PURA; testada em tests/scan-codes.test.mjs) ────
  // O mesmo número existe em vários jogos ("4/102" é Pokémon, mas "4" é um set
  // do Lorcana e um número do Magic), então buscar nos 13 de uma vez devolvia
  // Lorcana pra uma carta de Pokémon. Três pistas, somadas:
  //   1. o que a carta IMPRIME no rodapé (© Pokémon/Nintendo, Wizards of the
  //      Coast, Disney, Eiichiro Oda…) — a pista mais forte, +3 por palavra;
  //   2. o FORMATO do código (OP05- é One Piece, BT1- é Digimon, -EN001 é
  //      Yu-Gi-Oh; fração é Pokémon/Lorcana/Riftbound) — +2 por jogo possível.
  //      Formato que só UM jogo usa (OP05-, -EN001) vale como palavra impressa
  //      (+3 e certeza): as cartas do One Piece em inglês imprimem o copyright
  //      em japonês, então nenhuma palavra bate e o scanner lia a carta inteira
  //      (lenta) só pra confirmar o que o "OP" já dizia;
  //   3. o jogo da SESSÃO (a página de onde o scanner abriu) — +1, desempate.
  // Palavras que vários jogos dividem (BANDAI, SHUEISHA) ficam de fora.
  const PISTAS = {
    pokemon: [/POKEMON/, /\bILLUS\b/, /NINTENDO/, /CREATURES/, /GAME ?FREAK/, /\bHP\b/],
    magic: [/WIZARDS/, /\bCOAST\b/],
    lorcana: [/DISNEY/, /RAVENSBURGER/, /LORCANA/],
    onepiece: [/EIICHIRO/, /\bODA\b/],
    dbfw: [/BIRD ?STUDIO/, /TORIYAMA/, /DRAGON ?BALL/, /FUSION ?WORLD/],
    digimon: [/DIGIMON/, /AKIYOSHI/, /HONGO/],
    gundam: [/GUNDAM/, /SOTSU/, /SUNRISE/],
    ygo: [/KONAMI/, /TAKAHASHI/, /YU-?GI-?OH/],
    fab: [/LEGEND ?STORY/, /FLESH ?AND ?BLOOD/],
    riftbound: [/RIOT ?GAMES/, /RIFTBOUND/, /LEAGUE ?OF ?LEGENDS/],
    unionarena: [/UNION ?ARENA/],
    naruto: [/NARUTO/, /KISHIMOTO/],
    hxh: [/HUNTER/, /TOGASHI/]
  };
  const FORMATOS = [
    [/^(OP|EB|PRB)\d{2}-/, ["onepiece"]],
    [/^ST\d{2}-\d{3}$/, ["onepiece", "gundam", "digimon"]],
    [/^ST\d{1,2}-\d{2}$/, ["digimon"]],
    [/^(BT|EX|RB|LM)\d{1,2}-/, ["digimon"]],
    [/^P-\d{3}$/, ["digimon", "onepiece"]],
    [/^(GD\d{2}|EXB|EXR|EXBP|EXRP)-/, ["gundam"]],
    [/^(FB|FS|FC|FP)\d{0,2}-/, ["dbfw"]],
    [/^[A-Z0-9]{2,4}-[A-Z]{2}\d{3}/, ["ygo"]],
    [/^UE\d{2}/, ["unionarena"]],
    [/^[A-Z]{3}\d{3}$/, ["fab"]],
    [/^\d+\/\d+$/, ["pokemon", "lorcana", "riftbound"]],
    [/^[A-Z][A-Z0-9]{2,3} \d+$/, ["magic"]],
    [/^\d{1,2} \d+$/, ["lorcana"]]
  ];
  function detectarJogo(texto, codigos, sessao) {
    const up = String(texto || "").toUpperCase();
    const pontos = {};
    const soma = (g, n) => { pontos[g] = (pontos[g] || 0) + n; };
    let impresso = false; // pista decisiva bateu (formato ambíguo + sessão nunca dão certeza)
    Object.keys(PISTAS).forEach((g) => PISTAS[g].forEach((re) => { if (re.test(up)) { soma(g, 3); impresso = true; } }));
    (codigos || []).slice(0, 2).forEach((c) => FORMATOS.forEach(([re, gs]) => {
      if (!re.test(c)) return;
      if (gs.length === 1) { soma(gs[0], 3); impresso = true; } else gs.forEach((g) => soma(g, 2));
    }));
    if (sessao && sessao !== "hub") soma(sessao, 1);
    const jogos = Object.keys(pontos).sort((a, b) => pontos[b] - pontos[a] || a.localeCompare(b));
    // "Confiante" = alguma pista decisiva bateu (>= 3) e ninguém empata.
    const confiante = impresso && pontos[jogos[0]] >= 3 && (jogos.length === 1 || pontos[jogos[1]] < pontos[jogos[0]]);
    // Sem pista nenhuma: todos os jogos valem (a busca decide).
    return { jogos, pontos, confiante, restritos: jogos.filter((g) => pontos[g] >= 2) };
  }

  // ── Busca do candidato no catálogo ──────────────────────────────────────────
  const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // `jogos`: lista ORDENADA de jogos permitidos (vazia = todos). A borda é
  // consultada por jogo quando são poucos — resposta menor e mais precisa.
  async function buscar(codigo, jogos) {
    const permitidos = jogos && jogos.length ? jogos : null;
    const permite = (g) => !permitidos || permitidos.includes(g);
    const posicao = (g) => (permitidos ? permitidos.indexOf(g) : 0);
    const vistos = new Set();
    const out = [];
    const add = (card, game) => {
      if (!card) return;
      const k = `${game}:${card.id}`;
      if (!vistos.has(k)) { vistos.add(k); out.push({ card, game }); }
    };
    // 1) Set + número EXATOS pelo manifest do jogo (a busca por código da
    //    paleta): baixa só o chunk do set certo.
    try { (await shared.cmdkCardsByCode(codigo)).forEach((h) => { if (permite(h.game)) add(h.card, h.game); }); }
    catch (e) { /* sem manifest/catálogo: segue pra borda */ }
    // 2) Borda (D1): indexa as palavras do número, então acha "4/102" em
    //    qualquer set de 102 cartas e "BT1-001" mesmo quando o setId do
    //    catálogo é "BT-01". Hidrata só as cartas devolvidas.
    if (out.length < 3) {
      let hits;
      if (permitidos && permitidos.length <= 3) {
        const porG = await Promise.all(permitidos.map((g) => shared.searchApi(g, codigo, 8)));
        hits = [].concat.apply([], porG.map((h, i) => (h || []).map((x) => Object.assign({ g: permitidos[i] }, x))));
      } else {
        hits = (await shared.searchApi("all", codigo, 12) || []).filter((h) => permite(h.g || "pokemon"));
      }
      if (hits && hits.length) {
        const porJogo = Object.create(null);
        hits.forEach((h) => { const g = h.g || "pokemon"; (porJogo[g] = porJogo[g] || []).push(h.i); });
        try {
          const cat = await shared.loadOwnedAcrossGames(porJogo);
          const byId = new Map((cat.cards || []).map((c) => [c.id, c]));
          hits.forEach((h) => { const c = byId.get(h.i); if (c) add(c, h.g || c.game || "pokemon"); });
        } catch (e) { /* rede oscilou: fica com o que já tem */ }
      }
    }
    // Número exato primeiro ("4/102" antes de um "4" solto), depois a ordem
    // de confiança dos jogos. "Exato" em qualquer escrita do código
    // (cardCodeForms): "009/094" lido na carta é exato pra carta guardada
    // como "9" + total 94.
    const alvo = normKey(codigo);
    const formas = (c) => (shared.cardCodeForms ? shared.cardCodeForms(c) : [c.number]);
    const exato = (h) => (formas(h.card).some((f) => normKey(f) === alvo) ? 0 : 1);
    out.sort((a, b) => exato(a) - exato(b) || posicao(a.game) - posicao(b.game));
    return out.slice(0, 12);
  }

  // ── Trava de SET (funções PURAS; testadas em tests/scan-trava.test.mjs) ─────
  // Quem abre booster sabe o set: travado nele, a busca roda nas cartas do set
  // que já estão na memória (sem ida à borda) e o NÚMERO basta. É o que
  // resolve o "4/102" do Pokémon, que existe em vários sets com o mesmo total,
  // e o total lido errado ("4/182"), que antes não achava nada.
  //
  // Número de um código ou de uma carta: numa fração, o de antes da barra
  // ("4/102" → 4, "TG05/TG30" → 5); fora disso, a ÚLTIMA sequência de dígitos
  // ("OP05-119" → 119, "MH3 123" → 123, "LOB-EN001" → 1, "BT1-003 R" → 3,
  // "UE21BT/RLY-1-082" → 82 — a barra do Union Arena não é fração). NaN se
  // não houver dígito.
  function numeroDe(s) {
    const t = String(s == null ? "" : s).trim();
    const fr = /^(?:.*?[^\d])?(\d+)\s*\/\s*[A-Z]{0,3}\d+$/i.exec(t);
    if (fr) return parseInt(fr[1], 10);
    const m = /(\d+)\D*$/.exec(t);
    return m ? parseInt(m[1], 10) : NaN;
  }
  // Cartas do set travado que casam com os códigos lidos, na ordem de
  // confiança: o código INTEIRO primeiro — em qualquer escrita da carta
  // (`formas`, o cardCodeForms do shared), ou o número guardado começando
  // pelo código ("BT1-003 R" começa por "BT1-003") —, e só depois o NÚMERO
  // sozinho. Na reimpressão (One Piece PRB-01 traz OP01-006 e EB01-006 no
  // mesmo set) é o código inteiro que separa; no prefixo lido errado, o número.
  // null quando nenhum código casa.
  function noSet(cartas, codigos, formas) {
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const c of codigos || []) {
      const alvo = norm(c);
      if (!alvo) continue;
      const comPrefixo = /[a-z]/.test(alvo) && alvo.length >= 5;
      const exatas = cartas.filter((x) => (formas ? formas(x) : [x.number]).some((f) => norm(f) === alvo)
        || (comPrefixo && norm(x.number).indexOf(alvo) === 0));
      if (exatas.length) return { codigo: c, cartas: exatas };
    }
    for (const c of codigos || []) {
      const n = numeroDe(c);
      if (!(n >= 0)) continue;
      const mesmas = cartas.filter((x) => numeroDe(x.number) === n);
      if (mesmas.length) return { codigo: c, cartas: mesmas };
    }
    return null;
  }

  // ── Conferência pela IMAGEM (funções PURAS; testadas em tests/scan-foto.test.mjs) ──
  // O código impresso não identifica UMA carta em boa parte do catálogo: o
  // mesmo set + número vale pra 54 % das cartas do Digimon, 53 % do Gundam,
  // 40 % do DBFW, 35 % do Union Arena e 30 % do One Piece e do Yu-Gi-Oh
  // (contado no catálogo em 2026-09-28). E o que separa essas cartas é o que
  // vale dinheiro: Alternate Art, Parallel, Manga, SP, R+. A busca devolvia a
  // que vem primeiro no catálogo (quase sempre a comum) e a pessoa tinha de
  // achar a certa no "+N opções". O ManaBox faz o caminho inverso: reconhece
  // pela ARTE e erra a impressão (o FAQ dele admite). Aqui o código diz set e
  // número, e a foto desempata a arte.
  //
  // A ASSINATURA é a carta reduzida a uma grade 16×22 com a média de três
  // canais por célula — luz e duas cores opostas (vermelho−verde e
  // amarelo−azul) —, cada canal sem a própria média (tira o tom da lâmpada e o
  // balanço de branco da câmera) e o vetor inteiro com norma 1: a semelhança
  // de duas cartas é o cosseno entre as assinaturas (1 = iguais). Grade grossa
  // de propósito: tolera foto um pouco borrada e fora de esquadro, e a marca
  // "SAMPLE" que as imagens do TCGplayer trazem no meio pesa igual em todos os
  // candidatos. O caso difícil é a Manga contra a comum do One Piece — a pose
  // do personagem é a mesma, muda o fundo —, e quem separa é a cor.
  const GRADE_W = 16, GRADE_H = 22;
  const MIOLO = 0.03; // borda descartada de cada lado: canto arredondado, fundo, moldura da carta
  // Imagem integral (tabela de somas) dos três canais: a média de qualquer
  // retângulo sai em quatro leituras, então as dezenas de recortes da mesma
  // foto (escalas e deslocamentos) custam quase nada.
  function integral(px, w, h) {
    const W1 = w + 1;
    const L = new Float64Array(W1 * (h + 1)), A = new Float64Array(L.length), B = new Float64Array(L.length);
    for (let y = 0; y < h; y++) {
      let sl = 0, sa = 0, sb = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        sl += (r + g + b) / 3;
        sa += r - g;
        sb += (r + g) / 2 - b;
        const k = (y + 1) * W1 + x + 1, cima = y * W1 + x + 1;
        L[k] = L[cima] + sl; A[k] = A[cima] + sa; B[k] = B[cima] + sb;
      }
    }
    return { w, h, L, A, B };
  }
  // Assinatura do retângulo (x, y, rw, rh), em pixels da imagem integral, sem
  // a borda (MIOLO). null quando o retângulo sai da imagem ou é liso demais
  // (tela preta, parede): não há o que comparar.
  function assinatura(ii, x, y, rw, rh) {
    const mx = rw * MIOLO, my = rh * MIOLO;
    x += mx; y += my; rw -= 2 * mx; rh -= 2 * my;
    if (x < -0.5 || y < -0.5 || x + rw > ii.w + 0.5 || y + rh > ii.h + 0.5 || rw < GRADE_W || rh < GRADE_H) return null;
    const W1 = ii.w + 1, n = GRADE_W * GRADE_H, v = new Float32Array(n * 3);
    const soma = (T, x0, y0, x1, y1) => T[y1 * W1 + x1] - T[y0 * W1 + x1] - T[y1 * W1 + x0] + T[y0 * W1 + x0];
    const corte = (ini, tam, i, partes, max) => Math.min(max, Math.max(0, Math.round(ini + (tam * i) / partes)));
    let k = 0;
    for (let gy = 0; gy < GRADE_H; gy++) {
      const y0 = corte(y, rh, gy, GRADE_H, ii.h - 1), y1 = Math.max(y0 + 1, corte(y, rh, gy + 1, GRADE_H, ii.h));
      for (let gx = 0; gx < GRADE_W; gx++, k++) {
        const x0 = corte(x, rw, gx, GRADE_W, ii.w - 1), x1 = Math.max(x0 + 1, corte(x, rw, gx + 1, GRADE_W, ii.w));
        const area = (x1 - x0) * (y1 - y0);
        v[k] = soma(ii.L, x0, y0, x1, y1) / area;
        v[n + k] = soma(ii.A, x0, y0, x1, y1) / area;
        v[2 * n + k] = soma(ii.B, x0, y0, x1, y1) / area;
      }
    }
    let norma = 0;
    for (let c = 0; c < 3; c++) {
      let m = 0;
      for (let i = c * n; i < (c + 1) * n; i++) m += v[i];
      m /= n;
      for (let i = c * n; i < (c + 1) * n; i++) { v[i] -= m; norma += v[i] * v[i]; }
    }
    norma = Math.sqrt(norma);
    if (!(norma > 1e-3)) return null;
    for (let i = 0; i < v.length; i++) v[i] /= norma;
    return v;
  }
  function semelhanca(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  // Onde a carta pode estar no quadro: escalas (fração da LARGURA; a altura
  // vem da proporção 63×88) × deslocamentos (fração do quadro), e vale o
  // recorte mais parecido. Câmera: a carta fica ENTRE as duas molduras — a
  // interna tem 85 % da externa e o quadro leva 4 % de folga por lado (ver
  // recorteDaGuia) —, ou seja, de ~79 % a ~93 % da largura. Galeria: a foto é
  // livre, a busca é mais larga.
  const RECORTES_CAMERA = { escalas: [0.78, 0.84, 0.9, 0.96], passos: [-0.03, 0, 0.03] };
  const RECORTES_GALERIA = { escalas: [0.55, 0.65, 0.75, 0.85, 0.95], passos: [-0.12, -0.06, 0, 0.06, 0.12] };
  function assinaturasDoQuadro(ii, grade) {
    const out = [];
    grade.escalas.forEach((s) => {
      const cw = ii.w * s, ch = (cw * 88) / 63;
      grade.passos.forEach((dy) => grade.passos.forEach((dx) => {
        const a = assinatura(ii, (ii.w - cw) / 2 + dx * ii.w, (ii.h - ch) / 2 + dy * ii.h, cw, ch);
        if (a) out.push(a);
      }));
    });
    return out;
  }
  // Nova ordem dos candidatos. `sims[i]`: semelhança do candidato i com a foto
  // (null = a imagem dele não chegou). O 1º da busca só perde o lugar com
  // diferença CLARA — outro candidato mais parecido por MARGEM_FOTO ou mais, e
  // parecido o bastante (PISO_FOTO) pra foto não ser de outra coisa. Empate é
  // mesma arte com carimbo ou foil diferente (Yu-Gi-Oh Quarter Century, One
  // Piece Pirate Foil): a foto não tem como decidir, a ordem da busca fica e a
  // pessoa escolhe como já escolhia. Entre os que empatam com o mais parecido
  // (EMPATE_FOTO), vence o que vinha antes na busca. O resto segue por
  // semelhança — é a ordem da folha "+N opções" —, e quem ficou sem nota vai
  // pro fim, na ordem da busca.
  const MARGEM_FOTO = 0.06, PISO_FOTO = 0.3, EMPATE_FOTO = 0.02;
  function ordemPelaFoto(sims) {
    const idx = sims.map((_, i) => i);
    const nota = (i) => (typeof sims[i] === "number" ? sims[i] : -Infinity);
    const notas = idx.filter((i) => typeof sims[i] === "number");
    const melhor = notas.length ? Math.max.apply(null, notas.map(nota)) : -Infinity;
    // Sem nota do 1º, com menos de duas notas ou com a foto longe de tudo: a
    // foto não sabe nada, a ordem da busca fica inteira.
    if (sims.length < 2 || notas.length < 2 || typeof sims[0] !== "number" || melhor < PISO_FOTO) {
      return { ordem: idx, mudou: false };
    }
    const mudou = melhor - nota(0) >= MARGEM_FOTO;
    const primeiro = mudou ? notas.find((i) => nota(i) >= melhor - EMPATE_FOTO) : 0;
    const resto = idx.filter((i) => i !== primeiro).sort((a, b) => nota(b) - nota(a) || a - b);
    return { ordem: [primeiro].concat(resto), mudou };
  }

  // Pixels de `fonte` (quadro congelado, vídeo, imagem) no retângulo dado,
  // reduzidos pra `largura` px e já em imagem integral. A redução vai pela
  // metade de cada vez: de 1500 px pra 128 de uma vez só o drawImage pula
  // pixels (serrilha) em vez de fazer a média, e a assinatura é uma média.
  function pixelsDe(fonte, sx, sy, sw, sh, largura) {
    let src = fonte, x = sx, y = sy, w = sw, h = sh;
    while (w > largura * 2) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w / 2));
      c.height = Math.max(1, Math.round(h / 2));
      c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
      src = c; x = 0; y = 0; w = c.width; h = c.height;
    }
    const c = document.createElement("canvas");
    c.width = largura;
    c.height = Math.max(1, Math.round((largura * h) / w));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return integral(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  }
  // URLs da imagem de um candidato que dão um canvas LEGÍVEL, na largura da
  // grade: a cadeia de sempre do site (cardImgChain: o espelho img.sleevu.app,
  // que manda CORS pra sleevu.app, e depois a origem — TCGdex, TCGplayer,
  // Scryfall e pokemontcg.io mandam CORS aberto) e, por último, o proxy
  // wsrv.nl, pra fonte sem CORS (o Lorcast). Todas com "sx=1": a folha e a
  // grade já carregaram a MESMA URL sem crossOrigin, e o cache devolveria essa
  // cópia, que suja o canvas (o mesmo motivo do canvasCardHelpers do shared.js).
  const comSx = (u) => u + (u.indexOf("?") >= 0 ? "&" : "?") + "sx=1";
  function urlsDaCarta(card) {
    const src = shared.cardImageSources(card);
    if (!src.url || !shared.cardImgChain) return [];
    const c = shared.cardImgChain(src.url, { thumb: true, fallback: src.fallback });
    const urls = [c.src].concat(c.chain || []).filter((u) => u && !/^data:/.test(u));
    const origem = urls.find((u) => /^https:\/\//.test(u) && !/\/\/(img\.sleevu\.app|wsrv\.nl)\//.test(u));
    if (origem) urls.push(`https://wsrv.nl/?url=${encodeURIComponent(origem)}&w=300&output=webp`);
    return urls.map(comSx);
  }
  // Primeira URL da lista que carregar com CORS, até o prazo `ate` (absoluto).
  function carregarImagem(urls, ate) {
    return new Promise((resolve) => {
      let i = 0, feito = false, tm = 0;
      const fim = (im) => { if (!feito) { feito = true; clearTimeout(tm); resolve(im); } };
      const tenta = () => {
        if (feito) return;
        if (i >= urls.length) { fim(null); return; }
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.decoding = "async";
        im.onload = () => fim(im);
        im.onerror = tenta;
        im.src = urls[i++];
      };
      tm = setTimeout(() => fim(null), Math.max(0, ate - Date.now()));
      tenta();
    });
  }
  // Reordena `achados` (no lugar) pela semelhança com a foto e devolve se o 1º
  // mudou. O prazo é curto porque a pessoa está esperando o resultado: imagem
  // que não chega a tempo só fica sem nota, e a ordem da busca vale pra ela.
  // Nada da foto sai do aparelho — o que desce são as miniaturas do catálogo.
  const PRAZO_FOTO = 2500;
  async function conferirPelaFoto(fonte, rec, achados) {
    const lista = achados.slice(0, 8);
    let fotos = [];
    try { fotos = assinaturasDoQuadro(pixelsDe(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 128), rec.galeria ? RECORTES_GALERIA : RECORTES_CAMERA); }
    catch (e) { return false; } // sem canvas: fica a ordem da busca
    if (!fotos.length) return false;
    const ate = Date.now() + PRAZO_FOTO;
    const porUrl = new Map(); // duas impressões com a MESMA imagem: um download só
    const sims = await Promise.all(lista.map((h) => {
      const urls = urlsDaCarta(h.card);
      if (!urls.length) return null;
      if (!porUrl.has(urls[0])) {
        porUrl.set(urls[0], carregarImagem(urls, ate).then((im) => {
          if (!im) return null;
          try {
            const ii = pixelsDe(im, 0, 0, im.naturalWidth || im.width, im.naturalHeight || im.height, 112);
            const ref = assinatura(ii, 0, 0, ii.w, ii.h);
            return ref ? Math.max.apply(null, fotos.map((f) => semelhanca(f, ref))) : null;
          } catch (e) { return null; } // canvas sujo (sem CORS) ou imagem quebrada
        }));
      }
      return porUrl.get(urls[0]);
    }));
    const { ordem, mudou } = ordemPelaFoto(sims);
    achados.splice(0, lista.length, ...ordem.map((i) => lista[i]));
    return mudou;
  }

  // ── Motor de OCR (carregado sob demanda, um worker por sessão) ─────────────
  let workerPromise = null;
  function carregarScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("tesseract.min.js"));
      document.head.appendChild(s);
    });
  }
  function obterWorker(status) {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      await carregarScript(BASE + "tesseract.min.js");
      const T = window.Tesseract;
      const criar = (core) => T.createWorker("eng", T.OEM.LSTM_ONLY, {
        workerPath: BASE + "worker.min.js",
        corePath: BASE + core,
        langPath: BASE.replace(/\/$/, ""),
        workerBlobURL: false, // worker por URL: worker-src 'self' sem blob:
        gzip: true,
        logger: (m) => { if (status && m && m.status) status(m.status, m.progress); }
      });
      let w;
      try { w = await criar("tesseract-core-simd-lstm.wasm.js"); }
      catch (e) { w = await criar("tesseract-core-lstm.wasm.js"); } // aparelho sem SIMD
      await w.setParameters({
        tessedit_char_whitelist: WHITELIST,
        tessedit_pageseg_mode: T.PSM.SPARSE_TEXT,
        // Canvas não carrega DPI; sem isto o Tesseract assume 70 dpi e
        // estima o tamanho da fonte errado (avisa "Invalid resolution 0 dpi").
        user_defined_dpi: "300"
      });
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; }); // deixa tentar de novo
    return workerPromise;
  }
  // Devolve o texto E as palavras com a confiança (0-100) que o motor dá a
  // cada uma: entre dois códigos plausíveis fica o que o Tesseract leu com
  // mais certeza, e uma leitura insegura dispara uma releitura noutra escala.
  // O texto é remontado das palavras (uma linha por linha do motor) pra que
  // os deslocamentos de `palavras` batam com o texto entregue.
  async function ocr(worker, canvas) {
    const r = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const d = (r && r.data) || {};
    const palavras = [];
    const linhas = [];
    let pos = 0;
    try {
      (d.blocks || []).forEach((b) => (b.paragraphs || []).forEach((par) => (par.lines || []).forEach((l) => {
        const ws = (l.words || []).map((w) => ({ txt: String((w && w.text) || "").replace(/\s+/g, ""), conf: Number(w && w.confidence) || 0 })).filter((w) => w.txt);
        if (!ws.length) return;
        ws.forEach((w, i) => {
          if (i) pos += 1;
          palavras.push({ ini: pos, fim: pos + w.txt.length, conf: w.conf });
          pos += w.txt.length;
        });
        linhas.push(ws.map((w) => w.txt).join(" "));
        pos += 1;
      })));
    } catch (e) { /* estrutura inesperada: fica só o texto */ }
    if (!linhas.length) return { texto: d.text || "", palavras: [] };
    return { texto: linhas.join("\n"), palavras };
  }

  // ── Recorte e preparo da imagem ─────────────────────────────────────────────
  // Reamostra pra largura fixa e sobe o contraste (faixa dinâmica esticada):
  // texto pequeno em foto de celular chega cinza e baixo; o Tesseract agradece.
  // A faixa é esticada entre os percentis 1 e 99 do cinza, não entre o mínimo
  // e o máximo: um pixel branco da borda e um preto da moldura já bastavam pra
  // "esticar" nada, e o código branco sobre a barra escura do One Piece ficava
  // no contraste em que veio.
  function preparar(fonte, sx, sy, sw, sh, largura) {
    const f = largura / sw;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * f));
    c.height = Math.max(1, Math.round(sh * f));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const cinza = new Uint8ClampedArray(d.length / 4);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      cinza[j] = g;
      hist[cinza[j]] += 1;
    }
    const n = cinza.length;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
    const esc = hi > lo ? 255 / (hi - lo) : 1;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = (cinza[j] - lo) * esc;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // Sub-retângulo da moldura (frações 0-1 da largura/altura dela) recortado
  // DIRETO da fonte, na resolução nativa dela. Antes a carta inteira era
  // reamostrada pra 1000 px de largura e a faixa saía DESSA cópia: numa foto
  // de 12 MP da galeria (ou no vídeo em 4K) jogava fora a maior parte dos
  // pixels antes do OCR e depois ampliava o borrão — o código do One Piece,
  // com ~1,8 mm de altura, sobrava com uns 20 px e trocava dígito.
  function recorte(fonte, rec, fx, fy, fw, fh, largura) {
    return preparar(fonte, rec.sx + rec.sw * fx, rec.sy + rec.sh * fy, rec.sw * fw, rec.sh * fh, largura);
  }
  // Moldura-guia -> coordenadas do vídeo. O vídeo preenche o palco em
  // object-fit: cover, então o que a tela mostra é um recorte centralizado do
  // quadro; a moldura é uma fração desse recorte.
  //
  // Com FOLGA em volta (2026-09-14). Em campo, a carta encaixada certinho na
  // moldura errava, e a mesma carta ~15 % mais longe acertava sempre. Três
  // motivos, todos do lado da foto e não do OCR:
  //   1. distância de foco: a moldura tem 86 % da largura da tela e a tela
  //      mostra ~metade do campo da câmera principal; pra uma carta de 63 mm
  //      encher isso o telefone fica a ~7-8 cm, ABAIXO do foco mínimo da
  //      câmera principal da maioria dos aparelhos (10-20 cm — o app nativo
  //      troca pra macro, o navegador não). A foto sai suave e o "0" vira "O";
  //   2. o código mora a 2-4 % da borda de BAIXO da carta: com a carta na
  //      moldura, ele fica encostado na borda do recorte, e o Tesseract lê
  //      mal texto sem respiro em volta; qualquer inclinação já corta dígito;
  //   3. mais perto, o mesmo tremor da mão vira mais borrão.
  // A moldura interna (scan-guia-int) orienta a carta entre as duas; aqui o
  // recorte ganha 4 % de folga por lado, pra carta encostada na moldura ainda
  // ter respiro no recorte, e o RODAPÉ subiu de 15 pra 18 % pra continuar
  // alcançando o código de uma carta 15 % menor que a moldura.
  function recorteDaGuia(video, palco, guia) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const pr = palco.getBoundingClientRect();
    const gr = guia.getBoundingClientRect();
    const escala = Math.max(pr.width / vw, pr.height / vh);
    const ox = (vw * escala - pr.width) / 2;
    const oy = (vh * escala - pr.height) / 2;
    const mx = gr.width * MARGEM_GUIA, my = gr.height * MARGEM_GUIA;
    const sx = Math.max(0, (gr.left - pr.left + ox - mx) / escala);
    const sy = Math.max(0, (gr.top - pr.top + oy - my) / escala);
    return {
      sx, sy,
      sw: Math.min(vw - sx, (gr.width + 2 * mx) / escala),
      sh: Math.min(vh - sy, (gr.height + 2 * my) / escala)
    };
  }
  async function bitmapDoArquivo(file) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { /* navegador sem createImageBitmap com orientação */ }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem")); };
      img.src = url;
    });
  }

  // ── Interface ───────────────────────────────────────────────────────────────
  // A CÂMERA É A TELA (2026-09-09, segunda versão): o vídeo ocupa a tela inteira
  // e tudo flutua em vidro por cima, como num app de câmera. A moldura passa a
  // 86 % da largura — não é só estética: em retrato a largura nativa do recorte
  // é ~40 % da altura do quadro (~760 px a 1920×1440, ~1500 px em 4K), e os
  // glifos do código crescem junto antes do OCR. O disparador fica embaixo, onde o polegar já está; o resultado
  // aparece entre ele e a moldura, sem tirar o olho da carta; a correção
  // (código, jogo, candidatos) mora numa folha que só sobe quando precisa.
  // Tudo em cores FIXAS (escuro sobre vídeo), independentes do tema do site;
  // só os acentos (--accent) seguem o tema.
  const ESTILO = `
.scan-modal { position: fixed; inset: 0; z-index: 75; overflow: hidden; background: #0b0d12; color: #f3f5f7; --scan-top: max(env(safe-area-inset-top, 0px), 12px); --scan-bot: max(env(safe-area-inset-bottom, 0px), 16px); }
.scan-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.scan-guia { position: absolute; left: 50%; transform: translateX(-50%); border: 2px solid rgba(255,255,255,.9); border-radius: 14px; box-shadow: 0 0 0 200vmax rgba(6,8,12,.45); pointer-events: none; }
.scan-guia i { position: absolute; width: 34px; height: 34px; border: 0 solid #fff; }
.scan-guia .tl { left: -3px; top: -3px; border-left-width: 4px; border-top-width: 4px; border-top-left-radius: 16px; }
.scan-guia .tr { right: -3px; top: -3px; border-right-width: 4px; border-top-width: 4px; border-top-right-radius: 16px; }
.scan-guia .bl { left: -3px; bottom: -3px; border-left-width: 4px; border-bottom-width: 4px; border-bottom-left-radius: 16px; }
.scan-guia .br { right: -3px; bottom: -3px; border-right-width: 4px; border-bottom-width: 4px; border-bottom-right-radius: 16px; }
/* Moldura INTERNA, 15 % menor e mais leve (2026-09-14): a carta vai ENTRE as
   duas — encaixada na externa o telefone fica perto demais pra focar (ver
   recorteDaGuia). Saíram a linha tracejada do rodapé e a varredura que subia
   e descia na leitura: o cartão "lendo…" embaixo já diz que está procurando. */
.scan-guia-int { position: absolute; inset: 7.5%; border: 1px solid rgba(255,255,255,.4); border-radius: 10px; }
.scan-guia.is-lendo { border-color: rgba(0,229,255,.9); }
.scan-guia.is-lendo i { border-color: #00e5ff; }
@keyframes scanGira { to { transform: rotate(360deg); } }
.scan-top { position: absolute; left: 12px; right: 12px; top: var(--scan-top); height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; border-radius: 999px; background: rgba(13,14,18,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.scan-ico { width: 44px; height: 44px; min-height: 0; flex: none; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-ico svg { width: 22px; height: 22px; }
.scan-ico[aria-pressed="true"] { background: rgba(255,255,255,.16); }
.scan-ico[hidden] { display: none; }
.scan-jogo { appearance: none; -webkit-appearance: none; height: 36px; min-width: 0; max-width: 62%; padding: 0 30px 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(255,255,255,.06) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f3f5f7' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center / 16px; color: #f3f5f7; font: inherit; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.scan-jogo.is-auto { color: #cfd6e2; }
/* Trava de set (2026-09-28): com o set travado, o seletor de jogo dá lugar ao
   nome do set (o jogo vem junto) e o cadeado fica marcado. Depois de três
   cartas seguidas do mesmo set, o cadeado ganha um anel de sugestão. */
.scan-set { display: block; height: 36px; min-width: 0; max-width: 62%; padding: 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(255,255,255,.06); color: #f3f5f7; font-size: 14px; font-weight: 700; line-height: 34px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-set[hidden] { display: none; }
.scan-top-dir { display: flex; align-items: center; flex: none; }
.scan-ico.is-sugere { box-shadow: inset 0 0 0 2px var(--accent, #dc2626); }
.scan-dica { position: absolute; left: 12px; right: 12px; display: flex; justify-content: center; pointer-events: none; }
.scan-dica span { padding: 6px 12px; border-radius: 999px; background: rgba(13,14,18,.62); color: #cfd6e2; font-size: 12.5px; font-weight: 600; text-align: center; }
.scan-toast { position: absolute; left: 0; right: 0; bottom: calc(var(--scan-bot) + 124px); display: flex; justify-content: center; pointer-events: none; }
.scan-toast[hidden] { display: none; }
.scan-toast span { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; background: rgba(29,33,43,.86); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); font-size: 14px; font-weight: 700; }
.scan-spin { width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(255,255,255,.25); border-top-color: #00e5ff; animation: scanGira 1.1s linear infinite; }
.scan-semcam { position: absolute; left: 24px; right: 24px; top: 40%; margin: 0; text-align: center; color: #cfd6e2; font-size: 14px; line-height: 1.5; }
.scan-res { position: absolute; left: 12px; right: 12px; bottom: calc(var(--scan-bot) + 110px); display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(29,33,43,.86); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 18px 45px rgba(0,0,0,.32); }
.scan-res[hidden] { display: none; }
.scan-res-open { flex: 1; min-width: 0; min-height: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.scan-res-thumb { flex: none; width: 46px; height: 64px; border-radius: 6px; overflow: hidden; background: #262b36; }
.scan-res-thumb img, .scan-res-thumb canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Cartão de LEITURA: a miniatura é o recorte da foto travada no disparo (como o Collectr faz), o texto é o status com o spinner do lado. */
.scan-res.is-lendo .scan-res-sub { display: inline-flex; align-items: center; gap: 8px; white-space: normal; }
.scan-res-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.scan-res-name { font-size: 16px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-res-game { font-size: 10.5px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #8891a1; border: 1px solid #2d333f; border-radius: 999px; padding: 1px 7px; margin-left: 6px; vertical-align: 2px; }
.scan-res-sub { font-size: 12.5px; color: #9ba4b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-res-price { font-size: 14px; font-weight: 800; color: #7ee2b8; }
.scan-res-acoes { flex: none; display: flex; flex-direction: column; gap: 6px; }
.scan-res-add { height: 34px; min-height: 0; padding: 0 12px; border: 0; border-radius: 9px; background: var(--accent, #dc2626); color: var(--on-accent, #fff); font: inherit; font-size: 12.5px; font-weight: 800; white-space: nowrap; cursor: pointer; }
.scan-res-add.done { background: #262b36; color: #7ee2b8; }
.scan-res-alt { height: 30px; min-height: 0; padding: 0 12px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; font: inherit; font-size: 11.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.scan-bottom { position: absolute; left: 0; right: 0; bottom: var(--scan-bot); height: 96px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; padding: 0 20px; }
.scan-bottom > :first-child { justify-self: start; }
.scan-bottom > :last-child { justify-self: end; }
.scan-round { width: 52px; height: 52px; min-height: 0; flex: none; padding: 0; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(13,14,18,.62); color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-round svg { width: 22px; height: 22px; }
.scan-shutter { width: 94px; height: 94px; min-height: 0; flex: none; justify-self: center; padding: 0; border: 4px solid rgba(255,255,255,.35); border-radius: 999px; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-shutter span { width: 76px; height: 76px; border-radius: 999px; background: #fff; display: block; }
.scan-shutter[disabled] { opacity: .55; cursor: wait; }
.scan-shutter[hidden] { display: none; }
.scan-lote { height: 44px; min-height: 0; flex: none; padding: 0 14px 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(13,14,18,.62); color: #f3f5f7; font: inherit; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.scan-lote.is-vazio { visibility: hidden; }
.scan-lote svg { width: 16px; height: 16px; }
.scan-lote-n { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--accent, #dc2626); color: var(--on-accent, #fff); font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.scan-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); }
.scan-backdrop[hidden] { display: none; }
.scan-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 84%; overflow-y: auto; overscroll-behavior: contain; padding: 12px 12px calc(var(--scan-bot) + 8px); border-radius: 18px 18px 0 0; background: rgba(19,21,27,.96); border-top: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); display: flex; flex-direction: column; gap: 12px; }
.scan-sheet[hidden] { display: none; }
.scan-sheet-handle { width: 40px; height: 4px; border-radius: 999px; background: #2d333f; margin: 0 auto; flex: none; }
.scan-sheet-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 4px; }
.scan-sheet-head strong { font-size: 15px; font-weight: 800; }
.scan-sheet-head span { font-size: 12.5px; color: #9ba4b3; white-space: nowrap; }
.scan-cands { display: flex; gap: 10px; overflow-x: auto; padding: 2px 4px 4px; -webkit-overflow-scrolling: touch; }
.scan-cands:empty { display: none; }
.scan-cand { flex: none; width: 128px; min-height: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; border: 1px solid #2d333f; border-radius: 12px; background: #1d212b; color: #f3f5f7; font: inherit; text-align: left; cursor: pointer; }
.scan-cand.is-on { border: 2px solid var(--accent, #dc2626); padding: 7px; }
.scan-cand-img { height: 150px; border-radius: 8px; overflow: hidden; background: #262b36; }
.scan-cand-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scan-cand-name { font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-cand-sub { font-size: 11.5px; color: #9ba4b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-cand-price { font-size: 13px; font-weight: 800; color: #7ee2b8; }
.scan-form { display: flex; gap: 8px; align-items: center; }
.scan-field { flex: 1; min-width: 0; height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; }
.scan-field span { flex: none; font-size: 12px; font-weight: 700; color: #8891a1; }
.scan-field input { flex: 1; min-width: 0; height: 40px; padding: 0; border: 0; background: none; color: #f3f5f7; font: inherit; font-size: 16px; font-weight: 800; text-transform: uppercase; outline: none; }
.scan-form .lst-mini { min-height: 44px; border-radius: 9px; background: #1d212b; border-color: #2d333f; color: #f3f5f7; }
.scan-sheet-acoes { display: flex; gap: 8px; }
.scan-sheet-acoes[hidden] { display: none; }
/* Bloco, e não o flex do .cta: centrado em flex, um nome longo ("Adicionar Tony Tony.Chopper (Alternate Art) (Manga)") era cortado dos DOIS lados e as reticências nunca apareciam. */
.scan-sheet-acoes .cta { display: block; flex: 1; min-width: 0; min-height: 46px; line-height: 46px; text-align: center; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-heart { width: 46px; height: 46px; min-height: 0; flex: none; padding: 0; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-heart svg { width: 20px; height: 20px; }
.scan-heart.done { color: var(--accent-ink, #ef4444); border-color: var(--accent-ink, #ef4444); }
/* Faixa de preço e wishlist (2026-09-28): o som avisa sem olhar; o cartão
   confirma quando se olha — e avisa sozinho quando o som está mudo. */
.scan-res.is-boa { border-color: rgba(245,179,1,.8); box-shadow: 0 0 0 1px rgba(245,179,1,.55), 0 18px 45px rgba(0,0,0,.32); }
.scan-res-wl { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; font-size: 11.5px; font-weight: 800; color: #ff8fa3; vertical-align: 1px; }
.scan-res-wl svg { width: 12px; height: 12px; }
/* Painel do som: liga/desliga, as duas faixas na moeda do site e um botão pra ouvir cada aviso. */
.scan-som-liga { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 4px; color: #f3f5f7; font-size: 15px; font-weight: 700; cursor: pointer; }
.scan-som-liga input { width: 22px; height: 22px; margin: 0; flex: none; accent-color: var(--accent, #dc2626); }
.scan-som-faixas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.scan-som-faixas .scan-field input { text-transform: none; }
.scan-som-faixas .scan-field.is-erro { border-color: #f87171; }
.scan-som-testes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.scan-som-testes button { min-height: 44px; min-width: 0; padding: 0 6px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.scan-vazio { margin: 0; padding: 0 4px; font-size: 13px; color: #9ba4b3; line-height: 1.5; }
.scan-vazio[hidden] { display: none; }
.scan-vazio a { color: var(--accent-ink, #ef4444); font-weight: 700; }
.scan-priv { margin: 0; font-size: 11.5px; color: #8891a1; text-align: center; }`;

  const ICO = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5L7 19"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="11" width="15" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>',
    cadeadoAberto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="11" width="15" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/></svg>',
    som: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    mudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>'
  };
  // Valor de mercado da carta na moeda do site (mesma conta das grades):
  // { value, currency }, ou null quando não há preço carregado pra ela.
  function precoDe(card) {
    try {
      const v = shared.cardValue(card, shared.defaultVariant(card), null);
      return v && v.value > 0 ? v : null;
    } catch (e) { return null; }
  }
  // O mesmo valor já formatado, ou "".
  function valorDe(card) {
    const v = precoDe(card);
    if (!v) return "";
    const n = v.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v.currency === "BRL" ? "R$ " : v.currency === "USD" ? "US$ " : "€ ") + n;
  }

  // ── Som e vibração por FAIXA DE PREÇO (funções PURAS; tests/scan-som.test.mjs) ──
  // O que o ManaBox tem de melhor pra quem tria bulk: três sons por faixa de
  // preço, então dá pra passar carta sem olhar a tela e só parar quando a
  // boa aparece. Lá as faixas são fixas em US$/€ (< 1, 1–10, > 10); aqui
  // valem na moeda do site e a pessoa muda (o padrão em R$ é 5 e 50, o mesmo
  // degrau em reais). Carta que está na WISHLIST tem som próprio, acima de
  // qualquer faixa: é a que a pessoa foi procurar no booster.
  // Faixa: -1 = sem preço, 0 = barata (abaixo de `baixo`), 1 = média, 2 = boa
  // (a partir de `alto`).
  function faixaDePreco(valor, baixo, alto) {
    if (!(valor > 0)) return -1;
    return valor >= alto ? 2 : valor >= baixo ? 1 : 0;
  }
  const FAIXAS_PADRAO = { BRL: [5, 50], USD: [1, 10], EUR: [1, 10] };
  // Configuração guardada (texto do localStorage, pode ser lixo) -> { on,
  // faixas } válida, com as faixas da moeda pedida. Faixas por MOEDA: trocar a
  // moeda do site não pode fazer "5" virar cinco dólares.
  function configSom(texto, moeda) {
    let c = null;
    try { c = JSON.parse(texto || "null"); } catch (e) { c = null; }
    const padrao = FAIXAS_PADRAO[moeda] || FAIXAS_PADRAO.USD;
    const par = c && c.faixas && Array.isArray(c.faixas[moeda]) ? c.faixas[moeda].map(Number) : null;
    const ok = par && par.length === 2 && par.every((n) => Number.isFinite(n) && n >= 0) && par[0] < par[1];
    return { on: !(c && c.on === false), faixas: Object.assign({}, c && c.faixas, { [moeda]: ok ? par : padrao.slice() }) };
  }
  // Notas de cada aviso: [frequência Hz, início s, duração s]. Curtas e
  // subindo com o valor — da nota grave da barata ao arpejo da boa.
  const SONS = {
    "-1": [[660, 0, 0.06]],
    0: [[440, 0, 0.09]],
    1: [[523, 0, 0.08], [659, 0.1, 0.1]],
    2: [[659, 0, 0.08], [784, 0.09, 0.08], [1047, 0.18, 0.16]],
    wl: [[784, 0, 0.08], [988, 0.09, 0.08], [1175, 0.18, 0.08], [1568, 0.27, 0.22]]
  };
  // Vibração (Android; o iPhone não vibra pela web e o shared.vibrar cai no
  // toque do switch): mais pulsos quanto melhor a carta.
  const VIBRA = { "-1": 30, 0: 25, 1: [25, 60, 25], 2: [30, 60, 30, 60, 60], wl: [60, 40, 60, 40, 120] };

  // Motor de som (Web Audio, sem arquivo): criado/retomado num TOQUE da
  // pessoa — o Safari só libera áudio assim —, depois toca sozinho.
  let audio = null;
  function contextoAudio() {
    try {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audio = new AC();
      }
      if (audio.state === "suspended") audio.resume().catch(() => {});
      return audio;
    } catch (e) { return null; }
  }
  function tocar(notas) {
    const ac = contextoAudio();
    if (!ac || !notas) return;
    const t0 = ac.currentTime + 0.01;
    notas.forEach(([f, ini, dur]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + ini);
      g.gain.linearRampToValueAtTime(0.18, t0 + ini + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t0 + ini);
      o.stop(t0 + ini + dur + 0.03);
    });
  }
  function miniatura(card) {
    const src = shared.cardImageSources(card);
    return shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
  }

  function abrir() {
    if (document.querySelector(".scan-modal")) return;
    if (!document.getElementById("scanStyle")) {
      const st = document.createElement("style");
      st.id = "scanStyle";
      st.textContent = ESTILO;
      document.head.appendChild(st);
    }
    let stream = null;
    let ocupado = false;
    let resultados = [];
    let primario = 0;
    let codigoAtual = "";
    let lote = 0;
    let ultimoTexto = ""; // texto do último OCR: a busca manual reaproveita as pistas
    // ── Funil (item 7) ───────────────────────────────────────────────────────
    // Contadores da SESSÃO de scanner, mandados num resumo só ao fechar. Não é
    // um evento por leitura de propósito: o banco aceita 60 eventos/min por IP
    // e descarta o resto calado, então medir por carta apagaria exatamente a
    // pessoa que abre um booster inteiro — que é quem importa enxergar.
    // PRECISÃO (2026-09-28): "achou" diz que o código casou com ALGUMA carta,
    // não que era a certa. `amb` conta leituras com mais de uma carta pro
    // mesmo código, `vis` as em que a foto mudou qual vem primeiro, `troca` as
    // em que a pessoa trocou o 1º resultado por outra opção (uma vez por
    // leitura) e `dig` as buscas digitadas na folha de correção. Troca e busca
    // à mão são a pessoa dizendo que o scanner errou: é a taxa de erro real.
    const funil = { n: 0, lido: 0, achou: 0, t0: Date.now(), t1: 0, amb: 0, vis: 0, troca: 0, dig: 0 };
    let trocaConta = false; // a próxima troca de candidato ainda conta como erro desta leitura
    shared.logEvento("scan_open");
    // Toda carta que entrar daqui conta como cadastro por scanner (o store não
    // sabe de onde veio o clique). Volta pra "ui" no fechar.
    shared.setOrigemCadastro("scan");
    const stores = { col: {}, wl: {} };
    const sessao = (window.SLEEVU && window.SLEEVU.game) || "";

    const wrap = document.createElement("div");
    wrap.className = "scan-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", t("scan.title"));
    wrap.innerHTML = `
      <video class="scan-video" autoplay playsinline muted data-scan-video></video>
      <div class="scan-guia" data-scan-guia aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><div class="scan-guia-int"></div></div>
      <p class="scan-semcam" data-scan-semcam hidden></p>
      <div class="scan-top">
        <button type="button" class="scan-ico" data-scan-close aria-label="${escapeAttribute(t("export.close"))}" title="${escapeAttribute(t("export.close"))}">${ICO.x}</button>
        <select class="scan-jogo is-auto" data-scan-jogo aria-label="${escapeAttribute(t("scan.gameLabel"))}">
          <option value="">${escapeHtml(t("scan.gameAuto"))}</option>
          ${shared.GAME_SLUGS.map((g) => `<option value="${escapeAttribute(g)}">${escapeHtml(shared.gameLabel(g))}</option>`).join("")}
        </select>
        <span class="scan-set" data-scan-set hidden></span>
        <span class="scan-top-dir">
          <button type="button" class="scan-ico" data-scan-som>${ICO.som}</button>
          <button type="button" class="scan-ico" data-scan-trava aria-pressed="false" aria-label="${escapeAttribute(t("scan.lock"))}" title="${escapeAttribute(t("scan.lock"))}">${ICO.cadeadoAberto}</button>
          <button type="button" class="scan-ico" data-scan-torch aria-pressed="false" aria-label="${escapeAttribute(t("scan.torch"))}" title="${escapeAttribute(t("scan.torch"))}" hidden>${ICO.bolt}</button>
        </span>
      </div>
      <div class="scan-dica" data-scan-dica><span data-scan-status aria-live="polite">${escapeHtml(t("scan.status.camera"))}</span></div>
      <div class="scan-toast" data-scan-toast hidden><span><span class="scan-spin" aria-hidden="true"></span><span data-scan-toast-text></span></span></div>
      <div class="scan-res" data-scan-res hidden></div>
      <div class="scan-bottom">
        <label class="scan-round" aria-label="${escapeAttribute(t("scan.gallery"))}" title="${escapeAttribute(t("scan.gallery"))}">${ICO.image}<input type="file" accept="image/*" capture="environment" data-scan-file hidden></label>
        <button type="button" class="scan-shutter" data-scan-captura aria-label="${escapeAttribute(t("scan.capture"))}" title="${escapeAttribute(t("scan.capture"))}" disabled><span></span></button>
        <button type="button" class="scan-lote is-vazio" data-scan-lote><span class="scan-lote-n" data-scan-lote-n>0</span><span>${escapeHtml(t("scan.batch"))}</span>${ICO.arrow}</button>
      </div>
      <div class="scan-backdrop" data-scan-backdrop hidden></div>
      <div class="scan-sheet" data-scan-sheet hidden>
        <div class="scan-sheet-handle"></div>
        <div class="scan-sheet-head"><strong data-scan-sheet-title></strong><span data-scan-sheet-sub></span></div>
        <div class="scan-cands" data-scan-cands></div>
        <p class="scan-vazio" data-scan-vazio hidden></p>
        <form class="scan-form" data-scan-form>
          <label class="scan-field"><span>${escapeHtml(t("scan.codeLabel"))}</span><input type="text" data-scan-input autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="OP05-119 · 4/102"></label>
          <button type="submit" class="lst-mini">${escapeHtml(t("scan.search"))}</button>
        </form>
        <div class="scan-sheet-acoes" data-scan-sheet-acoes hidden>
          <button type="button" class="cta" data-scan-add="col:0"></button>
          <button type="button" class="scan-heart" data-scan-add="wl:0" aria-label="${escapeAttribute(t("cmdk.addWl"))}" title="${escapeAttribute(t("cmdk.addWl"))}">${ICO.heart}</button>
          <button type="button" class="scan-heart" data-scan-trava-folha aria-pressed="false">${ICO.cadeado}</button>
        </div>
        <p class="scan-priv">${escapeHtml(t("scan.privacy"))}</p>
      </div>
      <div class="scan-sheet" data-scan-som-folha hidden>
        <div class="scan-sheet-handle"></div>
        <div class="scan-sheet-head"><strong data-scan-som-titulo>${escapeHtml(t("scan.sound"))}</strong></div>
        <label class="scan-som-liga"><input type="checkbox" data-scan-som-on><span>${escapeHtml(t("scan.soundToggle"))}</span></label>
        <div class="scan-som-faixas">
          <label class="scan-field"><span>${escapeHtml(t("scan.soundLow"))}</span><input type="text" inputmode="decimal" data-scan-som-baixo autocomplete="off"></label>
          <label class="scan-field"><span>${escapeHtml(t("scan.soundHigh"))}</span><input type="text" inputmode="decimal" data-scan-som-alto autocomplete="off"></label>
        </div>
        <div class="scan-som-testes">
          <button type="button" data-scan-som-teste="0">${escapeHtml(t("scan.tier0"))}</button>
          <button type="button" data-scan-som-teste="1">${escapeHtml(t("scan.tier1"))}</button>
          <button type="button" data-scan-som-teste="2">${escapeHtml(t("scan.tier2"))}</button>
          <button type="button" data-scan-som-teste="wl">${escapeHtml(t("scan.tierWl"))}</button>
        </div>
        <p class="scan-priv" data-scan-som-nota></p>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");
    // A barra do Safari (e a faixa do gesto de home) se pinta com a meta
    // theme-color do site — clara, no tema claro. Com a câmera em tela cheia
    // sobrava uma tarja da cor do site embaixo do vídeo (2026-09-14). Enquanto
    // o scanner está aberto a meta fica no escuro do próprio scanner; ao
    // fechar volta o que era (ou some, se só havia as duas tags com media).
    const metaTema = document.querySelector('meta[name="theme-color"]:not([media])');
    const temaAntes = metaTema ? metaTema.getAttribute("content") : null;
    const metaScan = metaTema || document.head.appendChild(Object.assign(document.createElement("meta"), { name: "theme-color" }));
    metaScan.setAttribute("content", "#0b0d12");

    const $ = (sel) => wrap.querySelector(sel);
    const video = $("[data-scan-video]");
    const guia = $("[data-scan-guia]");
    const topo = $(".scan-top");
    const dica = $("[data-scan-dica]");
    const status = $("[data-scan-status]");
    const toast = $("[data-scan-toast]");
    const toastTexto = $("[data-scan-toast-text]");
    const btnLer = $("[data-scan-captura]");
    const btnTorch = $("[data-scan-torch]");
    const btnLote = $("[data-scan-lote]");
    const selJogo = $("[data-scan-jogo]");
    const resCard = $("[data-scan-res]");
    const folha = $("[data-scan-sheet]");
    const fundo = $("[data-scan-backdrop]");
    const cands = $("[data-scan-cands]");
    const vazio = $("[data-scan-vazio]");
    const input = $("[data-scan-input]");
    const acoesFolha = $("[data-scan-sheet-acoes]");

    // A dica sob a moldura some com a mensagem vazia (o [hidden] global vence o
    // display:flex). "Encaixe a carta na moldura…" é instrução de PRIMEIRA
    // vez: depois da primeira leitura ela não volta — voltava a cada leitura
    // e encavalava com o cartão de resultado, que ocupa o mesmo lugar.
    let jaLeu = false;
    let sugestao = ""; // sugestão de trava de set: toma o lugar da dica depois das leituras
    const dizer = (msg) => { status.textContent = msg; dica.hidden = !msg; };
    const pronto = () => dizer(jaLeu ? sugestao : t("scan.status.ready"));
    // Status de uma leitura em curso vai pro cartão "lendo" (miniatura da foto
    // + texto), que ocupa o lugar do resultado; o toast fica pra busca manual.
    let lendoTexto = null;
    const aviso = (msg) => {
      if (lendoTexto) { lendoTexto.textContent = msg; return; }
      if (msg) { toastTexto.textContent = msg; toast.hidden = false; } else toast.hidden = true;
    };
    // Progresso do motor em linguagem de gente: só as duas fases que demoram
    // (baixar o núcleo e o modelo, na primeira vez) viram texto.
    const progresso = (fase, p) => {
      if (/core|traineddata|initializ/i.test(fase)) {
        const pct = typeof p === "number" && p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : "";
        dizer(t("scan.status.loading") + pct);
      }
    };
    // ── Trava de set ─────────────────────────────────────────────────────────
    // O cadeado da barra trava no set da carta do resultado (o ManaBox esconde
    // isso nas configurações e pede pra escolher o set numa lista; aqui é um
    // toque sobre a carta que acabou de ler). Vale só nesta sessão do scanner:
    // uma trava esquecida faria a carta de outro set "não existir" na próxima
    // vez. `trava.cartas` é a Promise das cartas do set (null se não deu pra
    // baixar: aí a trava vira filtro da busca normal). `recentes`: o set do 1º
    // resultado das últimas leituras, pra sugerir a trava depois de três.
    let trava = null;
    let recentes = [];
    const btnTrava = $("[data-scan-trava]");
    const rotuloSet = $("[data-scan-set]");
    const chaveSet = (h) => `${h.game}|${h.card.setId || h.card.set || ""}|${h.card.language || ""}`;
    const nomeSet = (card) => card.set || card.setId || "";
    // Cartas do set, direto do chunk dele (o mesmo que a paleta baixa pra
    // busca por código): o manifest do jogo diz o arquivo. Em dev (sem
    // manifest), o catálogo inteiro do jogo da sessão já está na memória.
    async function cartasDoSet(tr) {
      const doSet = (x) => (tr.setId ? x.setId === tr.setId : x.set === tr.set) && (x.language || "") === tr.lang;
      if (sessao === tr.game && Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) return window.TCG_CARDS.filter(doSet);
      let manifest = sessao === tr.game ? window.TCG_MANIFEST : null;
      if (!manifest) {
        const r = await fetch(shared.gameDataDir(tr.game) + "manifest.generated.js");
        if (!r.ok) return null;
        const tx = await r.text();
        manifest = JSON.parse(tx.slice(tx.indexOf("{"), tx.lastIndexOf("}") + 1));
      }
      const sets = ((manifest && manifest.sets) || []).filter((s) => String(s.id) === (tr.setId || tr.set) && (!s.language || s.language === (tr.lang || s.language)));
      if (!sets.length) return null;
      const chunks = await Promise.all(sets.map((s) => fetch(s.file).then((r) => (r.ok ? r.json() : []))));
      const lista = [].concat.apply([], chunks).filter(doSet);
      return lista.length ? lista : null;
    }
    function pintarTrava() {
      const on = !!trava;
      const rot = on ? t("scan.unlock", { set: trava.nome }) : t("scan.lock");
      btnTrava.setAttribute("aria-pressed", on ? "true" : "false");
      btnTrava.setAttribute("aria-label", rot);
      btnTrava.title = rot;
      btnTrava.innerHTML = on ? ICO.cadeado : ICO.cadeadoAberto;
      btnTrava.classList.toggle("is-sugere", !on && !!sugestao);
      selJogo.hidden = on;
      rotuloSet.hidden = !on;
      rotuloSet.textContent = on ? trava.nome : "";
      if (!folha.hidden) pintarFolha(); // o cadeado da folha espelha a trava
    }
    function travar(h) {
      const c = h.card;
      const tr = { game: h.game, setId: c.setId || "", set: c.set || "", lang: c.language || "", nome: nomeSet(c), chave: chaveSet(h) };
      tr.cartas = cartasDoSet(tr).catch(() => null);
      trava = tr;
      sugestao = "";
      pintarTrava();
      if (jaLeu && !ocupado) pronto();
    }
    function destravar() {
      trava = null;
      recentes = [];
      pintarTrava();
    }
    // ── Som por faixa de preço ───────────────────────────────────────────────
    // Configuração do APARELHO (localStorage, conveniência de quem usa; sem ela
    // vale o padrão): liga/desliga e as duas faixas, por moeda.
    const CHAVE_SOM = "tcg-scan-som-v1";
    const moedaAgora = () => (shared.getCurrency ? shared.getCurrency() : "") || "BRL";
    let som = (() => { let tx = null; try { tx = localStorage.getItem(CHAVE_SOM); } catch (e) { /* sem storage */ } return configSom(tx, moedaAgora()); })();
    const faixasAgora = () => som.faixas[moedaAgora()] || configSom(null, moedaAgora()).faixas[moedaAgora()];
    const btnSom = $("[data-scan-som]");
    const folhaSom = $("[data-scan-som-folha]");
    const inSomOn = $("[data-scan-som-on]"), inBaixo = $("[data-scan-som-baixo]"), inAlto = $("[data-scan-som-alto]");
    function salvarSom() { try { localStorage.setItem(CHAVE_SOM, JSON.stringify(som)); } catch (e) { /* sem storage: vale só nesta sessão */ } }
    function pintarSom() {
      const rot = `${t("scan.sound")}: ${t(som.on ? "scan.soundIsOn" : "scan.soundIsOff")}`;
      btnSom.innerHTML = som.on ? ICO.som : ICO.mudo;
      btnSom.setAttribute("aria-label", rot);
      btnSom.title = rot;
    }
    // Número no jeito da moeda: vírgula decimal em reais ("5,5"), ponto no resto.
    const numeroBr = (n) => (moedaAgora() === "BRL" ? String(n).replace(".", ",") : String(n));
    function abrirSom() {
      const [baixo, alto] = faixasAgora();
      const simbolo = shared.currencySymbol ? shared.currencySymbol() : "";
      inSomOn.checked = som.on;
      inBaixo.value = numeroBr(baixo);
      inAlto.value = numeroBr(alto);
      inBaixo.setAttribute("aria-label", `${t("scan.soundLow")} (${simbolo})`);
      inAlto.setAttribute("aria-label", `${t("scan.soundHigh")} (${simbolo})`);
      $("[data-scan-som-nota]").textContent = t("scan.soundNote", { moeda: simbolo });
      $("[data-scan-som-titulo]").textContent = simbolo ? `${t("scan.sound")} · ${simbolo}` : t("scan.sound");
      fecharFolha();
      fundo.hidden = false;
      folhaSom.hidden = false;
      contextoAudio(); // o toque que abriu o painel libera o áudio no Safari
    }
    // Fechar o painel devolve aos campos o que está valendo (um par inválido
    // digitado e abandonado não fica na tela fingindo que foi salvo).
    function fecharSom() {
      const [b, a] = faixasAgora();
      inBaixo.value = numeroBr(b);
      inAlto.value = numeroBr(a);
      marcarFaixas(true);
      folhaSom.hidden = true;
      if (folha.hidden) fundo.hidden = true;
    }
    function marcarFaixas(ok) {
      [inBaixo, inAlto].forEach((el) => {
        el.closest(".scan-field").classList.toggle("is-erro", !ok);
        if (ok) el.removeAttribute("aria-invalid"); else el.setAttribute("aria-invalid", "true");
      });
    }
    // As duas faixas digitadas: número (vírgula ou ponto), a de baixo menor que
    // a de cima. Só salva o PAR que faz sentido, e não desfaz o que foi
    // digitado: quem sobe as duas (5/50 -> 100/1000) digita primeiro a de
    // baixo, que por um instante passa a de cima — desfazer ali apagava o
    // número que a pessoa acabou de escrever.
    function lerFaixas() {
      // Com vírgula, ela é a decimal e o ponto é milhar ("1.000,50"); sem, o ponto é a decimal.
      const num = (el) => { const tx = String(el.value).trim(); return tx ? Number(tx.indexOf(",") >= 0 ? tx.replace(/\./g, "").replace(",", ".") : tx) : NaN; };
      const baixo = num(inBaixo), alto = num(inAlto);
      const ok = Number.isFinite(baixo) && Number.isFinite(alto) && baixo >= 0 && baixo < alto;
      marcarFaixas(ok);
      if (ok) { som.faixas[moedaAgora()] = [baixo, alto]; salvarSom(); }
    }
    // Carta na wishlist: qualquer variante dela.
    function naWishlist(h) {
      try {
        const st = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        return st.hasCard ? !!st.hasCard(h.card.id) : !!st.has(h.card.id, shared.defaultVariant(h.card));
      } catch (e) { return false; }
    }
    // O sinal de uma carta: "wl" se está na wishlist, senão a faixa do preço.
    function sinalDe(h) {
      if (naWishlist(h)) return "wl";
      const v = precoDe(h.card);
      const [baixo, alto] = faixasAgora();
      return faixaDePreco(v ? v.value : 0, baixo, alto);
    }
    // Aviso de uma leitura: o som (se ligado) e a vibração da faixa.
    function avisar(h) {
      const sinal = sinalDe(h);
      if (som.on) tocar(SONS[sinal]);
      shared.vibrar(VIBRA[sinal]);
    }
    // Jogos permitidos na busca: o escolhido no seletor, ou o que a carta diz.
    function jogosDaBusca(codigos) {
      if (trava) return [trava.game];
      if (selJogo.value) return [selJogo.value];
      const d = detectarJogo(ultimoTexto, codigos, sessao);
      return d.restritos.length ? d.jogos.filter((g) => d.pontos[g] >= 2) : [];
    }
    selJogo.addEventListener("change", () => {
      selJogo.classList.toggle("is-auto", !selJogo.value);
      if (codigoAtual && !ocupado) buscarManual(codigoAtual);
    });

    // Moldura: 86 % da largura (teto de 440 px), limitada pela altura que sobra
    // entre a barra de cima e a área do resultado + disparador. Em JS porque
    // width + aspect-ratio + max-height não fecham em CSS puro.
    function posicionaGuia() {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const y = topo.getBoundingClientRect().bottom + 12;
      const reserva = 244; // resultado + controles + folgas
      const altMax = Math.max(200, H - y - reserva);
      let w = Math.min(W * 0.86, 440), h = w * 88 / 63;
      if (h > altMax) { h = altMax; w = h * 63 / 88; }
      guia.style.width = `${Math.round(w)}px`;
      guia.style.height = `${Math.round(h)}px`;
      guia.style.top = `${Math.round(y)}px`;
      dica.style.top = `${Math.round(y + h + 10)}px`;
    }
    posicionaGuia();
    window.addEventListener("resize", posicionaGuia);

    function fechar() {
      shared.setOrigemCadastro("ui");
      // Resumo da sessão: o funil inteiro (abriu -> leu -> achou -> adicionou)
      // e a precisão num evento só, com o tempo pra dar o ritmo de cadastro.
      shared.logEvento("scan_done", {
        n: funil.n, lido: funil.lido, achou: funil.achou, add: lote,
        ms: Math.max(0, Date.now() - funil.t0), t1: funil.t1 || 0,
        amb: funil.amb, vis: funil.vis, troca: funil.troca, dig: funil.dig
      });
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
      wrap.remove();
      document.body.classList.remove("preview-open");
      if (temaAntes == null) metaScan.remove(); else metaScan.setAttribute("content", temaAntes);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", posicionaGuia);
    }
    const tecla = (ev) => {
      if (ev.key !== "Escape") return;
      if (!folhaSom.hidden) fecharSom(); else if (!folha.hidden) fecharFolha(); else fechar();
    };
    document.addEventListener("keydown", tecla);

    function semCamera(msg) {
      video.hidden = true;
      guia.hidden = true;
      const p = $("[data-scan-semcam]");
      p.textContent = msg;
      p.hidden = false;
      btnLer.hidden = true;
      dizer(t("scan.status.nocam"));
    }
    async function abrirCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { semCamera(t("scan.status.nocam")); return; }
      try {
        // O que decide a nitidez do código é a resolução NATIVA do vídeo: em
        // retrato, a moldura ocupa ~40 % da altura do quadro, e a 1920×1440
        // a carta sobrava com ~760 px de largura (o código do One Piece, ~1,8
        // mm, com ~20 px — trocava dígito). Pede 4K (ideal, não exigido: o
        // navegador dá o modo mais próximo que a câmera tem).
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2880 } }
        });
      } catch (e) { semCamera(t("scan.status.nocam")); return; }
      if (!wrap.isConnected) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      video.srcObject = stream;
      // Foco contínuo e lanterna onde a API deixa pedir (Android/Chrome); no
      // resto, ignora — o botão da lanterna só aparece se o aparelho tem uma.
      try {
        const tr = stream.getVideoTracks()[0];
        const caps = tr.getCapabilities ? tr.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
        if (caps.torch) btnTorch.hidden = false;
      } catch (e) { /* sem controle de foco/lanterna */ }
      await new Promise((r) => { if (video.readyState >= 1) r(); else video.onloadedmetadata = () => r(); });
      try { await video.play(); } catch (e) { /* autoplay já cuidou */ }
      btnLer.disabled = false;
      pronto();
    }
    btnTorch.addEventListener("click", async () => {
      if (!stream) return;
      const on = btnTorch.getAttribute("aria-pressed") !== "true";
      try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] });
        btnTorch.setAttribute("aria-pressed", on ? "true" : "false");
      } catch (e) { /* aparelho recusou */ }
    });

    // ── Resultado e folha ────────────────────────────────────────────────────
    function textoAdd(h) {
      const st = stores.col[h.game];
      const v = shared.defaultVariant(h.card);
      const n = st ? st.variantTotal(h.card.id, v) : 0;
      return n > 0 ? `✓ ×${n}` : t("cmdk.addCol");
    }
    // Cartão de leitura (2026-09-10, como no Collectr): no disparo a foto vai
    // pro canto, como miniatura pequena do recorte da moldura, com o status ao
    // lado — o vídeo continua ao vivo e a pessoa pode soltar a carta. Quando
    // acha, o mesmo cartão vira o resultado (miniatura do catálogo), no mesmo
    // tamanho: a foto não ocupa a tela. A miniatura é um canvas minúsculo
    // (~92 px) e morre com o cartão; o quadro inteiro nunca aparece.
    function pintarLendo(fonte, rec) {
      resCard.innerHTML = `<span class="scan-res-thumb"></span><span class="scan-res-text"><span class="scan-res-sub"><span class="scan-spin" aria-hidden="true"></span><span data-scan-lendo aria-live="polite"></span></span></span>`;
      try {
        const c = document.createElement("canvas");
        c.width = 92;
        c.height = Math.max(1, Math.min(160, Math.round(92 * rec.sh / rec.sw)));
        c.getContext("2d").drawImage(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, c.width, c.height);
        resCard.querySelector(".scan-res-thumb").appendChild(c);
      } catch (e) { /* sem miniatura: o cartão fica só com o status */ }
      resCard.classList.add("is-lendo");
      resCard.hidden = false;
      lendoTexto = resCard.querySelector("[data-scan-lendo]");
    }
    function pintarResultado() {
      lendoTexto = null;
      resCard.classList.remove("is-lendo");
      const h = resultados[primario];
      if (!h) { resCard.hidden = true; return; }
      const preco = valorDe(h.card);
      const n = resultados.length;
      const jaTem = textoAdd(h);
      const sinal = sinalDe(h);
      resCard.classList.toggle("is-boa", sinal === 2 || sinal === "wl");
      const wl = sinal === "wl" ? `<span class="scan-res-wl">${ICO.heart}${escapeHtml(t("scan.inWishlist"))}</span>` : "";
      resCard.innerHTML = `
        <button type="button" class="scan-res-open" data-scan-open>
          <span class="scan-res-thumb">${miniatura(h.card)}</span>
          <span class="scan-res-text">
            <span class="scan-res-name">${escapeHtml(h.card.name)}<span class="scan-res-game">${escapeHtml(shared.gameLabel(h.game))}</span></span>
            <span class="scan-res-sub">${escapeHtml(`${h.card.set || ""} · ${h.card.number || ""}`)}</span>
            ${preco || wl ? `<span class="scan-res-price">${escapeHtml(preco)}${wl}</span>` : ""}
          </span>
        </button>
        <span class="scan-res-acoes">
          <button type="button" class="scan-res-add${jaTem.startsWith("✓") ? " done" : ""}" data-scan-add="col:${primario}">${escapeHtml(jaTem)}</button>
          <button type="button" class="scan-res-alt" data-scan-more>${escapeHtml(n > 1 ? t("scan.more", { n: n - 1 }) : t("scan.notThis"))}</button>
        </span>`;
      resCard.hidden = false;
    }
    function pintarFolha() {
      const n = resultados.length;
      $("[data-scan-sheet-title]").textContent = n > 1 ? t("scan.sheetMany", { n, q: codigoAtual }) : t("scan.sheetFix");
      $("[data-scan-sheet-sub]").textContent = n > 1 ? t("scan.tapRight") : "";
      cands.innerHTML = resultados.map((h, i) => {
        const preco = valorDe(h.card);
        return `<button type="button" class="scan-cand${i === primario ? " is-on" : ""}" data-scan-cand="${i}">
            <span class="scan-cand-img">${miniatura(h.card)}</span>
            <span class="scan-cand-name">${escapeHtml(h.card.name)}</span>
            <span class="scan-cand-sub">${escapeHtml(`${h.card.set || ""} · ${h.card.number || ""}`)}</span>
            ${preco ? `<span class="scan-cand-price">${escapeHtml(preco)}</span>` : `<span class="scan-cand-sub">${escapeHtml(shared.gameLabel(h.game))}</span>`}
          </button>`;
      }).join("");
      const q = codigoAtual || input.value.trim();
      if (!n) {
        // Com o set travado, "não achei" é "não achei NESTE set" — e o
        // número sozinho basta pra buscar de novo.
        const msg = !q ? t("scan.noCode") : trava ? t("scan.emptyLocked", { set: trava.nome }) : t("scan.empty");
        vazio.innerHTML = `${escapeHtml(msg)}${q
          ? ` <a href="explore?q=${encodeURIComponent(q)}">${escapeHtml(t("cmdk.explore", { q }))}</a>` : ""}`;
        vazio.hidden = false;
      } else vazio.hidden = true;
      input.value = codigoAtual;
      const h = resultados[primario];
      acoesFolha.hidden = !h;
      if (h) {
        const add = acoesFolha.querySelector("[data-scan-add^='col']");
        add.dataset.scanAdd = `col:${primario}`;
        const jaTem = textoAdd(h);
        add.textContent = jaTem.startsWith("✓") ? jaTem : `${t("scan.addNamed")} ${h.card.name}`;
        add.classList.toggle("done", jaTem.startsWith("✓"));
        const wl = acoesFolha.querySelector("[data-scan-add^='wl']");
        wl.dataset.scanAdd = `wl:${primario}`;
        const stw = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        wl.classList.toggle("done", !!(stw.has && stw.has(h.card.id, shared.defaultVariant(h.card))));
        // Cadeado da folha: trava no set da carta escolhida (é aqui que se vê
        // que "4/102" existe em mais de um set) ou destrava, se já é ele.
        const cad = acoesFolha.querySelector("[data-scan-trava-folha]");
        const nesta = !!(trava && trava.chave === chaveSet(h));
        const rot = nesta ? t("scan.unlock", { set: trava.nome }) : t("scan.lockIn", { set: nomeSet(h.card) });
        cad.setAttribute("aria-pressed", nesta ? "true" : "false");
        cad.setAttribute("aria-label", rot);
        cad.title = rot;
        cad.classList.toggle("done", nesta);
      }
    }
    function abrirFolha() {
      pintarFolha();
      fundo.hidden = false;
      folha.hidden = false;
      if (!resultados.length) { try { input.focus(); } catch (e) { /* teclado não abriu */ } }
    }
    function fecharFolha() { folha.hidden = true; fundo.hidden = true; }
    function entregar(codigo, achados, pelaFoto) {
      funil.n += 1;
      if (codigo) funil.lido += 1;              // o OCR extraiu um código
      if (achados.length) funil.achou += 1;     // e ele casou com o catálogo
      if (achados.length > 1) funil.amb += 1;   // com mais de uma carta
      if (pelaFoto) funil.vis += 1;             // e a foto mudou qual vem primeiro
      trocaConta = achados.length > 1;
      codigoAtual = codigo || "";
      resultados = achados;
      primario = 0;
      // Três leituras seguidas com o 1º resultado no mesmo set: quem abre
      // booster ganha a sugestão de travar (a dica sob a moldura e um anel no
      // cadeado). Leitura sem carta não quebra a sequência.
      if (!trava && achados.length) {
        recentes = recentes.concat(chaveSet(achados[0])).slice(-3);
        const mesmo = recentes.length === 3 && recentes.every((k) => k === recentes[0]);
        sugestao = mesmo ? t("scan.lockSuggest", { set: nomeSet(achados[0].card) }) : "";
        btnTrava.classList.toggle("is-sugere", !!sugestao);
      }
      pintarResultado();
      if (!achados.length) abrirFolha(); // sem carta: a folha já abre com o código pra corrigir
      else avisar(achados[0]); // leu a carta: som e vibração da faixa de preço (ou da wishlist)
    }
    function adicionar(tipo, i, btn) {
      const h = resultados[i];
      if (!h) return;
      const v = shared.defaultVariant(h.card);
      if (tipo === "wl") {
        const st = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        const on = st.toggle(h.card.id, v);
        btn.classList.toggle("done", on);
        if (!btn.classList.contains("scan-heart")) btn.textContent = on ? "✓ " + t("cmdk.wl") : t("cmdk.addWl");
        return;
      }
      const st = stores.col[h.game] || (stores.col[h.game] = shared.createCollectionStore(h.game));
      st.add(h.card.id, v, shared.DEFAULT_CONDITION, 1);
      // Tempo até a 1ª carta: da câmera aberta até a coleção ganhar algo. É o
      // "quanto demora pra o scanner servir pra alguma coisa".
      if (!funil.t1) funil.t1 = Math.max(1, Date.now() - funil.t0);
      lote += 1;
      $("[data-scan-lote-n]").textContent = String(lote);
      btnLote.classList.remove("is-vazio");
      shared.vibrar(20);
      pintarResultado();
      if (!folha.hidden) fecharFolha();
    }

    // Com o set travado: as cartas do set já estão na memória — o código
    // inteiro primeiro, senão o número (noSet). Se o set não baixou, a busca
    // normal no jogo, filtrada pelo set.
    async function procurarNoSet(codigos) {
      const tr = trava;
      const cartas = await tr.cartas;
      if (cartas) {
        const r = noSet(cartas, codigos, shared.cardCodeForms);
        return r ? { codigo: r.codigo, achados: r.cartas.slice(0, 12).map((card) => ({ card, game: tr.game })) }
          : { codigo: codigos[0] || "", achados: [] };
      }
      for (const c of codigos) {
        aviso(t("scan.status.searching", { q: c }));
        const achados = (await buscar(c, [tr.game])).filter((h) => chaveSet(h) === tr.chave);
        if (achados.length) return { codigo: c, achados };
      }
      return { codigo: codigos[0] || "", achados: [] };
    }
    // Lê UM candidato de cada vez até algum achar carta; devolve o vencedor.
    async function procurar(codigos) {
      if (trava) return procurarNoSet(codigos);
      const jogos = jogosDaBusca(codigos);
      for (const c of codigos) {
        aviso(t("scan.status.searching", { q: c }));
        const achados = await buscar(c, jogos);
        if (achados.length) return { codigo: c, achados };
      }
      // Restrito a um jogo detectado e nada achado: uma segunda chance sem o
      // filtro (a pista pode ter vindo de um reflexo ou de um texto errado).
      if (jogos.length && !selJogo.value) {
        for (const c of codigos) {
          const achados = await buscar(c, []);
          if (achados.length) return { codigo: c, achados };
        }
      }
      return { codigo: codigos[0] || "", achados: [] };
    }

    // Pipeline de uma leitura, do recorte mais justo pro mais largo, cada um
    // direto da fonte em resolução nativa:
    //   1. RODAPÉ justo (18 % de baixo, ampliado): onde o código mora com a
    //      carta entre as duas molduras. Leitura insegura (confiança baixa) relê
    //      noutra escala e os candidatos das duas votam;
    //   2. FAIXA larga (24 %), só se o rodapé não deu código: carta menor que
    //      a moldura, torta, mais alta na tela;
    //   3. CARTA inteira, só sem código ou sem saber o JOGO (Yu-Gi-Oh imprime
    //      sob a arte; "4/102" é de três jogos e o "© Pokémon" pode estar fora
    //      da faixa).
    // Depois: candidatos -> busca. `fonte` é o vídeo ou uma imagem da galeria.
    async function ler(fonte, rec) {
      if (ocupado) return;
      ocupado = true;
      let falhou = false;
      btnLer.disabled = true;
      fecharFolha();
      guia.classList.add("is-lendo");
      pintarLendo(fonte, rec);
      try {
        aviso(t("scan.status.loading"));
        const worker = await obterWorker(progresso);
        aviso(t("scan.status.reading"));
        const leituras = [];
        let texto = "";
        const passo = async (canvas) => {
          const r = await ocr(worker, canvas);
          texto += (texto ? "\n" : "") + r.texto;
          leituras.push(extrair(r.texto, r.palavras));
          return juntar(leituras);
        };
        let cands = await passo(recorte(fonte, rec, 0, 1 - RODAPE, 1, RODAPE, LARGURA_RODAPE));
        if (cands.length && cands[0].peso >= 2 && cands[0].conf < CONF_SEGURA) {
          cands = await passo(recorte(fonte, rec, 0, 1 - RODAPE, 1, RODAPE, LARGURA_RODAPE_2));
        }
        if (!cands.length) cands = await passo(recorte(fonte, rec, 0, 1 - FAIXA, 1, FAIXA, LARGURA_OCR));
        let codigos = cands.map((c) => c.codigo);
        const deteccao = detectarJogo(texto, codigos, sessao);
        // Com o set travado o jogo já é sabido: a carta inteira só se não houver código.
        if (!codigos.length || (!selJogo.value && !trava && !deteccao.confiante)) {
          cands = await passo(recorte(fonte, rec, 0, 0, 1, 1, LARGURA_OCR));
          codigos = cands.map((c) => c.codigo);
        }
        ultimoTexto = texto;
        // O seletor de jogo é SÓ da pessoa (2026-09-10). Antes, uma detecção
        // confiante gravava o jogo no seletor — e o seletor preenchido vale
        // como filtro FIXO em jogosDaBusca, sem a segunda chance sem filtro.
        // Resultado: lia um Pokémon (achava), o seletor virava "Pokémon", e a
        // carta seguinte de One Piece ou Magic "não existia". Em "Automático"
        // cada leitura detecta o jogo de novo pelas pistas da própria carta
        // (o cartão de resultado já diz qual foi); escolher um jogo no seletor
        // é a forma de FORÇAR um só, quando a detecção errar.
        if (!codigos.length) { entregar("", []); return; }
        const { codigo, achados } = await procurar(codigos);
        // Mesmo código, cartas diferentes (Alternate Art, Parallel, Manga…):
        // a foto desempata ANTES de o resultado aparecer — trocar a carta
        // depois de mostrada confundiria, e um "+ Coleção" rápido gravaria a
        // errada. O quadro congelado ainda está vivo aqui.
        let pelaFoto = false;
        if (achados.length > 1) {
          aviso(t("scan.status.comparing"));
          try { pelaFoto = await conferirPelaFoto(fonte, rec, achados); } catch (e) { /* fica a ordem da busca */ }
        }
        entregar(codigo, achados, pelaFoto);
      } catch (e) {
        falhou = true;
        lendoTexto = null;
        resCard.classList.remove("is-lendo");
        resCard.hidden = true;
        dizer(t("scan.error"));
      } finally {
        ocupado = false;
        jaLeu = true;
        lendoTexto = null;
        aviso("");
        guia.classList.remove("is-lendo");
        // Erro fica na tela (a dica só volta a sumir na próxima leitura).
        if (stream) { btnLer.disabled = false; if (!falhou) pronto(); }
      }
    }
    async function buscarManual(q) {
      if (!q || ocupado) return;
      ocupado = true;
      try {
        const { achados } = await procurar([q]);
        codigoAtual = q;
        resultados = achados;
        primario = 0;
        trocaConta = false; // o 1º aqui é da busca digitada, não da leitura
        pintarResultado();
        if (!folha.hidden || !achados.length) pintarFolha();
        if (!achados.length) abrirFolha(); else fecharFolha();
      } catch (e) { dizer(t("scan.error")); }
      finally { ocupado = false; aviso(""); }
    }

    // FOTO TRAVADA NO DISPARO (2026-09-10): antes cada passo do OCR (rodapé em
    // duas escalas, faixa, carta inteira) redesenhava do vídeo AO VIVO, então a
    // pessoa tinha de segurar a carta imóvel pelos 2-4 passes — uns segundos —
    // e a "votação" entre as escalas do rodapé comparava quadros diferentes.
    // Agora o toque copia UM quadro do vídeo, em resolução nativa, pra um
    // canvas fora da tela: a leitura inteira sai dele e a pessoa pode soltar
    // a carta (o vídeo segue ao vivo; só a miniatura do cartão mostra a foto).
    // Ao terminar, o canvas é zerado — só memória, só durante a leitura, nada
    // em disco ou cache. Sem canvas (não deve acontecer), lê do vídeo como antes.
    function congelar() {
      try {
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        c.getContext("2d").drawImage(video, 0, 0);
        return c;
      } catch (e) { return null; }
    }
    btnLer.addEventListener("click", async () => {
      if (!stream || !video.videoWidth || ocupado) return;
      if (som.on) contextoAudio(); // dentro do toque: é o que o Safari exige pra tocar depois
      const rec = recorteDaGuia(video, wrap, guia);
      const quadro = congelar();
      try { await ler(quadro || video, rec); }
      finally { if (quadro) quadro.width = quadro.height = 0; } // zerar libera o buffer (~44 MB em 4K)
    });
    $("[data-scan-file]").addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      let img;
      try { img = await bitmapDoArquivo(file); } catch (e) { dizer(t("scan.error")); return; }
      const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      // `galeria`: a foto é livre (sem moldura), a conferência pela imagem
      // procura a carta num leque maior de tamanhos e posições.
      await ler(img, { sx: 0, sy: 0, sw: w, sh: h, galeria: true });
      if (img.close) img.close();
    });
    inSomOn.addEventListener("change", () => { som.on = inSomOn.checked; salvarSom(); pintarSom(); if (som.on) contextoAudio(); });
    inBaixo.addEventListener("input", lerFaixas);
    inAlto.addEventListener("input", lerFaixas);
    $("[data-scan-form]").addEventListener("submit", (ev) => {
      ev.preventDefault();
      funil.dig += 1;
      buscarManual(input.value.trim().toUpperCase());
    });
    wrap.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-scan-close]")) { fechar(); return; }
      if (ev.target.closest("[data-scan-backdrop]") || ev.target.closest(".scan-sheet-handle")) { if (!folhaSom.hidden) fecharSom(); else fecharFolha(); return; }
      if (ev.target.closest("[data-scan-som]")) { abrirSom(); return; }
      const teste = ev.target.closest("[data-scan-som-teste]");
      if (teste) { const k = teste.dataset.scanSomTeste; tocar(SONS[k]); shared.vibrar(VIBRA[k]); return; }
      if (ev.target.closest("[data-scan-more]")) { abrirFolha(); return; }
      if (ev.target.closest("[data-scan-trava]")) {
        if (trava) destravar();
        else if (resultados[primario]) travar(resultados[primario]);
        else dizer(t("scan.lockHint"));
        return;
      }
      if (ev.target.closest("[data-scan-trava-folha]")) {
        const h = resultados[primario];
        if (h && trava && trava.chave === chaveSet(h)) destravar(); else if (h) travar(h);
        return;
      }
      if (ev.target.closest("[data-scan-lote]")) { fechar(); window.location.href = "collection"; return; }
      const add = ev.target.closest("[data-scan-add]");
      if (add) {
        const [tipo, i] = String(add.dataset.scanAdd).split(":");
        adicionar(tipo, Number(i), add);
        return;
      }
      const cand = ev.target.closest("[data-scan-cand]");
      if (cand) {
        const i = Number(cand.dataset.scanCand);
        if (i !== primario && trocaConta) { funil.troca += 1; trocaConta = false; }
        primario = i;
        pintarResultado();
        fecharFolha();
        return;
      }
      if (ev.target.closest("[data-scan-open]")) {
        const h = resultados[primario];
        if (!h) return;
        fechar();
        window.location.href = shared.detailUrl("set", h.card.set, null, h.game, { setId: h.card.setId });
      }
    });

    pintarSom();
    abrirCamera();
    // Aquece o motor enquanto a pessoa enquadra: na primeira vez é o download
    // dos ~3,5 MB, que assim acontece ANTES do toque no disparador.
    obterWorker(progresso).then(() => { if (stream && !ocupado) pronto(); }).catch(() => dizer(t("scan.error")));
  }

  window.TCGScan = {
    abrir, extrair, extrairCodigos, juntar, soDigitos, detectarJogo,
    integral, assinatura, semelhanca, assinaturasDoQuadro, ordemPelaFoto,
    numeroDe, noSet,
    faixaDePreco, configSom, SONS, VIBRA
  };
})();
