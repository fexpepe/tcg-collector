// Textos da tela Perfil do celular (account.html), redesenhada em 2026-10-26
// — quem liga a tela é o src/perfil.js. Pacote SEPARADO do i18n.js pelo mesmo
// motivo do lore e das entidades: só uma página usa. Merge por IDIOMA, como os
// outros pacotes: a ordem de carga não importa, desde que venha antes do
// shared.js (é ele que traduz os data-i18n do HTML).
(function () {
  const M = (window.TCG_MESSAGES = window.TCG_MESSAGES || {});

  M.pt = Object.assign(M.pt || {}, {
    "acc.prefs": "Preferências",
    "acc.account": "Sua conta",
    "acc.discover": "Explorar",
    "acc.about": "Ajuda e termos",
    "acc.currency": "Moeda",
    "acc.language": "Idioma",
    "acc.theme": "Tema",
    "acc.theme.auto": "Auto",
    "acc.theme.light": "Claro",
    "acc.theme.dark": "Escuro",
    "acc.hidePrices": "Esconder preços",
    "acc.hidePricesSub": "Modo Colecionador: o site todo sem valores",
    "acc.install": "Instalar app",
    "acc.support": "Apoiar o Sleevu",
    "acc.supportSub": "Mantém o site no ar e, a partir de R$ 10, deixa sua conta 30 dias sem anúncio.",
    "acc.sync.ok": "Sincronizado {quando}",
    "acc.sync.now": "Sincronizado agora",
    "acc.sync.fail": "A última sincronização falhou",
    "acc.sync.idle": "Ainda não sincronizado",
    "acc.guest.title": "Entre na sua conta",
    "acc.guest.sub": "Guarde a coleção na nuvem e abra em qualquer aparelho. Grátis e sem senha.",
    "acc.guest.local": "Sem conta, tudo fica salvo só neste aparelho."
  });

  M.en = Object.assign(M.en || {}, {
    "acc.prefs": "Preferences",
    "acc.account": "Your account",
    "acc.discover": "Explore",
    "acc.about": "Help and legal",
    "acc.currency": "Currency",
    "acc.language": "Language",
    "acc.theme": "Theme",
    "acc.theme.auto": "Auto",
    "acc.theme.light": "Light",
    "acc.theme.dark": "Dark",
    "acc.hidePrices": "Hide prices",
    "acc.hidePricesSub": "Collector Mode: the whole site without values",
    "acc.install": "Install app",
    "acc.support": "Support Sleevu",
    "acc.supportSub": "Keeps the site online, and R$ 10 or more keeps your account ad-free for 30 days.",
    "acc.sync.ok": "Synced {quando}",
    "acc.sync.now": "Synced just now",
    "acc.sync.fail": "The last sync failed",
    "acc.sync.idle": "Not synced yet",
    "acc.guest.title": "Sign in to your account",
    "acc.guest.sub": "Keep your collection in the cloud and open it on any device. Free and passwordless.",
    "acc.guest.local": "Without an account, everything is saved on this device only."
  });

  M.es = Object.assign(M.es || {}, {
    "acc.prefs": "Preferencias",
    "acc.account": "Tu cuenta",
    "acc.discover": "Explorar",
    "acc.about": "Ayuda y términos",
    "acc.currency": "Moneda",
    "acc.language": "Idioma",
    "acc.theme": "Tema",
    "acc.theme.auto": "Auto",
    "acc.theme.light": "Claro",
    "acc.theme.dark": "Oscuro",
    "acc.hidePrices": "Ocultar precios",
    "acc.hidePricesSub": "Modo Coleccionista: todo el sitio sin valores",
    "acc.install": "Instalar app",
    "acc.support": "Apoyar a Sleevu",
    "acc.supportSub": "Mantiene el sitio en línea y, desde R$ 10, deja tu cuenta 30 días sin anuncios.",
    "acc.sync.ok": "Sincronizado {quando}",
    "acc.sync.now": "Sincronizado ahora",
    "acc.sync.fail": "La última sincronización falló",
    "acc.sync.idle": "Aún no sincronizado",
    "acc.guest.title": "Entra en tu cuenta",
    "acc.guest.sub": "Guarda la colección en la nube y ábrela en cualquier dispositivo. Gratis y sin contraseña.",
    "acc.guest.local": "Sin cuenta, todo queda guardado solo en este dispositivo."
  });
})();
