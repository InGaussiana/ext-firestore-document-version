# See it in action

Update any document and see the document version being created saved inside "[HISTORY_COLLECTION]/[DOCUMENT_PATH]".

Note: To avoid conflicts on .collectionGroup() queries, this extension appends \_history to the end of all collection & subcollection names on [DOCUMENT_PATH].

### UNDO change:

```
document.ref.update({ [UNDO_FIELD]: true });
```

### REDO change:

```
document.ref.update({ [REDO_FIELD]: true });
```

### GOTO version:

```
document.ref.update({ [GOT_FIELD]: [VERSION_ID] });
```

### Restore deleted document:

Only works on document create

```
await setDoc(doc(firestore, collectionName, id), {
    [RESTORE_FIELD]: true
});
```

# Using the extension

To learn more about HTTP functions, visit the [functions documentation](https://firebase.google.com/docs/functions/http-events).

# Monitoring

As a best practice, you can [monitor the activity](https://firebase.google.com/docs/extensions/manage-installed-extensions#monitor) of your installed extension, including checks on its health, usage, and logs.
