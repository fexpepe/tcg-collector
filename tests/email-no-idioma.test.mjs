// E-mail de entrada no idioma da interface (pacote 4E, 2026-11-28).
//
// O Supabase só grava o `data` do /auth/v1/otp quando CRIA a conta; quem já
// existe (ou entrou pelo Google) ficaria com o e-mail sempre em português. O
// site grava o `lang` no user_metadata com a sessão aberta, só quando o que o
// Supabase tem difere do idioma da interface, e o modelo do e-mail
// (supabase/email-templates/magic-link.html) escolhe o texto por `.Data.lang`.
// Tudo com fetch falso: nenhuma chamada ao Supabase de verdade.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const lf = (arq) => readFileSync(join(raiz, arq), "utf8").replace(/\r\n/g, "\n");

const KEY_LANG = "tcg-collector-ui-lang-v1";
const KEY_SESSAO = "tcg-supabase-session-v1";
const EXPOE = "window.__t = { sendMagicLink, gravaIdiomaDoEmail, setSession, getSession };";

function mapa() {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } };
}

// Sandbox com o idioma escolhido, fetch falso que anota os pedidos e sessão
// opcional já gravada. `status` é o que o fetch falso responde.
function monta({ lang, sessao, status = 200 }) {
  const pedidos = [];
  const ls = makeLocalStorage({ [KEY_LANG]: lang, ...(sessao ? { [KEY_SESSAO]: JSON.stringify(sessao) } : {}) });
  const sb = loadShared(EXPOE, {
    localStorage: ls,
    antes: (s) => {
      s.sessionStorage = mapa();
      s.fetch = (url, init) => { pedidos.push({ url: String(url), init }); return Promise.resolve({ ok: status < 400, status, json: async () => ({}) }); };
    }
  });
  return { api: sb.window.__t, pedidos, ls };
}
const sessao = (user) => ({ access_token: "tok", refresh_token: "ref", user, ts: Date.now() });
const corpo = (p) => JSON.parse(p.init.body);

test("o pedido do link manda só o código do idioma em data.lang", async () => {
  for (const lang of ["pt", "en", "es"]) {
    const { api, pedidos } = monta({ lang });
    await api.sendMagicLink("a@b.co", "");
    assert.equal(pedidos.length, 1);
    assert.match(pedidos[0].url, /\/auth\/v1\/otp\?/);
    assert.deepEqual(corpo(pedidos[0]).data, { lang }, "o metadado é o idioma e mais nada");
    assert.equal(corpo(pedidos[0]).create_user, true);
  }
});

test("idioma guardado difere: um PUT /auth/v1/user com data.lang, e a sessão passa a lembrar", async () => {
  const { api, pedidos } = monta({ lang: "en", sessao: sessao({ id: "u1", email: "a@b.co" }) });
  api.gravaIdiomaDoEmail(api.getSession());
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].init.method, "PUT");
  assert.match(pedidos[0].url, /\/auth\/v1\/user$/);
  assert.deepEqual(corpo(pedidos[0]), { data: { lang: "en" } });
  assert.equal(pedidos[0].init.headers.Authorization, "Bearer tok");
  await new Promise((r) => setImmediate(r));
  assert.equal(api.getSession().user.lang, "en", "a sessão guarda o que o Supabase passou a ter");
  assert.equal(api.getSession().user.email, "a@b.co");
});

test("a mesma aba não repete o pedido (a troca de idioma recarrega e a página seguinte vê a diferença)", () => {
  const { api, pedidos } = monta({ lang: "es", sessao: sessao({ id: "u1", email: "a@b.co" }) });
  api.gravaIdiomaDoEmail(api.getSession());
  api.gravaIdiomaDoEmail(api.getSession());
  assert.equal(pedidos.length, 1, "sem rede ou com token vencido não vira laço");
});

test("PUT recusado: não grava o idioma na sessão (a próxima aba tenta de novo)", async () => {
  const { api } = monta({ lang: "en", sessao: sessao({ id: "u1", email: "a@b.co" }), status: 401 });
  api.gravaIdiomaDoEmail(api.getSession());
  await new Promise((r) => setImmediate(r));
  assert.equal(api.getSession().user.lang, undefined);
});

test("o setSession guarda o idioma do user_metadata e nada mais do metadado", () => {
  const { api, ls } = monta({ lang: "pt" });
  api.setSession(sessao({ id: "u1", email: "a@b.co", user_metadata: { lang: "es", full_name: "Fulano", avatar_url: "x" }, app_metadata: { provider: "google" } }));
  assert.deepEqual(JSON.parse(ls.getItem(KEY_SESSAO)).user, { id: "u1", email: "a@b.co", lang: "es" });
  api.setSession(sessao({ id: "u1", email: "a@b.co", user_metadata: { full_name: "Fulano" } }));
  assert.equal(JSON.parse(ls.getItem(KEY_SESSAO)).user.lang, undefined, "conta sem o campo continua sem ele");
});

test("initAuth só chama a gravação quando o idioma da sessão difere do da interface", () => {
  const src = lf("src/shared.js");
  assert.match(src, /if \(session\.user\.lang !== currentLanguage\) gravaIdiomaDoEmail\(session\);/);
  assert.equal((src.match(/gravaIdiomaDoEmail\(/g) || []).length, 2, "definição + a única chamada");
});

// --- O modelo do e-mail -------------------------------------------------------
// Renderizador mínimo, só das construções que o modelo usa (a do Go de verdade
// roda no Supabase): o cabeçalho que escolhe $l por .Data.lang, o if/else if/
// else/end por $l e a variável do link.
const MODELO = lf("supabase/email-templates/magic-link.html");
const LINK = "https://x.supabase.co/auth/v1/verify?token=abc&type=magiclink";
function renderiza(data) {
  const lang = data && data.lang !== undefined ? String(data.lang) : "";
  const l = lang === "en" ? "en" : lang === "es" ? "es" : "pt";
  return MODELO
    .replace(/<!--[\s\S]*?-->\n/, "")
    .replace(/\{\{ \$l := "pt" \}\}\{\{ with \.Data \}\}[^\n]*\{\{ end \}\}\{\{ end \}\}\n/, "")
    .replace(/\{\{ if eq \$l "en" \}\}([\s\S]*?)\{\{ else if eq \$l "es" \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/g,
      (_, en, es, pt) => (l === "en" ? en : l === "es" ? es : pt))
    .replace(/\{\{ \.ConfirmationURL \}\}/g, LINK);
}

test("modelo: só as construções que o renderizador e o Go entendem, e todo if fecha", () => {
  const acoes = [...MODELO.replace(/<!--[\s\S]*?-->/g, "").matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1].trim());
  const ok = /^(\.ConfirmationURL|if eq \$l "(en|es)"|else if eq \$l "es"|else|end|\$l := "pt"|with \.Data|if eq \(printf "%v" \.lang\) "en"|else if eq \(printf "%v" \.lang\) "es"|\$l = "(en|es)")$/;
  acoes.forEach((a) => assert.match(a, ok, `ação fora do combinado: {{ ${a} }}`));
  const abre = acoes.filter((a) => /^(if|with)\b/.test(a)).length;
  const fecha = acoes.filter((a) => a === "end").length;
  assert.equal(abre, fecha, "if/with sem end");
  assert.ok(!/\{\{[^}]*\.lang[^}]*\}\}/.test(MODELO.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{ (else )?if eq \(printf "%v" \.lang\) "(en|es)" \}\}/g, "")),
    "o lang só entra em condição, nunca é impresso");
  assert.ok(!/\{\{/.test(MODELO.match(/<!--[\s\S]*?-->/)[0]), "o comentário do topo não pode ter ação (o Go a executaria)");
});

test("modelo: pt, en e es saem completos, com o link duas vezes e sem sobra de ação", () => {
  const casos = {
    pt: [{}, null, { lang: "pt" }, { lang: "fr" }, { lang: 5 }],
    en: [{ lang: "en" }],
    es: [{ lang: "es" }]
  };
  const marca = { pt: "Seu link de entrada", en: "Your sign-in link", es: "Tu enlace de acceso" };
  for (const [idioma, datas] of Object.entries(casos)) {
    for (const data of datas) {
      const html = renderiza(data);
      assert.ok(html.includes(marca[idioma]), `${idioma}: título (${JSON.stringify(data)})`);
      assert.equal(html.split(LINK).length - 1, 3, `${idioma}: link no href do botão, no href do texto e no texto`);
      assert.ok(!/\{\{|\}\}/.test(html), `${idioma}: sobrou ação`);
    }
  }
});

test("modelo: en e es não carregam texto em português; o inglês de rodapé fica só no padrão (pt)", () => {
  const pt = /Toque|Entrar no|Você|botão|nada acontece/;
  assert.ok(!pt.test(renderiza({ lang: "en" })));
  assert.ok(!pt.test(renderiza({ lang: "es" })));
  assert.ok(!/Sleevu sign-in link/.test(renderiza({ lang: "es" })));
  assert.ok(/This is your Sleevu sign-in link/.test(renderiza({})), "conta sem idioma segue com a nota bilíngue de antes");
  assert.ok(!/Tap the button|Toca el botón/.test(renderiza({})));
});

test("README: o assunto condicional cobre os três idiomas e o padrão, igual ao modelo", () => {
  const readme = lf("supabase/email-templates/README.md");
  const assunto = readme.match(/^\{\{ with \.Data \}\}.*$/m);
  assert.ok(assunto, "assunto de uma linha só no README");
  for (const s of ["Your sign-in link — Sleevu", "Tu enlace de acceso — Sleevu", "Seu link de entrada — Sleevu"]) assert.ok(assunto[0].includes(s), s);
  const abre = (assunto[0].match(/\{\{ (if|with)\b/g) || []).length;
  const fecha = (assunto[0].match(/\{\{ end \}\}/g) || []).length;
  assert.equal(abre, fecha);
  assert.match(readme, /Magic Link/);
  assert.match(readme, /Confirm signup/);
});
