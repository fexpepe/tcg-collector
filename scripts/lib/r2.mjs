// Cliente mínimo da API S3 do R2 — PUT/GET/HEAD/DELETE de UM objeto — com a
// assinatura SigV4 escrita à mão: o repo não tem package.json e não vai ganhar
// um por causa de ~30 linhas. Sem listagem de propósito: um token de escopo
// "Object Read & Write" não lista buckets (armadilha registrada em
// verifica-setup.mjs), e o espelho não precisa listar — ele guarda o próprio
// índice como objeto do bucket.
import { createHash, createHmac } from "node:crypto";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
// Caminho canônico como a AWS exige: cada segmento codificado (unreserved =
// A-Z a-z 0-9 - _ . ~), barras preservadas. A MESMA string vai na URL e na
// requisição canônica — divergência entre as duas é assinatura recusada.
const codificaCaminho = (caminho) => caminho.split("/")
  .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
  .join("/");

export function assinaS3({ id, segredo }, metodo, host, caminho, corpo) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dia = amzDate.slice(0, 8);
  const hashCorpo = sha256(corpo || "");
  const cab = { host, "x-amz-content-sha256": hashCorpo, "x-amz-date": amzDate };
  const nomes = Object.keys(cab).sort();
  const canonico = [metodo, caminho, "", nomes.map((n) => `${n}:${cab[n]}\n`).join(""),
    nomes.join(";"), hashCorpo].join("\n");
  const escopo = `${dia}/auto/s3/aws4_request`;
  const paraAssinar = ["AWS4-HMAC-SHA256", amzDate, escopo, sha256(canonico)].join("\n");
  let k = hmac("AWS4" + segredo, dia);
  k = hmac(k, "auto"); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
  cab.Authorization = `AWS4-HMAC-SHA256 Credential=${id}/${escopo}, `
    + `SignedHeaders=${nomes.join(";")}, Signature=${createHmac("sha256", k).update(paraAssinar).digest("hex")}`;
  return cab;
}

// null quando falta credencial — quem chama decide se é erro ou "pula".
export function clienteR2(env = process.env) {
  const conta = env.CLOUDFLARE_ACCOUNT_ID || "";
  const cred = { id: env.R2_ACCESS_KEY_ID || "", segredo: env.R2_SECRET_ACCESS_KEY || "" };
  const bucket = env.R2_BUCKET || "sleevu-img";
  if (!conta || !cred.id || !cred.segredo) return null;
  const host = `${conta}.r2.cloudflarestorage.com`;
  // 5xx e rede: até 3 tentativas com pausa crescente. 4xx volta como veio.
  async function pede(metodo, chave, corpo, extras, tentativas = 3) {
    const caminho = `/${bucket}/${codificaCaminho(chave)}`;
    let ultimo;
    for (let t = 1; t <= tentativas; t++) {
      try {
        const r = await fetch(`https://${host}${caminho}`, {
          method: metodo, body: corpo || undefined,
          headers: { ...assinaS3(cred, metodo, host, caminho, corpo), ...extras },
          signal: AbortSignal.timeout(60000)
        });
        if (r.status < 500) return r;
        ultimo = new Error(`R2 ${metodo} ${chave}: HTTP ${r.status}`);
      } catch (e) { ultimo = e; }
      await new Promise((ok) => setTimeout(ok, 1000 * t));
    }
    throw ultimo;
  }
  return {
    bucket, host,
    // Cache-Control vira metadado do objeto e é o que o img.sleevu.app devolve:
    // imagem de carta é imutável por URL (um ano); índice e status, no-store.
    put: (chave, corpo, { contentType, cacheControl } = {}) => pede("PUT", chave, corpo, {
      "content-type": contentType || "application/octet-stream",
      "cache-control": cacheControl || "public, max-age=31536000, immutable"
    }),
    get: (chave) => pede("GET", chave, "", {}),
    head: (chave) => pede("HEAD", chave, "", {}),
    del: (chave) => pede("DELETE", chave, "", {})
  };
}
