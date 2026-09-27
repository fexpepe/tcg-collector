// Textos das PASTAS DE VENDA (sales.html, 2026-09-27). Pacote SEPARADO do
// i18n.js pelo mesmo motivo das Pastas e dos decks: só uma página usa, e o
// monólito já é o maior arquivo de texto do site. O check.mjs (#7) garante que
// nenhuma chave daqui seja usada numa página que não carrega este arquivo — o
// perfil público (collection.js) mostra as pastas de venda só com chaves do
// núcleo, de propósito.
// As chaves antigas da página (sales.*) continuam no i18n.js: mover chave é
// churn em três idiomas sem ganho pra quem lê.
// Merge por IDIOMA (não na raiz), então a ordem de carga entre os pacotes não
// importa.
(function () {
  const M = (window.TCG_MESSAGES = window.TCG_MESSAGES || {});

  M.pt = Object.assign(M.pt || {}, {
    // Galeria
    "sales.folders.heading": "Pastas de venda",
    "sales.folders.searchGallery": "Procurar nas pastas de venda…",
    "sales.folders.empty": "Você ainda não tem pastas de venda.",
    "sales.folders.emptyHint": "Crie uma pasta pra cada grupo, feira ou lista — cada uma com preço em lote e link público próprios.",
    "sales.folders.emptyFolder": "Pasta vazia",
    "sales.folders.new": "Nova pasta",
    "sales.folders.newHint": "Com link público próprio",
    "sales.folders.newTitle": "Nova pasta de venda",
    "sales.folders.namePlaceholder": "Ex.: Grupo de troca, Feira de domingo, Raras",
    "sales.folders.create": "Criar pasta",
    "sales.folders.defaultName": "Minhas vendas",
    "sales.folders.untitled": "Pasta sem nome",
    "sales.folders.open": "Abrir a pasta {name}",
    "sales.folders.count.one": "{n} carta",
    "sales.folders.count.other": "{n} cartas",
    "sales.folders.copyLink": "Copiar link da pasta",
    "sales.folders.copied": "Link da pasta copiado!",
    "sales.folders.delete": "Excluir pasta",
    "sales.folders.deleted.one": "Pasta excluída — {n} carta saiu da venda (continua na coleção).",
    "sales.folders.deleted.other": "Pasta excluída — {n} cartas saíram da venda (continuam na coleção).",
    "sales.dash.valueAll": "valor à venda",
    "sales.folders.stat.folders": "pastas de venda",
    "sales.folders.top": "Mais valiosas à venda",

    // Pasta aberta
    "sales.folders.back": "← Vendas e Trocas",
    "sales.folders.rename": "Nome da pasta",
    "sales.folders.searchFolder": "Procurar nesta pasta…",
    "sales.folders.summary": "Resumo da pasta de venda",
    "sales.folders.linkLabel": "Link público da pasta",
    "sales.folders.linkOff": "Ative o perfil público pra ter um link fixo",
    "sales.folders.value": "valor da pasta",
    "sales.folders.share": "Compartilhar",
    "sales.folders.shareTitle": "Copiar o link público desta pasta",
    "sales.folders.whatsShort": "WhatsApp",
    "sales.folders.imageShort": "Imagem",
    "sales.folders.dupShort": "Duplicatas",
    "sales.folders.deleteShort": "Excluir",
    "sales.dup.hint": "Põe à venda as cópias repetidas (mantendo 1 de cada na coleção)",
    "sales.folders.stat.cards": "cartas na pasta",
    "sales.folders.stat.unpriced": "sem preço",
    "sales.folders.stat.market": "referência de mercado",
    "sales.batch.title": "Preço pela referência",

    // Adicionar cartas
    "sales.folders.addTo": "Adicionar cartas em {name}",
    "sales.folders.pickerCount": "{n} nesta pasta",
    "sales.folders.inFolder": "em {name}",
    "sales.folders.inFolders": "em {n} pastas",
    "sales.folders.moved": "Carta trazida de {name}."
  });

  M.en = Object.assign(M.en || {}, {
    // Galeria
    "sales.folders.heading": "Sale folders",
    "sales.folders.searchGallery": "Search your sale folders…",
    "sales.folders.empty": "You don't have any sale folders yet.",
    "sales.folders.emptyHint": "Create one folder per group, fair or list — each with its own bulk pricing and public link.",
    "sales.folders.emptyFolder": "Empty folder",
    "sales.folders.new": "New folder",
    "sales.folders.newHint": "With its own public link",
    "sales.folders.newTitle": "New sale folder",
    "sales.folders.namePlaceholder": "E.g. Trading group, Sunday fair, Rares",
    "sales.folders.create": "Create folder",
    "sales.folders.defaultName": "My sales",
    "sales.folders.untitled": "Untitled folder",
    "sales.folders.open": "Open the {name} folder",
    "sales.folders.count.one": "{n} card",
    "sales.folders.count.other": "{n} cards",
    "sales.folders.copyLink": "Copy folder link",
    "sales.folders.copied": "Folder link copied!",
    "sales.folders.delete": "Delete folder",
    "sales.folders.deleted.one": "Folder deleted — {n} card left the sale list (still in your collection).",
    "sales.folders.deleted.other": "Folder deleted — {n} cards left the sale list (still in your collection).",
    "sales.dash.valueAll": "value for sale",
    "sales.folders.stat.folders": "sale folders",
    "sales.folders.top": "Most valuable for sale",

    // Pasta aberta
    "sales.folders.back": "← Sales & Trades",
    "sales.folders.rename": "Folder name",
    "sales.folders.searchFolder": "Search this folder…",
    "sales.folders.summary": "Sale folder summary",
    "sales.folders.linkLabel": "Folder's public link",
    "sales.folders.linkOff": "Turn on your public profile to get a fixed link",
    "sales.folders.value": "folder value",
    "sales.folders.share": "Share",
    "sales.folders.shareTitle": "Copy this folder's public link",
    "sales.folders.whatsShort": "WhatsApp",
    "sales.folders.imageShort": "Image",
    "sales.folders.dupShort": "Duplicates",
    "sales.folders.deleteShort": "Delete",
    "sales.dup.hint": "Lists your duplicate copies for sale (keeping 1 of each in your collection)",
    "sales.folders.stat.cards": "cards in the folder",
    "sales.folders.stat.unpriced": "without a price",
    "sales.folders.stat.market": "market reference",
    "sales.batch.title": "Price from reference",

    // Adicionar cartas
    "sales.folders.addTo": "Add cards to {name}",
    "sales.folders.pickerCount": "{n} in this folder",
    "sales.folders.inFolder": "in {name}",
    "sales.folders.inFolders": "in {n} folders",
    "sales.folders.moved": "Card brought over from {name}."
  });

  M.es = Object.assign(M.es || {}, {
    // Galeria
    "sales.folders.heading": "Carpetas de venta",
    "sales.folders.searchGallery": "Buscar en las carpetas de venta…",
    "sales.folders.empty": "Todavía no tienes carpetas de venta.",
    "sales.folders.emptyHint": "Crea una carpeta por grupo, feria o lista — cada una con precio en lote y enlace público propios.",
    "sales.folders.emptyFolder": "Carpeta vacía",
    "sales.folders.new": "Nueva carpeta",
    "sales.folders.newHint": "Con enlace público propio",
    "sales.folders.newTitle": "Nueva carpeta de venta",
    "sales.folders.namePlaceholder": "Ej.: Grupo de intercambio, Feria del domingo, Raras",
    "sales.folders.create": "Crear carpeta",
    "sales.folders.defaultName": "Mis ventas",
    "sales.folders.untitled": "Carpeta sin nombre",
    "sales.folders.open": "Abrir la carpeta {name}",
    "sales.folders.count.one": "{n} carta",
    "sales.folders.count.other": "{n} cartas",
    "sales.folders.copyLink": "Copiar enlace de la carpeta",
    "sales.folders.copied": "¡Enlace de la carpeta copiado!",
    "sales.folders.delete": "Eliminar carpeta",
    "sales.folders.deleted.one": "Carpeta eliminada — {n} carta salió de la venta (sigue en tu colección).",
    "sales.folders.deleted.other": "Carpeta eliminada — {n} cartas salieron de la venta (siguen en tu colección).",
    "sales.dash.valueAll": "valor en venta",
    "sales.folders.stat.folders": "carpetas de venta",
    "sales.folders.top": "Más valiosas en venta",

    // Pasta aberta
    "sales.folders.back": "← Ventas y Cambios",
    "sales.folders.rename": "Nombre de la carpeta",
    "sales.folders.searchFolder": "Buscar en esta carpeta…",
    "sales.folders.summary": "Resumen de la carpeta de venta",
    "sales.folders.linkLabel": "Enlace público de la carpeta",
    "sales.folders.linkOff": "Activa el perfil público para tener un enlace fijo",
    "sales.folders.value": "valor de la carpeta",
    "sales.folders.share": "Compartir",
    "sales.folders.shareTitle": "Copiar el enlace público de esta carpeta",
    "sales.folders.whatsShort": "WhatsApp",
    "sales.folders.imageShort": "Imagen",
    "sales.folders.dupShort": "Duplicadas",
    "sales.folders.deleteShort": "Eliminar",
    "sales.dup.hint": "Pone en venta las copias repetidas (manteniendo 1 de cada en la colección)",
    "sales.folders.stat.cards": "cartas en la carpeta",
    "sales.folders.stat.unpriced": "sin precio",
    "sales.folders.stat.market": "referencia de mercado",
    "sales.batch.title": "Precio por la referencia",

    // Adicionar cartas
    "sales.folders.addTo": "Añadir cartas a {name}",
    "sales.folders.pickerCount": "{n} en esta carpeta",
    "sales.folders.inFolder": "en {name}",
    "sales.folders.inFolders": "en {n} carpetas",
    "sales.folders.moved": "Carta traída de {name}."
  });
})();
