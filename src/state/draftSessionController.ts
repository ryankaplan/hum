import type { PartIndex } from "../music/types";
import type { AppScreen, HumDocument } from "./model";
import {
  clearDraftFromIndexedDb,
  deleteMediaAssetFromIndexedDb,
  loadDraftFromIndexedDb,
  saveDraftDocumentToIndexedDb,
  saveMediaAssetToIndexedDb,
} from "./draftPersistence";
import { SAVED_HUM_DOCUMENT_ID } from "./savedDocumentSchema";
import { deserializeHumDocument, serializeHumDocument } from "./serialization";

type DraftSnapshot = {
  document: HumDocument;
  currentPartIndex: number;
  appScreen: AppScreen;
  latencyCorrectionSec: number;
  isCalibrated: boolean;
};

type RestoreDraftInput = {
  document: HumDocument;
  currentPartIndex: PartIndex;
  appScreen: AppScreen;
  latencyCorrectionSec: number;
  isCalibrated: boolean;
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

  constructor(private options: DraftSessionControllerOptions) {}

  async restoreOnBoot(): Promise<RestoreDraftInput | null> {
    try {
      const loaded = await loadDraftFromIndexedDb();
      if (loaded == null) {
        return null;
      }

      const restored = deserializeHumDocument(loaded.savedDocument);
      const currentPartIndex = resolveRestoredCurrentPartIndex(
        restored.currentPartIndex,
        restored.document,
      );
      const appScreen = resolveRestoredScreen(
        restored.appScreen,
        restored.document,
      );
      const result: RestoreDraftInput = {
        document: restored.document,
        currentPartIndex,
        appScreen,
        latencyCorrectionSec: restored.latencyCorrectionSec,
        isCalibrated: restored.isCalibrated,
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
      console.error("Failed to restore saved draft", error);
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
    try {
      await saveMediaAssetToIndexedDb({
        mediaAssetId,
        blob,
        mimeType: blob.type,
        documentId: SAVED_HUM_DOCUMENT_ID,
      });
    } catch (error) {
      console.error("Failed to persist media asset", error);
    }
  }

  async deleteMediaAsset(mediaAssetId: string): Promise<void> {
    try {
      await deleteMediaAssetFromIndexedDb(mediaAssetId);
    } catch (error) {
      console.error("Failed to delete persisted media asset", error);
    }
  }

  clearDraftAfter(runReset: () => void): void {
    this.cancelScheduledSave();
    this.suppressed = true;
    runReset();
    void this.clearDraft().finally(() => {
      this.suppressed = false;
    });
  }

  private scheduleDocumentSave(): void {
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
      await saveDraftDocumentToIndexedDb(savedDocument);
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
    try {
      await clearDraftFromIndexedDb();
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
}

function resolveRestoredCurrentPartIndex(
  preferredIndex: number,
  document: HumDocument,
): PartIndex {
  const maxIndex = Math.max(0, document.tracks.trackOrder.length - 1);
  const clamped = Math.min(maxIndex, Math.max(0, Math.floor(preferredIndex)));
  const preferredTrackId = document.tracks.trackOrder[clamped] ?? null;
  if (
    preferredTrackId != null &&
    getPrimaryRecordingId(document, preferredTrackId) == null
  ) {
    return clamped as PartIndex;
  }

  const firstIncompleteIndex = document.tracks.trackOrder.findIndex(
    (trackId) => {
      return getPrimaryRecordingId(document, trackId) == null;
    },
  );
  if (firstIncompleteIndex >= 0) {
    return firstIncompleteIndex as PartIndex;
  }

  return 0;
}

function resolveRestoredScreen(
  preferredScreen: AppScreen,
  document: HumDocument,
): AppScreen {
  if (preferredScreen === "review" && hasAnyTake(document)) {
    return "review";
  }
  return preferredScreen;
}

function hasAnyTake(document: HumDocument): boolean {
  return Object.keys(document.tracks.recordingsById).length > 0;
}

function getPrimaryRecordingId(
  document: HumDocument,
  trackId: string,
): string | null {
  const track = document.tracks.tracksById[trackId];
  if (track == null) return null;
  const clipId = track.clipIds[0] ?? null;
  if (clipId == null) return null;
  const clip = document.tracks.clipsById[clipId];
  return clip?.recordingId ?? null;
}
