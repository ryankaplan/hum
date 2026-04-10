import type { HumDocument } from "./model";
import {
  clearDraftFromIndexedDb,
  InvalidSavedDraftError,
  deleteMediaAssetFromIndexedDb,
  loadDraftFromIndexedDb,
  saveDraftDocumentToIndexedDb,
  saveMediaAssetToIndexedDb,
} from "./draftPersistence";
import {
  SAVED_HUM_DOCUMENT_ID,
  type SavedHumDocument,
} from "./savedDocumentSchema";
import {
} from "./recordingProgress";
import { deserializeHumDocument, serializeHumDocument } from "./serialization";

type DraftSnapshot = {
  document: HumDocument;
};

type RestoreDraftInput = {
  document: HumDocument;
  mediaAssets: Array<{ mediaAssetId: string; blob: Blob }>;
};

type DraftSessionControllerOptions = {
  getSnapshot: () => DraftSnapshot;
  applyRestoredDraft: (input: RestoreDraftInput) => void;
  onBootstrapped: () => void;
  onHasDraftChange: (hasDraft: boolean) => void;
};

export class DraftSessionController {
  private static readonly SAVE_DEBOUNCE_MS = 150;

  private ready = false;
  private suppressed = false;
  private pendingSaveTimer: number | null = null;
  private documentWriteInFlight = false;
  private queuedDocumentSave = false;
  private persistenceChain: Promise<void> = Promise.resolve();
  private pendingAssetSaves = new Map<string, Promise<void>>();
  private pendingAssetDeletes = new Set<string>();

  constructor(private options: DraftSessionControllerOptions) {
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handleLifecycleFlush);
    }
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  async restoreOnBoot(): Promise<RestoreDraftInput | null> {
    try {
      const loaded = await loadDraftFromIndexedDb();
      if (loaded == null) {
        return null;
      }

      const restored = deserializeHumDocument(loaded.savedDocument);
      const result: RestoreDraftInput = {
        document: restored.document,
        mediaAssets: loaded.mediaAssets.map((asset) => ({
          mediaAssetId: asset.mediaAssetId,
          blob: asset.blob,
        })),
      };
      await this.runWithoutPersistence(async () => {
        this.options.applyRestoredDraft(result);
      });
      this.options.onHasDraftChange(true);
      return result;
    } catch (error) {
      if (isRecoverableDraftRestoreError(error)) {
        if (error instanceof InvalidSavedDraftError) {
          console.warn("Discarding incompatible saved draft", error.message);
        } else {
          console.warn("Discarding unreadable saved draft.");
        }
      } else {
        console.error("Failed to restore saved draft", error);
      }
      await clearDraftFromIndexedDb().catch(() => undefined);
      this.options.onHasDraftChange(false);
      return null;
    } finally {
      this.ready = true;
      this.options.onBootstrapped();
    }
  }

  handleStateChanged(): void {
    if (!this.ready || this.suppressed) return;
    this.scheduleDocumentSave();
  }

  async persistMediaAsset(mediaAssetId: string, blob: Blob): Promise<void> {
    this.pendingAssetDeletes.delete(mediaAssetId);
    const task = this.enqueuePersistence(async () => {
      await saveMediaAssetToIndexedDb({
        mediaAssetId,
        blob,
        mimeType: blob.type,
        documentId: SAVED_HUM_DOCUMENT_ID,
      });
    });
    this.pendingAssetSaves.set(mediaAssetId, task);

    try {
      await task;
    } catch (error) {
      console.error("Failed to persist media asset", error);
    } finally {
      if (this.pendingAssetSaves.get(mediaAssetId) === task) {
        this.pendingAssetSaves.delete(mediaAssetId);
      }
    }
  }

  async deleteMediaAsset(mediaAssetId: string): Promise<void> {
    this.pendingAssetDeletes.add(mediaAssetId);
    this.scheduleDocumentSave();
  }

  clearDraftAfter(runReset: () => void): void {
    this.cancelScheduledSave();
    this.queuedDocumentSave = false;
    this.suppressed = true;
    try {
      runReset();
    } finally {
      void this.clearDraft().finally(() => {
        this.suppressed = false;
      });
    }
  }

  private scheduleDocumentSave(): void {
    if (!this.ready || this.suppressed) return;
    this.queuedDocumentSave = true;
    this.cancelScheduledSave();
    this.pendingSaveTimer = window.setTimeout(() => {
      this.pendingSaveTimer = null;
      void this.flushDocumentSave();
    }, DraftSessionController.SAVE_DEBOUNCE_MS);
  }

  private cancelScheduledSave(): void {
    if (this.pendingSaveTimer != null) {
      window.clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }
  }

  private async flushDocumentSave(): Promise<void> {
    if (!this.ready || this.suppressed || !this.queuedDocumentSave) return;
    if (this.documentWriteInFlight) return;

    this.documentWriteInFlight = true;
    this.queuedDocumentSave = false;
    const savedDocument = serializeHumDocument(this.options.getSnapshot());

    try {
      await this.enqueuePersistence(async () => {
        await saveDraftDocumentToIndexedDb(savedDocument);
        await this.deleteUnreferencedPendingAssets(savedDocument);
      });
      this.options.onHasDraftChange(true);
    } catch (error) {
      console.error("Failed to persist draft document", error);
    } finally {
      this.documentWriteInFlight = false;
      if (this.queuedDocumentSave && !this.suppressed) {
        void this.flushDocumentSave();
      }
    }
  }

  private async clearDraft(): Promise<void> {
    this.pendingAssetDeletes.clear();
    try {
      await this.enqueuePersistence(async () => {
        await clearDraftFromIndexedDb();
      });
      this.options.onHasDraftChange(false);
    } catch (error) {
      console.error("Failed to clear persisted draft", error);
    }
  }

  private async runWithoutPersistence<T>(fn: () => Promise<T> | T): Promise<T> {
    this.suppressed = true;
    try {
      return await fn();
    } finally {
      this.suppressed = false;
    }
  }

  private readonly handleLifecycleFlush = () => {
    this.flushPendingWork();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.flushPendingWork();
    }
  };

  private flushPendingWork(): void {
    if (!this.queuedDocumentSave) return;
    this.cancelScheduledSave();
    void this.flushDocumentSave();
  }

  private enqueuePersistence(task: () => Promise<void>): Promise<void> {
    const next = this.persistenceChain.then(task, task);
    this.persistenceChain = next.catch(() => undefined);
    return next;
  }

  private async deleteUnreferencedPendingAssets(
    savedDocument: SavedHumDocument,
  ): Promise<void> {
    if (this.pendingAssetDeletes.size === 0) return;

    const referencedMediaAssetIds = new Set(
      Object.values(savedDocument.tracks.recordingsById).map(
        (recording) => recording.mediaAssetId,
      ),
    );
    const assetIdsToDelete = Array.from(this.pendingAssetDeletes).filter(
      (mediaAssetId) =>
        !referencedMediaAssetIds.has(mediaAssetId) &&
        !this.pendingAssetSaves.has(mediaAssetId),
    );

    for (const mediaAssetId of assetIdsToDelete) {
      try {
        await deleteMediaAssetFromIndexedDb(mediaAssetId);
        this.pendingAssetDeletes.delete(mediaAssetId);
      } catch (error) {
        console.error("Failed to delete persisted media asset", error);
      }
    }
  }
}

function isRecoverableDraftRestoreError(error: unknown): boolean {
  if (error instanceof InvalidSavedDraftError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message === "Saved draft document is invalid" ||
    error.message === "Saved draft is missing referenced media assets"
  );
}
