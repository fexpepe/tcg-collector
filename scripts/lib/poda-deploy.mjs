// A parte PURA da poda do deploy (scripts/poda-deploy.mjs): o que sai da
// árvore que sobe pro Cloudflare Pages porque nada no site pede. Quem anda no
// disco e apaga é o script; os testes (tests/poda-deploy.test.mjs) usam estas
// mesmas funções.
//
// Por que existe (2026-11-14): o Pages recusa deploy com mais de 20.000
// arquivos e a guarda do deploy.yml falha antes (19.000). A main chegou a
// 18.903 com o Shadowverse, e uns 750 desses arquivos subiam sem ninguém
// pedir: os crus do modo dev de cada jogo e os símbolos de set do Magic que
// não são de set nenhum do catálogo.

// ── 1. Arquivos crus do modo dev ────────────────────────────────────────────
// Cada jogo grava dois jogos de arquivo: o CRU (cards.js, indexes.js,
// pricing.js, indexes-<chave>.json), que é o que o modo dev local lê, e o
// GERADO (manifest.generated.js e cia.), que é o que o deploy liga. Em
// produção o game.js nasce com MANIFEST = true (sed do deploy.yml) e o app
// também (transformaGameJs, scripts/lib/app-web.mjs, desde a 1ª versão em
// 2026-10-09): os dois só pedem o lado gerado — ver o FILE e o fileFor do
// src/game.js e o loadGameCatalog do src/shared.js. O cru subia por inércia:
// 8 arquivos por jogo, uns 340 no total.
//
// A regra só vale pra pasta que TEM o manifest.generated.js (pasta de jogo em
// modo manifest), e só tira o cru cujo par gerado está ali do lado.
export const PARES_CRUS = [
  ["cards.js", "manifest.generated.js"],
  ["indexes.js", "indexes.generated.js"],
  ["pricing.js", "pricing.generated.js"]
];
const FATIA_CRUA = /^indexes-([a-z0-9-]+)\.json$/;

export function crusDoModoDev(nomes) {
  const tem = new Set(nomes);
  if (!tem.has("manifest.generated.js")) return [];
  const sai = [];
  for (const [cru, gerado] of PARES_CRUS) if (tem.has(cru) && tem.has(gerado)) sai.push(cru);
  for (const nome of nomes) {
    const m = FATIA_CRUA.exec(nome);
    if (m && tem.has(`indexes-${m[1]}.generated.json`)) sai.push(nome);
  }
  return sai.sort();
}

// ── 2. Logos de set que nenhum texto do site cita ───────────────────────────
// Os mirror-*-set-logos.mjs baixam o símbolo de TODO set que a fonte lista,
// não só dos sets que entram no catálogo: o do Magic pega os 1.068 do /sets do
// Scryfall (tokens, art series, promos de loja) e o catálogo usa 654. Nenhuma
// tela monta caminho de logo: ele chega pronto no setLogo do chunk e do
// manifest (o mirror reescreve os chunks), nos mapas de /games e nas páginas
// pré-renderizadas. Então logo que nenhum arquivo de texto da árvore cita não
// tem quem peça.
//
// As referências saem de uma varredura de texto, não de um parser: acha cada
// "set-logos/" e lê o caminho em volta. Caminho com "data/" antes vira
// referência CHEIA ("data/magic/set-logos/10e.svg", também de dentro de uma
// URL absoluta); sem "data/" (relativo à pasta do jogo, por exemplo) vira
// referência SOLTA, que segura o mesmo nome em qualquer pasta de logo. Na
// dúvida, fica.
const MARCA = "set-logos/";
const CHAR_DO_CAMINHO = /[A-Za-z0-9._~%\/-]/;
// Nome que precisaria de escape numa URL não é comparado: fica sempre.
const NOME_SEGURO = /^[A-Za-z0-9._-]+$/;

export function novasReferencias() {
  return { cheias: new Set(), soltas: new Set() };
}

const decodifica = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function juntaReferencias(texto, refs = novasReferencias()) {
  let i = texto.indexOf(MARCA);
  while (i >= 0) {
    let ini = i;
    while (ini > 0 && CHAR_DO_CAMINHO.test(texto[ini - 1])) ini--;
    let fim = i + MARCA.length;
    while (fim < texto.length && CHAR_DO_CAMINHO.test(texto[fim])) fim++;
    const resto = decodifica(texto.slice(i + MARCA.length, fim)).replace(/\.+$/, "");
    if (resto) {
      const antes = texto.slice(ini, i);
      const d = antes.lastIndexOf("data/");
      if (d >= 0) refs.cheias.add(`${antes.slice(d)}${MARCA}${resto}`);
      else refs.soltas.add(resto);
    }
    i = texto.indexOf(MARCA, fim);
  }
  return refs;
}

// `logos`: caminhos relativos à raiz, com "/" ("data/magic/set-logos/10e.svg").
// Devolve o que sai e, por pasta, quantos saem de quantos. Pasta que perderia
// TODOS os logos não perde nenhum: é mais provável o catálogo ter mudado o
// formato do caminho do que o jogo inteiro ter ficado sem set.
export function logosSemUso(logos, refs) {
  const porPasta = new Map(); // pasta -> { total, sai: [] }
  const vazio = !refs.cheias.size && !refs.soltas.size;
  for (const caminho of logos) {
    const k = caminho.lastIndexOf(MARCA);
    if (k < 0) continue;
    const resto = caminho.slice(k + MARCA.length);
    const pasta = caminho.slice(0, caminho.lastIndexOf("/") + 1);
    if (!porPasta.has(pasta)) porPasta.set(pasta, { total: 0, sai: [] });
    const p = porPasta.get(pasta);
    p.total++;
    if (vazio) continue;
    if (!resto.split("/").every((parte) => NOME_SEGURO.test(parte))) continue;
    if (refs.cheias.has(caminho) || refs.soltas.has(resto)) continue;
    p.sai.push(caminho);
  }
  const sai = [];
  const resumo = [];
  for (const [pasta, p] of porPasta) {
    if (!p.sai.length) continue;
    if (p.sai.length === p.total) { resumo.push({ pasta, sai: 0, total: p.total, segurou: true }); continue; }
    sai.push(...p.sai);
    resumo.push({ pasta, sai: p.sai.length, total: p.total, segurou: false });
  }
  return { sai: sai.sort(), resumo: resumo.sort((a, b) => a.pasta.localeCompare(b.pasta)) };
}
