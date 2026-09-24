// Passo do deploy (depois do merge-catalogs): AVISA quando um id que nós
// inventamos encontrou a carta oficial com outro id. Lê o relatório que o merge
// escreve (data/provisional-ids.generated.json, ver lib/provisional-ids.mjs) e:
//   · applied — gêmea ÚNICA: o merge já gravou o de-para e a conta de quem
//     marcou migra sozinha. O aviso é pra alguém conferir o par (24/09/2026:
//     "um sinal de que isso aconteceu, pra corrigir rápido");
//   · pending — gêmea AMBÍGUA ou só suspeita (mesmo número, outra carta): nada
//     foi mexido, precisa de gente — pin em data/card-id-merges.json (cards).
//
// O sinal é uma ISSUE no GitHub (o e-mail de notificação chega no celular),
// uma só aberta por vez: achado novo vira comentário nela, e achado que ela já
// cita não repete — o pendente reaparece a cada build até alguém resolver, e
// sem isso seria uma issue por deploy. Sem GITHUB_TOKEN (rodando local) ou com a
// API fora, cai pro ::warning:: do Actions, que aparece no resumo do run.
//
//   node scripts/report-provisional-ids.mjs            # no deploy
//   node scripts/report-provisional-ids.mjs --dry-run  # só imprime o texto
import { readFile } from "node:fs/promises";

const TITULO = "IDs provisórios: carta oficial chegou com outro id";
const DRY = process.argv.includes("--dry-run");

let rel;
try { rel = JSON.parse(await readFile(new URL("../data/provisional-ids.generated.json", import.meta.url), "utf8")); }
catch { console.log("report-provisional-ids: sem relatório do merge (o merge não rodou?) — nada a avisar"); process.exit(0); }

const applied = Array.isArray(rel.applied) ? rel.applied : [];
const pending = Array.isArray(rel.pending) ? rel.pending : [];
const origem = Object.entries(rel.provisional || {}).map(([k, n]) => `${k}: ${n}`).join(" · ") || "nenhum";
console.log(`report-provisional-ids: ids provisórios no ar (${origem}) · ${applied.length} migrado(s) sozinho(s) · ${pending.length} pendente(s)`);
if (!applied.length && !pending.length) process.exit(0);

// Uma linha por achado; o id provisório abre a linha (é a chave do "já citado").
const linhaApplied = (a) => `- \`${a.from}\` → \`${a.to}\` (${a.lang}/${a.setId}, nº ${a.number}, ${a.name}) — de-para gravado, conta migra sozinha`;
const linhaPending = (p) => p.candidates
  ? `- \`${p.id}\` (${p.lang}/${p.setId}, nº ${p.number}, ${p.name}) — AMBÍGUA: ${p.candidates.map((c) => `\`${c}\``).join(", ")}`
  : `- \`${p.id}\` (${p.lang}/${p.setId}, nº ${p.number}, ${p.name}) — suspeita: mesmo número de ${p.suspeita.map((c) => `\`${c}\``).join(", ")}, outro nome`;
const itens = [
  ...applied.map((a) => ({ chave: a.from, linha: linhaApplied(a) })),
  ...pending.map((p) => ({ chave: p.id, linha: linhaPending(p) }))
];

const RODAPE = "\n\nO que fazer: conferir cada par. Migrado errado → trocar o destino em `data/card-id-merges.json` (`cards`). Pendente → gravar lá o par certo (`\"<id provisório>\": \"<id oficial>\"`); o próximo build tira a provisória e migra a conta de quem marcou. Origem de cada aposta no campo `prov` da carta (tcgcsv, ppt, en). Ver `scripts/lib/provisional-ids.mjs`.";

function aviso(texto) {
  // Anotação do Actions: aparece no resumo do run mesmo sem a issue.
  console.log(`::warning title=${TITULO}::${texto.replace(/\n/g, "%0A")}`);
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (DRY || !token || !repo) {
  const corpo = itens.map((i) => i.linha).join("\n");
  if (DRY) console.log(corpo + RODAPE); else aviso(corpo);
  process.exit(0);
}

const api = async (caminho, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${repo}${caminho}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${caminho}: HTTP ${r.status}`);
  return r.json();
};

try {
  const abertas = await api(`/issues?state=open&per_page=100`);
  const issue = abertas.find((i) => !i.pull_request && i.title === TITULO);
  if (!issue) {
    const criada = await api(`/issues`, { method: "POST", body: JSON.stringify({
      title: TITULO,
      body: `O build achou ids que nós criamos (antes da TCGdex publicar) cuja carta oficial chegou com OUTRO id.\n\n${itens.map((i) => i.linha).join("\n")}${RODAPE}`
    }) });
    console.log(`report-provisional-ids: issue aberta — ${criada.html_url}`);
  } else {
    // Já citado no corpo ou num comentário: não repete.
    const comentarios = await api(`/issues/${issue.number}/comments?per_page=100`);
    const jaDito = [issue.body || "", ...comentarios.map((c) => c.body || "")].join("\n");
    const novos = itens.filter((i) => !jaDito.includes(`\`${i.chave}\``));
    if (!novos.length) { console.log(`report-provisional-ids: tudo já está na issue #${issue.number}`); process.exit(0); }
    await api(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({
      body: `Novos achados neste build:\n\n${novos.map((i) => i.linha).join("\n")}`
    }) });
    console.log(`report-provisional-ids: ${novos.length} achado(s) novo(s) comentado(s) na issue #${issue.number}`);
  }
} catch (e) {
  // Aviso nunca derruba o deploy: o de-para já foi gravado pelo merge.
  console.warn(`report-provisional-ids: falha falando com o GitHub (${e.message}) — fica o aviso no log`);
  aviso(itens.map((i) => i.linha).join("\n"));
}
