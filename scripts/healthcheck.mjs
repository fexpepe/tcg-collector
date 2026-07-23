// Healthcheck de PRODUÇÃO (sleevu.app): valida que o site no ar está saudável —
// páginas respondem, catálogos parseiam com contagens plausíveis, preços/deltas
// publicados são JSON válido e o Supabase (leitura anônima) responde. Roda no
// GitHub Actions (healthcheck.yml, cron diário): qualquer falha derruba o job,
// e o GitHub notifica por e-mail. Sem dependências; roda local também:
//   node scripts/healthcheck.mjs
//
// Thresholds são ~metade do valor real de hoje (2026-07: Pokémon ~39k precificadas,
// Lorcana 3158, One Piece 8552): pegam catálogo zerado/truncado sem alarme falso
// em flutuação normal.
const PROD = "https://sleevu.app";
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const ANON_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública (RLS protege)

const failures = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, why) => { console.error(`  ✗ ${name}: ${why}`); failures.push(`${name}: ${why}`); };

// path relativo = produção; URL absoluta = usada como veio (Supabase leva a apikey).
async function get(path) {
  const url = /^https?:\/\//.test(path) ? path : PROD + path;
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers: url.startsWith(SUPABASE_URL) ? { apikey: ANON_KEY } : undefined
  });
}

// Página HTML: status esperado + um trecho que precisa estar no corpo.
async function checkPage(name, path, { status = 200, contains = "" } = {}) {
  try {
    const res = await get(path);
    if (res.status !== status) return fail(name, `HTTP ${res.status} (esperado ${status})`);
    if (contains) {
      const body = await res.text();
      if (!body.includes(contains)) return fail(name, `corpo sem "${contains}"`);
    }
    ok(name);
  } catch (e) { fail(name, e.message); }
}

// Catálogo window.<var> = [...]: parseia num sandbox e valida contagem mínima.
async function checkCatalog(name, path, varName, min) {
  try {
    const res = await get(path);
    if (!res.ok) return fail(name, `HTTP ${res.status}`);
    const w = {};
    new Function("window", await res.text())(w);
    const v = w[varName];
    const n = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0);
    if (n < min) return fail(name, `${n} entradas (mínimo ${min})`);
    ok(`${name} (${n})`);
  } catch (e) { fail(name, e.message); }
}

async function checkJson(name, path, validate) {
  try {
    const res = await get(path);
    if (!res.ok) return fail(name, `HTTP ${res.status}`);
    const j = await res.json();
    const why = validate ? validate(j) : null;
    if (why) return fail(name, why);
    ok(name);
  } catch (e) { fail(name, e.message); }
}

console.log(`Healthcheck ${PROD} — ${new Date().toISOString()}`);

console.log("\n[páginas]");
await checkPage("home", "/", { contains: "Sleevu" });
await checkPage("sitemap", "/sitemap.xml", { contains: "<urlset" });
await checkPage("página de set (SEO)", "/set/base-set", { contains: "Base Set" });
// 404 de verdade (anti soft-404): sem isto o Google indexa URL quebrada como 200.
await checkPage("404 real", "/healthcheck-caminho-inexistente", { status: 404 });

console.log("\n[catálogos]");
// Manifest: o que importa é a LISTA de sets dentro dele (Pokémon tem centenas
// de chunks entre 4 línguas), não as chaves do objeto.
try {
  const res = await get("/data/manifest.generated.js");
  if (!res.ok) fail("manifest Pokémon", `HTTP ${res.status}`);
  else {
    const w = {};
    new Function("window", await res.text())(w);
    const sets = (w.TCG_MANIFEST && w.TCG_MANIFEST.sets) || [];
    const total = sets.reduce((s, x) => s + (x.count || 0), 0);
    if (sets.length < 200 || total < 20000) fail("manifest Pokémon", `${sets.length} sets / ${total} cartas (mínimo 200/20000)`);
    else ok(`manifest Pokémon (${sets.length} sets, ${total} cartas)`);
  }
} catch (e) { fail("manifest Pokémon", e.message); }
await checkCatalog("cards Lorcana", "/data/lorcana/cards.js", "TCG_CARDS", 1500);
await checkCatalog("cards One Piece", "/data/onepiece/cards.js", "TCG_CARDS", 4000);
await checkCatalog("cards Naruto", "/data/naruto/cards.js", "TCG_CARDS", 400);
await checkCatalog("cards Hunter x Hunter", "/data/hxh/cards.js", "TCG_CARDS", 30);
await checkJson("chunk Pokémon (base1)", "/data/sets/en/base1.json",
  (j) => Array.isArray(j) && j.length >= 100 ? null : "chunk vazio/curto");

console.log("\n[preços]");
await checkCatalog("pricing Pokémon", "/data/pricing.generated.js", "TCG_PRICING", 20000);
await checkCatalog("pricing Lorcana", "/data/lorcana/pricing.generated.js", "TCG_PRICING", 1000);
await checkCatalog("pricing One Piece", "/data/onepiece/pricing.generated.js", "TCG_PRICING", 2000);
for (const [label, dir] of [["Pokémon", "/data/"], ["Lorcana", "/data/lorcana/"], ["One Piece", "/data/onepiece/"]]) {
  await checkJson(`deltas ${label}`, `${dir}price-deltas.generated.json`,
    (j) => j && typeof j === "object" && "c" in j ? null : "sem campo c");
}

console.log("\n[backend]");
// card_views (leitura pública estável) — public_profiles não é mais legível por
// anon depois do lockdown anti-scraping (migração 20260723b).
await checkJson("Supabase REST (anon)", `${SUPABASE_URL}/rest/v1/card_views?select=views&limit=1`,
  (j) => Array.isArray(j) ? null : "resposta não é array");

if (failures.length) {
  console.error(`\n${failures.length} FALHA(S):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTudo saudável.");
