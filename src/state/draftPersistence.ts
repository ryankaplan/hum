import {
  parseSavedHumDocument,
  SAVED_HUM_DOCUMENT_ID,
  type SavedHumDocument,
  type SavedMediaAsset,
} from "./savedDocumentSchema";

const DB_NAME = "humDrafts";
const DB_VERSION = 1;
const DOCUMENTS_STORE = "documents";
const MEDIA_ASSETS_STORE = "mediaAssets";

export type LoadedDraft = {
  savedDocument: SavedHumDocument;
  mediaAssets: SavedMediaAsset[];
};

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MEDIA_ASSETS_STORE)) {
        const store = db.createObjectStore(MEDIA_ASSETS_STORE, {
          keyPath: "mediaAssetId",
        });
        store.createIndex("documentId", "documentId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  return await new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function withDatabase<T>(
  run: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

export async function loadDraftFromIndexedDb(): Promise<LoadedDraft | null> {
  return await withDatabase(async (db) => {
    const tx = db.transaction(
      [DOCUMENTS_STORE, MEDIA_ASSETS_STORE],
      "readonly",
    );
    const documents = tx.objectStore(DOCUMENTS_STORE);
    const mediaAssets = tx.objectStore(MEDIA_ASSETS_STORE);

    const rawDocument = await requestToPromise(
      documents.get(SAVED_HUM_DOCUMENT_ID),
    );
    if (rawDocument == null) {
      await transactionDone(tx);
      return null;
    }
    const savedDocument = parseSavedHumDocument(rawDocument);
    if (savedDocument == null) {
      throw new Error("Saved draft document is invalid");
    }

    const index = mediaAssets.index("documentId");
    const rawAssets = (await requestToPromise(
      index.getAll(savedDocument.id),
    )) as SavedMediaAsset[];
    await transactionDone(tx);

    const mediaAssetIds = new Set(
      Object.values(savedDocument.tracks.recordingsById).map(
        (recording) => recording.mediaAssetId,
      ),
    );
    const filtered = rawAssets.filter((asset) =>
      mediaAssetIds.has(asset.mediaAssetId),
    );
    if (filtered.length !== mediaAssetIds.size) {
      throw new Error("Saved draft is missing referenced media assets");
    }

    return {
      savedDocument,
      mediaAssets: filtered,
    };
  });
}

export async function saveDraftDocumentToIndexedDb(
  savedDocument: SavedHumDocument,
): Promise<void> {
  await withDatabase(async (db) => {
    const tx = db.transaction([DOCUMENTS_STORE], "readwrite");
    tx.objectStore(DOCUMENTS_STORE).put(savedDocument);
    await transactionDone(tx);
  });
}

export async function saveMediaAssetToIndexedDb(
  asset: SavedMediaAsset,
): Promise<void> {
  await withDatabase(async (db) => {
    const tx = db.transaction([MEDIA_ASSETS_STORE], "readwrite");
    tx.objectStore(MEDIA_ASSETS_STORE).put(asset);
    await transactionDone(tx);
  });
}

export async function deleteMediaAssetFromIndexedDb(
  mediaAssetId: string,
): Promise<void> {
  await withDatabase(async (db) => {
    const tx = db.transaction([MEDIA_ASSETS_STORE], "readwrite");
    tx.objectStore(MEDIA_ASSETS_STORE).delete(mediaAssetId);
    await transactionDone(tx);
  });
}

export async function clearDraftFromIndexedDb(): Promise<void> {
  await withDatabase(async (db) => {
    const tx = db.transaction(
      [DOCUMENTS_STORE, MEDIA_ASSETS_STORE],
      "readwrite",
    );
    tx.objectStore(DOCUMENTS_STORE).delete(SAVED_HUM_DOCUMENT_ID);
    const mediaStore = tx.objectStore(MEDIA_ASSETS_STORE);
    const index = mediaStore.index("documentId");
    const keys = await requestToPromise(
      index.getAllKeys(SAVED_HUM_DOCUMENT_ID),
    );
    for (const key of keys) {
      mediaStore.delete(key);
    }
    await transactionDone(tx);
  });
}
