// Varredura pós-deploy (item D8 do docs/PLANO-TECNICO.md): abre as telas
// principais do site NO AR num navegador de verdade, em desktop 1366 e
// celular 412 e 390, e falha quando alguma quebra do jeito que a passada
// técnica de 2026-10-02 achou à mão:
//   - erro de JS (`pageerror`) — o S1 (o rastreio que gerava o próprio erro);
//   - 4xx/5xx de arquivo NOSSO — o S6 (arquivo de leva que saiu do ar) e o S9
//     (logo de loja que não existe); de terceiro e da imagem do espelho, que
//     tem cadeia de reserva própria (S10), só aviso;
//   - a saída de emergência do boot (.falha-boot) — boot.js que não rodou ou
//     shared.js que não montou a navegação em 20 s;
//   - a tela de erro do catálogo (o #emptyState com `error.catalog`), que é
//     onde o boot despeja QUALQUER exceção do render (ver smoke-pages.mjs);
//   - CLS > 0,25 nas telas da tabela do S3;
//   - o 103 (Early Hints) com arquivo de outra leva — o S4 —, conferido pelo
//     curl, que mostra a resposta informativa (o Playwright e o fetch do Node
//     não mostram). Sem curl, ou base sem HTTPS, o passo só avisa.
//
// Falha só conta se REPETIR: o que falhou na primeira passada roda de novo no
// fim, depois de uma pausa, e só o que falhar as duas vezes deixa o job
// vermelho — a mesma regra do healthcheck.mjs e do uptime.yml. No 103 a
// pausa ainda serve de aquecimento: o Cloudflare aprende o Link novo no
// primeiro 200 que vê depois do deploy.
//
// A MEDIÇÃO FICA DE FORA: a varredura é robô, e o que ela fizesse viraria
// número no /admin (pageview, jserror, view de carta, contador de
// consentimento), visita no Cloudflare Web Analytics e — pior — impressão de
// anúncio, que o AdSense trata como tráfego inválido. Esses pedidos são
// respondidos aqui mesmo (route.fulfill) sem sair da máquina; os jserror que
// o site mandaria entram no relatório como aviso. O service worker fica
// bloqueado pelo mesmo motivo: pedido que passa por ele escapa do route.
//
// Uso:
//   node scripts/varredura-producao.mjs                       # produção
//   node scripts/varredura-producao.mjs --base http://127.0.0.1:8899 --local
//   node scripts/varredura-producao.mjs --so home,carta --aparelho android
// Variáveis: VARREDURA_BASE (no lugar do --base), VARREDURA_PAUSA_MS (pausa
// antes da 2ª passada; 30 s, a do uptime.yml).
//
// Playwright: no CI, `npm install --no-save playwright` + `npx playwright
// install --with-deps chromium` (deploy.yml, job "varredura"). Fora do
// escopo desta varredura e anotado no plano: o relatório semanal de
// desempenho com CPU/rede limitadas (LCP/TBT, o S8).
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  APARELHOS, PAGINAS_PRODUCAO, PAGINAS_LOCAIS, CAMINHOS_EARLY_HINTS, LIMITE_CLS,
  classificaResposta, ehNosso, clsDasEntradas, blocosDoCurl, confereEarlyHints,
  jserrorsDoCorpo, consolida, montaRelatorio
} from "./lib/varredura.mjs";

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const BASE = String(opcao("--base") || process.env.VARREDURA_BASE || "https://sleevu.app").replace(/\/+$/, "");
const LOCAL = args.includes("--local");
const SO = (opcao("--so") || "").split(",").filter(Boolean);
const SO_APARELHO = (opcao("--aparelho") || "").split(",").filter(Boolean);
const PAUSA_MS = Number(process.env.VARREDURA_PAUSA_MS || 30000);
const NO_ACTIONS = !!process.env.GITHUB_ACTIONS;

const paginas = (LOCAL ? PAGINAS_LOCAIS : PAGINAS_PRODUCAO).filter((p) => !SO.length || SO.includes(p.rotulo));
const aparelhos = APARELHOS.filter((a) => !SO_APARELHO.length || SO_APARELHO.includes(a.nome));

// O import "playwright" resolve onde o npm install --no-save deixou (CI). Na
// máquina com o Playwright global (NODE_PATH), o import de ESM não olha o
// NODE_PATH; o require olha.
async function carregaPlaywright() {
  try { return await import("playwright"); } catch (e) {
    try { return createRequire(import.meta.url)("playwright"); } catch (e2) {
      console.log("Sem Playwright: npm install --no-save playwright && npx playwright install chromium");
      process.exit(2);
    }
  }
}

// --- O que a varredura segura (ver o cabeçalho) ---------------------------
// Supabase: só as ESCRITAS de medição. As leituras (preço da comunidade,
// "mais vistas", perfis) seguem pra rede: são parte da tela.
const MEDICAO_SUPABASE = /\.supabase\.co\/rest\/v1\/(events|rpc\/(increment_card_view|increment_deck_view|contribute_price|consent_tally))(\?|$)/;
const BEACON_CLOUDFLARE = /^https:\/\/(static\.)?cloudflareinsights\.com\//;
const REDE_DE_ANUNCIO = /^https:\/\/[^/]*(googlesyndication\.com|doubleclick\.net|googletagservices\.com|googleadservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com)\//;

async function seguraMedicao(contexto, anota) {
  await contexto.route(MEDICAO_SUPABASE, async (route) => {
    for (const j of jserrorsDoCorpo(route.request().postData())) anota.jserror.push(j);
    anota.seguros++;
    await route.fulfill({ status: 204, body: "" });
  });
  await contexto.route(BEACON_CLOUDFLARE, (route) => { anota.seguros++; return route.fulfill({ status: 204, body: "" }); });
  await contexto.route(REDE_DE_ANUNCIO, (route) => {
    anota.seguros++;
    const tipo = route.request().resourceType();
    return route.fulfill({ status: 200, contentType: tipo === "script" ? "text/javascript" : "text/plain", body: "" });
  });
}

// CLS: o observador nasce antes de qualquer script da página (init script
// entra pelo protocolo do navegador, a CSP não barra) e guarda as entradas
// cruas; a conta das janelas é a do lib (testada).
function observaLayout() {
  window.__varreduraLS = [];
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) window.__varreduraLS.push({ value: e.value, startTime: e.startTime, hadRecentInput: e.hadRecentInput });
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) { /* navegador sem layout-shift: sem CLS */ }
}

async function visita(pw, navegador, aparelho, pagina) {
  const opcoesAparelho = aparelho.device ? pw.devices[aparelho.device] : { viewport: aparelho.janela };
  const contexto = await navegador.newContext(Object.assign({}, opcoesAparelho, { serviceWorkers: "block", locale: "pt-BR" }));
  const anota = { jserror: [], seguros: 0 };
  await seguraMedicao(contexto, anota);
  await contexto.addInitScript(observaLayout);
  const page = await contexto.newPage();
  const falhas = [], avisos = [], console_ = [];
  const url = BASE + pagina.caminho;

  page.on("pageerror", (e) => falhas.push(`js: ${String(e.message).split("\n")[0].slice(0, 200)}`));
  // "Failed to load resource" é o eco, no console, do 4xx/falha de rede que o
  // ouvinte de resposta já classificou (com o endereço, que o console não dá).
  page.on("console", (m) => {
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) console_.push(m.text().slice(0, 160));
  });
  page.on("response", (r) => {
    const c = classificaResposta({ url: r.url(), status: r.status(), tipo: r.request().resourceType() }, BASE, { local: LOCAL });
    if (c) (c.nivel === "falha" ? falhas : avisos).push(c.motivo);
  });
  page.on("requestfailed", (req) => {
    const erro = (req.failure() && req.failure().errorText) || "";
    // ERR_ABORTED é o próprio navegador desistindo (navegação, AbortController
    // do site, a imagem que saiu da tela) — não é o arquivo que falhou.
    if (/ERR_ABORTED/.test(erro) || !ehNosso(req.url(), BASE)) return;
    avisos.push(`rede: ${erro} ${new URL(req.url()).pathname}`);
  });

  const t0 = Date.now();
  let cls;
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    if (!resp) falhas.push("sem resposta");
    else if (resp.status() >= 400) falhas.push(`a própria tela respondeu HTTP ${resp.status()}`);

    // Saída de emergência: sem data-game o boot.js nem rodou (o cartão já
    // aparece); com o cartão na página, o shared.js tem 20 s pra carimbar o
    // data-app — o CSS acende o cartão aos 15.
    const temCartao = await page.evaluate(() => !!document.querySelector(".falha-boot"));
    if (temCartao) {
      const subiu = await page.waitForSelector("html[data-app]", { state: "attached", timeout: 20000 }).then(() => true, () => false);
      const semBoot = await page.evaluate(() => !document.documentElement.hasAttribute("data-game"));
      if (semBoot) falhas.push("saída de emergência: o boot.js não rodou (html sem data-game)");
      else if (!subiu) falhas.push("saída de emergência: a navegação não montou em 20 s (html sem data-app)");
    }
    // Deixa a tela assentar: o catálogo, a grade e as imagens chegam depois
    // do load, e é aí que ela pulava (S3).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const estado = await page.evaluate(() => {
      const vazio = document.getElementById("emptyState");
      const texto = vazio && !vazio.hidden ? (vazio.textContent || "") : "";
      const cartao = document.querySelector(".falha-boot");
      const visivel = !!cartao && getComputedStyle(cartao).display !== "none" && getComputedStyle(cartao).visibility !== "hidden";
      return {
        erroCatalogo: /(não foi possível carregar o catálogo|could not load the catalog|no se pudo cargar el catálogo)/i.test(texto) ? texto.trim().slice(0, 160) : "",
        cartaoVisivel: visivel,
        entradas: window.__varreduraLS || []
      };
    });
    if (estado.erroCatalogo) falhas.push(`tela de erro do catálogo: ${estado.erroCatalogo}`);
    if (estado.cartaoVisivel && !falhas.some((f) => f.startsWith("saída de emergência"))) falhas.push("saída de emergência visível");
    if (pagina.cls) {
      cls = clsDasEntradas(estado.entradas);
      if (cls > LIMITE_CLS) falhas.push(`CLS ${cls.toFixed(3)} (limite ${LIMITE_CLS})`);
    }
  } catch (e) {
    falhas.push(`não abriu: ${String(e.message).split("\n")[0].slice(0, 200)}`);
  }
  const ms = Date.now() - t0;
  await contexto.close();

  for (const j of new Set(anota.jserror)) avisos.push(`jserror que o site mandaria: ${j}`);
  // Erro de console sem pageerror: o "Refused to apply style" do 103 velho, a
  // CSP barrando a detecção de robô do Cloudflare (S11)… aviso, deduplicado.
  for (const c of new Set(console_)) avisos.push(`console: ${c}`);
  return {
    chave: `${aparelho.nome}|${pagina.rotulo}`,
    titulo: `${pagina.rotulo.padEnd(11)} ${aparelho.rotulo.padEnd(12)} ${pagina.caminho}`,
    falhas: [...new Set(falhas)], avisos: [...new Set(avisos)], cls, ms
  };
}

// O 103 pelo curl: ele imprime toda resposta informativa no -D. --http2
// porque o Cloudflare só manda Early Hints em HTTP/2 e 3. User-agent de
// NAVEGADOR (com a marca da varredura no fim): com um nome solto
// ("sleevu-varredura") a borda não manda 103 nenhum — conferido em
// 14/11/2026, o mesmo /hub dava 103 pro Chrome e pro curl e nada pro nome
// solto, e a conferência passava sem conferir.
const UA_NAVEGADOR = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 sleevu-varredura";
function curlCabecalhos(url) {
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "--http2", "-m", "30", "-D", "-", "-o", "/dev/null", "-H", `User-Agent: ${UA_NAVEGADOR}`, url],
      { timeout: 40000 }, (erro, saida) => resolve(erro ? { erro: String(erro.message).split("\n")[0] } : { saida }));
  });
}

async function conferenciaEarlyHints(caminho) {
  const r = await curlCabecalhos(BASE + caminho);
  const base = { chave: `103|${caminho}`, titulo: `${"103".padEnd(11)} ${"curl".padEnd(12)} ${caminho}`, falhas: [], avisos: [] };
  if (r.erro) return Object.assign(base, { avisos: [`não deu pra conferir o 103: ${r.erro}`] });
  const c = confereEarlyHints(blocosDoCurl(r.saida));
  if (c.estado === "velho") base.falhas.push(`103 manda arquivo de outra leva: ${c.velhos.join(", ")} (o 200 pede ${c.certos.join(", ") || "nenhum com hash"})`);
  else if (c.estado === "sem-103") base.avisos.push("sem 103 (Early Hints desligado ou fora do cache da borda)");
  else if (c.estado === "sem-resposta") base.falhas.push("o curl não trouxe resposta final");
  return base;
}

async function passada(pw, navegador, alvos) {
  const out = [];
  for (const alvo of alvos) {
    const r = alvo.tipo === "103" ? await conferenciaEarlyHints(alvo.caminho) : await visita(pw, navegador, alvo.aparelho, alvo.pagina);
    console.log(`  ${r.falhas.length ? "✗" : "✓"} ${r.titulo}${typeof r.cls === "number" ? ` · CLS ${r.cls.toFixed(3)}` : ""}`);
    out.push(r);
  }
  return out;
}

const pw = await carregaPlaywright();
const navegador = await pw.chromium.launch();
const alvos = [];
for (const aparelho of aparelhos) for (const pagina of paginas) alvos.push({ chave: `${aparelho.nome}|${pagina.rotulo}`, aparelho, pagina });
if (/^https:/.test(BASE) && !LOCAL && !SO.length) for (const caminho of CAMINHOS_EARLY_HINTS) alvos.push({ chave: `103|${caminho}`, tipo: "103", caminho });

console.log(`Varredura ${BASE} — ${new Date().toISOString()} — ${alvos.length} verificações\n[1ª passada]`);
const primeira = await passada(pw, navegador, alvos);
const refazer = alvos.filter((a) => primeira.find((r) => r.chave === a.chave && r.falhas.length));
let segunda = [];
if (refazer.length) {
  console.log(`\n[2ª passada: ${refazer.length} com falha, depois de ${Math.round(PAUSA_MS / 1000)} s]`);
  await new Promise((ok) => setTimeout(ok, PAUSA_MS));
  segunda = await passada(pw, navegador, refazer);
}
await navegador.close();

const relatorio = montaRelatorio(consolida(primeira, segunda), { base: BASE });
console.log("\n" + relatorio.texto);
if (process.env.GITHUB_STEP_SUMMARY) {
  try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Varredura pós-deploy\n\n\`\`\`\n${relatorio.texto}\n\`\`\`\n`); } catch (e) { /* resumo é extra */ }
}
if (relatorio.falhou) {
  if (NO_ACTIONS) console.log(`::error::Varredura: ${relatorio.resumo}`);
  process.exit(1);
}
if (NO_ACTIONS && relatorio.avisos) console.log(`::notice::Varredura: ${relatorio.resumo}`);
