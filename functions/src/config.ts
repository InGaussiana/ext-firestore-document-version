export const config = {
  collectionName: `${process.env.COLLECTION}/{documentId}`,
  enableRestore: process.env.ENABLE_RESTORE ?? true,
  historyPath: `${process.env.HISTORY_COLLECTION ?? "history"}/database`,
  ignoreFields: process.env.IGNORE_FIELDS ?? "",
  restoreField: process.env.RESTORE_FIELD ?? "restore",
  gotoField: process.env.GOTO_FIELD ?? "goto",
  undoField: process.env.UNDO_FIELD ?? "undo",
  redoField: process.env.REDO_FIELD ?? "redo",
  versionField: process.env.VERSION_FIELD ?? "_version",
};
