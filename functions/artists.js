// /artists — página de catálogo com vitrine (src/ads.js): serve o artists.html com a
// CSP de nonce que o AdSense exige. O porquê e as regras estão no
// functions/_vitrine-csp.js; a lista de páginas é a mesma da área "vitrine" do
// scripts/lib/css-areas.mjs (o tests/vitrine.test.mjs cruza as duas).
// No pé da tela, o índice das páginas /artist/<slug> (functions/_lib/indices.js).
import { paginaComVitrine } from "./_vitrine-csp.js";
import { comIndice, indiceDeArtistas } from "./_lib/indices.js";

const indice = comIndice("/data/game-pages/artistas.json", indiceDeArtistas);
export const onRequestGet = (context) => paginaComVitrine(context, "/artists.html", indice);
