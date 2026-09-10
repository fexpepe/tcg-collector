// Espelho das imagens de carta no R2 (img.sleevu.app) — o job.
//
// Por quê: hoje quase toda imagem do site é hotlink de terceiro (Scryfall
// 98 mil, TCGplayer 48 mil, TCGdex 39 mil só no que está no repositório).
// Cada visita depende do servidor deles, o Scryfall pede pra não fazer isso
// em volume, e o "exportar imagem" de Lorcana/One Piece precisa de um proxy
// de CORS. O espelho copia, byte a byte, as VARIANTES que o site pede (ver
// scripts/lib/img-mirror.mjs) pro bucket, e o cliente passa a buscá-las de
// img.sleevu.app com a origem logo atrás na cadeia de fallback.
//
// Como: lê o catálogo construído (o mesmo que o deploy usa), monta por host o
// conjunto de chaves que DEVEM existir no bucket, compara com o índice que o
// próprio job guarda no bucket (_index/<host>.json: chave -> [tamanho,
// versão, dia]) e baixa/sobe só o que falta ou mudou, dentro de um tempo de
// trabalho. Retomável: o índice é gravado a cada 500 objetos e no fim; a
// rodada seguinte continua de onde parou. No fim publica _index/status.json,
// que o deploy consulta (scripts/apply-img-mirror.mjs) pra saber quais hosts
// já estão COMPLETOS — só esses viram URL espelhada no cliente.
//
// Educação com as fontes: concorrência e intervalo por host (o Scryfall pede
// no máximo 10 req/s), User-Agent identificado, e um 429 encerra o host nesta
// rodada. 404 na origem vira "faltando" (tenta de novo em 30 dias). Host
// mutável (TCGplayer troca a arte na mesma URL): cartas de set dos últimos 60
// dias são conferidas por HEAD a cada 7 dias e rebaixadas se o tamanho mudou.
//
// Nada é apagado do bucket: carta que sai do catálogo só deixa de contar.
//
//   node scripts/mirror-r2.mjs [--host <host>] [--limit N] [--minutes M] [--dry]
// Env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID
// (R2_BUCKET opcional, padrão sleevu-img). Roda no Actions (mirror-images.yml);
// este ambiente de desenvolvimento não alcança as fontes nem o bucket — aqui
// só o --dry (conta o que faria, sem rede) é possível.
import { lerCatalogo } from "./lib/d1-catalogo.mjs";
import { FONTES, ORDEM, chaveDe, hostDe, variantesDe, versaoDe } from "./lib/img-mirror.mjs";
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
const RECENTE_DIAS = 60, RECONFERE_DIAS = 7, FALTANDO_DIAS = 30, SALVA_A_CADA = 500;

const r2 = clienteR2();
if (!r2 && !SECO) {
  console.log("mirror-r2: sem R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / CLOUDFLARE_ACCOUNT_ID no ambiente — nada a fazer.");
  process.exit(0);
}

// ── 1. O que DEVE existir no bucket, por host ───────────────────────────────
const alvos = new Map(ORDEM.map((h) => [h, new Map()]));
const limiteRecente = diasAtras(RECENTE_DIAS);
for await (const { game, cards } of lerCatalogo()) {
  let n = 0;
  for (const c of cards) {
    const u = c.linha.image;
    const mapa = u && alvos.get(hostDe(u));
    if (!mapa) continue;
    const recente = String(c.linha.released || "") >= limiteRecente;
    for (const v of variantesDe(u)) {
      const ch = chaveDe(v);
      if (mapa.has(ch)) continue;
      mapa.set(ch, { url: v, versao: versaoDe(v), recente });
      n++;
    }
  }
  console.log(`  ${game}: ${n} objetos a manter no espelho`);
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
const tipoPorExtensao = (ch) => ({ webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", avif: "image/avif" })[ch.split(".").pop().toLowerCase()] || "application/octet-stream";

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
  const idx = await leJson(`_index/${host}.json`, { v: 1, objetos: {}, faltando: {} });
  idx.objetos = idx.objetos || {}; idx.faltando = idx.faltando || {};

  const pendentes = [];
  for (const [ch, o] of alvo) {
    const tem = idx.objetos[ch];
    if (tem && tem[1] === o.versao && !(f.mutavel && o.recente && tem[2] < diasAtras(RECONFERE_DIAS))) continue;
    if (!tem && idx.faltando[ch] && idx.faltando[ch] >= diasAtras(FALTANDO_DIAS)) continue;
    pendentes.push([ch, o, tem]);
  }
  const lote = pendentes.slice(0, Math.max(0, Math.min(pendentes.length, LIMITE - feitosNoTotal)));
  console.log(`mirror-r2: ${host} — ${alvo.size} objetos no alvo, ${pendentes.length} a fazer, ${lote.length} nesta rodada.`);
  if (SECO) continue;   // --dry: só a contagem, sem tocar na rede

  let baixados = 0, conferidos = 0, sumidos = 0, erros = 0, desdeSalvo = 0, parar = false, salvando = null;
  const salva = () => { salvando = salvando || gravaJson(`_index/${host}.json`, idx).finally(() => { salvando = null; }); return salvando; };
  await mapLimit(lote, f.concorrencia, async ([ch, o, tem]) => {
    if (parar || acabouTempo()) return;
    try {
      if (tem && f.mutavel) {
        // Reconferência: só o tamanho, por HEAD. Igual = carimba o dia e segue.
        const h = await fetch(o.url, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
        if (h.ok && Number(h.headers.get("content-length")) === tem[0]) { tem[2] = HOJE; conferidos++; feitosNoTotal++; return; }
      }
      const r = await fetch(o.url, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 403 || r.status === 410) { idx.faltando[ch] = HOJE; sumidos++; return; }
      if (r.status === 429) { parar = true; console.log(`mirror-r2: ${host} pediu calma (429) — encerrando este host por hoje.`); return; }
      const tipo = r.headers.get("content-type") || "";
      if (!r.ok || !/^image\//.test(tipo) && !/^image\//.test(tipoPorExtensao(ch))) { erros++; return; }
      const corpo = Buffer.from(await r.arrayBuffer());
      if (!corpo.length) { erros++; return; }
      if (!SECO) {
        const p = await r2.put(ch, corpo, { contentType: /^image\//.test(tipo) ? tipo : tipoPorExtensao(ch) });
        if (!p.ok) { erros++; return; }
      }
      idx.objetos[ch] = [corpo.length, o.versao, HOJE];
      delete idx.faltando[ch];
      baixados++; feitosNoTotal++;
      if (++desdeSalvo >= SALVA_A_CADA) { desdeSalvo = 0; await salva(); }
    } catch (e) {
      erros++;
    }
    await sleep(f.intervaloMs);
  });
  await salva();

  let ok = 0, faltando = 0;
  for (const [ch, o] of alvo) {
    const tem = idx.objetos[ch];
    if (tem && tem[1] === o.versao) ok++;
    else if (idx.faltando[ch]) faltando++;
  }
  const restam = alvo.size - ok - faltando;
  status.hosts[host] = { total: alvo.size, ok, faltando, pendentes: restam, completo: restam === 0 && ok > 0, em: HOJE };
  console.log(`mirror-r2: ${host} — ${baixados} baixados, ${conferidos} conferidos, ${sumidos} sumidos na origem, ${erros} erros; `
    + `no espelho ${ok} de ${alvo.size}${faltando ? ` (${faltando} não existem na origem)` : ""}; ${restam ? `${restam} ainda por fazer` : "COMPLETO"}.`);
}

status.atualizadoEm = new Date().toISOString();
await gravaJson("_index/status.json", status);
console.log(`mirror-r2: ${feitosNoTotal} objetos nesta rodada em ${Math.round((Date.now() - INICIO) / 60000)} min. Completos: `
  + `${Object.entries(status.hosts).filter(([, s]) => s.completo).map(([h]) => h).join(", ") || "nenhum ainda"}.`);
