import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {
  collectionName,
  historyPath,
  restoreField,
  versionField,
} from "./config";
import {
  isRestoring,
  isHistoryTransaction,
  canRedo,
  isGoingTo,
  isUndoing,
  isRedoing,
  getHistoryPathVersion,
  cleanFlags,
} from "./utils";
import {
  handleDocumentCreation,
  handleDocumentDeletion,
  goToVersion,
  undo,
  redo,
  deleteVersions,
} from "./operations";

admin.initializeApp();

// TODO flatten
// TODO save current version with all. And only save versions with changes

exports.manageDocumentVersions = functions
  .runWith({ failurePolicy: true })
  .firestore.document(collectionName)
  .onWrite(async (data, context) => {
    // If changed document is a history record, abort
    if (data.after.ref.path.startsWith(`${historyPath}/`)) {
      return;
    }

    // If creatting document
    if (!data.before.exists) {
      await handleDocumentCreation(data.after);
      return;
    }

    // If deleting document
    if (!data.after.exists) {
      await handleDocumentDeletion(data.before, data.after);
      return;
    }

    functions.logger.log(`Document UPDATED (${data.after.ref.path})`);

    // Can't restore on update, so ignore it and clean the flag
    if (isRestoring(data.after)) {
      functions.logger.log(
        `RESTORE operation found on (${data.after.ref.path}) change. RESTORE operation is for creation only. ABORTING!`
      );
      await cleanFlags(data.after, [restoreField]);
      return;
    }

    // If this is an update that only cleans operation flags, abort
    if (
      isHistoryTransaction(data.before) ||
      (canRedo(data.before) && !canRedo(data.after))
    ) {
      functions.logger.log(
        `Document (${data.after.ref.path}) update is a CREATE operation, no processing needed. ABORTING!`
      );
      return;
    }

    // Handling history operations

    if (isGoingTo(data.after)) {
      functions.logger.log(
        `GO_TO_VERSION operation found (${data.after.ref.path})`
      );
      await goToVersion(data.after, context);
      return;
    }

    if (isUndoing(data.after)) {
      functions.logger.log(
        `UNDO operation found (${data.after.ref.path})`
      );
      await undo(data.after, context);
      return;
    }

    if (isRedoing(data.after)) {
      functions.logger.log(
        `Redo operation found (${data.after.ref.path})`
      );
      await redo(data.after);
      return;
    }

    // Save history when not undoing/redoing
    try {
      functions.logger.log(`Saving new version of (${data.after.ref.path})`);
      await admin
        .firestore()
        .doc(`${getHistoryPathVersion(data.after)}/${context.timestamp}`)
        .set({
          data: data.before.data(),
          date: new Date(context.timestamp),
        });

      functions.logger.log("DONE");
    } catch (error) {
      functions.logger.error(
        `ERROR saving new version of (${data.after.ref.path})`,
        error
      );
      throw error;
    }

    // If can redo, delete saved histories after version checkpoint and delte transaction flags from
    if (canRedo(data.after)) {
      try {
        functions.logger.log(
          `Newer versions of (${data.after.ref.path}) will become unreachable, deleting them`
        );
        await deleteVersions(data.after, data.before.get(versionField), ">");
        await cleanFlags(data.after, [versionField]);
        functions.logger.log("DONE");
      } catch (error) {
        functions.logger.error(
          `ERROR deleting unreachable versions of (${data.after.ref.path})`,
          error
        );
        throw error;
      }
    }
  });
