import crypto from "node:crypto";
import { VerificationResult } from "@orchestrator/shared-types";

export interface StagnationState {
  consecutiveNoDiffs: number;
  failureHashCounts: Map<string, number>;
  fileDiffHashes: string[];
}

export class StagnationDetector {
  private noDiffThreshold = 2;
  private repeatedFailureThreshold = 3;
  private pingPongThreshold = 3;

  private state: StagnationState = {
    consecutiveNoDiffs: 0,
    failureHashCounts: new Map(),
    fileDiffHashes: [],
  };

  public recordAttempt(diff: string, verificationResults: VerificationResult[]): {
    isStagnant: boolean;
    reason?: string;
  } {
    const trimmedDiff = diff.trim();

    // 1. Consecutive No-Diff Detection
    if (trimmedDiff.length === 0) {
      this.state.consecutiveNoDiffs++;
      if (this.state.consecutiveNoDiffs >= this.noDiffThreshold) {
        return {
          isStagnant: true,
          reason: `Stagnation detected: ${this.state.consecutiveNoDiffs} consecutive attempts produced no code diffs.`,
        };
      }
    } else {
      this.state.consecutiveNoDiffs = 0;
    }

    // 2. Repeated Materially Equivalent Failure Hash Detection
    const failedChecks = verificationResults.filter((v) => v.status === "failed" || v.status === "timeout");
    if (failedChecks.length > 0) {
      const normalizedErrors = failedChecks
        .map((f) => `${f.command}:${(f.stderrSnippet || f.stdoutSnippet).replace(/\s+/g, " ").slice(0, 500)}`)
        .sort()
        .join("|");

      const failureHash = crypto.createHash("sha256").update(normalizedErrors).digest("hex").slice(0, 16);
      const currentCount = (this.state.failureHashCounts.get(failureHash) || 0) + 1;
      this.state.failureHashCounts.set(failureHash, currentCount);

      if (currentCount >= this.repeatedFailureThreshold) {
        return {
          isStagnant: true,
          reason: `Stagnation detected: Identical verification failure occurred ${currentCount} consecutive times (Hash: ${failureHash}).`,
        };
      }
    }

    // 3. Edit Ping-Pong / Oscillation Detection
    if (trimmedDiff.length > 0) {
      const diffHash = crypto.createHash("sha256").update(trimmedDiff).digest("hex").slice(0, 16);
      this.state.fileDiffHashes.push(diffHash);

      // Check if we have alternating hashes: A -> B -> A -> B
      const len = this.state.fileDiffHashes.length;
      if (len >= 4) {
        if (
          this.state.fileDiffHashes[len - 1] === this.state.fileDiffHashes[len - 3] &&
          this.state.fileDiffHashes[len - 2] === this.state.fileDiffHashes[len - 4]
        ) {
          return {
            isStagnant: true,
            reason: "Stagnation detected: Cyclic edit oscillation (ping-pong) detected between alternating patches.",
          };
        }
      }
    }

    return { isStagnant: false };
  }

  public reset(): void {
    this.state = {
      consecutiveNoDiffs: 0,
      failureHashCounts: new Map(),
      fileDiffHashes: [],
    };
  }
}
