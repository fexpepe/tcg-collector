// Verifica as dependências EXTERNAS que não moram no repo: o bucket R2 com o
// domínio img.sleevu.app, os segredos do GitHub e a whitelist de eventos do
// Supabase. Nenhuma delas dá pra conferir do ambiente de desenvolvimento (o
// proxy de saída barra sleevu.app e supabase.co) nem do código — só de uma
// máquina com rede aberta. Daí rodar no Actions, sob demanda:
//   Actions → "Verifica dependências externas" → Run workflow
//
// NÃO derruba o job por dependência AUSENTE: metade destes recursos ainda não
// está ligada no produto, e um vermelho diário por algo que ainda nem existe
// treina todo mundo a ignorar o vermelho. Ele RELATA, e só falha quando um
// recurso existe e responde ERRADO — que é o caso que a gente não descobriria
// sozinho.
//
// Uso: node scripts/verifica-setup.mjs
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const ANON_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública (RLS protege)
const IMG = "https://img.sleevu.app";
const ORIGEM = "https://sleevu.app";

const problemas = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const nota = (m) => console.log(`  · ${m}`);
const falta = (m) => console.log(`  ○ ${m}`);
const erro = (m) => { console.error(`  ✗ ${m}`); problemas.push(m); };

const pega = (u, init) => fetch(u, { redirect: "manual", signal: AbortSignal.timeout(25000), ...init });

// ── 1. Segredos do GitHub ────────────────────────────────────────────────────
// O workflow injeta cada um numa env; aqui só se olha SE veio e o tamanho.
// Valor nenhum é impresso: o log do Actions é público em repo público.
console.log("\n[segredos do GitHub]");
const SEGREDOS = [
  ["R2_TOKEN", "espelho de imagens no R2 (P1/P2)"],
  ["CLOUDFLARE_ACCOUNT_ID", "conta do Cloudflare (deploy e R2)"],
  ["MYP_API_TOKEN", "preços BR da MYP (F1)"]
];
for (const [nome, pra] of SEGREDOS) {
  const v = process.env[nome] || "";
  if (v) ok(`${nome} presente (${v.length} caracteres) — ${pra}`);
  else falta(`${nome} ausente — ${pra}`);
}

// ── 2. R2 + img.sleevu.app ───────────────────────────────────────────────────
console.log("\n[R2 / img.sleevu.app]");
try {
  const r = await pega(IMG + "/", { headers: { Origin: ORIGEM } });
  const srv = r.headers.get("server") || "";
  const cors = r.headers.get("access-control-allow-origin");
  // Bucket vazio responde 404: o que importa aqui é o domínio estar CONECTADO
  // ao bucket (quem responde é o R2), não ter conteúdo ainda.
  nota(`GET / → HTTP ${r.status} (server: ${srv || "?"})`);
  if (r.status >= 500) erro(`img.sleevu.app respondeu ${r.status} — domínio conectado mas o bucket não atende`);
  else ok("domínio no ar e respondendo");
  if (cors) ok(`CORS liberado pra ${cors}`);
  else nota("sem Access-Control-Allow-Origin nesta resposta — o R2 só aplica CORS em objeto existente, então isto só fecha depois do primeiro upload");
} catch (e) {
  falta(`img.sleevu.app não respondeu (${e.message}) — domínio ainda não conectado, ou DNS propagando`);
}

// Token do R2: em vez de perguntar à API se ele existe, FAZ o que o espelho de
// imagens vai fazer — sobe um objeto, lê pelo domínio público e apaga. É o
// único teste que prova a coisa toda de uma vez: token, escopo, bucket,
// domínio e CORS num objeto de verdade.
//
// A primeira versão deste check listava os buckets da conta
// (GET /accounts/{id}/r2/buckets) e reprovou um token que pode estar
// perfeitamente correto: um token com escopo "Object Read & Write" num bucket
// só NÃO tem permissão de listar os buckets da conta. O teste é que estava
// errado, não o token — e um verificador que acusa falso é pior que nenhum.
const R2_TOKEN = process.env.R2_TOKEN || "";
const CONTA = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const BUCKET = process.env.R2_BUCKET || "sleevu-img";
const CHAVE = "_verifica-setup.txt";

function wrangler(args) {
  return new Promise((resolve) => {
    const p = spawn("npx", ["--yes", "wrangler@3", ...args], {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: R2_TOKEN, CLOUDFLARE_ACCOUNT_ID: CONTA },
      timeout: 120000
    });
    let saida = "";
    p.stdout.on("data", (d) => { saida += d; });
    p.stderr.on("data", (d) => { saida += d; });
    p.on("close", (code) => resolve({ code, saida: saida.trim() }));
    p.on("error", (e) => resolve({ code: -1, saida: e.message }));
  });
}

if (R2_TOKEN && CONTA) {
  const arquivo = join(tmpdir(), CHAVE);
  const carimbo = `verifica-setup ${new Date().toISOString()}\n`;
  writeFileSync(arquivo, carimbo);
  const put = await wrangler(["r2", "object", "put", `${BUCKET}/${CHAVE}`, "--file", arquivo, "--remote", "--content-type", "text/plain"]);
  if (put.code !== 0) {
    erro(`o token não conseguiu ESCREVER em ${BUCKET} (wrangler saiu ${put.code}). `
      + `Confira o escopo (Object Read & Write) e o nome do bucket — este teste usou "${BUCKET}", `
      + `mude com o campo "bucket" ao disparar o workflow. Saída:\n      ${put.saida.split("\n").slice(-6).join("\n      ")}`);
  } else {
    ok(`escrita no bucket ${BUCKET} funcionou`);
    // Leitura pelo domínio público: é assim que o site vai buscar as imagens.
    try {
      const r = await pega(`${IMG}/${CHAVE}`, { headers: { Origin: ORIGEM } });
      const cors = r.headers.get("access-control-allow-origin");
      if (r.status !== 200) erro(`o objeto subiu mas img.sleevu.app devolveu HTTP ${r.status} — o domínio pode estar ligado a OUTRO bucket`);
      else {
        const corpo = await r.text();
        if (corpo !== carimbo) erro("img.sleevu.app respondeu 200 mas com conteúdo diferente do que foi enviado");
        else ok("leitura pública pelo img.sleevu.app confere byte a byte");
        if (cors === ORIGEM || cors === "*") ok(`CORS no objeto real: ${cors}`);
        else erro(`objeto real veio SEM CORS pra ${ORIGEM} (recebido: ${cors || "nenhum"}) — é isso que faz o "exportar imagem" sair sem foto`);
      }
    } catch (e) { erro(`img.sleevu.app inacessível depois do upload: ${e.message}`); }
    const del = await wrangler(["r2", "object", "delete", `${BUCKET}/${CHAVE}`, "--remote"]);
    if (del.code !== 0) nota(`o objeto de teste ${CHAVE} ficou no bucket (o delete saiu ${del.code}) — apague pelo painel`);
    else ok("objeto de teste apagado");
  }
} else {
  falta("sem R2_TOKEN + CLOUDFLARE_ACCOUNT_ID: não dá pra provar escrita nem leitura");
}

// ── 3. Supabase: whitelist de eventos ────────────────────────────────────────
// O events_guard descarta CALADO o nome que não conhece (return null), e o
// PostgREST devolve 201 dos dois jeitos. `Prefer: return=representation` é o
// que separa os casos: linha gravada volta no corpo, linha descartada volta [].
// Se o anon não puder ler a tabela, o próprio erro diz isso — e aí o resultado
// é INCONCLUSIVO, não "deu certo".
console.log("\n[Supabase — eventos de produto (E6)]");
async function tentaEvento(nome) {
  const r = await pega(`${SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY, "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ name: nome, path: "/_verifica-setup", anon: "verifica-setup", game: "pokemon" })
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* não é JSON */ }
  return { status: r.status, gravou: Array.isArray(j) ? j.length > 0 : null, corpo: txt.slice(0, 200) };
}
try {
  // Controle: um nome que NUNCA pode entrar. Se ele "gravar", a whitelist não
  // está filtrando nada e o resultado do teste de verdade não valeria nada.
  const controle = await tentaEvento("zzz_nome_invalido_de_teste");
  const novo = await tentaEvento("export_done");
  // Os DOIS crus, sempre: na primeira rodada só o controle aparecia, e quando o
  // teste deu inconclusivo não dava pra saber qual dos dois tinha se comportado
  // de forma estranha — diagnóstico que esconde metade da evidência não serve.
  nota(`controle 'zzz_nome_invalido_de_teste' → HTTP ${controle.status}: ${controle.corpo || "(corpo vazio)"}`);
  nota(`teste    'export_done'                → HTTP ${novo.status}: ${novo.corpo || "(corpo vazio)"}`);
  // As duas trancas reclamam de jeitos DIFERENTES, e é isso que as separa:
  //   trigger recusa → 201 com corpo [] (return null: a linha some calada)
  //   política recusa → 401 SQLSTATE 42501 (a linha atravessou o trigger)
  // Sem essa distinção, "não gravou" seria um diagnóstico só, apontando pro
  // arquivo errado.
  if (novo.status === 401 && novo.corpo.includes("42501")) {
    erro("o TRIGGER já aceita 'export_done' (a 20260830a está aplicada), mas a POLÍTICA de RLS "
      + "da tabela events tem whitelist de nome PRÓPRIA e barrou a linha. "
      + "Falta aplicar supabase/migrations/20260830b_events_produto_rls.sql — e se ela JÁ foi rodada, "
      + "ela pode ter se RECUSADO a alterar (ela não mexe em checagem que olhe outra coluna além do name); "
      + "o RAISE NOTICE dela diz qual foi o caso. Pra ver a expressão atual: "
      + "select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.events'::regclass;");
  } else if (controle.gravou === null || novo.gravou === null) {
    nota("inconclusivo: uma das respostas não veio como lista, então não dá pra ver se a linha entrou. "
      + "Confirme pelo painel: select prosrc from pg_proc where proname = 'events_guard';");
  } else if (controle.gravou) {
    erro("o events_guard aceitou um nome INVÁLIDO — a whitelist não está filtrando");
  } else if (novo.gravou) {
    ok("migração 20260830a aplicada: 'export_done' entra e o nome inválido é descartado");
  } else {
    erro("'export_done' sumiu calado (201 com corpo vazio) — é o TRIGGER recusando: "
      + "a migração 20260830a ainda não está aplicada "
      + "(SQL Editor → cole supabase/migrations/20260830a_events_produto.sql)");
  }
} catch (e) { erro(`Supabase inacessível: ${e.message}`); }

console.log("");
if (problemas.length) {
  console.error(`${problemas.length} problema(s):\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}
console.log("Nada errado. O que estiver marcado com ○ é dependência ainda não configurada, não defeito.");
