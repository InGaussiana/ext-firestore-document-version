export const config = {
  collectionName: `${process.env.COLLECTION}/{documentId}`,
  enableRestore: process.env.ENABLE_RESTORE ?? true,
  historyPath: `${process.env.HISTORY_COLLECTION ?? "history"}/database`,
  ignoreFields: process.env.IGNORE_FIELDS ?? "",
  restoreField: process.env.RESTORE_FIELD ?? "_restore",
  gotoField: process.env.GOTO_FIELD ?? "_goto",
  undoField: process.env.UNDO_FIELD ?? "_undo",
  redoField: process.env.REDO_FIELD ?? "_redo",
  versionField: process.env.VERSION_FIELD ?? "_version",
};
