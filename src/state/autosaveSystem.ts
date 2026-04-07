import type { ReadOnlyObservable } from "../observable";
import type { AppModel } from "./model";
import type { ProjectController } from "./projectController";
import type { ProjectRepository } from "./projectRepository";

const DEFAULT_AUTOSAVE_DELAY_MS = 250;

type SaveReason =
  | "debounced"
  | "project-switch"
  | "duplicate"
  | "delete"
  | "pagehide"
  | "manual";

export class AutosaveSystem {
  private paused = false;
  private dirty = false;
  private timer: number | null = null;
  private unsubscribes: Array<() => void> = [];
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly model: AppModel,
    private readonly repository: ProjectRepository,
    private readonly controller: ProjectController,
    private readonly delayMs = DEFAULT_AUTOSAVE_DELAY_MS,
  ) {}

  start(): void {
    if (this.unsubscribes.length > 0) {
      return;
    }

    this.register(this.model.arrangementDocument);
    this.register(this.model.tracksDocument.document);
    this.register(this.model.exportPreferences);

    const flushOnHide = () => {
      void this.flushNow("pagehide");
    };
    window.addEventListener("pagehide", flushOnHide);
    this.unsubscribes.push(() => {
      window.removeEventListener("pagehide", flushOnHide);
    });
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    this.paused = false;
  }

  clearDirty(): void {
    this.dirty = false;
    this.clearTimer();
  }

  async flushNow(reason: SaveReason = "manual"): Promise<void> {
    this.clearTimer();
    await this.enqueueFlush(reason);
  }

  dispose(): void {
    this.clearTimer();
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
  }

  private register(observable: ReadOnlyObservable<unknown>): void {
    const unsubscribe = observable.register(() => {
      this.markDirty();
    }) as () => void;
    this.unsubscribes.push(unsubscribe);
  }

  private markDirty(): void {
    if (this.paused) {
      return;
    }

    if (this.controller.currentProjectId.get() == null) {
      return;
    }

    this.dirty = true;
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      void this.enqueueFlush("debounced");
    }, this.delayMs);
  }

  private enqueueFlush(reason: SaveReason): Promise<void> {
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        if (this.paused || !this.dirty) {
          return;
        }

        const projectId = this.controller.currentProjectId.get();
        if (projectId == null) {
          return;
        }

        const snapshot = this.model.getHumDocument();
        const mediaAssets = this.model.getReferencedMediaAssets();

        this.dirty = false;

        try {
          await this.repository.saveProject({
            projectId,
            document: snapshot,
            metadataPatch: {
              updatedAt: Date.now(),
            },
            mediaAssets,
          });
          await this.controller.refreshProjects();
        } catch (error) {
          this.dirty = true;
          console.error(`Autosave failed during ${reason}`, error);
        }
      });

    return this.saveChain;
  }

  private clearTimer(): void {
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
