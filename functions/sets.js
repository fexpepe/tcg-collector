// /sets — página de catálogo com vitrine (src/ads.js): serve o sets.html com a
// CSP de nonce que o AdSense exige. O porquê e as regras estão no
// functions/_vitrine-csp.js; a lista de páginas é a mesma da área "vitrine" do
// scripts/lib/css-areas.mjs (o tests/vitrine.test.mjs cruza as duas).
import { paginaComVitrine } from "./_vitrine-csp.js";

export const onRequestGet = (context) => paginaComVitrine(context, "/sets.html");
