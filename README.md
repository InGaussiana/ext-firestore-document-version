# Firestore Document Versioning

**Author**: Gaussiana 

**Description**: Creates firestore documents versions on document writes. Supporting soft delete and recover



**Details**: Use this extension to save history of changes in all the documents on a collection

# Billing

This extension uses other Firebase or Google Cloud Platform services which may have associated charges:

- Cloud Functions

When you use Firebase Extensions, you're only charged for the underlying resources that you use. A paid-tier billing plan is only required if the extension uses a service that requires a paid-tier plan, for example calling to a Google Cloud Platform API or making outbound network requests to non-Google services. All Firebase services offer a free tier of usage. [Learn more about Firebase billing.](https://firebase.google.com/pricing)




**Configuration Parameters:**

* Collection path: Collection path to versionate

* History collection path: Collection path where to save history data

* Enable restore operation: Enable keep track of deleted documents and its versions (like a soft delete). Giving the possibility to restore deleted documents

* Ignore fields: Comma separated fields that won't trigger a new history version (nor will be saved on the version data). Nested fields are supported with parent.child syntax.

* Restore field name: Field used for restore document operation.  This must be the only field in the document's update, in order to restore the document wanted.

* Goto field name: Field used for goto version operation. This must be the only field in the document's update, in order to goto the version wanted.

* Undo field name: Field used for undo version operation. This must be the only field in the document's update, in order to undo the change.

* Redo field name: Field used for redo version operation. This must be the only field in the document's update, in order to redo the change.

* Actual version field name: Field used to keep track in which version the document is. This must not be changed manually, ever!.



**Cloud Functions:**

* **manageDocumentVersions:** Firestore-OnWrite-triggered function that creates the versions of documents
