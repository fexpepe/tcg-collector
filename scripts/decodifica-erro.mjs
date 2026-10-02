// Traduz a "fonte" de um erro de JS do /admin (Técnico › Qualidade) pro código
// de verdade. Em produção o src/*.js é minificado e ganha hash no nome, então o
// painel mostra "shared.a9fc7e26.js:93:2765", que não diz nada a ninguém. O
// deploy publica o .map ao lado de cada arquivo (esbuild --sourcemap, no
// deploy.yml); este script lê esse .map e devolve arquivo:linha do repositório
// e a própria linha. Foi assim que o "Failed to fetch" da varredura de
// 2026-10-02 virou o fetch sem .catch() do mandaEvento (src/shared.js).
//
// Uso (à mão, sem dependência — Node 22):
//   node scripts/decodifica-erro.mjs "at No (https://sleevu.app/src/shared.a9fc7e26.js:93:2765)"
//   node scripts/decodifica-erro.mjs https://sleevu.app/src/shared.a9fc7e26.js:93:2765 [mais…]
//   node scripts/decodifica-erro.mjs --origem https://<id>.tcg-collector.pages.dev "…"
//
// Aceita a fonte como o painel guarda: o formato do Chrome ("at fn (url:l:c)"),
// o do Safari e do Firefox ("fn@url:l:c") ou só "url:l:c".
//
// LEVA QUE JÁ SAIU DO AR: o Pages só serve o deploy atual, então o .map de um
// hash antigo dá 404 (a CDN ainda guarda um ou outro por acaso). Todo deploy
// tem um endereço próprio e permanente (Cloudflare › Pages › tcg-collector ›
// Deployments, o do dia do erro), e o --origem troca o domínio por ele.
//
// Atrás de proxy (máquina de CI, sandbox), o fetch do Node só usa o
// HTTPS_PROXY com NODE_USE_ENV_PROXY=1.
import { pathToFileURL } from "node:url";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Um segmento das `mappings` (Base64 VLQ): números com sinal, 5 bits por
// caractere, o 6º bit diz "continua no próximo".
export function decodificaVlq(texto) {
  const out = [];
  let valor = 0, desloca = 0;
  for (const ch of texto) {
    const d = B64.indexOf(ch);
    if (d < 0) throw new Error(`caractere fora do Base64 VLQ: ${ch}`);
    valor += (d & 31) << desloca;
    if (d & 32) { desloca += 5; continue; }
    out.push(valor & 1 ? -(valor >> 1) : valor >> 1);
    valor = 0; desloca = 0;
  }
  return out;
}

// `mappings` → por linha gerada, a lista de [coluna gerada, fonte, linha,
// coluna, nome] em valores ABSOLUTOS, base 0. Coluna gerada recomeça a cada
// linha; fonte, linha, coluna e nome acumulam pelo arquivo inteiro.
export function linhasDoMapa(mappings) {
  let fonte = 0, linha = 0, coluna = 0, nome = 0;
  return String(mappings || "").split(";").map((trecho) => {
    let gerada = 0;
    const segs = [];
    for (const s of trecho ? trecho.split(",") : []) {
      const v = decodificaVlq(s);
      gerada += v[0];
      if (v.length < 4) continue; // segmento sem fonte (código gerado do nada)
      fonte += v[1]; linha += v[2]; coluna += v[3];
      if (v.length >= 5) nome += v[4];
      segs.push([gerada, fonte, linha, coluna, v.length >= 5 ? nome : -1]);
    }
    return segs;
  });
}

// Linha e coluna como o navegador conta (base 1) → o ponto do código-fonte.
// Vale o último segmento que começa ANTES da coluna pedida.
export function localiza(mapa, linhas, linha, coluna) {
  const segs = linhas[linha - 1] || [];
  let achado = null;
  for (const s of segs) {
    if (s[0] > coluna - 1) break;
    achado = s;
  }
  if (!achado) return null;
  const [, f, l, c, n] = achado;
  const conteudo = mapa.sourcesContent && mapa.sourcesContent[f];
  return {
    arquivo: mapa.sources[f],
    linha: l + 1,
    coluna: c + 1,
    nome: n >= 0 && mapa.names ? mapa.names[n] : "",
    texto: conteudo ? String(conteudo.split(/\r?\n/)[l] || "").trim() : ""
  };
}

// Tira url, linha e coluna de qualquer formato de pilha que o painel guarda.
export function extraiPosicoes(texto) {
  const out = [];
  const re = /(https?:\/\/[^\s()@]+?\.js)(?:\?[^\s():]*)?:(\d+):(\d+)/g;
  let m;
  while ((m = re.exec(String(texto || "")))) out.push({ url: m[1], linha: Number(m[2]), coluna: Number(m[3]) });
  return out;
}

async function principal(args) {
  let origem = "";
  const fontes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--origem") origem = String(args[++i] || "").replace(/\/+$/, "");
    else fontes.push(args[i]);
  }
  const posicoes = fontes.flatMap(extraiPosicoes);
  if (!posicoes.length) {
    console.error("Uso: node scripts/decodifica-erro.mjs [--origem https://<id>.tcg-collector.pages.dev] \"<fonte do erro>\" …");
    process.exit(2);
  }
  const mapas = new Map();
  let falhou = false;
  for (const p of posicoes) {
    const url = origem ? origem + new URL(p.url).pathname : p.url;
    if (!mapas.has(url)) {
      mapas.set(url, fetch(`${url}.map`).then(async (r) => {
        if (!r.ok) throw new Error(`${url}.map respondeu ${r.status} — essa leva saiu do ar? Tente --origem com o endereço do deploy daquele dia (Cloudflare › Pages › Deployments).`);
        const mapa = await r.json();
        return { mapa, linhas: linhasDoMapa(mapa.mappings) };
      }));
    }
    const rotulo = `${p.url}:${p.linha}:${p.coluna}`;
    try {
      const { mapa, linhas } = await mapas.get(url);
      const ponto = localiza(mapa, linhas, p.linha, p.coluna);
      if (!ponto) { console.log(`${rotulo}\n  → sem mapeamento nessa posição`); continue; }
      // `sources` é relativo ao próprio .map (o do shared diz "shared.js", o
      // do sw, "sw.js"): resolvido contra a URL dele, vira o caminho no repo.
      const onde = new URL((mapa.sourceRoot || "") + ponto.arquivo, `${url}.map`).pathname.replace(/^\/+/, "");
      console.log(`${rotulo}\n  → ${onde}:${ponto.linha}:${ponto.coluna}${ponto.nome ? ` (${ponto.nome})` : ""}\n    ${ponto.texto.slice(0, 160)}`);
    } catch (e) {
      falhou = true;
      console.log(`${rotulo}\n  → ${e.message}`);
    }
  }
  if (falhou) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal(process.argv.slice(2));
}
