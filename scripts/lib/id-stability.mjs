// Régua da ESTABILIDADE DE ID do lint-catalog.mjs: dado o mesmo id no catálogo
// publicado (HEAD) e no recém-sincronizado, diz se a carta continua sendo ela.
//
// IDENTIDADE = idioma + set. Trocar isso num id que já está publicado é trocar
// a carta da pessoa por outra — erro duro. O NÚMERO fica separado porque muda
// por formatação da fonte ("4/102" -> "4") sem a carta deixar de ser ela: vale
// um aviso, não vale barrar o deploy.
//
// EXCEÇÃO — id que É o productId do TCGplayer (syncs pela TCGCSV): ali o set
// não faz parte da identidade, o PRODUTO faz. O TCGplayer arruma a
// classificação depois do lançamento (promo que nasce no set novo e vai pro
// pacote de promo; token do starter que nasce no booster), e o productId — e
// portanto o nosso id, o nome e a imagem — continua o mesmo. Caso real
// (26/09/2026): 10 tokens do Gundam (T-001..T-010) saíram do GD01 pros Starter
// Decks ST01–ST04, e o "Bone Mass" (GEM197) do FAB saiu do IAR pro GEM Pack 6
// um dia depois do lançamento. O lint tratava como "id apontando pra OUTRA
// carta" e derrubou o deploy agendado — sendo que a carta de quem tem é
// exatamente a mesma, só mudou de gaveta. Vira AVISO quando idioma e nome
// batem; nome diferente continua erro duro (aí não dá pra afirmar que é o
// mesmo produto sem olhar).
//
// Nome que só GANHOU ou PERDEU qualificador no fim ("… (Alternate Art)") também
// é a mesma carta, desde que o número continue igual. Caso real (06/10/2026):
// o TCGplayer tirou o Teemo alt-art (rb-670598, nº 263a/298) do grupo de promos
// pro do Worlds Bundle 2025 e, como dentro do bundle o "(Alternate Art)" ficou
// redundante, apagou o qualificador. Mesmo produto, mesma imagem, mesmo número,
// e o lint derrubou dois builds agendados seguidos achando que era outra carta.
// TROCAR o qualificador ("(Alternate Art)" -> "(Oversized)") continua erro
// duro: aí o TCGplayer está dizendo que é outra coisa física.
//
// A exceção é POR JOGO, não por formato de id: no Pokémon o id carrega o set
// ("base1-4") e o mesmo nome aparece em dezenas de sets — "Pikachu" que muda
// de set lá é outra carta de verdade.
//
// Sem rede e sem fs de propósito — é o que os testes travam
// (tests/id-stability.test.mjs).

// Jogo -> formato do id quando ele é "<prefixo>-<productId do TCGplayer>".
export const ID_DE_PRODUTO = {
  onepiece: /^op-\d+$/,
  fab: /^fab-\d+$/,
  gundam: /^gcg-\d+$/,
  swu: /^swu-\d+$/,
  cyberpunk: /^cpk-\d+$/,
  sorcery: /^sor-\d+$/,
  dbfw: /^dbfw-\d+$/,
  ygo: /^ygo-\d+$/,
  digimon: /^dgm-\d+$/,
  riftbound: /^rb-\d+$/,
  unionarena: /^ua-\d+$/,
  wow: /^wow-\d+$/,
  weiss: /^ws-\d+$/,
  narutocg: /^nrt-ncg-\d+$/, // até 11/11/2026, linha do naruto
  godzilla: /^gzc-\d+$/,
  palworld: /^pal-\d+$/,
  fftcg: /^fftcg-\d+$/,
  vanguard: /^vg-\d+$/
};

export const idiomaDe = (c) => c.language || "en";
export const setDe = (c) => c.setId || "";
export const numDe = (c) => String(c.number || "");
export const assinatura = (c) => `${idiomaDe(c)}|${setDe(c)}`;

export function ehIdDeProduto(jogo, id) {
  const re = ID_DE_PRODUTO[jogo];
  return !!re && re.test(String(id));
}

// O espaço ENTRE dois qualificadores não é parte do nome: "(Yellow)(Marvel)" e
// "(Yellow) (Marvel)" são o mesmo. Caso real (12/11/2026): o TCGplayer tirou as
// duas Runechant Marvel do Flesh and Blood (fab-696177 e fab-696178, IAR156-MV
// e IAR157-MV) do grupo do Omens of the Third Age pro do Usurp the Shadow
// Throne, o set do número delas, e no caminho pôs o espaço que faltava no nome.
// Mesmo produto, mesmo número, e o lint derrubou o build completo achando que
// era outra carta. Trocar o que está DENTRO dos parênteses continua erro duro.
const nomeNorm = (s) => String(s || "").trim().replace(/\s+/g, " ").replace(/\)\s*\(/g, ") (").toLowerCase();

// Um nome é o outro mais qualificador(es) "(…)" no fim — ou os dois são o mesmo
// a menos de caixa/espaço. Parêntese no MEIO do nome não é qualificador
// ("Gundam (T-001) Token"), e qualificador trocado não passa.
export function soMudouQualificador(a, b) {
  const x = nomeNorm(a), y = nomeNorm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [curto, longo] = x.length < y.length ? [x, y] : [y, x];
  return longo.startsWith(curto) && /^(\s*\([^()]*\))+$/.test(longo.slice(curto.length));
}

// Compara a carta publicada (antiga) com a nova do MESMO id. Devolve:
//   "ok"         — nada que importe pra conta de quem tem
//   "renumerado" — mesmo idioma/set, número diferente (aviso)
//   "movido"     — id de produto do TCGplayer que a fonte mudou de set, mesmo
//                  idioma e mesmo nome (ou mesmo número e nome que só ganhou/
//                  perdeu qualificador): mesma carta (aviso)
//   "repontado"  — idioma ou set mudou e não dá pra afirmar que é a mesma
//                  carta (erro duro)
// Qualificador que só repete o NÚMERO da carta ou o NOME de um dos dois sets
// não diz que coisa física ela é: é o TCGplayer separando homônimos dentro do
// grupo. Caso real (11/11/2026): as seis runas do Vendetta saíram do grupo de
// promos (OPP), onde eram "Fury Rune (Vendetta)", pro grupo do Vendetta, onde
// viraram "Fury Rune (R01b)" — mesmo produto, mesmo número, e o lint derrubou
// o build achando que era outra carta. Sai antes de comparar; "(Oversized)"
// no lugar de "(Alternate Art)" continua erro duro.
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function semRuido(nome, ruido) {
  return ruido.filter(Boolean).reduce((n, r) => n.replace(new RegExp(`\\s*\\(${escRe(r)}\\)`, "gi"), ""), String(nome || ""));
}

export function classificaMudanca(jogo, id, antiga, nova) {
  if (idiomaDe(antiga) !== idiomaDe(nova)) return "repontado";
  if (setDe(antiga) !== setDe(nova)) {
    if (!ehIdDeProduto(jogo, id)) return "repontado";
    const nome = String(antiga.name || "").trim();
    const mesmoNome = !!nome && nome === String(nova.name || "").trim();
    const mesmoNumero = !!numDe(antiga) && numDe(antiga) === numDe(nova);
    if (mesmoNome) return "movido";
    if (!mesmoNumero) return "repontado";
    if (soMudouQualificador(antiga.name, nova.name)) return "movido";
    // Sem o ruído, os nomes têm de ficar IGUAIS: "(Vendetta)" -> "(Oversized)"
    // não pode virar um "ganhou qualificador".
    const ruido = [numDe(nova), antiga.set, nova.set];
    const a = nomeNorm(semRuido(antiga.name, ruido)), b = nomeNorm(semRuido(nova.name, ruido));
    return a && a === b ? "movido" : "repontado";
  }
  if (numDe(antiga) !== numDe(nova)) return "renumerado";
  return "ok";
}
