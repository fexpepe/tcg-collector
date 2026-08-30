// Primeiros passos (E3): checklist leve e dispensável no Dashboard — o hub
// pessoal, que é onde o login cai.
//
// O problema que ele resolve não é "faltam features": os caminhos rápidos já
// existem (quick-add por número, import de CSV, wizard de listas, PWA). O
// recém-logado é que não sabe que existem, e a tela dele é uma parede de zeros.
// O elogio dominante da categoria é "se aprende em 1 minuto"; isto é a
// apresentação desses quatro caminhos, em ordem de esforço.
//
// REGRA DE HONESTIDADE: um passo só marca sozinho quando dá pra VERIFICAR que
// aconteceu. Nada aqui marca por visita de página — um checklist que se marca
// à toa é pior que checklist nenhum. Por isso "importar CSV" depende de uma
// marca gravada pelo próprio import (shared.marcaPasso), e não de o usuário
// ter passado pela tela de backup.
//
// ARQUIVO PRÓPRIO, carregado só no Dashboard: o shared.js está a 97% do
// orçamento de peso e viaja em todas as páginas.
(function () {
  const shared = window.TCGShared;
  const alvo = document.getElementById("dhSteps");
  if (!shared || !alvo) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  const KEY = shared.PASSOS_KEY || "tcg-primeiros-passos-v1";
  function estado() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function grava(patch) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign(estado(), patch))); } catch (e) { /* cota */ }
  }

  function listas() {
    try { return shared.createListStore().list().length > 0; } catch (e) { return false; }
  }
  // Instalado só é observável de dentro do próprio app (display-mode). Quando
  // o Dashboard abre em standalone a marca fica gravada, pra o passo continuar
  // riscado depois, quando a pessoa voltar pela aba do navegador.
  function instalado(st) {
    if (shared.isStandalonePWA && shared.isStandalonePWA()) { if (!st.pwa) grava({ pwa: 1 }); return true; }
    return !!st.pwa;
  }

  function passos() {
    const st = estado();
    // O contador de cópias é o mesmo do resumo lá em cima: sem catálogo, só
    // localStorage — o checklist não pode ser o que segura a primeira pintura.
    const temCarta = shared.collectionCounts().copies > 0;
    return [
      { id: "carta", ok: temCarta, href: "sets" },
      { id: "csv", ok: !!st.csv, href: "backup" },
      { id: "lista", ok: listas(), href: "listas" },
      { id: "app", ok: instalado(st), acao: "instalar" }
    ];
  }

  function pinta() {
    const st = estado();
    const itens = passos();
    const feitos = itens.filter((p) => p.ok).length;
    // Some sozinho quando termina (ou quando foi dispensado): checklist
    // completo que continua na tela vira ruído permanente.
    if (st.off || feitos === itens.length) { alvo.hidden = true; alvo.innerHTML = ""; return; }

    const linha = (p) => {
      const txt = `<span class="pp-tick" aria-hidden="true"></span>
        <span class="pp-txt"><strong>${escapeHtml(t("pp." + p.id))}</strong>
        <span>${escapeHtml(t("pp." + p.id + ".hint"))}</span></span>`;
      if (p.ok) return `<li class="pp-item is-done">${txt}</li>`;
      // O passo do app não é um link: no Android ele dispara o prompt nativo e
      // no iOS abre a folha de dois passos — não existe página pra onde ir.
      const dentro = p.acao
        ? `<button type="button" class="pp-go" data-pp-install>${txt}</button>`
        : `<a class="pp-go" href="${escapeAttribute(p.href)}">${txt}</a>`;
      return `<li class="pp-item">${dentro}</li>`;
    };

    alvo.hidden = false;
    alvo.innerHTML = `
      <div class="pp-head">
        <h2>${escapeHtml(t("pp.title"))}</h2>
        <span class="pp-count">${escapeHtml(t("pp.count", { n: feitos, total: itens.length }))}</span>
        <button type="button" class="pp-x" data-pp-off aria-label="${escapeAttribute(t("pp.dismiss"))}" title="${escapeAttribute(t("pp.dismiss"))}">×</button>
      </div>
      <ol class="pp-list">${itens.map(linha).join("")}</ol>`;
  }

  alvo.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-pp-off]")) { grava({ off: 1 }); pinta(); return; }
    if (!ev.target.closest("[data-pp-install]")) return;
    if (shared.pwaInstallFlow) shared.pwaInstallFlow();
  });
  // O navegador confirma a instalação por evento próprio; e o `sleevu:installable`
  // dispara quando o prompt é consumido. Repintar nos dois deixa o passo riscar
  // sem exigir reload.
  window.addEventListener("appinstalled", () => { grava({ pwa: 1 }); pinta(); });
  document.addEventListener("sleevu:installable", pinta);

  pinta();
})();
