// Backup JSON (exportar/importar em Configurações → Backup). O que importa aqui
// é COBERTURA: uma chave esquecida no backupObject é dado do usuário que some
// numa troca de navegador, e some em silêncio — foi o que aconteceu com os
// decks, que sincronizavam na nuvem mas não entravam no arquivo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "shared.js"), "utf8");

// O backup vive dentro do initAuth (precisa de DOM e sessão pra montar o menu),
// então em vez de executá-lo, lê-se o corpo das duas funções: é o suficiente pra
// provar que cada chave sincronizada aparece nos dois lados.
// Os COMENTÁRIOS saem antes de procurar: eles citam nomes de chave ("ver
// SYNC_KEYS.decks"), e sem tirá-los o teste passaria com a linha de código
// apagada — exatamente a regressão que ele existe pra pegar.
function corpoDe(nome) {
  const i = src.indexOf(`function ${nome}(`);
  assert.ok(i > 0, `${nome} não encontrada no shared.js`);
  const fim = src.indexOf("\n    }", i);
  return src.slice(i, fim).replace(/\/\/[^\n]*/g, "");
}

// Chaves que o sync leva pra nuvem e que TAMBÉM têm que caber no arquivo.
// collectionMeta/favoritesMeta/history2 ficam de fora por decisão registrada no
// comentário do backupObject — se algum dia entrarem, este teste avisa.
const ESPERADAS = [
  "binders", "decks", "folders", "sales", "graded", "tags", "lists",
  "sold", "costs", "wishTargets", "favorites"
];
const FORA = ["collectionMeta", "favoritesMeta", "history2"];

test("backupObject exporta todas as chaves sincronizadas", () => {
  const corpo = corpoDe("backupObject");
  const faltando = ESPERADAS.filter((k) => !corpo.includes(`SYNC_KEYS.${k}`));
  assert.deepEqual(faltando, [], "chave sincronizada fora do backup = dado que some na troca de navegador");
});

test("importJson restaura todas as chaves que o backup exporta", () => {
  const corpo = corpoDe("importJson");
  const faltando = ESPERADAS.filter((k) => !corpo.includes(`payload.${k}`));
  assert.deepEqual(faltando, [], "exportar sem restaurar deixa o arquivo incompleto na volta");
});

test("decks entram no backup e voltam no restore (a regressão que motivou o teste)", () => {
  assert.ok(corpoDe("backupObject").includes("SYNC_KEYS.decks"));
  assert.ok(corpoDe("importJson").includes("payload.decks"));
});

test("chave ausente no arquivo não apaga o que existe local", () => {
  // Todo restore é condicional (`if (payload.x ...)`) — restaurar um backup
  // antigo não pode zerar um store que ele nunca conheceu.
  const corpo = corpoDe("importJson");
  ESPERADAS.forEach((k) => {
    const cond = k === "favorites"
      ? "Array.isArray(payload.favorites)"
      : `payload.${k} && typeof payload.${k} === "object"`;
    assert.ok(corpo.includes(cond), `${k} deve ser restaurado sob condição`);
  });
});

test("os metadados de LWW ficam fora — restaurar tem que vencer", () => {
  const corpo = corpoDe("backupObject");
  FORA.forEach((k) => {
    assert.ok(!corpo.includes(`SYNC_KEYS.${k}`), `${k} não deveria estar no backup (ver comentário do backupObject)`);
  });
});
