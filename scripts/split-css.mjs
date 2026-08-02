// Reparte o styles.css em um NÚCLEO (o que toda página usa) + folhas por ÁREA,
// carregadas só por quem precisa. A landing, o login, os decks, o portfólio, a
// wishlist, as vendas, a ajuda e as telas de conta somam ~85 KB de CSS que as
// outras 20 e poucas páginas baixavam à toa.
//
// Roda NO DEPLOY (com --write), antes da minificação: reescreve o styles.css como
// núcleo, cria os styles-<área>.css, liga o <link> nas páginas certas e registra
// as folhas novas no service worker. Tudo só no workspace do runner — o
// repositório continua com UM styles.css, que é onde se edita. Sem --write o
// script só relata o que sairia, pra conferir antes.
//
// Conferência: scratchpad/diffstyle.mjs compara o estilo COMPUTADO de cada
// elemento das 17 páginas principais, antes e depois. A meta é zero diferença —
// e é assim que as exceções abaixo foram descobertas.
//
// ── A parte delicada: ORDEM DA CASCATA ──────────────────────────────────────
// Em CSS, com a mesma especificidade, quem vem DEPOIS ganha. As folhas por área
// carregam DEPOIS do núcleo, então toda regra que sai daqui passa a valer mais
// do que valia. Isso quebraria o passe FLAT do fim do arquivo, que zera o
// border-radius de uma lista enorme de seletores — inclusive de página: mover
// `.pf-comp-track` pra folha do portfólio faria o raio dele VOLTAR.
//
// Por isso a extração tem duas regras:
//   1. Só sai o bloco cujos seletores são TODOS da área. Bloco que mistura
//      seletor de página com seletor global fica no núcleo (senão o global some).
//   2. Bloco misto que CITA um seletor da área tem esse seletor copiado pro fim
//      da folha, na ordem original. Assim o resultado final continua o mesmo.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const ESCREVER = process.argv.includes("--write");

// Área -> prefixos de classe. Só entram prefixos que o
// scripts/check.mjs confere serem de uma página só (ou de um par).
const AREAS = [
  { nome: "landing",   prefixos: ["lp-"],                          paginas: ["index.html"] },
  { nome: "login",     prefixos: ["login-"],                       paginas: ["login.html"] },
  { nome: "decks",     prefixos: ["deck"],                         paginas: ["decks.html", "my-decks.html"] },
  { nome: "portfolio", prefixos: ["pf-"],                          paginas: ["portfolio.html"] },
  // sw- (as pastilhas de cor por jogo) só existe no settings.html e vive LOGO
  // DEPOIS do .setting-swatch, sobrescrevendo a cor do texto dele. Se um sai e o
  // outro fica, a ordem inverte e a pastilha muda de cor — por isso viajam juntos.
  { nome: "conta",     prefixos: ["setting-", "profile-", "admin-", "sw-"], paginas: ["settings.html", "profile.html", "admin.html"] },
  { nome: "wishlist",  prefixos: ["wish-"],                        paginas: ["wishlist.html"] },
  { nome: "vendas",    prefixos: ["sold-"],                        paginas: ["sales.html"] },
  { nome: "ajuda",     prefixos: ["help-"],                        paginas: ["help.html"] }
];

// Comentários SAEM antes de qualquer parsing. Não é economia — é correção:
// quatro comentários do styles.css citam CSS dentro do texto ("select{width:100%}",
// "button { min-height: 42px }"), e uma chave dentro de comentário dessincroniza
// qualquer contagem de blocos daqui pra frente — o arquivo inteiro sai errado, e
// erra CALADO (foi o que aconteceu na primeira versão deste script: o cabeçalho
// mudava em toda página). Podem sair sem dó: este script roda no deploy, ANTES da
// minificação, que descartaria os comentários de qualquer jeito. O styles.css do
// repositório, com a documentação toda, fica intacto.
const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "\n");

// ── Varre o CSS em blocos de topo, preservando @media/@supports ─────────────
// Devolve [{ tipo: "regra"|"at", seletor, corpo, texto, inicio }]. Dentro de um
// @media a gente desce um nível: as regras de lá também podem ser de área.
function blocos(texto) {
  const saida = [];
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf("{", i);
    if (abre < 0) { saida.push({ tipo: "solto", texto: texto.slice(i) }); break; }
    const prefixo = texto.slice(i, abre);
    let nivel = 1, k = abre + 1;
    while (k < texto.length && nivel) {
      if (texto[k] === "{") nivel++;
      else if (texto[k] === "}") nivel--;
      k++;
    }
    const seletor = prefixo.trim();
    saida.push({
      tipo: /^@(media|supports|container)\b/.test(seletor) ? "at" : "regra",
      seletor,
      bruto: texto.slice(i, k),
      corpo: texto.slice(abre + 1, k - 1),
      abertura: prefixo
    });
    i = k;
  }
  return saida;
}

// Classes que PARECEM de área mas não podem sair: alguma regra posterior do
// núcleo depende de vir depois delas. `.pf-head` é do portfólio, mas o
// `.dash-head` que o segue é compartilhado com dashboard/badges/vendas — mover só
// um dos dois inverte a ordem e muda o layout do cabeçalho.
// Esta lista é o resultado do diff de estilo computado (scratchpad/diffstyle.mjs)
// entre antes e depois: qualquer classe que apareça lá entra aqui.
const FICA_NO_NUCLEO = new Set(["pf-head"]);

// Um seletor "é da área" quando cita alguma das classes dela.
const daArea = (seletor, prefixos) => {
  for (const classe of FICA_NO_NUCLEO) {
    if (new RegExp(`\\.${classe}\\b`).test(seletor)) return false;
  }
  return prefixos.some((p) => new RegExp(`\\.${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\w-]*`).test(seletor));
};

// Lista de seletores separada por vírgula, ignorando vírgulas dentro de :is()/:not().
function listaSeletores(seletor) {
  const partes = [];
  let atual = "", profundidade = 0;
  for (const ch of seletor) {
    if (ch === "(") profundidade++;
    else if (ch === ")") profundidade--;
    if (ch === "," && !profundidade) { partes.push(atual.trim()); atual = ""; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

const topo = blocos(css);
const nucleo = [];
const porArea = new Map(AREAS.map((a) => [a.nome, []]));
let movidos = 0, copiados = 0;

function classifica(bloco, dentroDe) {
  // @media e afins: desce um nível e classifica cada regra de dentro. O que for
  // de área viaja com o mesmo @media em volta, pra a condição continuar valendo.
  if (bloco.tipo === "at" || /^@(media|supports|container)/.test(bloco.seletor)) {
    const internos = blocos(bloco.corpo);
    const restantes = [];
    const daAreaPorNome = new Map();
    for (const interno of internos) {
      const resultado = classifica(interno, bloco.abertura);
      if (resultado.paraNucleo) restantes.push(resultado.paraNucleo);
      for (const [area, texto] of resultado.paraArea) {
        if (!daAreaPorNome.has(area)) daAreaPorNome.set(area, []);
        daAreaPorNome.get(area).push(texto);
      }
    }
    const paraArea = [];
    for (const [area, textos] of daAreaPorNome) {
      paraArea.push([area, `${bloco.abertura.trim()} {\n${textos.join("")}\n}\n`]);
    }
    const sobrou = restantes.join("").trim();
    return { paraNucleo: sobrou ? `${bloco.abertura}{\n${restantes.join("")}}\n` : "", paraArea };
  }
  if (bloco.tipo === "solto") return { paraNucleo: bloco.texto, paraArea: [] };

  const partes = listaSeletores(bloco.seletor);
  const paraArea = [];
  let paraNucleo = bloco.bruto;

  for (const area of AREAS) {
    const daDela = partes.filter((s) => daArea(s, area.prefixos));
    if (!daDela.length) continue;
    if (daDela.length === partes.length) {
      // Bloco 100% da área: sai inteiro.
      paraArea.push([area.nome, bloco.bruto]);
      paraNucleo = "";
      movidos++;
    } else {
      // Bloco MISTO: fica no núcleo sem os seletores da área, e uma cópia só com
      // eles vai pra folha — na mesma posição relativa, pro resultado não mudar.
      const restantes = partes.filter((s) => !daDela.includes(s));
      paraNucleo = `${restantes.join(",\n")} {${bloco.corpo}}`;
      paraArea.push([area.nome, `${daDela.join(",\n")} {${bloco.corpo}}`]);
      copiados++;
    }
  }
  return { paraNucleo, paraArea };
}

for (const bloco of topo) {
  const { paraNucleo, paraArea } = classifica(bloco);
  if (paraNucleo) nucleo.push(paraNucleo);
  for (const [area, texto] of paraArea) porArea.get(area).push(texto);
}

const cabecalho = (area) => `/* ${area.nome.toUpperCase()} — fatia do styles.css usada só por ${area.paginas.join(", ")}.
   GERADO por scripts/split-css.mjs; edite o styles.css e rode de novo.
   Carrega DEPOIS do styles.css: a ordem da cascata é preservada porque os
   seletores mistos vieram junto, na posição original (ver o script). */
`;

const novoNucleo = nucleo.join("");
console.log(`núcleo: ${css.length} -> ${novoNucleo.length} bytes (${movidos} blocos movidos, ${copiados} recortados)`);
for (const area of AREAS) {
  const corpo = porArea.get(area.nome).join("\n");
  console.log(`  styles-${area.nome}.css: ${corpo.length} bytes  (${area.paginas.join(", ")})`);
  if (ESCREVER) writeFileSync(`styles-${area.nome}.css`, cabecalho(area) + corpo, "utf8");
}
if (!ESCREVER) { console.log("\n(simulação — rode com --write pra gravar)"); process.exit(0); }

writeFileSync("styles.css", novoNucleo, "utf8");

// ── Liga a folha nas páginas dela ──────────────────────────────────────────
for (const area of AREAS) {
  for (const pagina of area.paginas) {
    const html = readFileSync(pagina, "utf8");
    const tag = `<link rel="stylesheet" href="styles-${area.nome}.css">`;
    if (html.includes(tag)) continue;
    const alvo = `<link rel="stylesheet" href="styles.css">`;
    if (!html.includes(alvo)) { console.error(`split-css: ${pagina} não tem o <link> do styles.css`); process.exit(1); }
    writeFileSync(pagina, html.replace(alvo, `${alvo}\n    ${tag}`), "utf8");
  }
}

// O service worker precisa saber das folhas novas (shell offline).
const sw = readFileSync("sw.js", "utf8");
const novas = AREAS.map((a) => `"styles-${a.nome}.css"`).join(", ");
if (!sw.includes("styles-landing.css")) {
  writeFileSync("sw.js", sw.replace('"styles.css",', `"styles.css", ${novas},`), "utf8");
}
console.log("\npronto: HTMLs e sw.js atualizados.");
