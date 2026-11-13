// Trava de push (scripts/hooks/pre-push): deste repositório só sobe o que é da
// conta fexpepe (pedido de 2026-11-13). O hook é a última barreira antes de um
// commit com a identidade do trabalho virar história pública, então cada
// recusa — e a liberação do Fernando — fica travada aqui, num repositório
// descartável e sem rede (o hook é chamado direto, como o git chamaria).
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../scripts/hooks/pre-push", import.meta.url));
const URL_OK = "https://github.com/fexpepe/tcg-collector.git";
const PESSOAL = "fernandopepe.pereira@gmail.com";
const ZERO = "0".repeat(40);

const temSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const opts = { skip: temSh ? false : "sem sh no PATH" };

// Repositório novo, com a lista de credenciais ZERADA: sem isso o gerenciador
// da máquina responderia pela conta de verdade e o teste dependeria dela.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "trava-push-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "credential.helper", "");
  const commit = (autor, committer = autor) => {
    writeFileSync(join(dir, "a.txt"), String(Math.random()));
    git("add", "a.txt");
    execFileSync("git", ["commit", "-q", "-m", "x"], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: autor, GIT_COMMITTER_NAME: "C", GIT_COMMITTER_EMAIL: committer }
    });
    return git("rev-parse", "HEAD");
  };
  const push = (sha, { url = URL_OK, remoto = ZERO, env = {} } = {}) => {
    // O hook tem de estar em LF: no checkout do Windows ele pode vir em CRLF.
    const copia = join(dir, "pre-push");
    writeFileSync(copia, readFileSync(HOOK, "utf8").replace(/\r\n/g, "\n"));
    return spawnSync("sh", [copia, "origin", url], {
      cwd: dir,
      input: `refs/heads/x ${sha} refs/heads/x ${remoto}\n`,
      encoding: "utf8",
      env: { ...process.env, SLEEVU_PUSH_LIBERADO: "", ...env }
    });
  };
  return { dir, git, commit, push, fim: () => rmSync(dir, { recursive: true, force: true }) };
}

test("commit da conta sobe (e-mail pessoal e noreply do GitHub)", opts, () => {
  const r = repo();
  try {
    r.commit(PESSOAL);
    const sha = r.commit("50333617+fexpepe@users.noreply.github.com", PESSOAL);
    assert.equal(r.push(sha).status, 0);
  } finally { r.fim(); }
});

test("commit com o e-mail do trabalho é recusado, e o aviso diz qual", opts, () => {
  const r = repo();
  try {
    r.commit(PESSOAL);
    const sha = r.commit("alguem@empresa.com");
    const s = r.push(sha);
    assert.equal(s.status, 1);
    assert.match(s.stderr, /PUSH RECUSADO/);
    assert.match(s.stderr, /committer alguem@empresa\.com/);
  } finally { r.fim(); }
});

test("autor de fora com committer da conta também é recusado", opts, () => {
  const r = repo();
  try {
    const s = r.push(r.commit("alguem@empresa.com", PESSOAL));
    assert.equal(s.status, 1);
    assert.match(s.stderr, /autor alguem@empresa\.com/);
  } finally { r.fim(); }
});

test("Claude da nuvem passa como autor, nunca como committer", opts, () => {
  const r = repo();
  try {
    assert.equal(r.push(r.commit("noreply@anthropic.com", PESSOAL)).status, 0);
    assert.equal(r.push(r.commit("noreply@anthropic.com")).status, 1);
  } finally { r.fim(); }
});

test("o que o remoto já tem não entra na conta (bot do catálogo na main)", opts, () => {
  const r = repo();
  try {
    const bot = r.commit("41898282+github-actions[bot]@users.noreply.github.com");
    const meu = r.commit(PESSOAL);
    // Sem saber que o remoto tem o commit do bot, ele contaria como novo…
    assert.equal(r.push(meu).status, 1);
    // …pelo sha que o remoto informa…
    assert.equal(r.push(meu, { remoto: bot }).status, 0);
    // …ou pelo ref remoto conhecido (branch nova, rebaseada na main).
    r.git("update-ref", "refs/remotes/origin/main", bot);
    assert.equal(r.push(meu).status, 0);
  } finally { r.fim(); }
});

test("remoto que não é de github.com/fexpepe é recusado", opts, () => {
  const r = repo();
  try {
    const sha = r.commit(PESSOAL);
    for (const url of ["https://github.com/outra-org/tcg-collector.git", "git@github.com:outro/x.git", "https://gitlab.com/fexpepe/x.git", "https://github.com/fexpepe-falso/x.git"]) {
      assert.equal(r.push(sha, { url }).status, 1, url);
    }
    for (const url of ["git@github.com:fexpepe/tcg-collector.git", "https://GitHub.com/Fexpepe/tcg-collector"]) {
      assert.equal(r.push(sha, { url }).status, 0, url);
    }
  } finally { r.fim(); }
});

test("credencial de outra conta é recusada", opts, () => {
  const r = repo();
  try {
    const sha = r.commit(PESSOAL);
    r.git("config", "--add", "credential.helper", "!f() { echo username=conta-do-trabalho; echo password=x; }; f");
    const s = r.push(sha);
    assert.equal(s.status, 1);
    assert.match(s.stderr, /conta "conta-do-trabalho"/);
    r.git("config", "--unset-all", "credential.helper");
    r.git("config", "credential.helper", "");
    r.git("config", "--add", "credential.helper", "!f() { echo username=fexpepe; echo password=x; }; f");
    assert.equal(r.push(sha).status, 0);
  } finally { r.fim(); }
});

test("apagar branch não sobe commit: passa", opts, () => {
  const r = repo();
  try {
    r.commit("alguem@empresa.com");
    assert.equal(r.push(ZERO).status, 0);
  } finally { r.fim(); }
});

test("SLEEVU_PUSH_LIBERADO=1 libera e avisa que nada foi conferido", opts, () => {
  const r = repo();
  try {
    const s = r.push(r.commit("alguem@empresa.com"), { env: { SLEEVU_PUSH_LIBERADO: "1" } });
    assert.equal(s.status, 0);
    assert.match(s.stderr, /LIBERADA/);
  } finally { r.fim(); }
});
