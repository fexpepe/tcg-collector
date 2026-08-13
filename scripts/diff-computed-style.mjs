// Compara o estilo COMPUTADO de cada elemento das páginas principais entre dois
// servidores locais (antes/depois de uma mudança de CSS). É a conferência do
// scripts/split-css.mjs: repartir CSS muda a ORDEM da cascata, e um erro aí não
// aparece em teste de unidade nem em screenshot ruidoso — aparece como uma cor
// ou um espaçamento diferente numa tela que ninguém abriu.
// Uso: sirva o antes na 8899 e o depois na 8866, e rode `node scripts/diff-computed-style.mjs`.
// Meta: "nenhum estilo mudou".
// O import é resolvido normalmente (node_modules): o caminho absoluto que
// estava aqui era o de uma máquina Linux específica e quebrava no Windows, que
// é justamente onde este script é rodado à mão. Precisa de `npm install
// playwright --no-save` antes (ver README).
import { chromium } from "playwright";
const paginas = ["index.html", "login.html", "decks.html", "my-decks.html", "portfolio.html",
  "settings.html", "profile.html", "admin.html", "wishlist.html", "sales.html", "help.html",
  "hub.html", "sets.html?game=pokemon", "collection.html", "faq.html", "binders.html", "graded.html"];
const PROPS = ["display","position","color","background-color","border-radius","border-width","border-color",
  "font-size","font-weight","padding","margin","width","height","flex-direction","grid-template-columns",
  "gap","text-align","opacity","box-shadow","overflow","z-index","transform","line-height","letter-spacing"];

async function coleta(porta) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("tcg-collector-ui-lang-v1", "pt");
    localStorage.setItem("tcg-collector-theme-v1", "dark");
    localStorage.setItem("tcg-supabase-session-v1", JSON.stringify({ access_token: "fake", refresh_token: "fake", expires_at: 4102444800, user: { id: "00000000-0000-4000-8000-000000000000", email: "t@sleevu.app" } }));
  });
  const out = {};
  for (const pag of paginas) {
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${porta}/${pag}`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(3500);
    out[pag] = await p.evaluate((props) => {
      // Assinatura por elemento: caminho estrutural + classes + estilos.
      const caminho = (el) => {
        const partes = [];
        for (let n = el; n && n.nodeType === 1 && partes.length < 6; n = n.parentElement) {
          partes.unshift(`${n.tagName}${n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).join(".") : ""}`);
        }
        return partes.join(">");
      };
      const mapa = {};
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        const chave = caminho(el);
        if (mapa[chave]) continue; // primeira ocorrência de cada assinatura basta
        mapa[chave] = props.map((p) => cs.getPropertyValue(p)).join("|");
      }
      return mapa;
    }, PROPS);
    await p.close();
  }
  await b.close();
  return out;
}

const antes = await coleta("8899");
const depois = await coleta("8866");
let totalDif = 0;
for (const pag of paginas) {
  const a = antes[pag] || {}, d = depois[pag] || {};
  const chaves = new Set([...Object.keys(a), ...Object.keys(d)]);
  const difs = [];
  for (const k of chaves) {
    if (!(k in a) || !(k in d)) continue;       // elemento só existe num lado = conteúdo dinâmico
    if (a[k] !== d[k]) difs.push(k);
  }
  totalDif += difs.length;
  console.log(`${difs.length ? "DIFERE " : "ok     "} ${pag}  (${chaves.size} assinaturas, ${difs.length} com estilo diferente)`);
  difs.slice(0, 4).forEach((k) => console.log(`        ${k.slice(-90)}`));
}
console.log(totalDif ? `\nTOTAL: ${totalDif} elementos com estilo alterado` : "\nnenhum estilo mudou");
