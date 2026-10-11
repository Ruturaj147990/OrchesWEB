import { DatabaseSync } from "node:sqlite";
import { AutonomousLoop, LoopExecutionOptions, LoopIterationResult } from "./loop.js";
import { PlannerService } from "./planner.js";
import { CriticService } from "./critic.js";
import { BudgetService } from "../domain/budgets/budget-service.js";
import { ProjectRepository } from "../storage/repositories/project-repository.js";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { RunStateMachine } from "./state-machine.js";
import { EventStore } from "../events/event-store.js";
import { reasoningRegistry } from "../providers/reasoning/registry.js";
import { ContextBuilder } from "../prompts/context-builder.js";
import { getSharedIdeBridge } from "../api/routes/ide.js";
import { VisibleIdeAdapter } from "../providers/coding-agents/antigravity/visible-ide-adapter.js";
import { AntigravityAdapter } from "../providers/coding-agents/antigravity/antigravity-adapter.js";
import { MockAgentAdapter } from "../providers/coding-agents/mock/mock-adapter.js";
import { CodingAgentAdapter } from "../providers/coding-agents/adapter.js";

import { ReasoningCodingAgentAdapter } from "../providers/coding-agents/reasoning/reasoning-coding-adapter.js";
import { SettingsManager } from "../platform/settings-manager.js";

export class RunExecutionService {
  private activeJobs = new Map<string, boolean>();

  constructor(
    private db: DatabaseSync,
    private runRepo: RunRepository,
    private projectRepo: ProjectRepository,
    private eventStore: EventStore,
    private stateMachine: RunStateMachine
  ) {}

  public async triggerRunExecution(projectId: string, runId: string, options?: { allowDirty?: boolean }): Promise<void> {
    if (this.activeJobs.get(runId)) {
      // Job is already running
      return;
    }

    const project = this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    this.activeJobs.set(runId, true);

    // Run asynchronously in background without blocking HTTP response
    (async () => {
      try {
        const bridge = getSharedIdeBridge();
        const ideState = bridge.getState();

        // 1. Resolve active reasoning provider from persisted settings
        const persisted = SettingsManager.loadSettings();
        const activeProviderId = persisted.defaultProviderId || reasoningRegistry.getDefaultId();
        const activeProvider = reasoningRegistry.get(activeProviderId) || reasoningRegistry.getDefault();

        // 2. Select appropriate coding agent adapter
        let adapter: CodingAgentAdapter;
        if (process.env.NODE_ENV === "test") {
          adapter = new MockAgentAdapter();
        } else if (ideState.activeMode === "headless_cli") {
          const cliAdapter = new AntigravityAdapter();
          const detection = await cliAdapter.detectInstallation();
          if (detection.installed) {
            adapter = cliAdapter;
          } else {
            adapter = new ReasoningCodingAgentAdapter(activeProvider);
          }
        } else if (ideState.activeMode === "visible_ide" && ideState.status === "ready") {
          adapter = new VisibleIdeAdapter(bridge, activeProvider);
        } else {
          // Default autonomous coding execution: uses active reasoning provider
          adapter = new ReasoningCodingAgentAdapter(activeProvider);
        }

        const contextBuilder = new ContextBuilder(project.rootPath);
        const planner = new PlannerService(activeProvider, contextBuilder);
        const critic = new CriticService(activeProvider, contextBuilder);
        const budget = new BudgetService();

        const loop = new AutonomousLoop(this.db, project.rootPath, planner, critic, budget);

        console.log(`[RunExecutionService] Dispatched run ${runId} for project '${project.name}' (${project.rootPath}) [Mode: ${ideState.activeMode}, Provider: ${activeProvider.displayName}, Adapter: ${adapter.displayName}]`);

        // Execute task step
        const result = await loop.runSingleTask({
          projectId,
          runId,
          workspacePath: project.rootPath,
          agentAdapter: adapter,
          approvedRoadmapIds: ["ROADMAP-001", "rm-001", "ROADMAP-1"],
          ideBridge: bridge,
          allowDirtyWorkspace: options?.allowDirty ?? false,
        });

        console.log(`[RunExecutionService] Run ${runId} step completed: status=${result.status}, task=${result.taskId}${result.error ? ` (reason: ${result.error})` : ""}`);

        this.eventStore.record(projectId, "run.step_completed", {
          runId,
          result,
        }, runId, result.taskId);
      } catch (err: unknown) {
        const errCode = (err as { code?: string })?.code;
        if (errCode !== "ERR_INVALID_STATE" && process.env.NODE_ENV !== "test") {
          console.error(`AutonomousLoop execution error on run ${runId}:`, err);
        }
        try {
          this.stateMachine.transition(runId, "failed", (err as Error).message);
          this.eventStore.record(projectId, "run.failed", { error: (err as Error).message }, runId);
        } catch {}
      } finally {
        this.activeJobs.delete(runId);
      }
    })();
  }
}
