// Lembrança da ÚLTIMA CONTA usada no navegador (o "Continuar como fulano" da
// tela de login) + o login_hint que o atalho manda pro Google.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const CHAVE = "sleevu-ultima-conta-v1";

function fresh(seed) {
  const ls = makeLocalStorage(seed);
  const sb = loadShared(
    "window.__test = { rememberAccount, getLastAccount, forgetLastAccount, oauthSignIn };",
    { localStorage: ls }
  );
  return { ls, api: sb.window.__test, sb };
}

test("guarda e-mail, primeiro nome e o provedor de quem entrou pelo Google", () => {
  const { ls, api } = fresh();
  api.rememberAccount({
    email: "fernando@gmail.com",
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Fernando Pepe Pereira" }
  });
  const conta = JSON.parse(ls._dump()[CHAVE]);
  assert.equal(conta.email, "fernando@gmail.com");
  assert.equal(conta.nome, "Fernando", "só o primeiro nome — é o que cabe no botão");
  assert.equal(conta.via, "google");
  assert.ok(conta.ts > 0);
});

test("link mágico marca via=email — o atalho do Google NÃO pode aparecer pra ele", () => {
  const { api } = fresh();
  api.rememberAccount({ email: "so-email@x.com", app_metadata: { provider: "email" } });
  assert.equal(api.getLastAccount().via, "email");
  assert.equal(api.getLastAccount().nome, "", "link mágico não traz nome");
});

test("sem e-mail não grava nada (usuário meia-boca não vira atalho quebrado)", () => {
  const { ls, api } = fresh();
  api.rememberAccount({ app_metadata: { provider: "google" } });
  api.rememberAccount(null);
  assert.equal(ls._dump()[CHAVE], undefined);
  assert.equal(api.getLastAccount(), null);
});

test("getLastAccount ignora lixo no localStorage em vez de estourar", () => {
  assert.equal(fresh({ [CHAVE]: "{isso não é json" }).api.getLastAccount(), null);
  assert.equal(fresh({ [CHAVE]: JSON.stringify({ nome: "X" }) }).api.getLastAccount(), null, "sem e-mail não serve");
});

test('forgetLastAccount limpa — é o "entrar com outra conta"', () => {
  const { ls, api } = fresh();
  api.rememberAccount({ email: "a@b.com", app_metadata: { provider: "google" } });
  api.forgetLastAccount();
  assert.equal(ls._dump()[CHAVE], undefined);
  assert.equal(api.getLastAccount(), null);
});

test("oauthSignIn leva o login_hint pro Google (e segue funcionando sem extras)", () => {
  const { api, sb } = fresh();
  api.oauthSignIn("google", { login_hint: "fernando+teste@gmail.com" });
  const url = new URL(sb.location.href);
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("login_hint"), "fernando+teste@gmail.com", "e-mail escapado, não colado cru");
  assert.ok(url.searchParams.get("redirect_to"), "o redirect_to não pode se perder no caminho");

  api.oauthSignIn("google");
  assert.equal(new URL(sb.location.href).searchParams.get("login_hint"), null);

  // Valor vazio não vira "login_hint=" na URL — parâmetro vazio confunde o provedor.
  api.oauthSignIn("google", { login_hint: "" });
  assert.equal(new URL(sb.location.href).searchParams.has("login_hint"), false);
});
