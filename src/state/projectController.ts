import { Observable, PersistedObservable } from "../observable";
import { createDefaultArrangementDocState } from "./arrangementModel";
import { AutosaveSystem } from "./autosaveSystem";
import { createDefaultHumDocument, model } from "./model";
import {
  type LoadedProjectSnapshot,
  type ProjectId,
  type ProjectMetadataRecord,
  ProjectRepository,
} from "./projectRepository";

function parseNullableString(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function pickFallbackProjectId(
  projects: ProjectMetadataRecord[],
  excludeProjectId?: ProjectId,
): ProjectId | null {
  for (const project of projects) {
    if (project.projectId !== excludeProjectId) {
      return project.projectId;
    }
  }
  return null;
}

export class ProjectController {
  private readonly repository = new ProjectRepository();
  readonly currentProjectId = new PersistedObservable<ProjectId | null>(
    "hum.currentProjectId",
    null,
    { schema: parseNullableString },
  );
  readonly projects = new Observable<ProjectMetadataRecord[]>([]);
  readonly isReady = new Observable<boolean>(false);
  readonly isBusy = new Observable<boolean>(false);
  readonly error = new Observable<string | null>(null);

  private readonly autosave = new AutosaveSystem(
    model,
    this.repository,
    this,
  );
  private initializePromise: Promise<void> | null = null;
  private operationChain: Promise<void> = Promise.resolve();

  initialize(): Promise<void> {
    if (this.initializePromise != null) {
      return this.initializePromise;
    }

    this.initializePromise = this.runExclusive(async () => {
      this.autosave.start();
      this.error.set(null);

      const bootstrapped = await this.repository.bootstrapLegacyProjectIfNeeded();
      const projects = bootstrapped != null
        ? [bootstrapped.metadata]
        : await this.repository.listProjects();

      this.projects.set(projects);

      let nextProjectId = this.currentProjectId.get();
      if (
        nextProjectId == null ||
        projects.some((project) => project.projectId === nextProjectId) === false
      ) {
        nextProjectId = pickFallbackProjectId(projects);
      }

      if (nextProjectId == null) {
        const created = await this.repository.createProject({
          document: createDefaultHumDocument(createDefaultArrangementDocState()),
        });
        this.projects.set(await this.repository.listProjects());
        nextProjectId = created.metadata.projectId;
      }

      await this.openProject(nextProjectId, { skipFlush: true });
      this.isReady.set(true);
    }).catch((error) => {
      this.initializePromise = null;
      throw error;
    });

    return this.initializePromise;
  }

  async createProject(): Promise<void> {
    await this.runExclusive(async () => {
      await this.autosave.flushNow("manual");
      const created = await this.repository.createProject();
      await this.refreshProjects();
      await this.loadSnapshot(created);
      model.appScreen.set("setup");
    });
  }

  async switchProject(projectId: ProjectId): Promise<void> {
    await this.runExclusive(async () => {
      await this.openProject(projectId);
    });
  }

  async renameProject(projectId: ProjectId, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }

    await this.runExclusive(async () => {
      await this.repository.updateProjectMetadata(projectId, {
        name: trimmed,
        updatedAt: Date.now(),
      });
      await this.refreshProjects();
    });
  }

  async duplicateProject(projectId: ProjectId): Promise<void> {
    await this.runExclusive(async () => {
      if (this.currentProjectId.get() === projectId) {
        await this.autosave.flushNow("duplicate");
      }
      const duplicated = await this.repository.duplicateProject(projectId);
      await this.refreshProjects();
      await this.loadSnapshot(duplicated);
      model.appScreen.set("setup");
    });
  }

  async deleteProject(projectId: ProjectId): Promise<void> {
    await this.runExclusive(async () => {
      const deletingCurrent = this.currentProjectId.get() === projectId;
      if (deletingCurrent) {
        await this.autosave.flushNow("delete");
      }

      await this.repository.deleteProject(projectId);
      const projects = await this.refreshProjects();

      if (!deletingCurrent) {
        return;
      }

      const fallbackProjectId = pickFallbackProjectId(projects, projectId);
      if (fallbackProjectId != null) {
        await this.openProject(fallbackProjectId, { skipFlush: true });
        return;
      }

      const created = await this.repository.createProject();
      await this.refreshProjects();
      await this.loadSnapshot(created);
      model.appScreen.set("setup");
    });
  }

  async refreshProjects(): Promise<ProjectMetadataRecord[]> {
    const projects = await this.repository.listProjects();
    this.projects.set(projects);
    return projects;
  }

  async flushAutosave(): Promise<void> {
    await this.autosave.flushNow("manual");
  }

  private async openProject(
    projectId: ProjectId,
    opts: { skipFlush?: boolean } = {},
  ): Promise<void> {
    if (!opts.skipFlush && this.currentProjectId.get() != null) {
      await this.autosave.flushNow("project-switch");
    }

    const snapshot = await this.repository.loadProject(projectId);
    if (snapshot == null) {
      throw new Error(`Could not load project "${projectId}".`);
    }

    await this.loadSnapshot(snapshot);
  }

  private async loadSnapshot(snapshot: LoadedProjectSnapshot): Promise<void> {
    this.autosave.pause();
    try {
      model.resetRuntimeSession();
      model.loadProjectSnapshot({
        document: snapshot.document,
        mediaAssets: snapshot.mediaAssets,
      });
      model.currentPartIndex.set(model.getSuggestedCurrentPartIndex());

      const openedAt = Date.now();
      await this.repository.updateProjectMetadata(snapshot.metadata.projectId, {
        lastOpenedAt: openedAt,
        updatedAt: snapshot.metadata.updatedAt,
      });
      await this.refreshProjects();

      this.currentProjectId.set(snapshot.metadata.projectId);
      this.coerceScreen();
      this.error.set(null);
      this.autosave.clearDirty();
    } finally {
      this.autosave.resume();
    }
  }

  private coerceScreen(): void {
    const screen = model.appScreen.get();
    if (screen === "setup") {
      return;
    }

    const hasLiveMedia =
      model.mediaStream.get() != null && model.audioContext.get() != null;
    const hasCommittedRecording =
      Object.keys(model.getHumDocument().tracks.recordingsById).length > 0;

    if ((screen === "calibration" || screen === "recording") && !hasLiveMedia) {
      model.appScreen.set("setup");
      return;
    }

    if (screen === "review" && !hasCommittedRecording) {
      model.appScreen.set("setup");
    }
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.operationChain
      .catch(() => {})
      .then(async () => {
        this.isBusy.set(true);
        try {
          return await task();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Project operation failed.";
          this.error.set(message);
          throw error;
        } finally {
          this.isBusy.set(false);
        }
      });

    this.operationChain = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }
}

export const projectController = new ProjectController();
