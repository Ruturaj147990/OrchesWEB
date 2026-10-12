export type BrowserState =
  | "NOT_STARTED"
  | "STARTING"
  | "CHATGPT_LOADING"
  | "AUTH_REQUIRED"
  | "READY"
  | "PROMPT_READY"
  | "ATTACHMENTS_UPLOADING"
  | "ATTACHMENTS_READY"
  | "COMPOSER_FILLED"
  | "SUBMITTING"
  | "USER_MESSAGE_SUBMITTED"
  | "USER_MESSAGE_CONFIRMED"
  | "WAITING_FOR_RESPONSE"
  | "ASSISTANT_GENERATING"
  | "GENERATING"
  | "READING_RESPONSE"
  | "RESPONSE_STABILIZING"
  | "RESPONSE_COMPLETE"
  | "VALIDATING_RESPONSE"
  | "INSTRUCTION_READY"
  | "DISPATCHING_TO_ANTIGRAVITY"
  | "RECOVERING"
  | "FAILED"
  | "FAILED_RECOVERABLE"
  | "FAILED_TERMINAL"
  | "STOPPED"
  | "CLOSED";

export class BrowserStateMachine {
  private currentState: BrowserState = "NOT_STARTED";
  private listeners: Array<(state: BrowserState, previous: BrowserState, detail?: string) => void> = [];
  private lastError: string | null = null;

  public getState(): BrowserState {
    return this.currentState;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public transition(next: BrowserState, detail?: string): void {
    const prev = this.currentState;
    if (prev === next) return;

    if (next === "FAILED" && detail) {
      this.lastError = detail;
    } else if (next === "READY") {
      this.lastError = null;
    }

    this.currentState = next;
    for (const listener of this.listeners) {
      try {
        listener(next, prev, detail);
      } catch (err) {
        console.error("[BrowserStateMachine] Listener error:", err);
      }
    }
  }

  public onStateChange(listener: (state: BrowserState, previous: BrowserState, detail?: string) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
