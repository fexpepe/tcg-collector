// Scanner de carta pela câmera — fase 1: OCR do CÓDIGO impresso na carta
// (OP01-001, BT1-001, 4/102, MH3 123…) e busca no catálogo. Ver
// docs/PLANO-SCANNER.md pro plano inteiro e os limites conhecidos.
//
// A FOTO NUNCA SAI DO APARELHO: o OCR é o Tesseract.js rodando em WASM dentro
// do navegador (auto-hospedado em assets/vendor/, a CSP é 'self'; no app vem
// do sleevu.app, ver ORIGEM_MOTOR). Pra rede vai
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
  //
  // No APP (Capacitor) o motor vem do sleevu.app, não do pacote (2026-10-10).
  // No Galaxy S10 o scanner ficava em "Preparando o leitor" pra sempre dentro
  // do app, enquanto o mesmo site no Chrome do aparelho lia normal. O worker
  // do Tesseract é a única parte do site que pede arquivo de DENTRO de um Web
  // Worker, e no app esses pedidos dependem de o WebView repassá-los ao
  // servidor interno do Capacitor. Da origem o caminho é o do site: rede
  // normal, com o dicionário liberado por CORS no _headers. SLEEVU.origem é
  // location.origin no site e https://sleevu.app no app (game.js).
  const VENDOR = "assets/vendor/tesseract-7.0.0/";
  const ORIGEM_MOTOR = (window.SLEEVU && window.SLEEVU.origem) || location.origin;
  const BASE = ORIGEM_MOTOR + "/" + VENDOR;
  // Worker de outra origem só nasce por blob (new Worker(url) exige a mesma
  // origem da página); no app não há CSP pra barrar blob:. No site segue por
  // URL, que a CSP (worker-src 'self') exige.
  const MOTOR_DE_FORA = ORIGEM_MOTOR !== location.origin;
  // Teto pra o leitor ficar pronto. Antes, um worker mudo deixava a tela em
  // "Preparando o leitor" pra sempre; agora vira erro, com a etapa no rastreio.
  // Folgado porque a 1ª vez baixa ~4 MB, às vezes no 3G.
  const PRAZO_MOTOR = 60000;
  const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-. ";
  const FAIXA = 0.24;        // fração INFERIOR da carta onde o código mora em quase todo jogo
  const RODAPE = 0.18;       // fração inferior JUSTA: o rodapé de verdade quando a carta encaixa
  // Folga do recorte em volta da moldura (fração da largura/altura dela, por
  // lado). Ver recorteDaGuia: a carta encaixada NA moldura lia pior que a
  // carta um pouco menor que ela.
  const MARGEM_GUIA = 0.04;
  // As larguras de cada passada do OCR (1400-2400 px: o Tesseract lê melhor
  // com ~30-50 px de altura de glifo, e cada carta sai numa escala) estão no
  // plano das passadas (PASSADAS).
  // Teto de tempo das passadas: aparelho lento não fica oito passadas preso
  // numa carta que não vai ler.
  const TETO_PASSADAS = 5000;
  // Canto DIREITO (fração da largura), lido à parte e ampliado quando o rodapé
  // inteiro não deu código: é onde o One Piece (embaixo) e o Gundam (em cima)
  // imprimem o código. Ver ler().
  const CANTO = 0.55;

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
  // Prefixo de One Piece/Gundam como a carta imprime (2026-09-29). O código
  // do One Piece é miúdo e escuro sobre a borda dourada, e o "O" inicial some
  // no OCR com frequência ("P01-016", "P3-040"); o set sempre tem dois
  // dígitos, mas o zero do meio também cai ("OP3-040"). "P" + dígitos não é
  // prefixo de jogo nenhum (a promo do Digimon/One Piece é "P-001", sem
  // dígito), então vira "OP"; e OP/EB/PRB/GD com um dígito ganham o zero.
  function prefixoJogo(p) {
    const s = String(p);
    if (/^P\d{1,2}$/.test(s)) return "OP" + s.slice(1).padStart(2, "0");
    const m = /^(OP|EB|PRB|GD)(\d)$/.exec(s);
    return m ? m[1] + "0" + m[2] : s;
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
    // Gundam (2026-09-29): a fonte do código ("GD01-110", branco no preto, no
    // alto da carta) sai do Tesseract como "6001-110", "G001-001" ou
    // "S002-030" — o G vira 6/S/C e o D, com o miolo fechado como o zero
    // cortado da fonte, vira 0/O. Começando por dígito, o código nem chegava
    // a ser candidato. Três letras por três: o comprimento não muda.
    const up = String(texto || "").toUpperCase().replace(/[‐‑–—]/g, "-").replace(/\s/g, " ")
      .replace(/\b0(?=[A-Z][A-Z0-9]{0,4}-[0-9OILSBZ])/g, "O")
      .replace(/\b[6GCS][D0O][0O](?=[1-9]-[0-9OILSBZ])/g, "GD0");
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
    // Códigos com BARRA E HÍFEN (Union Arena, Weiss) saem primeiro, e o trecho
    // deles some do texto que os padrões genéricos leem (`resto`, do mesmo
    // comprimento). Sem isso o "-P-001" de um "UE02BT/HTR-P-001" virava a
    // promo "P-001" do Digimon/One Piece, e o "W91-TE001" de um
    // "HOL/W91-TE001" do Weiss virava carta de Yu-Gi-Oh (2026-11-10: medido
    // no catálogo, ~450 cartas do Weiss iam pra busca como Yu-Gi-Oh).
    let resto = up;
    const tira = (x) => { resto = resto.slice(0, x.index) + " ".repeat(x[0].length) + resto.slice(x.index + x[0].length); };
    // Union Arena: UE21BT/RLY-1-082. O padrão de antes (UE + 2 dígitos + 2
    // letras, título só de letras, "-N-" obrigatório) deixava de fora 48 % do
    // catálogo: a promo ("UEPR/AOT-1-023"), o extra ("UEX01BT/BLC-1-036"), o
    // título com dígito ("UE12BT/KJ8-1-001"), a Action Point ("…-1-AP01",
    // "UEPR/AOT-AP01") e a paralela ("UE02BT/HTR-P-001").
    const reUA = /\b(U[EP][A-Z0-9]{2,5})\/([A-Z0-9]{2,4})-(?:([0-9P])-)?(AP)?([0-9OILSBZ]{2,3})\b/g;
    while ((m = reUA.exec(up))) {
      const s = /^(U[EP]X?)([0-9OILSBZ]{2})([A-Z]{2})$/.exec(m[1]);
      const set = s ? s[1] + soDigitos(s[2]) + s[3] : m[1];
      const d = soDigitos(m[5]);
      if (!/^\d+$/.test(d)) continue;
      add(`${set}/${m[2]}-${m[3] ? m[3] + "-" : ""}${m[4] || ""}${d}`, 3, m);
      tira(m);
    }
    // Weiss Schwarz: TÍTULO/LADO-NÚMERO — "SAO/S20-E001", "MM/W17-E001S",
    // "FT/SE10-E46", "CCS/WX01-001", "DG/EN-S03-E001", "HOL/W91-TE001". É o
    // maior jogo do catálogo com código impresso (31,6 mil cartas) e nenhum
    // padrão o lia: 89 % das cartas não viravam candidato. O lado é S ou W
    // (Schwarz/Weiss) com até duas letras e 2-3 dígitos; o número leva E/TE/PE
    // (inglês, trial, promo) e a raridade paralela GRUDADA (S, SP, R, SSP…),
    // que é parte do código — "E001" e "E001S" são cartas diferentes. Por isso
    // aqui S, B e Z são LETRA (sufixo), não dígito lido errado: só O/I/L
    // passam pela correção. Sai o código como lido e, com sufixo, também sem
    // ele (a raridade ao lado, "RR", pode ter grudado no OCR). As letras do
    // lado (SE, WX, SC…) nunca são O, I ou L — que ali são dígito lido errado.
    const reWeiss = /\b([A-Z0-9]{2,4})\/((?:EN-)?[SW][A-HJKMNP-Z]{0,2})([0-9OIL]{2,3})-([TP]?E|[TP])?([0-9OIL]{2,3})([A-Z]{0,4})\b/g;
    while ((m = reWeiss.exec(resto))) {
      const base = `${m[1]}/${m[2]}${soDigitos(m[3])}-${m[4] || ""}${soDigitos(m[5])}`;
      if (m[6]) add(base + m[6], 3, m);
      add(base, 3, m);
      tira(m);
    }
    // Cardfight!! Vanguard (2026-11-13): SET/NÚMERO + "EN" — "BT01/046EN",
    // "DZ-BT16/001EN", "D-PR/184EN". A paralela leva a raridade ANTES do
    // número e é parte do código ("V-BT02/SP01EN", "DZ-TBP01/GBPR+01EN",
    // "V-TB01/048fEN"): cada uma é carta própria no catálogo. Sai inteiro e
    // antes do reHifen, que leria só o "DZ-BT16" e o daria pro Digimon. O
    // "EN" do fim é o que separa do Weiss (TÍTULO/LADO-NÚMERO, lido acima).
    const reVG = /\b([A-Z0-9]+(?:-[A-Z0-9]+)?)\/([A-Z0-9+]*?)([0-9OIL]{2,4})([A-Z]?)EN\b/g;
    while ((m = reVG.exec(resto))) {
      const d = soDigitos(m[3]);
      if (!/^\d+$/.test(d) || !/[A-Z]/.test(m[1])) continue;
      add(`${m[1]}/${m[2]}${d}${m[4]}EN`, 3, m);
      tira(m);
    }
    // Palworld OFFICIAL CARD GAME (2026-11-11): "<OSR> EBP01-001OSR". O E da
    // frente é a edição inglesa; o set é BP (booster), TD (trial deck), SS
    // (sleeve set), PR (promo) ou SOUL; e a raridade PARALELA vem grudada no
    // número e é parte do código — "EBP01-001" e "EBP01-001OSR" são cartas
    // diferentes, como no Weiss. Sai como lido e, com sufixo, também sem ele.
    // Sem isto o "001OSR" virava lixo (O e S lidos como dígito) e a carta não
    // saía do peso 1. O "EBP01-001" do Godzilla passa por aqui também e sai
    // igual ao que o reHifen daria (o "+" da paralela dele fica fora do \b).
    const rePal = /\bE(BP|TD|SS|PR|SOUL)([0-9OIL]{0,2})-([0-9OIL]{3})(OSR|SSP|SSS|TSR|TSP|SR|SP|S)?\b/g;
    while ((m = rePal.exec(resto))) {
      const base = `E${m[1]}${soDigitos(m[2])}-${soDigitos(m[3])}`;
      if (m[4]) add(base + m[4], 3, m);
      add(base, 3, m);
      tira(m);
    }
    // Final Fantasy TCG: número DUPLO das séries fora do Opus — a promo, o
    // Legacy Collection e o World Champion Decks imprimem o próprio número e o
    // da carta original ("PR-004/1-027H", "RE-001H/12-002H", "W24-005/23-104H").
    // Sai inteiro e antes do reHifen, que só leria a primeira parte, e da
    // fração, que leria "004/1" (2026-11-11).
    const reFFDuplo = /\b(PR|RE|B|W\d{2})-([0-9OILSBZ]{3})([CRHLS]?)\s*\/\s*(\d{1,2})-([0-9OILSBZ]{3})([CRHLS])\b/g;
    while ((m = reFFDuplo.exec(resto))) {
      const a = soDigitos(m[2]), b = soDigitos(m[5]);
      if (/^\d{3}$/.test(a) && /^\d{3}$/.test(b)) add(`${m[1]}-${a}${m[3]}/${parseInt(m[4], 10)}-${b}${m[6]}`, 3, m);
    }
    // Código com hífen: OP01-001, EB01-001, BT1-001, ST01-001, EXB-001,
    // LOB-EN001, FB01-001, P-001, GD01-001. Prefixo com pelo menos uma letra;
    // sufixo com 2-4 dígitos (às vezes precedido do idioma, como no Yu-Gi-Oh)
    // e, colada, a raridade que o OCR às vezes não separa ("OP05-119SR",
    // "OP01-001L", "EB01-001C").
    const reHifen = /\b([A-Z][A-Z0-9]{0,5})-([A-Z]{0,2})([0-9OILSBZ]{2,6})([A-Z]{0,3})\b/g;
    while ((m = reHifen.exec(resto))) {
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
      // Mais de 3 dígitos num jogo de número com 3 (2026-09-29): no One Piece
      // a raridade ("C", "R" num quadrinho) e o contador de DON ao lado do
      // código saem do OCR como dígitos colados — "OP07-05163",
      // "ST10-00308", "EB01-0129". Antes a regex parava em 4 e a carta sumia.
      // Só quando o prefixo é de um jogo conhecido (peso 3): num prefixo
      // qualquer, 5 dígitos é lixo.
      if (!idioma && num.length > 3) {
        const d3 = soDigitos(num.slice(0, 3));
        const c3 = `${prefixoJogo(prefixo(m[1], true))}-${d3}`;
        if (/^\d{3}$/.test(d3) && pesoHifen(c3) === 3) { add(c3, 3, m); continue; }
        if (num.length > 4) continue;
      }
      // Com 3+ dígitos a cauda de letras é raridade (SR, L, C, UC, SEC…);
      // com 2, pode ser o terceiro dígito lido como letra.
      const digitos = soDigitos(num.length >= 3 ? num : num + cauda.slice(0, 1));
      if (!/^\d{2,4}$/.test(digitos)) continue; // sobrou letra que não é dígito: não é código
      const p = idioma ? prefixo(m[1], false) : prefixoJogo(prefixo(m[1], true));
      // Dois dígitos num jogo que numera com três: o OCR engoliu um zero
      // ("OP11-80"). O One Piece guarda o código inteiro no número, então
      // "80" não casava com "OP11-080" em lugar nenhum da busca.
      const tres = !idioma && digitos.length === 2 && /^(?:(?:OP|EB|PRB|GD)\d{2}|EX[BR]P?)$/.test(p);
      const c = `${p}-${idioma}${tres ? "0" + digitos : digitos}`;
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
    // O código do set pode começar por dígito (Magic "2XM", "2X2", "40K"),
    // desde que tenha letra: "123 EN" não é set.
    const reSet = new RegExp(`\\b((?=[0-9]*[A-Z])[A-Z0-9]{3,4})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\b`, "g");
    const NUM = "[0-9OILSBZ]";
    const reAntes = new RegExp(`\\b0*(${NUM}{1,4})(?:\\s*\\/\\s*0*(${NUM}{1,4}))?\\s*[A-Z]?\\s*$`);
    const reDepois = new RegExp(`^ *(?:[A-Z]{1,2} +)?0*(${NUM}{1,4})(?: *\\/ *0*(${NUM}{1,4}))?(?![A-Z0-9])`);
    const numero = (raw) => { const d = soDigitos(raw); return /^\d+$/.test(d) && parseInt(d, 10) > 0 ? parseInt(d, 10) : 0; };
    // `up` troca toda quebra de linha por espaço; a linha de verdade se
    // confere no texto original, que tem o mesmo comprimento.
    const bruto = String(texto || "");
    const mesmaLinha = (a, b) => bruto.length !== up.length || bruto.slice(a, b).indexOf("\n") < 0;
    // Riftbound: "RAD • 137/167 • EN" — set, fração e SÓ ENTÃO o idioma. A
    // fração sozinha já sai abaixo, mas ela repete entre sets (e entre jogos)
    // de mesmo total; com o set, a busca cai na carta.
    const reSetFrac = new RegExp(`\\b([A-Z][A-Z0-9]{2,3})\\s*[•·.\\-]?\\s*0*(${NUM}{1,3})[A-Z*]?\\s*\\/\\s*0*(${NUM}{1,3})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\b`, "g");
    while ((m = reSetFrac.exec(up))) {
      const k = numero(m[2]);
      if (k && numero(m[3]) >= 10) add(`${m[1]} ${k}`, 2, m);
    }
    while ((m = reSet.exec(up))) {
      const set = m[1];
      const antes = up.slice(Math.max(0, m.index - 24), m.index).match(reAntes);
      // Fração de total pequeno logo antes é poder/resistência ("3/3"), não
      // número de carta: set do Magic tem 100+ cartas.
      const n = antes && !(antes[2] && numero(antes[2]) < 100) ? numero(antes[1]) : 0;
      if (n) { add(`${set} ${n}`, 2, { index: m.index - antes[0].length, 0: antes[0] + m[0] }); continue; }
      // Número DEPOIS do set, na mesma linha (2026-11-10): o Star Wars
      // Unlimited imprime "JTL • EN ◆ 760" — set, idioma, o símbolo da
      // raridade e só então o número —, e o Pokémon Scarlet & Violet,
      // "OBF EN 006/197". Antes só se olhava pra trás (Magic), e o SWU inteiro
      // não virava candidato. Cabe um sinal curto no meio (o símbolo da
      // raridade sai do OCR como uma letra ou duas). Exige um DÍGITO de
      // verdade — "MH3 EN LIZ DANFORTH" não pode virar "MH3 112" — e descarta
      // ano ("MH3 EN TM 2024 WIZARDS").
      const fimSet = m.index + m[0].length;
      const dep = up.slice(fimSet, fimSet + 16).match(reDepois);
      if (dep && /\d/.test(dep[1]) && mesmaLinha(fimSet, fimSet + dep[0].length)) {
        const k = numero(dep[1]);
        const ano = !dep[2] && /^(19|20)\d\d$/.test(soDigitos(dep[1]));
        if (k && !ano) { add(`${set} ${k}`, 2, { index: m.index, 0: m[0] + dep[0] }); continue; }
      }
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
    // FAB: WTR001, IRA002 (3 letras + 3 dígitos colados). Os History Pack são
    // os únicos que começam por dígito ("1HP001", "1HB001": 750 cartas).
    const reFab = /\b([A-Z]{3}|1H[A-Z])(\d{3})\b/g;
    while ((m = reFab.exec(resto))) add(m[1] + m[2], 2, m);
    // Godzilla Card Game: a carta de Rage numera fora do set e sem hífen
    // ("EGZ07"), e o reHifen não a vê (2026-11-11). As Rage "E06" ficam de
    // fora: E + dois dígitos é genérico demais pra virar candidato forte.
    const reRage = /\bEGZ([0-9OILSBZ]{2})\b/g;
    while ((m = reRage.exec(resto))) {
      const d = soDigitos(m[1]);
      if (/^\d{2}$/.test(d)) add("EGZ" + d, 3, m);
    }
    // Final Fantasy TCG: "1-001H", "27-120L" — o número do Opus, hífen, três
    // dígitos e a raridade colada (C, R, H, L, S). Começa por DÍGITO, e o
    // reHifen só lê prefixo com letra (2026-11-11).
    const reFF = /\b(\d{1,2})-([0-9OILSBZ]{3})([CRHLS])\b/g;
    while ((m = reFF.exec(resto))) {
      const d = soDigitos(m[2]);
      if (/^\d{3}$/.test(d)) add(`${parseInt(m[1], 10)}-${d}${m[3]}`, 3, m);
    }
    // Fração: 4/102, 009/094, 12/204 (Pokémon, Lorcana, Riftbound, Magic antigo).
    // COMO IMPRESSA primeiro, sem os zeros depois: o catálogo guarda o número
    // do jeito que a carta imprime ("009/094" no Pokémon moderno, "4/102" no
    // antigo) e a busca da borda casa palavra por prefixo — "9" não acha
    // "009". Testado no celular: a Nymble 009/094 saía como 9/94 e não achava.
    // Total abaixo de 10 quase sempre é lixo (barras do texto em japonês).
    const reFrac = /\b([0-9OILSBZ]{1,3})\s*\/\s*([0-9OILSBZ]{1,3})\b/g;
    while ((m = reFrac.exec(resto))) {
      const a = soDigitos(m[1]), b = soDigitos(m[2]);
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || parseInt(b, 10) === 0) continue;
      const peso = parseInt(b, 10) >= 10 ? 2 : 0;
      add(`${a}/${b}`, peso, m);
      add(`${parseInt(a, 10)}/${parseInt(b, 10)}`, peso, m);
    }
    // Fração com LETRA depois do número: a arte alternativa do Riftbound
    // ("263a/298", que o OCR devolve em maiúscula). A letra é o que separa a
    // versão; sai como lida e, depois, sem ela (a letra pode ser lixo).
    const reFracLetra = /\b(\d{1,3})([A-D])\s*\/\s*(\d{2,3})\b/g;
    while ((m = reFracLetra.exec(resto))) {
      if (parseInt(m[3], 10) < 10) continue;
      add(`${m[1]}${m[2]}/${m[3]}`, 2, m);
      add(`${m[1]}/${m[3]}`, 2, m);
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
      else por.set(x.codigo, { codigo: x.codigo, peso: x.peso, conf: x.conf, votos: 1, leitura: i, ordem: por.size, origem: x.origem || "" });
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
    riftbound: [/RIOT ?GAMES/, /RIFTBOUND/, /LEAGUE ?OF ?LEGENDS/, /\d{4} ?RGI\b/],
    unionarena: [/UNION ?ARENA/],
    naruto: [/NARUTO/, /KISHIMOTO/],
    // O de 2027 imprime a mesma marca que o vintage: os dois empatam e a busca
    // vai nos dois (sem a pista, a carta nova era filtrada pro vintage).
    narutocg: [/NARUTO/, /KISHIMOTO/],
    hxh: [/HUNTER/, /TOGASHI/],
    // Jogos que entraram no catálogo depois do scanner e não tinham pista
    // nenhuma (2026-11-10): 11 dos 24 jogos. Só o que a carta IMPRIME em
    // letra latina e é só dela — o SWU assina "© LFL © FFG"; o Harry Potter
    // (2001, da Wizards) traz "Wizards" E "Warner Bros."/"Harry Potter", e
    // duas pistas vencem a única do Magic. O vintage japonês (Carddass,
    // Miracle Battle) não tem texto que o modelo inglês leia: fica sem.
    swu: [/\bLFL\b/, /\bFFG\b/, /LUCASFILM/, /STAR ?WARS/],
    weiss: [/WEISS/, /SCHWARZ/, /BUSHIROAD/],
    harrypotter: [/HARRY ?POTTER/, /WARNER ?BROS/],
    lotr: [/DECIPHER/, /TOLKIEN/, /NEW ?LINE/],
    wow: [/BLIZZARD/, /WARCRAFT/, /CRYPTOZOIC/],
    sorcery: [/CURIOSA/, /SORCERY/],
    cyberpunk: [/CYBERPUNK/, /CD ?PROJEKT/],
    dbz: [/FUNIMATION/, /SCORE ?ENTERTAINMENT/],
    // Godzilla Card Game: "TM & © TOHO" no rodapé. O nome "Godzilla" não
    // entra: ele está na arte e no nome de carta do Magic (Ikoria) também.
    godzilla: [/\bTOHO\b/],
    // "©PALWORLD" no canto da carta (a 2ª edição do BP01 leva um "II" antes).
    palworld: [/PALWORLD/, /POCKETPAIR/],
    // Final Fantasy TCG: "© SQUARE ENIX" no rodapé. O "Final Fantasy" não
    // entra: é nome de set do Magic (Universes Beyond) também.
    fftcg: [/SQUARE ?ENIX/],
    // Cardfight!! Vanguard: o nome do jogo no verso e no rodapé. "BUSHIROAD"
    // sozinho é do Weiss (a mesma editora); o formato do código desempata.
    vanguard: [/VANGUARD/, /CARDFIGHT/]
  };
  const FORMATOS = [
    [/^(OP|EB|PRB)\d{2}-/, ["onepiece"]],
    // "ST01-001" é starter de três jogos e o Story Booster do DBFW (144
    // cartas, que antes iam pra busca só como One Piece/Digimon).
    [/^ST\d{2}-\d{3}$/, ["onepiece", "gundam", "digimon", "dbfw"]],
    [/^ST\d{1,2}-\d{2}$/, ["digimon"]],
    [/^(BT|EX|RB|LM)\d{1,2}-/, ["digimon"]],
    [/^P-\d{3}$/, ["digimon", "onepiece"]],
    [/^(GD\d{2}|EXB|EXR|EXBP|EXRP)-/, ["gundam"]],
    [/^(FB|FS|FC|FP)\d{0,2}-/, ["dbfw"]],
    // Manga Booster do DBFW (SB01-001): sem isto o código valia peso 1, o
    // jogo não saía do formato (o DBFW imprime o copyright NA VERTICAL,
    // "©B.S./S., T.A", e o OCR não lê) e toda leitura ia até a carta inteira.
    // Dígitos exigidos: o Yu-Gi-Oh tem sets "SB" com letra (SBAD-EN001).
    [/^SB\d{2}-\d{3}$/, ["dbfw"]],
    [/^[A-Z0-9]{2,4}-[A-Z]{2}\d{3}/, ["ygo"]],
    [/^U[EP][A-Z0-9]{2,5}\//, ["unionarena"]],
    [/^[A-Z0-9]{2,4}\/(?:EN-)?[SW][A-Z]{0,2}\d{2,3}-/, ["weiss"]],
    [/^(?:[A-Z]{3}|1H[A-Z])\d{3}$/, ["fab"]],
    // Godzilla Card Game: EBP01-001 (booster), ESD01- (starter), ESC01-
    // (Sleeve & Card Set), EPR-015 (promo) e as Rage EGZ07 (2026-11-11).
    // O Palworld (Bushiroad também) imprime o MESMO "EBP01-001" e "EPR-001":
    // esses dois são dos dois jogos, e quem decide é a pista impressa (TOHO ×
    // ©PALWORLD) e o índice de sets. ETD, ESS e ESOUL só existem no Palworld.
    [/^(?:EBP\d{2}|EPR)-/, ["godzilla", "palworld"]],
    [/^E(?:SD|SC)\d{2}-/, ["godzilla"]],
    [/^E(?:TD|SS)\d{2}-\d{3}|^ESOUL-\d{3}/, ["palworld"]],
    [/^EGZ\d{2}$/, ["godzilla"]],
    // Final Fantasy TCG: 1-001H (Opus e starters) e as séries fora do Opus,
    // PR-001 (promo), B-001 (Boss Deck), Re-001H (Legacy Collection) e
    // W24-001 (World Champion Decks), sozinhas ou no número duplo (2026-11-11).
    [/^\d{1,2}-\d{3}[CRHLS]$/, ["fftcg"]],
    [/^(?:PR|RE|B|W\d{2})-\d{3}$/, ["fftcg"]],
    [/^(?:PR|RE|B|W\d{2})-\d{3}[CRHLS]?\/\d{1,2}-\d{3}[CRHLS]$/, ["fftcg"]],
    // Cardfight!! Vanguard: SET/NÚMERO com o "EN" no fim (2026-11-13).
    [/^[A-Z0-9]+(?:-[A-Z0-9]+)?\/[A-Z0-9+]*\d{2,4}[A-Z]?EN$/, ["vanguard"]],
    // Fração: os cinco jogos que numeram "N/T". SWU e Harry Potter não
    // estavam aqui, e a fração deles era filtrada pros outros três — só
    // achava se nenhum set de Pokémon/Lorcana/Riftbound tivesse o mesmo total.
    [/^\d+[A-D]?\/\d+$/, ["pokemon", "lorcana", "riftbound", "swu", "harrypotter"]],
    // "SET NÚMERO": Magic ("MH3 123"), SWU ("JTL 760") e Riftbound ("RAD
    // 137"). Quem diz qual dos três é a pista impressa (Wizards, LFL/FFG,
    // RGI) ou o índice de sets do catálogo (ver indiceDeSets).
    [/^(?=[0-9]*[A-Z])[A-Z0-9]{3,4} \d+$/, ["magic", "swu", "riftbound"]],
    [/^\d{1,2} \d+$/, ["lorcana"]]
  ];
  //   4. ONDE o código foi lido (`origens`: código -> "topo" | "base"). O
  //      Gundam é o único que imprime o código no ALTO da carta; os outros,
  //      no rodapé. "ST01-005" é Gundam lido no topo e One Piece/Digimon lido
  //      embaixo — antes o ST10-003 do One Piece voltava como carta do Gundam.
  //   5. o ÍNDICE DE SETS do catálogo (`indice`: chave do set -> jogos que o
  //      têm; ver indiceDeSets). O formato diz "pode ser Magic, SWU ou
  //      Riftbound"; o set diz qual: "JTL" só existe no SWU. Quando o formato
  //      admite vários jogos e o set do código existe em só alguns deles,
  //      ficam esses — e um só vale como palavra impressa. Sem índice (dev,
  //      rede fora), tudo segue como antes.
  function detectarJogo(texto, codigos, sessao, origens, indice) {
    const up = String(texto || "").toUpperCase();
    const pontos = {};
    const soma = (g, n) => { pontos[g] = (pontos[g] || 0) + n; };
    let impresso = false; // pista decisiva bateu (formato ambíguo + sessão nunca dão certeza)
    Object.keys(PISTAS).forEach((g) => PISTAS[g].forEach((re) => { if (re.test(up)) { soma(g, 3); impresso = true; } }));
    (codigos || []).slice(0, 2).forEach((c) => {
      const onde = origens && origens[c];
      if (onde === "topo" && /^[A-Z]+\d*-\d{3}$/.test(c)) { soma("gundam", 3); impresso = true; return; }
      const doSet = indice && indice.size ? indice.get(chaveDoSet(c)) : null;
      // Código que nenhum formato conhece, mas cujo set existe: os jogos do
      // set ("LOB-032" é do Yu-Gi-Oh porque LOB é set dele).
      if (doSet && c.indexOf("-") > 0 && !FORMATOS.some(([re]) => re.test(c))) {
        if (doSet.length === 1) { soma(doSet[0], 3); impresso = true; } else doSet.forEach((g) => soma(g, 2));
      }
      FORMATOS.forEach(([re, gs]) => {
        if (!re.test(c)) return;
        let cabe = onde === "base" && gs.length > 1 ? gs.filter((g) => g !== "gundam") : gs;
        if (doSet && /^\S+ \d+$/.test(c)) {
          // "SET NÚMERO" é formato de qualquer jogo: quem tem o set é quem o
          // índice diz ("DIS" é promo do Lorcana E set do Magic).
          cabe = doSet;
        } else if (doSet && cabe.length > 1) {
          const comSet = cabe.filter((g) => doSet.includes(g));
          if (comSet.length) cabe = comSet;
        }
        if (cabe.length === 1) { soma(cabe[0], 3); impresso = true; } else cabe.forEach((g) => soma(g, 2));
      });
    });
    if (sessao && sessao !== "hub") soma(sessao, 1);
    const jogos = Object.keys(pontos).sort((a, b) => pontos[b] - pontos[a] || a.localeCompare(b));
    // "Confiante" = alguma pista decisiva bateu (>= 3) e ninguém empata.
    const confiante = impresso && pontos[jogos[0]] >= 3 && (jogos.length === 1 || pontos[jogos[1]] < pontos[jogos[0]]);
    // Sem pista nenhuma: todos os jogos valem (a busca decide).
    return { jogos, pontos, confiante, restritos: jogos.filter((g) => pontos[g] >= 2) };
  }

  // ── ENCAIXE NO CATÁLOGO (funções PURAS; testadas em tests/scan-encaixe.test.mjs) ──
  // O OCR devolve texto; o catálogo é um vocabulário FECHADO. Até 2026-11-10 a
  // ponte entre os dois era só formato e busca: qualquer coisa com cara de
  // código ia pra borda, que casa palavra por prefixo e por NOME, e o primeiro
  // resultado virava "a carta". Na bancada (139 cartas reais, foto simulada)
  // isso deu 38 certas e 26 ERRADAS, 13 delas sem aviso nenhum: "4/3" achava
  // uma promo do Lorcana, "71/204" do Lorcana achava um Pokémon chinês de set
  // com 204 cartas, "YOU 4" achava "If I Didn't Have You". Estas funções
  // fecham a ponte: o resultado tem de CASAR com o código, o set tem de
  // EXISTIR, e o que ficar em dúvida é resolvido pela foto (estadoDaFoto).
  const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // O resultado da busca CASA com o código lido? Em qualquer escrita da carta
  // (`formas`, o cardCodeForms do shared); pelo começo do número guardado,
  // quando o que sobra é só a raridade grudada ("BT1-003" de "BT1-003 R",
  // "P-214" de "P - 214 P", "E001" de "E001S"); e "SET NÚMERO" pelo set E
  // pelo número ("1 11" do Lorcana colado dava "111", a carta 111).
  function casaCodigo(codigo, card, formas) {
    const fs = formas ? formas(card) : [card.number];
    const sn = /^(\S+) (\d+)$/.exec(String(codigo).trim());
    if (sn) {
      return normKey(card.setId) === normKey(sn[1])
        && fs.some((f) => normKey(f) === sn[2] || (/^\d+$/.test(f) && parseInt(f, 10) === parseInt(sn[2], 10)));
    }
    const alvo = normKey(codigo);
    if (!alvo) return false;
    if (fs.some((f) => normKey(f) === alvo)) return true;
    const num = normKey(card.number);
    return /[a-z]/.test(alvo) && alvo.length >= 4 && num.indexOf(alvo) === 0 && /^[a-z]*$/.test(num.slice(alvo.length));
  }
  // Chave do SET de um código, pra consultar o índice de sets: o que vem antes
  // do número. "MH3 123" -> mh3; "OP05-119" -> op05; "LOB-EN001" -> lob;
  // "UE21BT/RLY-1-082" -> ue21bt; "SAO/S20-E001" -> saos20 (o set do Weiss é
  // título + lado). Fração e código colado (FAB) não têm set: "".
  function chaveDoSet(codigo) {
    const c = String(codigo || "").trim();
    const sn = /^(\S+) \d+$/.exec(c);
    if (sn) return normKey(sn[1]);
    if (/^U[EP][A-Z0-9]{2,5}\//.test(c)) return normKey(c.slice(0, c.indexOf("/")));
    const i = c.lastIndexOf("-");
    if (i < 1 || /^\d+[A-D]?\/\d+$/.test(c)) return "";
    return normKey(c.slice(0, c.indexOf("/") >= 0 ? i : c.indexOf("-")));
  }
  // Candidatos que o catálogo desmente saem ANTES da busca. "SET NÚMERO" só
  // vale se o set existe em algum jogo: o padrão do Magic casa qualquer
  // palavra de 3-4 letras seguida de idioma ("YOU EN 4", "DAKK 1"), e o
  // Pokémon Scarlet & Violet imprime um código de set que o catálogo não
  // guarda ("OBF EN 006/197" — a fração dele segue na lista). E o contrário:
  // código com hífen de prefixo "desconhecido" (peso 1) cujo prefixo É um set
  // do catálogo ("LOB-032", o Yu-Gi-Oh antigo sem o "-EN") sobe pra peso 2 —
  // quem diz que aquilo é código é o catálogo, não a lista de formatos. Sem
  // índice, nada muda.
  function filtrarPorIndice(cands, indice) {
    if (!indice || !indice.size) return cands;
    return cands.filter((x) => !/^\S+ \d+$/.test(x.codigo) || indice.has(chaveDoSet(x.codigo)))
      .map((x) => (x.peso === 1 && x.codigo.indexOf("-") > 0 && indice.has(chaveDoSet(x.codigo)) ? Object.assign({}, x, { peso: 2 }) : x));
  }
  // Os "SET NÚMERO" que o filtro acima tirou: o set lido não existe, mas pode
  // estar a UMA letra de um que existe ("OMU 257" é "DMU 257": o D virou O).
  // Não vão pra busca; vão pros vizinhos do set (vizinhosDoSet).
  function orfaosDoIndice(cands, indice) {
    if (!indice || !indice.size) return [];
    return cands.filter((x) => /^\S+ \d+$/.test(x.codigo) && x.peso >= 1 && !indice.has(chaveDoSet(x.codigo)));
  }
  // VIZINHOS de um código: o mesmo código com UM dígito do número trocado.
  // É o erro que sobra do OCR sob desfoque ("OP05-119" lido "OP05-110",
  // "LOB-032" lido "LOB-042", Lorcana "76" lido "16") — e ele cai numa carta
  // que EXISTE, então a busca sozinha não tem como desconfiar. Quando a foto
  // desmente o resultado, os vizinhos que existem vão pra foto decidir. Na
  // frente, as trocas que o Tesseract mais faz em texto miúdo.
  const CONFUNDE = { 0: "869", 1: "74", 2: "73", 3: "895", 4: "19", 5: "638", 6: "580", 7: "12", 8: "0369", 9: "0834" };
  function vizinhosDoNumero(codigo) {
    const c = String(codigo || "");
    // O número: numa fração, o de antes da barra; fora dela, a última
    // sequência de dígitos.
    const fr = /^(\d+)([A-D]?\/\d+)$/.exec(c);
    const m = fr ? { ini: 0, num: fr[1] } : (() => { const k = /(\d+)(\D*)$/.exec(c); return k ? { ini: k.index, num: k[1] } : null; })();
    if (!m) return [];
    const antes = c.slice(0, m.ini), depois = c.slice(m.ini + m.num.length);
    const prov = [], resto = [];
    for (let i = 0; i < m.num.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === m.num[i]) continue;
        const novo = antes + m.num.slice(0, i) + d + m.num.slice(i + 1) + depois;
        ((CONFUNDE[m.num[i]] || "").indexOf(String(d)) >= 0 ? prov : resto).push(novo);
      }
    }
    return prov.concat(resto);
  }
  // Vizinhos do SET: o set lido não é set de jogo nenhum, mas fica a um
  // caractere de um que é — um trocado ("OP00-119" -> OP05, "OMU 257" -> DMU)
  // ou o começo engolido ("B04-094" -> FB04, "P-063" -> RP, "AD-EN043" ->
  // DUAD: até dois caracteres). `ids`: os ids de set (como o catálogo
  // escreve) dos jogos possíveis. Pra código com hífen e pra "SET NÚMERO".
  function vizinhosDoSet(codigo, ids) {
    const c = String(codigo || "");
    const m = /^([A-Z0-9]{1,6})(-(?:[A-Z]{2})?)(\d{2,4})$/.exec(c) || /^([A-Z0-9]{2,5})( )(\d{1,4})$/.exec(c);
    if (!m) return [];
    const p = m[1], out = [];
    (ids || []).forEach((id) => {
      const s = String(id).toUpperCase();
      if (!/^[A-Z0-9]{2,6}$/.test(s) || s === p) return;
      let perto = false;
      if (s.length === p.length) {
        let dif = 0;
        for (let i = 0; i < s.length; i++) if (s[i] !== p[i]) dif++;
        perto = dif === 1;
      } else perto = s.length > p.length && s.length <= p.length + (p.length >= 2 ? 2 : 1) && s.slice(s.length - p.length) === p;
      const v = `${s}${m[2]}${m[3]}`;
      if (perto && out.indexOf(v) < 0) out.push(v);
    });
    return out;
  }
  // O que a FOTO diz de um resultado. `sim`: a maior semelhança entre a foto
  // e as miniaturas dos achados (null = nenhuma imagem chegou). `forte`: o
  // código tem formato plausível (peso >= 2) e o resultado CASA com ele;
  // `peso`: o peso do candidato.
  //   certo   — a foto confirma (>= FOTO_CONFIRMA);
  //   duvida  — código forte que a foto não confirma: fica, marcado pra
  //             conferir (foto com reflexo, imagem do catálogo diferente da
  //             carta), enquanto nada melhor aparecer. Abaixo de FOTO_NEGA só
  //             fica o formato de jogo (peso 3): fração e "SET NÚMERO" são o
  //             que o lixo do OCR mais imita;
  //   semfoto — formato de jogo (peso 3) e nenhuma imagem pra comparar (a
  //             carta não tem imagem, a rede não entregou): vale a busca,
  //             como sempre valeu. Fração e "SET NÚMERO" sem imagem ficam em
  //             DÚVIDA: na bancada, as duas últimas erradas sem aviso eram
  //             "249/288" e "DIS 5" casando com carta sem miniatura;
  //   negado  — o resto: resultado fraco que a foto não confirma.
  // Calibrado na bancada de 2026-11-10 (139 cartas, 13 jogos): carta certa
  // dá 0,96-0,99 com a imagem limpa e 0,65-0,98 com a foto simulada (borrão,
  // reflexo, tom de lâmpada, carta torta); carta errada dá -0,07 a 0,32 e, na
  // mesma moldura do mesmo jogo, até 0,53.
  const FOTO_CONFIRMA = 0.6, FOTO_NEGA = 0.42;
  // O que entra PELA FOTO (vizinho de código, número solto, palavra do set
  // travado) passa por régua mais alta: ver melhorPelaFoto.
  const FOLGA_REPARO = 0.06, MARGEM_REPARO = 0.08;
  function estadoDaFoto(sim, forte, peso) {
    if (typeof sim !== "number") return !forte ? "negado" : peso >= 3 ? "semfoto" : "duvida";
    if (sim >= FOTO_CONFIRMA) return "certo";
    if (forte && (sim >= FOTO_NEGA || peso >= 3)) return "duvida";
    return "negado";
  }
  // RECONHECIMENTO PELA ARTE, no set travado (2026-11-10). Com o set travado
  // o scanner baixa as miniaturas dele uma vez e guarda a assinatura de cada
  // carta; daí em diante a foto é comparada com o SET INTEIRO, sem ler código
  // nenhum. É a fase 2 do plano (docs/PLANO-SCANNER.md) no recorte que cabe
  // no aparelho: o set é o filtro, a assinatura decide. Cobre o que o código
  // não cobre — o jogo que imprime só o número (Dragon Ball Z, LOTR,
  // Carddass, HxH) ou nem isso (WoW, Sorcery) — e, quando a arte é
  // inconfundível, dispensa o OCR: a leitura cai de ~2 s pra menos de meio.
  //
  // `sims[i]`: a semelhança da foto com a carta i do set (null = sem
  // assinatura). Vale a mais parecida se passar da régua (a mesma do que
  // entra pela foto) e tiver FOLGA sobre a melhor das que não empatam com
  // ela. As que empatam (EMPATE_ARTE) são a mesma arte em outra versão —
  // foil, carimbo, reimpressão no mesmo set — e vão junto: `claro` diz se a
  // arte apontou UMA carta. null = a arte não decide.
  const EMPATE_ARTE = 0.03;
  function escolherPelaArte(sims) {
    let i = -1;
    sims.forEach((x, k) => { if (typeof x === "number" && (i < 0 || x > sims[i])) i = k; });
    if (i < 0 || sims[i] < FOTO_CONFIRMA + FOLGA_REPARO) return null;
    const empates = [], resto = [];
    sims.forEach((x, k) => { if (typeof x === "number") (x >= sims[i] - EMPATE_ARTE ? empates : resto).push(k); });
    const rival = resto.reduce((m, k) => Math.max(m, sims[k]), -1);
    if (sims[i] - rival < MARGEM_REPARO) return null;
    empates.sort((a, b) => sims[b] - sims[a] || a - b);
    return { i, sim: sims[i], empates, claro: empates.length === 1 };
  }
  // Sets que casam com o que a pessoa digitou no seletor da trava: todas as
  // palavras no nome ou no id, sem acento nem caixa. `jogo`: só os dele, se
  // dado. Os do jogo da sessão e os que COMEÇAM pelo texto vêm antes.
  function filtrarSets(sets, texto, jogo, sessao) {
    const limpa = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const termos = limpa(texto).split(/\s+/).filter(Boolean);
    const nota = (st) => {
      const alvo = `${limpa(st.name)} ${limpa(st.id)}`;
      if (!termos.every((w) => alvo.indexOf(w) >= 0)) return -1;
      return (st.game === sessao ? 2 : 0) + (termos.length && limpa(st.name).indexOf(termos[0]) === 0 ? 1 : 0);
    };
    return (sets || []).filter((st) => !jogo || st.game === jogo)
      .map((st, k) => ({ st, n: nota(st), k }))
      .filter((x) => x.n >= 0)
      .sort((a, b) => b.n - a.n || a.k - b.k)
      .slice(0, 40)
      .map((x) => x.st);
  }
  // Com o SET TRAVADO, o vocabulário é o do set: qualquer palavra do texto
  // lido que seja o NÚMERO de uma carta dele é candidata — é o que deixa ler
  // o jogo que imprime só o número (Dragon Ball Z "60", LOTR "15", HxH
  // "C01"), onde formato nenhum tem como dizer que aquilo é código. Devolve
  // as cartas, das palavras mais específicas (com letra, mais longas) pras
  // menos; quem chama confere pela foto, porque número solto tem em toda
  // carta (ataque, custo, ano).
  function cartasPelasPalavras(cartas, texto) {
    const palavras = String(texto || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const vistas = new Set(), out = [];
    const chaves = Array.from(new Set(palavras.map((w) => (/^\d+$/.test(w) ? String(parseInt(w, 10)) : w.toLowerCase()))))
      .sort((x, y) => (/[a-z]/.test(y) ? 1 : 0) - (/[a-z]/.test(x) ? 1 : 0) || y.length - x.length);
    chaves.forEach((k) => {
      (cartas || []).forEach((c) => {
        const n = normKey(c.number);
        if (!n || vistas.has(c.id)) return;
        if (n === k || (/^\d+$/.test(n) && /^\d+$/.test(k) && parseInt(n, 10) === parseInt(k, 10))) { vistas.add(c.id); out.push(c); }
      });
    });
    return out;
  }

  // ── ÍNDICE DE SETS do catálogo ──────────────────────────────────────────────
  // O manifest de cada jogo (a lista de sets, ~120 KB gz os 24 juntos) já era
  // baixado pela primeira busca por código; aqui ele desce em paralelo
  // enquanto a pessoa enquadra e vira um índice: chave do set -> jogos que o
  // têm (`ids`: os ids de set de cada jogo, pros vizinhos). O mesmo id existe
  // em mais de um jogo ("OP05" é set do One Piece e um pacote de torneio do
  // Yu-Gi-Oh), então o índice não decide sozinho: ele estreita o que o
  // FORMATO já admite (detectarJogo). Em dev não há manifest: o índice sai
  // vazio e tudo segue pelo formato, como antes.
  const manifestos = {};
  function manifestDe(g) {
    if (!manifestos[g]) {
      manifestos[g] = (async () => {
        if (window.SLEEVU && window.SLEEVU.game === g && window.TCG_MANIFEST) return window.TCG_MANIFEST;
        try {
          const r = await fetch(shared.gameDataDir(g) + "manifest.generated.js");
          if (!r.ok) return null;
          const tx = await r.text();
          return JSON.parse(tx.slice(tx.indexOf("{"), tx.lastIndexOf("}") + 1));
        } catch (e) { return null; }
      })();
    }
    return manifestos[g];
  }
  function montarIndice(pares) {
    const mapa = new Map();
    mapa.ids = {};
    mapa.sets = []; // todos os sets, pro seletor da trava: { game, id, name, lang, n }
    pares.forEach(([g, m]) => {
      const sets = (m && m.sets) || [];
      mapa.ids[g] = sets.map((x) => String(x.id));
      sets.forEach((x) => mapa.sets.push({ game: g, id: String(x.id), name: String(x.name || x.id), lang: x.language || "en", n: Number(x.count) || 0 }));
      sets.forEach((x) => {
        const k = normKey(x.id);
        if (!k) return;
        const v = mapa.get(k) || [];
        if (v.indexOf(g) < 0) v.push(g);
        mapa.set(k, v);
      });
    });
    return mapa;
  }
  let indicePromessa = null;
  function indiceDeSets() {
    if (!indicePromessa) {
      indicePromessa = Promise.all((shared.GAME_SLUGS || []).map((g) => manifestDe(g).then((m) => [g, m])))
        .then(montarIndice)
        .catch(() => montarIndice([]));
    }
    return indicePromessa;
  }

  // ── Busca do candidato no catálogo ──────────────────────────────────────────
  // `jogos`: lista ORDENADA de jogos permitidos (vazia = todos). A borda é
  // consultada por jogo quando são poucos — resposta menor e mais precisa.
  // `soLocal`: só o manifest e os chunks já baixados, sem ida à borda — é
  // como os VIZINHOS de um código são procurados (até uma dúzia por leitura).
  // Cada resultado sai com `exato`: se a carta CASA com o código (casaCodigo).
  // Havendo algum exato, os outros saem — são o que a borda achou por prefixo
  // ou pelo NOME; sem nenhum, ficam marcados, e só a foto os confirma.
  async function buscar(codigo, jogos, soLocal, limite) {
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
    if (out.length < 3 && !soLocal) {
      let hits;
      if (permitidos && permitidos.length <= 3) {
        const porG = await Promise.all(permitidos.map((g) => shared.searchApi(g, codigo, limite || 8)));
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
    out.forEach((h) => { h.exato = casaCodigo(codigo, h.card, shared.cardCodeForms); });
    const exatos = out.filter((h) => h.exato);
    const lista = exatos.length ? exatos : out;
    lista.sort((a, b) => posicao(a.game) - posicao(b.game));
    return lista.slice(0, limite || 12);
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
    // Uma letra ou asterisco entre o número e a barra é a marca da versão
    // (Riftbound "263a/298", "299*/298"): sem aceitá-la, o "número" dessas
    // cartas saía 298 — o total —, e a trava de set as confundia todas.
    const fr = /^(?:.*?[^\d])?(\d+)[A-Z*]?\s*\/\s*[A-Z]{0,3}\d+$/i.exec(t);
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
      return { ordem: idx, mudou: false, claro: false };
    }
    const mudou = melhor - nota(0) >= MARGEM_FOTO;
    const primeiro = mudou ? notas.find((i) => nota(i) >= melhor - EMPATE_FOTO) : 0;
    const resto = idx.filter((i) => i !== primeiro).sort((a, b) => nota(b) - nota(a) || a - b);
    // `claro`: o 1º ganhou de TODOS os outros com folga — a foto decidiu. Sem
    // folga (mesma arte, foil ou carimbo diferente), a lista da sessão marca
    // a carta pra conferir.
    const claro = nota(primeiro) - (resto.length ? nota(resto[0]) : -Infinity) >= MARGEM_FOTO;
    return { ordem: [primeiro].concat(resto), mudou, claro };
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
  //
  // SEM o `fallback` do cardImageSources fora do Pokémon (2026-11-10): ele é
  // um palpite de URL no pokemontcg.io montado com set e número
  // ("…/12/71.png"), que pra carta de outro jogo aponta — quando aponta — pra
  // um POKÉMON qualquer, e o pokemontcg.io manda CORS aberto. Na grade isso é
  // só uma imagem errada de último recurso; aqui virava a REFERÊNCIA: a
  // miniatura do Lorcast não tem CORS, o palpite carregava, e a foto de uma
  // carta do Lorcana lida certo era comparada com um Pokémon. Enquanto a foto
  // só desempatava versões, ninguém via; como verificador, derrubava a
  // leitura certa.
  const comSx = (u) => u + (u.indexOf("?") >= 0 ? "&" : "?") + "sx=1";
  function urlsDaCarta(card, game) {
    const src = shared.cardImageSources(card);
    if (!src.url || !shared.cardImgChain) return [];
    const pokemon = (game || card.game || "pokemon") === "pokemon";
    const c = shared.cardImgChain(src.url, { thumb: true, fallback: pokemon ? src.fallback : "" });
    const urls = [c.src].concat(c.chain || []).filter((u) => u && !/^data:/.test(u) && (pokemon || !/\/\/images\.pokemontcg\.io\//.test(u)));
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
  // Assinaturas do QUADRO (os recortes onde a carta pode estar), uma vez por
  // leitura: a mesma foto é comparada com os resultados de várias tentativas
  // (candidatos, jogos, vizinhos). [] sem canvas.
  //
  // Mais a carta ENDIREITADA, quando ela é achada no quadro (acharCarta): os
  // recortes da grade são retângulos de pé, e a assinatura — uma grade 16×22
  // — perde semelhança com a carta torta (a ±5° os cantos andam 8 % da
  // largura). `carta`: os cantos em px da fonte, ou null.
  function fotosDoQuadro(fonte, rec, carta) {
    let fotos = [];
    try { fotos = assinaturasDoQuadro(pixelsDe(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 128), rec.galeria ? RECORTES_GALERIA : RECORTES_CAMERA); }
    catch (e) { fotos = []; }
    if (carta) {
      try {
        const c = endireitar(fonte, carta, 0, 0, 1, 1, 112);
        const ii = integral(c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        const a = assinatura(ii, 0, 0, ii.w, ii.h);
        if (a) fotos.push(a);
      } catch (e) { /* sem canvas: ficam os recortes da grade */ }
    }
    return fotos;
  }
  // A carta do quadro (acharCarta), em px da FONTE: [TL, TR, BR, BL] ou null.
  // A amostra é o recorte da moldura reduzido a 150 px de largura, pela
  // metade de cada vez (a redução de uma vez só pula pixels e cria borda
  // falsa). Na galeria a foto é livre: a faixa de procura é maior.
  function cartaNoQuadro(fonte, rec) {
    try {
      let src = fonte, x = rec.sx, y = rec.sy, w = rec.sw, h = rec.sh;
      while (w > 300) {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w / 2));
        c.height = Math.max(1, Math.round(h / 2));
        c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
        src = c; x = 0; y = 0; w = c.width; h = c.height;
      }
      const c = document.createElement("canvas");
      c.width = 150;
      c.height = Math.max(1, Math.round((150 * h) / w));
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
      const r = acharCarta(cinzaDe(ctx.getImageData(0, 0, c.width, c.height).data), c.width, c.height, rec.galeria ? 0.3 : 0.22);
      if (!r) return null;
      const k = rec.sw / c.width;
      return r.cantos.map((p) => [rec.sx + (p[0] + 0.5) * k, rec.sy + (p[1] + 0.5) * k]);
    } catch (e) { return null; }
  }
  // Região da carta (frações u, v dos lados dela; 0-1 é a carta inteira)
  // desenhada de pé num canvas com `largura` px: a transformação afim que
  // leva TL, TR e BL aos cantos do canvas. Corrige giro, escala e deslocamento
  // (a perspectiva de quem fotografa de cima é pequena e fica).
  function endireitar(fonte, cantos, u0, v0, u1, v1, largura) {
    const TL = cantos[0], TR = cantos[1], BL = cantos[3];
    const ex = [TR[0] - TL[0], TR[1] - TL[1]], ey = [BL[0] - TL[0], BL[1] - TL[1]];
    const W = Math.max(8, Math.round(largura));
    const H = Math.max(8, Math.round((largura * (v1 - v0) * Math.hypot(ey[0], ey[1])) / ((u1 - u0) * Math.hypot(ex[0], ex[1]))));
    // fonte = O + (X/W)·(u1−u0)·ex + (Y/H)·(v1−v0)·ey; o canvas quer a inversa.
    const O = [TL[0] + u0 * ex[0] + v0 * ey[0], TL[1] + u0 * ex[1] + v0 * ey[1]];
    const a = ((u1 - u0) * ex[0]) / W, b = ((u1 - u0) * ex[1]) / W, c2 = ((v1 - v0) * ey[0]) / H, d = ((v1 - v0) * ey[1]) / H;
    const det = a * d - b * c2;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const ia = d / det, ib = -b / det, ic = -c2 / det, id = a / det;
    ctx.setTransform(ia, ib, ic, id, -(ia * O[0] + ic * O[1]), -(ib * O[0] + id * O[1]));
    ctx.drawImage(fonte, 0, 0);
    return c;
  }
  // Assinatura da miniatura de uma carta, guardada pela sessão da página: quem
  // abre booster lê o mesmo set a noite inteira, e os vizinhos de um código
  // são quase sempre cartas que já passaram. 4 KB por carta, com teto. Uma
  // miniatura que não chegou a tempo NÃO fica guardada como falha: a próxima
  // leitura tenta de novo.
  // PRAZO_FOTO: por comparação. ORCAMENTO_FOTO: por LEITURA — a busca agora
  // compara em várias tentativas, e sem um teto no total uma rede que não
  // entrega miniatura seguraria o resultado por um prazo inteiro a cada uma.
  const PRAZO_FOTO = 2500, ORCAMENTO_FOTO = 4500;
  const TETO_REFS = 1200;
  const refs = new Map(); // 1ª URL da carta -> Promise<Float32Array|null>
  function assinaturaDaCarta(h, ate) {
    const urls = urlsDaCarta(h.card, h.game);
    if (!urls.length) return Promise.resolve(null);
    const k = urls[0];
    if (!refs.has(k)) {
      if (refs.size >= TETO_REFS) refs.delete(refs.keys().next().value);
      const pr = carregarImagem(urls, ate).then((im) => {
        if (!im) { refs.delete(k); return null; }
        try {
          const ii = pixelsDe(im, 0, 0, im.naturalWidth || im.width, im.naturalHeight || im.height, 112);
          return assinatura(ii, 0, 0, ii.w, ii.h);
        } catch (e) { return null; } // canvas sujo (sem CORS) ou imagem quebrada
      });
      refs.set(k, pr);
    }
    // Quem pede com prazo não espera além dele o download que outro começou.
    return Promise.race([refs.get(k), new Promise((ok) => setTimeout(() => ok(null), Math.max(0, ate - Date.now())))]);
  }
  // Semelhança de cada resultado ({ card, game }) com a foto (a melhor entre
  // os recortes do quadro); null pra carta cuja miniatura não chegou.
  async function semelhancas(fotos, hs, ate) {
    return Promise.all(hs.map(async (h) => {
      const ref = await assinaturaDaCarta(h, ate);
      return ref ? Math.max.apply(null, fotos.map((f) => semelhanca(f, ref))) : null;
    }));
  }
  // Reordena `achados` (no lugar) pela semelhança com a foto e devolve
  // { mudou, claro, melhor, notas }: se o 1º mudou, se a foto decidiu com
  // folga, a maior semelhança (null sem imagem nenhuma) e a de cada um, na
  // ordem nova. O prazo é curto porque a pessoa está esperando o resultado:
  // imagem que não chega a tempo só fica sem nota, e a ordem da busca vale
  // pra ela. Nada da foto sai do aparelho — o que desce são as miniaturas do
  // catálogo. `fotos`: as assinaturas do quadro (fotosDoQuadro).
  async function conferirPelaFoto(fotos, achados, ate) {
    const lista = achados.slice(0, 8);
    if (!fotos || !fotos.length || !lista.length) return { mudou: false, claro: false, melhor: null, notas: [] };
    const sims = await semelhancas(fotos, lista, Math.min(ate || Infinity, Date.now() + PRAZO_FOTO));
    const { ordem, mudou, claro } = ordemPelaFoto(sims);
    achados.splice(0, lista.length, ...ordem.map((i) => lista[i]));
    const notas = ordem.map((i) => sims[i]);
    const numeros = notas.filter((x) => typeof x === "number");
    return { mudou, claro, melhor: numeros.length ? Math.max.apply(null, numeros) : null, notas };
  }

  // ── Leitura AUTOMÁTICA (funções PURAS; testadas em tests/scan-continuo.test.mjs) ──
  // O ManaBox lê sem disparador: a carta entra no quadro, é lida, vem a
  // próxima — há suporte impresso em 3D vendido só pra esse fluxo. Aqui, um
  // laço leve (~8 quadros/s) mede o recorte da moldura reduzido a 48×66 e
  // decide quando ler: a imagem PARADA por alguns quadros seguidos, com luz e
  // com conteúdo (contraste: não é a mesa lisa). Depois de ler, só volta a ler
  // quando a cena MUDA (a carta saiu ou trocou) — senão a mesma carta seria
  // lida de novo a cada segundo. Pra repetir a mesma carta (segunda cópia),
  // o disparador continua lendo na hora.
  //
  // Medidas de uma amostra em tons de cinza (`g`, w×h), contra a anterior:
  // brilho (média 0-255), reflexo (fração de pixel estourado), contraste
  // (desvio padrão) e movimento (diferença média pra amostra anterior). Sem
  // anterior, o movimento é NaN: nem parada NEM mudança de cena. Com 255 ali,
  // a primeira amostra do laço contava como "a carta trocou" — e a carta lida
  // no toque, antes de o laço começar, era lida de novo por ele.
  function medirQuadro(g, w, h, ant) {
    const n = w * h;
    let soma = 0, soma2 = 0, estourado = 0, dif = 0;
    for (let i = 0; i < n; i++) {
      const v = g[i];
      soma += v; soma2 += v * v;
      if (v >= 250) estourado++;
      if (ant) dif += Math.abs(v - ant[i]);
    }
    const brilho = soma / n;
    return {
      brilho,
      reflexo: estourado / n,
      contraste: Math.sqrt(Math.max(0, soma2 / n - brilho * brilho)),
      movimento: ant && ant.length === n ? dif / n : NaN
    };
  }
  // Limiares do disparo, em unidades de cinza da amostra. PARADA: diferença
  // média abaixo de 5 (o tremor de quem segura a carta na mão fica abaixo
  // disso numa amostra tão pequena); MUDOU: acima de 14 (tirar ou trocar a
  // carta mexe metade do quadro). Conteúdo: contraste acima de 18 (mesa lisa,
  // tela preta e dedo na frente ficam abaixo). Luz: brilho acima de 40.
  // `semCarta` (2026-11-10): sem CARTA achada no quadro (acharCarta), o disparo
  // espera esse tanto de amostras paradas em vez de três. O "tem conteúdo" de
  // antes era só contraste, e toalha estampada, tapete de jogo e a mão
  // parada passavam: o laço gastava uma leitura inteira (até oito passadas
  // de OCR) pra dizer "afaste um pouco". Não vira proibição porque carta de
  // borda escura em mesa escura às vezes não é achada, e ali a leitura ainda
  // tem de sair sozinha — só demora ~1,5 s.
  const AUTO = { quadros: 3, parada: 5, mudou: 14, contraste: 18, brilho: 40, intervalo: 120, semCarta: 12 };
  // Um passo da máquina de estados: `st` é { armado, parados }. Armado, conta
  // amostras paradas e boas; na terceira seguida, dispara e desarma. Desarmado
  // (acabou de ler), espera a cena mudar pra armar de novo.
  function passoAuto(st, m, cfg) {
    const c = cfg || AUTO;
    if (!st.armado) return { st: { armado: m.movimento > c.mudou, parados: 0 }, disparar: false };
    const boa = m.movimento < c.parada && m.contraste > c.contraste && m.brilho > c.brilho;
    const parados = boa ? st.parados + 1 : 0;
    // `m.carta`: false = procurou e não achou carta no quadro; sem o campo
    // (quem chama não procura), vale a regra de sempre.
    const precisa = m.carta === false ? Math.max(c.quadros, c.semCarta || c.quadros) : c.quadros;
    if (parados >= precisa) return { st: { armado: false, parados: 0 }, disparar: true };
    return { st: { armado: true, parados }, disparar: false };
  }
  // Dica ao vivo pelo quadro, antes de ler: pouca luz ou reflexo (é o que
  // mais derruba o OCR, e a pessoa corrige na hora). "" quando está tudo bem.
  function dicaDoQuadro(m) {
    if (m.brilho < AUTO.brilho) return "scan.hint.dark";
    if (m.reflexo > 0.04) return "scan.hint.glare";
    return "";
  }
  // Variante que entra na lista pela preferência da sessão (o "preferir foil"
  // do ManaBox, e o reverse de quem separa os reverses do Pokémon). A carta
  // que não tem a preferida entra na variante padrão dela.
  function varianteDe(variantes, pref) {
    const vs = variantes && variantes.length ? variantes : ["Normal"];
    const acha = (re, nao) => vs.find((v) => re.test(v) && !(nao && nao.test(v)));
    if (pref === "reverse") return acha(/reverse/i) || vs[0];
    if (pref === "foil") return acha(/foil|holo|etched/i, /reverse/i) || vs[0];
    return vs[0];
  }

  // ── ACHAR A CARTA NO QUADRO (função PURA; testada em tests/scan-carta.test.mjs) ──
  // Até 2026-11-10 o scanner nunca soube onde a carta estava: todo recorte era
  // uma fração da MOLDURA ("os 18 % de baixo"), e a moldura dispensava detecção
  // de contorno (o OpenCV.js pesa 8 MB). Mas a carta fica ENTRE as duas
  // molduras, menor, deslocada e torta: no laboratório de OCR (139 cartas, foto
  // simulada) a passada que mais lia código era a da carta INTEIRA (42), não a
  // do rodapé (35) — porque o rodapé da moldura cortava o código da carta que
  // estava 10 % menor, e 2° de inclinação já tiram a linha do eixo.
  //
  // Aqui a carta é achada por quatro RETAS, uma por lado, sem biblioteca: numa
  // amostra pequena em cinza (~150 px de largura), cada lado procura, numa
  // faixa da borda do quadro, as retas (posição + inclinação de até 8°) com
  // resposta de borda. A resposta soma o gradiente por TRECHOS da reta e toma
  // o módulo de cada trecho: borda de carta tem o mesmo sinal por um bom
  // pedaço (carta clara, mesa escura), textura de mesa e de arte se cancela.
  //
  // A reta mais FORTE de um lado quase nunca é a borda da carta: é a moldura
  // impressa dela (a borda preta contra o miolo claro contrasta mais que a
  // borda preta contra a mesa). Quem separa as duas é a GEOMETRIA: de cada
  // lado ficam até quatro picos, e vale a combinação de quatro retas com
  // lados opostos paralelos, vizinhos perpendiculares e a proporção de uma
  // carta (63×88) — a MAIOR delas, porque a borda está sempre por fora da
  // moldura. Sem combinação válida devolve null e tudo segue pela moldura-
  // guia, como antes.
  //
  // `g`: cinza 0-255 (w×h). `faixa`: fração de cada lado onde a borda pode
  // estar (0,22 na câmera, onde a carta fica entre as molduras; maior na
  // galeria, foto livre). Devolve { cantos: [TL, TR, BR, BL] em px da amostra,
  // angulo (graus, horário), forca } ou null.
  const CARTA = { angMax: 8, trechos: 8, corte: 0.3, forcaMin: 7, picos: 3, proporcao: 63 / 88, folga: 0.07 };
  function acharCarta(g, w, h, faixa) {
    if (!g || w < 24 || h < 32) return null;
    const fx = Math.max(3, Math.round(w * (faixa || 0.22))), fy = Math.max(3, Math.round(h * (faixa || 0.22)));
    const tans = [];
    for (let a = -CARTA.angMax; a <= CARTA.angMax; a++) tans.push(Math.tan((a * Math.PI) / 180));
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    // Resposta de uma reta "em pé" (x = p0 + k·(y − cy)) ou "deitada"
    // (y = p0 + k·(x − cx)), no miolo de 56 % do lado (os cantos são
    // arredondados e pertencem a duas bordas). Sai em DUAS partes, pelo
    // sinal do degrau: a borda da carta (mesa -> borda) e a moldura impressa
    // (borda -> miolo) quase sempre têm sinais opostos, e a 150 px de amostra
    // ficam a 3-5 px uma da outra — somadas em módulo viravam uma rampa só,
    // sem pico na borda de fora.
    const resposta = (emPe, p0, k) => {
      const n = emPe ? h : w, ini = Math.round(n * 0.22), fim = Math.round(n * 0.78);
      const passo = Math.max(1, Math.floor((fim - ini) / CARTA.trechos));
      let mais = 0, menos = 0, cont = 0;
      for (let t0 = ini; t0 < fim; t0 += passo) {
        let s = 0, m = 0;
        for (let t = t0; t < Math.min(fim, t0 + passo); t++) {
          const q = Math.round(p0 + k * (t - (emPe ? cy : cx)));
          if (emPe) { if (q < 1 || q > w - 2) continue; s += g[t * w + q + 1] - g[t * w + q - 1]; }
          else { if (q < 1 || q > h - 2) continue; s += g[(q + 1) * w + t] - g[(q - 1) * w + t]; }
          m++;
        }
        if (m) { if (s > 0) mais += s; else menos -= s; cont += m; }
      }
      return cont ? [mais / cont, menos / cont] : [0, 0];
    };
    // Os picos de um lado, da borda do quadro pra dentro (`deFora`), de cada
    // sinal em separado.
    const lado = (emPe, deFora) => {
      const perfis = [[], []];
      deFora.forEach((p0) => {
        const melhor = [{ p0, k: 0, r: 0 }, { p0, k: 0, r: 0 }];
        for (const k of tans) {
          const v = resposta(emPe, p0, k);
          for (let z = 0; z < 2; z++) if (v[z] > melhor[z].r) { melhor[z].r = v[z]; melhor[z].k = k; }
        }
        perfis[0].push(melhor[0]);
        perfis[1].push(melhor[1]);
      });
      const max = Math.max(perfis[0].reduce((a, x) => Math.max(a, x.r), 0), perfis[1].reduce((a, x) => Math.max(a, x.r), 0));
      const piso = Math.max(CARTA.forcaMin, CARTA.corte * max);
      const picos = [];
      // Pico = o maior a dois pixels de cada lado: uma reta um pouco torta
      // que cruza a borda de verdade também responde, e viraria "outra reta"
      // colada nela.
      perfis.forEach((m) => {
        let n = 0;
        for (let i = 0; i < m.length && n < CARTA.picos; i++) {
          if (m[i].r < piso) continue;
          let topo = true;
          for (let j = Math.max(0, i - 2); j <= Math.min(m.length - 1, i + 2); j++) {
            if (j !== i && (m[j].r > m[i].r || (m[j].r === m[i].r && j < i))) { topo = false; break; }
          }
          if (topo) { picos.push(m[i]); n++; }
        }
      });
      return picos;
    };
    const faixaDe = (ini, n, sentido) => Array.from({ length: n }, (_, i) => ini + sentido * i);
    const Es = lado(true, faixaDe(1, fx, 1)), Ds = lado(true, faixaDe(w - 2, fx, -1));
    const Ts = lado(false, faixaDe(1, fy, 1)), Bs = lado(false, faixaDe(h - 2, fy, -1));
    // Interseção de uma reta em pé com uma deitada:
    //   x = pe.p0 + pe.k (y − cy);  y = dt.p0 + dt.k (x − cx)
    const cruza = (pe, dt) => {
      const y = (dt.p0 + dt.k * (pe.p0 - pe.k * cy - cx)) / (1 - dt.k * pe.k);
      return [pe.p0 + pe.k * (y - cy), y];
    };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Lados opostos QUASE paralelos: o celular inclinado uns graus sobre a
    // carta já faz os lados convergirem (perspectiva), e exigir paralelismo
    // de régua recusava a carta de verdade.
    const tolPar = Math.tan((6 * Math.PI) / 180), tol = Math.tan((4 * Math.PI) / 180);
    let melhor = null;
    for (const E of Es) for (const D of Ds) {
      if (Math.abs(E.k - D.k) > tolPar) continue;
      for (const T of Ts) for (const B of Bs) {
        if (Math.abs(T.k - B.k) > tolPar) continue;
        // Vizinhos perpendiculares: num retângulo girado, a inclinação das
        // retas em pé é o OPOSTO da das deitadas.
        const kDeit = (T.k + B.k) / 2;
        if (Math.abs((E.k + D.k) / 2 + kDeit) > tol) continue;
        const cantos = [cruza(E, T), cruza(D, T), cruza(D, B), cruza(E, B)];
        // A carta inteira cabe no quadro (com 3 % de folga pro arredondamento).
        if (cantos.some((p) => p[0] < -0.03 * w || p[0] > 1.03 * w || p[1] < -0.03 * h || p[1] > 1.03 * h)) continue;
        const larg = (dist(cantos[0], cantos[1]) + dist(cantos[3], cantos[2])) / 2;
        const alt = (dist(cantos[0], cantos[3]) + dist(cantos[1], cantos[2])) / 2;
        if (!(larg > w * 0.45) || !(alt > 0)) continue;
        const prop = larg / alt;
        if (prop < CARTA.proporcao * (1 - CARTA.folga) || prop > CARTA.proporcao * (1 + CARTA.folga)) continue;
        const area = larg * alt;
        if (!melhor || area > melhor.area) melhor = { cantos, area, angulo: (Math.atan(kDeit) * 180) / Math.PI, forca: Math.min(E.r, D.r, T.r, B.r) };
      }
    }
    return melhor ? { cantos: melhor.cantos, angulo: melhor.angulo, forca: melhor.forca } : null;
  }

  // ── Captura e diagnóstico (funções PURAS; testadas em tests/scan-captura.test.mjs) ──
  // Cinza (luminância) de um RGBA de canvas, com o mesmo peso do preparar().
  function cinzaDe(d) {
    const g = new Uint8Array(d.length / 4);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    return g;
  }
  // NITIDEZ de uma amostra em cinza (w×h): a média do quadrado do laplaciano
  // de 4 vizinhos. Borda de glifo nítida é um salto grande entre vizinhos; o
  // tremor da mão e o foco ainda procurando espalham o salto, e o número cai.
  // Depende do conteúdo, então só serve pra COMPARAR quadros da mesma cena —
  // que é o que a rajada do disparo faz (lerAgora).
  function nitidez(g, w, h) {
    let s = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
        const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        s += l * l;
        n++;
      }
    }
    return n ? s / n : 0;
  }
  // REALCE LOCAL (2026-11-10): cada pixel contra a média da vizinhança, e não
  // contra o recorte inteiro. O preparo de sempre estica o contraste do
  // rodapé todo de uma vez — e metade dos jogos imprime o código CLARO numa
  // faixa escura (One Piece, DBFW, Riftbound, o rodapé preto do Magic e do
  // SWU), ao lado de arte e borda claras: o limiar global do Tesseract fica
  // com a arte e perde a faixa. Com `claro`, o texto claro sai ESCURO sobre
  // fundo claro e uniforme, que é como o motor lê melhor. No laboratório (139
  // cartas reais, foto simulada), a passada do rodapé lia 35 códigos; a
  // mesma com realce de texto claro lia outros 11 que ela não lia.
  // `g`: cinza (w×h); devolve o cinza tratado. `raio`: meia janela da média.
  function realcarLocal(g, w, h, raio, claro) {
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s; }
    }
    const out = new Uint8ClampedArray(w * h), sinal = claro ? -1 : 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - raio), y1 = Math.min(h, y + raio + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - raio), x1 = Math.min(w, x + raio + 1);
        const media = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
        // Fundo em cinza-claro (200) e o desvio ampliado 4×: o que é mais
        // escuro que a vizinhança (ou mais claro, com `claro`) vira tinta.
        out[y * w + x] = 200 + sinal * (g[y * w + x] - media) * 4;
      }
    }
    return out;
  }
  // PLANO DAS PASSADAS de uma leitura: que recorte, em que escala e com que
  // tratamento, na ordem. Cada uma é [nome, fx, fy, fw, fh, largura, modo,
  // origem] — frações da moldura; `modo` "" (contraste esticado), "claro" ou
  // "escuro" (realce local); `origem` é a pista de onde o código foi lido.
  //
  // A ordem veio do laboratório: até 2026-11-10 eram seis passadas do mesmo
  // tratamento (rodapé em duas escalas, dois cantos, faixa, carta inteira) e
  // elas liam, juntas, 60 de 139 códigos. Trocar as redundantes por outra
  // POLARIDADE e outra ESCALA lê 69 com as mesmas seis, 73 com oito — cada
  // carta sai num par escala/tratamento diferente, porque o Tesseract é
  // sensível ao tamanho do glifo e ao que o limiar dele escolhe como fundo.
  // Na frente, os três tratamentos do rodapé (baratos: ~1/4 do tempo da carta
  // inteira cada); a carta inteira vem no meio — sozinha é a passada que mais
  // lê (42), só que custa quatro das outras. Na bancada, metade das cartas
  // certas sai na primeira passada. O jogo que imprime o código no ALTO
  // (Gundam) começa pelo topo quando já se sabe que é ele.
  const PASSADAS = [
    ["rodape", 0, 1 - RODAPE, 1, RODAPE, 1400, "", "base"],
    ["rodape-claro", 0, 1 - RODAPE, 1, RODAPE, 1800, "claro", "base"],
    ["rodape-escuro", 0, 1 - RODAPE, 1, RODAPE, 1400, "escuro", "base"],
    ["canto-topo", 1 - CANTO, 0, CANTO, RODAPE, 1400, "", "topo"],
    ["carta", 0, 0, 1, 1, 1400, "", ""],
    ["rodape-2", 0, 1 - RODAPE, 1, RODAPE, 2400, "", "base"],
    ["rodape-claro-2", 0, 1 - RODAPE, 1, RODAPE, 2400, "claro", "base"],
    ["topo-claro", 0, 0, 1, RODAPE, 1400, "claro", "topo"]
  ];
  function planoDasPassadas(jogo) {
    if (jogo !== "gundam") return PASSADAS;
    const topo = PASSADAS.filter((p) => p[7] === "topo");
    return topo.concat(PASSADAS.filter((p) => p[7] !== "topo"));
  }
  // Relatório do DIAGNÓSTICO em texto — o que a pessoa copia e cola pra
  // contar um erro. Uma linha por etapa, com identificadores curtos do código
  // (é log, não frase de interface: título, botão e aviso passam pelo i18n).
  // `dg` é montado pelo ler(); campo ausente vira "?" e a linha some.
  function relatorio(dg) {
    if (!dg) return "";
    const n = (x, k) => (typeof x === "number" && isFinite(x) ? x.toFixed(k || 0) : "?");
    const dim = (a) => (a && a.length === 2 ? `${n(a[0])}x${n(a[1])}` : "?");
    const L = [];
    L.push(`sleevu scan · ${new Date(dg.t || 0).toISOString().slice(0, 19).replace("T", " ")} · ${dg.modo || "?"}`);
    L.push(`fonte ${dim(dg.fonte)} · carta ${dim(dg.rec)}${dg.carta ? ` (${dg.carta})` : ""} · foco ${dg.poi || "padrao"}`);
    const q = dg.quadros || [];
    if (q.length) {
      const m = q[dg.escolhido] || q[0];
      L.push(`quadros nitidez ${q.map((x, i) => n(x.nitidez) + (i === dg.escolhido ? "*" : "")).join(" ")} · luz ${n(m.brilho)} · reflexo ${n(m.reflexo * 100, 1)}%`);
    }
    (dg.passos || []).forEach((p, i) => {
      L.push(`#${i + 1} ${p.nome} ${p.w}x${p.h} ${n(p.ms)}ms`);
      const tx = String(p.texto || "").trim();
      L.push(tx ? tx.split("\n").map((l) => `   | ${l}`).join("\n") : "   | -");
      L.push(`   -> ${(p.cands || []).map((c) => `${c.codigo} p${c.peso} c${n(c.conf)}`).join(", ") || "-"}`);
    });
    const j = dg.jogo;
    if (j) {
      const pts = Object.keys(j.pontos || {}).sort((a, b) => j.pontos[b] - j.pontos[a]).map((g) => `${g}:${j.pontos[g]}`).join(" ");
      L.push(`jogo ${pts || "-"}${j.confiante ? " !" : ""} · busca ${(j.busca || []).join(",") || "*"}${j.trava ? ` · trava ${j.trava}` : ""}`);
    }
    const b = dg.busca;
    if (b) L.push(`achou ${b.codigo || "-"} -> ${b.n}${b.cartas && b.cartas.length ? ` · ${b.cartas.join(" | ")}` : ""}`);
    const f = dg.foto;
    if (f) L.push(`foto ${f.mudou ? "mudou" : "manteve"}${f.claro ? " claro" : ""}${f.estado ? ` · ${f.estado}` : ""}${f.corrigido ? " corrigido" : ""}${f.arte ? " pela-arte" : ""}${f.negou ? " negou" : ""}${f.notas && f.notas.length ? ` · ${f.notas.map((x) => n(x, 2)).join(" ")}` : ""}`);
    (dg.reparos || []).forEach((r) => L.push(`reparo ${r || "-"}`));
    if (dg.erro) L.push(`erro ${dg.erro}`);
    if (typeof dg.ms === "number") L.push(`total ${n(dg.ms)}ms`);
    return L.join("\n");
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
    let etapa = "tesseract.min.js"; // a última fase que o motor anunciou
    const pronto = (async () => {
      await carregarScript(BASE + "tesseract.min.js");
      etapa = "worker";
      const T = window.Tesseract;
      const criar = (core) => T.createWorker("eng", T.OEM.LSTM_ONLY, {
        workerPath: BASE + "worker.min.js",
        corePath: BASE + core,
        langPath: BASE.replace(/\/$/, ""),
        workerBlobURL: MOTOR_DE_FORA, // no site, por URL: worker-src 'self' sem blob:
        gzip: true,
        logger: (m) => {
          if (!m || !m.status) return;
          etapa = m.status;
          if (status) status(m.status, m.progress);
        }
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
    let relogio = null;
    const prazo = new Promise((_, falha) => {
      relogio = setTimeout(() => falha(new Error(`leitor sem resposta em ${PRAZO_MOTOR / 1000} s`)), PRAZO_MOTOR);
    });
    workerPromise = Promise.race([pronto, prazo]).finally(() => clearTimeout(relogio));
    workerPromise.catch((e) => {
      workerPromise = null; // deixa tentar de novo
      // Pro rastreio de erros (theme.js → /admin): sem isto a falha do motor
      // morria no catch da leitura, e do app não dava pra saber onde parou.
      if (window.__sleevuErroPoe) window.__sleevuErroPoe({ k: "promise", m: `scanner: ${(e && e.message) || e} (etapa: ${etapa}; motor: ${ORIGEM_MOTOR})` });
    });
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
  // `modo`: "" estica o contraste (abaixo); "claro" e "escuro" passam pelo
  // realce local (realcarLocal), pro texto claro em faixa escura e pro texto
  // escuro em fundo desigual.
  function preparar(fonte, sx, sy, sw, sh, largura, modo) {
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
    if (modo === "claro" || modo === "escuro") {
      // Janela de ~1 glifo: a 1400-2400 px de largura o código tem 30-50 px.
      const t = realcarLocal(cinza, c.width, c.height, 24, modo === "claro");
      for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = t[j];
      ctx.putImageData(img, 0, 0);
      return c;
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
  function recorte(fonte, rec, fx, fy, fw, fh, largura, modo) {
    return preparar(fonte, rec.sx + rec.sw * fx, rec.sy + rec.sh * fy, rec.sw * fw, rec.sh * fh, largura, modo);
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
/* Segurar o disparador liga o diagnóstico (2026-11-01): sem o menu do toque longo nem seleção. */
.scan-shutter { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.scan-lote { height: 44px; min-height: 0; flex: none; padding: 0 14px 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(13,14,18,.62); color: #f3f5f7; font: inherit; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.scan-lote.is-vazio { visibility: hidden; }
/* Leitura automática e lista da sessão (2026-09-28) — o "modo ManaBox": a
   carta entra no quadro, é lida sozinha e vai pra lista; a pessoa revisa e
   adiciona tudo de uma vez. O botão da leitura automática mora ao lado da
   galeria; a lista abre pelo botão da direita, com contagem e total. */
.scan-bottom-esq { display: flex; align-items: center; gap: 6px; }
.scan-round[aria-pressed="true"] { background: rgba(255,255,255,.2); border-color: rgba(255,255,255,.45); }
.scan-lote-t { white-space: nowrap; font-variant-numeric: tabular-nums; }
.scan-lista-prefs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.scan-field select { flex: 1; min-width: 0; height: 40px; padding: 0; border: 0; background: none; color: #f3f5f7; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }
.scan-field select option { background: #1d212b; color: #f3f5f7; }
.scan-itens { display: flex; flex-direction: column; gap: 8px; }
.scan-itens:empty { display: none; }
.scan-item { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px; border: 1px solid #2d333f; border-radius: 12px; background: #1d212b; }
.scan-item.is-conferir { border-color: rgba(245,179,1,.6); }
.scan-item-thumb { width: 40px; height: 56px; border-radius: 5px; overflow: hidden; background: #262b36; }
.scan-item-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scan-item-txt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.scan-item-nome { font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-item-sub { font-size: 12px; color: #9ba4b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-item-linha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; font-size: 12.5px; }
.scan-item-preco { font-weight: 800; color: #7ee2b8; }
.scan-item-ok { display: inline-flex; align-items: center; gap: 4px; color: #7ee2b8; font-weight: 700; }
.scan-item-ok svg { width: 13px; height: 13px; }
.scan-item-conf { min-height: 44px; padding: 0 12px; border: 1px solid rgba(245,179,1,.6); border-radius: 999px; background: transparent; color: #f5c542; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.scan-item-qtd { display: flex; align-items: center; }
.scan-item-qtd button { width: 44px; height: 44px; min-height: 0; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-item-qtd button svg { width: 18px; height: 18px; }
.scan-item-qtd span { min-width: 20px; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
.scan-lista-acoes { display: flex; gap: 8px; }
.scan-lista-acoes .cta { display: block; flex: 1; min-width: 0; min-height: 46px; line-height: 46px; text-align: center; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 0; cursor: pointer; }
.scan-lista-acoes .cta[disabled] { opacity: .5; cursor: default; }
.scan-lista-limpar { flex: none; min-height: 46px; padding: 0 14px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.scan-lista-limpar.is-confirma { border-color: #f87171; color: #fca5a5; }
.scan-lista-col { align-self: center; min-height: 44px; display: inline-flex; align-items: center; color: var(--accent-ink, #ef4444); font-weight: 800; }
.scan-lista-col[hidden] { display: none; }
/* Por último, pra vencer as regras de cima. Até 359 px (iPhone SE de 320): os dois botões da esquerda em 44 px, a
   lista só com a contagem (o total está no topo da folha) e as duas
   preferências da lista uma embaixo da outra. */
@media (max-width: 359px) {
  .scan-bottom { padding: 0 12px; }
  .scan-bottom-esq .scan-round { width: 44px; height: 44px; }
  .scan-lote-t { display: none; }
  .scan-lista-prefs { grid-template-columns: minmax(0, 1fr); }
}
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
/* Leitura em DÚVIDA (2026-11-10): a foto não confirmou a carta que o código achou. Âmbar, como o "Conferir" da lista. */
.scan-res.is-duvida { border-color: rgba(245,179,1,.8); }
.scan-res-duv.is-so { margin-left: 0; }
.scan-res-duv { margin-left: 8px; padding: 1px 8px; border: 1px solid rgba(245,179,1,.6); border-radius: 999px; font-size: 11.5px; font-weight: 800; color: #f5c542; vertical-align: 1px; }
/* Painel do som: liga/desliga, as duas faixas na moeda do site e um botão pra ouvir cada aviso. */
.scan-som-liga { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 4px; color: #f3f5f7; font-size: 15px; font-weight: 700; cursor: pointer; }
.scan-som-liga input { width: 22px; height: 22px; margin: 0; flex: none; accent-color: var(--accent, #dc2626); }
.scan-som-faixas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.scan-som-faixas .scan-field input { text-transform: none; }
.scan-som-faixas .scan-field.is-erro { border-color: #f87171; }
.scan-som-testes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.scan-som-testes button { min-height: 44px; min-width: 0; padding: 0 6px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
/* Seletor de set da trava (2026-11-10): travar sem ter lido carta nenhuma — o caminho do jogo que não imprime código. O campo é nome de set, não código: sem a caixa alta do campo de código. */
.scan-sets-campo { flex: none; }
.scan-sets-campo input { text-transform: none; font-weight: 700; }
.scan-sets { display: flex; flex-direction: column; gap: 6px; }
.scan-sets:empty { display: none; }
.scan-set-op { min-height: 48px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; padding: 6px 12px; border: 1px solid #2d333f; border-radius: 10px; background: #1d212b; color: #f3f5f7; font: inherit; text-align: left; cursor: pointer; }
.scan-set-op strong { max-width: 100%; font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-set-op span { font-size: 12px; color: #9ba4b3; }
.scan-vazio { margin: 0; padding: 0 4px; font-size: 13px; color: #9ba4b3; line-height: 1.5; }
.scan-vazio[hidden] { display: none; }
.scan-vazio a { color: var(--accent-ink, #ef4444); font-weight: 700; }
.scan-priv { margin: 0; font-size: 11.5px; color: #8891a1; text-align: center; }
/* DIAGNÓSTICO (2026-11-01): o que o leitor viu em cada leitura — as fotos já
   tratadas que foram pro OCR, o texto lido, o jogo e a busca —, pra dizer no
   aparelho se o erro foi de luz, de leitura ou de catálogo. Tracejado ciano
   pra não se confundir com a interface de sempre. O botão fica no canto da
   moldura (posicionaGuia) e abre a folha. */
.scan-diag-btn { position: absolute; min-height: 44px; padding: 0 14px; border: 1px dashed rgba(0,229,255,.75); border-radius: 999px; background: rgba(13,14,18,.78); color: #9eeaf5; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.scan-diag-btn[hidden], .scan-diag[hidden] { display: none; }
.scan-diag { padding: 4px 10px 10px; border: 1px dashed rgba(0,229,255,.45); border-radius: 12px; }
.scan-diag > * + * { margin-top: 8px; }
.scan-diag summary { min-height: 44px; display: flex; align-items: center; color: #9eeaf5; font-size: 13.5px; font-weight: 800; cursor: pointer; }
.scan-diag pre { margin: 0; max-height: 42vh; overflow: auto; white-space: pre-wrap; word-break: break-word; color: #cfd6e2; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; -webkit-user-select: text; user-select: text; }
.scan-diag-imgs { display: flex; flex-direction: column; gap: 8px; }
.scan-diag-imgs:empty { display: none; }
.scan-diag-imgs figure { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.scan-diag-imgs canvas { display: block; max-width: 100%; height: auto; border-radius: 6px; }
.scan-diag-imgs figcaption { color: #8891a1; font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scan-diag .lst-mini { min-height: 44px; border-radius: 9px; background: #1d212b; border-color: #2d333f; color: #f3f5f7; }`;

  const ICO = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5L7 19"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="11" width="15" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>',
    cadeadoAberto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="11" width="15" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/></svg>',
    som: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    menos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
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
    wl: [[784, 0, 0.08], [988, 0.09, 0.08], [1175, 0.18, 0.08], [1568, 0.27, 0.22]],
    // Leitura que a foto não confirmou (2026-11-10): duas notas DESCENDO, o
    // contrário de todos os avisos de preço — quem tria sem olhar a tela
    // ouve que aquela carta é pra conferir.
    duvida: [[392, 0, 0.1], [294, 0.11, 0.16]]
  };
  // Vibração (Android; o iPhone não vibra pela web e o shared.vibrar cai no
  // toque do switch): mais pulsos quanto melhor a carta.
  const VIBRA = { "-1": 30, 0: 25, 1: [25, 60, 25], 2: [30, 60, 30, 60, 60], wl: [60, 40, 60, 40, 120], duvida: [90, 50, 90] };

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

  // `opc.set` ({ game, setId, set, lang }): já abre travado nesse set — quem
  // chama de dentro de um set sabe qual é.
  function abrir(opc) {
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
    let ultimasOrigens = {}; // código -> onde foi lido ("topo"/"base"), pista do jogo
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
    // `auto` (2026-09-28): leituras disparadas sozinhas, sem o toque no disparador.
    // `luz` (2026-11-01): leituras cuja foto escolhida tinha pouca luz ou
    // reflexo (o mesmo critério da dica ao vivo), e `luzOk` quantas dessas
    // acharam carta. Responde se o erro do scanner é da luz ou não: em campo
    // a suspeita era a luz, e nada no funil dizia.
    // `duv`, `corr`, `neg` (2026-11-10): a foto como VERIFICADOR de toda
    // leitura — quantas ficaram em dúvida (a foto não confirmou a carta),
    // quantas a foto corrigiu trocando o código por um vizinho, e em quantas
    // ela derrubou um resultado que a busca tinha dado.
    const funil = { n: 0, lido: 0, achou: 0, t0: Date.now(), t1: 0, amb: 0, vis: 0, troca: 0, dig: 0, auto: 0, luz: 0, luzOk: 0, duv: 0, corr: 0, neg: 0, arte: 0 };
    let emDuvida = false; // o resultado na tela não foi confirmado pela foto
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
      <button type="button" class="scan-diag-btn" data-scan-diag-abrir hidden>${escapeHtml(t("scan.diag.chip"))}</button>
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
        <span class="scan-bottom-esq">
          <label class="scan-round" aria-label="${escapeAttribute(t("scan.gallery"))}" title="${escapeAttribute(t("scan.gallery"))}">${ICO.image}<input type="file" accept="image/*" capture="environment" data-scan-file hidden></label>
          <button type="button" class="scan-round" data-scan-auto aria-pressed="false" aria-label="${escapeAttribute(t("scan.auto"))}" title="${escapeAttribute(t("scan.auto"))}">${ICO.auto}</button>
        </span>
        <button type="button" class="scan-shutter" data-scan-captura aria-label="${escapeAttribute(t("scan.capture"))}" title="${escapeAttribute(t("scan.capture"))}" disabled><span></span></button>
        <button type="button" class="scan-lote is-vazio" data-scan-lote><span class="scan-lote-n" data-scan-lote-n>0</span><span class="scan-lote-t" data-scan-lote-t>${escapeHtml(t("scan.list"))}</span>${ICO.arrow}</button>
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
        <details class="scan-diag" data-scan-diag open hidden>
          <summary>${escapeHtml(t("scan.diag.title"))}</summary>
          <pre data-scan-diag-txt></pre>
          <div class="scan-diag-imgs" data-scan-diag-imgs></div>
          <button type="button" class="lst-mini" data-scan-diag-copiar>${escapeHtml(t("scan.diag.copy"))}</button>
          <p class="scan-priv">${escapeHtml(t("scan.diag.private"))}</p>
        </details>
        <p class="scan-priv">${escapeHtml(t("scan.privacy"))}</p>
      </div>
      <div class="scan-sheet" data-scan-sets hidden>
        <div class="scan-sheet-handle"></div>
        <div class="scan-sheet-head"><strong>${escapeHtml(t("scan.sets.title"))}</strong></div>
        <label class="scan-field scan-sets-campo"><span>${escapeHtml(t("scan.sets.label"))}</span><input type="text" data-scan-sets-input autocomplete="off" spellcheck="false" placeholder="${escapeAttribute(t("scan.sets.search"))}"></label>
        <div class="scan-sets" data-scan-sets-lista></div>
        <p class="scan-vazio" data-scan-sets-vazio hidden>${escapeHtml(t("scan.sets.empty"))}</p>
        <p class="scan-priv">${escapeHtml(t("scan.sets.hint"))}</p>
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
      </div>
      <div class="scan-sheet" data-scan-lista hidden>
        <div class="scan-sheet-handle"></div>
        <div class="scan-sheet-head"><strong>${escapeHtml(t("scan.listTitle"))}</strong><span data-scan-lista-resumo></span></div>
        <div class="scan-lista-prefs">
          <label class="scan-field"><span>${escapeHtml(t("scan.listCond"))}</span><select data-scan-lista-cond>${(shared.CARD_CONDITIONS || ["NM"]).map((c) => `<option value="${escapeAttribute(c)}">${escapeHtml(c)}</option>`).join("")}</select></label>
          <label class="scan-field"><span>${escapeHtml(t("scan.listVariant"))}</span><select data-scan-lista-var><option value="padrao">${escapeHtml(t("scan.varDefault"))}</option><option value="foil">${escapeHtml(t("scan.varFoil"))}</option><option value="reverse">${escapeHtml(t("scan.varReverse"))}</option></select></label>
        </div>
        <div class="scan-itens" data-scan-itens></div>
        <p class="scan-vazio" data-scan-lista-vazio>${escapeHtml(t("scan.listEmpty"))}</p>
        <div class="scan-lista-acoes">
          <button type="button" class="cta" data-scan-lista-add></button>
          <button type="button" class="scan-lista-limpar" data-scan-lista-limpar>${escapeHtml(t("scan.listClear"))}</button>
        </div>
        <a class="scan-lista-col" href="collection" data-scan-lista-col hidden>${escapeHtml(t("scan.listSeeCollection"))}</a>
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
    // Leitura automática (ligada por padrão; a escolha é do aparelho) e as duas
    // dicas que ela traz: a do QUADRO ao vivo (pouca luz, reflexo) e a da
    // leitura automática que não achou código (afaste, evite reflexo).
    const CHAVE_AUTO = "tcg-scan-auto-v1";
    let autoLigado = (() => { try { return localStorage.getItem(CHAVE_AUTO) !== "0"; } catch (e) { return true; } })();
    let dicaQuadro = "", dicaFalha = "";
    const dizer = (msg) => { status.textContent = msg; dica.hidden = !msg; };
    let dicaArte = ""; // o set travado aprendendo as artes (progresso) ou pronto
    const pronto = () => dizer(dicaQuadro || dicaArte || (jaLeu ? (dicaFalha || sugestao) : t(autoLigado ? "scan.status.readyAuto" : "scan.status.ready")));
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
    const chaveSet = (h) => `${h.game}|${h.card.setId || h.card.set || ""}|${h.card.language || "en"}`;
    const nomeSet = (card) => card.set || card.setId || "";
    // Cartas do set, direto do chunk dele (o mesmo que a paleta baixa pra
    // busca por código): o manifest do jogo diz o arquivo. Em dev (sem
    // manifest), o catálogo inteiro do jogo da sessão já está na memória.
    async function cartasDoSet(tr) {
      const doSet = (x) => (tr.setId ? x.setId === tr.setId : x.set === tr.set) && (x.language || "en") === (tr.lang || "en");
      if (sessao === tr.game && Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) return window.TCG_CARDS.filter(doSet);
      const manifest = await manifestDe(tr.game);
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
    // `def`: { game, setId, set, lang } — de uma carta lida (travar) ou do
    // seletor de set (o jogo que não imprime código não tem "carta lida").
    function travarEm(def) {
      const tr = {
        game: def.game, setId: def.setId || "", set: def.set || "", lang: def.lang || "en",
        nome: def.set || def.setId || "", chave: `${def.game}|${def.setId || def.set || ""}|${def.lang || "en"}`
      };
      tr.cartas = cartasDoSet(tr).catch(() => null);
      trava = tr;
      sugestao = "";
      pintarTrava();
      aprenderSet(tr);
      if (!ocupado) pronto();
    }
    function travar(h) {
      const c = h.card;
      travarEm({ game: h.game, setId: c.setId || "", set: c.set || "", lang: c.language || "en" });
    }
    function destravar() {
      trava = null;
      recentes = [];
      dicaArte = "";
      clearTimeout(tmArte);
      pintarTrava();
      if (!ocupado) pronto();
    }
    // APRENDER AS ARTES do set travado: a assinatura da miniatura de cada
    // carta, seis de cada vez, enquanto a pessoa já vai lendo pelo código. O
    // que desce são as miniaturas que a página do set já mostraria (~20 KB
    // cada); com a economia de dados do aparelho ligada, não desce nada e o
    // set travado segue só pelo código. Para se a trava mudar ou o scanner
    // fechar.
    let tmArte = 0;
    function pintarArte(tr, fim) {
      if (trava !== tr) return;
      clearTimeout(tmArte);
      const a = tr.arte;
      if (!fim) dicaArte = t("scan.art.learning", { set: tr.nome, n: a.prontas, total: a.total });
      else if (a.sigs.length >= 2) {
        dicaArte = t("scan.art.ready", { set: tr.nome });
        tmArte = setTimeout(() => { dicaArte = ""; if (!ocupado) pronto(); }, 4000);
      } else dicaArte = "";
      if (!ocupado) pronto();
    }
    function aprenderSet(tr) {
      tr.arte = { total: 0, prontas: 0, sigs: [], fim: false };
      if (navigator.connection && navigator.connection.saveData) { tr.arte.fim = true; return; }
      tr.cartas.then(async (cartas) => {
        if (!cartas || trava !== tr) { tr.arte.fim = true; return; }
        tr.arte.total = cartas.length;
        let i = 0;
        const fila = async () => {
          while (i < cartas.length && trava === tr && wrap.isConnected) {
            const card = cartas[i++];
            let sig = null;
            try { sig = await assinaturaDaCarta({ card, game: tr.game }, Date.now() + 20000); } catch (e) { sig = null; }
            tr.arte.prontas += 1;
            if (sig) tr.arte.sigs.push({ card, sig });
            if (tr.arte.prontas % 6 === 0) pintarArte(tr, false);
          }
        };
        await Promise.all([fila(), fila(), fila(), fila(), fila(), fila()]);
        tr.arte.fim = true;
        pintarArte(tr, true);
      });
    }
    // A foto contra o SET INTEIRO (escolherPelaArte). Só com o set quase todo
    // aprendido: com metade das cartas, a que falta pode ser a da foto, e a
    // "mais parecida" seria outra. Devolve o que o `entregar` espera, ou null.
    function pelaArteDoSet(tr, fotos) {
      const a = tr && tr.arte;
      if (!a || !fotos.length || a.sigs.length < 2 || a.prontas < a.total * 0.9) return null;
      const sims = a.sigs.map((x) => {
        let m = -1;
        for (const f of fotos) { const v = semelhanca(f, x.sig); if (v > m) m = v; }
        return m;
      });
      const e = escolherPelaArte(sims);
      if (!e) return null;
      const quais = e.empates.slice(0, 8);
      const achados = quais.map((k) => ({ card: a.sigs[k].card, game: tr.game, exato: true }));
      return {
        codigo: achados[0].card.number || "", achados, sim: e.sim, estado: "certo", forte: true, arte: true, negou: false,
        foto: { mudou: false, claro: e.claro, melhor: e.sim, notas: quais.map((k) => sims[k]) }
      };
    }
    // ── Seletor de set da trava ──────────────────────────────────────────────
    // O cadeado sem carta lida abre a lista de sets (do índice que a busca já
    // baixou): é como se trava um set do jogo que não imprime código, onde
    // não há "primeira carta lida" pra travar por ela.
    const folhaSets = $("[data-scan-sets]");
    const inSets = $("[data-scan-sets-input]");
    let setsNaTela = [];
    function pintarSets() {
      setsNaTela = filtrarSets(indice ? indice.sets : [], inSets.value, selJogo.value, sessao);
      $("[data-scan-sets-lista]").innerHTML = setsNaTela.map((st, i) => `<button type="button" class="scan-set-op" data-scan-set-op="${i}">
          <strong>${escapeHtml(st.name)}</strong>
          <span>${escapeHtml(shared.dotJoin(shared.gameLabel(st.game), st.lang && st.lang !== "en" ? st.lang.toUpperCase() : "", st.n ? String(st.n) : ""))}</span>
        </button>`).join("");
      $("[data-scan-sets-vazio]").hidden = setsNaTela.length > 0;
    }
    function abrirSets() {
      folha.hidden = true;
      folhaSom.hidden = true;
      folhaLista.hidden = true;
      inSets.value = "";
      pintarSets();
      folhaSets.hidden = false;
      atualizarFundo();
      try { inSets.focus(); } catch (e) { /* teclado não abriu */ }
    }
    function fecharSets() { folhaSets.hidden = true; atualizarFundo(); }
    inSets.addEventListener("input", pintarSets);
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
      folha.hidden = true;
      folhaLista.hidden = true;
      folhaSets.hidden = true;
      folhaSom.hidden = false;
      atualizarFundo();
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
      atualizarFundo();
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
    // Leitura em DÚVIDA (a foto não confirmou): o aviso próprio, no lugar do
    // da faixa de preço — "carta boa!" pra uma carta que talvez nem seja ela
    // é o pior aviso que o scanner pode dar.
    function avisar(h, duvida) {
      const sinal = duvida ? "duvida" : sinalDe(h);
      if (som.on) tocar(SONS[sinal]);
      shared.vibrar(VIBRA[sinal]);
    }
    // ── Lista da sessão ──────────────────────────────────────────────────────
    // Toda carta lida entra aqui (o "scanned cards" do ManaBox): a mesma carta
    // lida de novo soma uma cópia; a ambígua (mesmo código, e a foto sem folga
    // pra decidir) fica marcada pra conferir. A pessoa revisa, escolhe a
    // condição e a variante da sessão e adiciona tudo de uma vez. No aparelho
    // fica só o id de cada carta (nada da foto), por 24 h: fechar o scanner
    // sem querer não pode custar o booster inteiro.
    const CHAVE_LISTA = "tcg-scan-lista-v1";
    const folhaLista = $("[data-scan-lista]");
    const itensEl = $("[data-scan-itens]");
    const selCond = $("[data-scan-lista-cond]"), selVar = $("[data-scan-lista-var]");
    const btnListaAdd = $("[data-scan-lista-add]"), btnLimpar = $("[data-scan-lista-limpar]");
    let lista = [];
    let prefCond = shared.DEFAULT_CONDITION, prefVar = "padrao";
    let itemAtual = null;       // item da leitura mais recente: é ele que o "+N opções" corrige
    let editando = null;        // item aberto pelo "Conferir" da lista
    let voltarPraLista = false; // a folha de correção veio da lista: fechar volta pra ela
    const chaveItem = (game, card, variante) => `${game}|${card.id}|${variante}`;
    const pendentes = (it) => Math.max(0, it.qtd - it.adicionadas);
    const varianteDaSessao = (card) => varianteDe(shared.cardVariants(card), prefVar);
    function fmtPreco(v, casas) {
      const n = v.value.toLocaleString(undefined, { minimumFractionDigits: casas, maximumFractionDigits: casas });
      return (v.currency === "BRL" ? "R$ " : v.currency === "USD" ? "US$ " : "€ ") + n;
    }
    function totalLista() {
      let total = 0, moeda = "";
      lista.forEach((it) => { const v = precoDe(it.card); if (v) { total += v.value * it.qtd; moeda = v.currency; } });
      return total > 0 ? { value: total, currency: moeda } : null;
    }
    function salvarLista() {
      try {
        localStorage.setItem(CHAVE_LISTA, JSON.stringify({
          t: Date.now(), cond: prefCond, v: prefVar,
          itens: lista.map((it) => ({ g: it.game, id: it.card.id, v: it.variante, q: it.qtd, a: it.adicionadas, c: it.conferir ? 1 : 0 }))
        }));
      } catch (e) { /* sem storage: a lista vale só nesta sessão */ }
    }
    function pintarBotaoLista() {
      const n = lista.reduce((soma, it) => soma + it.qtd, 0);
      const total = totalLista();
      btnLote.classList.toggle("is-vazio", !n);
      $("[data-scan-lote-n]").textContent = String(n);
      $("[data-scan-lote-t]").textContent = total ? fmtPreco(total, 0) : t("scan.list");
      if (!folhaLista.hidden) pintarLista();
    }
    // Soma `qtd` cópias de `h` na lista, na variante da sessão (junta com o
    // item igual que já existir).
    function somarItem(h, qtd, conferir, alternativas) {
      const variante = varianteDaSessao(h.card);
      const chave = chaveItem(h.game, h.card, variante);
      let it = lista.find((x) => x.chave === chave);
      if (it) {
        it.qtd += qtd;
        if (conferir) it.conferir = true;
        if (alternativas && alternativas.length > it.alternativas.length) it.alternativas = alternativas.slice(0, 12);
      } else {
        it = { chave, game: h.game, card: h.card, variante, qtd, adicionadas: 0, conferir: !!conferir, alternativas: (alternativas || [h]).slice(0, 12) };
        lista.unshift(it);
      }
      return it;
    }
    function registrar(achados, foto, duvida) {
      itemAtual = somarItem(achados[0], 1, !!duvida || (achados.length > 1 && !(foto && foto.claro)), achados);
      salvarLista();
      pintarBotaoLista();
    }
    // A pessoa disse qual era a carta (folha "+N opções" ou "Conferir"): move
    // `unidades` do item pra ela — UMA quando corrige a leitura mais recente
    // (as cópias lidas antes estavam certas), todas quando confere o item. O
    // que já foi pra coleção fica lá; a lista não desfaz o que foi gravado.
    function corrigirItem(it, h, unidades) {
      if (!it || !h) return it;
      if (it.card.id === h.card.id && it.game === h.game) { it.conferir = false; salvarLista(); pintarBotaoLista(); return it; }
      const mover = Math.min(pendentes(it), unidades);
      if (mover <= 0) return it;
      it.qtd -= mover;
      if (it.qtd <= 0) lista.splice(lista.indexOf(it), 1);
      const novo = somarItem(h, mover, false, it.alternativas);
      novo.conferir = false;
      salvarLista();
      pintarBotaoLista();
      return novo;
    }
    function pintarLista() {
      const n = lista.reduce((soma, it) => soma + it.qtd, 0);
      const total = totalLista();
      $("[data-scan-lista-resumo]").textContent = !n ? "" : total ? t("scan.listSummary", { n, valor: fmtPreco(total, 2) }) : t("scan.listSummaryNoValue", { n });
      $("[data-scan-lista-vazio]").hidden = n > 0;
      selCond.value = prefCond;
      selVar.value = prefVar;
      itensEl.innerHTML = lista.map((it, i) => {
        const v = precoDe(it.card);
        const preco = v ? fmtPreco({ value: v.value * it.qtd, currency: v.currency }, 2) : "";
        const ok = it.adicionadas ? `<span class="scan-item-ok">${ICO.ok}${escapeHtml(t("scan.inCollection", { n: it.adicionadas }))}</span>` : "";
        const conf = it.conferir ? `<button type="button" class="scan-item-conf" data-scan-conferir="${i}">${escapeHtml(t("scan.check"))}</button>` : "";
        const variante = shared.variantDisplayLabel ? shared.variantDisplayLabel(it.card, it.variante) : it.variante;
        return `<div class="scan-item${it.conferir ? " is-conferir" : ""}">
            <span class="scan-item-thumb">${miniatura(it.card)}</span>
            <span class="scan-item-txt">
              <span class="scan-item-nome">${escapeHtml(it.card.name)}</span>
              <span class="scan-item-sub">${escapeHtml(shared.dotJoin(it.card.set, it.card.number, variante))}</span>
              <span class="scan-item-linha">${preco ? `<span class="scan-item-preco">${escapeHtml(preco)}</span>` : ""}${ok}${conf}</span>
            </span>
            <span class="scan-item-qtd">
              <button type="button" data-scan-menos="${i}" aria-label="${escapeAttribute(t("scan.qtyMinus", { nome: it.card.name }))}">${ICO.menos}</button>
              <span>${it.qtd}</span>
              <button type="button" data-scan-mais="${i}" aria-label="${escapeAttribute(t("scan.qtyPlus", { nome: it.card.name }))}">${ICO.mais}</button>
            </span>
          </div>`;
      }).join("");
      const falta = lista.reduce((soma, it) => soma + pendentes(it), 0);
      btnListaAdd.disabled = !falta;
      btnListaAdd.textContent = falta || !n ? t("scan.listAdd", { n: falta }) : t("scan.listAllAdded");
      desarmarLimpar();
    }
    const atualizarFundo = () => { fundo.hidden = folha.hidden && folhaSom.hidden && folhaLista.hidden && folhaSets.hidden; };
    function abrirLista() {
      folha.hidden = true;
      folhaSom.hidden = true;
      folhaSets.hidden = true;
      pintarLista();
      $("[data-scan-lista-col]").hidden = !(lote > 0);
      folhaLista.hidden = false;
      atualizarFundo();
    }
    function fecharLista() { folhaLista.hidden = true; atualizarFundo(); }
    // Tudo que ainda não foi pra coleção, com a condição da sessão.
    function adicionarLista() {
      let total = 0;
      lista.forEach((it) => {
        const q = pendentes(it);
        if (!q) return;
        const st = stores.col[it.game] || (stores.col[it.game] = shared.createCollectionStore(it.game));
        st.add(it.card.id, it.variante, prefCond, q);
        it.adicionadas += q;
        total += q;
      });
      if (!total) return;
      if (!funil.t1) funil.t1 = Math.max(1, Date.now() - funil.t0);
      lote += total;
      shared.vibrar(20);
      salvarLista();
      pintarBotaoLista();
      pintarLista();
      pintarResultado();
      $("[data-scan-lista-col]").hidden = false;
    }
    // Limpar pede um segundo toque (3 s): a lista pode ser um booster inteiro.
    let limparArmado = false, tmLimpar = 0;
    function desarmarLimpar() {
      limparArmado = false;
      clearTimeout(tmLimpar);
      btnLimpar.classList.remove("is-confirma");
      btnLimpar.textContent = t("scan.listClear");
    }
    function limparLista() {
      if (!limparArmado) {
        limparArmado = true;
        btnLimpar.classList.add("is-confirma");
        btnLimpar.textContent = t("scan.listClearConfirm");
        tmLimpar = setTimeout(desarmarLimpar, 3000);
        return;
      }
      lista = [];
      itemAtual = null;
      salvarLista();
      pintarBotaoLista();
      pintarLista();
    }
    // A variante preferida vale pro que ainda não foi pra coleção: cada item
    // pendente muda de variante (e se junta a um igual); o que já foi fica.
    function mudarVariantePreferida(pref) {
      prefVar = pref;
      const antigos = lista.slice().reverse(); // do mais antigo pro mais novo: somarItem põe na frente
      lista = [];
      antigos.forEach((it) => {
        if (it.adicionadas) lista.unshift(Object.assign({}, it, { qtd: it.adicionadas }));
        const q = pendentes(it);
        if (q) somarItem({ card: it.card, game: it.game }, q, it.conferir, it.alternativas);
      });
      itemAtual = null;
      salvarLista();
      pintarBotaoLista();
      pintarLista();
    }
    // A lista de antes (até 24 h, com algo ainda por adicionar) volta ao abrir.
    async function restaurarLista() {
      let salvo = null;
      try { salvo = JSON.parse(localStorage.getItem(CHAVE_LISTA) || "null"); } catch (e) { salvo = null; }
      if (!salvo || !Array.isArray(salvo.itens) || !(Date.now() - salvo.t < 86400000)) return;
      if (!salvo.itens.some((x) => x.q > (x.a || 0))) return; // tudo já foi pra coleção: começa vazia
      if (shared.CARD_CONDITIONS && shared.CARD_CONDITIONS.indexOf(salvo.cond) >= 0) prefCond = salvo.cond;
      if (["padrao", "foil", "reverse"].indexOf(salvo.v) >= 0) prefVar = salvo.v;
      const porJogo = {};
      salvo.itens.forEach((x) => { (porJogo[x.g] = porJogo[x.g] || []).push(x.id); });
      let cat = null;
      try { cat = await shared.loadOwnedAcrossGames(porJogo); } catch (e) { return; }
      const porId = new Map(((cat && cat.cards) || []).map((c) => [c.id, c]));
      const restaurados = salvo.itens.map((x) => {
        const card = porId.get(x.id);
        if (!card) return null;
        const q = Math.max(1, Number(x.q) || 1);
        return { chave: chaveItem(x.g, card, x.v), game: x.g, card, variante: x.v, qtd: q, adicionadas: Math.min(q, Math.max(0, Number(x.a) || 0)), conferir: !!x.c, alternativas: [{ card, game: x.g }] };
      }).filter(Boolean);
      // O que foi lido enquanto a lista carregava fica na frente (é mais novo).
      lista = lista.concat(restaurados.filter((r) => !lista.some((x) => x.chave === r.chave)));
      pintarBotaoLista();
    }

    // ── Laço da leitura automática ───────────────────────────────────────────
    const btnAuto = $("[data-scan-auto]");
    const amostra = document.createElement("canvas");
    amostra.width = 48;
    amostra.height = 66;
    const ctxAmostra = amostra.getContext("2d", { willReadFrequently: true });
    const amostraCarta = document.createElement("canvas");
    amostraCarta.width = 96;
    amostraCarta.height = 132;
    const ctxCarta = amostraCarta.getContext("2d", { willReadFrequently: true });
    let estAuto = { armado: true, parados: 0 };
    let amostraAnt = null;
    let tmAuto = 0;
    let motorPronto = false;
    function pintarAuto() {
      const rot = `${t("scan.auto")}: ${t(autoLigado ? "scan.soundIsOn" : "scan.soundIsOff")}`;
      btnAuto.setAttribute("aria-pressed", autoLigado ? "true" : "false");
      btnAuto.setAttribute("aria-label", rot);
      btnAuto.title = rot;
    }
    // As dicas ao vivo (pouca luz, reflexo) rodam com a leitura automática
    // DESLIGADA também (2026-11-01): antes o laço inteiro parava, e quem usa o
    // disparador — o caso de luz ruim, em que a pessoa mira com calma — ficava
    // sem aviso nenhum. Desligada, só não dispara.
    function tickAuto() {
      tmAuto = 0;
      if (!wrap.isConnected) return;
      const pausado = !motorPronto || !stream || !video.videoWidth || ocupado || disparando
        || !folha.hidden || !folhaSom.hidden || !folhaLista.hidden || !folhaSets.hidden || document.hidden;
      if (!pausado) {
        try {
          const rec = recorteDaGuia(video, wrap, guia);
          ctxAmostra.drawImage(video, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, 48, 66);
          const g = cinzaDe(ctxAmostra.getImageData(0, 0, 48, 66).data);
          const m = medirQuadro(g, 48, 66, amostraAnt);
          amostraAnt = g;
          // Tem carta no quadro? Só enquanto o laço está armado (é quando a
          // resposta muda o disparo), numa amostra maior que a das medidas.
          if (autoLigado && estAuto.armado) {
            ctxCarta.drawImage(video, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, 96, 132);
            m.carta = !!acharCarta(cinzaDe(ctxCarta.getImageData(0, 0, 96, 132).data), 96, 132, 0.22);
          }
          const chaveDica = dicaDoQuadro(m);
          const escuro = chaveDica === "scan.hint.dark";
          // Sem lanterna (iPhone pela web), a dica não manda acendê-la.
          const dq = chaveDica ? t(escuro && btnTorch.hidden ? "scan.hint.darkNoTorch" : chaveDica) : "";
          sugerirLanterna(escuro);
          let r = null;
          if (autoLigado) {
            r = passoAuto(estAuto, m);
            // A cena mudou (carta trocada): a dica da leitura que falhou sai.
            if (!estAuto.armado && r.st.armado && dicaFalha) { dicaFalha = ""; if (!dq) pronto(); }
            estAuto = r.st;
          }
          if (dq !== dicaQuadro) { dicaQuadro = dq; pronto(); }
          if (r && r.disparar) lerAgora(true);
        } catch (e) { /* o vídeo ainda não tem quadro */ }
      }
      tmAuto = setTimeout(tickAuto, AUTO.intervalo);
    }
    // Jogos permitidos na busca: o escolhido no seletor, ou o que a carta diz.
    function jogosDaBusca(codigos) {
      if (trava) return [trava.game];
      if (selJogo.value) return [selJogo.value];
      const d = detectarJogo(ultimoTexto, codigos, sessao, ultimasOrigens, indice);
      return d.restritos.length ? d.jogos.filter((g) => d.pontos[g] >= 2) : [];
    }
    // O índice de sets do catálogo (indiceDeSets), resolvido: null até os
    // manifests chegarem — e a leitura espera por ele (ver ler).
    let indice = null;
    indiceDeSets().then((m) => { indice = m; });
    selJogo.addEventListener("change", () => {
      selJogo.classList.toggle("is-auto", !selJogo.value);
      if (codigoAtual && !ocupado) buscarManual(codigoAtual);
    });

    // ── Captura e diagnóstico ────────────────────────────────────────────────
    // O jogo que já se sabe antes de ler (trava, seletor, página): decide a
    // faixa onde o código mora — o topo no Gundam, o rodapé nos outros.
    const jogoSabido = () => (trava ? trava.game : (selJogo.value || sessao));
    let poi = "";            // ponto de foco/luz pedido à câmera ("x,y" do quadro), pro relatório
    let disparando = false;  // a rajada do disparo está colhendo quadros
    let captura = null;      // a rajada da leitura em curso: { quadros, escolhido, ruim }
    // FOCO E LUZ NA FAIXA DO CÓDIGO (2026-11-01), onde o Android/Chrome deixa
    // pedir (pointsOfInterest, coordenadas 0-1 do quadro). Sem isso a câmera
    // mede a luz da cena inteira: a carta clara na mesa escura sai estourada,
    // e a faixa escura do código do DBFW (cinza-claro miúdo sobre azul-
    // marinho) sai escura demais. O iPhone não tem a API e segue como estava.
    async function focarNoCodigo() {
      try {
        const tr = stream && stream.getVideoTracks()[0];
        const sup = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
        if (!tr || !sup.pointsOfInterest || !video.videoWidth) return;
        const rec = recorteDaGuia(video, wrap, guia);
        const x = (rec.sx + rec.sw / 2) / video.videoWidth;
        const y = (rec.sy + rec.sh * (jogoSabido() === "gundam" ? RODAPE / 2 : 1 - RODAPE / 2)) / video.videoHeight;
        await tr.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] }] });
        poi = `${x.toFixed(2)},${y.toFixed(2)}`;
      } catch (e) { poi = ""; }
    }
    // No escuro, o raio da lanterna ganha o anel de sugestão (o mesmo do
    // cadeado) — só com a lanterna apagada e num aparelho que tem uma.
    function sugerirLanterna(escuro) {
      btnTorch.classList.toggle("is-sugere", escuro && !btnTorch.hidden && btnTorch.getAttribute("aria-pressed") !== "true");
    }
    // MELHOR DE N QUADROS (2026-11-01). O disparo congelava UM quadro, o do
    // instante do toque — justo o que sai tremido (o dedo empurra o celular),
    // e no escuro a câmera alonga a exposição e qualquer tremor vira borrão.
    // Agora o disparo colhe uma rajada curta (4 quadros no toque; 3 na leitura
    // automática, que já esperou a carta parar), com 90 ms ou mais entre eles,
    // e fica com o mais NÍTIDO na faixa do código. Só UM quadro inteiro vive
    // na memória: o canvas é redesenhado quando chega um mais nítido. Custa
    // ~0,3 s antes do OCR, que leva 1-3 s.
    const RAJADA = { toque: 4, auto: 3, intervalo: 90 };
    // Espera um quadro NOVO do vídeo, pelo menos `ms` depois (requestVideo-
    // FrameCallback onde há; senão, só o tempo). Com teto: vídeo parado (aba
    // escondida, câmera caiu) não trava a leitura.
    function proximoQuadro(ms) {
      return new Promise((ok) => {
        const t0 = performance.now();
        if (!video.requestVideoFrameCallback) { setTimeout(ok, ms); return; }
        const teto = setTimeout(ok, ms * 4);
        const novo = () => {
          if (performance.now() - t0 < ms) { video.requestVideoFrameCallback(novo); return; }
          clearTimeout(teto);
          ok();
        };
        video.requestVideoFrameCallback(novo);
      });
    }
    async function rajada(rec, n) {
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const ctx = c.getContext("2d");
      // A nitidez é medida na faixa do código reduzida a até 480 px (reduzir
      // também tira parte do ruído do escuro, que inflaria o laplaciano); a
      // luz e o reflexo, na carta inteira a 48×66, como na dica ao vivo.
      const fw = Math.max(8, Math.min(480, Math.round(rec.sw)));
      const fh = Math.max(8, Math.round((rec.sh * RODAPE * fw) / rec.sw));
      const fy = rec.sy + (jogoSabido() === "gundam" ? 0 : rec.sh * (1 - RODAPE));
      const faixa = document.createElement("canvas");
      faixa.width = fw;
      faixa.height = fh;
      const cf = faixa.getContext("2d", { willReadFrequently: true });
      const quadros = [];
      let escolhido = -1;
      for (let k = 0; k < n; k++) {
        if (k) await proximoQuadro(RAJADA.intervalo);
        if (!stream || !video.videoWidth) break;
        cf.drawImage(video, rec.sx, fy, rec.sw, rec.sh * RODAPE, 0, 0, fw, fh);
        ctxAmostra.drawImage(video, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, 48, 66);
        const m = medirQuadro(cinzaDe(ctxAmostra.getImageData(0, 0, 48, 66).data), 48, 66, null);
        m.nitidez = nitidez(cinzaDe(cf.getImageData(0, 0, fw, fh).data), fw, fh);
        quadros.push(m);
        if (escolhido < 0 || m.nitidez > quadros[escolhido].nitidez) {
          escolhido = k;
          ctx.drawImage(video, 0, 0);
        }
      }
      if (escolhido < 0) { c.width = c.height = 0; return null; }
      return { canvas: c, quadros, escolhido, ruim: !!dicaDoQuadro(quadros[escolhido]) };
    }

    // DIAGNÓSTICO (2026-11-01). Em campo, com cartas de DBFW e Pokémon, o
    // scanner errou e a suspeita era a luz — mas nada dizia em que etapa: o
    // OCR não leu, leu errado, leu e o catálogo não casou, ou casou a versão
    // errada. Segurar o disparador (ou abrir com ?scandiag=1; =0 desliga)
    // liga um modo que guarda, da ÚLTIMA leitura, a foto escolhida, a nitidez
    // da rajada, cada recorte já tratado que foi pro OCR, o texto lido, o jogo
    // e a busca; o botão "Diagnóstico" no canto da moldura abre a folha com
    // tudo e um "Copiar relatório" (só o texto). Fica SÓ na memória, troca a
    // cada leitura e morre ao fechar: a foto continua sem sair do aparelho.
    const CHAVE_DIAG = "tcg-scan-diag-v1";
    let diagLigado = false;
    try {
      const q = /[?&]scandiag=([01])\b/.exec(location.search);
      diagLigado = q ? q[1] === "1" : localStorage.getItem(CHAVE_DIAG) === "1";
      if (q) localStorage.setItem(CHAVE_DIAG, q[1]);
    } catch (e) { /* sem storage: vale o que o endereço disse */ }
    let diagAtual = null; // relatório da última leitura, com as miniaturas dos recortes
    let tmDiagAviso = 0;
    const btnDiag = $("[data-scan-diag-abrir]");
    const caixaDiag = $("[data-scan-diag]");
    btnDiag.hidden = !diagLigado;
    function alternarDiag() {
      diagLigado = !diagLigado;
      try { localStorage.setItem(CHAVE_DIAG, diagLigado ? "1" : "0"); } catch (e) { /* vale só nesta sessão */ }
      if (!diagLigado) diagAtual = null;
      btnDiag.hidden = !diagLigado;
      shared.vibrar(diagLigado ? [20, 40, 20] : 20);
      dizer(t(diagLigado ? "scan.diag.on" : "scan.diag.off"));
      clearTimeout(tmDiagAviso);
      tmDiagAviso = setTimeout(() => { if (!ocupado) pronto(); }, 4000);
    }
    // Cópia reduzida de um retângulo de `fonte` pro relatório: o recorte que
    // foi pro OCR tem até 1800 px, e a folha só precisa mostrar.
    function copiaDiag(fonte, sx, sy, sw, sh, largura) {
      const k = Math.min(1, largura / sw);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * k));
      c.height = Math.max(1, Math.round(sh * k));
      c.getContext("2d").drawImage(fonte, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c;
    }
    function pintarDiag() {
      caixaDiag.hidden = !diagLigado;
      if (!diagLigado) return;
      $("[data-scan-diag-txt]").textContent = diagAtual ? relatorio(diagAtual) : t("scan.diag.empty");
      const copiar = $("[data-scan-diag-copiar]");
      copiar.textContent = t("scan.diag.copy");
      copiar.hidden = !diagAtual;
      const imgs = $("[data-scan-diag-imgs]");
      imgs.textContent = "";
      if (!diagAtual) return;
      [{ c: diagAtual.recorte, nome: "foto" }]
        .concat(diagAtual.passos.map((p, i) => ({ c: p.img, nome: `#${i + 1} ${p.nome}` })))
        .forEach((f) => {
          if (!f.c) return;
          const fig = document.createElement("figure");
          const cap = document.createElement("figcaption");
          cap.textContent = f.nome;
          fig.appendChild(f.c);
          fig.appendChild(cap);
          imgs.appendChild(fig);
        });
    }
    // Copia só o TEXTO. Sem a API da área de transferência (http, webview
    // antiga), seleciona o relatório pra pessoa copiar à mão.
    function copiarDiag(btn) {
      const txt = relatorio(diagAtual);
      if (!txt) return;
      const seleciona = () => { try { window.getSelection().selectAllChildren($("[data-scan-diag-txt]")); } catch (e) { /* fica à vista */ } };
      try { navigator.clipboard.writeText(txt).then(() => { btn.textContent = t("scan.diag.copied"); }, seleciona); }
      catch (e) { seleciona(); }
    }

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
      btnDiag.style.top = `${Math.round(y + 8)}px`;
      btnDiag.style.left = `${Math.round((W - w) / 2 + 8)}px`;
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
        amb: funil.amb, vis: funil.vis, troca: funil.troca, dig: funil.dig, auto: funil.auto,
        luz: funil.luz, luzOk: funil.luzOk,
        duv: funil.duv, corr: funil.corr, neg: funil.neg, arte: funil.arte
      });
      clearTimeout(tmAuto);
      clearTimeout(tmLimpar);
      clearTimeout(tmDiagAviso);
      diagAtual = null; // as miniaturas do diagnóstico morrem com o scanner
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
      if (!folhaSets.hidden) fecharSets(); else if (!folhaLista.hidden) fecharLista(); else if (!folhaSom.hidden) fecharSom(); else if (!folha.hidden) fecharFolha(); else fechar();
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
      focarNoCodigo();
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
      const v = varianteDaSessao(h.card);
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
      // Em dúvida, o cartão não comemora (anel dourado) nem promete: ganha a
      // borda âmbar e o selo "Conferir", o mesmo da lista.
      resCard.classList.toggle("is-boa", !emDuvida && (sinal === 2 || sinal === "wl"));
      resCard.classList.toggle("is-duvida", emDuvida);
      const wl = emDuvida ? `<span class="scan-res-duv${preco ? "" : " is-so"}">${escapeHtml(t("scan.check"))}</span>`
        : sinal === "wl" ? `<span class="scan-res-wl">${ICO.heart}${escapeHtml(t("scan.inWishlist"))}</span>` : "";
      resCard.innerHTML = `
        <button type="button" class="scan-res-open" data-scan-open>
          <span class="scan-res-thumb">${miniatura(h.card)}</span>
          <span class="scan-res-text">
            <span class="scan-res-name">${escapeHtml(h.card.name)}<span class="scan-res-game">${escapeHtml(shared.gameLabel(h.game))}</span></span>
            <span class="scan-res-sub">${escapeHtml(shared.dotJoin(h.card.set, h.card.number))}</span>
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
            <span class="scan-cand-sub">${escapeHtml(shared.dotJoin(h.card.set, h.card.number))}</span>
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
      pintarDiag();
    }
    // `semFoco`: aberta pelo botão do diagnóstico — é pra ler, não pra digitar.
    function abrirFolha(semFoco) {
      pintarFolha();
      folhaSom.hidden = true;
      folhaLista.hidden = true;
      folhaSets.hidden = true;
      folha.hidden = false;
      atualizarFundo();
      if (!resultados.length && !semFoco) { try { input.focus(); } catch (e) { /* teclado não abriu */ } }
    }
    // Fechar a folha que veio do "Conferir" da lista volta pra lista.
    function fecharFolha() {
      folha.hidden = true;
      editando = null;
      if (voltarPraLista) { voltarPraLista = false; abrirLista(); } else atualizarFundo();
    }
    // `r`: o que a busca devolveu — { codigo, achados, foto, estado,
    // corrigido, forte }. `estado` "duvida" = a foto não confirmou a carta.
    function entregar(r, auto) {
      const codigo = r.codigo, achados = r.achados || [], foto = r.foto || null;
      const duvida = r.estado === "duvida";
      funil.n += 1;
      if (codigo) funil.lido += 1;              // o OCR extraiu um código
      if (achados.length) funil.achou += 1;     // e ele casou com o catálogo
      if (achados.length > 1) funil.amb += 1;   // com mais de uma carta
      if (foto && foto.mudou) funil.vis += 1;   // e a foto mudou qual vem primeiro
      if (auto) funil.auto += 1;                // leitura disparada sozinha
      if (duvida) funil.duv += 1;               // a foto não confirmou: foi pra conferir
      if (r.corrigido) funil.corr += 1;         // a foto trocou o código lido por um vizinho
      if (r.negou) funil.neg += 1;              // a foto derrubou um resultado da busca
      if (r.arte) funil.arte += 1;              // achada pela arte do set travado, sem código
      if (captura && captura.ruim) {            // a foto escolhida tinha pouca luz ou reflexo
        funil.luz += 1;
        if (achados.length) funil.luzOk += 1;
      }
      trocaConta = achados.length > 1;
      codigoAtual = codigo || "";
      resultados = achados;
      primario = 0;
      emDuvida = duvida;
      // Três leituras seguidas com o 1º resultado no mesmo set: quem abre
      // booster ganha a sugestão de travar (a dica sob a moldura e um anel no
      // cadeado). Leitura sem carta não quebra a sequência; a em dúvida não
      // conta (o set dela pode ser o errado).
      if (!trava && achados.length && !duvida) {
        recentes = recentes.concat(chaveSet(achados[0])).slice(-3);
        const mesmo = recentes.length === 3 && recentes.every((k) => k === recentes[0]);
        sugestao = mesmo ? t("scan.lockSuggest", { set: nomeSet(achados[0].card) }) : "";
        btnTrava.classList.toggle("is-sugere", !!sugestao);
      }
      if (achados.length) registrar(achados, foto, duvida); else itemAtual = null;
      pintarResultado();
      if (achados.length) { avisar(achados[0], duvida); return; } // som e vibração da faixa de preço, da wishlist ou da dúvida
      // Sem carta. Com código de formato de jogo lido, a folha abre pra
      // corrigir (é leitura errada, não carta ausente). Leitura AUTOMÁTICA sem
      // código — ou só com código fraco, que a foto derrubou — não abre nada:
      // o laço pode ter pego a carta ainda chegando, e a folha no meio de um
      // booster interrompe por causa de um "4/3" lido do texto da carta. Vira
      // dica até a cena mudar.
      if (auto && !(codigo && r.forte)) { dicaFalha = t("scan.hint.retry"); return; }
      abrirFolha();
    }
    function adicionar(tipo, i, btn) {
      const h = resultados[i];
      if (!h) return;
      const v = tipo === "wl" ? shared.defaultVariant(h.card) : varianteDaSessao(h.card);
      if (tipo === "wl") {
        const st = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        const on = st.toggle(h.card.id, v);
        btn.classList.toggle("done", on);
        if (!btn.classList.contains("scan-heart")) btn.textContent = on ? "✓ " + t("cmdk.wl") : t("cmdk.addWl");
        return;
      }
      const st = stores.col[h.game] || (stores.col[h.game] = shared.createCollectionStore(h.game));
      st.add(h.card.id, v, prefCond, 1);
      // Tempo até a 1ª carta: da câmera aberta até a coleção ganhar algo. É o
      // "quanto demora pra o scanner servir pra alguma coisa".
      if (!funil.t1) funil.t1 = Math.max(1, Date.now() - funil.t0);
      lote += 1;
      // Na lista, a cópia desta leitura passa a "na coleção".
      const it = lista.find((x) => x.chave === chaveItem(h.game, h.card, v));
      if (it) { it.adicionadas = Math.min(it.qtd, it.adicionadas + 1); salvarLista(); pintarBotaoLista(); }
      shared.vibrar(20);
      pintarResultado();
      if (!folha.hidden) fecharFolha();
    }
    selCond.addEventListener("change", () => { prefCond = selCond.value; salvarLista(); pintarResultado(); });
    selVar.addEventListener("change", () => { mudarVariantePreferida(selVar.value); pintarResultado(); });

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

    // ── A FOTO COMO VERIFICADOR DE TODA LEITURA (2026-11-10) ─────────────────
    // Antes a foto só entrava quando o código casava com MAIS de uma carta, pra
    // escolher a versão. Com uma carta só, nada conferia: um dígito trocado
    // que cai numa carta que existe ("76" lido "16"), uma fração inventada do
    // texto da carta ("4/3") ou um resultado que a borda achou pelo nome
    // entravam na lista com som de carta boa — e, na leitura automática,
    // ninguém está olhando. Agora toda tentativa passa pela foto
    // (estadoDaFoto): a que a foto confirma vence na hora; a que ela não
    // confirma fica de reserva enquanto a busca tenta os outros candidatos,
    // os outros jogos e os VIZINHOS do código; se nada melhor aparece, entra
    // marcada "Conferir", com aviso próprio.
    //
    // Uma TENTATIVA: o código nos jogos dados -> os resultados que casam com
    // ele -> a foto. null se a busca não achou nada.
    // `memo`: as tentativas desta leitura (código + jogos) — a busca roda a
    // cada passada do OCR, e o mesmo código não vai duas vezes à borda nem à
    // foto.
    async function tentar(c, jogos, fotos, ate, memo) {
      const k = `${c.codigo}|${jogos.join(",")}`;
      if (memo && memo.has(k)) return memo.get(k);
      const pr = (async () => {
        const achados = await buscar(c.codigo, jogos);
        if (!achados.length) return null;
        let foto = null;
        try { foto = await conferirPelaFoto(fotos, achados, ate); } catch (e) { foto = null; }
        const sim = foto ? foto.melhor : null;
        const forte = !!achados[0].exato && c.peso >= 1;
        return { codigo: c.codigo, achados, foto, sim, peso: c.peso, forte, estado: estadoDaFoto(sim, forte, c.peso) };
      })();
      if (memo) {
        memo.set(k, pr);
        // Tentativa que ficou sem foto (a miniatura não chegou a tempo) não
        // fica guardada: a próxima passada tenta de novo, com a miniatura já
        // no cache.
        pr.then((r) => { if (r && typeof r.sim !== "number") memo.delete(k); }, () => memo.delete(k));
      }
      return pr;
    }
    // As cartas de `lista` ([{ card, game }]) contra a foto: a mais parecida,
    // se a foto a CONFIRMA; senão null. É como entram os resultados que não
    // vieram do código lido (vizinhos, número solto, palavras do set travado).
    async function melhorPelaFoto(lista, fotos, ate) {
      if (!lista.length || !fotos.length) return null;
      const sims = await semelhancas(fotos, lista, Math.min(ate || Infinity, Date.now() + PRAZO_FOTO));
      let i = -1;
      sims.forEach((x, k) => { if (typeof x === "number" && (i < 0 || x > sims[i])) i = k; });
      // Pro diagnóstico: o que a foto disse de cada carta que entrou por ela.
      if (diagAtual && diagAtual.reparos) diagAtual.reparos.push(lista.map((h, k) => `${h.codigo || h.card.number || "?"}:${typeof sims[k] === "number" ? sims[k].toFixed(2) : "?"}`).join(" "));
      if (i < 0 || sims[i] < FOTO_CONFIRMA + FOLGA_REPARO) return null;
      // …e com FOLGA sobre a melhor carta de OUTRO código. Aqui a foto escolhe
      // entre uma dúzia ou duas de cartas que ninguém leu, e com a foto ruim
      // (escura, borrada) toda carta do mesmo jogo fica parecida: na bancada,
      // as duas erradas sem aviso do cenário duro entraram assim, a 0,60 e
      // 0,62, com a segunda colocada a 0,05 ou menos. As correções certas
      // passam de 0,68, com 0,13 ou mais de distância.
      const rival = sims.reduce((m, x, k) => (k !== i && typeof x === "number" && (lista[k].codigo || k) !== (lista[i].codigo || i) && x > m ? x : m), -1);
      if (sims[i] - rival < MARGEM_REPARO) return null;
      return { h: lista[i], sim: sims[i] };
    }
    // Um resultado que entrou pela FOTO (vizinho, número solto): todas as
    // versões do código dele, na ordem que a foto dá.
    async function entregaPelaFoto(v, codigo, hs, fotos, ate, negou) {
      const achados = hs && hs.length ? hs.slice() : [v.h];
      let foto = null;
      try { foto = await conferirPelaFoto(fotos, achados, ate); } catch (e) { foto = null; }
      const f = foto && typeof foto.melhor === "number" ? foto : { mudou: false, claro: achados.length === 1, melhor: v.sim, notas: [v.sim] };
      return { codigo, achados, foto: Object.assign({}, f, { mudou: true }), sim: f.melhor, estado: "certo", forte: true, corrigido: true, negou };
    }
    // Vizinhos de `codigos` que EXISTEM em `jogos`, sem ida à borda: o set a um
    // caractere do lido (só pra código cujo set esses jogos não têm) e, com
    // `numero`, o número a um dígito. Um grupo por código vizinho, com todas
    // as versões dele (a foto pode ser da arte alternativa), até 24 cartas.
    async function vizinhosQueExistem(codigos, jogos, numero) {
      const ids = indice && indice.ids ? [].concat.apply([], (jogos.length ? jogos : Object.keys(indice.ids)).map((g) => indice.ids[g] || [])) : [];
      const temSet = (c) => {
        const k = chaveDoSet(c);
        return !k || !indice || !indice.size || (indice.get(k) || []).some((g) => !jogos.length || jogos.indexOf(g) >= 0);
      };
      const lista = [];
      codigos.forEach((c) => { if (!temSet(c)) vizinhosDoSet(c, ids).slice(0, 4).forEach((v) => lista.push(v)); });
      if (numero) codigos.slice(0, 1).forEach((c) => vizinhosDoNumero(c).forEach((v) => lista.push(v)));
      const grupos = [];
      let n = 0;
      for (const v of lista) {
        if (n >= 24) break;
        let hs = [];
        try { hs = (await buscar(v, jogos, true)).filter((h) => h.exato).slice(0, 4); } catch (e) { hs = []; }
        hs.forEach((h) => { h.codigo = v; });
        if (hs.length) { grupos.push({ codigo: v, hs }); n += hs.length; }
      }
      return grupos;
    }
    async function repararPelaFoto(codigos, jogos, numero, fotos, ate, negou) {
      if (!codigos.length || !fotos.length || Date.now() >= ate) return null;
      const grupos = await vizinhosQueExistem(codigos, jogos, numero);
      let v = await melhorPelaFoto([].concat.apply([], grupos.map((g) => g.hs)), fotos, ate);
      // A REIMPRESSÃO mora noutro set: o "OP05-019" de uma coleção premium tem
      // o mesmo código e outra arte, e o que está na memória é só o set do
      // prefixo. Pros vizinhos mais prováveis (as trocas que o OCR mais faz),
      // a borda devolve todas as impressões do código.
      if (!v && numero && Date.now() < ate) {
        const vistos = new Set([].concat.apply([], grupos.map((g) => g.hs.map((h) => `${h.game}:${h.card.id}`))));
        const provaveis = vizinhosDoNumero(codigos[0]).slice(0, 8);
        const daBorda = await Promise.all(provaveis.map((c) => buscar(c, jogos, false).then((hs) => ({ codigo: c, hs: hs.filter((h) => h.exato && !vistos.has(`${h.game}:${h.card.id}`)).slice(0, 4) }), () => ({ codigo: c, hs: [] }))));
        daBorda.forEach((g) => { g.hs.forEach((h) => { h.codigo = g.codigo; }); if (g.hs.length) grupos.push(g); });
        v = await melhorPelaFoto([].concat.apply([], daBorda.map((g) => g.hs)), fotos, ate);
      }
      if (!v) return null;
      // Todas as versões do código vencedor, juntando o que veio da memória e
      // da borda.
      const hs = [].concat.apply([], grupos.filter((x) => x.codigo === v.h.codigo).map((x) => x.hs));
      return entregaPelaFoto(v, v.h.codigo, hs, fotos, ate, negou);
    }
    // O jogo é certo e do código só se salva o NÚMERO: a fração do Lorcana e
    // do Magic traz o total IMPRESSO ("71/204"), que não é o do catálogo (216,
    // com as cartas além da numeração). As cartas daquele número no jogo vão
    // pra foto, e só entra a que ela confirmar.
    async function pelaFotoDoNumero(lista, jogo, fotos, ate, negou) {
      const fr = lista.map((c) => /^(\d+)[A-D]?\/\d+$/.exec(c.codigo)).find(Boolean);
      if (!fr || !fotos.length || Date.now() >= ate) return null;
      const n = parseInt(fr[1], 10);
      let hs = [];
      try { hs = (await buscar(String(n), [jogo], false, 24)).filter((h) => numeroDe(h.card.number) === n); } catch (e) { hs = []; }
      const v = await melhorPelaFoto(hs, fotos, ate);
      return v ? entregaPelaFoto(v, fr[0], [v.h], fotos, ate, negou) : null;
    }
    // Busca de uma LEITURA: `cands` ([{ codigo, peso }], do mais forte pro
    // mais fraco, já filtrados pelo índice), `orfaos` (os "SET NÚMERO" de set
    // que não existe), `fotos` (as assinaturas do quadro), `deteccao` (o
    // jogo) e `texto` (tudo o que o OCR leu). Devolve o que o `entregar` espera.
    // `opc.rapido`: a busca do meio das passadas — as camadas de jogos e o set
    // a um caractere, sem os vizinhos de dígito nem os órfãos em todos os
    // jogos, que ficam pra busca final. `opc.memo`: as tentativas já feitas
    // nesta leitura. O prazo das comparações (ORCAMENTO_FOTO) é de cada
    // busca: contado da leitura inteira, as passadas do OCR o gastavam antes
    // de a foto ser consultada.
    async function procurarComFoto(cands, orfaos, fotos, deteccao, texto, opc) {
      if (trava) return procurarNoSetComFoto(cands, fotos, texto);
      const o = opc || {};
      const ate = Date.now() + ORCAMENTO_FOTO;
      const topo = cands[0] || orfaos[0] || null;
      const nada = { codigo: topo ? topo.codigo : "", achados: [], estado: "nada", forte: !!(topo && topo.peso >= 3), negou: false };
      // Camadas de jogos, da mais estreita pra mais larga: o jogo que a carta
      // IMPRIME (antes, com a fração dando +2 a três jogos, o "71/204" de uma
      // carta com "© Disney" achava um Pokémon chinês de set com 204 cartas),
      // os jogos que o formato admite e, por fim, todos.
      const camadas = [];
      if (selJogo.value) camadas.push([selJogo.value]);
      else {
        if (deteccao.confiante) camadas.push([deteccao.jogos[0]]);
        const restritos = deteccao.restritos.length ? deteccao.jogos.filter((g) => deteccao.pontos[g] >= 2) : [];
        if (restritos.length && !(camadas.length && restritos.length === 1)) camadas.push(restritos);
        camadas.push([]);
      }
      // Peso 0 (fração de total minúsculo, prefixo de uma letra) é o que o
      // lixo do OCR mais produz: só entra se não houver nada melhor.
      const bons = cands.filter((c) => c.peso >= 1);
      const lista = bons.length ? bons : cands;
      let reserva = null, negou = false;
      // Com o jogo IMPRESSO na carta, um resultado de OUTRO jogo contradiz o
      // que ela diz de si: só entra se a foto confirmar — nem "sem foto pra
      // conferir" vale (era um Pokémon chinês sem miniatura entrando calado
      // no lugar de uma carta com "© Disney").
      const exigeFoto = (k) => k > 0 && deteccao.confiante && !selJogo.value;
      for (let k = 0; k < camadas.length; k++) {
        const jogos = camadas[k];
        for (const c of lista) {
          aviso(t("scan.status.searching", { q: c.codigo }));
          const r = await tentar(c, jogos, fotos, ate, o.memo);
          if (!r) continue;
          if (r.estado === "certo") return r;
          if (r.estado === "negado" || exigeFoto(k)) { negou = true; continue; }
          if (!reserva || (r.estado === "duvida" && reserva.estado === "duvida" && r.sim > reserva.sim)) reserva = r;
        }
        // O jogo é sabido e nele não há carta com o código lido. Antes de
        // procurar noutros jogos: o SET a um caractere ("P-063" num Gundam é
        // "RP-063"; "OMU 257" num Magic é "DMU 257") e, com o jogo impresso,
        // o número sozinho.
        if (k === 0 && jogos.length && !reserva) {
          aviso(t("scan.status.comparing"));
          let v = await repararPelaFoto(lista.slice(0, 1).concat(orfaos.slice(0, 2)).map((c) => c.codigo), jogos, false, fotos, ate, negou);
          if (!v && deteccao.confiante && !selJogo.value) v = await pelaFotoDoNumero(lista, jogos[0], fotos, ate, negou);
          if (v) return v;
        }
        // Sem imagem pra conferir, vale a busca, como sempre valeu. E uma
        // dúvida no jogo certo não melhora procurando o código noutros jogos.
        if (reserva) break;
      }
      if (reserva && reserva.estado === "semfoto") return reserva;
      if (o.rapido) return reserva ? Object.assign({}, reserva, { negou }) : Object.assign(nada, { negou });
      // VIZINHOS do código mais forte: a foto desmentiu (ou não confirmou) o
      // que a busca achou, e o erro mais comum do OCR é um dígito.
      const base = reserva || lista.find((c) => c.peso >= 2);
      if (base) {
        aviso(t("scan.status.comparing"));
        const v = await repararPelaFoto([base.codigo], reserva ? [reserva.achados[0].game] : camadas[0], true, fotos, ate, negou);
        if (v) return v;
      }
      // Os "SET NÚMERO" de set que não existe, agora em qualquer jogo.
      if (!reserva && orfaos.length) {
        const v = await repararPelaFoto(orfaos.slice(0, 2).map((c) => c.codigo), [], false, fotos, ate, negou);
        if (v) return v;
      }
      if (reserva) return Object.assign({}, reserva, { negou });
      return Object.assign(nada, { negou });
    }
    // Com o SET TRAVADO: o código inteiro ou o número, nas cartas do set
    // (noSet); se a foto não confirmar, as PALAVRAS do texto que são número de
    // carta do set (cartasPelasPalavras), que só entram confirmadas pela foto.
    async function procurarNoSetComFoto(cands, fotos, texto) {
      const tr = trava;
      const cartas = await tr.cartas;
      const codigos = cands.map((c) => c.codigo);
      const nada = { codigo: codigos[0] || "", achados: [], estado: "nada", forte: !!(cands[0] && cands[0].peso >= 2), negou: false };
      let reserva = null;
      if (!cartas) {
        // O set não baixou: a busca normal no jogo, filtrada pelo set.
        const r0 = await procurarNoSet(codigos);
        if (!r0.achados.length) return nada;
        let foto = null;
        try { foto = await conferirPelaFoto(fotos, r0.achados); } catch (e) { foto = null; }
        const sim = foto ? foto.melhor : null;
        return { codigo: r0.codigo, achados: r0.achados, foto, sim, forte: true, estado: estadoDaFoto(sim, true, 3) };
      }
      const r = noSet(cartas, codigos, shared.cardCodeForms);
      if (r) {
        const achados = r.cartas.slice(0, 12).map((card) => ({ card, game: tr.game, exato: true }));
        let foto = null;
        try { foto = await conferirPelaFoto(fotos, achados); } catch (e) { foto = null; }
        const sim = foto ? foto.melhor : null;
        reserva = { codigo: r.codigo, achados, foto, sim, forte: true, estado: estadoDaFoto(sim, true, 3) };
        if (reserva.estado !== "duvida") return reserva;
      }
      if (fotos.length) {
        const ja = new Set((reserva ? reserva.achados : []).map((h) => h.card.id));
        const outras = cartasPelasPalavras(cartas, texto).filter((c) => !ja.has(c.id)).slice(0, 16).map((card) => ({ card, game: tr.game, exato: true }));
        const ate = Date.now() + PRAZO_FOTO;
        const v = await melhorPelaFoto(outras, fotos, ate);
        if (v) {
          // As outras versões do mesmo número vão junto, pra foto ordenar.
          const n = numeroDe(v.h.card.number);
          const versoes = [v.h].concat(outras.filter((h) => h !== v.h && numeroDe(h.card.number) === n));
          return Object.assign(await entregaPelaFoto(v, v.h.card.number || "", versoes, fotos, ate, false), { corrigido: !!reserva });
        }
      }
      return reserva || nada;
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
    async function ler(fonte, rec, auto) {
      if (ocupado) return;
      ocupado = true;
      // Qualquer leitura (automática ou no toque) desarma o laço: ele só volta
      // a ler quando a cena mudar — senão lia a mesma carta de novo.
      estAuto = { armado: false, parados: 0 };
      dicaFalha = "";
      let falhou = false;
      btnLer.disabled = true;
      fecharFolha();
      guia.classList.add("is-lendo");
      pintarLendo(fonte, rec);
      // Diagnóstico desta leitura (só com o modo ligado): vira o `diagAtual`
      // já no começo, e cada etapa preenche o seu pedaço.
      const t0 = performance.now();
      const dg = diagLigado ? {
        t: Date.now(), modo: rec.galeria ? "galeria" : auto ? "auto" : "toque",
        fonte: [fonte.videoWidth || fonte.width || 0, fonte.videoHeight || fonte.height || 0],
        rec: [rec.sw, rec.sh], poi: rec.galeria ? "" : poi,
        quadros: captura ? captura.quadros : null, escolhido: captura ? captura.escolhido : -1,
        recorte: null, passos: [], reparos: []
      } : null;
      if (dg) {
        try { dg.recorte = copiaDiag(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 240); } catch (e) { /* sem miniatura */ }
        diagAtual = dg;
      }
      try {
        aviso(t("scan.status.loading"));
        const worker = await obterWorker(progresso);
        // O índice de sets já vem descendo desde que o scanner abriu; aqui só
        // se espera o que falta, com teto — rede ruim não trava a leitura
        // (sem índice, vale o formato).
        if (!indice) indice = await Promise.race([indiceDeSets(), new Promise((ok) => setTimeout(() => ok(null), 1500))]);
        aviso(t("scan.status.reading"));
        const leituras = [];
        let texto = "";
        // `origem`: onde o recorte fica na carta ("base", "topo"; vazio = a
        // carta inteira) — vira pista do jogo em detectarJogo. `nome`: só pro
        // relatório do diagnóstico.
        const passo = async (canvas, origem, nome) => {
          const t1 = performance.now();
          const r = await ocr(worker, canvas);
          texto += (texto ? "\n" : "") + r.texto;
          const lidos = extrair(r.texto, r.palavras).map((x) => Object.assign(x, { origem: origem || "" }));
          leituras.push(lidos);
          if (dg) {
            dg.passos.push({
              nome, w: canvas.width, h: canvas.height, ms: performance.now() - t1, texto: r.texto,
              cands: lidos.map((x) => ({ codigo: x.codigo, peso: x.peso, conf: x.conf })),
              img: copiaDiag(canvas, 0, 0, canvas.width, canvas.height, 600)
            });
          }
          // Sai o que o catálogo desmente ("YOU 4": não há set YOU) — antes de
          // o candidato contar como "forte" e encerrar os passes.
          return filtrarPorIndice(juntar(leituras), indice);
        };
        // LÊ, CONFERE, CONTINUA (2026-11-10). Antes as passadas paravam no
        // primeiro candidato "forte" e só então vinha a busca: um "10/41"
        // lido do texto da carta encerrava a leitura antes de o código de
        // verdade aparecer. Agora, a cada passada que traz candidato novo, a
        // busca roda e a FOTO responde: confirmou, acabou; não confirmou,
        // vem a passada seguinte (outro tratamento, outra escala, o topo, a
        // carta inteira). O que a foto não confirmar até o fim passa pela
        // busca completa — vizinhos de dígito e de set — e, se sobrar, entra
        // em dúvida. A carta fácil sai na primeira passada, como antes.
        const carta = cartaNoQuadro(fonte, rec);
        if (dg) dg.carta = carta ? "achada" : "nao";
        const fotos = fotosDoQuadro(fonte, rec, carta);
        const tentados = new Set();
        const memo = new Map();
        let cands = [], deteccao = detectarJogo("", [], sessao, {}, indice), r = null;
        const origens = () => cands.reduce((o, c) => { o[c.codigo] = c.origem; return o; }, {});
        const orfaos = () => orfaosDoIndice(juntar(leituras), indice);
        // SET TRAVADO E APRENDIDO: a foto contra as artes do set, antes de
        // qualquer OCR. Apontou UMA carta, acabou (é a leitura de meio
        // segundo); apontou a arte mas não a versão (foil, reimpressão no
        // mesmo set), o OCR ainda roda pra o código separar, e a arte fica de
        // reserva; não apontou nada, segue pelo código, como antes.
        const pelaArte = trava ? pelaArteDoSet(trava, fotos) : null;
        if (pelaArte && pelaArte.foto.claro) r = pelaArte;
        for (const [nome, fx, fy, fw, fh, largura, modo, origem] of (r ? [] : planoDasPassadas(jogoSabido()))) {
          cands = await passo(recorte(fonte, rec, fx, fy, fw, fh, largura, modo), origem, nome);
          deteccao = detectarJogo(texto, cands.map((c) => c.codigo), sessao, origens(), indice);
          // Só vale buscar de novo se a passada trouxe candidato que ainda
          // não foi tentado (com o set travado, qualquer texto novo serve:
          // as palavras dele são comparadas com os números do set).
          const novos = cands.concat(orfaos()).filter((c) => c.peso >= 1 && !tentados.has(c.codigo));
          if (novos.length || trava) {
            novos.forEach((c) => tentados.add(c.codigo));
            const rr = await procurarComFoto(cands, orfaos(), fotos, deteccao, texto, { rapido: true, memo });
            if (rr.estado === "certo" || rr.estado === "semfoto") { r = rr; break; }
          }
          if (performance.now() - t0 > TETO_PASSADAS) break;
        }
        const codigos = cands.map((c) => c.codigo);
        ultimoTexto = texto;
        ultimasOrigens = origens();
        if (dg) {
          dg.jogo = { pontos: deteccao.pontos, confiante: deteccao.confiante, busca: jogosDaBusca(codigos), trava: trava ? trava.nome : "" };
        }
        // O seletor de jogo é SÓ da pessoa (2026-09-10). Antes, uma detecção
        // confiante gravava o jogo no seletor — e o seletor preenchido vale
        // como filtro FIXO em jogosDaBusca, sem a segunda chance sem filtro.
        // Resultado: lia um Pokémon (achava), o seletor virava "Pokémon", e a
        // carta seguinte de One Piece ou Magic "não existia". Em "Automático"
        // cada leitura detecta o jogo de novo pelas pistas da própria carta
        // (o cartão de resultado já diz qual foi); escolher um jogo no seletor
        // é a forma de FORÇAR um só, quando a detecção errar.
        // Sem código nenhum só há o que procurar com o set travado (as
        // palavras do texto contra os números do set).
        if (!r && !cands.length && !trava && !orfaos().length) { if (dg) dg.ms = performance.now() - t0; entregar({ codigo: "", achados: [], estado: "nada" }, auto); return; }
        // A foto confere TODA leitura, ANTES de o resultado aparecer — trocar
        // a carta depois de mostrada confundiria, e um "+ Coleção" rápido
        // gravaria a errada. O quadro congelado ainda está vivo aqui. Nada
        // confirmado nas passadas: a busca completa, com os vizinhos.
        if (!r) r = await procurarComFoto(cands, orfaos(), fotos, deteccao, texto, { memo });
        // O código não fechou e a arte tinha apontado a carta: vale a arte,
        // com as versões pra conferir.
        if (pelaArte && r.estado !== "certo") r = pelaArte;
        if (dg) {
          Object.assign(dg, {
            busca: { codigo: r.codigo, n: r.achados.length, cartas: r.achados.slice(0, 3).map((h) => h.card.name) },
            foto: r.foto ? Object.assign({ estado: r.estado, corrigido: !!r.corrigido, arte: !!r.arte }, r.foto) : (r.achados.length || r.negou ? { estado: r.estado, negou: !!r.negou } : null),
            ms: performance.now() - t0
          });
        }
        entregar(r, auto);
      } catch (e) {
        falhou = true;
        if (dg) Object.assign(dg, { erro: String((e && e.message) || e), ms: performance.now() - t0 });
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
        emDuvida = false;   // a pessoa digitou o código: não é mais leitura em dúvida
        trocaConta = false; // o 1º aqui é da busca digitada, não da leitura
        // A folha é "Corrigir leitura": o que foi achado digitando é a carta
        // da leitura mais recente (ou do item em conferência), não uma a mais.
        if (achados.length && !editando) {
          itemAtual = itemAtual ? corrigirItem(itemAtual, achados[0], 1) : somarItem(achados[0], 1, false, achados);
          salvarLista();
          pintarBotaoLista();
        }
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
    // A foto agora sai da RAJADA (o quadro mais nítido de 3-4, ver rajada); o
    // congelar() de um quadro só fica de reserva, se a rajada falhar.
    async function lerAgora(auto) {
      if (!stream || !video.videoWidth || ocupado || disparando) return;
      const rec = recorteDaGuia(video, wrap, guia);
      disparando = true;
      btnLer.disabled = true;
      guia.classList.add("is-lendo");
      let cap = null;
      try { cap = await rajada(rec, auto ? RAJADA.auto : RAJADA.toque); } catch (e) { cap = null; }
      disparando = false;
      // Fechou, ou a busca digitada ocupou o leitor durante a rajada: descarta.
      if (!stream || ocupado) {
        if (cap) cap.canvas.width = cap.canvas.height = 0;
        guia.classList.remove("is-lendo");
        if (stream) btnLer.disabled = false;
        return;
      }
      captura = cap;
      const quadro = cap ? cap.canvas : congelar();
      try { await ler(quadro || video, rec, auto); }
      finally { captura = null; if (quadro) quadro.width = quadro.height = 0; } // zerar libera o buffer (~44 MB em 4K)
    }
    // Segurar o disparador ~1,2 s liga/desliga o diagnóstico; o clique que
    // vem ao soltar não lê (o `segurou` engole ele).
    let tmSegura = 0, segurou = false;
    btnLer.addEventListener("pointerdown", () => {
      segurou = false;
      clearTimeout(tmSegura);
      tmSegura = setTimeout(() => { segurou = true; alternarDiag(); }, 1200);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((tipo) => btnLer.addEventListener(tipo, () => clearTimeout(tmSegura)));
    btnLer.addEventListener("contextmenu", (ev) => ev.preventDefault());
    btnLer.addEventListener("click", async () => {
      if (segurou) { segurou = false; return; } // foi o toque longo do diagnóstico
      if (som.on) contextoAudio(); // dentro do toque: é o que o Safari exige pra tocar depois
      await lerAgora(false);
    });
    // Com a leitura automática ninguém toca no disparador: qualquer toque no
    // scanner (a lista, o "+ Coleção", a própria tela) serve pra liberar o
    // áudio do Safari antes da próxima carta.
    wrap.addEventListener("pointerdown", () => { if (som.on) contextoAudio(); }, { passive: true });
    btnAuto.addEventListener("click", () => {
      autoLigado = !autoLigado;
      try { localStorage.setItem(CHAVE_AUTO, autoLigado ? "1" : "0"); } catch (e) { /* vale só nesta sessão */ }
      estAuto = { armado: true, parados: 0 }; // ligou com a carta já no quadro: lê
      dicaFalha = "";
      pintarAuto();
      if (!ocupado) pronto();
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
      if (ev.target.closest("[data-scan-diag-abrir]")) { abrirFolha(true); return; }
      const copiar = ev.target.closest("[data-scan-diag-copiar]");
      if (copiar) { copiarDiag(copiar); return; }
      if (ev.target.closest("[data-scan-backdrop]") || ev.target.closest(".scan-sheet-handle")) {
        if (!folhaSets.hidden) fecharSets(); else if (!folhaLista.hidden) fecharLista(); else if (!folhaSom.hidden) fecharSom(); else fecharFolha();
        return;
      }
      const qtd = ev.target.closest("[data-scan-mais], [data-scan-menos]");
      if (qtd) {
        const mais = qtd.hasAttribute("data-scan-mais");
        const it = lista[Number(mais ? qtd.dataset.scanMais : qtd.dataset.scanMenos)];
        if (!it) return;
        if (mais) it.qtd += 1;
        else {
          it.qtd -= 1;
          it.adicionadas = Math.min(it.adicionadas, it.qtd); // a lista é histórico: a coleção não muda
          if (it.qtd <= 0) { lista.splice(lista.indexOf(it), 1); if (itemAtual === it) itemAtual = null; }
        }
        salvarLista();
        pintarBotaoLista();
        return;
      }
      const conf = ev.target.closest("[data-scan-conferir]");
      if (conf) {
        const it = lista[Number(conf.dataset.scanConferir)];
        if (!it) return;
        resultados = it.alternativas.slice();
        emDuvida = false;
        primario = Math.max(0, resultados.findIndex((h) => h.card.id === it.card.id && h.game === it.game));
        codigoAtual = it.card.number || "";
        trocaConta = false;
        folhaLista.hidden = true;
        abrirFolha();
        editando = it;
        voltarPraLista = true;
        return;
      }
      if (ev.target.closest("[data-scan-lista-add]")) { adicionarLista(); return; }
      if (ev.target.closest("[data-scan-lista-limpar]")) { limparLista(); return; }
      if (ev.target.closest("[data-scan-som]")) { abrirSom(); return; }
      const teste = ev.target.closest("[data-scan-som-teste]");
      if (teste) { const k = teste.dataset.scanSomTeste; tocar(SONS[k]); shared.vibrar(VIBRA[k]); return; }
      if (ev.target.closest("[data-scan-more]")) { abrirFolha(); return; }
      if (ev.target.closest("[data-scan-trava]")) {
        if (trava) destravar();
        else if (resultados[primario]) travar(resultados[primario]);
        // Sem carta lida: a lista de sets. Sem índice (dev, rede fora), só a dica.
        else indiceDeSets().then((m) => { indice = m; if (m.sets && m.sets.length) abrirSets(); else dizer(t("scan.lockHint")); });
        return;
      }
      const op = ev.target.closest("[data-scan-set-op]");
      if (op) {
        const st = setsNaTela[Number(op.dataset.scanSetOp)];
        fecharSets();
        if (st) travarEm({ game: st.game, setId: st.id, set: st.name, lang: st.lang });
        return;
      }
      if (ev.target.closest("[data-scan-trava-folha]")) {
        const h = resultados[primario];
        if (h && trava && trava.chave === chaveSet(h)) destravar(); else if (h) travar(h);
        return;
      }
      if (ev.target.closest("[data-scan-lote]")) { abrirLista(); return; }
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
        emDuvida = false; // a pessoa escolheu a carta: a dúvida acabou
        // Escolher a certa corrige a lista: o item em conferência inteiro, ou
        // só a cópia da leitura mais recente.
        if (editando && resultados[i]) corrigirItem(editando, resultados[i], Infinity);
        else if (itemAtual && resultados[i]) itemAtual = corrigirItem(itemAtual, resultados[i], 1);
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
    pintarAuto();
    restaurarLista();
    abrirCamera();
    if (opc && opc.set && opc.set.game) travarEm(opc.set);
    // Aquece o motor enquanto a pessoa enquadra: na primeira vez é o download
    // dos ~3,5 MB, que assim acontece ANTES do toque no disparador.
    // A leitura automática começa quando o motor está pronto (antes disso o
    // laço só atrapalharia a dica de "Preparando o leitor").
    obterWorker(progresso).then(() => {
      motorPronto = true;
      // Sem câmera (só a galeria), o "Preparando o leitor…" ficava na tela pra
      // sempre: quem tira a dica de progresso é o pronto(), que só rodava
      // com câmera.
      if (!ocupado) { if (stream) pronto(); else dizer(t("scan.status.nocam")); }
      if (!tmAuto) tickAuto();
    }).catch(() => dizer(t("scan.error")));
  }

  window.TCGScan = {
    abrir, extrair, extrairCodigos, juntar, soDigitos, detectarJogo,
    integral, assinatura, semelhanca, assinaturasDoQuadro, ordemPelaFoto,
    numeroDe, noSet,
    casaCodigo, chaveDoSet, filtrarPorIndice, orfaosDoIndice, escolherPelaArte, filtrarSets, vizinhosDoNumero, vizinhosDoSet, estadoDaFoto, cartasPelasPalavras, montarIndice,
    faixaDePreco, configSom, SONS, VIBRA,
    medirQuadro, passoAuto, dicaDoQuadro, varianteDe, AUTO,
    cinzaDe, nitidez, relatorio,
    acharCarta, realcarLocal, planoDasPassadas
  };
})();
