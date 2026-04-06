import { getOldPersistedObservableValue } from "../observable";
import { createDefaultArrangementDocState, parseArrangementDocState } from "./arrangementModel";
import { createShortUuid } from "./id";
import type { HumDocument, MediaAssetId } from "./model";
import { createDefaultHumDocument } from "./model";

const DB_NAME = "hum_projects";
const DB_VERSION = 1;

const PROJECT_METADATA_STORE = "project_metadata";
const PROJECT_DATA_STORE = "project_data";
const BLOBS_STORE = "blobs";

const BLOBS_BY_PROJECT_INDEX = "by_projectId";
const PROJECT_METADATA_BY_UPDATED_INDEX = "by_updatedAt";
const PROJECT_METADATA_BY_LAST_OPENED_INDEX = "by_lastOpenedAt";

export type ProjectId = string;

export type ProjectMetadataRecord = {
  projectId: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};

type ProjectDataRecord = {
  projectId: ProjectId;
  schemaVersion: 1;
  document: HumDocument;
};

type BlobRecord = {
  mediaAssetId: MediaAssetId;
  projectId: ProjectId;
  mimeType: string;
  createdAt: number;
  blob: Blob;
};

export type LoadedProjectSnapshot = {
  metadata: ProjectMetadataRecord;
  document: HumDocument;
  mediaAssets: Map<MediaAssetId, Blob>;
};

type CreateProjectInput = {
  document?: HumDocument;
  name?: string;
};

type SaveProjectInput = {
  projectId: ProjectId;
  document: HumDocument;
  metadataPatch?: Partial<Pick<ProjectMetadataRecord, "name" | "updatedAt" | "lastOpenedAt">>;
  mediaAssets: Map<MediaAssetId, Blob>;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createProjectId(): ProjectId {
  return `project-${createShortUuid()}`;
}

function createMediaAssetId(): MediaAssetId {
  return `media-asset-${createShortUuid()}`;
}

function createDefaultProjectName(): string {
  return "Untitled Project";
}

function sortProjects(records: ProjectMetadataRecord[]): ProjectMetadataRecord[] {
  return [...records].sort((left, right) => {
    if (right.lastOpenedAt !== left.lastOpenedAt) {
      return right.lastOpenedAt - left.lastOpenedAt;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      const metadataStore = db.objectStoreNames.contains(PROJECT_METADATA_STORE)
        ? request.transaction!.objectStore(PROJECT_METADATA_STORE)
        : db.createObjectStore(PROJECT_METADATA_STORE, { keyPath: "projectId" });
      if (!metadataStore.indexNames.contains(PROJECT_METADATA_BY_UPDATED_INDEX)) {
        metadataStore.createIndex(PROJECT_METADATA_BY_UPDATED_INDEX, "updatedAt");
      }
      if (!metadataStore.indexNames.contains(PROJECT_METADATA_BY_LAST_OPENED_INDEX)) {
        metadataStore.createIndex(PROJECT_METADATA_BY_LAST_OPENED_INDEX, "lastOpenedAt");
      }

      if (!db.objectStoreNames.contains(PROJECT_DATA_STORE)) {
        db.createObjectStore(PROJECT_DATA_STORE, { keyPath: "projectId" });
      }

      const blobsStore = db.objectStoreNames.contains(BLOBS_STORE)
        ? request.transaction!.objectStore(BLOBS_STORE)
        : db.createObjectStore(BLOBS_STORE, { keyPath: "mediaAssetId" });
      if (!blobsStore.indexNames.contains(BLOBS_BY_PROJECT_INDEX)) {
        blobsStore.createIndex(BLOBS_BY_PROJECT_INDEX, "projectId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB database."));
  });
}

function buildMediaAssetMap(blobRecords: BlobRecord[]): Map<MediaAssetId, Blob> {
  const mediaAssets = new Map<MediaAssetId, Blob>();
  for (const record of blobRecords) {
    mediaAssets.set(record.mediaAssetId, record.blob);
  }
  return mediaAssets;
}

async function getBlobRecordsForProject(
  store: IDBObjectStore,
  projectId: ProjectId,
): Promise<BlobRecord[]> {
  const index = store.index(BLOBS_BY_PROJECT_INDEX);
  return requestToPromise(index.getAll(projectId));
}

function getReferencedMediaAssetIds(document: HumDocument): Set<MediaAssetId> {
  return new Set(
    Object.values(document.tracks.recordingsById).map(
      (recording) => recording.mediaAssetId,
    ),
  );
}

export class ProjectRepository {
  async listProjects(): Promise<ProjectMetadataRecord[]> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(PROJECT_METADATA_STORE, "readonly");
      const metadata = await requestToPromise(
        tx.objectStore(PROJECT_METADATA_STORE).getAll(),
      );
      await transactionToPromise(tx);
      return sortProjects(metadata);
    } finally {
      db.close();
    }
  }

  async createProject(input: CreateProjectInput = {}): Promise<LoadedProjectSnapshot> {
    const projectId = createProjectId();
    const now = Date.now();
    const metadata: ProjectMetadataRecord = {
      projectId,
      name: input.name?.trim() || createDefaultProjectName(),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    const document = cloneDocument(
      input.document ?? createDefaultHumDocument(),
    );
    const data: ProjectDataRecord = {
      projectId,
      schemaVersion: 1,
      document,
    };

    const db = await openDatabase();
    try {
      const tx = db.transaction(
        [PROJECT_METADATA_STORE, PROJECT_DATA_STORE],
        "readwrite",
      );
      tx.objectStore(PROJECT_METADATA_STORE).put(metadata);
      tx.objectStore(PROJECT_DATA_STORE).put(data);
      await transactionToPromise(tx);
      return {
        metadata,
        document,
        mediaAssets: new Map(),
      };
    } finally {
      db.close();
    }
  }

  async loadProject(projectId: ProjectId): Promise<LoadedProjectSnapshot | null> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(
        [PROJECT_METADATA_STORE, PROJECT_DATA_STORE, BLOBS_STORE],
        "readonly",
      );
      const metadataStore = tx.objectStore(PROJECT_METADATA_STORE);
      const dataStore = tx.objectStore(PROJECT_DATA_STORE);
      const blobsStore = tx.objectStore(BLOBS_STORE);

      const metadata = await requestToPromise(
        metadataStore.get(projectId),
      );
      const data = await requestToPromise(dataStore.get(projectId));
      if (metadata == null || data == null) {
        tx.abort();
        return null;
      }

      const blobRecords = await getBlobRecordsForProject(blobsStore, projectId);
      await transactionToPromise(tx);

      return {
        metadata,
        document: cloneDocument(data.document),
        mediaAssets: buildMediaAssetMap(blobRecords),
      };
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return null;
      }
      throw error;
    } finally {
      db.close();
    }
  }

  async saveProject(input: SaveProjectInput): Promise<void> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(
        [PROJECT_METADATA_STORE, PROJECT_DATA_STORE, BLOBS_STORE],
        "readwrite",
      );
      const metadataStore = tx.objectStore(PROJECT_METADATA_STORE);
      const dataStore = tx.objectStore(PROJECT_DATA_STORE);
      const blobsStore = tx.objectStore(BLOBS_STORE);

      const existingMetadata = await requestToPromise(
        metadataStore.get(input.projectId),
      );
      if (existingMetadata == null) {
        throw new Error(`Project "${input.projectId}" does not exist.`);
      }

      const now = Date.now();
      const nextMetadata: ProjectMetadataRecord = {
        ...existingMetadata,
        ...input.metadataPatch,
        updatedAt: input.metadataPatch?.updatedAt ?? now,
      };
      const nextData: ProjectDataRecord = {
        projectId: input.projectId,
        schemaVersion: 1,
        document: cloneDocument(input.document),
      };

      const existingBlobRecords = await getBlobRecordsForProject(
        blobsStore,
        input.projectId,
      );
      const existingBlobIds = new Set(
        existingBlobRecords.map((record) => record.mediaAssetId),
      );
      const referencedBlobIds = getReferencedMediaAssetIds(input.document);

      metadataStore.put(nextMetadata);
      dataStore.put(nextData);

      for (const mediaAssetId of referencedBlobIds) {
        if (existingBlobIds.has(mediaAssetId)) {
          continue;
        }
        const blob = input.mediaAssets.get(mediaAssetId);
        if (blob == null) {
          throw new Error(
            `Missing blob "${mediaAssetId}" while saving project "${input.projectId}".`,
          );
        }
        const blobRecord: BlobRecord = {
          mediaAssetId,
          projectId: input.projectId,
          mimeType: blob.type,
          createdAt: now,
          blob,
        };
        blobsStore.put(blobRecord);
      }

      for (const mediaAssetId of existingBlobIds) {
        if (!referencedBlobIds.has(mediaAssetId)) {
          blobsStore.delete(mediaAssetId);
        }
      }

      await transactionToPromise(tx);
    } finally {
      db.close();
    }
  }

  async updateProjectMetadata(
    projectId: ProjectId,
    patch: Partial<Pick<ProjectMetadataRecord, "name" | "updatedAt" | "lastOpenedAt">>,
  ): Promise<ProjectMetadataRecord | null> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(PROJECT_METADATA_STORE, "readwrite");
      const store = tx.objectStore(PROJECT_METADATA_STORE);
      const current = await requestToPromise(store.get(projectId));
      if (current == null) {
        tx.abort();
        return null;
      }

      const next: ProjectMetadataRecord = {
        ...current,
        ...patch,
        updatedAt: patch.updatedAt ?? current.updatedAt,
      };
      store.put(next);
      await transactionToPromise(tx);
      return next;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return null;
      }
      throw error;
    } finally {
      db.close();
    }
  }

  async duplicateProject(projectId: ProjectId): Promise<LoadedProjectSnapshot> {
    const source = await this.loadProject(projectId);
    if (source == null) {
      throw new Error(`Cannot duplicate missing project "${projectId}".`);
    }

    const nextProjectId = createProjectId();
    const now = Date.now();
    const nextDocument = cloneDocument(source.document);
    const mediaAssetIdMap = new Map<MediaAssetId, MediaAssetId>();
    const nextMediaAssets = new Map<MediaAssetId, Blob>();

    for (const [oldMediaAssetId, blob] of source.mediaAssets.entries()) {
      const nextMediaAssetId = createMediaAssetId();
      mediaAssetIdMap.set(oldMediaAssetId, nextMediaAssetId);
      nextMediaAssets.set(nextMediaAssetId, blob);
    }

    for (const recording of Object.values(nextDocument.tracks.recordingsById)) {
      const nextMediaAssetId = mediaAssetIdMap.get(recording.mediaAssetId);
      if (nextMediaAssetId != null) {
        recording.mediaAssetId = nextMediaAssetId;
      }
    }

    const metadata: ProjectMetadataRecord = {
      projectId: nextProjectId,
      name: `Copy of ${source.metadata.name}`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    const data: ProjectDataRecord = {
      projectId: nextProjectId,
      schemaVersion: 1,
      document: nextDocument,
    };

    const db = await openDatabase();
    try {
      const tx = db.transaction(
        [PROJECT_METADATA_STORE, PROJECT_DATA_STORE, BLOBS_STORE],
        "readwrite",
      );
      tx.objectStore(PROJECT_METADATA_STORE).put(metadata);
      tx.objectStore(PROJECT_DATA_STORE).put(data);

      for (const [mediaAssetId, blob] of nextMediaAssets.entries()) {
        const blobRecord: BlobRecord = {
          mediaAssetId,
          projectId: nextProjectId,
          mimeType: blob.type,
          createdAt: now,
          blob,
        };
        tx.objectStore(BLOBS_STORE).put(blobRecord);
      }

      await transactionToPromise(tx);
      return {
        metadata,
        document: cloneDocument(nextDocument),
        mediaAssets: nextMediaAssets,
      };
    } finally {
      db.close();
    }
  }

  async deleteProject(projectId: ProjectId): Promise<void> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(
        [PROJECT_METADATA_STORE, PROJECT_DATA_STORE, BLOBS_STORE],
        "readwrite",
      );
      const blobsStore = tx.objectStore(BLOBS_STORE);
      const existingBlobRecords = await getBlobRecordsForProject(blobsStore, projectId);

      tx.objectStore(PROJECT_METADATA_STORE).delete(projectId);
      tx.objectStore(PROJECT_DATA_STORE).delete(projectId);
      for (const record of existingBlobRecords) {
        blobsStore.delete(record.mediaAssetId);
      }

      await transactionToPromise(tx);
    } finally {
      db.close();
    }
  }

  async bootstrapLegacyProjectIfNeeded(): Promise<LoadedProjectSnapshot | null> {
    const existingProjects = await this.listProjects();
    if (existingProjects.length > 0) {
      return null;
    }

    const legacyArrangementRaw = getOldPersistedObservableValue("hum.arrangementDoc");
    const legacyArrangement = legacyArrangementRaw == null
      ? createDefaultArrangementDocState()
      : parseArrangementDocState(legacyArrangementRaw);

    const document = createDefaultHumDocument(legacyArrangement);
    const created = await this.createProject({ document });
    localStorage.removeItem("hum.arrangementDoc");
    return created;
  }
}
