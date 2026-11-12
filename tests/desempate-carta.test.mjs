// Cartas do mesmo set com o mesmo nome e número (functions/_lib/desempate-carta.js).
//
// 2026-11-11: o título, o h1 e a descrição de duas cartas com o mesmo nome e
// número no mesmo set saíam iguais (a impressão em português na página do
// set inglês, a chinesa simplificada e a tradicional, a Common e a Ultra Rare
// do Yu-Gi-Oh!). O Search Console contava essas páginas em "Cópia, o Google
// escolheu uma canônica diferente". O que se trava aqui:
//   - o rótulo é o fato que separa a carta das iguais (edição, raridade,
//     acabamento), e a edição inglesa, a padrão, não ganha rótulo;
//   - carta sem igual, ou com igual que nada no catálogo separa, fica sem
//     rótulo (nada inventado);
//   - o rótulo entra no título, no h1, na descrição e no Product, e o
//     endereço não muda.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDoDesempate } from "../functions/_lib/desempate-carta.js";
import { pecasDaCarta } from "../functions/_lib/pagina-carta.js";
import { cabecaDaRota } from "../functions/_lib/decora-app.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const en = { id: "sv03.5-006", name: "Charizard ex", number: "006", setTotal: 165, set: "151", setId: "sv03.5", language: "en", rarity: "Double Rare" };
const pt = { ...en, id: "sv03.5-006-pt", language: "pt" };
const cn = { id: "SV8a-001-zh-cn", name: "含羞苞", pokemonName: "Budew", number: "001", setTotal: 187, set: "太晶慶典ex", setId: "SV8a", language: "zh-cn" };
const tw = { ...cn, id: "SV8a-001-zh-tw", language: "zh-tw" };
const comum = { id: "ygo-93864", name: "Stardust Dragon", number: "LC5D-EN031", set: "Legendary Collection 5D's", language: "en", rarity: "Common" };
const ultra = { ...comum, id: "ygo-93865", rarity: "Ultra Rare" };

test("o rótulo é o fato que separa a carta das iguais do set", () => {
  assert.equal(rotuloDoDesempate(pt, [en, pt]), "português");
  assert.equal(rotuloDoDesempate(en, [en, pt]), "", "a edição inglesa é a padrão: não ganha rótulo");
  assert.equal(rotuloDoDesempate(cn, [cn, tw]), "chinês simplificado");
  assert.equal(rotuloDoDesempate(tw, [cn, tw]), "chinês tradicional");
  assert.equal(rotuloDoDesempate(comum, [comum, ultra]), "Common");
  assert.equal(rotuloDoDesempate(ultra, [comum, ultra]), "Ultra Rare");
  // Duas inglesas que só a raridade separa: a raridade, mesmo com uma
  // portuguesa junto.
  const en2 = { ...en, id: "sv03.5-006-b", rarity: "Special Illustration Rare" };
  assert.equal(rotuloDoDesempate(en, [en, pt, en2]), "Double Rare");
  assert.equal(rotuloDoDesempate(pt, [en, pt, en2]), "português");
  // Duas portuguesas que só a raridade separa, ao lado das inglesas: os dois
  // juntos, senão "(Double Rare)" sairia na inglesa e na portuguesa.
  const pt2 = { ...pt, id: "sv03.5-006-b-pt", rarity: "Special Illustration Rare" };
  assert.equal(rotuloDoDesempate(pt, [en, pt, en2, pt2]), "português, Double Rare");
  assert.equal(rotuloDoDesempate(en, [en, pt, en2, pt2]), "Double Rare");
  // Acabamento, quando é a única diferença (FAB: a mesma carta em Normal e em Rainbow Foil).
  const a = { id: "f1", name: "X", number: "1", variants: ["Normal"] };
  const b = { id: "f2", name: "X", number: "1", variants: ["Rainbow Foil"] };
  assert.equal(rotuloDoDesempate(b, [a, b]), "Rainbow Foil");
  // As promos chinesas em normal e em reverse holo (o catálogo guarda "Reverse").
  const promo = { id: "S-PC-028-zh-cn", name: "Pikachu", number: "028", language: "zh-cn", variants: ["Normal"] };
  const promoRev = { ...promo, id: "S-PC-028-2-zh-cn", variants: ["Reverse"] };
  assert.equal(rotuloDoDesempate(promo, [promo, promoRev]), "Normal");
  assert.equal(rotuloDoDesempate(promoRev, [promo, promoRev]), "Reverse Holo");
  // Cor (Gundam War: a mesma Operação nas seis cores, cada cor uma carta), em português.
  const azul = { id: "gw-s26-b-vo-1", name: "名も無き兵士", number: "VO-1", language: "ja", rarity: "C", color: "Blue" };
  const verde = { ...azul, id: "gw-s26-g-vo-1", color: "Green" };
  const marrom = { ...azul, id: "gw-s26-n-vo-1", color: "Brown" };
  assert.equal(rotuloDoDesempate(verde, [azul, verde, marrom]), "verde");
  assert.equal(rotuloDoDesempate(marrom, [azul, verde, marrom]), "marrom");
});

test("sem igual, ou com igual que nada separa, a carta fica sem rótulo", () => {
  assert.equal(rotuloDoDesempate(en, [en]), "");
  assert.equal(rotuloDoDesempate(en, [en, { ...en, id: "x", number: "007" }]), "", "outro número, outro título");
  assert.equal(rotuloDoDesempate(en, [en, { ...en, id: "x", name: "Charizard" }]), "", "outro nome, outro título");
  // A mesma carta duas vezes no catálogo (as promos chinesas S-PC que a
  // lista da Bulbapedia traz em dobro): nenhum fato as separa.
  const dup = { ...cn, id: "S-PC-028-2-zh-cn" };
  assert.equal(rotuloDoDesempate(cn, [cn, dup]), "");
  assert.equal(rotuloDoDesempate(null, [en]), "");
});

test("o rótulo vai pro título, h1, descrição e Product; o endereço não muda", () => {
  const jogo = jogoDaUrl("pokemon");
  const set = { slug: "sv03-5-151", nome: "151" };
  const cartas = [en, pt];
  const slugs = slugsDasCartas(cartas);
  const p = pecasDaCarta({ card: pt, jogo, set, cartas, slugs, preco: 12 });
  assert.equal(p.titulo, "Charizard ex 006/165 (português) · 151 | Sleevu");
  assert.equal(p.h1, "Charizard ex 006/165 (português)");
  assert.match(p.desc, /^Charizard ex 006\/165 \(português\) /);
  assert.equal(p.canonical, "https://sleevu.app/games/pokemon/sv03-5-151/charizard-ex-006-165-pt");
  const [produto] = [...cabecaDaRota(p, { caminho: "/x" }).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(produto.name, "Charizard ex 006/165 (português) — 151");
  // A inglesa segue como era.
  assert.equal(pecasDaCarta({ card: en, jogo, set, cartas, slugs, preco: 12 }).titulo, "Charizard ex 006/165 · 151 | Sleevu");
  // As duas chinesas na mesma página: títulos diferentes, endereços de sempre (-zh, -zh-2).
  const zh = [cn, tw];
  const zs = slugsDasCartas(zh);
  const setZh = { slug: "sv8a-ex-2", nome: "太晶慶典ex" };
  const [t1, t2] = zh.map((card) => pecasDaCarta({ card, jogo, set: setZh, cartas: zh, slugs: zs }));
  assert.notEqual(t1.titulo, t2.titulo);
  assert.match(t2.titulo, /\(chinês tradicional\)/);
  assert.deepEqual([zs.get(cn.id), zs.get(tw.id)], ["budew-001-187-zh", "budew-001-187-zh-2"]);
});
