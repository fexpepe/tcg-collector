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
import { createHash, createHmac } from "node:crypto";

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
  ["R2_TOKEN", "wrangler/deploy (endpoint de conta do R2)"],
  ["R2_ACCESS_KEY_ID", "API S3 do R2 — é por aqui que o espelho de imagens sobe"],
  ["R2_SECRET_ACCESS_KEY", "API S3 do R2 (o par do anterior)"],
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

// ── Caminho S3 (SigV4) ───────────────────────────────────────────────────────
// É por aqui que o espelho de imagens vai subir os arquivos: são milhares, e é
// exatamente pra isso que o escopo "Object Read & Write" do token existe. O
// wrangler bate no endpoint DE CONTA (/accounts/{id}/r2/buckets/...), que pede
// permissão de conta — um token de escopo Object pode ser recusado lá estando
// perfeito, que é a mesma armadilha do "listar buckets".
//
// Assinatura à mão, sem SDK: o repo não tem package.json e não vai ganhar um
// por causa de um teste. São ~20 linhas.
const ID_S3 = process.env.R2_ACCESS_KEY_ID || "";
const SEGREDO_S3 = process.env.R2_SECRET_ACCESS_KEY || "";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

function assinaS3(metodo, host, caminho, corpo) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dia = amzDate.slice(0, 8);
  const hashCorpo = sha256(corpo || "");
  const cab = { host, "x-amz-content-sha256": hashCorpo, "x-amz-date": amzDate };
  const nomes = Object.keys(cab).sort();
  const canonico = [metodo, caminho, "", nomes.map((n) => `${n}:${cab[n]}\n`).join(""),
    nomes.join(";"), hashCorpo].join("\n");
  const escopo = `${dia}/auto/s3/aws4_request`;
  const paraAssinar = ["AWS4-HMAC-SHA256", amzDate, escopo, sha256(canonico)].join("\n");
  let k = hmac("AWS4" + SEGREDO_S3, dia);
  k = hmac(k, "auto"); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
  cab.Authorization = `AWS4-HMAC-SHA256 Credential=${ID_S3}/${escopo}, `
    + `SignedHeaders=${nomes.join(";")}, Signature=${createHmac("sha256", k).update(paraAssinar).digest("hex")}`;
  return cab;
}

if (ID_S3 && SEGREDO_S3 && CONTA) {
  const host = `${CONTA}.r2.cloudflarestorage.com`;
  const caminho = `/${BUCKET}/${CHAVE}`;
  const carimbo = `verifica-setup ${new Date().toISOString()}\n`;
  try {
    const r = await pega(`https://${host}${caminho}`, {
      method: "PUT", body: carimbo,
      headers: { ...assinaS3("PUT", host, caminho, carimbo), "content-type": "text/plain" }
    });
    if (!r.ok) {
      const txt = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
      erro(`a API S3 recusou a escrita em ${BUCKET} (HTTP ${r.status}): ${txt}`);
    } else {
      ok(`escrita pela API S3 no bucket ${BUCKET} funcionou`);
      // Leitura pelo domínio público, que é como o site vai buscar as imagens.
      const g = await pega(`${IMG}/${CHAVE}`, { headers: { Origin: ORIGEM } });
      const cors = g.headers.get("access-control-allow-origin");
      if (g.status !== 200) erro(`o objeto subiu mas img.sleevu.app devolveu HTTP ${g.status} — o domínio pode estar ligado a OUTRO bucket`);
      else if ((await g.text()) !== carimbo) erro("img.sleevu.app respondeu 200 com conteúdo diferente do enviado");
      else ok("leitura pública pelo img.sleevu.app confere byte a byte");
      if (cors === ORIGEM || cors === "*") ok(`CORS no objeto real: ${cors}`);
      else erro(`objeto real veio SEM CORS pra ${ORIGEM} (recebido: ${cors || "nenhum"}) — é isso que faz o "exportar imagem" sair sem foto`);
      const d = await pega(`https://${host}${caminho}`, { method: "DELETE", headers: assinaS3("DELETE", host, caminho, "") });
      if (d.ok || d.status === 204) ok("objeto de teste apagado");
      else nota(`o objeto de teste ${CHAVE} ficou no bucket (DELETE devolveu ${d.status}) — apague pelo painel`);
    }
  } catch (e) { erro(`API S3 inacessível: ${e.message}`); }
} else {
  falta("sem R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY: o caminho S3 (o que o espelho vai usar) não foi testado");
}

// O R2_TOKEN (o "Token value") segue guardado porque é o que o deploy usa no
// wrangler pra publicar o site. Mas ele NÃO é o caminho do espelho de imagens, e
// aqui só se confere se ele é um token válido — provado em 2026-08-31 que o
// endpoint de CONTA do wrangler (/accounts/{id}/r2/buckets/.../objects/...)
// recusa um token de escopo Object com 403, mesmo estando perfeito. Chegou-se a
// testar a escrita por ele; era um teste que só sabia acusar falso, e saiu.
if (R2_TOKEN) {
  try {
    const r = await pega("https://api.cloudflare.com/client/v4/user/tokens/verify",
      { headers: { Authorization: `Bearer ${R2_TOKEN}` } });
    const j = await r.json().catch(() => null);
    if (j && j.success) ok(`R2_TOKEN é um token de API da Cloudflare válido, e está ${j.result && j.result.status ? j.result.status : "ativo"}`);
    else erro("o segredo guardado em R2_TOKEN não é um token de API da Cloudflare "
      + `(verify devolveu HTTP ${r.status}${j && j.errors ? ` — ${j.errors.map((e) => e.message).join("; ")}` : ""}). `
      + "Na tela do token do R2 são três campos diferentes: o \"Token value\" vai aqui; "
      + "o Access Key ID e o Secret Access Key vão nos outros dois segredos.");
  } catch (e) { nota(`não deu pra validar o R2_TOKEN: ${e.message}`); }
}

// ── 3. Supabase: whitelist de eventos ────────────────────────────────────────
// A tabela `events` aceita INSERT anônimo e NÃO tem política de SELECT — é o
// desenho: nem o dono lê evento cru, só os agregados das RPCs. Isso torna a
// verificação capciosa, e a primeira versão deste teste leu o sinal AO
// CONTRÁRIO.
//
// `Prefer: return=representation` vira um INSERT ... RETURNING, e o PostgreSQL
// aplica as políticas de SELECT à linha retornada. Sem política de SELECT, a
// linha entra e o RETURNING não consegue lê-la de volta — e o erro que sai é
// justamente "new row violates row-level security policy", que parece recusa e
// é o oposto: prova de que a linha FOI gravada.
//
// Daí três probes, e não dois. O `pageview` é o que desempata: ele SEMPRE foi
// aceito, desde antes de qualquer migração. Se ele também der 42501, então
// 42501 significa "gravou", e não "recusou".
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
  const rls = r.status === 401 && txt.includes("42501");
  let j = null; try { j = JSON.parse(txt); } catch { /* não é JSON */ }
  return {
    status: r.status,
    // "gravou" = a linha existe: ou veio no corpo, ou o RETURNING foi barrado
    // pela falta de política de SELECT (que só acontece se houve linha).
    gravou: rls || (Array.isArray(j) && j.length > 0),
    vazio: Array.isArray(j) && j.length === 0,
    corpo: txt.slice(0, 120)
  };
}
try {
  const invalido = await tentaEvento("zzz_nome_invalido_de_teste");
  const antigo = await tentaEvento("pageview");
  const novoNome = await tentaEvento("export_done");
  nota(`'zzz_nome_invalido' → HTTP ${invalido.status}: ${invalido.corpo || "(vazio)"}`);
  nota(`'pageview' (controle positivo) → HTTP ${antigo.status}: ${antigo.corpo || "(vazio)"}`);
  nota(`'export_done' → HTTP ${novoNome.status}: ${novoNome.corpo || "(vazio)"}`);

  if (!antigo.gravou) {
    // Sem um controle positivo confiável nenhuma conclusão vale: se o nome que
    // SEMPRE funcionou não grava, o problema não é a whitelist.
    erro("o controle positivo falhou: nem 'pageview' gravou. Antes de concluir qualquer coisa sobre "
      + "os nomes novos, é isso que precisa ser entendido — a tabela events pode estar recusando tudo.");
  } else if (invalido.gravou) {
    erro("o events_guard aceitou um nome INVÁLIDO — a whitelist não está filtrando nada");
  } else if (novoNome.gravou) {
    ok("'export_done' grava e o nome inválido é descartado — a whitelist de eventos de produto está valendo");
  } else {
    erro("'export_done' foi descartado pelo trigger enquanto 'pageview' passou: "
      + "a migração 20260830a não está aplicada "
      + "(SQL Editor → cole supabase/migrations/20260830a_events_produto.sql)");
  }
} catch (e) { erro(`Supabase inacessível: ${e.message}`); }

console.log("");
if (problemas.length) {
  console.error(`${problemas.length} problema(s):\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}
console.log("Nada errado. O que estiver marcado com ○ é dependência ainda não configurada, não defeito.");
