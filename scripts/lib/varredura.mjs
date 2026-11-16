// Lógica PURA da varredura pós-deploy (scripts/varredura-producao.mjs, item
// D8 do docs/PLANO-TECNICO.md). Mora separada do script porque o script
// precisa do Playwright, e o CI rápido (ci.yml) roda os testes sem navegador
// nenhum: aqui fica tudo o que decide — o que é arquivo nosso, o que é falha e
// o que é só aviso, a conta do CLS, a leitura do 103 e o relatório — e o
// tests/varredura.test.mjs confere sem abrir página.

// CLS acima disto reprova a tela. É o "ruim" do Core Web Vitals (bom ≤ 0,1,
// ruim > 0,25): o S3 levou as telas da tabela de 0,6–0,9 pra ≤ 0,1 no
// laboratório, e a varredura existe pra pegar a REGRESSÃO grande — o 0,1 que
// sobra no resumo da tela de set/carta (anotado no plano) não pode virar
// vermelho todo dia. A meta de 0,1 fica pro D5, medido em gente.
export const LIMITE_CLS = 0.25;

// Os três aparelhos do plano. `device` é o nome no registro do Playwright
// (viewport, escala, toque e user-agent de celular de verdade); o desktop é só
// a janela. Chromium com UA de iPhone não reproduz bug do WebKit (seção 8 do
// plano) — o 390 está aqui pela LARGURA, que é onde o layout do iPhone quebra.
export const APARELHOS = [
  { nome: "desktop", rotulo: "desktop 1366", janela: { width: 1366, height: 900 } },
  { nome: "android", rotulo: "Android 412", device: "Pixel 7" },
  { nome: "iphone", rotulo: "iPhone 390", device: "iPhone 13" }
];

// As telas. `cls: true` são as da tabela do S3 (as que pulavam); as outras
// entram pelo erro de JS e pelo 404, que é o que o S1/S9/S10 mostraram nelas.
// A carta é o Charizard 4/102, a mesma da medição de laboratório do S8.
export const PAGINAS_PRODUCAO = [
  { rotulo: "home", caminho: "/" },
  { rotulo: "hub", caminho: "/hub" },
  { rotulo: "sets", caminho: "/games/pokemon", cls: true },
  { rotulo: "set", caminho: "/games/pokemon/base-set", cls: true },
  { rotulo: "carta", caminho: "/games/pokemon/base-set/charizard-4-102", cls: true },
  { rotulo: "explorar", caminho: "/explore?q=charizard" },
  { rotulo: "condition", caminho: "/condition", cls: true },
  { rotulo: "help", caminho: "/help", cls: true },
  { rotulo: "lancamentos", caminho: "/lancamentos", cls: true },
  { rotulo: "novidades", caminho: "/novidades", cls: true }
];

// As mesmas telas no site LOCAL (npx http-server na raiz): sem as Functions da
// borda não existe /games/…, então vale a casca estática que a borda decora.
// Serve pra testar a própria varredura antes de subir, não pra medir CLS de
// produção (sem o índice que a borda escreve no HTML, o set não pula igual).
export const PAGINAS_LOCAIS = [
  { rotulo: "home", caminho: "/index.html" },
  { rotulo: "hub", caminho: "/hub.html" },
  { rotulo: "sets", caminho: "/sets.html?game=pokemon", cls: true },
  { rotulo: "set", caminho: "/detail.html?type=set&name=Base+Set&game=pokemon", cls: true },
  { rotulo: "explorar", caminho: "/explore.html?q=charizard" },
  { rotulo: "condition", caminho: "/condition.html", cls: true },
  { rotulo: "help", caminho: "/help.html", cls: true },
  { rotulo: "lancamentos", caminho: "/lancamentos.html", cls: true },
  { rotulo: "novidades", caminho: "/novidades.html", cls: true }
];

// O 103 que o S4 pegou com o CSS de levas velhas, nas quatro telas que o plano
// manda conferir depois de um deploy.
export const CAMINHOS_EARLY_HINTS = ["/", "/hub", "/games/pokemon", "/pokedex"];

// O espelho de imagens (R2). É "nosso", mas a imagem de carta tem cadeia de
// reserva própria (espelho → fonte original → placeholder): o 404 do espelho
// é a carta que o job ainda não espelhou (S10), não tela quebrada.
const HOST_ESPELHO = "img.sleevu.app";

// O que só o deploy tem: rodando contra o http-server local faltam por
// definição — o /data/ que o build gera (catálogo dos jogos que não ficam no
// git, game-pages do prerender, preços, calendário, mercado) e o /api/, que é
// Function da borda. Em produção NADA disso é ignorado.
const SO_EXISTEM_NO_DEPLOY = /^\/(data|api)\//;

// Arquivo nosso: mesma origem da base, ou o espelho de imagens.
export function ehNosso(url, base) {
  let u, b;
  try { u = new URL(url); b = new URL(base); } catch (e) { return false; }
  return u.origin === b.origin || u.hostname === HOST_ESPELHO;
}

// Uma resposta HTTP → null (tudo certo), { nivel: "aviso" } ou
// { nivel: "falha" }, com o motivo. `tipo` é o resourceType do navegador
// (document, script, stylesheet, image, font, fetch…).
export function classificaResposta({ url, status, tipo }, base, { local = false } = {}) {
  if (!(status >= 400)) return null;
  let u;
  try { u = new URL(url); } catch (e) { return { nivel: "aviso", motivo: `${status} ${url}` }; }
  const curto = u.hostname + u.pathname;
  if (!ehNosso(url, base)) return { nivel: "aviso", motivo: `terceiro: ${status} ${curto}` };
  if (u.hostname === HOST_ESPELHO && tipo === "image") {
    return { nivel: "aviso", motivo: `espelho sem a imagem (a cadeia cai na fonte): ${status} ${u.pathname}` };
  }
  // /cdn-cgi/ é do Cloudflare (detecção de robô, beacon), não do deploy.
  if (u.pathname.startsWith("/cdn-cgi/")) return { nivel: "aviso", motivo: `cloudflare: ${status} ${u.pathname}` };
  if (local && SO_EXISTEM_NO_DEPLOY.test(u.pathname)) return null;
  return { nivel: "falha", motivo: `${status} ${u.pathname}${u.search}` + (tipo ? ` (${tipo})` : "") };
}

// CLS como o Core Web Vitals conta: as mudanças de layout sem toque recente
// são agrupadas em janelas (cada uma acaba depois de 1 s sem mudança ou 5 s
// de duração) e o CLS é a MAIOR janela, não a soma de tudo. A soma crua
// castigaria a tela que fica aberta mais tempo.
export function clsDasEntradas(entradas) {
  let maior = 0, janela = 0, inicio = 0, ultima = 0;
  const ordenadas = (entradas || []).filter((e) => e && !e.hadRecentInput)
    .sort((a, b) => a.startTime - b.startTime);
  for (const e of ordenadas) {
    if (janela && e.startTime - ultima < 1000 && e.startTime - inicio < 5000) {
      janela += e.value;
    } else {
      janela = e.value;
      inicio = e.startTime;
    }
    ultima = e.startTime;
    if (janela > maior) maior = janela;
  }
  return Math.round(maior * 1000) / 1000;
}

// A saída do `curl -D -` em blocos de cabeçalho, na ordem em que chegaram:
// o 103 (se houver) e a resposta final. O "HTTP/1.1 200 Connection
// Established" do proxy (quando há um) vira um bloco sem cabeçalho, que não é
// 103 nem a última resposta — não atrapalha.
export function blocosDoCurl(texto) {
  const blocos = [];
  let atual = null;
  for (const linha of String(texto || "").split(/\r?\n/)) {
    const st = /^HTTP\/[\d.]+\s+(\d{3})/.exec(linha);
    if (st) { atual = { status: Number(st[1]), headers: {} }; blocos.push(atual); continue; }
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(linha);
    if (m && atual) {
      const nome = m[1].toLowerCase();
      atual.headers[nome] = atual.headers[nome] ? `${atual.headers[nome]}, ${m[2]}` : m[2];
    }
  }
  return blocos;
}

// Os arquivos COM HASH (nome.<8 hex>.css/js) de um cabeçalho Link. A fonte e
// o resto sem hash não mudam de leva, então não dizem nada sobre o 103 velho.
export function ativosComHash(link) {
  const achados = new Set();
  for (const m of String(link || "").matchAll(/<([^>]+)>/g)) {
    let caminho = m[1];
    try { caminho = new URL(caminho, "https://x").pathname; } catch (e) { /* fica como veio */ }
    if (/\.[0-9a-f]{8}\.(css|js)$/.test(caminho)) achados.add(caminho);
  }
  return achados;
}

// O 103 bate com o 200? "velho" = algum arquivo com hash que o 103 manda
// pré-carregar não é o que o 200 da mesma leva pede (o S4: o Cloudflare
// repete o Link que viu numa leva anterior). Sem 103 nenhum = Early Hints
// desligado, o que é escolha válida (opção b do S4), não falha.
export function confereEarlyHints(blocos) {
  const finais = (blocos || []).filter((b) => b.status >= 200);
  const final = finais[finais.length - 1];
  const dicas = (blocos || []).filter((b) => b.status === 103);
  if (!final) return { estado: "sem-resposta", velhos: [] };
  if (!dicas.length) return { estado: "sem-103", velhos: [] };
  const certos = ativosComHash(final.headers.link);
  const velhos = [];
  for (const d of dicas) for (const a of ativosComHash(d.headers.link)) if (!certos.has(a)) velhos.push(a);
  return { estado: velhos.length ? "velho" : "ok", velhos: [...new Set(velhos)], certos: [...certos] };
}

// Os eventos que o site mandaria pro Supabase e a varredura segurou: os
// jserror viram aviso (o rastreio do próprio site enxerga coisa que o
// `pageerror` não vê — recurso que não carregou, CSP), o resto só se conta.
export function jserrorsDoCorpo(corpo) {
  let j;
  try { j = JSON.parse(corpo || "null"); } catch (e) { return []; }
  const itens = Array.isArray(j) ? j : [j];
  return itens.filter((x) => x && x.name === "jserror" && x.props)
    .map((x) => `${x.props.k || "js"}: ${String(x.props.m || "").slice(0, 160)}`);
}

// Junta as duas passadas. Só é falha o que falhou nas DUAS (a mesma regra do
// healthcheck.mjs e do uptime.yml: soluço de rede não vira e-mail de
// "produção quebrada"); o que falhou só na primeira vira aviso de soluço.
// `primeira` e `segunda` são listas de { chave, falhas, avisos, … }; a
// segunda só tem as chaves que falharam na primeira.
export function consolida(primeira, segunda) {
  const refeitas = new Map((segunda || []).map((r) => [r.chave, r]));
  return (primeira || []).map((r) => {
    if (!r.falhas.length) return r;
    const de_novo = refeitas.get(r.chave);
    if (!de_novo) return r;
    if (de_novo.falhas.length) return Object.assign({}, de_novo, { repetiu: true });
    return Object.assign({}, de_novo, {
      avisos: [...r.falhas.map((f) => `soluço (só na 1ª passada): ${f}`), ...de_novo.avisos]
    });
  });
}

// Relatório legível: uma linha por tela × aparelho (✓/✗ e o CLS quando
// medido), os motivos embaixo, e o resumo no fim. `falhou` decide o exit code.
export function montaRelatorio(resultados, { base = "", limiteAvisos = 6 } = {}) {
  const linhas = [];
  let falhas = 0, avisos = 0;
  for (const r of resultados) {
    falhas += r.falhas.length;
    avisos += r.avisos.length;
    const marca = r.falhas.length ? "✗" : "✓";
    const cls = typeof r.cls === "number" ? ` · CLS ${r.cls.toFixed(3)}` : "";
    const tempo = typeof r.ms === "number" ? ` · ${(r.ms / 1000).toFixed(1)} s` : "";
    linhas.push(`  ${marca} ${r.titulo}${cls}${tempo}`);
    for (const f of r.falhas) linhas.push(`      ✗ ${f}`);
    const mostra = r.avisos.slice(0, limiteAvisos);
    for (const a of mostra) linhas.push(`      · ${a}`);
    if (r.avisos.length > mostra.length) linhas.push(`      · … e mais ${r.avisos.length - mostra.length} aviso(s)`);
  }
  const telas = resultados.length;
  const comFalha = resultados.filter((r) => r.falhas.length).length;
  const resumo = comFalha
    ? `${comFalha} de ${telas} verificações com falha (${falhas} falha(s), ${avisos} aviso(s))`
    : `${telas} verificações limpas (${avisos} aviso(s))`;
  const texto = [`Varredura ${base}`.trim(), ...linhas, "", resumo].join("\n");
  return { texto, falhou: comFalha > 0, falhas, avisos, resumo };
}
