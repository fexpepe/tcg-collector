(function () {
  const shared = window.TCGShared;
  if (!shared) return;

  // Página Exportar/Importar: só liga os botões nas rotinas do shared (as
  // MESMAS que o menu do usuário usava — export JSON/CSV, restore, Dex CSV e
  // CSV genérico TCGplayer/Collectr com prévia).
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  const pick = (btnId, fileId, handler) => {
    const input = document.getElementById(fileId);
    on(btnId, () => input && input.click());
    if (input) input.addEventListener("change", () => {
      if (input.files && input.files[0]) { handler(input.files[0]); input.value = ""; }
    });
  };

  on("btnExportJson", () => shared.exportBackupJson && shared.exportBackupJson());
  on("btnExportCsv", () => shared.exportBackupCsv && shared.exportBackupCsv());
  pick("btnImportJson", "fileImportJson", (f) => shared.importBackupJson && shared.importBackupJson(f));
  pick("btnImportDex", "fileImportDex", (f) => shared.importDexCsvFile && shared.importDexCsvFile(f));
  pick("btnImportCsv", "fileImportCsv", (f) => shared.importCsvFile && shared.importCsvFile(f));

  // "Desfazer a última importação": só aparece quando existe a cópia que a
  // importação JSON guarda antes de gravar (ver applyBackupImport no shared).
  const t = shared.t;
  const card = document.getElementById("undoImportCard");
  const foto = shared.lastImportSnapshot ? shared.lastImportSnapshot() : null;
  if (card && foto) {
    card.hidden = false;
    const desc = document.getElementById("undoImportDesc");
    if (desc) desc.textContent = t("backup.undoD", { date: foto.savedAt ? new Date(foto.savedAt).toLocaleString(shared.getLocale()) : "—" });
    on("btnUndoImport", () => {
      if (!window.confirm(t("backup.undoConfirm"))) return;
      if (!shared.undoLastImport()) return;
      try { sessionStorage.setItem("tcg-import-undone", "1"); } catch (e) { /* segue sem toast */ }
      window.location.reload();
    });
  }
  try {
    if (sessionStorage.getItem("tcg-import-undone")) {
      sessionStorage.removeItem("tcg-import-undone");
      shared.toastSimples(t("backup.undoDone"));
    }
  } catch (e) { /* sem sessionStorage: sem toast */ }
})();
