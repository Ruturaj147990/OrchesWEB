# Autonomous Development Orchestrator (`orches`)
## Known Issues & Forensic Failure Analysis

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Target Audience:** Claude Code / Engineering Handoff  

---

## 1. Executive Summary of Forensic Findings

During forensic analysis of the repository, previous execution logs, and active user documents, 10 primary historical and discovered issues (designated **Issue A through Issue J**) were evaluated. 

The most alarming finding is **Issue B**, where sanitizing Windows file paths by stripping colons (`:`) converts absolute paths into relative directory names, creating nested drive replicas inside the target workspace (e.g. `c:\Users\limbk\OneDrive\Desktop\test\c\Users\limbk\OneDrive\Desktop\test\README.md`).

---

## 2. In-Depth Failure Analysis (Issues A through J)

### Issue A: Runs Create `.orchestrator` Metadata but Fail to Produce Actual Project Code
- **Priority:** P1 (High)
- **Status:** PARTIALLY FIXED / FRAGILE
- **Observable Symptoms:** Run executes to completion, status shows `succeeded` or `stalled`, `.orchestrator/snapshots/` contains manifest records, but zero source files appear in the user's project directory.
- **Expected Behavior:** An autonomous run must generate concrete project files (`package.json`, source files, tests, documentation) directly in `workspacePath`.
- **Actual Behavior (Before Commit `b5b58dd`):**
  1. `VisibleIdeAdapter` was an unconfigured stub with `files_changed: []`.
  2. In `ReasoningCodingAgentAdapter`, paths with leading slashes (`"/package.json"`) were resolved via `path.resolve(workspacePath, rawPath)`, which on Windows resolved to `C:\package.json` (the drive root). The security check `fullPath.startsWith(workspacePath)` failed and silently skipped writing every file!
  3. `AcceptanceGate` did not check if any non-metadata files were modified, allowing runs to be accepted without code changes.
- **Root Cause:** Conflation of IDE connection detection with code execution, combined with Windows-specific `path.resolve()` leading slash drive-root resolution.
- **Affected Files:**
  - `apps/server/src/providers/coding-agents/antigravity/visible-ide-adapter.ts:18, 91`
  - `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:158`
  - `apps/server/src/orchestrator/acceptance-gate.ts:25`
- **Correction Applied in `b5b58dd`:** Integrated `ReasoningProvider` into `VisibleIdeAdapter`, stripped leading slashes with `.replace(/^[/\\]+/, "")`, and enforced `Rule 0` in `AcceptanceGate` requiring at least one non-metadata file change.
- **Remaining Risk for Claude Code:** If an LLM outputs an absolute path or path with drive letter, Issue B is triggered.

---

### Issue B: Files Written into Unexpected Nested Directories (Drive Colon Stripping)
- **Priority:** P0 (Critical Security & Data Integrity)
- **Status:** CONFIRMED ACTIVE DEFECT
- **Observable Symptoms:** Files are written to bizarre nested paths like `test/c/Users/limbk/OneDrive/Desktop/test/README.md` or `test/proj-config/`.
- **Active Evidence:** At the exact time of this audit, the user's active document was:
  `c:\Users\limbk\OneDrive\Desktop\test\c\Users\limbk\OneDrive\Desktop\test\README.md`!
- **Root Cause Analysis:**
  Look at `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:156`:
  ```ts
  // Clean and sanitize path: remove any glob wildcards (*, ?) and leading drive/slashes
  let rawPath = item.path.trim().replace(/[*?<>|":]/g, "");
  // Strip leading slashes so path is strictly relative to workspace root on Windows
  rawPath = rawPath.replace(/^[/\\]+/, "");
  ```
  1. The LLM generates an absolute path: `"C:\\Users\\limbk\\OneDrive\\Desktop\\test\\README.md"`.
  2. The regex `replace(/[*?<>|":]/g, "")` strips `:` from `C:`.
  3. `rawPath` becomes `"C\\Users\\limbk\\OneDrive\\Desktop\\test\\README.md"`.
  4. Node executes: `path.resolve(workspacePath, rawPath)`.
  5. Result: `c:\Users\limbk\OneDrive\Desktop\test\c\Users\limbk\OneDrive\Desktop\test\README.md`!
  6. The boundary check evaluates:
     `fullPath.startsWith(resolvedWorkspace)`
     `"c:\\Users\\...\\test\\c\\Users\\...\\README.md".startsWith("c:\\Users\\...\\test")` -> **EVALUATES TO TRUE!**
  7. Node.js creates the entire nested drive replica inside the user's workspace!
- **Affected Files:**
  - `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:156-184`
- **Recommended Correction for Claude Code:**
  Do NOT merely strip colons with a generic character class. Detect if the path begins with a drive letter or is absolute:
  ```ts
  // Strip Windows drive letters (e.g. C:, D:) and leading slashes
  let cleanPath = item.path.trim().replace(/^[a-zA-Z]:[/\\]*/, "");
  // Strip leading slashes and relative dots
  cleanPath = cleanPath.replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  // If the model repeated the workspace basename at the beginning, strip it
  const wsBase = path.basename(workspacePath);
  if (cleanPath.startsWith(wsBase + "/") || cleanPath.startsWith(wsBase + "\\")) {
    cleanPath = cleanPath.slice(wsBase.length + 1);
  }
  ```
- **Regression Test Needed:** Add a unit test feeding paths like `"C:\\workspace\\src\\index.ts"` and `"/workspace/src/index.ts"`, verifying they resolve to `workspace/src/index.ts` rather than `workspace/c/...`.

---

### Issue C: Missing or Malformed `package.json`
- **Priority:** P1 (High)
- **Status:** PARTIALLY MITIGATED WITH HARDCODED FALLBACK
- **Observable Symptoms:** `npm test` fails with `ENOENT: no such file or directory, open 'package.json'` or `EJSONPARSE: Unexpected token`.
- **Root Cause:**
  1. Small local models (Ollama `llama3.1:8b`) frequently omit `package.json` when asked to implement a function, or wrap JSON inside markdown triple backticks.
  2. When the model omitted `package.json`, verification commands like `npm test` failed immediately.
- **Current Implementation:**
  In `reasoning-coding-adapter.ts:225-244`, if `package.json` is missing from the output but `npm` or `node` verification is planned, the adapter synthesizes a default `package.json` with `"scripts": { "test": "node --test" }`.
- **Remaining Risk for Claude Code:**
  This hardcodes Node.js project assumptions. If the user's project is Python (`pytest`), Rust (`cargo test`), or Go (`go test`), synthesizing `package.json` is incorrect. The fallback must inspect project language profile (`project.profileId`).

---

### Issue D: Visible IDE Adapter Does Not Call Native Antigravity Agent
- **Priority:** P1 (Architectural Integrity)
- **Status:** CONFIRMED ARCHITECTURAL DISCREPANCY
- **Observable Symptoms:** The UI displays `Agent: Antigravity IDE (Native Editor)`, but the native IDE agent does not open chat sessions or type in the editor canvas.
- **Root Cause:**
  `VisibleIdeAdapter` (`visible-ide-adapter.ts:91-107`) detects that Antigravity is running via process list and `storage.json`. However, it does not send messages to Antigravity's agent. Instead, it delegates to `ReasoningCodingAgentAdapter`, which queries Ollama or OpenAI over HTTP and writes files directly to the filesystem.
- **Architectural Implication:**
  The orchestrator acts as its own autonomous agent, merely verifying that the user has the IDE open to the right folder. Claude Code must document this honestly and determine whether an actual Antigravity extension protocol or CLI invocation (`agy`) is technically supported.

---

### Issue E: Critic and Acceptance May Approve Incomplete Projects or Reject Passing Work
- **Priority:** P1 (High)
- **Status:** MITIGATED WITH DETERMINISTIC GATES
- **Observable Symptoms:**
  1. Small local models as Critic hallucinate that test exit code `0` is "unverified" or "lacks documentation", returning `repair` and triggering rollback of passing code.
  2. Conversely, models can return `accept` even when tests failed.
- **Correction in `b5b58dd`:**
  - In `critic.ts`: If any mandatory check failed, verdict is forced to `repair`. If all mandatory checks passed with exit code `0`, diff is non-empty, and zero quality findings or scope drift are detected, verdict is forced to `accept`.
  - In `acceptance-gate.ts`: Rule 0 requires non-metadata file changes.
- **Remaining Risk for Claude Code:**
  Ensure that when tests pass but the code contains real logic flaws, Critic quality findings (`quality_findings.length > 0`) still properly trigger repairs.

---

### Issue F: Path Security and Workspace Confinement
- **Priority:** P1 (High)
- **Status:** PARTIALLY IMPLEMENTED
- **Observable Symptoms:** Directory traversal (`../../`) or absolute path escapes.
- **Current Implementation:**
  `normalizedRel` removes `../` segments and checks `fullPath.startsWith(resolvedWorkspace)`. It also blocks writing to `.env`, `.orchestrator`, and `.git`.
- **Remaining Risk:** Due to Issue B (colon stripping), absolute Windows paths do not trigger the traversal check because they get turned into subdirectories inside the workspace! Fixing Issue B will resolve this gap.

---

### Issue G: Windows Child Process Execution & DEP0190
- **Priority:** P2 (Medium)
- **Status:** VERIFIED FIXED
- **Observable Symptoms:** Node.js emits `(node:XXXXX) [DEP0190] DeprecationWarning: Passing args to child_process.spawn with shell: true...`.
- **Root Cause:** Calling `child_process.spawn` on Windows `.cmd` binaries (like `npm.cmd`) with `shell: true` triggers Node.js security deprecation warnings.
- **Fix Implemented:** In `runner.ts` and `reasoning-coding-adapter.ts`, `shell: true` was replaced with:
  ```ts
  const comspec = process.env.ComSpec || "cmd.exe";
  spawn(comspec, ["/d", "/s", "/c", cmdLine], {
    shell: false,
    windowsVerbatimArguments: true,
  });
  ```
- **Evidence:** Verified during test runs—zero `DEP0190` warnings emitted.

---

### Issue H: Frontend UI State Synchronization and Playwright Test Flakiness
- **Priority:** P2 (Medium)
- **Status:** MITIGATED IN TEST SUITE
- **Observable Symptoms:** Playwright smoke tests failed because `#btn-pause` was enabled before test started, or timed out waiting for drawer to close.
- **Root Cause:**
  1. The running development server persisted previous runs in SQLite. When the page loaded, an active run was still running, making `#btn-pause` enabled.
  2. Clicking provider toggle opened the configuration drawer, which was not dismissed with `Escape` because the drawer required clicking `button[aria-label='Close configuration']`.
- **Fix Implemented:** Tests now reset active runs before asserting button states and explicitly click the close button. All 5 Playwright tests pass (25.3s).

---

### Issue I: Non-Git Workspaces Support
- **Priority:** P1 (High)
- **Status:** VERIFIED WORKING
- **Observable Symptoms:** Autonomous loop throwing Git errors when running in plain local folders without `.git`.
- **Implementation:** `SnapshotManager` stores file manifests and hashes in `.orchestrator/snapshots/<id>/manifest.json`, computes unified diffs in memory, and performs safe rollbacks.
- **Evidence:** 8 automated integration tests pass in `git-optional-and-snapshots.test.ts`. Real live smoke test succeeded in `os.tmpdir()` with `hasGit: false`.

---

### Issue J: Reported Test and Milestone Claims vs Actual Source Reality
- **Priority:** P2 (Medium)
- **Status:** AUDITED AND CLARIFIED
- **Reality Check:**
  - All 12 test files in `apps/server/tests/` exist and pass (59/59).
  - All 5 Playwright suites in `e2e/` exist and pass (5/5).
  - However, several tests (e.g. `milestone1.test.ts`, `milestone3.test.ts`) use `Deterministic Test Mock Agent` or mocked IDE detectors rather than live local Ollama inference.
  - The standalone smoke test script proved real live Ollama and Visible IDE execution in 14.7s.
