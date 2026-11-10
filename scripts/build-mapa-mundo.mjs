// Gera o src/admin-mundo.js: o contorno dos países pro mapa do /admin
// (Aquisição › Audiência e Visão geral › Resumo, src/admin.js › mapaMundo).
//
// POR QUE GERADO: o painel desenha tudo em SVG inline, sem biblioteca. Um mapa
// precisa da geometria, e a do Natural Earth 1:110m (domínio público) pesa
// ~100 KB em TopoJSON, que ainda pediria um decodificador e uma projeção no
// navegador. Aqui ela já sai PROJETADA (Equal Earth: área proporcional, o
// Brasil não encolhe diante da Europa como no Mercator), em coordenadas
// inteiras numa grade de 2000 de largura e em caminhos relativos — o admin.js
// só põe o `d` no <path>. Sem a Antártida (ninguém visita de lá, e ela come
// um quinto da altura).
//
// O QUE SAI: window.TCGMundo = { w, h, fonte, formas, pontos }
//   formas  {BR: "M…z", …}  o caminho de cada país, pela sigla ISO de 2 letras
//                           (a mesma que o Cloudflare põe no cf-ipcountry);
//   pontos  {SG: [x, y], …} país pequeno demais pra 1:110m (Singapura, Hong
//                           Kong, Malta, ilhas): só o centro, que o painel
//                           marca com um círculo QUANDO há visitante de lá.
// Ajustes à mão, pra sigla bater com a do Cloudflare:
//   - a Guiana Francesa sai da França (o Natural Earth desenha as duas como um
//     país só; o Cloudflare manda GF, e pintar um pedaço da América do Sul
//     com o número da França engana justo onde está o público do Sleevu);
//   - Kosovo vira XK; o Chipre do Norte entra no CY e a Somalilândia no SO
//     (não têm sigla ISO, e o endereço de lá chega com a do país).
//
// COMO RODAR (o repo não tem package.json; as dependências ficam numa pasta
// temporária e NÃO entram no repositório):
//   mkdir /tmp/mapa && cd /tmp/mapa
//   npm i world-atlas@2.0.2 topojson-client@3.1.0 d3-geo@3.1.1 i18n-iso-countries@7
//   node <repo>/scripts/build-mapa-mundo.mjs /tmp/mapa
// Só precisa rodar de novo se a grade, a projeção ou os ajustes mudarem — a
// geometria do Natural Earth 1:110m não muda. O tests/admin-geo.test.mjs
// confere a forma do arquivo que está no repo.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pasta = process.argv[2];
if (!pasta) {
  console.error("uso: node scripts/build-mapa-mundo.mjs <pasta com as dependências instaladas> (ver o cabeçalho)");
  process.exit(1);
}
const req = createRequire(join(resolve(pasta), "x.js"));
const topo110 = req("world-atlas/countries-110m.json");
const topo50 = req("world-atlas/countries-50m.json");
const { feature } = req("topojson-client");
const iso = req("i18n-iso-countries");
const d3 = await import(pathToFileURL(req.resolve("d3-geo")).href);

const W = 2000;
const SEM_ISO = { "Kosovo": "XK", "N. Cyprus": "CY", "Somaliland": "SO" };
const sigla = (f) => (f.id != null ? iso.numericToAlpha2(String(f.id).padStart(3, "0")) : SEM_ISO[f.properties.name]) || null;

// Países do 1:110m, com a Guiana Francesa separada da França.
const paises = [];
for (const f of feature(topo110, topo110.objects.countries).features) {
  const co = sigla(f);
  if (!co) { console.warn("sem sigla, fica de fora:", f.properties.name); continue; }
  if (co === "AQ") continue;
  const poligonos = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  if (co === "FR") {
    const naGuiana = (p) => p[0][0][0] < -50 && p[0][0][0] > -56 && p[0][0][1] < 7;
    paises.push({ co: "GF", poligonos: poligonos.filter(naGuiana) });
    paises.push({ co: "FR", poligonos: poligonos.filter((p) => !naGuiana(p)) });
    continue;
  }
  paises.push({ co, poligonos });
}
const geo = (p) => ({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: p.poligonos } });
const tudo = { type: "FeatureCollection", features: paises.map(geo) };
const proj = d3.geoEqualEarth().fitWidth(W, tudo);
const [[, y0], [, y1]] = d3.geoPath(proj).bounds(tudo);
// 8 de respiro em cima e embaixo: o traço do contorno não encosta na borda.
const dy = 8 - y0, H = Math.ceil(y1 - y0 + 16);

// Anéis projetados (a projeção já corta no antimeridiano: Rússia, Fiji).
function aneis(f) {
  const out = [];
  let atual = null;
  d3.geoPath(proj, {
    moveTo(x, y) { atual = [[x, y + dy]]; out.push(atual); },
    lineTo(x, y) { atual.push([x, y + dy]); },
    closePath() {}, arc() {}
  })(f);
  return out;
}
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
// Inteiros, sem ponto repetido; ilha de menos de 4 unidades² some (a não
// ser que seja o país inteiro). Caminho relativo: "M12 34l5-3 2 8z".
function caminho(rs) {
  const q = rs.map((r) => {
    const pts = [];
    for (const [x, y] of r) {
      const p = [Math.round(x), Math.round(y)];
      const u = pts[pts.length - 1];
      if (!u || u[0] !== p[0] || u[1] !== p[1]) pts.push(p);
    }
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  }).filter((r) => r.length >= 3).sort((a, b) => area(b) - area(a));
  const fica = q.filter((r, i) => i === 0 || area(r) >= 4);
  return fica.map((r) => {
    let d = `M${r[0][0]} ${r[0][1]}l`, antes = r[0], primeiro = true;
    for (const p of r.slice(1)) {
      const dx = p[0] - antes[0], dyy = p[1] - antes[1];
      d += `${primeiro || dx < 0 ? "" : " "}${dx}${dyy < 0 ? "" : " "}${dyy}`;
      primeiro = false;
      antes = p;
    }
    return `${d}z`;
  }).join("");
}

const formas = {}, pontos = {};
for (const p of paises) {
  const d = caminho(aneis(geo(p)));
  if (d) formas[p.co] = (formas[p.co] || "") + d;
  else console.warn("sumiu na grade (vira ponto):", p.co);
}
// Quem só existe no 1:50m (ou sumiu na grade): o centro, pra marcar com um
// círculo. Territórios sem gente (ilhas desabitadas, recifes) não entram.
const DESERTOS = new Set(["HM", "BV", "GS", "IO", "UM", "TF", "AQ"]);
for (const f of feature(topo50, topo50.objects.countries).features) {
  const co = sigla(f);
  if (!co || formas[co] || pontos[co] || DESERTOS.has(co)) continue;
  const c = proj(d3.geoCentroid(f));
  if (c) pontos[co] = [Math.round(c[0]), Math.round(c[1] + dy)];
}

const ordena = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const fonte = "Natural Earth 1:110m (domínio público), via world-atlas 2.0.2; projeção Equal Earth";
const saida = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "admin-mundo.js");
writeFileSync(saida, `// GERADO por scripts/build-mapa-mundo.mjs — não edite à mão (o cabeçalho de lá
// explica o formato e como gerar de novo). Contorno dos países pro mapa do
// /admin: ${fonte}.
window.TCGMundo = ${JSON.stringify({ w: W, h: H, fonte, formas: ordena(formas), pontos: ordena(pontos) })};
`);
console.log(`src/admin-mundo.js: ${Object.keys(formas).length} países com contorno, ${Object.keys(pontos).length} só com ponto, grade ${W} × ${H}`);
