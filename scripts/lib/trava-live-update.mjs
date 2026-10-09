// Trava do live update do app (Capgo), pedida pelo Fernando em 2026-10-08.
//
// Live update troca o HTML/JS/CSS de TODO app instalado, sem loja e sem
// revisão. A main recebe vários pushes por dia (snapshot do catálogo, sessões
// em paralelo); se o envio pro Capgo pegasse carona num push, num merge ou
// num build do Codemagic, cada um viraria update pra todo mundo. Então existe
// UMA porta de saída, o .github/workflows/app-live-update.yml:
//
//   - gatilho só `workflow_dispatch` (alguém aperta o botão);
//   - job `confere`, sem segredo nem ambiente, que barra pedido fora da main,
//     sem a palavra PUBLICAR e com o ambiente desprotegido (sem aprovação
//     manual ou com admin podendo pular);
//   - o job que publica depende dele (`needs: confere`) e roda no ambiente
//     `app-live-update`, o único lugar onde o token do Capgo existe;
//   - nada de `always()`/`failure()`/`cancelled()` nem `continue-on-error`,
//     que deixariam o job de publicar rodar com o `confere` vermelho.
//
// Fora da porta, nenhum arquivo de automação (workflows, codemagic.yaml,
// scripts dos package.json, scripts/, projetos nativos em mobile/) pode
// chamar a CLI do Capgo, tocar o token ou usar o ambiente. O plugin do app
// (`@capgo/capacitor-updater`) não conta: ele só BAIXA update, quem publica é
// a CLI.
//
// Lido como texto por regex, sem parser de YAML (o repo não tem dependência).
// O formato que a guarda entende é o dos workflows daqui: chave de topo na
// coluna 0, filhos indentados com espaço.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const PORTA = ".github/workflows/app-live-update.yml";
export const AMBIENTE = "app-live-update";
const ESTE = "scripts/lib/trava-live-update.mjs";

const RE_CLI = /@capgo\/cli\b|\bcapgo\s+(?:bundle|upload|channel|login)\b/i;
// CAPGO sozinho também: foi o nome que o segredo ganhou na 1ª configuração do
// ambiente (2026-10-08), e `secrets.CAPGO` passava reto por `CAPGO_…`.
const RE_TOKEN = /\bCAPGO(?:_[A-Z0-9_]+)?\b/;
const RE_AMBIENTE = /\benvironment\s*:\s*(?:name\s*:\s*)?["']?app-live-update\b/;
const RE_SEGREDO = /\bsecrets\./;
const RE_DESVIO = /\b(?:always|failure|cancelled)\s*\(\s*\)/;

const linhas = (t) => t.split(/\r?\n/);
const vazia = (l) => /^\s*(?:#.*)?$/.test(l);
const recuo = (l) => l.match(/^ */)[0].length;

// Filhos diretos de uma chave de topo (`on:`, `jobs:`). Devolve
// { inline, filhos: [{ nome, corpo }] } ou null se a chave não existe.
// `inline` é o valor na mesma linha (`on: [push]`), sem comentário.
function blocoDeTopo(texto, chave) {
  const ls = linhas(texto);
  const re = new RegExp(`^["']?${chave}["']?\\s*:(.*)$`);
  const i = ls.findIndex((l) => re.test(l));
  if (i < 0) return null;
  const inline = ls[i].match(re)[1].replace(/\s+#.*$/, "").trim();
  const filhos = [];
  let nivel = null;
  for (let j = i + 1; j < ls.length; j++) {
    const l = ls[j];
    if (vazia(l)) continue;
    const n = recuo(l);
    if (n === 0) break;
    if (nivel === null) nivel = n;
    if (n === nivel) {
      const m = l.match(/^\s*(?:-\s*)?["']?([\w-]+)["']?/);
      filhos.push({ nome: m ? m[1] : l.trim(), corpo: [l] });
    } else if (filhos.length) filhos[filhos.length - 1].corpo.push(l);
  }
  return { inline, filhos: filhos.map((f) => ({ nome: f.nome, corpo: f.corpo.join("\n") })) };
}

// Gatilhos do workflow, nas três formas: bloco, lista inline e valor solto.
export function gatilhos(texto) {
  const b = blocoDeTopo(texto, "on");
  if (!b) return [];
  if (b.inline) {
    return b.inline.replace(/[[\]{}]/g, "").split(",")
      .map((s) => s.split(":")[0].trim().replace(/["']/g, "")).filter(Boolean);
  }
  return b.filhos.map((f) => f.nome);
}

// Valor do `needs:` de um job (inline ou em lista), como lista de nomes.
function needsDe(corpo) {
  const m = corpo.match(/^\s*needs\s*:([^\n]*)((?:\n\s+-[^\n]*)*)/m);
  if (!m) return [];
  return (m[1] + m[2]).replace(/[[\]\-"']/g, " ").split(/[\s,]+/).filter(Boolean);
}

function confereAPorta(texto) {
  const erros = [];
  const e = (m) => erros.push(`${PORTA}: ${m} (trava do live update, scripts/lib/trava-live-update.mjs)`);

  const g = gatilhos(texto);
  if (g.length !== 1 || g[0] !== "workflow_dispatch") {
    e(`o gatilho tem que ser SÓ workflow_dispatch — achei: ${g.join(", ") || "nenhum"}`);
  }
  const on = blocoDeTopo(texto, "on");
  const dispatch = on && on.filhos.find((f) => f.nome === "workflow_dispatch");
  if (!dispatch || !/\bconfirmacao\s*:/.test(dispatch.corpo)) e("sumiu o campo `confirmacao` do workflow_dispatch");

  const ls = linhas(texto);
  const codigo = ls.filter((l) => !vazia(l)).join("\n");
  if (RE_DESVIO.test(codigo)) e("always()/failure()/cancelled() deixariam publicar com o `confere` vermelho");
  if (/\bcontinue-on-error\b/.test(codigo)) e("continue-on-error deixaria o `confere` passar com checagem falhando");

  const iJobs = ls.findIndex((l) => /^jobs\s*:/.test(l));
  // Sem as linhas de comentário: o cabeçalho da porta explica o segredo pelo nome.
  const antes = (iJobs < 0 ? ls : ls.slice(0, iJobs)).filter((l) => !vazia(l)).join("\n");
  if (RE_TOKEN.test(antes) || RE_SEGREDO.test(antes)) e("segredo fora dos jobs (env do topo) escapa da aprovação do ambiente");

  const jobs = (blocoDeTopo(texto, "jobs") || { filhos: [] }).filhos;
  const confere = jobs.find((j) => j.nome === "confere");
  if (!confere) e("sumiu o job `confere`");
  else {
    if (RE_AMBIENTE.test(confere.corpo) || RE_TOKEN.test(confere.corpo) || RE_SEGREDO.test(confere.corpo)) {
      e("o job `confere` não pode ter segredo nem ambiente — ele roda ANTES da aprovação");
    }
    // A marca é o pedaço da CONDIÇÃO, não da mensagem de erro: entre aspas
    // ("PUBLICAR") e o caminho do jq (.can_admins_bypass). Senão apagar o `if`
    // e deixar só o `echo` passaria na guarda.
    for (const [marca, oQue] of [
      ['"refs/heads/main"', "pedido só da main"],
      ['"PUBLICAR"', "palavra PUBLICAR"],
      ["*,required_reviewers,*", "aprovação manual no ambiente"],
      [".can_admins_bypass", "admin sem atalho pela aprovação"]
    ]) {
      if (!confere.corpo.includes(marca)) e(`o job \`confere\` perdeu a checagem de ${oQue} (${marca})`);
    }
  }
  for (const j of jobs) {
    if (j.nome === "confere") continue;
    if (!(RE_CLI.test(j.corpo) || RE_TOKEN.test(j.corpo) || RE_SEGREDO.test(j.corpo))) continue;
    if (!RE_AMBIENTE.test(j.corpo)) e(`o job \`${j.nome}\` usa a CLI ou o token do Capgo fora do ambiente ${AMBIENTE}`);
    if (!needsDe(j.corpo).includes("confere")) e(`o job \`${j.nome}\` publica sem \`needs: confere\``);
  }
  return erros;
}

// arquivos: { caminho: texto }. Devolve a lista de erros (vazia = trava ok).
export function confereTravaLiveUpdate(arquivos) {
  const erros = [];
  for (const [caminho, texto] of Object.entries(arquivos)) {
    if (caminho === PORTA) { erros.push(...confereAPorta(texto)); continue; }
    const fora = (o) => erros.push(`${caminho}: ${o} — live update só sai pelo ${PORTA}, à mão e com aprovação (trava de 2026-10-08)`);
    if (RE_CLI.test(texto)) fora("chama a CLI do Capgo");
    if (RE_TOKEN.test(texto)) fora("toca o token do Capgo");
    if (RE_AMBIENTE.test(texto)) fora(`usa o ambiente ${AMBIENTE}`);
  }
  return erros;
}

// Pastas geradas dentro do app (mobile/): dependências, o pacote web montado
// e a cópia dele nos projetos nativos, saídas de build. Nada disso é receita.
const GERADO_NO_APP = /^(?:node_modules|www|public|build|\.gradle|DerivedData|Pods)$/;

// Junta os arquivos de automação do repositório no formato que a guarda lê.
// Do package.json (o da raiz e o do app) só entram os "scripts": a
// dependência do plugin ou da CLI não publica nada sozinha; o comando que
// roda, sim. No app também entram os projetos nativos: uma tarefa do Gradle ou
// um "Run Script" do Xcode chamando a CLI seria um envio escondido no build
// de loja.
export function arquivosDeAutomacao(raiz) {
  const arquivos = {};
  const ler = (rel) => { arquivos[rel] = readFileSync(join(raiz, rel), "utf8"); };
  const varre = (dir, re, pula = null) => {
    if (!existsSync(join(raiz, dir))) return;
    for (const nome of readdirSync(join(raiz, dir))) {
      const rel = `${dir}/${nome}`;
      if (statSync(join(raiz, rel)).isDirectory()) { if (!(pula && pula.test(nome))) varre(rel, re, pula); }
      else if (re.test(nome) && rel !== ESTE) ler(rel);
    }
  };
  varre(".github", /\.(?:ya?ml|sh|m?js|cjs|json)$/);
  varre("scripts", /\.(?:m?js|cjs|sh|ps1)$/);
  varre("mobile", /\.(?:gradle|kts|pbxproj|sh|m?js|cjs|ps1|ya?ml)$/, GERADO_NO_APP);
  for (const f of ["codemagic.yaml", "codemagic.yml"]) if (existsSync(join(raiz, f))) ler(f);
  for (const pkg of ["package.json", "mobile/package.json"]) {
    if (!existsSync(join(raiz, pkg))) continue;
    let scripts = {};
    try { scripts = JSON.parse(readFileSync(join(raiz, pkg), "utf8")).scripts || {}; }
    catch { /* package.json quebrado é problema de outro check */ }
    arquivos[`${pkg} (scripts)`] = JSON.stringify(scripts, null, 2);
  }
  return arquivos;
}
