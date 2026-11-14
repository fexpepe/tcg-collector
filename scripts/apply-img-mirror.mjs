// Passo do deploy: pergunta ao espelho de imagens (R2, img.sleevu.app) quais
// hosts de origem já estão COMPLETOS — o status que scripts/mirror-r2.mjs
// publica em _index/status.json —, em qual geração e quais já têm a largura
// intermediária (450), e injeta as três coisas no src/game.js (marcadores
// SLEEVU_IMG_MIRROR, SLEEVU_IMG_MIRROR_GEN e SLEEVU_IMG_MIRROR_450, o
// mesmo padrão do MANIFEST). O cliente só aponta pro espelho nesses hosts,
// com a origem logo atrás na cadeia de fallback. Espelho vazio, fora do ar ou
// este ambiente sem rede = lista vazia = site igual ao de sempre. Roda ANTES
// da minificação (o marcador some nela).
//   node scripts/apply-img-mirror.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ESPELHO, injetaEspelho, statusDoEspelho } from "./lib/img-mirror.mjs";

const RAIZ = new URL("../", import.meta.url);
let espelho = { hosts: [], geracoes: {}, intermediaria: [] };
try {
  const r = await fetch(`${ESPELHO}_index/status.json`, { signal: AbortSignal.timeout(15000), headers: { "cache-control": "no-cache" } });
  if (r.ok) {
    // Só host completo NO ESQUEMA ATUAL: status de um esquema anterior aponta
    // pra chaves que o cliente de hoje não monta (seria 404 em toda imagem).
    espelho = statusDoEspelho(await r.json());
  } else {
    console.log(`apply-img-mirror: o status do espelho respondeu HTTP ${r.status} — nenhum host espelhado neste build.`);
  }
} catch (e) {
  console.log(`apply-img-mirror: espelho inacessível (${e.message}) — nenhum host espelhado neste build.`);
}
mkdirSync(new URL("out/", RAIZ), { recursive: true });
writeFileSync(new URL("out/img-mirror.json", RAIZ), JSON.stringify(espelho));

const arquivo = new URL("src/game.js", RAIZ);
try {
  writeFileSync(arquivo, injetaEspelho(readFileSync(arquivo, "utf8"), espelho));
} catch (e) {
  console.error(`apply-img-mirror: ${e.message}.`);
  process.exit(1);
}
const { hosts, geracoes, intermediaria } = espelho;
const rotulo = (h) => [geracoes[h] ? `geração ${geracoes[h]}` : "", intermediaria.includes(h) ? "com a 450" : ""].filter(Boolean).join(", ");
console.log(`apply-img-mirror: hosts espelhados neste build: ${hosts.length ? hosts.map((h) => (rotulo(h) ? `${h} (${rotulo(h)})` : h)).join(", ") : "nenhum"}.`);
