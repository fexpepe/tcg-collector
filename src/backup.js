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
})();
