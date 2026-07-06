// Robô semanal de web push: cruza as wishlists SINCRONIZADAS (usuários logados
// que ligaram o aviso nas Configurações) com os price-deltas publicados no site
// e notifica as QUEDAS (>= 5%). Roda no GitHub Actions (push-wishlist.yml).
//
// Secrets (env): PUSH_SENDER_KEY (valida na função do banco, por hash) e
// VAPID_PRIVATE_KEY. A chave VAPID pública é pública por design (mesma do
// cliente). Sem secrets, é no-op (sai com sucesso).
//
// Privacidade: o robô só lê endpoint+chaves da assinatura e os IDs da wishlist —
// e só de quem OPTOU pelo aviso. Nada de coleção, nomes ou e-mails.
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const ANON_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";
const PROD = "https://sleevu.app";
const VAPID_PUBLIC = "BP-4UgJQ79n0nYxdddKDBMjIh5GHDNYQv9gGftS0wzdk9-6ei7WupeCbA-l_nZ52BL1G0TDBsRAjMNoAJhiWytg";
const SENDER_KEY = process.env.PUSH_SENDER_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const DROP_PCT = -5; // só quedas relevantes

if (!SENDER_KEY || !VAPID_PRIVATE) { console.log("[push] sem secrets — no-op."); process.exit(0); }
// Import dinâmico DEPOIS do guard: o no-op (sem secrets) não exige o pacote.
const webpush = (await import("web-push")).default;
webpush.setVapidDetails("mailto:fernandopepe.pereira@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

const rpc = (fn, body) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: "POST",
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Deltas da semana (gerados no build) por jogo: { from, to, c: { id: pct } }.
async function loadDeltas(dir) {
  try { const r = await fetch(`${PROD}/${dir}price-deltas.generated.json`); return r.ok ? await r.json() : null; } catch { return null; }
}

const [pkDeltas, lcDeltas, opDeltas] = await Promise.all([
  loadDeltas("data/"), loadDeltas("data/lorcana/"), loadDeltas("data/onepiece/")
]);
const deltasByGame = {
  pokemon: (pkDeltas && pkDeltas.c) || {},
  lorcana: (lcDeltas && lcDeltas.c) || {},
  onepiece: (opDeltas && opDeltas.c) || {}
};
// Sem process.exit daqui em diante (fecha handles pendentes de fetch no Windows);
// os "returns" são só fluxo normal — o processo termina sozinho, exit code 0.
if (!Object.values(deltasByGame).some((d) => Object.keys(d).length)) {
  console.log("[push] sem deltas publicados (primeira semana?) — nada a enviar.");
} else {
  await run();
}

async function run() {
  const res = await rpc("push_targets", { p_key: SENDER_KEY });
  if (!res.ok) { console.error(`[push] push_targets HTTP ${res.status}`); process.exitCode = 1; return; }
  const rows = await res.json();
  if (!rows.length) { console.log("[push] nenhuma assinatura com wishlist sincronizada."); return; }

  // Um usuário tem 1 linha por (assinatura × jogo); agrega por endpoint.
  const byEndpoint = new Map();
  for (const r of rows) {
    let e = byEndpoint.get(r.endpoint);
    if (!e) { e = { sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, lang: r.lang || "pt", drops: [] }; byEndpoint.set(r.endpoint, e); }
    // Jogo desconhecido (ex.: linha 'hub' órfã) não casa com delta nenhum.
    const deltas = deltasByGame[r.game || "pokemon"] || {};
    Object.keys(r.wishlist || {}).forEach((cardId) => {
      const pct = deltas[cardId];
      if (pct != null && pct <= DROP_PCT) e.drops.push(pct);
    });
  }

  const MSG = {
    pt: (n, worst) => ({ title: "Sleevu — quedas na sua wishlist", body: `${n} carta${n > 1 ? "s" : ""} da sua wishlist caiu${n > 1 ? "ram" : ""} de preço esta semana (até ${worst}%). Toque pra ver.` }),
    en: (n, worst) => ({ title: "Sleevu — wishlist price drops", body: `${n} card${n > 1 ? "s" : ""} on your wishlist dropped in price this week (up to ${worst}%). Tap to see.` })
  };

  let sent = 0, skipped = 0, pruned = 0;
  for (const { sub, lang, drops } of byEndpoint.values()) {
    if (!drops.length) { skipped++; continue; }
    const worst = Math.min(...drops);
    const m = (MSG[lang] || MSG.pt)(drops.length, worst);
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: m.title, body: m.body, url: "wishlist.html" }), { TTL: 3 * 24 * 3600 });
      sent++;
    } catch (err) {
      // 404/410 = assinatura morta (navegador revogou): limpa no banco.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await rpc("push_prune", { p_key: SENDER_KEY, p_endpoint: sub.endpoint }).catch(() => {});
        pruned++;
      } else {
        console.error(`[push] falha ${err && err.statusCode}: ${String(err && err.message).slice(0, 120)}`);
      }
    }
  }
  console.log(`[push] enviados ${sent} · sem quedas ${skipped} · assinaturas mortas limpas ${pruned}`);
}
