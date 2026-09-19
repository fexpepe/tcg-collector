// A página /comparar (Sleevu × Collectr) só vale pela HONESTIDADE dela: quem
// chega ali já usa o concorrente e está checando se a gente mente. O problema
// é que ela afirma fatos sobre o PRÓPRIO produto — e o produto anda, a página
// não. Em 19/09/2026 ela ainda dizia, nos três idiomas, que "o Sleevu não tem
// scanner de câmera" (o scanner entrou em 09/09) e que "dá pra usar sem criar
// conta" (o enforceLoginGate fechou as páginas pessoais em 14/07). Ou seja: a
// landing de MAIOR intenção do site mandava o visitante embora citando duas
// fraquezas que já não existiam.
//
// O que está travado aqui é a CLASSE do bug, não a redação: se o código tem a
// funcionalidade, a página não pode negá-la. São asserções NEGATIVAS de
// propósito — a copy pode ser reescrita à vontade, só não pode voltar a dizer
// a frase que o código desmente.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, "utf8");

// Mesma técnica do scripts/check.mjs: o i18n-docs.js mescla em TCG_MESSAGES.
const MESSAGES = (() => {
  const window = {};
  for (const f of ["src/i18n.js", "src/i18n-docs.js"]) new Function("window", read(f))(window);
  return window.TCG_MESSAGES || {};
})();

const IDIOMAS = ["pt", "en", "es"];
const chave = (lang, k) => {
  const v = (MESSAGES[lang] || {})[k];
  assert.ok(v, `${lang}: chave ${k} não existe`);
  return v;
};

// Extrai as linhas da tabela "Lado a lado" como [rótulo, célula Sleevu, célula Collectr].
function linhasDaTabela(lang) {
  const html = chave(lang, "vs.s.table");
  return [...html.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)]
    .map((m) => ({ rotulo: m[1], sleevu: m[2], collectr: m[3] }));
}

const acha = (lang, termo) => {
  const linha = linhasDaTabela(lang).find((l) => termo.test(l.rotulo));
  assert.ok(linha, `${lang}: não achei a linha ${termo} na tabela`);
  return linha;
};

test("a tabela é parseável e tem as mesmas linhas nos três idiomas", () => {
  const contagens = IDIOMAS.map((l) => linhasDaTabela(l).length);
  assert.ok(contagens[0] >= 10, `a tabela pt tem só ${contagens[0]} linhas — o regex quebrou?`);
  assert.deepEqual(contagens, [contagens[0], contagens[0], contagens[0]],
    `número de linhas diferente entre idiomas: ${contagens.join(" / ")}`);
});

// ── Scanner ────────────────────────────────────────────────────────────────
// Guarda amarrada no CÓDIGO: enquanto src/scan.js existir, a página não pode
// dizer que o scanner não existe.
test("scanner: a página não nega o que o src/scan.js entrega", () => {
  assert.ok(existsSync(`${ROOT}src/scan.js`),
    "src/scan.js sumiu — se o scanner foi removido, esta guarda e a copy da /comparar têm de mudar JUNTAS");

  const NEGA = {
    pt: /n(ã|a)o tem/i,
    en: /does not have (one|it)|doesn't have (one|it)/i,
    es: /no tiene/i
  };
  for (const lang of IDIOMAS) {
    const linha = acha(lang, /scanner|escáner/i);
    assert.doesNotMatch(linha.sleevu, NEGA[lang],
      `${lang}: a linha do scanner ainda nega o scanner — "${linha.sleevu.slice(0, 90)}…"`);
  }

  // A seção "Onde o Collectr é melhor" pode (e deve) dizer que o scanner DELES
  // é melhor; não pode dizer que o nosso não existe.
  const NEGA_SECAO = {
    pt: /o Sleevu não tem isso|o Sleevu não tem scanner/i,
    en: /Sleevu does not have it|Sleevu has no scanner/i,
    es: /Sleevu no lo tiene|Sleevu no tiene escáner/i
  };
  for (const lang of IDIOMAS) {
    assert.doesNotMatch(chave(lang, "vs.s.them"), NEGA_SECAO[lang],
      `${lang}: "Onde o Collectr é melhor" ainda diz que o Sleevu não tem scanner`);
  }
});

// ── Conta ──────────────────────────────────────────────────────────────────
// Guarda amarrada no CÓDIGO: enquanto o enforceLoginGate fechar as páginas
// pessoais, a página não pode prometer uso sem conta.
test("conta: a página não promete o que o enforceLoginGate proíbe", () => {
  const shared = read("src/shared.js");
  assert.match(shared, /function enforceLoginGate\(\)/,
    "enforceLoginGate sumiu — se o portão de login caiu, a copy da /comparar volta a poder dizer 'sem conta'");
  assert.match(shared, /AUTH_PAGES = \[[^\]]*"collection"/,
    "o AUTH_PAGES não fecha mais a Coleção — reveja esta guarda junto da copy");

  const PROMETE = {
    pt: /sem criar nenhuma|não precisa de conta/i,
    en: /without creating one|no account needed/i,
    es: /sin crear ninguna|no hace falta cuenta/i
  };
  for (const lang of IDIOMAS) {
    const linha = acha(lang, /^Conta$|^Account$|^Cuenta$/i);
    assert.doesNotMatch(linha.sleevu, PROMETE[lang],
      `${lang}: a linha da conta ainda promete uso sem conta — "${linha.sleevu.slice(0, 90)}…"`);
  }

  // O mesmo na seção "Onde o Sleevu é melhor", onde a promessa também morava.
  const PROMETE_SECAO = {
    pt: /sem conta pra experimentar/i,
    en: /no account to try it/i,
    es: /sin cuenta para probar/i
  };
  for (const lang of IDIOMAS) {
    assert.doesNotMatch(chave(lang, "vs.s.us"), PROMETE_SECAO[lang],
      `${lang}: "Onde o Sleevu é melhor" ainda promete experimentar sem conta`);
  }
});

// ── Contagem de jogos ──────────────────────────────────────────────────────
// O catálogo cresce sozinho (jogo novo entra por sync); o número escrito na
// tabela, não. Amarra um no outro.
test("jogos: o número na tabela bate com o catálogo de verdade", () => {
  const baseline = JSON.parse(read("data/catalog-baseline.json"));
  const comCatalogo = Object.values(baseline).filter((g) => g && g.cards > 0).length;

  for (const lang of IDIOMAS) {
    const linha = acha(lang, /^Jogos$|^Games$|^Juegos$/i);
    const n = Number((linha.sleevu.match(/\d+/) || [])[0]);
    assert.equal(n, comCatalogo,
      `${lang}: a tabela diz ${n} jogos e o catalog-baseline.json tem ${comCatalogo} com carta`);
  }
});

// ── Carimbo de data ────────────────────────────────────────────────────────
// A página promete ao leitor QUANDO foi conferida. Sem isso ela vira a própria
// desatualização que este arquivo existe pra evitar.
test("o carimbo de quando a comparação foi conferida continua lá", () => {
  for (const lang of IDIOMAS) {
    const intro = chave(lang, "vs.s.intro");
    assert.match(intro, /vs-stamp/, `${lang}: o carimbo (.vs-stamp) sumiu da intro`);
    assert.match(intro, /202\d/, `${lang}: o carimbo não tem ano`);
  }
});
