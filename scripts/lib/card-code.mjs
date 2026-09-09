// Código da carta pro BUILD (prerender das páginas de carta/set): a MESMA
// régua do cardCode/cardCodeForms do src/shared.js, que roda no navegador como
// global e não dá pra importar daqui. O teste tests/card-code.test.mjs trava as
// duas cópias no mesmo resultado — quem muda uma muda a outra.
//
// Por que o prerender precisa disto: o Google recebe o que está no <title> e
// na description. A Nymble guardada como número "9" + setTotal 94 saía como
// "Nymble 9"; quem procura digita o impresso, "Nymble 009/094" — e não achava.

export function splitNumberTotal(card) {
  const raw = String(card.number || "").trim();
  let num = raw;
  let total = String(card.setTotal || "").trim();
  if (raw.includes("/")) {
    const parts = raw.split("/");
    num = parts[0].trim();
    if (!total) total = (parts[1] || "").trim();
  }
  return { num, total };
}

export function cardCode(card) {
  const number = String(card.number || "").trim();
  if (!number) return "";
  const total = String(card.setTotal || "").trim();
  if (number.includes("/") || !total) return number;
  if (/^0\d+$/.test(number) && /^\d+$/.test(total)) return `${number}/${total.padStart(number.length, "0")}`;
  return `${number}/${total}`;
}

export function numberSearchForms(number, width) {
  const raw = String(number || "").trim();
  if (!raw) return [];
  const out = [raw];
  const add = (f) => { if (f && !out.includes(f)) out.push(f); };
  if (/^\d+$/.test(raw)) {
    add(String(parseInt(raw, 10)));
    add(String(parseInt(raw, 10)).padStart(Math.max(3, width || 0), "0"));
  } else {
    add(raw.replace(/([a-zA-Z]+)0+(\d)/, "$1$2"));
  }
  return out;
}

export function cardCodeForms(card) {
  const { num, total } = splitNumberTotal(card);
  const totalNum = /^\d+$/.test(total) ? String(parseInt(total, 10)) : "";
  const width = totalNum ? Math.max(3, total.length) : 3;
  const nums = numberSearchForms(num, width);
  const out = [];
  const add = (f) => { if (f && !out.includes(f)) out.push(f); };
  add(String(card.number || "").trim());
  nums.forEach(add);
  const cauda = /\d$/.test(num) && !/^\d+$/.test(num) ? num.match(/(\d+)$/)[1] : "";
  if (cauda) numberSearchForms(cauda, 3).forEach(add);
  if (total) {
    add(cardCode(card));
    if (totalNum) {
      const totalPad = totalNum.padStart(width, "0");
      nums.forEach((n) => {
        add(`${n}/${total}`);
        add(`${n}/${totalNum}`);
        add(`${n}/${totalPad}`);
      });
    } else {
      nums.forEach((n) => add(`${n}/${total}`));
    }
  }
  return out;
}

// Escritas ALTERNATIVAS do código com total, pra description/JSON-LD: as
// frações que diferem do cardCode e não são só zero à esquerda duplicado —
// "9/94" pra quem exibe "009/094" (e vice-versa). Ordem: do menor pro maior.
export function alternateCodes(card) {
  const principal = cardCode(card);
  const { num, total } = splitNumberTotal(card);
  if (!/^\d+$/.test(num) || !/^\d+$/.test(total)) return [];
  const n = parseInt(num, 10), t = parseInt(total, 10);
  const width = Math.max(3, total.length);
  const formas = [`${n}/${t}`, `${String(n).padStart(width, "0")}/${String(t).padStart(width, "0")}`];
  return [...new Set(formas)].filter((f) => f !== principal);
}
