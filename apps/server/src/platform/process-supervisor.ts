import { ChildProcess } from "node:child_process";

export interface SupervisedProcess {
  id: string;
  pid: number;
  description: string;
  startedAt: string;
}

export class ProcessSupervisor {
  private activeProcesses: Map<string, ChildProcess> = new Map();

  public register(id: string, child: ChildProcess, description: string): void {
    if (child.pid) {
      this.activeProcesses.set(id, child);
      child.on("close", () => {
        this.activeProcesses.delete(id);
      });
    }
  }

  public async terminate(id: string, timeoutMs = 2000): Promise<boolean> {
    const child = this.activeProcesses.get(id);
    if (!child || !child.pid) return true;

    try {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise<boolean>((resolve) => child.on("close", () => resolve(true))),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);

      if (!exited) {
        child.kill("SIGKILL");
      }
      this.activeProcesses.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  public async terminateAll(): Promise<void> {
    const keys = Array.from(this.activeProcesses.keys());
    for (const key of keys) {
      await this.terminate(key);
    }
  }

  public getActiveCount(): number {
    return this.activeProcesses.size;
  }
}
