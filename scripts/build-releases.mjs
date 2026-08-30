// Calendário de lançamentos: lê os manifests JÁ GERADOS de cada jogo e publica
//   data/releases.generated.json  — o que a página /lancamentos desenha
//   lancamentos.ics               — o mesmo conteúdo pra assinar no Google/Apple
//
// Por que os dois saem do MESMO passo: se a página lesse os 13 manifests no
// navegador e o .ics saísse de outro lugar, os dois divergiriam no primeiro
// build em que um jogo falhasse. Uma fonte, dois formatos.
//
// Por que não ler os manifests direto na página: são 13 arquivos grandes (o
// manifest do Magic sozinho tem centenas de sets com preço agregado) pra
// mostrar ~40 linhas de calendário. O recorte aqui é de alguns KB.
//
// A data de cada set já existe: `release` na entrada do manifest, posta pelo
// setManifestMeta (scripts/lib/sync-common.mjs) a partir do setReleaseDate das
// cartas. Nenhuma fonte nova, nenhuma chamada de rede.
//
// IMPORTANTE: roda DEPOIS do enrich-manifest.mjs — é ele que garante que toda
// entrada de manifest carrega os metadados de set, inclusive a data, mesmo no
// build rápido (que restaura o manifest do cache e pula os syncs).
//
// Uso: node scripts/build-releases.mjs
import { readFile, writeFile } from "node:fs/promises";

const RAIZ = new URL("../", import.meta.url);

// Mesma lista do enrich-manifest.mjs (dataDir de cada jogo no src/game.js).
// O slug é o que a página usa pro filtro e pro rótulo (shared.gameLabel).
const JOGOS = [
  ["pokemon", "data/"], ["lorcana", "data/lorcana/"], ["onepiece", "data/onepiece/"],
  ["magic", "data/magic/"], ["fab", "data/fab/"], ["gundam", "data/gundam/"],
  ["dbfw", "data/dbfw/"], ["ygo", "data/ygo/"], ["digimon", "data/digimon/"],
  ["riftbound", "data/riftbound/"], ["unionarena", "data/unionarena/"],
  ["naruto", "data/naruto/"], ["hxh", "data/hxh/"], ["jump", "data/jump/"]
];

// Janela: 45 dias pra trás (o "acabou de sair" ainda é notícia) e 400 pra
// frente (uma fonte que anuncia com 1 ano de antecedência cabe inteira).
const DIAS_ATRAS = 45;
const DIAS_FRENTE = 400;

function leGlobal(texto) {
  const igual = texto.indexOf("=");
  if (igual < 0) throw new Error("sem atribuição");
  return JSON.parse(texto.slice(igual + 1).trim().replace(/;\s*$/, ""));
}

// Só data ISO pura (YYYY-MM-DD). Fonte que grave timestamp ou formato local
// fica de fora: data errada num calendário é pior que data ausente.
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;
function diaISO(v) {
  const s = String(v || "").slice(0, 10);
  if (!SO_DATA.test(s)) return "";
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
}

const hoje = new Date();
const limite = (dias) => new Date(hoje.getTime() + dias * 86400000).toISOString().slice(0, 10);
const DE = limite(-DIAS_ATRAS);
const ATE = limite(DIAS_FRENTE);

// Um set por (jogo, id). O MESMO set aparece em vários idiomas no manifest do
// Pokémon (en e pt dividem setId), e três linhas iguais no calendário seriam
// ruído. Guarda o nome por idioma pra página escolher o da pessoa.
const porChave = new Map();
let jogosLidos = 0;

for (const [slug, dir] of JOGOS) {
  let manifest;
  try { manifest = leGlobal(await readFile(new URL(`${dir}manifest.generated.js`, RAIZ), "utf8")); }
  catch { continue; } // jogo sem manifest neste build
  if (!manifest || !Array.isArray(manifest.sets)) continue;
  jogosLidos++;

  for (const entrada of manifest.sets) {
    if (!entrada || !entrada.id) continue;
    const d = diaISO(entrada.release);
    if (!d || d < DE || d > ATE) continue;
    const chave = `${slug}|${entrada.id}`;
    const idioma = entrada.language || manifest.language || "en";
    const atual = porChave.get(chave);
    if (atual) {
      if (entrada.name && !atual.nomes[idioma]) atual.nomes[idioma] = entrada.name;
      // Logo/total: preenche o que faltar, sem sobrescrever o que já veio.
      if (!atual.logo && entrada.logo) atual.logo = entrada.logo;
      if (!atual.total && entrada.total) atual.total = entrada.total;
      continue;
    }
    porChave.set(chave, {
      g: slug, id: entrada.id, d,
      n: entrada.name || entrada.id,
      nomes: entrada.name ? { [idioma]: entrada.name } : {},
      logo: entrada.logo || "",
      total: entrada.total || 0
    });
  }
}

const sets = [...porChave.values()]
  .sort((a, b) => a.d.localeCompare(b.d) || a.g.localeCompare(b.g) || a.n.localeCompare(b.n));

await writeFile(new URL("data/releases.generated.json", RAIZ),
  JSON.stringify({ generatedAt: new Date().toISOString(), de: DE, ate: ATE, sets }), "utf8");

// ── .ics ────────────────────────────────────────────────────────────────────
// Eventos de DIA INTEIRO (VALUE=DATE): lançamento não tem hora, e um evento
// com hora apareceria no fuso errado pra metade do mundo. DTEND é o dia
// SEGUINTE — no iCalendar o fim de um evento de dia inteiro é exclusivo, e sem
// isso o Google desenha o evento no dia anterior pra quem está a oeste.
function maisUmDia(iso) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const semTraco = (iso) => iso.replace(/-/g, "");
// Escape do RFC 5545: barra, ponto-e-vírgula, vírgula e quebra de linha.
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Linhas de no máximo 75 OCTETOS, dobradas com um espaço no começo da
// continuação. Corta por byte e não por caractere: acento em UTF-8 ocupa 2, e
// dobrar no meio de um caractere gera arquivo inválido.
function dobra(linha) {
  const bytes = Buffer.from(linha, "utf8");
  if (bytes.length <= 75) return linha;
  const partes = [];
  let inicio = 0;
  while (inicio < bytes.length) {
    const max = partes.length === 0 ? 75 : 74; // continuação gasta 1 byte no espaço
    let fim = Math.min(inicio + max, bytes.length);
    // Recua até não cortar um caractere multibyte no meio (10xxxxxx = continuação).
    while (fim > inicio && fim < bytes.length && (bytes[fim] & 0xc0) === 0x80) fim--;
    partes.push((partes.length ? " " : "") + bytes.slice(inicio, fim).toString("utf8"));
    inicio = fim;
  }
  return partes.join("\r\n");
}

const ROTULOS = {
  pokemon: "Pokémon", lorcana: "Lorcana", onepiece: "One Piece", magic: "Magic",
  fab: "Flesh and Blood", gundam: "Gundam", dbfw: "Dragon Ball Fusion World",
  ygo: "Yu-Gi-Oh!", digimon: "Digimon", riftbound: "Riftbound",
  unionarena: "Union Arena", naruto: "Naruto", hxh: "Hunter x Hunter", jump: "Jump"
};

const linhas = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sleevu//Lancamentos//PT",
  "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:Lançamentos de TCG · Sleevu",
  "X-WR-CALDESC:Datas de lançamento dos sets acompanhados pelo Sleevu",
  // Sem alarme por padrão de propósito: calendário assinado que apita sozinho
  // é motivo nº 1 de a pessoa remover a assinatura.
  "X-PUBLISHED-TTL:PT12H"
];
// DTSTAMP é o mesmo pro arquivo todo (o momento da publicação).
const carimbo = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
for (const s of sets) {
  linhas.push("BEGIN:VEVENT");
  // UID estável: o mesmo set não vira evento novo a cada build (senão o
  // calendário de quem assinou duplicaria tudo a cada deploy).
  linhas.push(dobra(`UID:${s.g}-${s.id}@sleevu.app`));
  linhas.push(`DTSTAMP:${carimbo}`);
  linhas.push(`DTSTART;VALUE=DATE:${semTraco(s.d)}`);
  linhas.push(`DTEND;VALUE=DATE:${semTraco(maisUmDia(s.d))}`);
  linhas.push(dobra(`SUMMARY:${esc(`${ROTULOS[s.g] || s.g} · ${s.n}`)}`));
  linhas.push(dobra(`URL:https://sleevu.app/detail?type=set&name=${encodeURIComponent(s.n)}&setId=${encodeURIComponent(s.id)}&game=${s.g}`));
  linhas.push("TRANSP:TRANSPARENT");
  linhas.push("END:VEVENT");
}
linhas.push("END:VCALENDAR");

// CRLF é obrigatório no RFC 5545 (o Outlook rejeita LF puro).
await writeFile(new URL("lancamentos.ics", RAIZ), linhas.join("\r\n") + "\r\n", "utf8");

console.log(`Lançamentos: ${sets.length} set(s) de ${jogosLidos} jogo(s) com manifest, janela ${DE} → ${ATE}`);
if (!sets.length) console.log("  (nenhuma data na janela — a página mostra o estado vazio e o .ics sai só com o cabeçalho)");
