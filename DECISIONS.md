# Architectural Decisions Record (ADR)

## Decision 1: Single-Destination Dashboard Architecture
- **Context:** The directive strictly mandates that the frontend must have ONE primary dashboard route and no permanent sidebar containing separate destinations for Overview, Projects, Runs, IDE, Providers, Policies, Git, Diagnostics, History or Settings.
- **Decision:** Consolidate all secondary navigation views into contextual drawers, modal dialogs, and expandable inline panels while preserving 100% of underlying functionality and API contracts.
- **Consequences:** Eliminates navigation fragmentation, maximizes information density on desktop development screens, keeps the operator focused on the active run, and creates an uncluttered workspace.

## Decision 2: Default Theme Selection
- **Context:** Design requirements specify: "Use a restrained dark theme by default and provide an optional light theme."
- **Decision:** Change default theme in `App.tsx` and HTML from `light` to `dark`. Preserve instant theme switching via header toggle and persistence in localStorage / settings.

## Decision 3: Drawer & Modal Organization
- **Context:** Secondary workflows such as IDE Connection, Settings, Task Inspection, History, Git Diffs, Diagnostics, Policies, and Export must be accessible without leaving the dashboard or consuming permanent canvas space.
- **Decision:** Implement dedicated sliding drawers (`IdeConnectionDrawer`, `SettingsDrawer`, `TaskInspectorDrawer`, `GitDiffDrawer`, `HistoryDrawer`, `DiagnosticsDrawer`, `PoliciesDrawer`, `ExportModal`) with smooth z-index overlays, keyboard ESC dismiss, and clean backdrop blur.

## Decision 4: Hermetic E2E and Test Data Isolation
- **Context:** Automated tests must never read or overwrite real user data in `%APPDATA%`.
- **Decision:** All tests use `ORCHESTRATOR_DATA_DIR` pointed to isolated temporary directories (`os.tmpdir()`), automatically cleaned between test runs. Test suites use `MockReasoningProvider` for unit tests to prevent slow or nondeterministic network dependencies.

## Decision 5: Native Ollama Probing with Origin Normalization
- **Context:** Local Ollama server paths differ between native endpoints (`/api/version`, `/api/tags`, `/api/chat`) and OpenAI-compatible paths (`/v1/models`, `/v1/chat/completions`). When users input either `http://127.0.0.1:11434` or `http://127.0.0.1:11434/v1`, naive concatenation broke native discovery or duplicated `/v1`.
- **Decision:** Extract the exact origin (`http://127.0.0.1:11434`). Always probe native `/api/version` and `/api/tags` to discover models and diagnose connection states (`server_unreachable`, `model_installed`, `model_unavailable`, `ready`). Use `/v1/chat/completions` strictly for OpenAI-compatible chat. Never fall back to cloud.

## Decision 6: Autonomous Reasoning Coding Agent & Rule 0 Enforcement
- **Context:** When the official `agy` CLI binary is not in PATH and no external IDE socket is actively accepting prompt RPCs, the orchestrator must not silently fail or merely write `.orchestrator` metadata without project code.
- **Decision:** Introduce `ReasoningCodingAgentAdapter` that utilizes the selected reasoning provider (Local Ollama or OpenAI) to generate code modifications directly in the project directory, execute tests with `child_process.spawn`, and return verified file diffs.
- **Consequences:** Projects get actual functional code generated and verified regardless of external CLI installation. `AcceptanceGate` strictly enforces Rule 0: reject any task producing zero non-metadata file modifications.

## Decision 7: Granular Reasoning Usage Ledger
- **Context:** Credential validation must never be counted as inference, and zero usage on cloud platforms caused confusion.
- **Decision:** Maintain a durable local SQLite `reasoning_usage_ledger` recording every paid/local request with exact token counts, model identifier, operation type (planner, critic, test_generation), duration, and cost estimation.

## Decision 8: Windows Process Spawning with Shell Resolution
- **Context:** Following the Node.js CVE-2024-27980 security update on Windows (Node.js 22/24), calling `child_process.spawn` on batch/cmd files such as `npm.cmd` without `shell: true` throws a fatal `EINVAL` error.
- **Decision:** Set `shell: process.platform === "win32"` in `VerificationRunner` while strictly validating and escaping command arguments to avoid shell injection.
- **Consequences:** Commands like `npm test` execute reliably in Windows environments without throwing `EINVAL`.

## Decision 9: SnapshotManager for Non-Git Project Safety
- **Context:** The orchestrator must work in arbitrary local folders without requiring Git initialization, GitHub accounts, remotes, or internet connectivity.
- **Decision:** Implement `SnapshotManager` (`apps/server/src/git/snapshot-manager.ts`) to capture cryptographic content hashes in `.orchestrator/snapshots/<id>/manifest.json`, generate standard unified diffs without the Git CLI, and support safe selective rollback that preserves unrelated user files.

## Decision 10: Unified Production Fastify Server with Static React SPA Distribution
- **Context:** In production deployment, running separate dev servers (Vite) and API proxies is fragile and violates self-contained deployment principles.
- **Decision:** Configure Fastify to serve both the REST/SSE API (`/api/v1/*`) and static built React SPA assets (`apps/web/dist`) on a single port with fallback to `index.html` for client routing.
