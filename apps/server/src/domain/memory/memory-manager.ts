import fs from "node:fs";
import path from "node:path";
import { Task } from "@orchestrator/shared-types";

export interface TaskSummaryRecord {
  taskId: string;
  roadmapItemId: string;
  title: string;
  status: "succeeded" | "failed" | "blocked";
  commitSha?: string;
  completedAt: string;
  brief: string;
}

export class MemoryManager {
  private memoryDir: string;
  private historyFile: string;

  constructor(private workspacePath: string) {
    this.memoryDir = path.join(workspacePath, ".orchestrator");
    this.historyFile = path.join(this.memoryDir, "TASK_HISTORY.json");
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  public recordCompletedTask(task: Task, commitSha?: string, brief?: string): void {
    const history = this.getTaskHistory();
    const entry: TaskSummaryRecord = {
      taskId: task.id,
      roadmapItemId: task.roadmapItemId,
      title: task.title,
      status: task.status === "succeeded" ? "succeeded" : "failed",
      commitSha,
      completedAt: new Date().toISOString(),
      brief: brief || task.objective,
    };

    history.push(entry);
    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), "utf8");

    // Update CURRENT_STATE.md
    this.updateCurrentState(history);

    // Update REPO_MAP.md
    this.updateRepoMap();
  }

  public getTaskHistory(): TaskSummaryRecord[] {
    if (fs.existsSync(this.historyFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.historyFile, "utf8"));
      } catch {
        return [];
      }
    }
    return [];
  }

  public getRollingSummaries(count = 5): string {
    const history = this.getTaskHistory();
    const recent = history.slice(-count);
    if (recent.length === 0) {
      return "No tasks completed yet.";
    }

    return recent
      .map(
        (t) =>
          `- [${t.taskId}] (${t.roadmapItemId}) ${t.title}: Status=${t.status} | Commit=${t.commitSha || "none"} | Summary=${t.brief}`
      )
      .join("\n");
  }

  private updateCurrentState(history: TaskSummaryRecord[]): void {
    const currentStateFile = path.join(this.workspacePath, "CURRENT_STATE.md");
    const lastTask = history[history.length - 1];

    const content = `
# Current Project State

**Last Updated:** ${new Date().toISOString()}  
**Total Completed Tasks:** ${history.filter((h) => h.status === "succeeded").length}  
**Active Baseline:** ${lastTask?.commitSha || "HEAD"}  

## Recent Task History
${this.getRollingSummaries(5)}
`.trim();

    fs.writeFileSync(currentStateFile, content, "utf8");
  }

  private updateRepoMap(): void {
    const repoMapFile = path.join(this.memoryDir, "REPO_MAP.md");

    const scanDir = (dir: string, depth = 0): string[] => {
      if (depth > 2) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
        const indent = "  ".repeat(depth);
        if (entry.isDirectory()) {
          lines.push(`${indent}- ${entry.name}/`);
          lines.push(...scanDir(path.join(dir, entry.name), depth + 1));
        } else {
          lines.push(`${indent}- ${entry.name}`);
        }
      }
      return lines;
    };

    try {
      const tree = scanDir(this.workspacePath);
      const content = `# Repository Map\n\n${tree.join("\n")}\n`;
      fs.writeFileSync(repoMapFile, content, "utf8");
    } catch {
      // Ignored
    }
  }
}
