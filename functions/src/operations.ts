import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import {
  DocumentData,
  DocumentSnapshot,
  Query,
  WhereFilterOp,
} from "firebase-admin/firestore";
import {
  enableRestore,
  gotoField,
  redoField,
  restoreField,
  undoField,
  versionField,
} from "./config";
import {
  isRestoring,
  isHistoryTransaction,
  canRedo,
  getHistoryPath,
  deletedHistoryFlags,
  getHistoryPathVersion,
  cleanFlags,
} from "./utils";
import { EventContext } from "firebase-functions";

export async function handleDocumentCreation(document: DocumentSnapshot) {
  logger.log(`Document CREATED (${document.ref.path})`);

  if (enableRestore && isRestoring(document)) {
    logger.log(
      `RESTORE operation found on just created document (${document.ref.path})`
    );
    await restoreDocument(document);
    return;
  }

  if (isHistoryTransaction(document)) {
    logger.log(
      `Found invalid operations on just created document (${document.ref.path}) and no RESTORE operation. Deleting document.`
    );
    await document.ref.delete();
    return;
  }
}

export async function handleDocumentDeletion(
  before: DocumentSnapshot,
  after: DocumentSnapshot
) {
  logger.log(`Document DELETED (${after.ref.path})`);

  if (!enableRestore) {
    logger.log(
      `Restore operation disabled: Deleting all history versions of document (${after.ref.path})`
    );
    // If can't restore, delete all versions
    await deleteVersions(after, "0", ">=");
    return;
  }

  // If can restore and redo, delete all possible "redo" versions and keep
  // all the history before the change in case of restoration
  if (canRedo(before)) {
    logger.log(
      `Redo versions found on deletion. Cleaning unreacheable versions after delete of document (${after.ref.path})`
    );
    await deleteVersions(after, before.get(versionField), ">=");
  }

  logger.log(
    `Saving deleted document (${after.ref.path}) on "${getHistoryPath(after)}"`
  );
  // Save last version on history without history transaction flags
  await admin
    .firestore()
    .doc(getHistoryPath(after))
    .set({ ...before.data(), ...deletedHistoryFlags() });

  logger.log("DONE");
}

export async function restoreDocument(document: DocumentSnapshot) {
  try {
    logger.log(`Restoring (${document.ref.path})`);
    const restoreValue = await admin
      .firestore()
      .doc(getHistoryPath(document))
      .get();

    const restoreData = restoreValue?.data();
    if (restoreData) {
      await document.ref.set(restoreData);
      logger.log("DONE");
      await restoreValue.ref.delete();
    } else {
      logger.log("No backup document found. ABORTING.");
      await document.ref.delete();
    }
  } catch (error) {
    logger.error(`ERROR restoring document (${document.ref.path})`, error);
    throw error;
  }
}

export async function goToVersion(
  document: DocumentSnapshot,
  context: EventContext
) {
  try {
    logger.log(
      `Setting (${document.ref.path}) document version to ${document.get(
        gotoField
      )}`
    );

    const versionSnap = await admin
      .firestore()
      .doc(`${getHistoryPathVersion(document)}/${document.get(gotoField)}`)
      .get();

    const versionData = versionSnap?.data();
    if (!versionData) {
      logger.log(
        `Version ${document.get(gotoField)} of document "${
          document.ref.path
        }" not found. ABORTING!.`
      );
      await cleanFlags(document, [gotoField]);
      return;
    }

    if (!canRedo(document)) {
      await saveCurrentStateVersion(document, context);
    }

    const toSave = versionData.data;

    if (versionSnap.get("last")) {
      await versionSnap.ref.delete();
    } else {
      toSave[versionField] = document.get(gotoField);
    }

    await document.ref.set(toSave);
    logger.log("DONE");
  } catch (error) {
    logger.error(
      `ERROR setting (${document.ref.path}) document version to ${document.get(
        gotoField
      )}`,
      error
    );
    throw error;
  }
}

export async function undo(document: DocumentSnapshot, context: EventContext) {
  let query: Query<DocumentData> = admin
    .firestore()
    .collection(getHistoryPathVersion(document));

  // If actual version can redo
  if (canRedo(document)) {
    query = query.where("date", "<", new Date(document.get(versionField)));
  }

  // Get version before
  query = query.orderBy("date", "desc").limit(1);
  const last = await query.get();

  // If can't undo
  if (!last?.docs.length) {
    logger.log(
      `Document (${document.ref.path}) don't have older versions to undo. ABORTING`
    );
    await cleanFlags(document, [undoField]);
    return;
  }

  try {
    logger.log(`Undoing change on (${document.ref.path})`);
    const oldRecord = last.docs[0];

    // If undoing from last change
    if (!canRedo(document)) {
      await saveCurrentStateVersion(document, context);
    }

    // Restoring old state and setting the version flag
    await document.ref.set({
      ...oldRecord.get("data"),
      [versionField]: oldRecord.id,
    });

    logger.log("DONE");
  } catch (error) {
    logger.error(
      `ERROR undoing change of document (${document.ref.path})`,
      error
    );
    throw error;
  }
}

export async function redo(document: DocumentSnapshot) {
  // If there is no something to redo
  if (!canRedo(document)) {
    logger.log(
      `Document (${document.ref.path}) don't have new versions to redo. ABORTING`
    );
    await cleanFlags(document, [redoField, versionField]);
    return;
  }

  // Get next version
  const next = await admin
    .firestore()
    .collection(getHistoryPathVersion(document))
    .where("date", ">", new Date(document.get(versionField)))
    .orderBy("date", "asc")
    .limit(1)
    .get();

  // If can't redo
  if (!next?.docs.length) {
    logger.log(
      `Document (${document.ref.path}) don't have new versions to redo. ABORTING`
    );
    await cleanFlags(document, [redoField, versionField]);
    return;
  }

  try {
    logger.log(`Redoing change on (${document.ref.path})`);

    const newRecord = next.docs[0];
    const toSave = newRecord.get("data");

    if (newRecord.get("last")) {
      await newRecord.ref.delete();
    } else {
      toSave[versionField] = newRecord.id;
    }

    await document.ref.set(toSave);

    logger.log("DONE");
  } catch (error) {
    logger.error(
      `ERROR redoing change of document (${document.ref.path})`,
      error
    );
    throw error;
  }
}

export async function deleteVersions(
  document: DocumentSnapshot,
  version: string,
  comparator: WhereFilterOp = ">"
) {
  try {
    logger.log(
      `Deleting versions "${comparator} ${version}" of document (${document.ref.path})`
    );

    const versionsOverwrited = await admin
      .firestore()
      .collection(getHistoryPathVersion(document))
      .where("date", comparator, new Date(version))
      .get();

    await Promise.all(
      versionsOverwrited?.docs.map(async (d) => await d.ref.delete())
    );

    logger.log("DONE");
  } catch (error) {
    logger.error(
      `ERROR deleting versions ${comparator} ${version} of document (${document.ref.path})`,
      error
    );
    throw error;
  }
}

export async function saveCurrentStateVersion(
  document: DocumentSnapshot,
  context: EventContext
) {
  try {
    const path = `${getHistoryPathVersion(document)}/${context.timestamp}`;

    logger.log(
      `Saving current state of document (${document.ref.path}) on "${path}"`
    );

    // Save current document state before undo, so last change doesn't get lost
    await admin
      .firestore()
      .doc(path)
      .set(
        {
          data: { ...document.data(), ...deletedHistoryFlags() },
          date: new Date(context.timestamp),
          last: true, // mark as last
        },
        // Need merge to enable deletion of flags
        { merge: true }
      );

    logger.log("DONE");
  } catch (error) {
    logger.error(
      `ERROR deleting version of document (${document.ref.path})`,
      error
    );
    throw error;
  }
}
