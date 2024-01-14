const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const docPath = process.env.COLLECTION + "/{documentId}";
const enableRestore = process.env.ENABLE_RESTORE ?? true;
const historyPath = (process.env.HISTORY_COLLECTION ?? "history") + "/database";

exports.manageDocumentVersions = functions
  .runWith({ failurePolicy: true })
  .firestore.document(docPath)
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
      if (after.restore) {
        await restore(docPath);
      }
      return;
    }

    // If deleting
    if (!data.after.exists) {
      return await onDelete(docPath, before);
    }

    if (after.restore) {
      return await cleanFlags(docPath, ["restore"]);
    }

    // If we are cleaning flags
    if (
      before.undo ||
      before.redo ||
      before.restore ||
      (before._version && !after._version)
    ) {
      return;
    }

    // If undoing change
    if (after.undo) {
      return await undo(docPath, after, context);
    }

    // If redoing change
    if (after.redo) {
      return await redo(docPath, after);
    }

    // Save history when not undoing/redoing
    await db
      .doc(`${historyPath}/${docPath}/versions/${context.timestamp}`)
      .set({
        data: before,
        date: new Date(context.timestamp),
      });

    // If it is an old version, need to delete saved histories
    // after _version checkpoint
    if (after._version) {
      await deleteVersionsAfter(docPath, before._version, ">");
      await cleanFlags(docPath, ["_version"]);
    }
  });

async function restore(docPath) {
  if (!enableRestore) return;
  const data = await db.doc(`${historyPath}/${docPath}`).get();
  await db.doc(docPath).set(data.data());
  await data.ref.delete();
}

async function onDelete(docPath, before) {
  // If it is an old version, need to delete saved histories
  // after _version checkpoint
  if (enableRestore && before._version) {
    await deleteVersionsAfter(docPath, before._version, ">=");
  }

  if (!enableRestore) {
    await deleteVersionsAfter(docPath, "0", ">=");
  }

  await db.doc(`${historyPath}/${docPath}`).set(
    {
      ...before,
      _version: FieldValue.delete(),
    },
    { merge: true }
  );
}

async function undo(docPath, after, context) {
  let query = db.collection(`${historyPath}/${docPath}/versions`);
  // If actual version can redo
  if (after._version) {
    query = query.where("date", "<", new Date(after._version));
  }
  // Get version before
  query = query.orderBy("date", "desc").limit(1);

  const last = await query.get();

  // If can't undo
  if (!last.docs.length) {
    return await cleanFlags(docPath, ["undo"]);
  }

  const oldRecord = last.docs[0];

  // If undoing from last change
  if (!after._version) {
    // Save current document state before undo, so last change doesn't get lost
    await db.doc(`${historyPath}/${docPath}/versions/${context.timestamp}`).set(
      {
        data: { ...after, undo: FieldValue.delete() },
        date: new Date(context.timestamp),
        last: true, // mark as last
      },
      { merge: true } // Just to enable deleting of undo
    );
  }

  // Restoring old state and setting the _version flagF
  await db
    .doc(docPath)
    .set({ ...oldRecord.get("data"), _version: oldRecord.id });
}

async function redo(docPath, after) {
  // If there is no something to redo
  if (!after._version) {
    return await cleanFlags(docPath, ["redo", "_version"]);
  }

  // Get next version
  const next = await db
    .collection(`${historyPath}/${docPath}/versions`)
    .where("date", ">", new Date(after._version))
    .orderBy("date", "asc")
    .limit(1)
    .get();

  // If can't redo
  if (!next.docs.length) {
    return await cleanFlags(docPath, ["redo", "_version"]);
  }

  const newRecord = next.docs[0];
  const toSave = newRecord.get("data");

  if (newRecord.get("last")) {
    await newRecord.ref.delete();
  } else {
    toSave._version = newRecord.id;
  }

  await db.doc(docPath).set(toSave);
}

async function cleanFlags(
  docPath,
  flags = ["undo", "redo", "restore", "_version"]
) {
  await db
    .doc(docPath)
    .update(
      Object.fromEntries(flags.map((flag) => [flag, FieldValue.delete()]))
    );
}

async function deleteVersionsAfter(docPath, version, comparator = ">") {
  const versionsOverwrited = await db
    .collection(`${historyPath}/${docPath}/versions`)
    .where("date", comparator, new Date(version))
    .get();

  versionsOverwrited.forEach((d) => d.ref.delete());
}
