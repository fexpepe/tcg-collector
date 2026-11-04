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
// Três tentativas, da mais segura pra menos:
//   1. mesmo nome, número e idioma, com qualquer total (ou sem);
//   2. mesmo nome e idioma, e o ID da carta termina no número do endereço: a
//      carta foi RENUMERADA com o id de antes (2026-11-02, Naruto CCG: o id
//      nrt-ccg-n-883 guarda o código do narutocards, e o número passou a ser
//      o impresso, N-886). "kakashi-hatake-n-883" é desse Kakashi;
//   3. mesmo número, total e idioma, com outro nome (o número identifica a
//      carta dentro do set) — MAS não quando o nome do endereço é de outra
//      carta do set: aí o número mudou de dono, e "kakashi-hatake-n-883"
//      levaria pro Neji, que é o N-883 de hoje.
// Mais de uma carta casando (arte paralela com o mesmo nome e número) escolhe
// pelo -2, -3 do endereço pedido, na ordem do id, como o slugsDasCartas faz.
// Se o -N não cabe no que casou (a carta chinesa sem nome que ganhou nome em
// inglês: "091-098-zh-2" era a 2ª das sem nome), a tentativa seguinte decide;
// a 1ª que achou algo fica de reserva.
// Devolve o nome de hoje, ou null. Os pedaços já saem do slugify ([a-z0-9-]),
// então entram na regex sem escape.
export function cartaParecida(cards, slugs, pedido) {
  if (!String(pedido || "") || !slugs) return null;
  return preparaParecida(cards, slugs)(pedido);
}

// O mesmo cartaParecida, preparado UMA vez pra um set e consultado várias
// (2026-11-04). A borda resolve um endereço por pedido e usa o de cima; o
// deploy (scripts/lib/cartas-movidas.mjs) confere o endereço antigo de TODA
// carta que mudou dentro do set, e o Secret Lair muda ~2.700 de uma vez:
// remontando as regex a cada consulta eram 9,4 s só nele. Cada regra monta as
// regex das cartas na 1ª vez que é usada, então a consulta única custa o
// mesmo que antes (a regra 3 só é montada se a 1 e a 2 não acharam nada).
export function preparaParecida(cards, slugs) {
  if (!slugs) return () => null;
  const porId = [...(cards || [])].filter((c) => c && c.id != null && slugs.has(String(c.id)))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const nomesDoSet = new Set(porId.map(nomeDoEndereco).filter(Boolean));
  const tentativas = [
    {
      re: (c) => {
        const num = slugify(c.number);
        if (!num) return null;
        const nome = nomeDoEndereco(c);
        const idioma = idiomaDoEndereco(c);
        return new RegExp(`^${nome ? `${nome}-` : ""}${num}(?:-\\d+)?${idioma ? `-${idioma}` : ""}(?:-(?<emp>\\d+))?$`);
      }
    },
    {
      re: (c) => {
        const nome = nomeDoEndereco(c);
        if (!nome) return null;
        // Os finais do id que têm dígito: "nrt-ccg-n-883" -> 883, n-883, ccg-n-883…
        const pedacos = slugify(c.id).split("-");
        const finais = [];
        for (let i = pedacos.length - 1; i >= 0; i--) {
          const f = pedacos.slice(i).join("-");
          if (/\d/.test(f)) finais.push(f);
        }
        if (!finais.length) return null;
        const idioma = idiomaDoEndereco(c);
        return new RegExp(`^${nome}-(?:${finais.join("|")})${idioma ? `-${idioma}` : ""}(?:-(?<emp>\\d+))?$`);
      }
    },
    {
      re: (c) => {
        if (!slugify(c.number)) return null;
        const idioma = idiomaDoEndereco(c);
        return new RegExp(`^(?:(?<nome>[a-z0-9-]+)-)?${slugify(numeroDoEndereco(c))}${idioma ? `-${idioma}` : ""}(?:-(?<emp>\\d+))?$`);
      },
      aceita: (c, m) => !m.groups.nome || m.groups.nome === nomeDoEndereco(c) || !nomesDoSet.has(m.groups.nome)
    }
  ];
  // [carta, regex] de cada regra, montado na 1ª consulta que chega nela. A
  // regex não tem flag g: o exec não guarda estado entre uma consulta e outra.
  const montadas = tentativas.map(() => null);
  const regexDa = (k) => montadas[k] || (montadas[k] = porId.map((c) => [c, tentativas[k].re(c)]));
  return (pedido) => {
    const p = String(pedido || "");
    if (!p) return null;
    let reserva = null;
    for (let k = 0; k < tentativas.length; k++) {
      const regra = tentativas[k];
      const achadas = [];
      let empate = 0;
      for (const [c, re] of regexDa(k)) {
        const m = re && re.exec(p);
        if (!m || (regra.aceita && !regra.aceita(c, m))) continue;
        achadas.push(c);
        if (m.groups && m.groups.emp) empate = Number(m.groups.emp);
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
  };
}

// As cartas que formam a página de um set: as do chunk com aquele NOME de set,
// fora as aposentadas (set incorporado a outro fica congelado no chunk). É a
// mesma régua do prerender, que agrupa por nome.
export function cartasDoSet(cards, nomeDoSet) {
  return (cards || []).filter((c) => c && c.set === nomeDoSet && !c.retired);
}
