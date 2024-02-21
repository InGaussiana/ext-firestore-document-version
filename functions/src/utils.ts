import {
  DocumentData,
  DocumentSnapshot,
  FieldValue,
} from "firebase-admin/firestore";
import { config } from "./config";
import { logger } from "firebase-functions";

export function isRestoring(document: DocumentSnapshot) {
  return document.get(config.restoreField) !== undefined;
}

export function isUndoing(document: DocumentSnapshot) {
  return document.get(config.undoField) !== undefined;
}

export function isRedoing(document: DocumentSnapshot) {
  return document.get(config.redoField) !== undefined;
}

export function isGoingTo(document: DocumentSnapshot) {
  return document.get(config.gotoField) !== undefined;
}

export function canRedo(document: DocumentSnapshot) {
  return document.get(config.versionField) !== undefined;
}

export function isHistoryTransaction(document: DocumentSnapshot) {
  return (
    isUndoing(document) ||
    isRedoing(document) ||
    isGoingTo(document) ||
    isRestoring(document)
  );
}

export function getHistoryPath(document: DocumentSnapshot) {
  return `${config.historyPath}/${document.ref.path
    .split("/")
    .map((x, i) => (i % 2 != 0 ? x : `${x}_history`))
    .join("/")}`;
}

export function getHistoryPathVersion(document: DocumentSnapshot) {
  return `${getHistoryPath(document)}/versions_history`;
}

export async function cleanFlags(
  document: DocumentSnapshot,
  flags = [
    config.undoField,
    config.redoField,
    config.gotoField,
    config.restoreField,
    config.versionField,
  ]
) {
  try {
    logger.log(`Cleaning history change flags on (${document.ref.path})`);
    await document.ref.update(deletedHistoryFlags(flags));
    logger.log("CLEANING DONE");
  } catch (error) {
    logger.error(
      `ERROR cleaning history change flags on (${document.ref.path})`,
      error
    );
    throw error;
  }
}

export function deletedHistoryFlags(
  flags = [
    config.undoField,
    config.redoField,
    config.gotoField,
    config.restoreField,
    config.versionField,
  ],
  value = FieldValue.delete()
) {
  return Object.fromEntries(flags.map((flag) => [flag, value]));
}

export function documentChanged(
  before: DocumentSnapshot,
  after: DocumentSnapshot
) {
  const beforeData = getVersionedFields(before);
  const afterData = getVersionedFields(after);

  if (Object.entries(beforeData).length !== Object.entries(afterData).length) {
    return true;
  }

  for (const key of Object.keys(beforeData)) {
    // Need jsonstringfy to catch Firebase Timestamps equal operation
    if (JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])) {
      return true;
    }
  }

  return false;
}

export function getIgnoredFields(document: DocumentSnapshot) {
  const data: DocumentData = flattenObject(document.data());
  const toIgnore = config.ignoreFields.split(",").map((x) => x.trim());
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => toIgnore.includes(key))
  );
}

export function getVersionedFields(document: DocumentSnapshot) {
  const data: DocumentData = flattenObject(document.data());
  const toIgnore = config.ignoreFields.split(",").map((x) => x.trim());
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !toIgnore.includes(key))
  );
}

export const flattenObject = (obj?: DocumentData, parentKey = "") => {
  if (parentKey !== "") parentKey += ".";
  let flattened: DocumentData = {};
  Object.keys(obj ?? {}).forEach((key) => {
    if (
      typeof obj?.[key] === "object" &&
      obj[key] !== null &&
      !obj[key].toDate && // Avoid flattening Firebase Timestamps
      Object.prototype.toString.call(obj[key]) !== "[object Date]"
    ) {
      Object.assign(flattened, flattenObject(obj[key], parentKey + key));
    } else {
      flattened[parentKey + key] = obj?.[key];
    }
  });
  return flattened;
};

export function nestObject(document: DocumentData) {
  return Object.entries(flattenObject(document)).reduce(
    (acc, [path, value]) => (
      path
        .split(".")
        .reduce(
          (finalValue, subpath, i, pathArray) =>
            (finalValue[subpath] ??= i === pathArray.length - 1 ? value : {}),
          acc as DocumentData
        ),
      acc
    ),
    {}
  );
}
