// Espelho das imagens de carta no R2 (img.sleevu.app) — o job.
//
// Por quê: quase toda imagem do site é hotlink de terceiro (Scryfall 98 mil,
// TCGplayer 48 mil, TCGdex 39 mil só no que está no repositório; Lorcast,
// TCGCSV e os fã-sites dos vintages fora dele). Cada visita depende do
// servidor deles, o Scryfall pede pra não fazer isso em volume, o "exportar
// imagem" de Lorcana/One Piece precisa de proxy de CORS, e cada fonte publica
// um tamanho diferente — nenhuma serve bem grade E popup em toda tela.
//
// Como: lê o catálogo construído (o mesmo do deploy), baixa a MATRIZ de cada
// carta (a melhor imagem da fonte, scripts/lib/img-mirror.mjs), gera WebP nas
// três larguras (300/600/1000, nunca ampliando) com o sharp e sobe as três no
// bucket. O índice fica no próprio bucket (_index/<host>.json: base da chave
// -> [tamanho da matriz, versão, dia]) e o job só faz o que falta ou mudou,
// dentro de um tempo de trabalho; grava o índice a cada 200 cartas e no fim —
// a rodada seguinte continua de onde parou. No fim publica _index/status.json,
// que o deploy consulta (scripts/apply-img-mirror.mjs): só host COMPLETO no
// esquema atual vira URL espelhada no cliente.
//
// Educação com as fontes: concorrência e intervalo por host (o Scryfall pede
// no máximo 10 req/s), User-Agent identificado, 429 encerra o host na rodada.
// 404 na origem vira "faltando" (tenta de novo em 30 dias). Host mutável
// (TCGplayer troca a arte na mesma URL): cartas de set dos últimos 60 dias são
// conferidas por HEAD a cada 7 dias e regeradas se o tamanho mudou.
//
// Nada é apagado do bucket: carta que sai do catálogo só deixa de contar.
//
//   node scripts/mirror-r2.mjs [--host <host>] [--limit N] [--minutes M] [--dry]
// Env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID
// (R2_BUCKET opcional, padrão sleevu-img), SHARP_DIR (pasta do pacote sharp
// instalado fora do repo — o workflow instala). Roda no Actions
// (mirror-images.yml); este ambiente de desenvolvimento não alcança as
// fontes nem o bucket — aqui só o --dry (conta o que faria, sem rede).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { lerCatalogo } from "./lib/d1-catalogo.mjs";
import { ESQUEMA_ESPELHO, FONTES, LARGURAS, ORDEM, QUALIDADE_WEBP, chaveBase, chaveDe, hostDe, matrizDe, versaoDe } from "./lib/img-mirror.mjs";
import { clienteR2 } from "./lib/r2.mjs";
import { mapLimit, sleep } from "./lib/sync-common.mjs";

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > -1 ? process.argv[i + 1] : padrao; };
const SO_HOST = arg("host", "");
const LIMITE = Number(arg("limit", 0)) || Infinity;
const MINUTOS = Number(arg("minutes", 320)) || 320;
const SECO = process.argv.includes("--dry");
const HOJE = new Date().toISOString().slice(0, 10);
const INICIO = Date.now();
const acabouTempo = () => Date.now() - INICIO > MINUTOS * 60000;
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const UA = "Sleevu image mirror (+https://sleevu.app; github.com/fexpepe/tcg-collector)";
const RECENTE_DIAS = 60, RECONFERE_DIAS = 7, FALTANDO_DIAS = 30, SALVA_A_CADA = 200;

const r2 = clienteR2();
if (!r2 && !SECO) {
  console.log("mirror-r2: sem R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / CLOUDFLARE_ACCOUNT_ID no ambiente — nada a fazer.");
  process.exit(0);
}
// sharp vem de fora do repo (sem package.json aqui, de propósito): o
// workflow instala em $RUNNER_TEMP e aponta SHARP_DIR.
let sharp = null;
if (!SECO) {
  const dir = process.env.SHARP_DIR;
  if (!dir) { console.log("mirror-r2: sem SHARP_DIR (o pacote sharp) — nada a fazer."); process.exit(0); }
  sharp = (await import(pathToFileURL(join(dir, "lib", "index.js")).href)).default;
}

// ── 1. O que DEVE existir no bucket, por host: base da chave -> carta ───────
const alvos = new Map(ORDEM.map((h) => [h, new Map()]));
const limiteRecente = diasAtras(RECENTE_DIAS);
for await (const { game, cards } of lerCatalogo()) {
  let n = 0;
  for (const c of cards) {
    const u = c.linha.image;
    const mapa = u && alvos.get(hostDe(u));
    if (!mapa) continue;
    const base = chaveBase(u);
    if (!base || mapa.has(base)) continue;
    mapa.set(base, { url: u, matriz: matrizDe(u), versao: versaoDe(u), recente: String(c.linha.released || "") >= limiteRecente });
    n++;
  }
  console.log(`  ${game}: ${n} cartas a manter no espelho`);
}

// ── 2. Índice e status guardados no bucket ──────────────────────────────────
async function leJson(chave, vazio) {
  if (!r2) return vazio;
  const r = await r2.get(chave);
  if (r.status === 404) return vazio;
  if (!r.ok) throw new Error(`ler ${chave}: HTTP ${r.status}`);
  return r.json();
}
async function gravaJson(chave, obj) {
  if (SECO) return;
  const r = await r2.put(chave, JSON.stringify(obj), { contentType: "application/json", cacheControl: "no-store" });
  if (!r.ok) throw new Error(`gravar ${chave}: HTTP ${r.status}`);
}

const status = await leJson("_index/status.json", { hosts: {} });
status.hosts = status.hosts || {};
let feitosNoTotal = 0;

// ── 3. Host a host, na ordem do rollout ─────────────────────────────────────
for (const host of ORDEM) {
  if (SO_HOST && host !== SO_HOST) continue;
  const alvo = alvos.get(host);
  if (!alvo.size) continue;
  if (acabouTempo() || feitosNoTotal >= LIMITE) { console.log(`mirror-r2: ${host} fica pra próxima rodada (tempo/teto).`); continue; }
  const f = FONTES[host];
  // Índice de esquema anterior (v1 copiava variantes da origem, chaves sem
  // @largura): começa do zero — os objetos velhos ficam no bucket sem uso.
  let idx = await leJson(`_index/${host}.json`, null);
  if (!idx || idx.v !== ESQUEMA_ESPELHO) idx = { v: ESQUEMA_ESPELHO, objetos: {}, faltando: {} };

  const pendentes = [];
  for (const [base, o] of alvo) {
    const tem = idx.objetos[base];
    if (tem && tem[1] === o.versao && !(f.mutavel && o.recente && tem[2] < diasAtras(RECONFERE_DIAS))) continue;
    if (!tem && idx.faltando[base] && idx.faltando[base] >= diasAtras(FALTANDO_DIAS)) continue;
    pendentes.push([base, o, tem]);
  }
  const lote = pendentes.slice(0, Math.max(0, Math.min(pendentes.length, LIMITE - feitosNoTotal)));
  console.log(`mirror-r2: ${host} — ${alvo.size} cartas no alvo, ${pendentes.length} a fazer, ${lote.length} nesta rodada.`);
  if (SECO) continue;   // --dry: só a contagem, sem tocar na rede

  let geradas = 0, conferidas = 0, sumidas = 0, erros = 0, desdeSalvo = 0, parar = false, salvando = null;
  const salva = () => { salvando = salvando || gravaJson(`_index/${host}.json`, idx).finally(() => { salvando = null; }); return salvando; };
  await mapLimit(lote, f.concorrencia, async ([base, o, tem]) => {
    if (parar || acabouTempo()) return;
    try {
      if (tem && f.mutavel) {
        // Reconferência: só o tamanho da matriz, por HEAD. Igual = carimba o dia.
        const h = await fetch(o.matriz, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
        if (h.ok && Number(h.headers.get("content-length")) === tem[0]) { tem[2] = HOJE; conferidas++; feitosNoTotal++; return; }
      }
      const r = await fetch(o.matriz, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 404 || r.status === 403 || r.status === 410) { idx.faltando[base] = HOJE; sumidas++; return; }
      if (r.status === 429) { parar = true; console.log(`mirror-r2: ${host} pediu calma (429) — encerrando este host por hoje.`); return; }
      if (!r.ok) { erros++; return; }
      const matriz = Buffer.from(await r.arrayBuffer());
      if (!matriz.length) { erros++; return; }
      // Três larguras a partir da mesma decodificação; sem ampliar.
      const saidas = await Promise.all(LARGURAS.map((w) =>
        sharp(matriz).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALIDADE_WEBP }).toBuffer()));
      const subidas = await Promise.all(LARGURAS.map((w, i) => r2.put(chaveDe(o.url, w), saidas[i], { contentType: "image/webp" })));
      if (subidas.some((p) => !p.ok)) { erros++; return; }
      idx.objetos[base] = [matriz.length, o.versao, HOJE];
      delete idx.faltando[base];
      geradas++; feitosNoTotal++;
      if (++desdeSalvo >= SALVA_A_CADA) { desdeSalvo = 0; await salva(); }
    } catch (e) {
      erros++;
      if (erros <= 3) console.log(`  ${host}: ${base} — ${String(e && e.message || e).slice(0, 120)}`);
    }
    await sleep(f.intervaloMs);
  });
  await salva();

  let ok = 0, faltando = 0;
  for (const [base, o] of alvo) {
    const tem = idx.objetos[base];
    if (tem && tem[1] === o.versao) ok++;
    else if (idx.faltando[base]) faltando++;
  }
  const restam = alvo.size - ok - faltando;
  status.hosts[host] = { esquema: ESQUEMA_ESPELHO, total: alvo.size, ok, faltando, pendentes: restam, completo: restam === 0 && ok > 0, em: HOJE };
  console.log(`mirror-r2: ${host} — ${geradas} cartas geradas (${geradas * LARGURAS.length} objetos), ${conferidas} conferidas, ${sumidas} sumidas na origem, ${erros} erros; `
    + `no espelho ${ok} de ${alvo.size}${faltando ? ` (${faltando} não existem na origem)` : ""}; ${restam ? `${restam} ainda por fazer` : "COMPLETO"}.`);
}

status.atualizadoEm = new Date().toISOString();
await gravaJson("_index/status.json", status);
console.log(`mirror-r2: ${feitosNoTotal} cartas nesta rodada em ${Math.round((Date.now() - INICIO) / 60000)} min. Completos: `
  + `${Object.entries(status.hosts).filter(([, s]) => s.completo && s.esquema === ESQUEMA_ESPELHO).map(([h]) => h).join(", ") || "nenhum ainda"}.`);
