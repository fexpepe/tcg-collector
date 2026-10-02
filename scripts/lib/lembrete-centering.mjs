// Lembrete das tabelas de centralização (docs/PLANO-CENTERING-V2.md §4.8).
//
// Graduadora muda a regra sem anunciar (a PSA trocou o texto em 2025 sem
// aviso), e uma tabela velha no src/centering-graders.js vira nota estimada
// errada, calada. Cada graduadora carrega `conferido: "AAAA-MM-DD"`; passou de
// 180 dias, o scripts/check.mjs imprime UMA linha própria, sempre (a lista de
// avisos só aparece com --verbose e já resume dezenas de avisos numa linha), e
// no GitHub Actions a mesma linha vira ::warning:: nos checks da PR.
//
// NUNCA falha o CI: lembrete com data marcada que derruba o build vira
// bomba-relógio num dia qualquer, sem ninguém ter mexido em nada.
//
// Lido por regex, não executando o arquivo: ele é dado puro, e o check não
// pode depender de ele carregar (nem de ele existir — a página nasceu depois
// desta guarda, e um checkout parcial não pode quebrar o check).

export const LIMITE_DIAS = 180;

// texto = conteúdo do src/centering-graders.js ("" se não existir);
// hoje = Date (injetável pro teste). Devolve a linha do lembrete ou null.
export function lembreteTabelas(texto, hoje = new Date(), limite = LIMITE_DIAS) {
  if (!texto) return null;
  const velhas = [];
  // Aceita `conferido: "…"` e `"conferido": "…"`, aspas simples ou duplas.
  const re = /["']?\bconferido["']?\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/g;
  for (const m of texto.matchAll(re)) {
    const dias = Math.floor((hoje.getTime() - Date.parse(`${m[1]}T00:00:00Z`)) / 86400000);
    if (!(dias > limite)) continue; // NaN (data inválida) também passa reto
    // A graduadora é o `code` mais próximo ANTES do conferido (mesmo objeto).
    const codes = [...texto.slice(0, m.index).matchAll(/\bcode["']?\s*:\s*["']([a-z0-9-]+)["']/gi)];
    velhas.push({ code: codes.length ? codes[codes.length - 1][1] : "?", dias });
  }
  if (!velhas.length) return null;
  const max = Math.max(...velhas.map((v) => v.dias));
  const quais = [...new Set(velhas.map((v) => v.code))].join(", ");
  return `⚠ tabelas de centralização conferidas há ${max} dias: reconferir (${quais}; src/centering-graders.js, docs/PLANO-CENTERING-V2.md §4.8)`;
}
