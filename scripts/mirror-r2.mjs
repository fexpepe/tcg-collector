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
// Geração (13/10/2026, ver scripts/lib/img-mirror.mjs): quando a forma de
// gerar muda (matriz, qualidade), a imagem nova vai pra uma chave NOVA
// (…@600.g2.webp) e a velha fica onde está. A rodada faz primeiro a
// MANUTENÇÃO de todos os hosts (carta nova, arte trocada, reconferência — o
// trabalho de todo dia, que não pode esperar) e só depois a REGERAÇÃO das
// cartas de geração antiga, host a host. O status publica, por host, a
// geração que está completa: o site segue na antiga até a nova fechar.
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
import { ESQUEMA_ESPELHO, FONTES, GERACAO, LARGURAS, ORDEM, chaveBase, chaveDe, hostDe, matrizDe, versaoDe, webpDe } from "./lib/img-mirror.mjs";
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
    // `reserva`: a pokemontcg.io das cartas EN/PT sem scan na TCGdex (ver
    // lerCatalogo) — é a imagem principal delas no site, então se espelha.
    const u = c.linha.image || c.reserva;
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

// Cache das imagens que podem mudar na mesma chave (ver o put lá embaixo).
const CACHE_MUTAVEL = "public, max-age=604800";
// URLs regravadas nesta rodada: a borda da Cloudflare guarda a cópia velha por
// até um ano (o immutable de antes) e ignora a query na chave do cache, então
// só a PURGA tira a arte velha de lá. Precisa de CF_ZONE_ID e de um token com
// permissão de purgar cache da zona (CF_PURGE_TOKEN) — sem os dois, a rodada
// só avisa quantas ficaram de fora, e elas seguem velhas na borda até expirar.
const regravadas = [];
async function purgaBorda() {
  if (!regravadas.length) return;
  const zona = process.env.CF_ZONE_ID, token = process.env.CF_PURGE_TOKEN;
  if (!zona || !token) {
    console.log(`mirror-r2: ${regravadas.length} URL(s) regravada(s) seguem com a arte velha na borda — defina CF_ZONE_ID e CF_PURGE_TOKEN pra purgar.`);
    return;
  }
  let ok = 0;
  for (let i = 0; i < regravadas.length; i += 30) { // 30 URLs por pedido: o teto do plano grátis
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zona}/purge_cache`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ files: regravadas.slice(i, i + 30) }),
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok) ok += Math.min(30, regravadas.length - i);
      else console.log(`mirror-r2: purga recusada (HTTP ${r.status}) — as URLs seguem velhas na borda até expirar.`);
    } catch (e) { console.log(`mirror-r2: purga falhou (${String(e && e.message || e).slice(0, 80)}).`); }
  }
  console.log(`mirror-r2: ${ok} de ${regravadas.length} URL(s) regravada(s) purgada(s) da borda.`);
}

// ── 3. Índice e pendências de cada host ─────────────────────────────────────
// Manutenção: carta nova, arte trocada na origem, reconferência do host
// mutável. Regeração: carta já espelhada, mas numa geração anterior à atual.
const geracaoDe = (tem) => (tem && tem[3]) || 1;
const hostsDaRodada = [];
for (const host of ORDEM) {
  if (SO_HOST && host !== SO_HOST) continue;
  const alvo = alvos.get(host);
  if (!alvo.size) continue;
  const f = FONTES[host];
  // Índice de esquema anterior (v1 copiava variantes da origem, chaves sem
  // @largura): começa do zero — os objetos velhos ficam no bucket sem uso.
  let idx = await leJson(`_index/${host}.json`, null);
  if (!idx || idx.v !== ESQUEMA_ESPELHO) idx = { v: ESQUEMA_ESPELHO, objetos: {}, faltando: {} };
  const faltouHaPouco = (base) => idx.faltando[base] && idx.faltando[base] >= diasAtras(FALTANDO_DIAS);
  const manutencao = [], regeracao = [];
  for (const [base, o] of alvo) {
    const tem = idx.objetos[base];
    if (!tem) { if (!faltouHaPouco(base)) manutencao.push([base, o, null]); continue; }
    if (tem[1] !== o.versao) { manutencao.push([base, o, tem]); continue; }
    if (geracaoDe(tem) < GERACAO) { if (!faltouHaPouco(base)) regeracao.push([base, o, tem]); continue; }
    if (f.mutavel && o.recente && tem[2] < diasAtras(RECONFERE_DIAS)) manutencao.push([base, o, tem]);
  }
  console.log(`mirror-r2: ${host} — ${alvo.size} cartas no alvo, ${manutencao.length} de manutenção, ${regeracao.length} a regerar pra geração ${GERACAO}.`);
  hostsDaRodada.push({ host, f, alvo, idx, manutencao, regeracao, n: { geradas: 0, conferidas: 0, sumidas: 0, erros: 0 } });
}

// ── 4. Gera e sobe um lote de um host ───────────────────────────────────────
async function processa(h, lista, etapa) {
  const { host, f, idx, n } = h;
  if (SECO || !lista.length) return;   // --dry: só a contagem, sem tocar na rede
  if (acabouTempo() || feitosNoTotal >= LIMITE) { console.log(`mirror-r2: ${host} (${etapa}) fica pra próxima rodada (tempo/teto).`); return; }
  const lote = lista.slice(0, Math.max(0, LIMITE - feitosNoTotal));
  let desdeSalvo = 0, parar = false, salvando = null;
  const salva = () => { salvando = salvando || gravaJson(`_index/${host}.json`, idx).finally(() => { salvando = null; }); return salvando; };
  await mapLimit(lote, f.concorrencia, async ([base, o, tem]) => {
    if (parar || acabouTempo()) return;
    // Regravação na MESMA chave (mesma geração): arte trocada na origem ou
    // reconferência. Carta de geração anterior vai pra chave nova.
    const mesma = !!tem && geracaoDe(tem) === GERACAO;
    try {
      if (mesma && f.mutavel) {
        // Reconferência: só o tamanho da matriz, por HEAD. Igual = carimba o dia.
        const r = await fetch(o.matriz, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
        if (r.ok && Number(r.headers.get("content-length")) === tem[0]) { tem[2] = HOJE; n.conferidas++; feitosNoTotal++; return; }
      }
      const r = await fetch(o.matriz, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 404 || r.status === 403 || r.status === 410) { idx.faltando[base] = HOJE; n.sumidas++; return; }
      if (r.status === 429) { parar = true; console.log(`mirror-r2: ${host} pediu calma (429) — encerrando este host por hoje.`); return; }
      if (!r.ok) { n.erros++; return; }
      const matriz = Buffer.from(await r.arrayBuffer());
      if (!matriz.length) { n.erros++; return; }
      // Três larguras a partir da mesma decodificação; sem ampliar. A 1000
      // (popup) sai com mais qualidade que a grade (webpDe).
      const saidas = await Promise.all(LARGURAS.map((w) =>
        sharp(matriz).resize({ width: w, withoutEnlargement: true }).webp(webpDe(w)).toBuffer()));
      // Arte que PODE mudar na mesma chave (2026-10-08): a de host mutável
      // (TCGplayer troca o arquivo na mesma URL) e toda REGRAVAÇÃO (o Scryfall
      // mudou a versão, o TCGplayer mudou o tamanho). Com o immutable de um ano
      // padrão, navegador e borda seguiam com a arte velha por um ano; com 7
      // dias (o ritmo da reconferência), a nova chega na semana. O resto —
      // inclusive a chave nova de uma geração nova — segue imutável por URL.
      const cacheControl = mesma || f.mutavel ? CACHE_MUTAVEL : undefined;
      const subidas = await Promise.all(LARGURAS.map((w, i) => r2.put(chaveDe(o.url, w, GERACAO), saidas[i], { contentType: "image/webp", cacheControl })));
      if (subidas.some((p) => !p.ok)) { n.erros++; return; }
      // Regravação: a borda da Cloudflare ainda guarda a arte velha (e ignora a
      // query na chave dela). Entra na purga do fim da rodada (purgaBorda).
      // A URL como o cliente a pede (mirrorImg no shared.js: a do wsrv.nl vai codificada).
      if (mesma) LARGURAS.forEach((w) => regravadas.push(`https://img.sleevu.app/${host === "wsrv.nl" ? encodeURI(chaveDe(o.url, w, GERACAO)) : chaveDe(o.url, w, GERACAO)}`));
      idx.objetos[base] = [matriz.length, o.versao, HOJE, GERACAO];
      delete idx.faltando[base];
      n.geradas++; feitosNoTotal++;
      if (++desdeSalvo >= SALVA_A_CADA) { desdeSalvo = 0; await salva(); }
    } catch (e) {
      n.erros++;
      if (n.erros <= 3) console.log(`  ${host}: ${base} — ${String(e && e.message || e).slice(0, 120)}`);
    }
    await sleep(f.intervaloMs);
  });
  await salva();
}

// ── 5. Manutenção de todos, depois a regeração ──────────────────────────────
// A regeração de um host grande (Scryfall, ~100 mil cartas) toma rodadas
// inteiras; a carta nova de hoje de qualquer jogo não pode ficar na fila dela.
// Na regeração, Pokémon primeiro (a compressão dupla era na TCGdex, e é o
// jogo de mais gente), depois os hosts menores (fecham numa rodada e o site
// troca de geração logo) e os gigantes no fim.
for (const h of hostsDaRodada) await processa(h, h.manutencao, "manutenção");
const PRIMEIRO_NA_REGERACAO = ["assets.tcgdex.net", "images.pokemontcg.io", "cards.lorcast.io", "archives.bulbagarden.net", "wsrv.nl", "tcgplayer-cdn.tcgplayer.com", "cards.scryfall.io"];
const ordemRegeracao = [...new Set([...PRIMEIRO_NA_REGERACAO, ...ORDEM])];
for (const host of ordemRegeracao) {
  const h = hostsDaRodada.find((x) => x.host === host);
  if (h) await processa(h, h.regeracao, `regeração ${GERACAO}`);
}

// ── 6. Status por host ──────────────────────────────────────────────────────
for (const { host, alvo, idx, n } of hostsDaRodada) {
  let ok = 0, faltando = 0;
  for (const [base, o] of alvo) {
    const tem = idx.objetos[base];
    if (tem && tem[1] === o.versao && geracaoDe(tem) === GERACAO) ok++;
    else if (idx.faltando[base]) faltando++;
  }
  const restam = alvo.size - ok - faltando;
  const fechou = restam === 0 && ok > 0;
  // Enquanto a geração atual não fecha, o site segue na que já estava
  // completa — a do status anterior (status sem `geracao` = geração 1, cujas
  // chaves continuam no bucket). Carta nova nesse meio-tempo só existe na
  // geração atual: no site ela cai na origem, pela cadeia de fallback.
  const antes = status.hosts[host];
  const servida = fechou ? GERACAO : (antes && antes.completo && antes.esquema === ESQUEMA_ESPELHO ? (Number(antes.geracao) || 1) : 0);
  status.hosts[host] = { esquema: ESQUEMA_ESPELHO, geracao: servida || GERACAO, total: alvo.size, ok, faltando, pendentes: restam, completo: servida > 0, em: HOJE };
  console.log(`mirror-r2: ${host} — ${n.geradas} cartas geradas (${n.geradas * LARGURAS.length} objetos), ${n.conferidas} conferidas, ${n.sumidas} sumidas na origem, ${n.erros} erros; `
    + `na geração ${GERACAO}: ${ok} de ${alvo.size}${faltando ? ` (${faltando} não existem na origem)` : ""}; ${restam ? `${restam} ainda por fazer` : "COMPLETO"}`
    + `${servida && servida !== GERACAO ? ` — o site segue na geração ${servida}` : ""}.`);
}

status.atualizadoEm = new Date().toISOString();
await gravaJson("_index/status.json", status);
if (!SECO) await purgaBorda();
console.log(`mirror-r2: ${feitosNoTotal} cartas nesta rodada em ${Math.round((Date.now() - INICIO) / 60000)} min. Completos: `
  + `${Object.entries(status.hosts).filter(([, s]) => s.completo && s.esquema === ESQUEMA_ESPELHO).map(([h, s]) => `${h} (g${s.geracao || 1})`).join(", ") || "nenhum ainda"}.`);
