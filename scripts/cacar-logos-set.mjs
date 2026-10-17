// Caçador de logos de set. Roda toda semana no GitHub Actions
// (.github/workflows/cacar-logos-set.yml) e PROPÕE, numa pull request, o logo
// dos sets que estão sem (setLogo vazio no data/<jogo>/cards.js versionado).
// Nunca publica sozinho: o Fernando confere a galeria e mescla, ou recusa.
//
// Fontes (as que os syncs e espelhos já usam, mais as que funcionaram à mão no
// Hyperia City e no OP-17 em 2026-10-17):
//   Lorcana    página do produto em disneylorcana.com (a imagem com alt "<Set>
//              Logo", no CDN da Ravensburger) e o wiki da Fandom (o arquivo
//              "<Set>.png", pela API; baixado com o Referer da Fandom, senão
//              volta HTML). A Fandom costuma ter a MESMA arte maior e vence
//              quando a proporção bate com a oficial. O MushuReport, fonte do
//              sync, está atrás do Cloudflare desde jul/2026.
//   One Piece  páginas de produto da Bandai (EN, JP, Asia-EN), seguindo o
//              <meta refresh> das páginas especiais. A identidade é o alt da
//              imagem (nome ou código do set); title e logo_product antes de
//              "logo", que no OP-17 era o selo do aniversário.
//   FAB        the-fab-cube (set.json, `set_logo`), o mesmo do
//              mirror-fab-set-logos, por código OU nome: vários sets novos não
//              têm abreviação no TCGplayer e o setId vira o groupId (24266 =
//              High Seas = SEA). Logo já espelhado em set-logos/<CÓDIGO>.webp é
//              reaproveitado em vez de baixado.
// Os outros jogos saem no relatório com o motivo (FORA em lib/logos-set.mjs).
//
// Só entra jogo cujo sync tem a guarda "logo local vence" (o arquivo em
// set-logos/ vence a fonte remota). Sem ela o logo da PR sumiria no próximo
// build completo; o jogo é pulado e o relatório diz por quê.
//
// Normalização, no padrão de cada jogo:
//   Lorcana    PNG com paleta 1000×500 transparente, logo encaixado em 970×470
//              (o padrão dos 14 curados);
//   One Piece  WebP transparente recortado no alfa (até 1000 px de largura);
//   FAB        WebP transparente recortado no alfa (até 600 px, como os do mirror).
// Em todos: zera o véu de alfa, tira as manchas soltas (limpaAlfa) e recorta.
//
// Precisa do sharp FORA do repositório (o site não tem package.json), como o
// mirror-swu-set-logos: SHARP_DIR aponta a pasta do pacote. Sem ele, só lista.
//   SHARP_DIR=<…>/node_modules/sharp node scripts/cacar-logos-set.mjs
//     --jogos lorcana,onepiece   só estes jogos
//     --seco                     logos e galeria só na pasta de saída (não toca data/)
//     --saida <pasta>            relatorio.md, relatorio.json e galeria.png
//                                (padrão: <tmp>/sleevu-logos-de-set)
//     --max <n>                  teto de sets procurados por jogo (padrão 100)
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sleep, winSafeName } from "./lib/sync-common.mjs";
import {
  UA, JOGOS, FORA, temGuarda, lerCatalogo, setsDoCatalogo, remendaCatalogo, alvosDoJogo,
  metaRefresh, slugsDeProduto, slugsParaTentar, logoDaPaginaLorcana, logosDaFandom,
  logosDaPaginaBandai, logoDoFabCube, limpaAlfa, encaixa, mesmaArte
} from "./lib/logos-set.mjs";

const ROOT = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : padrao;
};
const SECO = args.includes("--seco");
const SAIDA = opcao("--saida", join(tmpdir(), "sleevu-logos-de-set"));
const MAX = Math.max(1, Number(opcao("--max", "100")) || 100);
const SO = String(opcao("--jogos", "")).split(",").map((s) => s.trim()).filter(Boolean);
const FAB_CUBE = "https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/set.json";

let sharp = null;
if (process.env.SHARP_DIR) sharp = (await import(pathToFileURL(join(process.env.SHARP_DIR, "lib", "index.js")).href)).default;

const catUrl = (jogo) => new URL(`data/${jogo}/cards.js`, ROOT);
const host = (url) => { try { return new URL(url).host; } catch { return url; } };

// ── Rede ────────────────────────────────────────────────────────────────────
// Nunca lança: devolve { ok, status, url, corpo }. 429/5xx/rede repetem.
async function busca(url, { tipo = "texto", headers = {}, tentativas = 3 } = {}) {
  let erro = "";
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) { erro = `HTTP ${r.status}`; await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return { ok: false, status: r.status, url: r.url || url };
      const corpo = tipo === "json" ? await r.json() : tipo === "bin" ? Buffer.from(await r.arrayBuffer()) : await r.text();
      await sleep(150); // educado com os sites oficiais
      return { ok: true, status: r.status, url: r.url || url, corpo };
    } catch (e) { erro = e.message; await sleep(1000 * (i + 1)); }
  }
  return { ok: false, status: 0, url, erro };
}

// ── Imagem ──────────────────────────────────────────────────────────────────
// Lê, exige fundo transparente de verdade (foto de produto e key visual não
// passam) e limpa o alfa. Devolve o RGBA limpo pra normalização.
async function analisa(buf) {
  const meta = await sharp(buf, { limitInputPixels: 40e6 }).metadata();
  if (!meta.width || !meta.height) throw new Error("não é imagem");
  if (!meta.hasAlpha) throw new Error(`sem canal alfa (${meta.format} ${meta.width}×${meta.height})`);
  const { data, info } = await sharp(buf, { limitInputPixels: 40e6 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentes = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparentes++;
  if (transparentes < 0.05 * info.width * info.height) throw new Error("fundo não é transparente");
  const limpeza = limpaAlfa(data, info.width, info.height);
  if (!limpeza.caixa) throw new Error("logo vazio depois da limpeza");
  return { meta, data, info, limpeza };
}

async function baixaImagem(url, headers = {}) {
  const r = await busca(url, { tipo: "bin", headers });
  if (!r.ok) return { ok: false, motivo: r.status ? `HTTP ${r.status} em ${url}` : `rede: ${r.erro}`, rede: !r.status || r.status >= 500 };
  try { return { ok: true, url: r.url, buf: r.corpo, analise: await analisa(r.corpo) }; }
  catch (e) { return { ok: false, motivo: `${e.message} (${url})` }; }
}

// Recorta no alfa e normaliza no padrão do jogo. Devolve o arquivo final.
async function normaliza(jogo, { data, info, limpeza }) {
  const { caixa } = limpeza;
  const folga = jogo === "lorcana" ? 0 : 2; // no Lorcana a folga é a margem do canvas
  const left = Math.max(0, caixa.x0 - folga), top = Math.max(0, caixa.y0 - folga);
  const width = Math.min(info.width, caixa.x1 + 1 + folga) - left;
  const height = Math.min(info.height, caixa.y1 + 1 + folga) - top;
  const recorte = () => sharp(data, { raw: info }).extract({ left, top, width, height });
  if (jogo === "lorcana") {
    const { largura, altura } = encaixa(width, height, 970, 470, { aumenta: true });
    const logo = await recorte().resize(largura, altura, { kernel: "lanczos3" }).png().toBuffer();
    const tela = () => sharp({ create: { width: 1000, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logo, left: Math.round((1000 - largura) / 2), top: Math.round((500 - altura) / 2) }]);
    const antes = await tela().raw().toBuffer();
    // Paleta (libimagequant) com q92, como os curados. O dither às vezes suja
    // de alfa 1–3 o que era transparente (aparece no fundo escuro): se sujou,
    // refaz sem dither.
    let png = await tela().png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
    if (await sujeiraDeDither(antes, png)) png = await tela().png({ palette: true, quality: 92, effort: 10, compressionLevel: 9, dither: 0 }).toBuffer();
    return { buf: png, largura: 1000, altura: 500, logo: `${largura}×${altura}` };
  }
  const maxL = jogo === "fab" ? 600 : 1000;
  const { largura, altura } = encaixa(width, height, maxL, 100000);
  const webp = await recorte().resize(largura, altura, { kernel: "lanczos3" })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
  return { buf: webp, largura, altura, logo: `${largura}×${altura}` };
}

async function sujeiraDeDither(antesRaw, png) {
  const depois = await sharp(png).ensureAlpha().raw().toBuffer();
  let n = 0;
  for (let i = 3; i < antesRaw.length; i += 4) if (antesRaw[i] === 0 && depois[i] !== 0) n++;
  return n;
}

// ── Fontes ──────────────────────────────────────────────────────────────────
// Cada uma devolve { escolhido: { buf, analise, fonte, url, nota?, alerta? } }
// ou { notas: [...], rede: bool } quando não achou. `alerta` = o revisor
// precisa olhar com mais cuidado (vai com ⚠️ na tabela da PR).

let menuLorcana = null;
async function cacaLorcana(alvo) {
  const nome = alvo.principal.nome;
  const notas = [];
  let rede = false, oficial = null, fandom = null;

  // 1) Página do produto: o slug do nome; senão os produtos do menu do site.
  const tentar = slugsParaTentar(nome);
  for (let i = 0; i < tentar.length && i < 3 && !oficial; i++) {
    const r = await busca(`https://www.disneylorcana.com/en-US/product/${tentar[i]}`);
    const achou = r.ok ? logoDaPaginaLorcana(r.corpo, nome) : null;
    if (achou) {
      const img = await baixaImagem(new URL(achou.url, r.url).href);
      if (img.ok) oficial = { ...img, fonte: `disneylorcana.com/en-US/product/${tentar[i]} (alt "${achou.alt}")` };
      else notas.push(`logo oficial recusado: ${img.motivo}`);
    } else if (r.ok) notas.push(`product/${tentar[i]} sem imagem com alt "<Set> Logo"`);
    else if (!r.status || r.status >= 500) rede = true;
    if (i === 0 && !oficial) {
      if (!menuLorcana) { const home = await busca("https://www.disneylorcana.com/en-US"); menuLorcana = home.ok ? slugsDeProduto(home.corpo) : []; }
      tentar.push(...slugsParaTentar(nome, menuLorcana).slice(1));
    }
  }
  if (!oficial && !notas.length) notas.push(`sem página de produto (${tentar.slice(0, 3).join(", ")})`);

  // 2) Fandom: o arquivo com o nome do set.
  const prefixo = String(nome).split(/\s[–—:-]\s|:\s/)[0].trim().replace(/ /g, "_");
  const api = `https://lorcana.fandom.com/api.php?action=query&list=allimages&aiprefix=${encodeURIComponent(prefixo)}&aiprop=url%7Csize%7Cmime&ailimit=200&format=json`;
  const r = await busca(api, { tipo: "json" });
  if (!r.ok && (!r.status || r.status >= 500)) rede = true;
  const cands = r.ok ? logosDaFandom(r.corpo, nome) : [];
  for (const c of cands.slice(0, 2)) {
    const img = await baixaImagem(c.url, { Referer: "https://lorcana.fandom.com/" });
    if (img.ok) { fandom = { ...img, fonte: `lorcana.fandom.com File:${c.nome}` }; break; }
    notas.push(`Fandom ${c.nome} recusado: ${img.motivo}`);
  }
  if (r.ok && !cands.length) notas.push(`Fandom sem arquivo "${nome}.png"`);

  if (oficial && fandom) {
    const co = oficial.analise.limpeza.caixa, cf = fandom.analise.limpeza.caixa;
    if (mesmaArte(co, cf) && cf.largura > co.largura) {
      return { escolhido: { ...fandom, nota: `mesma arte da página oficial (${co.largura}×${co.altura}), ${(cf.largura / co.largura).toFixed(1)}× maior` } };
    }
    return mesmaArte(co, cf)
      ? { escolhido: { ...oficial, nota: "a da Fandom não é maior" } }
      : { escolhido: { ...oficial, alerta: "a Fandom tem OUTRA arte com o nome do set; ficou a oficial" } };
  }
  if (oficial) return { escolhido: oficial };
  if (fandom) return { escolhido: { ...fandom, alerta: "só na Fandom, sem a página oficial pra conferir" } };
  return { notas, rede };
}

async function cacaOnePiece(alvo) {
  const codigo = alvo.arquivo.replace(/\.[a-z]+$/i, "");
  const pasta = /^(?:st|sd)/.test(codigo) ? "decks" : "boosters";
  const sites = ["https://en.onepiece-cardgame.com", "https://www.onepiece-cardgame.com", "https://asia-en.onepiece-cardgame.com"];
  const notas = [];
  let rede = false;
  const achados = [];
  for (const site of sites) {
    for (const caminho of [`/products/${codigo}.html`, `/products/${pasta}/${codigo}.php`]) {
      let url = site + caminho;
      for (let salto = 0; salto < 3; salto++) {
        const r = await busca(url);
        if (!r.ok) { if (!r.status || r.status >= 500) rede = true; break; }
        const destino = metaRefresh(r.corpo);
        if (destino) { url = new URL(destino, r.url).href; continue; }
        for (const c of logosDaPaginaBandai(r.corpo, { codigo, nome: alvo.principal.nome })) {
          achados.push({ ...c, url: new URL(c.url, r.url).href, pagina: r.url });
        }
        break;
      }
    }
    // A página EN com o alt certo basta; JP e Asia só se a EN não deu.
    if (achados.some((a) => a.pontos >= 100)) break;
  }
  const vistos = new Set();
  for (const c of achados.sort((a, b) => b.pontos - a.pontos)) {
    if (vistos.has(c.url)) continue;
    vistos.add(c.url);
    const img = await baixaImagem(c.url);
    if (img.ok) {
      const alerta = c.pontos >= 100 ? "" : "o alt da imagem não traz o nome nem o código do set";
      return { escolhido: { ...img, fonte: `${host(c.pagina)}${new URL(c.pagina).pathname} → ${new URL(c.url).pathname.split("/").slice(-3).join("/")} (alt "${c.alt}")`, alerta } };
    }
    notas.push(`recusado: ${img.motivo}`);
  }
  if (!achados.length) notas.push("nenhuma imagem de título/logo do set nas páginas da Bandai (EN, JP, Asia-EN)");
  return { notas, rede };
}

let fabCube = null;
async function cacaFab(alvo) {
  if (!fabCube) {
    const r = await busca(FAB_CUBE, { tipo: "json" });
    if (!r.ok) return { notas: [`the-fab-cube inacessível (${r.status || r.erro})`], rede: true };
    fabCube = r.corpo;
  }
  const hit = logoDoFabCube(fabCube, { setId: alvo.principal.setId, nome: alvo.principal.nome });
  if (!hit) return { notas: ["o the-fab-cube não tem logo pra este código nem pra este nome"], rede: false };
  const local = new URL(`data/fab/set-logos/${winSafeName(hit.codigo)}.webp`, ROOT);
  if (existsSync(local)) {
    const buf = await readFile(local);
    try {
      return { escolhido: { buf, analise: await analisa(buf), url: hit.url, fonte: `set-logos/${hit.codigo}.webp, já espelhado (the-fab-cube ${hit.codigo} "${hit.nome}", por ${hit.por})` } };
    } catch (e) { return { notas: [`set-logos/${hit.codigo}.webp recusado: ${e.message}`], rede: false }; }
  }
  const img = await baixaImagem(hit.url);
  if (!img.ok) return { notas: [`the-fab-cube ${hit.codigo}: ${img.motivo}`], rede: !!img.rede };
  return { escolhido: { ...img, fonte: `the-fab-cube ${hit.codigo} "${hit.nome}" (por ${hit.por}) → ${host(hit.url)}` } };
}

const CACA = { lorcana: cacaLorcana, onepiece: cacaOnePiece, fab: cacaFab };

// ── Galeria ─────────────────────────────────────────────────────────────────
// Uma linha por logo: o chip claro do .set-art (radial #fff → #eef0f3, logo até
// 88% da largura) e o fundo escuro do tema (#101218), onde aparecem a mancha
// e o véu que o chip branco esconde.
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function galeria(propostas, titulo) {
  const L = 1100, topo = 70, linha = 190, celL = 330, celA = 150, x1 = 400, x2 = 400 + celL + 20;
  const A = topo + propostas.length * linha + 10;
  const partes = [];
  const camadas = [];
  propostas.forEach((p, i) => {
    const y = topo + i * linha;
    const linhas = [`${p.jogo} · ${p.setIds.join(", ")}`, p.nome, `${p.arquivoFinal} · ${p.dimensoes}`, p.fonteCurta];
    linhas.forEach((t, k) => partes.push(`<text x="24" y="${y + 34 + k * 24}" font-size="${k === 1 ? 17 : 14}" font-weight="${k === 1 ? 700 : 400}" fill="#1f2430">${xml(t.length > 46 ? t.slice(0, 45) + "…" : t)}</text>`));
    partes.push(`<rect x="${x1}" y="${y + 12}" width="${celL}" height="${celA}" rx="14" fill="url(#chip)" stroke="#d5d9e0"/>`);
    partes.push(`<rect x="${x2}" y="${y + 12}" width="${celL}" height="${celA}" rx="14" fill="#101218"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}">
<defs><radialGradient id="chip" cx="50%" cy="0%" r="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="78%" stop-color="#eef0f3"/></radialGradient></defs>
<rect width="100%" height="100%" fill="#f7f8fa"/>
<g font-family="DejaVu Sans, Segoe UI, Arial, sans-serif">
<text x="24" y="42" font-size="22" font-weight="700" fill="#0a0c10">${xml(titulo)}</text>
<text x="${x1 + celL / 2}" y="58" font-size="13" fill="#5b6270" text-anchor="middle">chip claro (como no site)</text>
<text x="${x2 + celL / 2}" y="58" font-size="13" fill="#5b6270" text-anchor="middle">fundo escuro (mostra mancha e véu)</text>
${partes.join("\n")}
</g></svg>`;
  for (let i = 0; i < propostas.length; i++) {
    const p = propostas[i];
    const meta = await sharp(p.buf).metadata();
    // Lorcana: o canvas 1000×500 já traz a margem; o chip mostra o PNG inteiro.
    const { largura, altura } = encaixa(meta.width, meta.height, Math.round(celL * 0.88), celA - 40, { aumenta: true });
    const img = await sharp(p.buf).resize(largura, altura).png().toBuffer();
    const y = topo + i * linha + 12 + Math.round((celA - altura) / 2);
    camadas.push({ input: img, left: x1 + Math.round((celL - largura) / 2), top: y });
    camadas.push({ input: img, left: x2 + Math.round((celL - largura) / 2), top: y });
  }
  return sharp(Buffer.from(svg)).composite(camadas).png({ compressionLevel: 9 }).toBuffer();
}

// ── Relatório ───────────────────────────────────────────────────────────────
function relatorioMd({ hoje, propostas, semCandidato, erros, resumo }) {
  const l = [];
  l.push(`## Logos de set propostos pelo caçador (${hoje})`, "");
  if (!propostas.length) l.push("Nenhum logo novo nesta rodada.", "");
  else {
    l.push(`${propostas.length} logo(s) novo(s). Confira cada um na galeria: o chip claro é como aparece no site; o fundo escuro mostra mancha e véu que o chip esconde.`, "");
    l.push("{{GALERIA}}", "");
    l.push("| Jogo | Set | setId | Arquivo | Fonte | Original → final | Limpeza | Cartas |", "|---|---|---|---|---|---|---|---|");
    for (const p of propostas) {
      const limpeza = [p.manchas ? `${p.manchas} mancha(s)` : "", p.veu ? `véu ${p.veu} px` : ""].filter(Boolean).join(", ") || "—";
      const nota = (p.nota ? `<br>${p.nota}` : "") + (p.alerta ? `<br>⚠️ ${p.alerta}` : "");
      l.push(`| ${p.jogo} | ${p.nome} | ${p.setIds.map((s) => `\`${s}\``).join(" ")} | \`${p.arquivoFinal}\` | [${p.fonteCurta}](${p.url})${nota} | ${p.original} → ${p.dimensoes} (${Math.round(p.bytes / 1024)} KB) | ${limpeza} | ${p.cartas} |`);
    }
    l.push("");
  }
  if (semCandidato.length) {
    // Recolhido: no FAB são dezenas de decks sem logo, toda semana.
    l.push(`<details><summary><b>Sem candidato nesta rodada</b> (${semCandidato.length})</summary>`, "");
    for (const s of semCandidato) l.push(`- ${s.jogo} · \`${s.setIds.join("`, `")}\` ${s.nome}: ${s.notas.join("; ") || "nada encontrado"}${s.rede ? " (houve erro de rede)" : ""}`);
    l.push("", "</details>", "");
  }
  if (erros.length) {
    l.push("### Erros", "");
    for (const e of erros) l.push(`- ${e.jogo} · ${e.nome}: ${e.erro}`);
    l.push("");
  }
  l.push("### Jogos e sets sem logo", "", "| Jogo | Sets | Sem logo | Situação |", "|---|---|---|---|");
  for (const r of resumo) {
    const pul = r.pulados && Object.keys(r.pulados).length
      ? `<br>fora da busca: ${Object.entries(r.pulados).map(([m, n]) => `${n} ${m}`).join("; ")}` : "";
    l.push(`| ${r.jogo} | ${r.sets ?? "—"} | ${r.semLogo ?? "—"} | ${r.situacao}${r.alvos != null ? ` (${r.alvos} procurado(s))` : ""}${pul} |`);
  }
  l.push("", "### Como revisar", "",
    "- **Logo errado**: feche a PR (ou apague o arquivo nela) e ponha o setId em `scripts/data/logos-set-ignorar.json` com o motivo; senão ele volta na semana seguinte.",
    "- **Conflito no `cards.js`** (o snapshot diário do build mexe nele): rode de novo o workflow \"Caça logos de set\" em Actions; ele refaz a branch a partir da `main`.",
    "- **Depois de mesclar**: a produção troca no próximo build completo (cron diário). O sync de cada jogo aqui tem a guarda \"logo local vence\", então o arquivo não é baixado por cima.");
  return l.join("\n") + "\n";
}

// Motivo de pulo resumido pra tabela (o detalhe vai no relatorio.json).
function contaMotivos(pulados) {
  const out = {};
  for (const p of pulados) {
    const m = p.motivo.startsWith("lista de exclusão") ? "na lista de exclusão"
      : p.motivo.startsWith("set-logos/") ? "com arquivo já no repo" : p.motivo;
    out[m] = (out[m] || 0) + 1;
  }
  return out;
}

// ── Principal ───────────────────────────────────────────────────────────────
async function run() {
  const hoje = new Date().toISOString().slice(0, 10);
  const ignorar = JSON.parse(await readFile(new URL("scripts/data/logos-set-ignorar.json", ROOT), "utf8"));
  const jogos = (await readdir(new URL("data/", ROOT), { withFileTypes: true }))
    .filter((d) => d.isDirectory() && existsSync(catUrl(d.name))).map((d) => d.name).sort();
  const resumo = [], propostas = [], semCandidato = [], erros = [], puladosTodos = [];
  if (!sharp) console.log("cacar-logos-set: sem SHARP_DIR — só lista o que falta (ver o cabeçalho).");

  for (const jogo of ["pokemon", "magic", "ygo"]) resumo.push({ jogo, situacao: FORA[jogo] });
  for (const jogo of jogos) {
    let cards, sets;
    try { cards = lerCatalogo(await readFile(catUrl(jogo), "utf8")).cards; sets = setsDoCatalogo(cards); }
    catch (e) { resumo.push({ jogo, situacao: `cards.js ilegível: ${e.message}` }); continue; }
    const semLogo = [...sets.values()].filter((s) => s.semLogo).length;
    const base = { jogo, sets: sets.size, semLogo };
    if (!JOGOS[jogo]) { if (semLogo) resumo.push({ ...base, situacao: FORA[jogo] || "sem fonte de logo conhecida" }); continue; }
    if (SO.length && !SO.includes(jogo)) { resumo.push({ ...base, situacao: "fora desta rodada (--jogos)" }); continue; }
    const fonteDoSync = await readFile(new URL(`scripts/${JOGOS[jogo].sync}`, ROOT), "utf8");
    if (!temGuarda(fonteDoSync, jogo)) {
      resumo.push({ ...base, situacao: `PULADO: o ${JOGOS[jogo].sync} não tem a guarda "logo local vence" — o logo sumiria no próximo build completo` });
      continue;
    }
    const { alvos, pulados } = alvosDoJogo(jogo, cards, {
      ignorar: ignorar[jogo] || {},
      existe: (arquivo) => existsSync(new URL(`data/${jogo}/set-logos/${arquivo}`, ROOT))
    });
    puladosTodos.push(...pulados.map((p) => ({ jogo, setId: p.setId, nome: p.nome, motivo: p.motivo })));
    resumo.push({ ...base, alvos: Math.min(alvos.length, MAX), pulados: contaMotivos(pulados), situacao: JOGOS[jogo].fontes });
    console.log(`${jogo}: ${semLogo} set(s) sem logo, ${alvos.length} a procurar${alvos.length > MAX ? ` (teto ${MAX})` : ""}`);

    for (const alvo of alvos.slice(0, MAX)) {
      const ident = { jogo, setIds: alvo.setIds, nome: alvo.principal.nome };
      console.log(`  ${alvo.principal.setId} "${alvo.principal.nome}" → set-logos/${alvo.arquivo}`);
      if (!sharp) { semCandidato.push({ ...ident, notas: ["não procurado: sem SHARP_DIR"], rede: false }); continue; }
      try {
        const achado = await CACA[jogo](alvo);
        if (!achado.escolhido) {
          console.log(`    sem candidato: ${achado.notas.join("; ")}`);
          semCandidato.push({ ...ident, notas: achado.notas, rede: achado.rede });
          continue;
        }
        const { buf: original, analise, fonte, url, nota = "", alerta = "" } = achado.escolhido;
        const final = await normaliza(jogo, analise);
        const rel = `data/${jogo}/set-logos/${alvo.arquivo}`;
        const destino = SECO ? join(SAIDA, "logos", jogo, alvo.arquivo) : fileURLToPath(new URL(rel, ROOT));
        // O remendo do cards.js vem ANTES de gravar o logo: se o delta de bytes
        // não bater, nada é escrito.
        const remendo = remendaCatalogo(await readFile(catUrl(jogo), "utf8"), alvo.setIds, rel);
        await mkdir(dirname(destino), { recursive: true });
        await writeFile(destino, final.buf);
        if (!SECO) await writeFile(catUrl(jogo), remendo.texto);
        const { meta, limpeza } = analise;
        propostas.push({
          ...ident, arquivo: alvo.arquivo, arquivoFinal: rel, fonte, fonteCurta: fonte.length > 90 ? fonte.slice(0, 89) + "…" : fonte,
          url, nota, alerta, original: `${meta.width}×${meta.height} ${meta.format}`, dimensoes: `${final.largura}×${final.altura}`,
          logo: final.logo, bytes: final.buf.length, manchas: limpeza.manchas, veu: limpeza.veu,
          cartas: remendo.cartas, deltaCardsJs: remendo.delta, buf: final.buf, bytesOriginal: original.length
        });
        console.log(`    ✓ ${fonte} → ${final.largura}×${final.altura} (${Math.round(final.buf.length / 1024)} KB), ${remendo.cartas} carta(s), cards.js +${remendo.delta} B`);
      } catch (e) {
        console.log(`    ERRO: ${e.message}`);
        erros.push({ ...ident, erro: e.message });
      }
    }
  }

  await mkdir(SAIDA, { recursive: true });
  if (propostas.length) {
    const png = await galeria(propostas, `Logos de set propostos · ${hoje}`);
    await writeFile(join(SAIDA, "galeria.png"), png);
  }
  const md = relatorioMd({ hoje, propostas, semCandidato, erros, resumo });
  await writeFile(join(SAIDA, "relatorio.md"), md);
  await writeFile(join(SAIDA, "relatorio.json"), JSON.stringify({
    hoje, seco: SECO,
    propostas: propostas.map(({ buf, ...p }) => p), semCandidato, erros, resumo, pulados: puladosTodos,
    titulo: !propostas.length ? "" : propostas.length <= 3
      ? `Logos de set: ${propostas.map((p) => `${p.nome} (${p.jogo})`).join(", ")}`
      : `Logos de set: ${propostas.length} propostos pelo caçador`
  }, null, 2));
  console.log(`\n${md}`);
  console.log(`Saída: ${SAIDA}${SECO ? " (seco: data/ intocado)" : ""}`);
}

await run();
