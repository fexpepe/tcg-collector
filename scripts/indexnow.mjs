// IndexNow no deploy. O protocolo e o porquê estão em scripts/lib/indexnow.mjs.
//
//   node scripts/indexnow.mjs preparar <pasta> [--simular]
//
// Roda DEPOIS do prerender (os sitemaps novos já estão no disco) e ANTES do
// deploy (o site no ar ainda é o anterior). Compara os dois e grava em <pasta>
// um JSON por lote, pronto pro POST. O POST sai do deploy.yml, com curl, DEPOIS
// do deploy: o buscador confere a chave e as URLs no site, então elas precisam
// estar no ar. O script não pode fazer o POST ele mesmo, porque o passo
// "Remove arquivos" apaga scripts/ antes do deploy.
//
// Lê o site no ar pelo *.pages.dev, como o sync-ppt: é o mesmo deploy do
// sleevu.app, mas fora da zona, então o Bot Fight Mode (se voltar a ser
// ligado) não barra o runner do GitHub.
//
// Nunca derruba o build. Qualquer dúvida (rede, sitemap no ar vazio ou
// estranho) = não avisa nada neste deploy, com um aviso no log. Ficar quieto
// custa só esperar o robô passar; avisar errado em massa custa a confiança do
// buscador.
//
// --simular: mostra o que iria, sem gravar os lotes. Dá pra rodar local depois
// de um `node scripts/prerender-catalog.mjs`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lerSitemap } from "./lib/sitemap.mjs";
import { CHAVE, payload, urlsAlteradas, emLotes, priorizaComTeto, TETO_POR_DEPLOY } from "./lib/indexnow.mjs";

const LEITURA = "https://tcg-collector.pages.dev";
const args = process.argv.slice(2);
const [comando, pasta] = args.filter((a) => !a.startsWith("--"));
const SIMULAR = args.includes("--simular");

async function noAr(caminho) {
  return fetch(`${LEITURA}/${caminho}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000)
  });
}

async function lerNoAr(nome) {
  const res = await noAr(nome);
  if (!res.ok) throw new Error(`${nome} no ar: HTTP ${res.status}`);
  return res.text();
}

// Todas as URLs de um sitemap, índice ou não. `ler(nome)` devolve o XML de um
// arquivo da raiz (do disco ou do site no ar).
async function urlsDoSitemap(ler) {
  const raiz = lerSitemap(await ler("sitemap.xml"));
  if (!raiz.indice) return raiz.locs;
  const urls = [];
  for (const loc of raiz.locs) {
    const nome = new URL(loc).pathname.replace(/^\//, "");
    const filho = lerSitemap(await ler(nome));
    if (filho.indice) throw new Error(`${nome} é índice dentro de índice`);
    urls.push(...filho.locs);
  }
  return urls;
}

// A chave publicada é o marcador de "já avisamos antes". 404 = primeira vez.
// Qualquer outra resposta que não seja a chave certa é dúvida, e dúvida para.
async function chaveNoAr() {
  const res = await noAr(`${CHAVE}.txt`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`chave no ar: HTTP ${res.status}`);
  if ((await res.text()).trim() !== CHAVE) throw new Error("o arquivo da chave no ar tem outro conteúdo");
  return true;
}

async function preparar() {
  if (!pasta) throw new Error("uso: node scripts/indexnow.mjs preparar <pasta> [--simular]");
  if (!existsSync("sitemap.xml")) throw new Error("sem sitemap.xml no disco (o prerender rodou?)");
  const depois = await urlsDoSitemap((nome) => readFileSync(nome, "utf8"));
  if (!depois.length) throw new Error("o sitemap novo não tem URL nenhuma");

  let alteradas;
  let motivo;
  if (await chaveNoAr()) {
    const antes = await urlsDoSitemap(lerNoAr);
    if (!antes.length) throw new Error("o sitemap no ar veio vazio");
    alteradas = urlsAlteradas(antes, depois);
    motivo = `${alteradas.novas.length} nova(s) e ${alteradas.removidas.length} removida(s) em relação ao site no ar`;
  } else {
    alteradas = urlsAlteradas([], depois);
    motivo = "primeira vez (a chave ainda não está no ar): vai o sitemap inteiro";
  }
  const { enviar: urls, fora } = priorizaComTeto([...alteradas.novas, ...alteradas.removidas]);
  console.log(`IndexNow: ${motivo} → ${urls.length + fora} URL(s).`);
  if (fora) console.log(`IndexNow: teto de ${TETO_POR_DEPLOY} por deploy; ${fora} página(s) de carta ficam pro sitemap.`);
  if (!urls.length) return;

  const lotes = emLotes(urls);
  if (SIMULAR) {
    for (const u of urls.slice(0, 20)) console.log(`  ${u}`);
    if (urls.length > 20) console.log(`  … e mais ${urls.length - 20}`);
    console.log(`(--simular: ${lotes.length} lote(s) não gravado(s))`);
    return;
  }
  mkdirSync(pasta, { recursive: true });
  lotes.forEach((lote, i) => writeFileSync(join(pasta, `lote-${i + 1}.json`), JSON.stringify(payload(lote)), "utf8"));
  console.log(`IndexNow: ${lotes.length} lote(s) em ${pasta}, enviados depois do deploy.`);
}

if (comando !== "preparar") {
  console.error("uso: node scripts/indexnow.mjs preparar <pasta> [--simular]");
  process.exit(2);
}
try {
  await preparar();
} catch (e) {
  // ::warning:: vira aviso amarelo no resumo do Actions, sem derrubar o job.
  console.log(`::warning::IndexNow: ${e.message}. Nada avisado neste deploy.`);
}
