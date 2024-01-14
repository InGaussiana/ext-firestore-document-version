const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const collectionName = `${process.env.COLLECTION}/{documentId}`;
const enableRestore = process.env.ENABLE_RESTORE ?? true;
const historyPath = `${process.env.HISTORY_COLLECTION ?? "history"}/database`;
const restoreField = process.env.RESTORE_FIELD ?? "restore";
const gotoField = process.env.GOTO_FIELD ?? "goto";
const undoField = process.env.UNDO_FIELD ?? "undo";
const redoField = process.env.REDO_FIELD ?? "redo";
const versionField = process.env.VERSION_FIELD ?? "_version";

exports.manageDocumentVersions = functions
  .runWith({ failurePolicy: true })
  .firestore.document(collectionName)
  .onWrite(async (data, context) => {
    if (!data) {
      return;
    }

    const docPath = context.resource.name.split("/(default)/documents/")[1];

    // If change is on histories, abort
    if (docPath.startsWith(`${historyPath}/`)) {
      return;
    }

    const before = data.before.data();
    const after = data.after.data();

    // If creatting
    if (!data.before.exists) {
      if (
        after[gotoField] ||
        after[undoField] ||
        after[redoField] ||
        (!enableRestore && after[restoreField])
      ) {
        return await db.doc(docPath).delete();
      }

      if (after[restoreField]) {
        await restore(docPath);
      }
      return;
    }

    // If deleting
    if (!data.after.exists) {
      return await onDelete(docPath, before);
    }

    if (after[restoreField]) {
      return await cleanFlags(docPath, [restoreField]);
    }

    // If we are cleaning flags
    if (
      before[gotoField] ||
      before[undoField] ||
      before[redoField] ||
      before[restoreField] ||
      (before[versionField] && !after[versionField])
    ) {
      return;
    }

    // If going to especific version
    if (after[gotoField]) {
      return await goToVersion(docPath, after, context);
    }

    // If undoing change
    if (after[undoField]) {
      return await undo(docPath, after, context);
    }

    // If redoing change
    if (after[redoField]) {
      return await redo(docPath, after);
    }

    // Save history when not undoing/redoing
    await db
      .doc(
        `${historyPath}/${toHistoryPath(docPath)}/versions_history/${
          context.timestamp
        }`
      )
      .set({
        data: before,
        date: new Date(context.timestamp),
      });

    // If it is an old version, need to delete saved histories
    // after version checkpoint
    if (after[versionField]) {
      await deleteVersionsAfter(docPath, before[versionField], ">");
      await cleanFlags(docPath, [versionField]);
    }
  });

async function restore(docPath) {
  const data = await db.doc(`${historyPath}/${toHistoryPath(docPath)}`).get();
  const restoreData = data?.data();
  if (restoreData) {
    await db.doc(docPath).set(restoreData);
    await data.ref.delete();
  }
}

async function onDelete(docPath, before) {
  // If it is an old version, need to delete saved histories
  // after version checkpoint
  if (enableRestore && before[versionField]) {
    await deleteVersionsAfter(docPath, before[versionField], ">=");
  }

  if (!enableRestore) {
    return await deleteVersionsAfter(docPath, "0", ">=");
  }

  await db.doc(`${historyPath}/${toHistoryPath(docPath)}`).set(
    {
      ...before,
      ...flagsWithValue(FieldValue.delete()),
    },
    { merge: true }
  );
}

async function goToVersion(docPath, after, context) {
  const data = await db
    .doc(
      `${historyPath}/${toHistoryPath(docPath)}/versions_history/${
        after[gotoField]
      }`
    )
    .get();

  const versionData = data?.data();

  if (!versionData) {
    return;
  }

  if (!after[versionField]) {
    await saveCurrentStateVersion(docPath, after, context);
  }

  await db
    .doc(docPath)
    .set({ ...versionData.data, [versionField]: after[gotoField] });
}

async function undo(docPath, after, context) {
  let query = db.collection(
    `${historyPath}/${toHistoryPath(docPath)}/versions_history`
  );
  // If actual version can redo
  if (after[versionField]) {
    query = query.where("date", "<", new Date(after[versionField]));
  }
  // Get version before
  query = query.orderBy("date", "desc").limit(1);

  const last = await query.get();

  // If can't undo
  if (!last?.docs.length) {
    return await cleanFlags(docPath, [undoField]);
  }

  const oldRecord = last.docs[0];

  // If undoing from last change
  if (!after[versionField]) {
    await saveCurrentStateVersion(docPath, after, context);
  }

  // Restoring old state and setting the version flagF
  await db
    .doc(docPath)
    .set({ ...oldRecord.get("data"), [versionField]: oldRecord.id });
}

async function redo(docPath, after) {
  // If there is no something to redo
  if (!after[versionField]) {
    return await cleanFlags(docPath, [redoField, versionField]);
  }

  // Get next version
  const next = await db
    .collection(`${historyPath}/${toHistoryPath(docPath)}/versions_history`)
    .where("date", ">", new Date(after[versionField]))
    .orderBy("date", "asc")
    .limit(1)
    .get();

  // If can't redo
  if (!next?.docs.length) {
    return await cleanFlags(docPath, [redoField, versionField]);
  }

  const newRecord = next.docs[0];
  const toSave = newRecord.get("data");

  if (newRecord.get("last")) {
    await newRecord.ref.delete();
  } else {
    toSave[versionField] = newRecord.id;
  }

  await db.doc(docPath).set(toSave);
}

async function cleanFlags(
  docPath,
  flags = [undoField, redoField, gotoField, restoreField, versionField]
) {
  await db.doc(docPath).update(flagsWithValue(FieldValue.delete(), flags));
}

async function deleteVersionsAfter(docPath, version, comparator = ">") {
  const versionsOverwrited = await db
    .collection(`${historyPath}/${toHistoryPath(docPath)}/versions_history`)
    .where("date", comparator, new Date(version))
    .get();

  versionsOverwrited?.forEach((d) => d.ref.delete());
}

async function saveCurrentStateVersion(docPath, after, context) {
  // Save current document state before undo, so last change doesn't get lost
  await db
    .doc(
      `${historyPath}/${toHistoryPath(docPath)}/versions_history/${
        context.timestamp
      }`
    )
    .set(
      {
        data: {
          ...after,
          ...flagsWithValue(FieldValue.delete()),
        },
        date: new Date(context.timestamp),
        last: true, // mark as last
      },
      // Just to enable deleting of goto field, really doesnt matter cause it doesnt exists
      { merge: true }
    );
}

function flagsWithValue(
  value,
  flags = [undoField, redoField, gotoField, restoreField, versionField]
) {
  return Object.fromEntries(flags.map((flag) => [flag, value]));
}

function toHistoryPath(docPath) {
  return docPath
    .split("/")
    .map((x, i) => (i % 2 != 0 ? x : `${x}_history`))
    .join("/");
}
