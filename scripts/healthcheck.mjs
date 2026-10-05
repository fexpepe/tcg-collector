// Healthcheck de PRODUÇÃO (sleevu.app): valida que o site no ar está saudável —
// páginas respondem, catálogos parseiam com contagens plausíveis, preços/deltas
// publicados são JSON válido e o Supabase (leitura anônima) responde. Roda no
// GitHub Actions (healthcheck.yml, cron diário): falha que se repete derruba o
// job, e o GitHub notifica por e-mail. Sem dependências; roda local também:
//   node scripts/healthcheck.mjs
//
// Falha só conta se REPETIR: o que falhou na primeira passada roda de novo no
// fim, depois de uma pausa, e só o que falhar as duas vezes deixa o job
// vermelho — a mesma regra do uptime.yml. Motivo (2026-09-28): um pedido ao
// pricing do Magic ficou parado os 30 s do timeout enquanto os outros 50 levaram
// menos de 3 s cada, e o mesmo arquivo respondia em 0,1–0,5 s meia hora depois.
// Era soluço de rede e virou e-mail de "produção quebrada". Problema de verdade
// (404, catálogo truncado, site fora) falha nas duas e segue vermelho; o soluço
// fica no log e num aviso amarelo no run, pra ver se começar a se repetir.
//
// Thresholds são ~metade do valor real de hoje (2026-07: Pokémon ~39k precificadas,
// Lorcana 3158, One Piece 8552): pegam catálogo zerado/truncado sem alarme falso
// em flutuação normal.
const PROD = "https://sleevu.app";
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const ANON_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública (RLS protege)
const PAUSA_2A_TENTATIVA_MS = 30000; // a mesma do uptime.yml

// Tudo no stdout, falha inclusive: com os ✗ no stderr, o Actions intercala os
// dois fluxos na ordem em que os lê, e o resumo de falhas chegou a sair ANTES
// do último ✓ do log.
const log = (s) => console.log(s);
const detalhe = (d) => (d === undefined ? "" : ` (${d})`);

// O que falhou na primeira passada, pra rodar de novo no fim.
const falhas = [];

// Uma verificação: `tentativa` lança o motivo da falha e devolve o detalhe que
// vai no ✓ (a contagem, por exemplo).
async function check(name, tentativa) {
  try {
    log(`  ✓ ${name}${detalhe(await tentativa())}`);
  } catch (e) {
    log(`  ✗ ${name}: ${e.message} (tenta de novo no fim)`);
    falhas.push({ name, tentativa, why: e.message });
  }
}

// Cabeçalho preparado pra uma regra de WAF pular o bot protection neste robô —
// necessário porque o Bot Fight Mode bloqueia IP de datacenter sem navegador, e o
// runner do GitHub é isso. Só funciona com Super Bot Fight Mode (Pro+): no plano
// free a ação Skip é ignorada. Ver o comentário longo no uptime.yml.
// Ausente = segue sem o cabeçalho (estado normal hoje).
const PROBE_TOKEN = process.env.UPTIME_PROBE_TOKEN || "";

// path relativo = produção; URL absoluta = usada como veio (Supabase leva a apikey).
async function get(path) {
  const url = /^https?:\/\//.test(path) ? path : PROD + path;
  const headers = url.startsWith(SUPABASE_URL)
    ? { apikey: ANON_KEY }
    : (PROBE_TOKEN ? { "x-sleevu-probe": PROBE_TOKEN } : undefined);
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers
  });
}

// Página HTML: status esperado + um trecho que precisa estar no corpo.
function checkPage(name, path, { status = 200, contains = "" } = {}) {
  return check(name, async () => {
    const res = await get(path);
    if (res.status !== status) throw new Error(`HTTP ${res.status} (esperado ${status})`);
    if (contains && !(await res.text()).includes(contains)) throw new Error(`corpo sem "${contains}"`);
  });
}

// Catálogo window.<var> = [...]: parseia num sandbox e valida contagem mínima.
function checkCatalog(name, path, varName, min) {
  return check(name, async () => {
    const res = await get(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const w = {};
    new Function("window", await res.text())(w);
    const v = w[varName];
    const n = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0);
    if (n < min) throw new Error(`${n} entradas (mínimo ${min})`);
    return n;
  });
}

function checkJson(name, path, validate) {
  return check(name, async () => {
    const res = await get(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const why = validate ? validate(j) : null;
    if (why) throw new Error(why);
  });
}

log(`Healthcheck ${PROD} — ${new Date().toISOString()}`);

log("\n[páginas]");
await checkPage("home", "/", { contains: "Sleevu" });
// O sitemap.xml é um ÍNDICE desde 2026-09-30 (um arquivo por tipo de página,
// ver prerender-catalog.mjs); as URLs de set moram no sitemap-sets.xml.
await checkPage("sitemap (índice)", "/sitemap.xml", { contains: "<sitemapindex" });
await checkPage("sitemap dos sets", "/sitemap-sets.xml", { contains: "/games/pokemon/base-set</loc>" });
// A árvore /games (2026-09-30): a lista de jogos, a tela de um jogo (Function
// com a vitrine), a página estática do set e a da carta (montada na borda).
await checkPage("página /games", "/games", { contains: "Pokémon TCG" });
await checkPage("tela de um jogo", "/games/star-wars-unlimited", { contains: "Star Wars: Unlimited" });
await checkPage("página de set (SEO)", "/games/pokemon/base-set", { contains: "Base Set" });
await checkPage("página de carta (borda)", "/games/pokemon/base-set/charizard-4-102", { contains: "Charizard" });
// Os endereços antigos seguem valendo, agora como 301 pro endereço novo.
await checkPage("set no endereço antigo (301)", "/set/base-set", { status: 301 });
await checkPage("tela de Sets no endereço antigo (301)", "/sets?game=swu", { status: 301 });
// 404 de verdade (anti soft-404): sem isto o Google indexa URL quebrada como 200.
await checkPage("404 real", "/healthcheck-caminho-inexistente", { status: 404 });
// /users/<handle> tem 404 PRÓPRIO (a Pages Function serve a shell da coleção, não
// o asset 404.html), então escapava da guarda acima: por meses respondeu 200 com
// casca vazia e o Search Console reportou soft 404. Esta linha é a guarda de volta.
await checkPage("404 real em /users", "/users/healthcheck-handle-inexistente", { status: 404 });

log("\n[catálogos]");
// Manifest: o que importa é a LISTA de sets dentro dele (Pokémon tem centenas
// de chunks entre 4 línguas), não as chaves do objeto.
await check("manifest Pokémon", async () => {
  const res = await get("/data/manifest.generated.js");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const w = {};
  new Function("window", await res.text())(w);
  const sets = (w.TCG_MANIFEST && w.TCG_MANIFEST.sets) || [];
  const total = sets.reduce((s, x) => s + (x.count || 0), 0);
  if (sets.length < 200 || total < 20000) throw new Error(`${sets.length} sets / ${total} cartas (mínimo 200/20000)`);
  return `${sets.length} sets, ${total} cartas`;
});
await checkCatalog("cards Lorcana", "/data/lorcana/cards.js", "TCG_CARDS", 1500);
await checkCatalog("cards One Piece", "/data/onepiece/cards.js", "TCG_CARDS", 4000);
await checkCatalog("cards Naruto", "/data/naruto/cards.js", "TCG_CARDS", 400);
await checkCatalog("cards Hunter x Hunter", "/data/hxh/cards.js", "TCG_CARDS", 30);
await checkCatalog("cards Dragon Ball Carddass", "/data/dbc/cards.js", "TCG_CARDS", 700);
await checkCatalog("cards LOTR", "/data/lotr/cards.js", "TCG_CARDS", 3000);
await checkCatalog("cards Harry Potter", "/data/harrypotter/cards.js", "TCG_CARDS", 600);
await checkCatalog("cards FAB", "/data/fab/cards.js", "TCG_CARDS", 5000);
await checkCatalog("cards Gundam", "/data/gundam/cards.js", "TCG_CARDS", 800);
await checkCatalog("cards Star Wars Unlimited", "/data/swu/cards.js", "TCG_CARDS", 4000);
await checkCatalog("cards Cyberpunk", "/data/cyberpunk/cards.js", "TCG_CARDS", 300);
await checkCatalog("cards Sorcery", "/data/sorcery/cards.js", "TCG_CARDS", 1200);
await checkCatalog("cards Dragon Ball Fusion", "/data/dbfw/cards.js", "TCG_CARDS", 1800);
await checkCatalog("cards Digimon", "/data/digimon/cards.js", "TCG_CARDS", 4000);
await checkCatalog("cards Riftbound", "/data/riftbound/cards.js", "TCG_CARDS", 600);
await checkCatalog("cards Union Arena", "/data/unionarena/cards.js", "TCG_CARDS", 3000);
await checkCatalog("cards World of Warcraft", "/data/wow/cards.js", "TCG_CARDS", 4000);
await checkCatalog("cards Weiß Schwarz", "/data/weiss/cards.js", "TCG_CARDS", 25000);
await checkCatalog("cards Miracle Battle Carddass", "/data/mbc/cards.js", "TCG_CARDS", 900);
// Yu-Gi-Oh! não tem cards.js em produção (chunk-only, padrão Magic) — só o pricing.
await checkJson("chunk Pokémon (base1)", "/data/sets/en/base1.json",
  (j) => Array.isArray(j) && j.length >= 100 ? null : "chunk vazio/curto");

log("\n[preços]");
await checkCatalog("pricing Pokémon", "/data/pricing.generated.js", "TCG_PRICING", 20000);
await checkCatalog("pricing Lorcana", "/data/lorcana/pricing.generated.js", "TCG_PRICING", 1000);
await checkCatalog("pricing One Piece", "/data/onepiece/pricing.generated.js", "TCG_PRICING", 2000);
// Magic: só o pricing (o cards.js dele é grande demais pra baixar no probe
// diário; o lint-catalog do deploy já valida a integridade do catálogo).
await checkCatalog("pricing Magic", "/data/magic/pricing.generated.js", "TCG_PRICING", 20000);
await checkCatalog("pricing FAB", "/data/fab/pricing.generated.js", "TCG_PRICING", 3000);
await checkCatalog("pricing Gundam", "/data/gundam/pricing.generated.js", "TCG_PRICING", 800);
await checkCatalog("pricing Star Wars Unlimited", "/data/swu/pricing.generated.js", "TCG_PRICING", 3500);
await checkCatalog("pricing Cyberpunk", "/data/cyberpunk/pricing.generated.js", "TCG_PRICING", 150);
await checkCatalog("pricing Sorcery", "/data/sorcery/pricing.generated.js", "TCG_PRICING", 1200);
await checkCatalog("pricing Dragon Ball Fusion", "/data/dbfw/pricing.generated.js", "TCG_PRICING", 1800);
await checkCatalog("pricing Yu-Gi-Oh", "/data/ygo/pricing.generated.js", "TCG_PRICING", 15000);
await checkCatalog("pricing Digimon", "/data/digimon/pricing.generated.js", "TCG_PRICING", 4000);
await checkCatalog("pricing Riftbound", "/data/riftbound/pricing.generated.js", "TCG_PRICING", 600);
await checkCatalog("pricing Union Arena", "/data/unionarena/pricing.generated.js", "TCG_PRICING", 3000);
await checkCatalog("pricing World of Warcraft", "/data/wow/pricing.generated.js", "TCG_PRICING", 3500);
await checkCatalog("pricing Weiß Schwarz", "/data/weiss/pricing.generated.js", "TCG_PRICING", 24000);
for (const [label, dir] of [["Pokémon", "/data/"], ["Lorcana", "/data/lorcana/"], ["One Piece", "/data/onepiece/"], ["Magic", "/data/magic/"], ["FAB", "/data/fab/"], ["Gundam", "/data/gundam/"], ["Star Wars Unlimited", "/data/swu/"], ["Cyberpunk", "/data/cyberpunk/"], ["Sorcery", "/data/sorcery/"], ["Dragon Ball Fusion", "/data/dbfw/"], ["Yu-Gi-Oh", "/data/ygo/"], ["Digimon", "/data/digimon/"], ["Riftbound", "/data/riftbound/"], ["Union Arena", "/data/unionarena/"], ["World of Warcraft", "/data/wow/"], ["Weiß Schwarz", "/data/weiss/"]]) {
  await checkJson(`deltas ${label}`, `${dir}price-deltas.generated.json`,
    (j) => j && typeof j === "object" && "c" in j ? null : "sem campo c");
  // Janela de 7 dias: é a que o aviso de queda da wishlist lê. Sem ela o push
  // cai no arquivo de 24h e passa a avisar muito menos, sem erro nenhum — o
  // tipo de quebra silenciosa que só um check pega.
  await checkJson(`deltas 7d ${label}`, `${dir}price-deltas-7d.generated.json`,
    (j) => j && typeof j === "object" && "c" in j ? null : "sem campo c");
}

log("\n[backend]");
// card_views (leitura pública estável) — public_profiles não é mais legível por
// anon depois do lockdown anti-scraping (migração 20260723b).
await checkJson("Supabase REST (anon)", `${SUPABASE_URL}/rest/v1/card_views?select=views&limit=1`,
  (j) => Array.isArray(j) ? null : "resposta não é array");

// Medição parada (Analytics 2.1): evento que chegava 3+/dia e zerou há 48h é
// quase sempre medição quebrada — nome fora da whitelist, migração faltando,
// busca de loja que mudou (store_click:<loja>). A RPC só devolve os NOMES em
// alarme, nada de contagem. 404 = migração 20260928a ainda não aplicada: não é
// falha de produção, só avisa. Desde a 20261004a o zero só alarma se o
// TRÁFEGO das 48h fazia esperar 6+ eventos: o fim da campanha paga (04/10)
// derrubou o scan_open junto com os visitantes e acendeu sem nada quebrado.
log("\n[analytics]");
await check("medição sem evento parado", async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_sentinela`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30000)
  });
  if (res.status === 404) return "RPC ausente (migração 20260928a pendente)";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parados = await res.json();
  if (Array.isArray(parados) && parados.length) throw new Error(`parou de chegar: ${parados.join(", ")}`);
});

// 2ª tentativa: só o que falhou, uma vez, depois da pausa. Passou agora = soluço.
const persistentes = [];
const soNaSegunda = [];
if (falhas.length) {
  log(`\n[2ª tentativa: ${falhas.length} falha(s), depois de ${PAUSA_2A_TENTATIVA_MS / 1000} s]`);
  await new Promise((r) => setTimeout(r, PAUSA_2A_TENTATIVA_MS));
  for (const f of falhas) {
    try {
      log(`  ✓ ${f.name}${detalhe(await f.tentativa())} — na 1ª: ${f.why}`);
      soNaSegunda.push(f.name);
      // No Actions vira aviso amarelo no resumo do run: o job segue verde, mas
      // o soluço fica à vista se começar a se repetir.
      if (process.env.GITHUB_ACTIONS === "true") {
        const msg = `${f.name} só passou na 2ª tentativa (1ª: ${f.why})`;
        log(`::warning title=Healthcheck::${msg.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
      }
    } catch (e) {
      log(`  ✗ ${f.name}: ${e.message}`);
      persistentes.push(`${f.name}: ${e.message}`);
    }
  }
}

if (persistentes.length) {
  log(`\n${persistentes.length} FALHA(S) nas duas tentativas:\n- ${persistentes.join("\n- ")}`);
  process.exit(1);
}
log(soNaSegunda.length ? `\nTudo saudável (na 2ª tentativa: ${soNaSegunda.join(", ")}).` : "\nTudo saudável.");
