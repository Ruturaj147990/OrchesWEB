# Execution Progress (Claude Code session, 2026-10-11)

Living log for the autonomous engineering pass. Newest checkpoint at the bottom.

## Checkpoint 1 — Investigation complete

### Repository state found
- `main` was at `06f2097`; the actual latest work (including this handoff folder) was on the
  orchestrator-created branch `orchestrator/proj-49ff4dcf…/task-7460/attempt-1` (`b35f70c`).
  The orchestrator had been pointed at its own repository and left HEAD on attempt branches.
- Action: fast-forwarded `main` to `b35f70c` (no history rewritten), then deleted the 25
  `orchestrator/*` branches with `git branch -d` (all were fully merged into `main`).
  Per user instruction the repo now has a single local branch: `main`.

### Root-cause findings (verified by reading code and runtime evidence)
1. **Workspace damage via git** — `GitManager.createAttemptBranch` ran `git checkout -b` in the
   user's repo for every attempt, never returned to the original branch, and accumulated branches.
   `rollbackAttempt` ran `git checkout <sha> -- <files>`; that fails for newly created files and the
   exit code was ignored, so "rollback" could silently do nothing.
2. **Project root defaulted to `process.cwd()`** — creating a project without a path targeted the
   orchestrator repo itself (this is how the repo got its attempt branches). Tests did the same.
3. **Fake coding-agent integration** — `VisibleIdeAdapter` just delegates to the reasoning-model
   file writer; the "agent tested" handshake stage only checks that the folder exists.
4. **Model-chosen shell commands** — planner `verification_plan_ids` came from the LLM and were run
   through `cmd.exe /c`. Arbitrary command execution from untrusted model output.
5. **Silent fallbacks / false success** — planner falls back to a canned task on any error; critic
   falls back to "accept"; the critic's output is rewritten to "accept/passed"; the coder synthesizes
   `package.json`, `test.js` and a `greet()` stub to satisfy `npm test`.
6. **Unsafe path handling** — colon stripping turns `C:\…` into nested `c\Users\…` folders;
   `..` segments are stripped rather than rejected; prefix check `startsWith` is not segment-aware.
7. **No task input** — runs execute `project.objective`; the UI has no place to type a task.
8. **Lifecycle** — successful runs never leave `running`; Stop does not abort the in-flight agent or
   process; no recovery for runs interrupted by a server restart; verification processes are killed
   without their process tree on Windows.

### Plan (in order)
1. Shared process runner (Windows tree-kill, timeout, abort, output cap).
2. Safe model-path resolution + workspace guard (snapshot per attempt, exact diff, scoped rollback,
   no branch switching, commit only accepted files on the current branch).
3. Project inspector → deterministic, project-aware verification (baseline vs after).
4. Honest coding mechanisms: built-in model coder, Antigravity IDE hand-off (only if it really
   works here), agy CLI (detected, not installed here), mock only when explicitly enabled.
5. Rewritten loop: task text from user, bounded repairs fed with real failures, gate that cannot be
   satisfied by model assertions alone, outcome = verified / unverified / rejected / failed / stopped.
6. Frontend: single dashboard (workspace → task → run → result), drawers for settings/history/logs.
7. Real end-to-end runs with Ollama `llama3.1:8b` in temp workspaces; Playwright against real UI.
