import { AgentReport, PrivacyClass, Task } from "@orchestrator/shared-types";

export interface CodingAgentDetection {
  installed: boolean;
  executablePath?: string;
  version?: string;
  message?: string;
  capabilities: {
    headless: boolean;
    streaming: boolean;
    jsonOutput: boolean;
  };
}

export interface CodingAgentAdapter {
  id: string;
  displayName: string;
  privacyClass: PrivacyClass;
  detectInstallation(): Promise<CodingAgentDetection>;
  executeTask(
    task: Task,
    workspacePath: string,
    contextPacket: string,
    signal?: AbortSignal,
    onLog?: (chunk: string) => void
  ): Promise<AgentReport>;
}
