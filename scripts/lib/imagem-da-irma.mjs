// Foto da carta-irmã quando o TCGplayer não tem a da própria carta (2026-11-12).
//
// O TCGplayer cadastra produto sem subir foto, e a TCGCSV avisa com
// `imageCount: 0`. Os syncs da família TCGCSV montavam a URL do CDN pelo
// productId mesmo assim: ela responde 403 e o site mostrava "Imagem não
// Encontrada". Foi o que o Fernando viu nas três "(Serial Numbered)" do T1 2025
// Worlds Champion Bundles do Riftbound. No Riftbound eram 136 de 1.802 cartas.
//
// Quase todas têm uma IRMÃ com foto e a mesma arte, que se acha pelo nome sem
// os qualificadores do fim e pelo número impresso:
//   - "Galio (… Signature Edition Bundle) (Serial Numbered)" T1S 003/005 é a
//     Signature Edition com o número de série carimbado;
//   - "Ekko (Signature)" 168*/167 é a "Ekko (Overnumbered)" 168/167 assinada
//     (o * do número é a marca da assinatura);
//   - "Azir (Metal) (Prize Wall)" 197/221 do OPP é a 197/221 do Spiritforged
//     impressa em metal. O número com "/total" aponta pra carta do set de
//     origem, então vale procurar em OUTRO set.
//
// O que NÃO vale: número com letra de variante (R03a, 007a/298, 214b/298) é
// arte alternativa, e cada set tem a sua. A "Mind Rune (R03a)" do Vendetta não
// é a do Radiance. Conferido nas imagens: a "Fury Rune" R01 é igual no Radiance
// e no Vendetta, a R01a muda de set pra set. Com letra, só a irmã do mesmo set.
//
// Entre as candidatas ganha a que tem os qualificadores mais parecidos (a
// promo comum pega a carta comum, não a versão Metal), depois a do mesmo set,
// depois o menor productId (pra rodar igual todo dia). Sem candidata, a carta
// fica com a URL dela: o dia em que o TCGplayer subir a foto, ela aparece.
//
// `imageCount` ausente conta como "tem foto": fonte sem o campo não muda nada.
//
// Regras por jogo (2026-11-12, ao ligar nos outros syncs da TCGCSV). Medido
// comparando as imagens de cartas que TÊM foto: finge que não têm, vê qual
// irmã a regra escolheria e confere se é a mesma arte.
//   - `arte`: qualificador que marca OUTRA arte com o mesmo número. No
//     Yu-Gi-Oh a "Blue-Eyes White Dragon (Version 2)" LCKC-EN001 não é a
//     "(Version 1)"; no Weiß a "(Alternate Art)" não é a comum. Carta e irmã
//     precisam ter os MESMOS qualificadores de arte; o resto (raridade,
//     carimbo, acabamento) continua livre.
//   - `soArteBase`: o número NÃO identifica a arte. One Piece, DBFW e Digimon
//     repetem o número da carta na arte alternativa, na "SP" e nas promos de
//     judge/evento, e o nome só diz "(Judge Pack Vol. 8)". Aí todo
//     qualificador conta como arte, menos o código ("(060)", "(OP17-119)"), e
//     só vale versão base com versão base.
//   - `carimbo`: o sufixo que o nome do GRUPO ganha na edição carimbada de um
//     set ("Brightness of Hope Release Event Cards" sem ele é "Brightness of
//     Hope"). Com ele, outro set só vale se for o mesmo set com ou sem o
//     carimbo. Nos jogos da Bandai, carta sem nenhum qualificador em OUTRO set
//     ainda pode ser outra arte: o deck inicial reimprime a Nami OP01-016 com
//     arte nova, e o Manga Booster do DBFW traz a World King FB06-096 desenhada
//     em mangá. A Release Event e a Pre-Release são a carta do set com um selo.
//
// Quem usa: Riftbound (regra pura), Yu-Gi-Oh e Weiß (`arte`), FFTCG (`arte`:
// a Noir), Palworld (regra pura), One Piece, DBFW e Digimon (REGRAS_BANDAI).
// Ficaram de fora, medido no mesmo dia: Union Arena (as sem foto são as
// paralelas "(SR*)", outra arte), Sorcery (sem número, e a promo tem arte
// própria), Godzilla (o "+" do Promotion Pack é outra arte em 38 de 102
// pares), Gundam (as 4 sem foto são "(Judge Pack 03)", sem par com foto pra
// conferir a arte) e os jogos sem carta sem foto (Cyberpunk, WoW, Naruto) ou
// sem irmã (FAB, SWU). Jogo novo: medir antes de ligar.

const QUALIFICADORES_DO_FIM = /(\s*\([^()]*\))+\s*$/;
// "(060)", "(OP17-119)", "(P-053)": código ou número repetido no nome, não
// versão. Com estrela não é código: "(AP1*)" do Union Arena é a paralela.
const CODIGO = /^[\w-]*\d[\w-]*$/;

export function nomeBase(nome) {
  return String(nome || "").replace(QUALIFICADORES_DO_FIM, "").trim();
}

export function qualificadores(nome) {
  const fim = QUALIFICADORES_DO_FIM.exec(String(nome || ""));
  if (!fim) return [];
  return [...fim[0].matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim().toLowerCase());
}

// "168*/167" → "168/167": o * marca a versão assinada da mesma arte.
export function numeroBase(numero) {
  return String(numero || "").replace(/\*/g, "").trim();
}

// Dígito seguido de letra no fim do número ou logo antes da barra.
// "T1S 003/005" não tem (o S vem antes do espaço, é o código do produto).
export function temLetraDeVariante(numero) {
  return /\d[a-z](?=\/|$)/i.test(numeroBase(numero));
}

const semFoto = (p) => p.imageCount === 0;
const chave = (p) => `${nomeBase(p.name).toLowerCase()}|${numeroBase(p.number).toLowerCase()}`;

function distancia(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let d = 0;
  for (const x of A) if (!B.has(x)) d++;
  for (const x of B) if (!A.has(x)) d++;
  return d;
}

// One Piece, DBFW e Digimon (Bandai): o TCGplayer nomeia a edição carimbada
// "<set> Release Event Cards", "<set> Pre-Release Cards" ou "<set>: 3rd
// Anniversary Tournament Cards". O "(Super Pre-Release Edition)" dos ST-01 a
// ST-04 do One Piece fica de fora: o LÍDER dele tem arte própria.
export const REGRAS_BANDAI = {
  soArteBase: true,
  carimbo: /\s*(?:Release Event Cards|Pre-Release Cards|:?\s*\d+\w* Anniversary Tournament Cards)\s*$/i
};

// Qualificadores que identificam a arte, ordenados, numa string comparável.
export function qualificadoresDeArte(nome, { arte = null, soArteBase = false } = {}) {
  const qs = qualificadores(nome);
  const deArte = soArteBase ? qs.filter((q) => !CODIGO.test(q)) : (arte ? qs.filter((q) => arte.test(q)) : []);
  return deArte.sort().join("|");
}

// Nome do set sem o carimbo do evento (vazio quando não dá pra saber).
export function setSemCarimbo(grupo, carimbo) {
  return String(grupo || "").replace(carimbo, "").trim().toLowerCase();
}

// produtos: [{ productId, groupId, grupo, name, number, imageCount }], de TODOS
// os grupos do jogo (a irmã pode estar em outro set; `grupo` = nome do grupo,
// só a regra `carimbo` usa). Devolve Map productId sem foto → productId da
// irmã com foto. `regras`: ver o cabeçalho.
export function irmasComFoto(produtos, regras = {}) {
  const { carimbo = null, soArteBase = false } = regras;
  const mesmoSet = (p, q) => {
    if (!carimbo) return true;
    const a = setSemCarimbo(p.grupo, carimbo);
    return !!a && a === setSemCarimbo(q.grupo, carimbo);
  };
  const comFoto = new Map();
  for (const p of produtos) {
    if (semFoto(p)) continue;
    const k = chave(p);
    if (!comFoto.has(k)) comFoto.set(k, []);
    comFoto.get(k).push(p);
  }
  const irmas = new Map();
  for (const p of produtos) {
    if (!semFoto(p)) continue;
    const minhaArte = qualificadoresDeArte(p.name, regras);
    if (soArteBase && minhaArte) continue;
    // Sem número a chave é só o nome, e o nome não diz a arte: o "Soul (SSS)"
    // do Palworld BP01 não é o "Soul" das Prototype Cards. Só o mesmo set.
    const outroSetVale = !!numeroBase(p.number) && !temLetraDeVariante(p.number);
    const meus = qualificadores(p.name);
    const candidatas = (comFoto.get(chave(p)) || [])
      .filter((q) => q.groupId === p.groupId || (outroSetVale && mesmoSet(p, q)))
      .filter((q) => qualificadoresDeArte(q.name, regras) === minhaArte)
      .map((q) => ({ q, d: distancia(meus, qualificadores(q.name)), outroSet: q.groupId === p.groupId ? 0 : 1 }))
      .sort((x, y) => x.d - y.d || x.outroSet - y.outroSet || x.q.productId - y.q.productId);
    if (candidatas.length) irmas.set(p.productId, candidatas[0].q.productId);
  }
  return irmas;
}

// O imageCount da TCGCSV atrasa. Em 12/11, 22 das 23 cartas do FB11 do DBFW
// que a regra trocaria já tinham foto no CDN (subiu depois do espelho do dia),
// e 56 Pre-Release antigas do Digimon têm a foto própria, com o selo, e
// seguem com imageCount 0. Antes de trocar, um HEAD na URL da própria carta:
// respondeu 200, ela fica com a dela. Erro de rede conta como "sem foto" (o
// imageCount já disse isso).
const UA = "Sleevu (sleevu.app) catalog sync";
export async function temFotoNoCdn(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
    return r.ok;
  } catch {
    return false;
  }
}

// Jeito único de ligar a regra num sync: `anota` cada produto com a carta que
// ele virou, dentro do laço dos grupos; depois do laço, `aplica` troca a
// imagem das cartas sem foto pela da irmã e devolve os números pro log.
export function fotosDasIrmas(regras = {}) {
  const produtos = [];
  const cartaDoProduto = new Map();
  return {
    anota(p, g, numero, carta) {
      produtos.push({ productId: p.productId, groupId: g.groupId, grupo: g.name, name: p.name, number: numero, imageCount: p.imageCount });
      cartaDoProduto.set(p.productId, carta);
    },
    async aplica(imagemDoProduto, { temFoto = temFotoNoCdn, paralelo = 8 } = {}) {
      const fila = [...irmasComFoto(produtos, regras)];
      let comIrma = 0;
      let jaTinha = 0;
      await Promise.all(Array.from({ length: paralelo }, async () => {
        while (fila.length) {
          const [productId, irma] = fila.shift();
          if (await temFoto(imagemDoProduto(productId))) { jaTinha++; continue; }
          cartaDoProduto.get(productId).image = imagemDoProduto(irma);
          comIrma++;
        }
      }));
      const semFoto = produtos.filter((p) => p.imageCount === 0).length;
      const resumo = `Sem foto no TCGplayer: ${semFoto} cartas, ${comIrma} com a foto da irmã` +
        (jaTinha ? ` (${jaTinha} já tinham a própria no CDN).` : ".");
      return { semFoto, comIrma, jaTinha, resumo };
    }
  };
}
