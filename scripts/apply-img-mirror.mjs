// Passo do deploy: pergunta ao espelho de imagens (R2, img.sleevu.app) quais
// hosts de origem já estão COMPLETOS — o status que scripts/mirror-r2.mjs
// publica em _index/status.json — e injeta a lista no src/game.js
// (marcador SLEEVU_IMG_MIRROR, o mesmo padrão do MANIFEST). O cliente só
// aponta pro espelho nesses hosts, com a origem logo atrás na cadeia de
// fallback. Espelho vazio, fora do ar ou este ambiente sem rede = lista vazia
// = site igual ao de sempre. Roda ANTES da minificação (o marcador some nela).
//   node scripts/apply-img-mirror.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ESPELHO, ESQUEMA_ESPELHO, ORDEM } from "./lib/img-mirror.mjs";

const RAIZ = new URL("../", import.meta.url);
let hosts = [];
try {
  const r = await fetch(`${ESPELHO}_index/status.json`, { signal: AbortSignal.timeout(15000), headers: { "cache-control": "no-cache" } });
  if (r.ok) {
    const j = await r.json();
    // Só host completo NO ESQUEMA ATUAL: status de um esquema anterior aponta
    // pra chaves que o cliente de hoje não monta (seria 404 em toda imagem).
    hosts = ORDEM.filter((h) => j && j.hosts && j.hosts[h] && j.hosts[h].completo && j.hosts[h].esquema === ESQUEMA_ESPELHO);
  } else {
    console.log(`apply-img-mirror: o status do espelho respondeu HTTP ${r.status} — nenhum host espelhado neste build.`);
  }
} catch (e) {
  console.log(`apply-img-mirror: espelho inacessível (${e.message}) — nenhum host espelhado neste build.`);
}
mkdirSync(new URL("out/", RAIZ), { recursive: true });
writeFileSync(new URL("out/img-mirror.json", RAIZ), JSON.stringify({ hosts }));

const arquivo = new URL("src/game.js", RAIZ);
const src = readFileSync(arquivo, "utf8");
const marca = /var IMG_MIRROR_HOSTS = \[[^\]]*\]; \/\* SLEEVU_IMG_MIRROR \*\//;
if (!marca.test(src)) { console.error("apply-img-mirror: marcador SLEEVU_IMG_MIRROR não encontrado em src/game.js."); process.exit(1); }
writeFileSync(arquivo, src.replace(marca, `var IMG_MIRROR_HOSTS = ${JSON.stringify(hosts)}; /* SLEEVU_IMG_MIRROR */`));
console.log(`apply-img-mirror: hosts espelhados neste build: ${hosts.length ? hosts.join(", ") : "nenhum"}.`);
