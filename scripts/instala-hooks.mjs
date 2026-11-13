// Instala os hooks de git versionados em scripts/hooks/ no .git/hooks do
// repositório. Hook não vem no clone, então máquina nova (ou clone novo) roda
// isto uma vez:
//   node scripts/instala-hooks.mjs           instala/atualiza
//   node scripts/instala-hooks.mjs --check   só confere (sai 1 se faltar)
//
// Vai pro diretório COMUM do git (--git-common-dir), não pro do worktree: é
// ele que todos os worktrees consultam, inclusive os de branch antiga que nem
// têm scripts/hooks/. Por isso é cópia e não `core.hooksPath=scripts/hooks`,
// que sumiria calado em toda branch anterior a esta.
//
// Hoje o único hook é a trava de push (ver o cabeçalho do scripts/hooks/pre-push).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARCA = "sleevu-trava-push";
const soConfere = process.argv.includes("--check");
const forca = process.argv.includes("--force");

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, "hooks");
const git = (...args) => execFileSync("git", args, { cwd: aqui, encoding: "utf8" }).trim();

const destino = join(resolve(aqui, git("rev-parse", "--git-common-dir")), "hooks");

// core.hooksPath desvia o git de .git/hooks: instalar lá não adiantaria nada.
let hooksPath = "";
try { hooksPath = git("config", "--get", "core.hooksPath"); } catch { /* não definido */ }
if (hooksPath) {
  console.error(`✗ core.hooksPath está definido (${hooksPath}); o git ignora .git/hooks. Remova com: git config --unset core.hooksPath`);
  process.exit(1);
}

let pendentes = 0;
for (const nome of readdirSync(origem)) {
  // O checkout do Windows (autocrlf) entrega CRLF, e o sh do hook morre no \r.
  const novo = readFileSync(join(origem, nome), "utf8").replace(/\r\n/g, "\n");
  const alvo = join(destino, nome);
  const atual = existsSync(alvo) ? readFileSync(alvo, "utf8") : null;

  if (atual === novo) { console.log(`✓ ${nome} instalado e em dia`); continue; }
  if (soConfere) {
    console.error(`✗ ${nome} ${atual === null ? "não está instalado" : "está desatualizado"} — rode: node scripts/instala-hooks.mjs`);
    pendentes++;
    continue;
  }
  // Hook que não é nosso (sem a marca) pode ser de outra ferramenta: não pisa.
  if (atual !== null && !atual.includes(MARCA) && !forca) {
    console.error(`✗ já existe um ${nome} que não é deste repositório em ${alvo}; confira e rode de novo com --force`);
    pendentes++;
    continue;
  }
  mkdirSync(destino, { recursive: true });
  writeFileSync(alvo, novo);
  chmodSync(alvo, 0o755);
  console.log(`✓ ${nome} ${atual === null ? "instalado" : "atualizado"} em ${alvo}`);
}
process.exit(pendentes ? 1 : 0);
