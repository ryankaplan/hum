import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HumDocument } from "../src/state/model";

const persistenceMocks = vi.hoisted(() => ({
  InvalidSavedDraftError: class InvalidSavedDraftError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "InvalidSavedDraftError";
    }
  },
  clearDraftFromIndexedDb: vi.fn<() => Promise<void>>(),
  deleteMediaAssetFromIndexedDb: vi.fn<(mediaAssetId: string) => Promise<void>>(),
  loadDraftFromIndexedDb: vi.fn<() => Promise<null>>(),
  saveDraftDocumentToIndexedDb: vi.fn<(savedDocument: unknown) => Promise<void>>(),
  saveMediaAssetToIndexedDb: vi.fn<(asset: unknown) => Promise<void>>(),
}));

vi.mock("../src/state/draftPersistence", () => persistenceMocks);

import { DraftSessionController } from "../src/state/draftSessionController";

type Listener = () => void;

function makeDocument(
  mediaAssetIds: string[] = [],
): HumDocument {
  const trackOrder = mediaAssetIds.length > 0 ? ["track-1"] : [];
  const tracksById =
    mediaAssetIds.length > 0
      ? {
          "track-1": {
            id: "track-1",
            role: "melody" as const,
            clipIds: mediaAssetIds.map((_, index) => `clip-${index + 1}`),
            volume: 1,
            muted: false,
          },
        }
      : {};
  const clipsById = Object.fromEntries(
    mediaAssetIds.map((mediaAssetId, index) => [
      `clip-${index + 1}`,
      {
        id: `clip-${index + 1}`,
        trackId: "track-1",
        recordingId: `recording-${index + 1}`,
        timelineStartSec: 0,
        sourceStartSec: 0,
        durationSec: 1,
        volumeEnvelope: { points: [] },
        volumeEnvelopeRevision: 0,
      },
    ]),
  );
  const recordingsById = Object.fromEntries(
    mediaAssetIds.map((mediaAssetId, index) => [
      `recording-${index + 1}`,
      {
        id: `recording-${index + 1}`,
        trackId: "track-1",
        mediaAssetId,
      },
    ]),
  );

  return {
    arrangement: {
      chordsInput: "C F G",
      tempo: 90,
      meter: [4, 4],
      vocalRangeLow: "C3",
      vocalRangeHigh: "A4",
      harmonyRangeCoverage: "lower two thirds",
      harmonyPriority: "voiceLeading",
      totalParts: 3,
      customArrangement: null,
    },
    tracks: {
      trackOrder,
      tracksById,
      clipsById,
      recordingsById,
      referenceWaveformTrackId: null,
      reverbWet: 0.2,
    },
    exportPreferences: {
      preferredFormat: null,
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

function makeController(
  getDocument: () => HumDocument,
  listeners: {
    windowListeners: Record<string, Listener>;
    documentListeners: Record<string, Listener>;
  },
) {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.windowListeners[type] = listener;
    }),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.documentListeners[type] = listener;
    }),
    removeEventListener: vi.fn(),
  });

  return new DraftSessionController({
    getSnapshot: () => ({
      document: getDocument(),
    }),
    applyRestoredDraft: vi.fn(),
    onBootstrapped: vi.fn(),
    onHasDraftChange: vi.fn(),
  });
}

describe("DraftSessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    persistenceMocks.clearDraftFromIndexedDb.mockResolvedValue();
    persistenceMocks.deleteMediaAssetFromIndexedDb.mockResolvedValue();
    persistenceMocks.loadDraftFromIndexedDb.mockResolvedValue(null);
    persistenceMocks.saveDraftDocumentToIndexedDb.mockResolvedValue();
    persistenceMocks.saveMediaAssetToIndexedDb.mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for media assets to finish persisting before saving the draft document", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    let currentDocument = makeDocument(["asset-1"]);
    const order: string[] = [];
    let resolveAssetSave: (() => void) | null = null;

    persistenceMocks.saveMediaAssetToIndexedDb.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAssetSave = () => {
            order.push("asset");
            resolve();
          };
        }),
    );
    persistenceMocks.saveDraftDocumentToIndexedDb.mockImplementation(async () => {
      order.push("document");
    });

    const controller = makeController(() => currentDocument, listeners);
    await controller.restoreOnBoot();

    const persistPromise = controller.persistMediaAsset(
      "asset-1",
      new Blob(["test"], { type: "video/webm" }),
    );
    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);

    expect(persistenceMocks.saveDraftDocumentToIndexedDb).not.toHaveBeenCalled();

    resolveAssetSave?.();
    await persistPromise;
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(order).toEqual(["asset", "document"]);
    currentDocument = makeDocument(["asset-1"]);
  });

  it("deletes unreferenced media assets only after the draft document is persisted", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    const order: string[] = [];
    const controller = makeController(() => makeDocument(), listeners);

    persistenceMocks.saveDraftDocumentToIndexedDb.mockImplementation(async () => {
      order.push("document");
    });
    persistenceMocks.deleteMediaAssetFromIndexedDb.mockImplementation(
      async (mediaAssetId) => {
        order.push(`delete:${mediaAssetId}`);
      },
    );

    await controller.restoreOnBoot();
    await controller.deleteMediaAsset("asset-old");
    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(order).toEqual(["document", "delete:asset-old"]);
  });

  it("does not delete blobs from a newer state until that newer document snapshot is saved", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    let currentDocument = makeDocument(["asset-old"]);
    const order: string[] = [];
    let saveCallCount = 0;
    let resolveFirstSave: (() => void) | null = null;
    let resolveSecondSave: (() => void) | null = null;

    persistenceMocks.saveDraftDocumentToIndexedDb.mockImplementation(() => {
      saveCallCount += 1;
      if (saveCallCount === 1) {
        return new Promise<void>((resolve) => {
          resolveFirstSave = () => {
            order.push("document:1");
            resolve();
          };
        });
      }

      return new Promise<void>((resolve) => {
        resolveSecondSave = () => {
          order.push("document:2");
          resolve();
        };
      });
    });
    persistenceMocks.deleteMediaAssetFromIndexedDb.mockImplementation(
      async (mediaAssetId) => {
        order.push(`delete:${mediaAssetId}`);
      },
    );

    const controller = makeController(() => currentDocument, listeners);
    await controller.restoreOnBoot();

    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);

    currentDocument = makeDocument();
    await controller.deleteMediaAsset("asset-old");
    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);

    resolveFirstSave?.();
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(order).toEqual(["document:1"]);

    resolveSecondSave?.();
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(order).toEqual(["document:1", "document:2", "delete:asset-old"]);
  });

  it("flushes queued autosaves immediately when the page is being hidden", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    const controller = makeController(() => makeDocument(), listeners);

    await controller.restoreOnBoot();
    controller.handleStateChanged();

    expect(persistenceMocks.saveDraftDocumentToIndexedDb).not.toHaveBeenCalled();

    listeners.windowListeners.pagehide?.();
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(persistenceMocks.saveDraftDocumentToIndexedDb).toHaveBeenCalledTimes(1);
  });

  it("clears persisted drafts after any in-flight document save finishes", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    const order: string[] = [];
    let resolveDocumentSave: (() => void) | null = null;

    persistenceMocks.saveDraftDocumentToIndexedDb.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDocumentSave = () => {
            order.push("document");
            resolve();
          };
        }),
    );
    persistenceMocks.clearDraftFromIndexedDb.mockImplementation(async () => {
      order.push("clear");
    });

    const controller = makeController(() => makeDocument(), listeners);
    await controller.restoreOnBoot();

    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);
    controller.clearDraftAfter(() => undefined);

    resolveDocumentSave?.();
    for (let i = 0; i < 8; i++) {
      await flushMicrotasks();
    }

    expect(order).toEqual(["document", "clear"]);
    expect(persistenceMocks.saveDraftDocumentToIndexedDb).toHaveBeenCalledTimes(1);
  });

  it("continues clearing and later autosaving even if reset work throws", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    const controller = makeController(() => makeDocument(), listeners);

    await controller.restoreOnBoot();

    expect(() =>
      controller.clearDraftAfter(() => {
        throw new Error("reset failed");
      }),
    ).toThrow("reset failed");

    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(persistenceMocks.clearDraftFromIndexedDb).toHaveBeenCalledTimes(1);

    controller.handleStateChanged();
    await vi.advanceTimersByTimeAsync(150);
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
    }

    expect(persistenceMocks.saveDraftDocumentToIndexedDb).toHaveBeenCalledTimes(1);
  });

  it("silently discards unreadable saved drafts and clears persistence", async () => {
    const listeners = { windowListeners: {}, documentListeners: {} } as {
      windowListeners: Record<string, Listener>;
      documentListeners: Record<string, Listener>;
    };
    const controller = makeController(() => makeDocument(), listeners);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    persistenceMocks.loadDraftFromIndexedDb.mockRejectedValue(
      new Error("Saved draft document is invalid"),
    );

    await expect(controller.restoreOnBoot()).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalledWith("Discarding unreadable saved draft.");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(persistenceMocks.clearDraftFromIndexedDb).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
