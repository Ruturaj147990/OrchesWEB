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

        let adapter: CodingAgentAdapter;
        if (process.env.NODE_ENV === "test") {
          adapter = new MockAgentAdapter();
        } else if (ideState.activeMode === "visible_ide") {
          adapter = new VisibleIdeAdapter(bridge);
        } else {
          adapter = new AntigravityAdapter();
        }

        const contextBuilder = new ContextBuilder(project.rootPath);
        const planner = new PlannerService(
          reasoningRegistry.getDefault(),
          contextBuilder
        );
        const critic = new CriticService(reasoningRegistry.getDefault(), contextBuilder);
        const budget = new BudgetService();

        const loop = new AutonomousLoop(this.db, project.rootPath, planner, critic, budget);

        console.log(`[RunExecutionService] Dispatched run ${runId} for project '${project.name}' (${project.rootPath}) [Mode: ${ideState.activeMode}, Adapter: ${adapter.id}]`);

        // Execute task step
        const result = await loop.runSingleTask({
          projectId,
          runId,
          workspacePath: project.rootPath,
          agentAdapter: adapter,
          approvedRoadmapIds: ["ROADMAP-001"],
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
