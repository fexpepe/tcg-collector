// Nome da carta no endereço /games/<jogo>/<set>/<carta> (2026-09-30).
//
// Escrito UMA vez e usado dos dois lados: o prerender escreve com isto os
// links da página do set e o sitemap, e a Function de functions/games/ acha a
// carta pelo endereço calculando o mesmo nome pra cada carta do set. Se os
// dois calculassem diferente, o link da página do set levaria a um 404, sem
// erro nenhum no build. O tests/slug-carta.test.mjs trava as regras abaixo.
//
// Não existe mapa "endereço -> carta" guardado em lugar nenhum de propósito:
// o deploy já está perto do teto de arquivos do Cloudflare Pages, e um mapa
// por set seriam mais 2.700 arquivos. A borda lê os chunks do set (os mesmos
// que o app baixa) e recalcula.

// Faixa dos acentos combinantes (U+0300–U+036F), montada por código e não
// escrita como escape: as ferramentas de edição já trocaram escape unicode
// pelo caractere literal sem avisar, e a regex quebrava calada.
const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
// Japonês, chinês e coreano (kana, CJK, hangul e as formas de largura cheia):
// nome escrito nesses alfabetos não vira nada legível num endereço.
const CJK = new RegExp("[" + String.fromCharCode(0x3000) + "-" + String.fromCharCode(0x9fff) +
  String.fromCharCode(0xac00) + "-" + String.fromCharCode(0xd7af) +
  String.fromCharCode(0xff00) + "-" + String.fromCharCode(0xffef) + "]");

// A mesma régua do slug de set, de artista e de deck do prerender.
export function slugify(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFKD").replace(ACENTOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Nome: o da carta; se ele é em japonês/chinês ("ブラッキーex" viraria "ex"),
// o nome em inglês que o catálogo guarda (nameEn nos japoneses, pokemonName
// no Pokémon). Sem nenhum dos dois, o que sobrar do nome original.
function nomeDoEndereco(card) {
  const nome = String((card && card.name) || "");
  if (!CJK.test(nome)) return slugify(nome);
  return slugify(card.nameEn || card.pokemonName || "") || slugify(nome);
}

// Número impresso, do jeito que o colecionador digita: com o total quando o
// número é só dígito ("4-102", "009-094"; "pikachu-4" sozinho não diz qual
// Pikachu é) e como está quando já tem letra ("op05-119", "tg09", "xy09"),
// onde o total ("/154") é ruído: não vem impresso na carta.
function numeroDoEndereco(card) {
  const n = String((card && card.number) || "").trim();
  if (!n || !/^\d+$/.test(n)) return n;
  const t = String((card && card.setTotal) || "").trim();
  if (!/^\d+$/.test(t)) return n;
  return `${n}-${/^0\d+$/.test(n) ? t.padStart(n.length, "0") : t}`;
}

// Idioma: nada pro inglês (a edição padrão do catálogo), sufixo pros outros.
// "jp" e não "ja" porque é assim que o colecionador escreve; zh-cn e zh-tw
// viram "zh", como o Chinês único do site.
function idiomaDoEndereco(card) {
  const l = String((card && card.language) || "en").toLowerCase().slice(0, 2);
  if (!l || l === "en") return "";
  return l === "ja" ? "jp" : l;
}

// Nome base, antes de desempatar: nome-número-idioma.
export function baseDoSlug(card) {
  return slugify([nomeDoEndereco(card), numeroDoEndereco(card), idiomaDoEndereco(card)].filter(Boolean).join("-")) || "card";
}

// Endereço de cada carta de UMA página de set: Map id -> nome. Duas cartas com
// o mesmo nome, número e idioma (arte paralela do One Piece, raridades do
// mesmo card no Yu-Gi-Oh!) ganham -2, -3… na ordem do id, que não depende da
// ordem em que os arquivos foram lidos: o build e a borda chegam no mesmo
// resultado mesmo lendo os chunks em outra ordem.
export function slugsDasCartas(cards) {
  const porId = [...(cards || [])].filter((c) => c && c.id != null)
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const usados = new Set();
  const mapa = new Map();
  for (const c of porId) {
    const id = String(c.id);
    if (mapa.has(id)) continue; // a mesma impressão lida duas vezes
    const base = baseDoSlug(c);
    let s = base, i = 2;
    while (usados.has(s)) s = `${base}-${i++}`;
    usados.add(s);
    mapa.set(id, s);
  }
  return mapa;
}

// Endereço de carta que não existe mais no set (2026-10-08). O nome no
// endereço leva número e total, e o total muda quando o set cresce: o Secret
// Lair Drop ganha cartas a cada build, e 2.821 -> 2.822 trocou de uma vez o
// endereço das 2.617 cartas dele (um dos motivos dos 615 404 do Search
// Console em 08/10).
// Às vezes muda o nome ("showcase" virou "overnumbered" no Riftbound) ou o
// desempate. O endereço antigo segue no índice do Google e em links; em vez
// do 404, a borda acha a carta que ele queria dizer e manda pro de hoje (301).
// Duas tentativas, da mais segura pra menos:
//   1. mesmo nome, número e idioma, com qualquer total (ou sem);
//   2. mesmo número, total e idioma, com outro nome (o número identifica a
//      carta dentro do set).
// Mais de uma carta casando (arte paralela com o mesmo nome e número) escolhe
// pelo -2, -3 do endereço pedido, na ordem do id, como o slugsDasCartas faz.
// Se o -N não cabe no que casou (a carta chinesa sem nome que ganhou nome em
// inglês: "091-098-zh-2" era a 2ª das sem nome), a tentativa seguinte decide;
// a 1ª que achou algo fica de reserva.
// Devolve o nome de hoje, ou null. Os pedaços já saem do slugify ([a-z0-9-]),
// então entram na regex sem escape.
export function cartaParecida(cards, slugs, pedido) {
  const p = String(pedido || "");
  if (!p || !slugs) return null;
  const porId = [...(cards || [])].filter((c) => c && c.id != null && slugs.has(String(c.id)))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const tentativas = [
    (c) => {
      const num = slugify(c.number);
      if (!num) return null;
      const nome = nomeDoEndereco(c);
      const idioma = idiomaDoEndereco(c);
      return new RegExp(`^${nome ? `${nome}-` : ""}${num}(?:-\\d+)?${idioma ? `-${idioma}` : ""}(?:-(\\d+))?$`);
    },
    (c) => {
      if (!slugify(c.number)) return null;
      const idioma = idiomaDoEndereco(c);
      return new RegExp(`^(?:[a-z0-9-]+-)?${slugify(numeroDoEndereco(c))}${idioma ? `-${idioma}` : ""}(?:-(\\d+))?$`);
    }
  ];
  let reserva = null;
  for (const regra of tentativas) {
    const achadas = [];
    let empate = 0;
    for (const c of porId) {
      const re = regra(c);
      const m = re && re.exec(p);
      if (!m) continue;
      achadas.push(c);
      if (m[1]) empate = Number(m[1]);
    }
    if (!achadas.length) continue;
    if (empate < 2 || achadas[empate - 1]) {
      const s = slugs.get(String(achadas[empate >= 2 ? empate - 1 : 0].id));
      if (s && s !== p) return s;
    } else if (!reserva) {
      reserva = slugs.get(String(achadas[0].id)) || null;
    }
  }
  return reserva && reserva !== p ? reserva : null;
}

// As cartas que formam a página de um set: as do chunk com aquele NOME de set,
// fora as aposentadas (set incorporado a outro fica congelado no chunk). É a
// mesma régua do prerender, que agrupa por nome.
export function cartasDoSet(cards, nomeDoSet) {
  return (cards || []).filter((c) => c && c.set === nomeDoSet && !c.retired);
}
