// O helper do JSON-LD mora em functions/_lib/json-ld.js desde 2026-09-30 (o
// porquê e a explicação do escape estão lá). As Functions do blog montam
// JSON-LD na borda, e o deploy APAGA scripts/ antes de o wrangler empacotar as
// Functions — importado daqui, o build quebrava com "Could not resolve
// ../../scripts/lib/json-ld.mjs" (a PR do blog foi barrada no CI por isso).
// Este arquivo fica só como reexport: o prerender e os testes seguem
// importando do mesmo lugar, e o código continua existindo uma vez só.
export { jsonLdSeguro } from "../../functions/_lib/json-ld.js";
