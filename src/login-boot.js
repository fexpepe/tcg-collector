// Roda no <head> da página de login, ANTES da primeira pintura — por isso é um
// arquivo próprio e sem `defer` (no login.js seria tarde: o cartão já teria
// aparecido). Só faz uma coisa: marcar o <html> quando a visita é uma VOLTA de
// login (link mágico ou Google), pra o CSS nascer mostrando "entrando" no lugar
// do formulário.
//
// Sem isso, quem clicava no link do e-mail via o cartão inteiro — título
// "Entrar", botão do Google, campo de e-mail — piscar por um instante, e de
// novo depois do reload que fecha o sync inicial. A impressão era a de que o
// login não tinha funcionado.
//
// Três sinais, do mais firme pro mais frouxo:
//   1. #access_token na URL — é literalmente a volta do provedor;
//   2. marca de sessionStorage — o shared.js acende antes de recarregar a
//      página no fim do sync inicial, e esse reload chega SEM hash nenhum;
//   3. sessão já existente — o login.js vai redirecionar em seguida, então
//      mostrar o formulário nesse meio-tempo é só piscada.
// O login.js apaga a marca (e o atributo) sempre que decide, de fato, mostrar
// o formulário — é o que impede a tela de "entrando" de ficar presa.
//
// Os nomes de chave abaixo espelham os do shared.js. Se mudarem lá, o pior que
// acontece aqui é a piscada voltar: nada quebra.
(function () {
  try {
    var entrando = (window.location.hash || "").indexOf("access_token") >= 0
      || sessionStorage.getItem("sleevu-entrando") === "1"
      || document.cookie.indexOf("sleevu_session=") >= 0
      || !!localStorage.getItem("tcg-supabase-session-v1");
    if (entrando) document.documentElement.setAttribute("data-entering", "1");
  } catch (e) { /* storage bloqueado (modo restrito): segue com o formulário */ }
})();
