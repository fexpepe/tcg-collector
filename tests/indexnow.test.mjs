// IndexNow (scripts/lib/indexnow.mjs + scripts/indexnow.mjs + deploy.yml,
// 2026-09-30). O que se trava aqui:
//   - a chave publicada na raiz bate com a constante (senão o buscador recusa
//     todo aviso com 403, calado, e ninguém nota);
//   - o aviso leva só o que entrou e saiu do sitemap, e só do nosso host;
//   - lotes respeitam o teto de 10.000 URLs do protocolo;
//   - no deploy.yml, a parte 1 roda antes de o scripts/ ser apagado e antes
//     do deploy, e a parte 2 depois do deploy, as duas só na main.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HOST, CHAVE, LOTE_MAX, payload, urlsAlteradas, emLotes } from "../scripts/lib/indexnow.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const O = `https://${HOST}`;

test("a chave publicada na raiz é a da constante, e só ela", () => {
  assert.match(CHAVE, /^[0-9a-f]{32}$/);
  const arquivos = readdirSync(raiz).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.deepEqual(arquivos, [`${CHAVE}.txt`], "chave velha esquecida na raiz, ou a nova sem arquivo");
  assert.equal(readFileSync(join(raiz, `${CHAVE}.txt`), "utf8").trim(), CHAVE);
});

test("payload no formato do protocolo", () => {
  assert.deepEqual(payload([`${O}/set/x`]), {
    host: "sleevu.app",
    key: CHAVE,
    keyLocation: `https://sleevu.app/${CHAVE}.txt`,
    urlList: [`${O}/set/x`]
  });
});

test("só o que entrou e o que saiu, ordenado, e só do nosso host", () => {
  const antes = [`${O}/`, `${O}/set/b`, `${O}/deck/velho`];
  const depois = [`${O}/`, `${O}/set/b`, `${O}/set/a`, `${O}/card/c`, "https://outro.site/x", "não é url"];
  assert.deepEqual(urlsAlteradas(antes, depois), {
    novas: [`${O}/card/c`, `${O}/set/a`],
    removidas: [`${O}/deck/velho`]
  });
  // Sitemap igual (o push de CSS de sempre): nada a avisar.
  assert.deepEqual(urlsAlteradas(depois, depois), { novas: [], removidas: [] });
  // Primeira vez: antes vazio = o sitemap inteiro (do nosso host).
  assert.equal(urlsAlteradas([], depois).novas.length, 4);
});

test("lotes de no máximo 10.000 URLs", () => {
  assert.equal(LOTE_MAX, 10000);
  const urls = Array.from({ length: 23456 }, (_, i) => `${O}/card/${i}`);
  const lotes = emLotes(urls);
  assert.deepEqual(lotes.map((l) => l.length), [10000, 10000, 3456]);
  assert.deepEqual(lotes.flat(), urls);
  assert.deepEqual(emLotes([]), []);
});

test("deploy.yml: separa antes de apagar scripts/ e do deploy; envia depois; só na main", () => {
  const yml = readFileSync(join(raiz, ".github", "workflows", "deploy.yml"), "utf8");
  const passo = (nome) => {
    const i = yml.indexOf(`- name: ${nome}`);
    assert.ok(i >= 0, `passo "${nome}" sumiu do deploy.yml`);
    return i;
  };
  const prerender = passo("Pré-renderiza páginas de set (SEO)");
  const separa = passo("IndexNow — separa as URLs novas (só produção)");
  const remove = passo("Remove arquivos que não vão para o site");
  const deploy = passo("Deploy para Cloudflare Pages");
  const envia = passo("IndexNow — avisa os buscadores das URLs novas");
  assert.ok(prerender < separa && separa < remove && remove < deploy && deploy < envia, "ordem dos passos");
  // O passo vai até o próximo "- name:" (ou até o fim do arquivo).
  const bloco = (i) => {
    const fim = yml.indexOf("\n      - name:", i + 1);
    return yml.slice(i, fim < 0 ? undefined : fim);
  };
  for (const i of [separa, envia]) {
    assert.match(bloco(i), /if: github\.ref == 'refs\/heads\/main'/, "IndexNow fora da main anunciaria URL que não está no ar");
    assert.match(bloco(i), /continue-on-error: true/, "IndexNow não pode derrubar o deploy");
  }
  assert.match(bloco(separa), /node scripts\/indexnow\.mjs preparar "\$RUNNER_TEMP\/indexnow"/);
  assert.match(bloco(envia), /"\$RUNNER_TEMP"\/indexnow\/\*\.json/);
  assert.match(bloco(envia), /https:\/\/api\.indexnow\.org\/indexnow/);
  // Chave nova volta 403 até o IndexNow conferir o arquivo (a estreia de
  // 30/09/2026 perdeu o lote inteiro por desistir na hora): o passo espera e
  // tenta de novo nesse caso, e só nele.
  assert.match(bloco(envia), /grep -q "SiteVerificationNotCompleted"/);
  assert.match(bloco(envia), /sleep 60/);
});

test("o passo de envio mostra a resposta do IndexNow, não só o código", () => {
  const yml = readFileSync(join(raiz, ".github", "workflows", "deploy.yml"), "utf8");
  const i = yml.indexOf("- name: IndexNow — avisa os buscadores das URLs novas");
  const fim = yml.indexOf("\n      - name:", i + 1);
  const bloco = yml.slice(i, fim < 0 ? undefined : fim);
  assert.doesNotMatch(bloco, /curl [^\n]*-o \/dev\/null/, "a resposta do POST não pode ir pro lixo");
  assert.match(bloco, /::warning::IndexNow respondeu HTTP \$code[^\n]*\$\(head -c 300 "\$resp"\)/);
});

// Teto por deploy (2026-09-30): a mudança pra /games criou ~290 mil URLs de
// carta de uma vez. Jogos, sets e endereços antigos vão primeiro; cartas
// completam até o teto; o resto fica pro sitemap.
test("teto por deploy: o que não é carta vai primeiro, carta completa até o teto", async () => {
  const { priorizaComTeto, ehPaginaDeCarta, TETO_POR_DEPLOY } = await import("../scripts/lib/indexnow.mjs");
  assert.equal(TETO_POR_DEPLOY, 20000);
  assert.equal(ehPaginaDeCarta(`${O}/games/pokemon/base-set/charizard-4-102`), true);
  assert.equal(ehPaginaDeCarta(`${O}/card/charizard-4`), true);
  assert.equal(ehPaginaDeCarta(`${O}/games/pokemon/base-set`), false);
  assert.equal(ehPaginaDeCarta(`${O}/games/pokemon`), false);
  assert.equal(ehPaginaDeCarta(`${O}/set/base-set`), false);
  const cartas = Array.from({ length: 5 }, (_, i) => `${O}/games/pokemon/base-set/c-${i}`);
  const outras = [`${O}/games/pokemon`, `${O}/set/base-set`, `${O}/games/pokemon/base-set`];
  const { enviar, fora } = priorizaComTeto([...cartas, ...outras], 5);
  assert.deepEqual(enviar.slice(0, 3), outras);
  assert.equal(enviar.length, 5);
  assert.equal(fora, 3);
  assert.deepEqual(priorizaComTeto(outras), { enviar: outras, fora: 0 });
});
