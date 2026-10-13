// /listas virou /pastas (2026-09-16). O listas.html só existe pra link salvo
// não cair em 404, e leva a query junto (?id= da pasta aberta). Arquivo à
// parte porque a CSP do site (script-src 'self', sem 'unsafe-inline') barrava
// o <script> inline de antes: o link caía no meta refresh, que perde a query,
// e a pasta não abria (2026-10-13).
location.replace("pastas" + location.search + location.hash);
