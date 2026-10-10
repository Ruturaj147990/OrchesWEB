# Architectural Decisions Record (ADR)

## Decision 1: Single-Destination Dashboard Architecture
- **Context:** The prompt strictly mandates that the frontend must have ONE primary dashboard route and no permanent sidebar containing separate destinations for Overview, Projects, Runs, IDE, Providers, Policies, Git, Diagnostics, History or Settings.
- **Decision:** Consolidate all secondary navigation views into contextual drawers, modal dialogs, and expandable inline panels while preserving 100% of underlying functionality and API contracts.
- **Consequences:** Eliminates navigation fragmentation, maximizes information density on desktop development screens, keeps the operator focused on the active run, and fulfills Section 3 of the Unattended Completion Directive.

## Decision 2: Default Theme Selection
- **Context:** Section 3 specifies: "Use a restrained dark theme by default and provide an optional light theme."
- **Decision:** Change default theme in `App.tsx` and HTML from `light` to `dark`. Preserve instant theme switching via header toggle and persistence in localStorage / settings.

## Decision 3: Drawer & Modal Organization
- **Context:** Features like IDE Connection, Settings, Task Inspection, History, Git Diffs, and Diagnostics must be instantly accessible without leaving the dashboard.
- **Decision:** Implement dedicated sliding drawers (`IdeConnectionDrawer`, `SettingsDrawer`, `TaskInspectorDrawer`, `GitDiffDrawer`, `HistoryDrawer`, `DiagnosticsDrawer`, `PoliciesDrawer`) with smooth z-index overlays, keyboard ESC dismiss, and clean backdrop blur.

## Decision 4: Hermetic E2E and Test Data Isolation
- **Context:** Automated tests must never read or overwrite real user data in `%APPDATA%`.
- **Decision:** All tests use `ORCHESTRATOR_DATA_DIR` pointed to isolated temporary directories (`os.tmpdir()`), automatically cleaned between test runs.
