// Caçador de logos de set: as peças PURAS (sem rede, sem sharp), pra que o
// tests/cacar-logos-set.test.mjs teste no CI o que decide QUAL imagem vira
// logo e COMO o catálogo é remendado. Rede, sharp e arquivos ficam no
// scripts/cacar-logos-set.mjs.
//
// Por que existe (2026-10-17): logo de set novo entrava à mão (Hyperia City do
// Lorcana na PR #197, OP-17 do One Piece na PR #199). O caçador roda toda
// semana no GitHub Actions e PROPÕE numa PR; quem decide é o Fernando. Escolher
// a imagem errada é o risco principal: na página do OP-17 o "logo.webp" era o
// selo de 4º aniversário, e o título do set estava em mv/pc/title.webp. Por
// isso a identidade vem do ALT da imagem (nome ou código do set), não do nome
// do arquivo.
import { slug, winSafeName } from "./sync-common.mjs";

export const UA = "Mozilla/5.0 (Sleevu set logo hunter; sleevu.app)";

// ── Texto ───────────────────────────────────────────────────────────────────
// Compara nomes: sem acento, sem apóstrofo (’ e '), minúsculas, pontuação vira
// espaço. "THE WORLD’S STRONGEST WARRIORS" = "The World's Strongest Warriors".
export function norm(s) {
  return String(s || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/ð/gi, "d").toLowerCase().replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const ENTIDADES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };
export function decodifica(s) {
  return String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

// ── Catálogo versionado (data/<jogo>/cards.js) ──────────────────────────────
const PREFIXO = "window.TCG_CARDS = ";

// O remendo regrava com JSON.stringify, então só vale se a ida e volta for
// idêntica byte a byte — é o formato do writeGameCatalog. Arquivo formatado à
// mão para aqui, em vez de o caçador reescrever o catálogo inteiro na PR.
export function lerCatalogo(texto) {
  if (!texto.startsWith(PREFIXO)) throw new Error("cards.js fora do formato `window.TCG_CARDS = [...];`");
  // ";\r\n" é o checkout do Windows (autocrlf): o git devolve LF no commit.
  const fim = [";\r\n", ";\n", ";"].find((f) => texto.endsWith(f));
  if (!fim) throw new Error("cards.js sem o `;` final");
  const cards = JSON.parse(texto.slice(PREFIXO.length, texto.length - fim.length));
  if (PREFIXO + JSON.stringify(cards) + fim !== texto) {
    throw new Error("cards.js não é o JSON compacto do writeGameCatalog (a ida e volta mudaria o arquivo)");
  }
  return { cards, fim };
}

// setId -> { setId, nome, data, cartas, semLogo, logo }
export function setsDoCatalogo(cards) {
  const sets = new Map();
  for (const c of cards) {
    const id = String((c && c.setId) || "");
    if (!id) continue;
    let s = sets.get(id);
    if (!s) sets.set(id, (s = { setId: id, nome: c.set || id, data: c.setReleaseDate || "", cartas: 0, semLogo: 0, logo: "" }));
    s.cartas++;
    if (c.setLogo) s.logo = s.logo || c.setLogo;
    else s.semLogo++;
  }
  return sets;
}

// Põe `caminho` no setLogo VAZIO das cartas dos setIds e confere o delta de
// bytes: cada carta remendada ganha exatamente o tamanho do caminho (o campo
// já existia como ""). Qualquer outra diferença = o remendo mexeu no que não
// devia, e para.
export function remendaCatalogo(texto, setIds, caminho) {
  const { cards, fim } = lerCatalogo(texto);
  const alvo = new Set([...setIds].map(String));
  let cartas = 0;
  for (const c of cards) {
    if (alvo.has(String(c.setId)) && c.setLogo === "") { c.setLogo = caminho; cartas++; }
  }
  const novo = PREFIXO + JSON.stringify(cards) + fim;
  const delta = Buffer.byteLength(novo) - Buffer.byteLength(texto);
  const esperado = cartas * Buffer.byteLength(JSON.stringify(caminho).slice(1, -1));
  if (delta !== esperado) throw new Error(`o remendo do cards.js mudou ${delta} bytes; o esperado era ${esperado} (${cartas} cartas × caminho)`);
  return { texto: novo, cartas, delta };
}

// ── Jogos com fonte ─────────────────────────────────────────────────────────
// `arquivo`: o nome que o SYNC do jogo procura em data/<jogo>/set-logos/ para
// aquele setId (null = o sync não liga logo local a esse setId, então não
// adianta propor). `guarda`: trechos que o sync precisa ter pra o arquivo
// local vencer a fonte remota; sem eles o logo da PR some no próximo build
// completo, e o caçador pula o jogo (o sync-onepiece ganhou a guarda na PR
// #199). `doSync`: as cartas que ESSE sync escreve — o cards.js do One Piece
// também carrega as linhas vintage (opcd-, op2002-), que têm sync próprio e
// não leem set-logos/. O tests/cacar-logos-set.test.mjs confere tudo isso
// contra os syncs.

// Igual ao baseCode do sync-onepiece: "OP04 PRE"/"OP15 RE"/"ST-30" -> "op04"/
// "op15"/"st30". RE/PRE herdam o logo do set base, como no sync.
export function codigoOnePiece(setId) {
  const m = String(setId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^(OP|EB|PRB|ST)(\d+)/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

const SETID_SIMPLES = /^[A-Za-z0-9_-]+$/;
export const JOGOS = {
  lorcana: {
    sync: "sync-lorcana.mjs",
    guarda: ["hasLocal(", "data/lorcana/set-logos/"],
    doSync: () => true,
    arquivo: (setId) => (SETID_SIMPLES.test(setId) ? `${setId}.png` : null),
    fontes: "página do produto (disneylorcana.com) + wiki da Fandom"
  },
  onepiece: {
    sync: "sync-onepiece.mjs",
    guarda: ["localLogo(code)", "data/onepiece/set-logos/"],
    doSync: (c) => /^op-\d+$/.test(String(c.id)),
    arquivo: (setId) => { const c = codigoOnePiece(setId); return c ? `${c}.webp` : null; },
    fontes: "páginas de produto da Bandai (EN, JP, Asia-EN)"
  },
  fab: {
    sync: "sync-fab.mjs",
    guarda: ["localLogo(c.setId)", "data/fab/set-logos/"],
    doSync: (c) => /^fab-/.test(String(c.id)),
    arquivo: (setId) => (SETID_SIMPLES.test(setId) ? `${winSafeName(String(setId).toUpperCase())}.webp` : null),
    fontes: "the-fab-cube (set.json, set_logo)"
  }
};

export const temGuarda = (fonteDoSync, jogo) => JOGOS[jogo].guarda.every((t) => fonteDoSync.includes(t));

// Por que cada jogo SEM fonte fica de fora (vai pro relatório). Jogo novo
// que não está em JOGOS nem aqui aparece como "sem fonte de logo conhecida".
export const FORA = {
  pokemon: "logos pelo mirror-set-logos (EN/PT) e mirror-ja-set-logos (JA) no build",
  magic: "símbolo de set pelo mirror-magic-set-logos no build",
  swu: "logo oficial pelo mirror-swu-set-logos no build completo (o que falta é promo)",
  gundam: "sem logo de set publicado (os 3 sites oficiais auditados em 2026-07-27)",
  weiss: "sem logo de set publicado (media kit auditado em 2026-10-01)",
  harrypotter: "logos recortados à mão do Wayback; o resto não tem logo publicado",
  cyberpunk: "logo curado à mão; sem fonte automática",
  ygo: "sem fonte de logo de set (o sync grava vazio)",
  digimon: "sem fonte de logo de set (o sync grava vazio)",
  dbfw: "sem fonte de logo de set (o sync grava vazio)",
  riftbound: "sem fonte de logo de set (o sync grava vazio)",
  unionarena: "sem fonte de logo de set (o sync grava vazio)",
  sorcery: "sem fonte de logo de set (o sync grava vazio)",
  wow: "vintage sem logo de set publicado",
  lotr: "vintage sem logo de set publicado",
  naruto: "logo de linha/título vem do sync; os capítulos sem logo não têm um publicado"
};

// Produto que não é set: o tile mostra o nome e está certo assim.
export const PROMO = /\b(?:promos?|promotion(?:al)?|pre-?release|release event|judge|convention|weekly play|gift box|demo deck|box toppers?|prize|championship|regionals?|organized play|event exclusive|tournament pack)\b/i;

// Agrupa os sets sem logo pelo ARQUIVO de destino (no One Piece, "OP17" e
// "OP17 RE" dividem o op17.webp, como no sync) e separa o que não se procura.
//   cards: o cards.js inteiro do jogo
//   ignorar: { setId|nomeDoArquivoSemExtensão: motivo } do jogo
//   existe(arquivo): o arquivo já está em set-logos/
export function alvosDoJogo(jogo, cards, { ignorar = {}, existe = () => false } = {}) {
  const cfg = JOGOS[jogo];
  const doSync = setsDoCatalogo(cards.filter(cfg.doSync));
  const grupos = new Map();
  const pulados = [];
  for (const s of setsDoCatalogo(cards).values()) {
    if (!s.semLogo) continue;
    if (!doSync.has(s.setId)) { pulados.push({ ...s, motivo: `linha à parte (não vem do ${cfg.sync})` }); continue; }
    const arquivo = cfg.arquivo(s.setId);
    if (!arquivo) { pulados.push({ ...s, motivo: "o sync não liga logo local a este setId" }); continue; }
    if (!grupos.has(arquivo)) grupos.set(arquivo, []);
    grupos.get(arquivo).push(s);
  }
  const alvos = [];
  for (const [arquivo, membros] of grupos) {
    const base = arquivo.replace(/\.[a-z]+$/i, "");
    const motivo = membros.map((m) => ignorar[m.setId]).find(Boolean) || ignorar[base];
    if (motivo) { for (const m of membros) pulados.push({ ...m, motivo: `lista de exclusão: ${motivo}` }); continue; }
    const principal = membros.find((m) => !PROMO.test(m.nome));
    if (!principal) { for (const m of membros) pulados.push({ ...m, motivo: "promo" }); continue; }
    if (existe(arquivo)) {
      for (const m of membros) pulados.push({ ...m, motivo: `set-logos/${arquivo} já existe (o próximo build completo liga)` });
      continue;
    }
    alvos.push({ jogo, arquivo, principal, setIds: membros.map((m) => m.setId), cartas: membros.reduce((a, m) => a + m.semLogo, 0) });
  }
  // Mais novo primeiro: com teto de alvos por rodada, set recém-lançado vence.
  alvos.sort((a, b) => String(b.principal.data).localeCompare(String(a.principal.data)) || a.arquivo.localeCompare(b.arquivo));
  return { alvos, pulados };
}

// ── HTML das páginas oficiais ───────────────────────────────────────────────
export function atributos(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = decodifica(m[2] ?? m[3]);
  }
  return out;
}

// URL de maior densidade de um srcset ("a.webp, a@2x.webp 2x").
export function urlDoSrcset(srcset) {
  const partes = String(srcset || "").split(",").map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);
  if (!partes.length) return "";
  const dens = (p) => { const d = p[1] || "1x"; const n = parseFloat(d); return Number.isFinite(n) ? (d.endsWith("w") ? n / 1000 : n) : 1; };
  return partes.sort((a, b) => dens(b) - dens(a))[0][0];
}

// Cada <img> da página com o alt e as variantes dos <source> do MESMO
// <picture> (é onde a Bandai põe a versão pc, maior).
export function imagensDaPagina(html) {
  const imgs = [];
  const resto = String(html).replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi, (_, dentro) => {
    const tag = dentro.match(/<img\b[^>]*>/i);
    const a = tag ? atributos(tag[0]) : {};
    const variantes = [...dentro.matchAll(/<source\b[^>]*>/gi)]
      .map((m) => atributos(m[0]))
      .map((f) => ({ url: urlDoSrcset(f.srcset || f["data-srcset"]), media: f.media || "" }))
      .filter((v) => v.url);
    const src = a.src || a["data-src"] || urlDoSrcset(a.srcset);
    if (src || variantes.length) imgs.push({ src: src || variantes[0].url, alt: a.alt || "", variantes });
    return "";
  });
  for (const m of resto.matchAll(/<img\b[^>]*>/gi)) {
    const a = atributos(m[0]);
    const src = a.src || a["data-src"] || urlDoSrcset(a.srcset);
    if (src) imgs.push({ src, alt: a.alt || "", variantes: [] });
  }
  return imgs;
}

// <meta http-equiv="refresh" content="0; URL=./boosters/op17/"> -> "./boosters/op17/"
export function metaRefresh(html) {
  const tag = String(html).match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i);
  if (!tag) return null;
  const m = (atributos(tag[0]).content || "").match(/url\s*=\s*['"]?([^'";]+)/i);
  return m ? m[1].trim() : null;
}

// ── Lorcana ─────────────────────────────────────────────────────────────────
// Página do produto: disneylorcana.com/en-US/product/<slug>. O slug costuma
// ser o nome do set; quando não é ("Hunny Rescue – Illumineer's Quest" é
// great-hunny-rescue), os links de produto do menu da própria página dizem.
export function slugsDeProduto(html) {
  return [...new Set([...String(html).matchAll(/\/product\/([a-z0-9-]+)/g)].map((m) => m[1]))];
}
export function slugsParaTentar(nome, menu = []) {
  const inteiro = slug(nome);
  const curto = slug(String(nome).split(/\s[–—:-]\s|:\s/)[0]);
  const out = [inteiro];
  for (const s of menu) if (s !== inteiro && curto.length >= 4 && s.includes(curto)) out.push(s);
  return [...new Set(out)];
}

// A imagem do logo tem alt "<Set> Logo" ("Hyperia City Logo"); a marca do
// jogo ("Lorcana logo") não conta.
export function logoDaPaginaLorcana(html, nome) {
  const nomeN = norm(nome);
  for (const img of imagensDaPagina(html)) {
    const m = /^(.*)\blogo$/.exec(norm(img.alt));
    if (!m) continue;
    const x = m[1].trim();
    if (!x || x === "lorcana" || x === "disney lorcana") continue;
    if (x === nomeN || (x.length >= 4 && (nomeN.includes(x) || x.includes(nomeN)))) return { url: img.src, alt: img.alt };
  }
  return null;
}

// API da Fandom (list=allimages): o logo é o arquivo com o NOME do set
// ("Hyperia_City.png"); o resto do prefixo é caixa, pôster, mapa...
export function logosDaFandom(json, nome) {
  const nomeN = norm(nome);
  const lista = (json && json.query && json.query.allimages) || [];
  return lista
    .filter((i) => /\.(?:png|webp)$/i.test(i.name || ""))
    .filter((i) => {
      const base = norm(decodifica(String(i.name).replace(/\.[a-z]+$/i, "").replace(/_/g, " ")));
      return base === nomeN || base === `${nomeN} logo`;
    })
    .map((i) => ({ url: i.url, largura: i.width || 0, altura: i.height || 0, nome: i.name }))
    .sort((a, b) => b.largura - a.largura);
}

// ── One Piece (Bandai) ──────────────────────────────────────────────────────
// Logos do SITE (menu, marca, rodapé, selo de aniversário) e fotos de produto.
const FORA_BANDAI = /\/common\/|menulogo|logo_op[._]|logo_bcg|logo_tcg|bandai|metaverse|footer|anniv|4th|enquete|logo_dash|noimage|\/nav\/|\/howto\/|thumbnail|img_item|\/cards?\//i;

// Candidatos a logo numa página de produto, do melhor pro pior. O alt é a
// identidade: nas páginas novas ele traz o nome do produto com o código
// ("BOOSTER PACK -THE TIME OF BATTLE- [OP-16]"); na especial do OP-17, o nome do
// set ("THE WORLD’S STRONGEST WARRIORS"). Sem o alt bater, só title e
// logo_product passam — "logo" genérico era o selo do aniversário.
export function logosDaPaginaBandai(html, { codigo, nome }) {
  const nomeN = norm(nome);
  const m = /^([a-z]+)(\d+)$/.exec(String(codigo || ""));
  const reCodigo = m ? new RegExp(`(?:^| )${m[1]} ?${m[2]}(?: |$)`) : null;
  const out = [];
  for (const img of imagensDaPagina(html)) {
    const pc = img.variantes.find((v) => /min-width/i.test(v.media));
    const url = (pc && pc.url) || img.src;
    if (!url || !/\.(?:webp|png)(?:[?#]|$)/i.test(url) || FORA_BANDAI.test(url)) continue;
    const altN = norm(img.alt);
    const altBate = !!altN && ((nomeN.length >= 4 && altN.includes(nomeN)) || (!!reCodigo && reCodigo.test(altN)));
    let pontos = altBate ? 100 : 0;
    if (/title/i.test(url) || /logo_product/i.test(url)) pontos += 30;
    else if (/logo/i.test(url)) pontos += 10;
    if (/\/pc\/|[_/]pc_/i.test(url)) pontos += 5;
    if (/\/sp\/|[_/]sp_/i.test(url)) pontos -= 5;
    if (pontos < 30) continue;
    out.push({ url, alt: img.alt, pontos });
  }
  return out.sort((a, b) => b.pontos - a.pontos);
}

// ── FAB (the-fab-cube) ──────────────────────────────────────────────────────
// Por código (setId = abreviação do TCGplayer = id do the-fab-cube) ou, quando
// o TCGplayer não deu abreviação e o setId virou o groupId, pelo NOME exato
// ("High Seas" = SEA). Nome que bate em mais de um set do the-fab-cube = nada.
export function logoDoFabCube(sets, { setId, nome }) {
  const comLogo = (sets || [])
    .map((s) => ({ s, url: ((s.printings || []).find((p) => p.set_logo) || {}).set_logo }))
    .filter((x) => x.url && x.s.id);
  const id = String(setId).toUpperCase();
  const porCodigo = comLogo.find((x) => String(x.s.id).toUpperCase() === id);
  if (porCodigo) return { codigo: String(porCodigo.s.id).toUpperCase(), nome: porCodigo.s.name, url: porCodigo.url, por: "código" };
  const nomeN = norm(nome);
  const porNome = comLogo.filter((x) => norm(x.s.name) === nomeN);
  if (porNome.length !== 1) return null;
  return { codigo: String(porNome[0].s.id).toUpperCase(), nome: porNome[0].s.name, url: porNome[0].url, por: "nome" };
}

// ── Imagem ──────────────────────────────────────────────────────────────────
// Limpa o alfa de um RGBA cru (MUDA o buffer) e devolve a caixa do que sobrou:
//  1. véu: alfa < limiarAlfa vira 0 — fundo quase invisível escurece o chip
//     branco num retângulo (o mesmo corte do mirror-swu-set-logos);
//  2. manchas soltas: componente conectada (vizinhança de 8) com menos de
//     `fracaoMancha` da área da MAIOR vira transparente.
// "Só a maior componente" (o que se fez à mão no Hyperia City) apagaria
// palavras: medido em 2026-10-17 nos ~100 logos curados do repo, no Lorcana 12
// a maior mancha é 10,6% da área, os ST do One Piece têm o nome do deck
// separado do logo (~8.500 px) e quase todo logo do Star Wars é letra solta.
// Com 0,05% da maior cai só lixo e brilho — os 12 pontinhos (1–8 px) do Hyperia
// City da Fandom, os 490 fragmentos de brilho (até 37 px) do título do OP-17 e
// as purpurinas dos Lorcana 1/2/4 — e nenhuma parte de logo curado (a menor
// peça que talvez seja de verdade, no op05, tem 0,06%).
export function limpaAlfa(rgba, largura, altura, { limiarAlfa = 12, fracaoMancha = 0.0005 } = {}) {
  const n = largura * altura;
  let veu = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4 + 3;
    if (rgba[i] > 0 && rgba[i] < limiarAlfa) { rgba[i] = 0; veu++; }
    if (rgba[i] === 0) { rgba[i - 3] = 0; rgba[i - 2] = 0; rgba[i - 1] = 0; }
  }
  const rotulo = new Int32Array(n).fill(-1);
  const pilha = new Int32Array(n);
  const areas = [];
  for (let p = 0; p < n; p++) {
    if (rotulo[p] !== -1 || rgba[p * 4 + 3] === 0) continue;
    const id = areas.length;
    let topo = 0, area = 0;
    pilha[topo++] = p; rotulo[p] = id;
    while (topo) {
      const q = pilha[--topo]; area++;
      const x = q % largura, y = (q - x) / largura;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= altura) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= largura) continue;
          const r = ny * largura + nx;
          if (rotulo[r] === -1 && rgba[r * 4 + 3] !== 0) { rotulo[r] = id; pilha[topo++] = r; }
        }
      }
    }
    areas.push(area);
  }
  if (!areas.length) return { caixa: null, manchas: 0, veu, componentes: 0 };
  const limite = Math.max(...areas) * fracaoMancha;
  let manchas = 0;
  for (const a of areas) if (a < limite) manchas++;
  let x0 = largura, y0 = altura, x1 = -1, y1 = -1;
  for (let p = 0; p < n; p++) {
    const id = rotulo[p];
    if (id === -1) continue;
    if (areas[id] < limite) { const i = p * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; continue; }
    const x = p % largura, y = (p - x) / largura;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { caixa: { x0, y0, x1, y1, largura: x1 - x0 + 1, altura: y1 - y0 + 1 }, manchas, veu, componentes: areas.length };
}

// Escala pra caber em maxL × maxA (só reduz, a não ser que `aumenta`).
export function encaixa(largura, altura, maxL, maxA, { aumenta = false } = {}) {
  let k = Math.min(maxL / largura, maxA / altura);
  if (!aumenta) k = Math.min(1, k);
  return { largura: Math.max(1, Math.round(largura * k)), altura: Math.max(1, Math.round(altura * k)) };
}

// Duas imagens são a MESMA arte quando a proporção do que sobra depois do
// recorte bate (±4%): o logo oficial do Hyperia City (375×244) e o da Fandom
// (638×414) diferem 0,3%.
export function mesmaArte(a, b, tolerancia = 0.04) {
  const ra = a.largura / a.altura, rb = b.largura / b.altura;
  return Math.abs(ra - rb) / Math.max(ra, rb) <= tolerancia;
}
