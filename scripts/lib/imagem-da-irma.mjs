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

const QUALIFICADORES_DO_FIM = /(\s*\([^()]*\))+\s*$/;

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

// produtos: [{ productId, groupId, name, number, imageCount }], de TODOS os
// grupos do jogo (a irmã pode estar em outro set). Devolve Map
// productId sem foto → productId da irmã com foto.
export function irmasComFoto(produtos) {
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
    const outroSetVale = !temLetraDeVariante(p.number);
    const meus = qualificadores(p.name);
    const candidatas = (comFoto.get(chave(p)) || [])
      .filter((q) => q.groupId === p.groupId || outroSetVale)
      .map((q) => ({ q, d: distancia(meus, qualificadores(q.name)), outroSet: q.groupId === p.groupId ? 0 : 1 }))
      .sort((x, y) => x.d - y.d || x.outroSet - y.outroSet || x.q.productId - y.q.productId);
    if (candidatas.length) irmas.set(p.productId, candidatas[0].q.productId);
  }
  return irmas;
}
