export interface ProjectData {
  id: string;
  name: string;
  objective: string;
  rootPath?: string;
  autonomyMode: string;
  status: string;
}

export interface RunData {
  id: string;
  projectId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "blocked" | "draft" | "ready";
  iterationCount: number;
  currentTaskId: string | null;
  startedAt?: string;
  endedAt?: string | null;
  stopReason?: string | null;
}
