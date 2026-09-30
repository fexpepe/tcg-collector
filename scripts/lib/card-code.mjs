// O código da carta mora em functions/_lib/card-code.js desde 2026-09-30: a
// página de carta passou a ser montada na borda (functions/games/), e o deploy
// APAGA scripts/ antes de o wrangler empacotar as Functions (mesmo motivo do
// json-ld.mjs). Este arquivo fica só como reexport: o prerender e os testes
// seguem importando do mesmo lugar, e o código continua existindo uma vez só.
export { splitNumberTotal, cardCode, numberSearchForms, cardCodeForms, alternateCodes } from "../../functions/_lib/card-code.js";
