export const collectionName = `${process.env.COLLECTION}/{documentId}`;
export const enableRestore = process.env.ENABLE_RESTORE ?? true;
export const historyPath = `${
  process.env.HISTORY_COLLECTION ?? "history"
}/database`;
// export const ignoreFields = "updated_at,image,created_at"; // TODO
export const restoreField = process.env.RESTORE_FIELD ?? "restore";
export const gotoField = process.env.GOTO_FIELD ?? "goto";
export const undoField = process.env.UNDO_FIELD ?? "undo";
export const redoField = process.env.REDO_FIELD ?? "redo";
export const versionField = process.env.VERSION_FIELD ?? "_version";
