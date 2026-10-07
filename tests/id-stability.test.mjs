// Régua da estabilidade de id do lint-catalog (scripts/lib/id-stability.mjs).
// O caso real está congelado aqui: em 26/09/2026 o TCGplayer mudou de set 10
// tokens do Gundam (GD01 -> ST01..ST04) e o promo "Bone Mass" do FAB (IAR ->
// GEM), mesmo productId — e o lint derrubou o deploy agendado achando que o id
// passou a apontar pra outra carta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificaMudanca, ehIdDeProduto, soMudouQualificador } from "../scripts/lib/id-stability.mjs";

const c = (setId, number, name, language) => ({ setId, number, name, language: language || "en" });

test("produto do TCGplayer que muda de set com o mesmo nome é a mesma carta (aviso)", () => {
  assert.equal(classificaMudanca("gundam", "gcg-643280",
    c("GD01", "T-001", "Gundam (T-001) Token"), c("ST01", "T-001", "Gundam (T-001) Token")), "movido");
  assert.equal(classificaMudanca("fab", "fab-719285",
    c("IAR", "GEM197", "Bone Mass"), c("GEM", "GEM197", "Bone Mass")), "movido");
});

test("mudou de set E de nome: não dá pra afirmar que é o mesmo produto (erro)", () => {
  assert.equal(classificaMudanca("fab", "fab-719285",
    c("IAR", "GEM197", "Bone Mass"), c("GEM", "GEM197", "Bone Harvest")), "repontado");
  // nome vazio não prova nada
  assert.equal(classificaMudanca("fab", "fab-1", c("IAR", "1", ""), c("GEM", "1", "")), "repontado");
});

// Caso real de 06/10/2026: o Teemo alt-art saiu das promos (PR) pro Worlds
// Bundle 2025 (RWB) e perdeu o "(Alternate Art)" no caminho — dois builds
// agendados seguidos barrados por isso.
test("produto que muda de set e só perde/ganha qualificador, com o mesmo número, é a mesma carta (aviso)", () => {
  assert.equal(classificaMudanca("riftbound", "rb-670598",
    c("PR", "263a/298", "Teemo, Swift Scout (Alternate Art)"), c("RWB", "263a/298", "Teemo, Swift Scout")), "movido");
  // o caminho inverso (ganhou qualificador), mais de um qualificador e só caixa/espaço
  assert.equal(classificaMudanca("riftbound", "rb-716013",
    c("PR", "T1S 001/005", "Ambessa, The Wolf"),
    c("T12025", "T1S 001/005", "Ambessa, The Wolf (T1 Worlds Champion Signature Edition Bundle) (Serial Numbered)")), "movido");
  assert.equal(classificaMudanca("fab", "fab-1", c("IAR", "1", "Bone  Mass"), c("GEM", "1", "bone mass")), "movido");
});

test("qualificador não salva quando o número muda, some ou o qualificador é TROCADO (erro)", () => {
  const teemo = c("PR", "263a/298", "Teemo, Swift Scout (Alternate Art)");
  assert.equal(classificaMudanca("riftbound", "rb-670598", teemo, c("RWB", "263/298", "Teemo, Swift Scout")), "repontado");
  assert.equal(classificaMudanca("riftbound", "rb-670598",
    c("PR", "", "Teemo, Swift Scout (Alternate Art)"), c("RWB", "", "Teemo, Swift Scout")), "repontado");
  assert.equal(classificaMudanca("riftbound", "rb-670598", teemo, c("RWB", "263a/298", "Teemo, Swift Scout (Oversized)")), "repontado");
  // parêntese no meio do nome não é qualificador
  assert.equal(soMudouQualificador("Gundam (T-001) Token", "Gundam Token"), false);
  // e fora dos jogos da TCGCSV o qualificador não abre exceção nenhuma
  assert.equal(classificaMudanca("pokemon", "base1-58",
    c("base1", "58", "Pikachu (Holo)"), c("base2", "58", "Pikachu")), "repontado");
});

test("idioma que muda é sempre outra carta, mesmo em id de produto", () => {
  assert.equal(classificaMudanca("onepiece", "op-1234",
    c("OP01", "OP01-001", "Roronoa Zoro", "en"), c("OP01", "OP01-001", "Roronoa Zoro", "ja")), "repontado");
});

test("no Pokémon o set faz parte da identidade: Pikachu de outro set é outra carta", () => {
  assert.equal(classificaMudanca("pokemon", "base1-58",
    c("base1", "58", "Pikachu"), c("base2", "58", "Pikachu")), "repontado");
  // e um id com cara de produto não ganha a exceção fora dos jogos da TCGCSV
  assert.equal(ehIdDeProduto("pokemon", "op-1234"), false);
  assert.equal(ehIdDeProduto("lorcana", "fab-1"), false);
});

test("a exceção só vale pro formato <prefixo>-<productId> do próprio jogo", () => {
  assert.equal(ehIdDeProduto("gundam", "gcg-643280"), true);
  assert.equal(ehIdDeProduto("naruto", "nrt-ncg-512345"), true);
  assert.equal(ehIdDeProduto("naruto", "nrt-ccg-ss-001"), false);   // checklist narutocards.ca
  assert.equal(ehIdDeProduto("onepiece", "opcd-001-romance-dawn"), false);   // vintage
  assert.equal(ehIdDeProduto("fab", "gcg-643280"), false);            // prefixo de outro jogo
});

test("número diferente no mesmo set é aviso; nada mudou é ok", () => {
  assert.equal(classificaMudanca("pokemon", "base1-4", c("base1", "4/102", "Charizard"), c("base1", "4", "Charizard")), "renumerado");
  assert.equal(classificaMudanca("fab", "fab-1", c("IAR", "1", "X"), c("IAR", "1", "X")), "ok");
  // idioma ausente conta como "en" dos dois lados (catálogo antigo sem o campo)
  assert.equal(classificaMudanca("fab", "fab-1", { setId: "IAR", number: "1", name: "X" }, c("IAR", "1", "X")), "ok");
});
