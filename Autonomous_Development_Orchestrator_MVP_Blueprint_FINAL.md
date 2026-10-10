# Autonomous Development Orchestrator — MVP Project Blueprint

**Document version:** 1.2  
**Created:** 10 October 2026  
**Status:** Implementation specification for the coding agent  
**Primary implementation target:** Local-first Node.js/TypeScript application  
**Primary coding-agent integration:** Official Antigravity CLI, behind a replaceable adapter  
**Reasoning-provider requirement:** Cloud, local-only, and hybrid modes are first-class MVP capabilities
**Revision focus:** Early vertical slice, explicit cost control, and browser/visual verification for UI work

> **Purpose of this document:** This is the product specification, architecture blueprint, implementation plan, and acceptance-test contract for the MVP. Treat it as the source of truth unless the human owner explicitly changes it. Implement it incrementally. Do not attempt to build the entire application in one enormous unverified change.

> **Revision 1.2:** Resolves three implementation-order and quality gaps: the end-to-end vertical slice is moved ahead of the project wizard/importers and advanced provider routing; cost estimation and enforceable default per-task/per-run budgets are included in the first working loop; and browser-based functional/visual verification is an explicit evidence path for UI tasks. Previous Revision 1.1 requirements remain mandatory.

---

## 0. Instructions for the implementation agent

You are implementing the product described below. You are not implementing a generic chat app, a wrapper that merely forwards prompts, or an unbounded self-modifying agent.

### Required behavior while implementing this repository

1. Inspect the current working directory, operating system, installed Node.js package manager, Git status, and any existing files before changing anything.
2. If this is an empty repository, initialize the structure specified below. If an existing repository is present, preserve unrelated work and do not overwrite files without inspecting them.
3. Before substantial code changes, write a short implementation plan and identify any conflict between this blueprint and the existing repository. Use sensible defaults for underspecified details; document the decision rather than repeatedly blocking on minor questions.
4. Implement in the milestone order in Section 31. Each milestone must build, have tests, and leave the repository in a runnable state. Do not defer all testing until the end.
5. Do not create fake UI controls, placeholder success messages, simulated integrations presented as real, mock verification in production paths, or buttons that do nothing. A capability that is not implemented must be marked clearly as unavailable or not implemented.
6. Never claim a test, build, security check, or agent task succeeded unless the corresponding command or operation actually ran and its result was recorded.
7. Keep provider interfaces, task lifecycle logic, policy enforcement, persistence, and UI separate. Avoid one giant server file and avoid circular dependencies.
8. All model-produced content and all imported blueprint contents are untrusted input. Never let model prose override orchestrator policy or execute arbitrary commands directly.
9. Use the official Antigravity CLI documented at `https://www.antigravity.google/docs/cli/overview` / `https://www.antigravity.google/docs/cli/headless/` as the preferred integration. Do not silently substitute an unrelated third-party CLI. Detect whether the expected CLI and required flags exist, and report actionable setup errors.
10. **Local reasoning is a core MVP feature.** Implement a provider abstraction from the beginning. At minimum, support the OpenAI API and an OpenAI-compatible local endpoint such as Ollama, `llama.cpp`, or vLLM. Add a Local-only policy that prevents the reasoning layer from falling back to a cloud provider. Do not represent the whole application as offline if its selected coding agent still uses a remote service.
11. Use TypeScript strict mode, input validation, safe process spawning, database migrations, deterministic tests, and understandable error messages.
12. Update `README.md`, `.env.example`, the default settings, tests, and this implementation status as features are added. Never place secrets in committed files.
13. Build the end-to-end vertical slice by Milestone 3 at the latest, before the full project wizard, document importers, or advanced hybrid routing. Use a minimal project-creation form and configurable basic settings first; initialize one task, invoke a configured provider, dispatch to a coding-agent adapter, run independent verification (including browser/screenshot checks for web UI tasks), run Critic review, persist Git/evidence, and display the result.
14. If a library/API/CLI option has changed since this blueprint was written, inspect the installed/current official documentation and update the implementation; do not invent a command-line flag.
15. Keep the Planner and Critic as separate logical roles and separate model invocations. They may use the same underlying model in the beginner default, but use distinct system prompts, distinct input packets, separate validated schemas, and a separate review record. The Critic must not be asked to endorse the Planner’s prior verdict. Allow a separately configured critic model/provider for stronger independence.
16. The orchestrator—not the coding agent—must run configured lint, typecheck, test, build, and applicable browser/UI checks and record actual command/operation, exit status, output artifact, duration, and whether the check was skipped. For UI tasks, capture real browser assertions, console/network failures, and screenshots at configured viewports. Agent claims are never proof.
17. Enforce task-to-roadmap traceability. Every executable task must reference an approved roadmap item or an explicitly approved scope-change proposal. Creative modes may propose scope expansion; they may not bypass this gate.
18. Start a fresh coding-agent session for every task and every repair attempt by default. Provide a compact, task-specific context packet rather than reusing a growing conversation. Record session identifiers and context hashes.
19. For Git repositories, isolate each task/attempt in a task-specific branch/worktree where safely possible; create a checkpoint commit for each accepted task. Preserve failure evidence and automatically discard/revert only the isolated failed attempt. Never reset, clean, or overwrite mixed/pre-existing human changes.
20. Detect and handle agent permission requests, tool denials, agent questions, authentication prompts, and headless-mode soft denials as explicit blocked/approval states. Do not wait forever, assume success, or enable dangerous permission bypass just to keep the loop moving.
21. Use versioned `SPEC.md`, `DECISIONS.md`, and an approved `ROADMAP.md` as canonical project context. Maintain a repository map and rolling summaries. The Planner must consult them before proposing work; the Critic must check for scope drift against them.

## 1. Product summary

Build a local-first application that coordinates a **project reasoning brain** and a **coding agent** in an autonomous development loop. The human starts by describing an idea, optionally importing a project blueprint, selecting a project profile, configuring autonomy and constraints, and reviewing a generated plan. The system then repeatedly plans bounded tasks, dispatches them to a coding agent, verifies the resulting code using deterministic tools, reviews evidence, updates persistent project memory, and selects the next task.

The human can guide, reprioritize, pause, approve, reject, or stop work at any time. The loop ends when project-defined completion criteria are independently verified, an explicit resource limit is reached, work becomes blocked, or the human stops it.

### Core product proposition

The durable asset is not the prompt file or the chat history. It is the combination of:

- A persistent project specification and memory.
- An explicit and versioned autonomy/constraint policy.
- Replaceable reasoning and coding-agent providers.
- A durable task/state machine and event log.
- Independent verification of work.
- Human steering that is incorporated safely into future tasks.
- A clear end condition with a useful final report.

## 2. MVP goals and non-goals

### 2.1 MVP goals

- Run a local web dashboard and Node.js backend on the user's machine.
- Support creating a project in a new or existing local directory.
- Support importing project blueprints and extracting candidate requirements.
- Provide beginner-friendly project presets and advanced custom configuration.
- Provide three operating modes: creative within constraints, creative exploration, and strict blueprint adherence.
- Make hard constraints enforceable outside the language model.
- Support cloud reasoning through the OpenAI API.
- Support local reasoning through an OpenAI-compatible endpoint; local-only mode must not fall back to cloud.
- Support a hybrid routing policy with explicit per-operation provider routing and data classification.
- Support Antigravity through its official headless CLI adapter, after a capability/authentication check.
- Maintain project memory and a task roadmap across runs/restarts.
- Have a user-message inbox that affects future work, task ordering, or a safe interruption.
- Run configured validation commands and collect actual exit codes/output.
- Provide retries, timeouts, budget controls, task locks, crash recovery, logs, and Stop/Pause/Resume controls.
- Maintain Git checkpoints where Git is available and handle dirty repositories carefully.
- Display the active provider, model, network/privacy mode, current task, iteration count, costs when measurable, logs, diffs, test results, pending approvals, and blockers.
- Include unit, integration, and core end-to-end tests.
- Ensure the service is local-only by default (loopback binding), with no account, telemetry, remote access, or multi-user deployment in the MVP.

### 2.2 Explicit non-goals for MVP

Do not build these before the core vertical slice is dependable:

- A cloud-hosted multi-tenant SaaS product.
- Team collaboration, user accounts, RBAC, shared cloud workspaces, or remote control over the public internet.
- General-purpose parallel agents editing the same workspace concurrently.
- An agent marketplace or community plugin gallery.
- Automatically downloading, installing, and configuring arbitrary local LLM weights. The MVP connects to a local inference server; a guided installer can be added later.
- Automatic deployment to production, publishing packages, releasing apps, sending messages, or making irreversible external changes without approval.
- Guaranteed correctness based only on an LLM review.
- Directly automating the ChatGPT website, scraping a browser session, or treating an ordinary ChatGPT browser chat as a programmable API.
- A native desktop bundle in the first milestone. Keep the architecture compatible with later Tauri/Electron packaging, but start with a local web UI.
- Full offline operation through Antigravity. Antigravity may require remote services. End-to-end offline operation is only permitted when every active model and agent adapter is explicitly local-capable and the policy can enforce the requested boundary.

## 3. Architectural principles

1. **Local-first:** The user’s project repository and orchestrator database stay on the local machine by default.
2. **Provider separation:** The reasoning model and the coding agent are different roles and have separate providers, credentials, capabilities, and privacy classifications.
3. **Policy outside the model:** Limits, approvals, workspace boundaries, task transitions, process termination, and budgets are enforced in ordinary application code.
4. **Evidence before success:** The agent’s report is a claim. Git diffs, process exit codes, test logs, build results, and acceptance checks are evidence.
5. **Durable orchestration:** A process restart must not lose task state, user messages, budget counters, project policies, or the reason a task failed.
6. **One active writer per workspace in MVP:** Prevent race conditions from multiple agents writing to the same checkout. Multiple projects can run independently subject to resource limits.
7. **Idempotency:** Replayed events or browser reconnects must not dispatch the same task twice.
8. **Safe defaults, expert controls:** A normal user sees good presets and straightforward language; advanced users can edit detailed settings and policies.
9. **Visible autonomy:** The UI always states what the AI is doing, what it is allowed to do, what it has verified, and why it stopped.
10. **No hidden fallback:** A failed local model must not silently switch to the cloud. A failed preferred agent must not silently run another model or agent.
11. **Reversible work:** Create Git checkpoints or require explicit confirmation if rollback protection is unavailable.
12. **Auditable decisions:** Persist which project policy version, provider, model, prompt version, task definition, and verifier rules were used for each task.
13. **Independent criticism:** Planning, execution, deterministic verification, and review are different stages. The Critic is a separate invocation and cannot waive deterministic failure.
14. **Roadmap is the execution boundary:** executable work must map to an approved roadmap item or approved scope-change proposal; creative exploration creates proposals rather than bypassing approval rules.
15. **Fresh executor context:** every task/repair starts in a new agent session with only the bounded task context needed; session history is not the project memory database.
16. **Task-level Git isolation:** prefer one branch/worktree per attempt, accepted-task checkpoints, and safe rollback of failed isolated work.
17. **Compact role-specific context:** Planner, executor, and Critic receive different purpose-built context packets; do not repeatedly inject the full repository or transcript.
18. **Explicit blocked-interaction handling:** agent permission prompts and questions become visible state with a timeout/pause path, never silent hangs.

## 4. Terminology

- **Project:** A durable user goal, project directory, specification, configuration, memories, and task history.
- **Project Brain / Reasoning Provider:** The LLM that plans, decomposes, prioritizes, reviews, interprets user messages, and proposes subsequent work. This is the role with cloud/local/hybrid configuration.
- **Coding Agent:** A tool capable of inspecting/modifying the code repository and potentially running tools. Antigravity is the initial adapter.
- **Orchestrator:** The trusted local service that persists state, builds prompts, dispatches agent tasks, applies policy, runs verification, and decides whether the loop advances.
- **Constraint:** A rule or preference applied to project behavior, scope, implementation, verification, resources, or permissions.
- **Hard constraint:** Enforced by application code when possible; a model cannot override it by asking.
- **Soft constraint:** A preference that can be traded off by the planner but requires explanation if violated.
- **Acceptance criterion:** A testable definition of project or task success.
- **Human direction:** A message from the user during execution, with explicit priority and effect.
- **Task:** A bounded unit of implementation work with acceptance criteria, risk class, budget, and verification requirements.
- **Run:** One continuous autonomous execution session containing multiple tasks and decisions.
- **Evidence:** Recorded command output, status, diff, test result, screenshot, or other independently collected artifact.
- **Provider capability:** A declared/verified feature such as streaming, structured output, tool calls, image input, or local-only execution.

## 5. Top-level architecture

Use a TypeScript monorepo with a local backend and React web frontend.

```text
┌────────────────────────────────────────────────────────────────┐
│ Browser UI (localhost only)                                    │
│ Dashboard · Project wizard · Constraints · Inbox · Approvals    │
│ Tasks · Diffs · Verification · Provider settings · Logs         │
└───────────────────────────────┬────────────────────────────────┘
                                │ REST + Server-Sent Events
┌───────────────────────────────▼────────────────────────────────┐
│ Local Orchestrator API (Fastify)                               │
│ API validation · Local session/CSRF protection · SSE events     │
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│ Domain services                                                 │
│ Project service · Blueprint importer · Policy engine            │
│ Planner loop · Task state machine · Inbox · Budget service       │
│ Prompt/context builder · Verification runner · Memory manager   │
│ Git manager · Process supervisor · Audit/event recorder          │
└─────────────┬─────────────────────────┬─────────────────────────┘
              │                         │
┌─────────────▼────────────┐  ┌─────────▼────────────────────────┐
│ Reasoning provider layer  │  │ Coding-agent adapter layer       │
│ OpenAI cloud              │  │ Antigravity official CLI         │
│ OpenAI-compatible local   │  │ Future local/other agents        │
│ Hybrid operation router   │  │ Capability and privacy metadata  │
└─────────────┬────────────┘  └─────────┬────────────────────────┘
              │                         │
    OpenAI API or localhost      Controlled child process
              │                         │
              └────────────┬────────────┘
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ Project repository + Git + SQLite + artifact/event files        │
└────────────────────────────────────────────────────────────────┘
```

### 5.1 Suggested stack

Choose stable, maintained packages at implementation time and pin compatible versions in the lockfile.

- Runtime: current Active LTS or Maintenance LTS version of Node.js at implementation time.
- Language: TypeScript with `strict: true`.
- Backend: Fastify.
- Frontend: React + Vite + TypeScript.
- Styling: Tailwind CSS or an equivalent consistent design system; use one approach, not multiple competing systems.
- Database: SQLite with WAL mode and formal migrations; use Drizzle ORM or a similarly typed schema layer.
- Validation: Zod or TypeBox consistently across request payloads and provider responses.
- HTTP/API provider: official OpenAI SDK for OpenAI-specific API calls; native `fetch` or a small adapter for compatible local endpoints.
- Process management: Node `child_process.spawn` or a well-maintained spawn wrapper; do not build commands by concatenating untrusted shell strings.
- Git: execute the Git CLI with argument arrays and explicit working directories.
- Tests: Vitest; React Testing Library; Playwright for a small number of critical end-to-end flows.
- Logs: structured JSON logs with secret redaction; maintain task-specific human-readable logs as artifacts.
- Events: Server-Sent Events (SSE) for UI updates. Persist events so reconnecting browsers can resume from a cursor.

Avoid extra infrastructure such as Redis, Kafka, Docker, or a separate Python service in the initial version unless a tested requirement actually demands it.

## 6. Provider architecture — critical requirement

The application must treat these as separate configurable roles:

1. **Reasoning Provider:** makes plans/reviews/next-task decisions.
2. **Coding Agent Provider:** edits files and runs coding tools.
3. **Verification tools:** deterministic local commands run by the orchestrator.

Do not assume these roles use the same model, API, credentials, or network. A local reasoning model can be paired with a cloud coding agent, but this is **not end-to-end offline**.

### 6.1 Reasoning modes

The wizard and settings must offer three explicit provider policies.

#### A. Cloud

- Send allowed context to the selected cloud provider.
- First implementation: OpenAI Responses API.
- Show the selected model, provider endpoint, data classifications permitted for upload, and that API usage may incur separate usage charges.
- Read the API key from a secret store/environment variable; never send the key to the frontend or include it in logs/prompts.
- Network errors, authentication errors, quota errors, and model-unavailable errors must be shown distinctly.

#### B. Local-only

- All Project Brain operations must call an explicitly configured local endpoint/model or a future native local inference adapter.
- Default accepted endpoint examples include `http://127.0.0.1:11434/v1` (Ollama, if configured with its compatibility interface), `http://127.0.0.1:8080/v1` (`llama.cpp` or another server configured on that port), and a user-configured vLLM endpoint. Endpoints are examples and must not be assumed to be running.
- The user must select the model identifier that the endpoint exposes. The application must use a connection test and model listing where supported.
- If the local server is unavailable, a model is missing, context length is too small, the model fails to respond, structured output fails, or memory is insufficient, **pause or fail the current operation** with a useful diagnostic. Never automatically send the request to a cloud model.
- Clearly explain that local reasoning only localizes the Project Brain. If the active coding agent is Antigravity and it relies on a remote service, the complete process is not offline. Display `Reasoning: Local` and `Coding agent: Remote/Unknown` separately.
- Do not label a profile `end-to-end offline` unless all enabled network-using components are verified local and external execution paths are blocked or declared explicitly by the user.

#### C. Hybrid

- Allow per-operation routing: project planning, task decomposition, code review, repair diagnosis, memory summarization, requirement extraction, and backlog ranking can each use a configured provider.
- Use an explicit routing table; never make an undocumented provider choice.
- Each operation has an allowed data classification. For example, memory summarization could be local, while non-sensitive architecture planning could use a cloud model if allowed.
- Sensitive project data must not go to a cloud route if the configured policy forbids it.
- The UI must preview which provider will receive a given task/context before it is sent, and record provider/model identity in the audit trail.
- If the configured route fails, either stop or use a second explicitly listed fallback route only if the user has enabled it and that route accepts the relevant data classification. Every fallback must be visible in logs and UI.

### 6.2 Data classifications

Implement, at minimum:

- `public`: safe for external provider by project policy.
- `internal`: ordinary project content; external sharing needs a policy allowance.
- `sensitive`: proprietary or confidential source/context; local by default.
- `secret`: tokens, credentials, private keys and secret values; must never be placed into reasoning prompts by the orchestrator. Redact detected values and supply a reference/placeholder instead.

These classifications are policies rather than claims that automatic secret detection is perfect. File-level exclusion patterns and user-specified sensitive paths must be supported.

### 6.3 Local provider API contract

Create a normalized interface, e.g.:

```ts
export type ReasoningOperation =
  | "project_analysis"
  | "requirement_extraction"
  | "task_planning"
  | "result_review"
  | "repair_diagnosis"
  | "memory_summary"
  | "backlog_prioritization";

export interface ReasoningRequest {
  operation: ReasoningOperation;
  systemInstruction: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  responseSchema?: Record<string, unknown>;
  timeoutMs: number;
  maxOutputTokens?: number;
  dataClassification: "public" | "internal" | "sensitive";
  projectId: string;
  taskId?: string;
}

export interface ReasoningResult {
  text: string;
  parsed?: unknown;
  providerId: string;
  modelId: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  durationMs: number;
  requestId?: string;
  warnings: string[];
}

export interface ReasoningProvider {
  id: string;
  displayName: string;
  privacyClass: "cloud" | "local" | "unknown";
  capabilities: ProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
  listModels?(): Promise<ModelInfo[]>;
  generate(request: ReasoningRequest, signal: AbortSignal): Promise<ReasoningResult>;
}
```

The exact API can be refined, but preserve the separation and explicit privacy metadata.

### 6.4 Capability negotiation

Do not assume every OpenAI-compatible endpoint supports every API feature. Track capabilities such as:

- simple text generation;
- streaming;
- JSON mode / JSON-schema-constrained output;
- tool/function calling;
- vision/image input;
- explicit token usage;
- cancellation;
- model listing;
- context size if discoverable.

Use a compatibility strategy: request structured output where supported; otherwise request JSON, parse and validate it locally, retry with a repair prompt a small number of times, and stop if it remains invalid. The model never gets to bypass the schema by returning arbitrary tool instructions.

### 6.5 Supported providers in MVP

- OpenAI API using current supported SDK/API.
- OpenAI-compatible HTTP endpoint with configurable `baseURL`, model ID, optional API key and selected API mode.
- UI presets for common local servers (Ollama, `llama.cpp`, vLLM) that are editable. Do not claim all endpoints expose identical features.
- A future provider adapter can add native APIs without rewriting the planner.

### 6.6 Key/billing UX

- OpenAI API keys must be configured through backend environment/secret settings only.
- Provide a connection test and a provider documentation link. Never expose the complete key after saving; display only a masked suffix if the secret store supports it.
- Clearly state that API billing is separate from ChatGPT subscription billing. Do not imply that a ChatGPT subscription automatically grants arbitrary API credits.
- Add request/usage counters when provider usage data exists; mark costs as estimates if the app computes them from a cached pricing table. If pricing is unavailable, show tokens/requests rather than inventing a cost.
- Hard budgets must block new paid requests before they are sent when costs can be estimated. If provider pricing/usage is unknown, offer a conservative request-count/output-token limit and label the uncertainty.

### 6.7 Privacy boundary and offline claims

At all times show:

- Reasoning provider + model + whether cloud/local/unknown.
- Coding agent + whether local/cloud/unknown.
- Verification/utility commands that may use network access.
- Whether blueprint attachments or source excerpts may be transmitted externally.

A `local-only reasoning` mode guarantees only that the Project Brain adapter will use a local endpoint and will not silently fall back. It does **not** firewall other processes. For an `end-to-end offline` claim, require a separate strict mode that disables cloud reasoning routes and rejects agent adapters marked cloud/unknown; document that system-level firewalling is outside what an ordinary Node process can guarantee. If reliable egress restriction cannot be implemented, say so clearly and do not show a false green offline indicator.

## 7. Coding-agent adapter architecture

### 7.1 Adapter interface

Define a generic `CodingAgentAdapter` with at least:

- `id`, `displayName`, `privacyClass`, and declared capabilities;
- `detectInstallation()`;
- `healthCheck()` / `checkAuthentication()` when possible;
- `startTask(task, workspace, policy, signal)`;
- streamed event callback for progress/logs;
- final normalized result;
- `cancel(runId)` and `dispose()`;
- provider/version/agent-session metadata.

The orchestrator must validate all adapter results against an internal schema.

### 7.2 Antigravity official CLI integration

- Prefer official `agy` CLI/headless mode. At startup, locate the executable, run a safe version/help/capability probe, and parse the installed CLI's supported options. Do not assume the user's installation exactly matches documentation.
- Prefer headless `--output-format stream-json` when supported because it emits newline-delimited events suitable for progress and final-result handling. Parse stdout incrementally line by line; stderr is a separate diagnostics stream.
- The documented stream mode uses `--input-format stream-json` alongside `--output-format stream-json`, with one JSON `user` event per input line. Wait for the current turn's final `result` event before writing the next prompt. Although the CLI may support multiple turns in one process, the orchestrator must default to a fresh CLI/session for every task attempt to prevent transcript bleed and make recovery/auditing bounded. Reuse within one task is allowed only as an explicit advanced option with a strict turn/context cap.
- When invoking a one-shot prompt, use the documented headless form and a structured output/schema option only if the installed version supports it. The adapter must not embed untrusted prompt text in shell command syntax. Use `spawn(executable, args, { cwd, shell: false })` and pass dynamic content through stdin or a safely escaped argument array.
- Never pass a prompt as shell text. Never enable a dangerous permission-bypass flag just to make automation work. The CLI's own permission model is not a replacement for the orchestrator's policy engine.
- The current CLI documentation explains that permission-required tools can be soft-denied in headless mode, while file access inside the active workspace may be allowed; commands such as shell execution may need a prior configured permission rule. Handle this scenario explicitly: collect the denial/error from stderr/events, mark the task `awaiting_agent_permission` or `blocked`, show the requested operation and its scope, and never misread exit code 0 alone as proof that the intended work happened. Support explicit pre-approved allowlists for narrow, low-risk operations; default to asking. Do not enable unrestricted permission bypass. If the agent asks a question or requires an interactive answer in headless mode, persist it as `awaiting_agent_question`, surface it in the dashboard, and pause/timeout safely instead of hanging forever.
- The adapter must separately capture exit code, stdout event stream, stderr, process duration, conversation/session ID, model/agent reported by CLI, token usage if provided, and cancellation reason.
- Handle CLI versions that do not provide streaming by using supported single-response JSON or text mode and marking live progress as unavailable. Do not depend on private IDE database files or browser automation.
- When Antigravity's provider is remote, classify the agent as `cloud` or `unknown` depending on verified configuration; do not label it local merely because the CLI process runs on the computer.
- On timeout/cancel: request graceful termination, wait briefly, then terminate the process tree using a cross-platform process-management abstraction. Ensure child processes do not remain running. Persist the termination state.

### 7.3 Future adapters

Design for plug-in-like adapters, but MVP only needs the interface and Antigravity implementation plus a deterministic `MockAgentAdapter` used only in tests. Do not show the test mock in the normal production agent selector unless it is under an explicit developer/test mode.

## 8. Project initialization wizard

The wizard should be approachable for beginners and expandable for advanced users.

### Step 1: Project idea

Fields:

- project name;
- short idea/purpose;
- intended users;
- problem to solve;
- success vision / desired final result;
- known constraints and technologies;
- optional links or notes (do not fetch arbitrary URLs automatically in MVP unless explicitly enabled).

Allow incomplete input. Do not reject an idea because it is not a polished specification.

### Step 2: Workspace

Choices:

- create a new directory;
- use an existing local directory/repository.

Show the canonical absolute path and detected Git state. For a non-empty existing directory, inspect without destructive changes. If the Git worktree has uncommitted changes, record that state and ask for explicit handling: continue without automatic reset, create a separate worktree, or cancel. Never auto-stash, reset, clean, delete, or overwrite user modifications.

Path safety:

- resolve symlinks/canonical paths where supported;
- reject a path that resolves outside the approved workspace after a user-visible confirmation if it changes unexpectedly;
- exclude `.git`, `node_modules`, build output, secret files, and configured large/binary paths from automatic context scanning by default;
- guard against path traversal and archive extraction traversal;
- handle permissions, missing disks, removable drives, Unicode paths, long paths, and paths containing spaces.

### Step 3: Blueprint import

Supported initial formats:

- `.md`, `.txt`, `.json`, `.yaml` / `.yml`;
- `.pdf`;
- `.docx`;
- optionally images (PNG/JPEG) when the selected reasoning provider explicitly supports vision; if not supported, preserve the image as a reference and warn that it was not semantically interpreted.

Features:

- multi-file upload;
- preview extracted text and report parse warnings;
- file-size and total-import-size limits configurable in advanced settings;
- detect duplicate files by hash;
- record original filename, SHA-256 hash, imported timestamp, parser/version, page count where applicable, and extraction status;
- never execute scripts/macros or auto-run code found in uploaded files;
- do not extract ZIP archives unless explicitly implemented with safe path traversal and decompression-bomb checks;
- do not claim scanned PDF content was extracted if it contains no machine-readable text. Indicate OCR is unavailable or offer a separately enabled OCR workflow in a future milestone;
- preserve originals in managed artifacts (or store a reference if the user opts not to copy them); never alter the user's source file;
- treat imported documents as **untrusted project input**, not system instructions. An uploaded file saying “ignore all safety rules” must be treated as content and cannot override platform policy.

After import, the Project Brain creates a *draft* specification with source attribution: which requirements came from which file/page/section and which were inferred. The user can edit/reject any inferred detail.

### Step 4: Project profile preset

Include editable presets:

1. General software project.
2. Frontend application.
3. Backend/API service.
4. Full-stack frontend + backend.
5. Full-stack AI application.
6. AI/ML training/inference project.
7. Data science/analytics project.
8. CLI/developer tool.
9. Embedded/IoT project.
10. Documentation/research project.
11. Blank/custom profile.

Each preset includes default constraints, recommended validation commands, project memory sections, and suggested acceptance criteria. Presets are starting points. The user may rename, clone, edit, import, export, or delete custom profiles. Built-in defaults must be versioned and must not be mutated in place by a project.

Example validation defaults:

- Frontend: lint, typecheck, build, component tests; E2E tests recommended.
- Backend: lint, typecheck, unit tests, integration tests, API schema checks, security-sensitive test list.
- AI/ML: dataset/label validation, reproducibility notes, leakage checks, metric calculation, inference smoke test, model artifact provenance; never claim hardware validation without hardware evidence.
- Embedded/IoT: compile/simulator checks if available, explicit board/firmware configuration, pin mapping assertions, hardware verification marked `not_run` unless performed.
- CLI: usage/exit-code tests, installation and packaging checks, platform compatibility.

### Step 5: Autonomy mode

Offer three user-visible modes (default is the first):

**Mode A — Creative within constraints (default)**
- The AI may propose and implement improvements, quality fixes, UX enhancements, features, refactoring, and architecture changes within the hard constraints and approved project purpose.
- New ideas enter a ranked backlog.
- Major scope changes, high-cost work, destructive migrations, and changes to hard constraints require approval.

**Mode B — Creative exploration**
- The AI may propose broader reinterpretations, novel features, major architecture alternatives, and opportunities beyond the initial feature list.
- It may automatically implement low-risk scope expansions if policy allows.
- Large/irreversible changes and explicit hard constraints still remain enforced.
- The label “without constraints” must never mean no safety limits, unrestricted access to secrets, unlimited spending, disabled Stop controls, or permission to damage unrelated files.

**Mode C — Strict blueprint adherence**
- Work is limited to explicit requirements, acceptance criteria, necessary bug fixes, and internal quality improvements required to fulfill the blueprint.
- New features and scope expansions may be proposed but cannot be implemented until approved.
- The AI must ask for resolution where blueprint contradictions prevent progress.

### Step 6: Constraints and resources

Show a standard settings view with beginner controls, plus an Advanced mode for detailed configuration. All settings should show the current effective value and its source (preset, project override, global default).

### Step 7: Generated plan review

Before starting autonomous execution, the reasoning provider must generate:

- structured project specification;
- in-scope and out-of-scope statements;
- assumptions and confidence;
- requirement list with IDs, source provenance, priority, and verification method;
- architecture proposal and open decisions;
- acceptance criteria;
- milestone/task roadmap with dependencies;
- baseline validation commands;
- inferred constraints (clearly labeled as inferred);
- known risks and blocked items.

The user can edit or approve these items. The system must not start modifying project files until the initialization plan is approved, except writing orchestrator-owned project metadata to its dedicated directory.

## 9. Constraint and policy engine

This is a core subsystem, not just a prompt template.

### 9.1 Constraint classes

- `hard`: must never be violated by task planning or tool execution.
- `soft`: optimization preference that may be traded off with an explanation.
- `informational`: context to be considered, not an enforced rule.

Each constraint has: `id`, `name`, `description`, `type`, `scope`, `value` or predicate, `source`, `enabled`, `severity`, `createdAt`, `updatedAt`, `version`, and optionally `requiresApprovalToChange`.

Scopes should include:

- product scope;
- architecture/technology;
- file/workspace boundaries;
- privacy/data sharing;
- dependencies/licenses;
- quality/testing;
- performance/resource usage;
- runtime/budget;
- shell/tool permissions;
- external actions;
- documentation;
- project-specific custom rule.

### 9.2 Priority hierarchy

Apply precedence in this order:

1. Platform safety and authorization boundaries.
2. Explicit user-configured hard constraints.
3. Latest approved project requirements and acceptance criteria.
4. Selected autonomy mode and soft preferences.
5. AI-generated recommendations.

The model cannot edit a higher-priority layer by emitting text. Any constraint change is a user-visible, versioned operation. A human may change their own constraints, but high-impact changes must be shown and recorded before taking effect.

### 9.3 Contradictions

Examples: blueprint requires a cloud database but user selects offline-only; performance target conflicts with a hard memory cap; strict mode conflicts with a request for a new feature.

Expected behavior:

- detect contradictions during initialization and when settings change;
- explain the exact conflict in plain language;
- present 1–3 reasonable resolution options with consequences;
- keep execution blocked for that dependent work until resolved;
- do not silently pick the latest string or invent an override;
- preserve prior configuration version and an audit event.

### 9.4 Constraints must have enforcement strategy

For every hard constraint, store an enforcement kind:

- `application`: checked in orchestrator logic;
- `filesystem`: path containment/access policy;
- `process`: executable/argument allowlist, timeout, environment control;
- `verification`: test or command result;
- `prompt_only`: advisory only and cannot qualify as security enforcement.

If a user defines a hard constraint that can only be expressed as prompt text, warn them that it cannot be reliably enforced by the application. Do not present prompt-only rules as secure.

### 9.5 Built-in hard limits

Even in Creative Exploration mode, the following remain active:

- manual Stop and Pause controls remain functional;
- no access outside approved project roots except explicitly selected input/output paths;
- no reading or transmitting secrets by default;
- no public network binding by default;
- no silent fallback to cloud in local-only mode;
- no destructive Git cleanup/reset or external deployment without approval;
- finite task, time, and resource budgets;
- no arbitrary programmatic changes to the orchestrator's own safety policy by the coding agent;
- no modification/deletion of orchestrator-owned database files from coding-agent workspace context;
- no external side effects without explicit permission.

### 9.6 Roadmap traceability and drift prevention

Every executable task must carry `roadmap_item_id` or `approved_scope_change_id`, plus the relevant requirement IDs and acceptance-criterion IDs. If neither reference exists, the task is a proposal and must not be dispatched.

- `Strict blueprint adherence`: only approved roadmap work and necessary defect fixes may execute. New features remain proposals until approved.
- `Creative within constraints`: the Planner may create proposals and may auto-approve only explicitly configured low-risk categories (for example, small refactors or missing tests directly tied to a requirement). Any new user-facing feature, new external service, dependency with material licensing/security implications, data migration, major architecture change, or material scope/budget increase requires approval unless the user explicitly configured a narrower, enforceable rule.
- `Creative exploration`: the Planner can propose broader reinterpretations, but the same roadmap gate applies. Policy may auto-approve only defined low-risk proposals; major expansions remain approval-gated.
- A task not in the approved roadmap is rejected before dispatch with `OUT_OF_SCOPE` and a proposal record. Never let a task smuggle unrelated changes under a vague “improve everything” objective.
- Before dispatch, compare proposed scope against `SPEC.md`, `DECISIONS.md`, `ROADMAP.md`, current repo map, hard constraints, and prior rejected proposals.
- Updates to `SPEC.md`, `DECISIONS.md`, architecture decisions, or hard constraints must be emitted as proposed diffs with provenance. They become canonical only after Critic checks and the required human/policy approval.
- Replanning must be versioned and diffed. Preserve completed roadmap items and rejected proposals; do not rewrite history to make scope drift look approved.

## 10. Completion criteria and stopping rules

Completion is a policy result, not a model’s subjective opinion.

### 10.1 Project completion requires

- all mandatory acceptance criteria are marked verified;
- all required verification commands have run and passed;
- no unresolved blocker prevents the advertised purpose from working;
- the final code diff is inspected and no forbidden paths/actions are observed;
- required documentation is updated;
- the final completion report identifies evidence and remaining limitations;
- any user-configured mandatory approval has been collected.

The app may permit a user to define a less strict completion policy, but it must display the consequences. Do not mark as fully verified when required checks were skipped.

### 10.2 Other terminal/paused outcomes

- `completed`: required criteria passed.
- `completed_with_warnings`: required criteria passed but optional checks/issues remain, with the user's policy permitting this result.
- `blocked`: missing information, credentials, unavailable hardware, contradictory requirements, or repeated failure blocks progress.
- `budget_exhausted`: iteration/time/API/request budget reached.
- `stalled`: no meaningful progress after configurable repeated attempts or cyclic failures.
- `paused_by_user`: suspended intentionally.
- `stopped_by_user`: user asked the system to stop.
- `failed`: unrecoverable orchestration/provider/database/process failure.
- `canceled`: a queued task/run was canceled before completing.

An iteration cap is not proof of completion. If an agent claims “done” before criteria are satisfied, keep the project open and schedule a missing-criteria task or pause it as blocked.

### 10.3 Budget controls

Budget enforcement is an orchestration responsibility, not a prompt suggestion. The first end-to-end vertical slice must have working request/task/run ceilings before it is allowed to run autonomously.

At minimum support:

- maximum total iterations and tasks per run;
- maximum attempts and repair attempts per task;
- per-task and per-run wall-clock limits;
- per-provider request limits, output-token limits, and context-token limits where supported;
- estimated spend ceilings for providers with known pricing;
- request-count/token ceilings for providers whose cost/quota is not observable;
- maximum concurrent active projects/processes;
- maximum log/artifact size and retention;
- a cost reserve for the remaining Critic and configured repair attempts;
- a hard check immediately before every paid/provider call and before dispatching a coding-agent task.

Defaults must be finite and visible. Show a warning before limits are reached. When a hard limit is reached, do not start another paid call or task; persist the reason and offer an explicit user-visible resume/configuration action. A currently running request cannot always be interrupted at the exact financial boundary, so reserve its maximum configured input/output exposure before dispatch when the provider supports such estimation.

#### 10.3.1 Cost estimation: formula, default caps, and honest uncertainty

The MVP must expose a cost estimate before starting a run and a live actual/estimated cost ledger during execution. The estimate includes every model call, not just the executor:

- Planner call(s);
- coding-agent/provider usage when that usage is measurable;
- Critic call(s);
- every repair/replan cycle, including its new executor and Critic calls;
- optional vision/screenshot review, embeddings, summaries, and other model calls;
- any provider-specific billed tool use exposed by the provider.

For a token-billed provider, estimate each call using its configured pricing entry:

`estimated_cost = (input_tokens × input_price_per_million / 1,000,000) + (cached_input_tokens × cached_input_price_per_million / 1,000,000) + (output_tokens × output_price_per_million / 1,000,000) + known_tool_charges`

Sum the estimated cost across all planned calls, add a configurable uncertainty reserve, and include the maximum allowed repair budget. Store the pricing catalogue with a `checked_at` timestamp and source URL. Do not hard-code provider pricing as if it were permanent. Allow advanced users to override per-million-token prices or enter custom provider billing assumptions. If current pricing is not available, say so and use user-supplied prices, token/request ceilings, or a conservative estimate labelled `estimate only`.

Illustrative planning ranges—not a price quote or guarantee:

| Task shape | Approximate model-API spend to budget | Notes |
|---|---:|---|
| Small, one-file change using a compact model, with no repair | $0.05–$0.50 | Short context, one executor pass, one Critic review; actual price varies materially by model and context |
| Ordinary multi-file feature with Planner, Executor, Critic and zero or one repair | $0.25–$2.00 | Includes repeated review and relevant diffs/test output |
| Large feature, long context, premium models, vision review, or two repair attempts | $1.00–$10.00+ | Can exceed this range for large contexts or expensive models |
| Local inference | $0 direct API charge in normal local serving | Does not mean zero electricity, hardware, time, or hosting cost |
| Antigravity CLI / third-party coding agent | Unknown unless the supported adapter exposes billable usage | Subscription/quota use may not translate to per-task dollars; enforce request/session/iteration ceilings and label monetary cost `not observable` rather than fabricate one |

These ranges are deliberately approximate. The UI must calculate an estimate from the selected model's current configured rate and the task's estimated token usage whenever possible. The UI must not present the table above as a provider quote.

**Beginner defaults for cloud API reasoning** (editable during initialization and globally):

- soft per-task warning budget: **$0.50**;
- hard estimated/known per-task ceiling: **$2.00**;
- hard per-run ceiling: **$10.00**;
- warn at **70%** of a soft/hard ceiling and again at **90%** of the run ceiling;
- maximum **2 repair attempts** per task;
- maximum **12 reasoning-model calls per task** across Planner/Critic/replanning/repair, unless a lower budget is reached first;
- maximum **40 reasoning-model calls per run** as a fallback guard;
- maximum **20 tasks per run** and **30 total iterations per run** by default.

These are conservative starter settings, not universal optimums. The estimated hard task limit is checked against the *reserved worst-case estimate* for the configured task attempt, not only the spend already recorded. An advanced user may change them, but raising a cap must never remove hard process/security permissions.

Before dispatch, show a compact breakdown such as: `Planner: 1 call; Executor: 1 session (provider cost unknown); Verifier: local; Critic: 1 call; repair reserve: 2 × (Executor + Critic); estimated reasoning cost: $X–$Y; hard run cap: $10`. Require explicit user confirmation if the estimate exceeds the configured threshold or cannot be estimated and the selected policy requires cost visibility. The user can choose a local provider, smaller/cheaper model, fewer repairs, a reduced context budget, or a larger cap.

**Cost usage states:** `measured` when provider usage/cost is reported; `estimated` when calculated from actual token usage and configured rates; `reserved` for future calls not yet executed; `unknown` when billing is not observable; `local_no_api_charge` for local inference. Never merge unknown cost into `$0`.

For subscriptions/quota-based CLI tools that do not expose dollar usage, separately show provider identity, task/session/call counts, run duration, and quota/limit errors. The orchestrator may enforce its own task, session, request, token-estimate, and time limits, but it must not claim to hard-cap an external subscription's billing when the provider offers no such control.

The budget service must be unit-tested with multi-call sequences, repair reserves, price changes, missing prices, cached tokens, canceled calls, quota-based providers, and concurrent starts. Concurrent requests must atomically reserve budget so two workers cannot overspend the same remaining balance.

### 10.4 Stagnation/cycle detection

Detect patterns such as:

- the same verification command fails with materially equivalent output repeatedly;
- the same task is repeatedly created with no new hypothesis;
- a task keeps changing and reverting the same files;
- acceptance criteria/roadmap make no progress across a configured window;
- provider responses repeat an equivalent plan without new evidence.

Use deterministic hashes and task history where possible; an LLM may classify semantic similarity but cannot be the only guard. After the configured threshold, stop and create a blocker report rather than looping forever.

Required signals include: identical failing command/output hashes; semantically equivalent errors after normalization; repeated edits that revert or oscillate the same lines; consecutive no-diff attempts; repeated unchanged task proposals; acceptance criteria with no state transition; repeated agent permission denials; same question asked more than once without new context; reviewer repair requests ignored by the next attempt; and a task bouncing between `repair` and `accept` without verifier changes. Track these per task and across the run. Default starting thresholds: 2 consecutive no-diff attempts, 3 materially equivalent verification failures, or 3 edit-ping-pong detections. Make thresholds configurable. On threshold breach, stop automatic retries, preserve all evidence, mark the task/run `stalled`, and show a choice to retry with a changed strategy, edit the task, select another provider, or ask a human.

## 11. Autonomous development loop

Use an explicit state machine. Do not implement an infinite `while (true)` loop with loosely defined prompt calls.

### 11.1 Run-level states

`draft -> ready -> running -> pausing -> paused -> running -> completing -> completed`

Terminal/alternative states: `blocked`, `budget_exhausted`, `stalled`, `stopped`, `failed`.

### 11.2 Task states

`draft -> queued -> planning -> dispatching -> running -> collecting -> verifying -> critic_reviewing -> integrating -> succeeded`

Other states: `needs_approval`, `awaiting_agent_permission`, `awaiting_agent_question`, `retry_wait`, `rollback_pending`, `quarantined`, `blocked`, `failed`, `canceled`. `reviewing` may be retained as a compatibility alias during migration, but all new code should use `critic_reviewing`.

A task in `awaiting_agent_permission` or `awaiting_agent_question` is paused for a specific user action and has a configurable interaction timeout. It must not be treated as a successful/failed ordinary execution or remain hidden as “running”. `rollback_pending` records that failure artifacts have been preserved and the isolated worktree is being discarded/reverted. `integrating` means all acceptance gates passed and the task checkpoint is being incorporated into the orchestrator-managed project branch.

Every transition must be validated by a state transition service and recorded as an event. Invalid transitions return a domain error and cannot be forced by the frontend.

### 11.3 One cycle — mandatory Planner → Executor → Verifier → Critic pipeline

1. Acquire the project/workspace lock and recover any stale dispatch marker before doing new work.
2. Check run state, Stop/Pause flags, pending human directions, budgets, provider health, permissions, and hard constraints. No new provider request or agent process may begin if the run is stopped, blocked, over budget, or awaiting an approval that governs the action.
3. Load the canonical `SPEC.md`, `DECISIONS.md`, approved `.orchestrator/ROADMAP.md`, `.orchestrator/REPO_MAP.md`, current state, outstanding blockers, last configured N task summaries, and any unconsumed human direction.
4. The Planner proposes one bounded task in a validated JSON contract. It must cite approved roadmap item(s), requirement IDs, and acceptance criteria. An unapproved idea becomes a scope-change proposal, not an executable task.
5. Run deterministic scope/policy validation on the proposed task: permitted paths, allowed commands, provider data classification, risk, resource budget, dependency/version changes, required approvals, and roadmap traceability. Reject or queue for approval if any rule fails.
6. Persist the task, policy/config versions, input/context hashes, prompt-template version, provider route, and idempotency key before any dispatch.
7. Run Git preflight. For a supported, clean Git baseline, create a task/attempt-specific worktree and branch from the last verified orchestrator integration commit. Never run `reset`, `clean`, `stash`, or destructive checkout commands on the user’s existing working tree to achieve isolation. If isolation cannot be made safe, pause and ask the user to choose a safe alternative.
8. Build a fresh executor context containing only the task contract, relevant file map/snippets, relevant SPEC/DECISIONS/ROADMAP excerpts, approved hard constraints, explicit allowed paths/commands, verification requirements, and concise relevant failure history. Start a new coding-agent session for this task attempt; do not reuse the prior task’s open conversation by default.
9. Dispatch the task to the coding-agent adapter. Stream events to the dashboard and persist bounded logs. Handle permission-required events, questions, soft denials, authentication prompts, and missing capabilities as explicit states. A headless CLI exit code of zero is not task success.
10. On completion, timeout, crash, cancellation, question, or permission denial, collect the process exit code, agent result, stdout/stderr, actual session ID, timing, reported files, actual Git status/diff, changed-path set, and any usage/cost metrics.
11. Independently run all configured mandatory verification commands through the orchestrator: at minimum the project's configured lint, type-check, test, and build commands. Record exact argv, cwd, environment policy, start/end, exit code, output artifact/hash, timeout/truncation, and whether each check was passed/failed/not configured/not run. Do not use the agent’s claimed test results instead. Do not add arbitrary commands from model output to the allowlist.
12. Apply deterministic policy gates to the collected diff: forbidden paths, secret exposure, unexpected dependency/lockfile changes, symlink/path escape, unapproved scope, orchestrator metadata tampering, and user-change overlap. A gate failure cannot be waived by either LLM.
13. Invoke the Critic as a separate model call with a separate system prompt and schema. Give it the task contract, canonical project context, actual diff summary/patch artifact, verifier evidence, prior relevant decisions, and actual agent report. Do not show it the Planner’s preferred acceptance verdict. The Critic checks each criterion, requirements traceability, scope drift, quality risks, missing evidence, and whether another bounded repair is justified.
14. Apply the final acceptance gate in ordinary code: all mandatory checks pass; task criteria have evidence; the Critic verdict permits acceptance; roadmap/policy gates pass; required approvals are complete; and the task commit/integration checks are safe. Neither Planner nor Critic can override this gate.
15. If accepted, write a task checkpoint commit in the isolated task branch, then fast-forward/integrate into the orchestrator-managed project branch only if its baseline is unchanged and integration is safe. If integration conflicts or the base moved, keep the verified task branch and request explicit resolution; never force-push or auto-resolve by discarding user changes.
16. If verification/critic/policy fails, preserve report, logs, diff/patch, and verification artifacts first. Mark the attempt failed/rejected and automatically discard the failed isolated worktree/branch from the active execution path. A bounded repair attempt starts a fresh session and fresh isolated worktree by default, using the prior patch and failure evidence only as read-only context; it must not inherit unverified changes unless an advanced explicit setting allows it.
17. Update `SPEC.md`, `DECISIONS.md`, `ROADMAP.md`, `REPO_MAP.md`, and `CURRENT_STATE.md` only through the memory-update rules below. Record facts as verified/user-specified/inferred/proposed/rejected/unknown. The Critic’s review result and deterministic evidence remain separate artifacts.
18. Re-check human directions, Stop/Pause, approvals, the task budget, and run budget before scheduling any next action. Write a pause/final summary with evidence references.

### 11.4 Work isolation

- **Default:** one branch and Git worktree per task attempt whenever the repository has a safe committed baseline. Use predictable branch names such as `orchestrator/<project-id>/<task-id>/attempt-<n>`; validate and sanitize identifiers before passing them to Git.
- Maintain an orchestrator-managed integration ref/branch from the selected baseline. Task worktrees start from the latest verified integration commit, not from uncommitted edits in the user's checkout. Display the integration branch clearly.
- **Every accepted task gets a checkpoint commit** after mandatory verification, Critic acceptance, and path/policy checks. Commit messages should include the task ID. The accepted checkpoint is then fast-forwarded into the orchestrator integration ref only if the base has not moved and no conflict or unapproved change exists. Never push automatically. Do not modify a protected/user branch without the configured permission.
- **Automatic rollback on failed isolated attempts:** preserve the diff/patch, agent report, logs, verification artifacts, and Critic verdict; then remove the failed attempt worktree from the active path and mark its branch/artifacts recoverable according to retention policy. This is rollback of the isolated attempt only—not a reset of the user checkout. The next repair attempt starts from the last verified integration commit by default.
- If a repair strategy explicitly continues from a failed branch, the user must enable this advanced behavior; the patch is still unverified and remains isolated.
- For a dirty existing checkout, never auto-stash, reset, clean, or overwrite it. Prefer creating an integration worktree from its current committed HEAD while leaving uncommitted changes untouched, and disclose that the agent will not see those uncommitted changes unless the user explicitly creates an approved snapshot or imports selected files. If the task depends on those changes, pause for a decision.
- If Git is unavailable or the workspace is not a repository, ask the user to initialize Git or explicitly opt into reduced-protection mode. Do not silently proceed as if rollback is possible.
- If baseline isolation, worktree creation, or rollback safety cannot be verified, move the task to `needs_approval`/`blocked`; no destructive fallback.
- If the project branch or user checkout changes while a task runs, detect the changed base hash before integration and stop for reconciliation. Never merge over concurrent user edits.
- One active writer per workspace in MVP. Do not run concurrent coding agents in the same checkout/worktree.

### 11.5 Rate limits, retries, and agent interaction deadlines

- Use bounded exponential backoff with jitter for transient network/timeout/temporary provider failures and honor `Retry-After` where available. Use provider-specific concurrency limits and a per-provider circuit breaker/cooldown after repeated failures.
- Never retry invalid credentials, quota exhaustion, policy denial, malformed task contracts, or hard constraint violations indefinitely. Surface the exact category and the next safe user action.
- A retry is a persisted attempt with its own ID, provider metadata, cost budget, prompt hash, session ID, Git worktree, verifier run, and result. Replaying an HTTP request or recovering after a crash must not duplicate an attempt.
- Agent permission requests and questions have an explicit configurable timeout. The default action on timeout is to pause/mark blocked, not to approve automatically. Allow user-configured pre-approval only for narrow, auditable action classes such as read-only workspace operations or specifically allowlisted test commands. Never auto-approve unrestricted shell, access to secrets, paths outside the workspace, new network endpoints, deployments, destructive operations, or permission-bypass flags.
- If the adapter indicates a permission was soft-denied in headless mode, treat the task as incomplete/blocked even if the process exits zero. Show the denied action and a button to grant a scoped permission, retry, or abandon.
## 12. Human-in-the-loop message system

The human can send directions at any time from the dashboard. This is separate from the model-generated task prompt and must be recorded as durable data.

### 12.1 Message types

- `idea`: possible new feature/improvement.
- `requirement`: explicit new or modified requirement.
- `priority`: change backlog ordering.
- `correction`: clarify an incorrect assumption or implementation.
- `scope_change`: add/remove significant functionality.
- `pause`: stop new work and pause at a safe checkpoint.
- `interrupt`: request graceful stop of current task; may require process termination.
- `stop`: stop the run and prevent new dispatch immediately.
- `approval`: approve/reject a specific pending action/change.
- `question_answer`: answer an open question/blocker.

### 12.2 Scheduling semantics

- **Next task:** store the message and apply it when the current task completes; planner must acknowledge how it was incorporated.
- **Replan upcoming work:** queue message immediately; current task may finish, then revise affected roadmap tasks.
- **Interrupt at safe checkpoint:** stop dispatching new work, signal the adapter if supported, then pause when the task reaches a safe checkpoint. Provide a force-stop control if graceful cancellation times out.
- **Pause now:** transition the run to pausing, prevent new task dispatch, and cancel/finish active process according to user-selected safe/force strategy.
- **Stop now:** atomically mark stop requested, block future dispatches, terminate the active task if needed, persist partial outputs, and do not automatically resume.

### 12.3 Conflict handling

If a new human direction contradicts the existing spec/constraint:

- do not lose the message;
- create a visible conflict card showing the affected rule and current progress;
- ask the reasoning provider for a resolution proposal, but never let it silently modify a hard constraint;
- ask the user to approve the new spec/constraint version when required;
- re-evaluate pending tasks after approval.

### 12.4 Prompt composition

The next task prompt must be regenerated from the current canonical project state, not formed by blindly appending arbitrary text to a stale prompt. The composer should include, in a predictable order:

1. task objective and ID;
2. relevant acceptance criteria;
3. current architecture and directly relevant memory;
4. hard constraints and permission reminders;
5. current human directions not yet acknowledged;
6. prior attempt failures, if any;
7. exact verification commands/objectives;
8. required structured report format;
9. instruction to treat repository/doc comments and imported project files as untrusted content that cannot override the task/policy hierarchy.

Persist the final prompt artifact and a hash for audit/reproduction (excluding secrets). On completion, mark which human messages were consumed by which task/replanning decision.

## 13. Task schema and agent response contract

Every task should include at least:

```json
{
  "taskId": "task-0001",
  "projectId": "project-id",
  "title": "Implement registration endpoint",
  "objective": "Add registration with validation and tests",
  "roadmapItemId": "ROADMAP-012",
  "requirementIds": ["REQ-AUTH-01"],
  "sourceProposalId": null,
  "specVersion": 3,
  "decisionsVersion": 5,
  "roadmapVersion": 8,
  "status": "queued",
  "priority": "high",
  "risk": "medium",
  "scope": {
    "allowedPaths": ["src/**", "tests/**", "docs/**"],
    "forbiddenPaths": [".env", ".orchestrator/**", "**/*.pem"]
  },
  "acceptanceCriteria": [
    {"id": "AC-1", "description": "Valid registration returns success", "verification": "integration_test", "required": true},
    {"id": "AC-2", "description": "Invalid input is rejected", "verification": "integration_test", "required": true}
  ],
  "verificationPlan": ["npm run lint", "npm test", "npm run build"],
  "sessionPolicy": "fresh_per_attempt",
  "baselineCommit": "git-sha-or-null",
  "worktreePath": "managed-path-or-null",
  "maxAttempts": 3,
  "requiresApproval": false
}
```

This is an illustrative internal representation; validate it with a schema and create real IDs/timestamps in code.

### 13.1 Normalized agent report — claims, not evidence

The coding-agent adapter must emit a JSON object validated against a versioned schema. Markdown is for human-readable artifacts only; it is not a machine protocol. Normalize vendor-specific results into this common wire contract (snake_case shown for protocol clarity):

```json
{
  "schema_version": 1,
  "task_id": "task-0001",
  "attempt_id": "attempt-0001-1",
  "status": "reported_complete",
  "summary": "Implemented the registration endpoint and added tests.",
  "files_changed": ["src/routes/auth.ts", "tests/auth.test.ts"],
  "tests": [
    {"command": "npm test", "agent_claim": "passed", "claimed_exit_code": 0}
  ],
  "blockers": [],
  "questions": [],
  "suggestions": ["Add registration rate limiting"],
  "requires_human": false,
  "agent_session_id": "vendor-session-id-or-null"
}
```

`files_changed` and `tests` above are agent-reported claims. The orchestrator independently obtains the real changed-file list and runs checks itself. Keep both records rather than overwriting a claim with verified evidence. Unknown fields should be rejected or safely ignored according to the schema compatibility policy; never execute a command merely because it appears in a report. Missing or invalid required fields produce a structured protocol error and a bounded repair/retry policy.

### 13.2 Planner output schema and role boundaries

The Planner proposes work and controls roadmap planning; it does **not** approve its own implementation results. Its machine response must validate against a schema equivalent to:

```json
{
  "schema_version": 1,
  "decision": "dispatch_task",
  "rationale": "ROADMAP-012 is the highest-priority eligible item.",
  "next_task": {
    "task_id": "task-0002",
    "roadmap_item_id": "ROADMAP-012",
    "requirement_ids": ["REQ-AUTH-01"],
    "title": "Implement registration validation",
    "objective": "Validate registration payloads and return documented errors.",
    "allowed_paths": ["src/routes/**", "tests/**"],
    "acceptance_criteria": [
      {"id": "AC-1", "description": "Invalid payload returns a 4xx response", "required": true, "verification": "integration_test"}
    ],
    "verification_plan_ids": ["lint", "tests", "build"],
    "risk": "medium",
    "estimated_cost_usd": null,
    "requires_approval": false
  },
  "roadmap_proposals": [],
  "open_questions": [],
  "stop": false,
  "stop_reason": null
}
```

The planner's allowed top-level decisions are `dispatch_task`, `replan_proposal`, `needs_human`, `no_eligible_work`, and `stop`. `next_task` must be `null` unless `decision` is `dispatch_task`. A dispatch task without an approved `roadmap_item_id` is rejected by the orchestrator. The Planner may propose roadmap/spec/decision edits, but cannot commit them as canonical truth itself. The orchestrator validates IDs, roadmap status, required fields, budgets, and policy before state transition.

The Planner must consult the current `SPEC.md`, `DECISIONS.md`, approved `.orchestrator/ROADMAP.md`, `.orchestrator/REPO_MAP.md`, current state, recent reports, and unresolved issue list on each planning call. The Planner may not claim to have inspected files or run tests unless an evidence artifact says so.

### 13.3 Independent Critic schema and acceptance rules

The Critic is a separate role and call after the deterministic verifier. The MVP must use a Critic-specific system prompt and schema even if the same configured model serves both Planner and Critic. The UI must disclose when both roles use the same model; advanced users can configure a different model/provider for stronger model diversity. For high-risk task classes, policy may require a distinct critic provider/model and block acceptance until one is configured.

The Critic gets the approved task contract, exact relevant `SPEC.md`/`DECISIONS.md`/roadmap excerpts, actual diff and changed-file evidence, verifier outputs and exit codes, and the coding agent's normalized report. It must **not** receive the Planner's preferred acceptance/rejection verdict before forming its own verdict. It does not get authority to waive hard policies or failed mandatory checks.

Expected output schema:

```json
{
  "schema_version": 1,
  "task_id": "task-0002",
  "attempt_id": "attempt-0002-1",
  "verdict": "repair",
  "criteria": [
    {"criterion_id": "AC-1", "status": "failed", "evidence_ids": ["verification-17"], "reason": "The invalid-payload integration test fails."}
  ],
  "scope_drift": {"detected": false, "details": []},
  "quality_findings": [
    {"severity": "medium", "finding": "Error response is not documented", "evidence_ids": ["diff-8"], "suggested_action": "Document the response schema"}
  ],
  "missing_evidence": [],
  "repair_instructions": ["Fix the payload validation failure and rerun the configured tests."],
  "roadmap_or_spec_proposal": null,
  "requires_human": false,
  "rationale": "A mandatory acceptance criterion is not met."
}
```

Allowed Critic verdicts are `accept`, `repair`, `reject_out_of_scope`, `needs_human`, and `stop`. Schema-invalid Critic responses are not accepted; retry the Critic call at most the configured bounded number, then pause as blocked. Every criterion must be addressed. `accept` from the Critic is necessary but not sufficient. The ordinary-code final gate must also prove that mandatory verifier checks pass, no hard policy violation exists, scope is approved, required approvals are complete, and integration is safe. If the Critic disagrees with a passing test, it may identify a qualitative issue or propose extra work; it cannot falsely mark the verifier as failed without evidence, nor can it waive mandatory failed checks.

### 13.4 Final acceptance gate (deterministic policy)

A task succeeds only if all of these conditions are true:

1. Task references an approved roadmap item or approved scope-change proposal.
2. All required task acceptance criteria have verifier evidence.
3. All configured mandatory checks (lint, typecheck, tests, build, and any profile-required security check) are `passed`; missing command configuration must be surfaced and resolved or explicitly waived by a user-authorized project policy before execution begins.
4. The actual changed-path set is within allowed scope; no forbidden secret/policy/system file or unapproved dependency/external service change is present.
5. Critic verdict is `accept`, with every mandatory criterion reviewed.
6. No unresolved approval, agent permission request, question, or hard constraint conflict remains.
7. Git checkpoint/commit succeeds and integration into the orchestrator branch is safe; otherwise the task remains verified-but-not-integrated and requires recovery.

The acceptance gate is normal application code with unit tests. No LLM can override it.

## 14. Verification subsystem

The verifier is independent from the Project Brain and coding agent.

### 14.1 Check types

- formatter;
- linter;
- type checker;
- unit tests;
- integration tests;
- build/package check;
- end-to-end/UI tests;
- API/schema validation;
- dependency/license/security scan where configured;
- task-specific scripts;
- browser-functional checks (navigation, visible elements, user interactions, browser console and network failures);
- screenshot and visual-regression evidence at configured viewports where relevant;
- accessibility smoke checks where configured;
- visual evidence such as a screenshot where relevant;
- manual/hardware check, which must remain `not_run` unless actually performed.

### 14.2 Command policy

- Verification commands are configured by project/profile and reviewed during initialization.
- Avoid arbitrary model-supplied shell commands. A task can suggest a new command, but adding it to the allowed verification list requires policy approval (automatic for a narrowly permitted, low-risk rule if explicitly enabled).
- Invoke executables with `shell: false` and argument arrays. Do not interpolate model/user text into shell syntax.
- Set explicit `cwd`, environment allowlist, timeout, output cap, and cancellation signal.
- Never pass provider API keys or unrelated secrets into child processes. Create a clean environment and only include known-required variables.
- Record skipped checks separately from failed checks. `not_run` must not be rendered as passed.
- Cap output and preserve truncation metadata; avoid loading multi-gigabyte logs into model prompts.

### 14.3 Diff and filesystem checks

After every agent task:

- collect `git status --short` and diff summary when Git is available;
- detect changes outside permitted paths;
- detect modifications to `.orchestrator`, secret paths, and policy files;
- flag added executables, lockfile changes, dependency changes, generated binaries, unexpected large files, and symlink changes;
- compute before/after file lists where practical;
- require approval or revert only the agent's isolated task changes for forbidden paths. Never automatically discard pre-existing human changes;
- do not automatically revert an unknown mixed diff if the baseline cannot be safely established—pause and ask the user.

### 14.4 Verification verdict

A task is accepted only if:

- mandatory checks passed;
- task acceptance criteria have verification evidence;
- no hard policy violation is detected;
- no required approval is pending;
- the agent result is structurally valid enough to interpret;
- the independent Critic returns `accept`; and
- the task checkpoint is committed/integrated safely under Git policy.

The LLM Critic can identify additional quality concerns but cannot turn a failed mandatory check into a pass. It is a second judgment layer, not a substitute for executable evidence.

### 14.5 Required independent verification sequence

For every task attempt, the orchestrator must run this sequence even if the coding agent reports that it already did so:

1. Capture pre-task and post-task Git status/diff, changed paths, and baseline commit hash.
2. Run the configured mandatory linter.
3. Run the configured type checker if one exists or the profile marks it required.
4. Run the configured unit/integration tests required by policy.
5. Run the configured production build/package command.
6. Run additional task/profile checks such as schema validation, security/license checks, browser tests, or ML evaluation as configured.
7. Persist raw bounded output as artifacts and normalized status records, including actual argv, working directory, exit code, timeout, duration, output truncation, and command-definition version.
8. Compare every acceptance criterion with one or more evidence IDs. Criteria without evidence remain `unverified`; do not infer success from the agent report.
9. Feed the Critic the actual evidence and diff. Then apply the deterministic acceptance gate from Section 13.4.

If a project does not define a linter/test/build command, detect available package scripts and recommend setup during project initialization. Never silently invent and execute arbitrary model-generated commands. If a check is mandatory but not configured, do not claim the project passed; block initialization or require an explicit, recorded human policy decision to mark that check not applicable.


### 14.6 Browser, functional UI, and screenshot verification

Command-only verification is insufficient for frontend and full-stack tasks. When the project profile or task acceptance criteria involve a browser UI, the verifier must include a browser-based evidence path in the same task attempt. Use Playwright as the MVP browser automation implementation behind a `BrowserVerifier` interface; keep the interface replaceable but do not defer the first working implementation past the vertical slice.

**When it is required**

- The orchestrator's own dashboard: Playwright E2E tests are mandatory for critical user flows and controls.
- A managed frontend/full-stack project: run browser checks whenever the task changes a route, component, visible behavior, CSS/layout, client-side state, accessibility, navigation, or a user-facing workflow, unless a reviewed profile explicitly marks the task as non-visual.
- Backend/CLI/data/embedded projects: browser verification is `not_applicable` only if no browser UI is in scope. Do not present a missing screenshot as a pass.

**Required UI verification sequence**

1. Start the app using a project-approved start command in a supervised child process, with an explicit working directory, environment allowlist, timeout, health/wait condition, and cleanup policy. Never accept an arbitrary model-generated startup command without policy validation.
2. Launch an isolated Playwright browser context with deterministic viewport, locale, timezone, reduced-motion setting, and test data where practical. Default viewports: desktop `1440×900` and mobile `390×844`; allow per-project override and tablet profiles.
3. Execute acceptance-criterion-specific browser assertions: target route loads, key elements exist and are visible, main user interactions work, expected state changes occur, and critical navigation completes. A screenshot by itself is not a functional test.
4. Capture uncaught page errors, console errors, failed requests, relevant HTTP failures, page errors, and timeouts. Distinguish expected/allowlisted network failures from unexplained errors. Do not contact production systems or external hosts except those explicitly permitted by test policy.
5. Capture screenshots of the relevant page/state after the tested interaction, with metadata (task, attempt, route, viewport, timestamp, commit/base hash). Where a baseline exists, optionally compute a visual diff with a configured pixel/perceptual threshold. A baseline must be explicitly approved; never silently bless a changed baseline to make a failing test green.
6. Where configured, run accessibility smoke checks (for example, an approved axe-core integration), responsive checks, and keyboard-focus/keyboard-navigation assertions. Accessibility automation is useful evidence, not proof of full accessibility conformance.
7. Store screenshots, diffs, traces, console/network summaries, Playwright report, assertion results, and raw bounded logs as artifacts. Every relevant acceptance criterion must reference one or more artifact/evidence IDs.
8. Terminate the preview server and browser process reliably, including on cancellation, timeout, or orchestrator restart. Persist enough process state to safely clean up orphaned children.
9. Include browser results and screenshots in the Critic evidence packet. The Critic must judge behavior and visual criteria independently of the executor's claim. If visual acceptance depends on subjective appearance and the selected Critic cannot inspect images, mark that criterion `requires_human_review` rather than pretending it was evaluated.

**Result statuses**: `passed`, `failed`, `not_run`, `not_applicable`, `blocked`, or `inconclusive`. `not_run` / `inconclusive` must never be shown as passed. If a required app server cannot start, the UI verification is `blocked` or `failed` with logs attached.

**Visual diff policy**

- Capture before/after screenshots when a valid baseline exists or when policy requests comparison.
- Normalize only known sources of nondeterminism (for example, animation, timestamps, caret blink, unstable data) via reviewed test setup; do not apply broad masking that hides regressions.
- Store image dimensions, viewport, URL/route, baseline ID, diff score/threshold, and artifact hashes.
- A threshold breach fails the visual check only when the task/profile marks that check as gating; otherwise it becomes a visible warning requiring a clear disposition.
- Human approval is required to replace a reference baseline if the change is material, the visual diff is large, or the task has no accepted visual intent/criteria.

**No false confidence**: screenshot presence proves that a screenshot was captured, not that the UI is correct. Browser assertions test behavior; visual comparison tests visual change; console/network checks surface runtime failures; Critic/human review interprets design quality. The evidence record must keep these distinct.


## 15. Persistent project memory

Every managed project should have an orchestrator-owned metadata directory outside the coding agent's editable scope, for example `.orchestrator/`. The app must prevent the coding agent from modifying orchestrator state as source-of-truth.

Canonical files must be easy to find and have these exact names: `SPEC.md`, `DECISIONS.md`, and `.orchestrator/ROADMAP.md`. If the project already has equivalent documents, ask to map/rename them rather than silently creating competing sources of truth.

Suggested workspace layout:

```text
<project-root>/
├── (user source code and assets)
├── SPEC.md                         # approved, living product/technical specification
├── DECISIONS.md                    # accepted/rejected architecture and product decisions
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── ACCEPTANCE_CRITERIA.md
│   └── USER_GUIDE.md
└── .orchestrator/                 # app-managed; not agent-editable by default
    ├── project.json               # non-secret exported metadata only
    ├── config.yaml                # sanitized config; no secrets
    ├── ROADMAP.md                 # approved, versioned roadmap mirror
    ├── REPO_MAP.md                # compact repository map, refreshed after accepted changes
    ├── CURRENT_STATE.md           # rolling current state summary
    ├── KNOWN_ISSUES.md
    ├── IMPORTS.md
    ├── summaries/                 # rolling summaries; not the authoritative event log
    ├── prompts/
    ├── reports/
    ├── verification/
    ├── critic-reviews/
    ├── diffs/
    └── logs/
```

For an existing repo that already uses `.orchestrator`, allow the user to select a different metadata directory outside the editable workspace. The actual authoritative state lives in the app data directory/SQLite; Markdown copies are exported, inspectable summaries, not the only source of truth.

### 15.1 Canonical memory facts

Mark every memory entry as one of:

- `verified`: supported by actual code/test/log evidence;
- `user_specified`: explicitly stated by user;
- `inferred`: model interpretation not yet confirmed;
- `proposed`: suggestion not implemented/approved;
- `rejected`: considered and rejected with a reason;
- `unknown`: not established.

Never upgrade a proposed idea into a verified fact simply because it appears in a summary.

### 15.2 Context packing

The Planner, executor, and Critic must not share an ever-growing transcript. Build role-specific context packets with explicit size limits and artifact references.

**Planner context:** approved `SPEC.md`; relevant `DECISIONS.md`; approved `.orchestrator/ROADMAP.md`; `.orchestrator/REPO_MAP.md`; `CURRENT_STATE.md`; unresolved blockers; pending/unconsumed human directions; last configurable N task summaries (default 5); recent Critic decisions; the actual verifier outcomes, failed-command excerpts, changed-file list, and Git diff summary from the most recent attempts; relevant test/build/quality trends; current budget and policy version. Include full canonical hard constraints or stable references plus a hash; never silently truncate them.

**Executor context:** a fresh session for each task attempt. Include only the bounded task contract, required acceptance criteria, roadmap/requirement IDs, hard constraints, allowed/forbidden paths, directly relevant repo map and file excerpts, relevant API contracts, required verification names (not permission to alter them), current verified integration commit, and a short summary of prior failed attempts. Do not supply the entire user chat, entire repo, or unrelated task history.

**Critic context:** a separate fresh model invocation with the task/criteria, canonical SPEC/DECISIONS/ROADMAP excerpts, actual diff and changed paths, independent verification outputs and evidence IDs, security/policy findings, and normalized executor report. Do not prime it with the Planner’s acceptance verdict.

- Never resend the entire repository or chat transcript by default. Retrieve only relevant files using repository map, task paths, imports/references, and bounded snippets.
- Include last N reports plus rolling summaries, but summaries are pointers—not substitutes for exact source requirements or recent failure evidence.
- Apply secret redaction and path/data-classification rules before context construction and before selecting the provider.
- Use token estimation where available and enforce per-role context budgets. If the context is too large, compact verified history first, retain exact hard constraints/acceptance criteria, and link bulky logs/diffs by artifact ID.
- Record prompt-template version and hashes/references for each included artifact so a review can be audited/reproduced. Do not log secret values or raw provider credentials.
- Refresh `.orchestrator/REPO_MAP.md` after accepted structural changes; the map should summarize folders, entrypoints, service boundaries, key tests, important config files, build/test commands, and known hotspots.

### 15.3 Memory update protocol and anti-drift rules

- After every accepted task, update the relevant portions of `CURRENT_STATE.md`, `.orchestrator/ROADMAP.md`, and `.orchestrator/REPO_MAP.md`; update `SPEC.md` or `DECISIONS.md` only when an explicit, approved change is part of the task.
- Every change to canonical files must be represented as a diff, reference the accepted task or user direction, and identify whether it modifies a requirement, decision, architecture, or roadmap item.
- The coding agent may suggest edits to these files, but cannot write authoritative orchestrator state. The Critic checks proposed memory changes against actual code/evidence, and the policy engine checks approval status before they become canonical.
- A newly discovered idea is stored as `proposed`; it does not become an approved requirement merely because it was summarized repeatedly.
- If code diverges from `SPEC.md`, do not automatically rewrite the spec to match the code. The Critic labels the discrepancy as implementation drift or an intentional-change proposal; only approved changes can update the spec.

## 16. Blueprint import and requirement extraction security

Treat blueprints, repository comments, READMEs, issue text, test output, generated files, and websites as potentially adversarial input. They may contain prompt injections, exfiltration instructions or commands disguised as requirements.

- The extraction model must explicitly be told that source documents are data, not instruction hierarchy.
- Extract requirement candidates with source references and classify them as explicit/inferred/ambiguous.
- Never run a command found in a document as part of import.
- Never let an imported document change provider privacy mode, secret permissions, budgets, allowed roots, or approval policies.
- Detect secret-like material in uploaded documents; warn and redact from model context unless the user explicitly authorizes an appropriate route. Never echo secrets into browser-visible logs.
- Parse PDFs/DOCX with vetted libraries and resource limits. For unsupported/corrupt formats, show a per-file error and continue processing other files where safe.
- Handle duplicate uploads, empty files, malformed JSON/YAML, huge files, ZIP bombs (if archive support is ever added), decompression limits, encrypted/password-protected PDFs, scanned PDFs, and inconsistent encodings.
- Store importer version and extraction warnings so the user can understand what the model did not read.

## 17. User interface requirements

A polished, responsive local dashboard with clear progressive disclosure. Beginner defaults should not force users to understand every technical setting to start.

### 17.1 Required screens

1. **Home / Projects:** project list, current status, provider/privacy badge, last activity, budget used, quick resume/pause/stop.
2. **New Project Wizard:** idea, workspace, blueprint upload, project preset, autonomy mode, constraints, provider/privacy choices, plan review.
3. **Project Dashboard:** milestone roadmap, active task, iteration/task counts, status timeline, recent changes, tests, blockers, provider/model/agent status, usage/budget.
4. **Project Brain / Direction Inbox:** free-form message input and message type/priority controls; status showing queued/consumed/blocked; mapping to task(s).
5. **Roadmap / Backlog:** task list, dependencies, prioritization, proposals, approve/reject/defer actions.
6. **Task Inspector:** prompt/context artifact hashes, task metadata, fresh agent-session ID, adapter stream/logs, reported vs actual changed files, Git diff, every orchestrator-run verification result, browser console/network summaries, screenshots and visual diffs, independent Critic verdict/findings, task branch/commit, rollback status, and previous attempts.
7. **Constraints & Policy:** Basic view plus Advanced view; hard/soft/informational rules, scopes, source, enforcement type, priority, conflicts, version history.
8. **Blueprints & Memory:** imported sources, extracted requirements with provenance, current specification, assumptions, decisions, known issues.
9. **Providers:** reasoning-provider setup, local endpoint health/models, OpenAI key status, hybrid routing, separate Planner/Critic provider selection and independence warning, coding-agent detection/auth, per-agent privacy disclosure, connection tests.
10. **Approvals / Blockers:** pending actions, contradiction resolution, blocked tasks and explicit resume options.
11. **Settings:** defaults, data retention, logging, backup/export, local server config, theme, keyboard shortcuts if practical.
12. **Run Report:** what was built, verified criteria, command and browser-test evidence, screenshot/visual-diff artifacts, changed files, estimated/reserved/measured/unknown cost per role, unresolved work, and next recommendations.

### 17.2 Persistent top-level controls

- Start / Resume;
- Pause safely;
- Stop run;
- force terminate current agent process (with clear warning);
- current mode and effective constraints;
- live execution stage (`PLANNING`, `EXECUTING`, `VERIFYING`, `CRITIC_REVIEWING`, `INTEGRATING`, or blocked/rollback state);
- active task/worktree/commit, independent test/build/lint status, Planner and Critic model identity, actual provider usage/cost when available, and pending permission/question requests;
- provider/network classification;
- budget status;
- link to current blockers/approvals.

Stop controls must remain available even while the reasoning model or coding agent is unresponsive. The backend owns the stop request; it cannot rely on the frontend being present.

### 17.3 UX details

- Use plain-language descriptions for hard/soft constraints.
- Display whether each setting comes from a preset, project override, or global default.
- Show “agent-reported” and “independently verified” as separate evidence states.
- Do not rely only on color to convey state.
- Every blocked/failed state should explain what happened, what has been preserved, and the next safe action.
- Do not display secrets or full API keys in any screen/log.
- Show explicit warning for unsupported capabilities, local models too small/slow, unknown provider privacy, and missing verification commands.
- Do not show a green “offline” indicator unless all active components meet the policy’s offline requirements.

## 18. Local HTTP API

Version the API under `/api/v1`. Validate every request and response. Use typed error envelopes. Do not expose arbitrary file read/write or process execution endpoints to the browser.

### Projects

- `GET /api/v1/projects` — list projects.
- `POST /api/v1/projects` — create project draft.
- `GET /api/v1/projects/:projectId` — get project metadata/status.
- `PATCH /api/v1/projects/:projectId` — edit safe metadata/configuration.
- `POST /api/v1/projects/:projectId/initialize` — run blueprint analysis and plan generation.
- `POST /api/v1/projects/:projectId/approve-plan` — approve generated plan and mark ready.
- `POST /api/v1/projects/:projectId/archive` — archive project metadata (never delete user code).

### Blueprints

- `POST /api/v1/projects/:projectId/blueprints` — upload/import blueprint files.
- `GET /api/v1/projects/:projectId/blueprints` — list import status/sources.
- `GET /api/v1/projects/:projectId/requirements` — candidate/approved requirements.
- `PATCH /api/v1/projects/:projectId/requirements/:requirementId` — approve/edit/reject one requirement.

### Runs/tasks

- `POST /api/v1/projects/:projectId/runs` — start/resume run.
- `GET /api/v1/projects/:projectId/runs` — list runs.
- `GET /api/v1/runs/:runId` — detail/state.
- `POST /api/v1/runs/:runId/pause` — pause at safe checkpoint.
- `POST /api/v1/runs/:runId/stop` — stop and prevent new dispatch.
- `POST /api/v1/runs/:runId/resume` — resume only if no blocker or unresolved approval prevents it.
- `GET /api/v1/projects/:projectId/tasks` — backlog/history.
- `GET /api/v1/tasks/:taskId` — task and evidence.
- `POST /api/v1/tasks/:taskId/retry` — request bounded retry.
- `POST /api/v1/tasks/:taskId/approve` / `reject` — specific human approval/rejection.
- `GET /api/v1/tasks/:taskId/critic-review` — independent Critic result and evidence links.
- `GET /api/v1/tasks/:taskId/checkpoints` — Git base/task/accepted commits and rollback status.
- `POST /api/v1/tasks/:taskId/recover` — request a defined recovery action (restore artifact, retry from verified base, retain isolated branch) after policy validation.

### Human directions

- `POST /api/v1/projects/:projectId/messages` — create a durable human direction.
- `GET /api/v1/projects/:projectId/messages` — show status/history.
- `POST /api/v1/messages/:messageId/cancel` — cancel an unconsumed direction when safe.

### Policies and providers

- `GET /api/v1/projects/:projectId/policy` / `PATCH .../policy` — read or propose changes to constraints; hard changes must go through explicit versioned confirmation.
- `GET /api/v1/profiles` and `POST /api/v1/profiles` — list/create custom profiles.
- `GET /api/v1/providers` — current provider definitions and status (no secrets).
- `POST /api/v1/providers/:providerId/test` — connection/model/capability test.
- `PATCH /api/v1/settings/providers` — write non-secret provider settings; secret write goes through protected endpoint/store and is never returned.

### Events/artifacts

- `GET /api/v1/projects/:projectId/events` — SSE stream with event cursor/replay support.
- `GET /api/v1/tasks/:taskId/artifacts` — artifact metadata.
- `GET /api/v1/artifacts/:artifactId` — serve only approved known artifact types from a managed store; prevent path traversal.
- `GET /api/v1/projects/:projectId/export` — export project spec/memory/config (no secrets).

These route names can be adjusted to fit the final implementation, but preserve equivalent functionality and authorization boundaries.

## 19. SSE event protocol

Use Server-Sent Events for live updates, with durable event records and monotonically increasing per-project event IDs.

Example event names:

- `project.status_changed`
- `run.started`, `run.paused`, `run.resumed`, `run.stopped`, `run.completed`, `run.blocked`
- `task.created`, `task.status_changed`, `task.progress`, `task.completed`, `task.failed`
- `agent.stdout`, `agent.stderr`, `agent.tool_event`
- `verification.started`, `verification.result`
- `review.completed`
- `human_message.created`, `human_message.consumed`
- `approval.required`, `approval.decided`
- `budget.warning`, `budget.exhausted`
- `provider.health_changed`
- `memory.updated`

Requirements:

- UI reconnect uses `Last-Event-ID` or equivalent cursor.
- Client disconnect must not cancel a run.
- Persist important events; high-volume token streams may be batched/throttled and stored as bounded artifacts rather than creating one DB row per token.
- Redact sensitive values before persisting/displaying streams.
- Do not let an SSE client invoke commands by sending event-shaped messages back. All mutations use authenticated/CSRF-protected HTTP endpoints.

## 20. Proposed database model

Use migrations from the beginning. Names/columns can evolve, but the following concepts are mandatory.

### Core tables

- `projects`: id, name, canonical root path, created/updated timestamps, lifecycle status, profile id/version, active run id, configuration version, Git metadata, archive state.
- `project_config_versions`: id, project id, version, sanitized JSON config, change summary, source, created timestamp, user approval metadata.
- `constraints`: id, project id or profile id, key/name, type, scope, serialized value, enforcement type, source, enabled, severity, version, timestamps.
- `requirements`: id, project id, stable requirement key, title, description, priority, mandatory flag, source reference, provenance kind, status, acceptance criteria JSON, version.
- `runs`: id, project id, status, started/ended timestamps, start config/policy version, counters, stop reason, current task id, provider policy snapshot.
- `tasks`: id, project id, run id, parent task id, title, objective, status, priority, risk, task config/policy version, acceptance criteria, attempt count, current attempt id, budget snapshot, timestamps.
- `task_attempts`: id, task id, attempt number, adapter id, provider/model metadata, fresh-session policy, prompt/context artifact hashes, agent session id, base commit, worktree/branch refs, process state/exit code, start/end timestamps, failure category, cancellation reason, rollback state, and retry/backoff metadata.
- `critic_reviews`: id, task/attempt IDs, critic provider/model profile, prompt/schema version, verdict, per-criterion results, scope-drift result, findings, evidence artifact references, creation time, and validation status.
- `roadmap_items`: stable ID, project/version, title, scope, priority, source requirement IDs, status, dependencies, approval metadata, completion evidence, and supersedes/superseded-by links.
- `scope_change_proposals`: ID, project, source task/human direction, proposed spec/roadmap diff, risk, status, Critic findings, required approval, and resolution metadata.
- `repository_checkpoints`: project/task/attempt, base commit/ref, task branch/worktree, accepted commit, integration ref, integration status, rollback artifact refs, created/cleaned timestamps.
- `provider_attempts`: operation role (planner/executor/critic), provider/model, route, privacy/data classification, attempt number, latency/usage/cost metadata, retry/backoff reason, and outcome.
- `human_messages`: id, project id, kind, content, priority/application timing, state, created/consumed timestamps, affected task ids, resolution metadata.
- `provider_profiles`: id, owner scope, provider type, sanitized configuration, privacy class, capability snapshot, enabled state, last health check. Never store raw API keys in this table.
- `verification_runs`: id, task id, command definition id, status, exit code, start/end timestamps, artifact references, truncation metadata.
- `artifacts`: id, project/run/task/attempt references, kind, relative storage key, MIME type, byte size, SHA-256, created timestamp, retention category, redaction status.
- `run_events`: id/incrementing event sequence, project id, run id, task id, event type, JSON payload, timestamp, redaction flag.
- `approvals`: id, project id, task/action id, action/risk type, description, status, requester/source, decided by (local user), decision, created/decided timestamps.
- `budget_counters`: project/run/provider IDs, period, requests, known token usage, estimated cost, ceilings and last update.
- `profiles`: id, built-in/custom, name, version, config JSON, timestamps.
- `settings`: non-secret application settings only.
- `schema_migrations`: migration metadata.

Use foreign keys, indexes for project/run/task statuses and timestamps, transactions for state changes, and uniqueness rules for idempotency keys. Avoid storing secrets or giant logs as SQLite blobs; store artifacts on disk with database metadata.

### Transaction and recovery requirements

- Run lifecycle transitions and corresponding audit event should be committed transactionally.
- Before spawning a child process, persist the attempt and a dispatch marker/idempotency key. If the app crashes between persistence and spawn, recovery reconciles rather than blindly starting duplicates.
- On startup, mark previously active processes as interrupted after checking process ownership; never kill unrelated processes by matching a generic process name.
- Identify stale locks and recover them only when owner process identity is no longer valid; otherwise show a recovery prompt.
- Back up SQLite through a consistent database backup mechanism or `VACUUM INTO`, not by copying a live database file blindly.
- Enable foreign keys and WAL; ensure tests cover migration, backup, and crash-recovery logic.

## 21. Filesystem and application data layout

Keep application state separate from source repositories.

Example platform-specific data root:

```text
<OS user application data directory>/AutonomousDevOrchestrator/
├── orchestrator.sqlite
├── backups/
├── profiles/
│   ├── general-software.json
│   ├── frontend.json
│   ├── backend-api.json
│   ├── fullstack.json
│   ├── ai-ml.json
│   ├── data-science.json
│   ├── cli-tool.json
│   └── embedded-iot.json
├── projects/<project-id>/
│   ├── exports/
│   ├── artifacts/<artifact-id>/
│   ├── prompts/<task-id>/<attempt>.md
│   ├── reports/<task-id>/<attempt>.json
│   ├── verification/<task-id>/<attempt>/
│   └── logs/<run-id>/
└── temp/
```

Use OS APIs/environment conventions to resolve the directory. Do not hardcode only Linux paths. Temp files must use random names, restrictive permissions where supported, and cleanup after process exit/restart. Never store imported user files under a path that can overwrite app data or source code unexpectedly.

## 22. Security and threat model

This application runs code through an external agent and potentially through local verification commands. Treat it as a developer tool with meaningful local privileges.

### 22.1 Threats to address

- prompt injection in uploaded blueprints, source files, README files, test output or generated web content;
- an agent trying to read `.env`, private keys, browser profiles, SSH keys, or other files outside the workspace;
- an agent adding an obfuscated network exfiltration script;
- malicious or accidental shell command execution;
- dependency/supply-chain risk;
- model/provider credentials leaking into logs or child processes;
- a local web page from another origin trying to invoke localhost endpoints;
- accidental exposure by binding the server to all network interfaces;
- a huge model response or log exhausting memory/disk;
- invalid JSON, malformed path, symlink escape, or artifact path traversal;
- agent or verifier hanging and surviving Stop;
- concurrent tasks corrupting repository state;
- model falsely reporting test success;
- unintended cloud fallback in Local-only mode.

### 22.2 Default security posture

- Bind backend to `127.0.0.1` or `::1` only by default; never `0.0.0.0` by default.
- Use a random local UI session token and appropriate SameSite cookies or an equivalent explicit local-session design. Validate `Origin`/Host and use CSRF protection for state-changing requests. CORS should be restricted to the app's exact local origin.
- Do not expose arbitrary shell, file write, or process execution endpoints to the frontend.
- Use canonicalized allowed roots and reject path traversal/symlink escape.
- Use `spawn` with argument arrays and `shell: false`.
- Set child process cwd to the approved workspace, use a minimized environment, and remove unrelated credentials.
- Maintain an allowlist for verification commands and a separate approval process for new commands.
- Use finite timeouts and output/file size limits.
- Use secrets-redaction patterns for API keys, common credential formats, `.env` values, authorization headers, PEM blocks, and user-specified secret patterns.
- Store API keys in OS credential storage when feasible; an environment-variable option is acceptable for initial setup. Never persist raw keys in plaintext in project config or database.
- If a secret store is unavailable, explain alternatives and their risks; never create an unencrypted credential file without explicit user opt-in.
- Log access to sensitive settings, provider fallback, approvals, changes to hard policies, force-stop actions, and Git recovery actions.
- Keep manual Stop/Pause independent of model responsiveness.
- Do not run arbitrary shell commands copied from model output automatically.
- Do not automatically install dependencies without an explicit project policy; default dependency install actions require approval until the allowed package-manager commands are reviewed.
- Provide a “dry run / plan only” mode that creates no code changes.

### 22.3 Safety versus sandboxing

The app should use the strongest practical workspace isolation supported by the host, but it must not claim to be a security sandbox merely because the working directory is set. If Antigravity has its own sandbox/permission controls, surface them and prefer restrictive settings. If robust OS sandboxing is unavailable on a platform, clearly state that agent subprocesses may have user-level permissions and use conservative approval defaults.

## 23. Error handling and edge cases

Create typed internal error categories and map them to actionable UI messages.

### Provider errors

- missing key / authentication failure;
- quota/credit/rate limit;
- model not found / unsupported;
- local server unavailable;
- request timeout / cancellation;
- context too long;
- structured output invalid;
- unsupported capability;
- provider returned empty response;
- endpoint certificate/network error;
- provider usage data unavailable.

Policy: retry transient errors with bounded exponential backoff and jitter. Do not retry authentication, quota, schema, or policy errors indefinitely. Respect `Retry-After` when available. Never switch provider unless configured in hybrid policy.

### Agent/process errors

- `agy` missing or wrong version;
- not authenticated;
- CLI output format unsupported;
- CLI permission denial or soft denial;
- malformed/truncated JSONL event;
- no terminal result event;
- exit code nonzero;
- exit code zero but no meaningful result;
- child process hung;
- canceled process fails to terminate;
- agent used tools outside policy;
- unsupported command on Windows/Linux/macOS;
- user closed terminal or agent UI unexpectedly.

### Filesystem/Git errors

- invalid/unwritable path;
- disk full;
- permission denied;
- project directory moved/renamed/unmounted;
- symbolic link points outside workspace;
- existing dirty Git state;
- Git not installed;
- merge conflict;
- agent changes forbidden paths;
- user modifies files concurrently;
- rollback unsafe because baseline unknown.

### Runtime/database errors

- application restart while task active;
- duplicate HTTP submission;
- browser disconnect/reconnect;
- concurrent start calls;
- stale execution lock;
- database busy/corrupt/migration failure;
- disk quota or artifact write failure;
- corrupted or partial report artifact.

### Blueprint errors

- unsupported format;
- encrypted/corrupt PDF;
- DOCX parser error;
- image-only PDF with no text extraction;
- giant file;
- duplicate upload;
- malformed YAML/JSON;
- sensitive content detected;
- requirements conflict;
- blueprint includes malicious embedded instructions.

### Human-direction errors

- message sent during a task;
- stop requested while provider call is waiting;
- conflicting directions queued together;
- message arrives after a related task is complete;
- approval expires or task changes after approval;
- user edits the specification during task execution.

Every failure should preserve logs/state and offer safe recovery. The application must not keep retrying forever or hide the cause behind “AI error.”

## 24. Repository structure

Use a monorepo structure like the following. Keep the initial architecture simple, but make responsibilities explicit.

```text
autonomous-dev-orchestrator/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   ├── defaults.ts
│   │   │   │   └── schema.ts
│   │   │   ├── api/
│   │   │   │   ├── routes/
│   │   │   │   ├── schemas/
│   │   │   │   ├── middleware/
│   │   │   │   └── errors.ts
│   │   │   ├── auth/
│   │   │   │   ├── local-session.ts
│   │   │   │   ├── csrf.ts
│   │   │   │   └── origin-check.ts
│   │   │   ├── domain/
│   │   │   │   ├── projects/
│   │   │   │   ├── blueprints/
│   │   │   │   ├── requirements/
│   │   │   │   ├── constraints/
│   │   │   │   ├── roadmap/
│   │   │   │   ├── runs/
│   │   │   │   ├── tasks/
│   │   │   │   ├── human-messages/
│   │   │   │   ├── approvals/
│   │   │   │   ├── budgets/
│   │   │   │   ├── memory/
│   │   │   │   └── completion/
│   │   │   ├── orchestrator/
│   │   │   │   ├── loop.ts
│   │   │   │   ├── state-machine.ts
│   │   │   │   ├── scheduler.ts
│   │   │   │   ├── recovery.ts
│   │   │   │   ├── locks.ts
│   │   │   │   └── stop-controller.ts
│   │   │   ├── prompts/
│   │   │   │   ├── context-builder.ts
│   │   │   │   ├── task-composer.ts
│   │   │   │   ├── prompt-templates/
│   │   │   │   └── redaction.ts
│   │   │   ├── providers/
│   │   │   │   ├── reasoning/
│   │   │   │   │   ├── provider.ts
│   │   │   │   │   ├── registry.ts
│   │   │   │   │   ├── router.ts
│   │   │   │   │   ├── openai/
│   │   │   │   │   ├── openai-compatible/
│   │   │   │   │   └── capability-probe.ts
│   │   │   │   └── coding-agents/
│   │   │   │       ├── adapter.ts
│   │   │   │       ├── registry.ts
│   │   │   │       ├── antigravity/
│   │   │   │       └── mock/                  # test-only
│   │   │   ├── verification/
│   │   │   │   ├── runner.ts
│   │   │   │   ├── command-policy.ts
│   │   │   │   ├── results.ts
│   │   │   │   └── git-diff-check.ts
│   │   │   ├── git/
│   │   │   │   ├── git-client.ts
│   │   │   │   ├── checkpoint.ts
│   │   │   │   ├── worktree.ts
│   │   │   │   └── dirty-state.ts
│   │   │   ├── storage/
│   │   │   │   ├── db.ts
│   │   │   │   ├── schema/
│   │   │   │   ├── migrations/
│   │   │   │   ├── repositories/
│   │   │   │   └── transactions.ts
│   │   │   ├── artifacts/
│   │   │   │   ├── store.ts
│   │   │   │   ├── hashes.ts
│   │   │   │   ├── paths.ts
│   │   │   │   └── retention.ts
│   │   │   ├── events/
│   │   │   │   ├── event-store.ts
│   │   │   │   ├── event-bus.ts
│   │   │   │   └── sse.ts
│   │   │   ├── security/
│   │   │   │   ├── path-policy.ts
│   │   │   │   ├── secret-detection.ts
│   │   │   │   ├── secret-store.ts
│   │   │   │   ├── redaction.ts
│   │   │   │   └── process-policy.ts
│   │   │   ├── platform/
│   │   │   │   ├── paths.ts
│   │   │   │   ├── process-tree.ts
│   │   │   │   └── capabilities.ts
│   │   │   └── utils/
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── fixtures/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── routes/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── projects/
│       │   │   ├── wizard/
│       │   │   ├── blueprints/
│       │   │   ├── constraints/
│       │   │   ├── providers/
│       │   │   ├── dashboard/
│       │   │   ├── roadmap/
│       │   │   ├── tasks/
│       │   │   ├── human-inbox/
│       │   │   ├── approvals/
│       │   │   ├── logs/
│       │   │   └── reports/
│       │   ├── api/
│       │   ├── hooks/
│       │   ├── state/
│       │   ├── styles/
│       │   └── test/
│       └── e2e/
├── packages/
│   ├── shared-types/
│   │   └── src/
│   ├── policy-schema/
│   ├── profile-presets/
│   └── test-fixtures/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── PROVIDERS.md
│   ├── ANTIGRAVITY_ADAPTER.md
│   ├── LOCAL_MODELS.md
│   ├── DATA_MODEL.md
│   ├── API.md
│   └── TROUBLESHOOTING.md
├── scripts/
├── .github/workflows/              # optional CI if repository hosted
├── .env.example                    # placeholders only
├── .gitignore
├── package.json
├── package-lock.json / pnpm-lock.yaml (choose one package manager)
├── tsconfig.base.json
├── README.md
└── MVP_BLUEPRINT.md                # copy/link this document into repo if desired
```

Do not create every file as an empty placeholder upfront. Create directories/files as a milestone needs them. Keep shared validation schemas in one place to prevent client/server drift.

## 25. Default configuration

The following shows intended defaults, not a requirement to use these exact serialized keys. Use a schema and migrations for settings.

```yaml
app:
  bindHost: "127.0.0.1"
  port: 4317
  logLevel: "info"
  telemetry: false
  autoUpdate: false

execution:
  maxConcurrentProjects: 1
  maxConcurrentAgentsPerWorkspace: 1
  defaultMaxIterationsPerRun: 30
  defaultMaxTasksPerRun: 30
  maxAttemptsPerTask: 3
  maxRepairAttemptsPerTask: 2
  defaultTaskTimeoutMinutes: 30
  defaultRunTimeoutMinutes: 240
  maxContextCharacters: 60000
  maxCapturedOutputCharacters: 200000
  stopOnHardPolicyViolation: true
  stopOnRepeatedFailureCount: 3

git:
  preferCheckpoints: true
  automaticallyResetOrClean: false
  requireGitForHighRiskChanges: true
  preservePreExistingDirtyChanges: true

privacy:
  defaultReasoningMode: "local-only"
  secretRedactionEnabled: true
  allowExternalProviderForInternalData: false
  allowExternalProviderForSensitiveData: false
  failClosedOnProviderFallback: true
  bindLan: false

reasoning:
  mode: "local-only"
  local:
    baseUrl: "http://127.0.0.1:11434/v1"
    model: ""
    apiKeyEnv: "LOCAL_LLM_API_KEY"
    timeoutMs: 120000
  openai:
    model: ""
    apiKeyEnv: "OPENAI_API_KEY"
    timeoutMs: 120000
  hybrid:
    routes: {}

agent:
  provider: "antigravity-cli"
  executable: "agy"
  timeoutMs: 1800000
  requireDetectedCapabilities: true
  sessionPolicy: "fresh_per_attempt"
  permissionRequestTimeoutMs: 900000
  allowDangerousPermissionBypass: false
  allowlistedAutoApprovals: []

critic:
  enabled: true
  separateInvocation: true
  providerProfileId: null # inherits the reasoning provider by default; use a distinct model/provider for stronger independence
  requireDistinctProviderForHighRisk: false
  maxSchemaRetries: 1
  blockAcceptanceWhenUnavailable: true

git:
  taskIsolation: "worktree_per_attempt"
  createCheckpointForAcceptedTasks: true
  autoDiscardFailedWorktreeAfterArtifactCapture: true
  retryFromVerifiedBaseByDefault: true
  fastForwardAcceptedTaskToIntegrationRef: true
  requireBaseHashUnchanged: true
  autoMergeToUserBranch: false
  autoPush: false
  neverResetOrCleanUserCheckout: true

stagnation:
  maxConsecutiveNoDiffAttempts: 2
  maxEquivalentVerificationFailures: 3
  maxEditPingPongDetections: 3
  actionOnThreshold: "pause_and_escalate"

completion:
  requireMandatoryCriteria: true
  requireBuildIfConfigured: true
  requireTestsIfConfigured: true
  allowWarnings: false
  autoDeploy: false
```

Important: Do not ship the application with `mode: local-only` if it cannot complete first-run local provider setup gracefully. First-run UI may ask the user to choose Cloud / Local-only / Hybrid and show setup steps; local-only is the safest privacy default. On local connection failure, do not silently route to OpenAI. Empty model fields must be rejected until configured.

## 26. Example project configuration

Use a versioned project config with user-overridable defaults. Secrets are references to a secret store or environment variables, never embedded values.

```yaml
schemaVersion: 1
project:
  name: "Example Application"
  profileId: "fullstack-ai"
  mode: "creative_with_constraints"
  workspaceRoot: "/absolute/approved/path"
  specVersion: 1

objectives:
  - "Implement the approved project specification"
  - "Keep architecture and usage documentation current"

hardConstraints:
  - id: "workspace-containment"
    description: "Only modify files inside the approved workspace"
    enforcement: "filesystem"
    enabled: true
  - id: "secrets-protection"
    description: "Do not expose credentials in prompts, logs, or artifacts"
    enforcement: "application"
    enabled: true
  - id: "external-deploy-approval"
    description: "Require explicit approval for deployment or publishing"
    enforcement: "application"
    enabled: true
  - id: "offline-reasoning"
    description: "Project Brain requests must use the selected local model only"
    enforcement: "application"
    enabled: true

softConstraints:
  - id: "minimize-dependencies"
    description: "Prefer the smallest reasonable dependency set"
  - id: "maintainability"
    description: "Prefer readable, testable, maintainable code"

budget:
  maxIterations: 30
  maxTasks: 30
  maxRepairAttemptsPerTask: 2
  maxRunMinutes: 240
  maxApiRequests: 100
  maxEstimatedSpendUsd: null

quality:
  requiredCommands:
    - ["npm", "run", "lint"]
    - ["npm", "test", "--", "--run"]
    - ["npm", "run", "build"]
  requireIndependentVerifier: true
  requireCriticAcceptance: true
  minCoveragePercent: null
  blockOnKnownCriticalSecurityFindings: true

git:
  taskIsolation: "worktree_per_attempt"
  createCheckpointForAcceptedTasks: true
  autoDiscardFailedWorktreeAfterArtifactCapture: true
  retryFromVerifiedBaseByDefault: true
  fastForwardAcceptedTaskToIntegrationRef: true
  requireBaseHashUnchanged: true
  autoMergeToUserBranch: false
  autoPush: false

critic:
  enabled: true
  separateInvocation: true
  providerProfileId: null
  requireDistinctProviderForHighRisk: false

privacy:
  reasoningMode: "local-only"
  dataClassificationDefault: "internal"
  externalProviderAllowedFor: ["public"]
  cloudFallbackAllowed: false

creativePolicy:
  allowNewFeatures: true
  allowInternalRefactors: true
  allowMajorArchitectureChanges: false
  requireApprovalForMajorScopeChanges: true
  requireApprovalForNewExternalServices: true

completion:
  mandatoryAcceptanceCriteriaMustPass: true
  mandatoryChecksMustPass: true
  unresolvedBlockingIssuesAllowed: false
  requireFinalReport: true
```

The effective config should be calculated from built-in defaults, preset, project configuration, then permitted user overrides. The precedence applies only among user-configurable layers; none can override platform safety. Save the resolved policy snapshot to the run/task records.

## 27. Required project profiles

Each built-in profile should include a human-readable explanation, constraints, task-generation hints, required/optional verifications, and suggested completion rules.

### General software

- small, bounded tasks;
- lint/build/tests if present;
- avoid unnecessary dependencies;
- document setup and key decisions;
- verify the primary user workflow.

### Frontend application

- accessibility checks for critical controls;
- responsive behavior for defined target sizes;
- component and interaction tests;
- build and type-check;
- browser E2E for primary user flows if configured;
- no claim of visual fidelity without viewing screenshots/rendered output when visual review is a requirement.

### Backend/API

- request validation and consistent error responses;
- unit and integration tests;
- auth/authorization checks for protected routes;
- API schema/contract consistency;
- timeout, input size, and error logging considerations;
- migrations tested on temporary databases.

### Full-stack application

- frontend + backend integration contract;
- local startup instructions;
- integration tests against isolated test services;
- frontend error/loading/empty states;
- environment variables documented in `.env.example` without secrets;
- separate dev/test data; no accidental production data migrations.

### AI/ML

- data provenance and license notes;
- train/validation/test split integrity and leakage checks;
- fixed random seeds where meaningful;
- explicit metrics/baselines;
- resource/time limits for training;
- model artifact metadata/checksums;
- inference smoke test and regression thresholds;
- do not claim training quality or generalization solely from a successful training command.

### Data science/analytics

- data schema and validation;
- reproducible transformation pipeline;
- assumptions and missing-data handling;
- no leakage from future labels into features;
- chart labels and reproducibility;
- deterministic examples/smoke tests.

### CLI / developer tool

- help/usage output;
- exit codes;
- invalid argument handling;
- platform path behavior;
- install/uninstall or packaging checks;
- examples and troubleshooting.

### Embedded/IoT

- target board/chip/version explicit;
- compile toolchain and simulator result when available;
- pin map and timing/resource constraints;
- distinguish simulated output from physical validation;
- don't claim physical safety, RF compliance, electrical compatibility, or hardware-tested status without evidence.

### Documentation/research

- source attribution for factual claims;
- distinguish facts, assumptions and proposals;
- verify links when network access is enabled;
- no fabricated citations;
- spell out what was not independently verified.

### Blank/custom

No assumptions beyond platform safety and baseline process protections. Guide the user through adding objectives, constraints, acceptance criteria and validation steps.

## 28. API, prompt and result versioning

- Version prompts/templates, schemas, profiles, and project policy.
- Persist provider/model identifier, provider capability snapshot, relevant settings snapshot, and prompt hash per task attempt.
- If a schema changes, maintain backward-compatible readers for existing reports or migrate stored versions.
- Make model/provider changes apply to future calls by default. Do not silently alter a running request's provider route.
- If the user changes the provider mid-run, apply it at a safe boundary and state which task will use it.
- Model responses are not treated as executable configuration. Parse JSON with schema validation and ignore unknown fields where safe; reject unknown control enums.
- Do not serialize secrets into prompt artifacts, debug dumps, exported project configuration, or test snapshots.

## 29. Observability, retention, and export

- Provide a per-run timeline with task IDs, durations, provider/model, result, evidence, retry count, usage if available, and stop reason.
- Make logs searchable/filterable by project, run, task, severity, provider, and event type.
- Bound logs and artifacts by configurable retention/size. Do not delete evidence for active runs.
- Let the user export project spec, approved requirements, sanitized config, roadmap, decisions, final reports, and selected logs as a ZIP/Markdown bundle. Exclude API keys, raw secrets, and sensitive artifacts by default.
- Allow deleting app-managed metadata/artifacts while protecting source project files. Make destructive cleanup explicit and preview what will be removed.
- No telemetry or remote error reporting by default. If added later, opt-in only, disclose what is sent, and redact content.

## 30. Testing strategy

Testing the orchestrator itself is as important as testing projects it builds.

### 30.1 Unit tests

- policy precedence and hard constraint enforcement;
- project mode semantics;
- state machine valid/invalid transitions;
- budget calculations and “do not dispatch over budget” gate;
- provider routing by operation + classification;
- no cloud fallback in Local-only mode;
- model output JSON validation and retry cap;
- secret redaction;
- context assembly and protected constraint retention;
- requirement provenance and status updates;
- prompt injection treated as untrusted input;
- path containment and symlink traversal;
- Git dirty-state logic;
- human message ordering/application semantics;
- stagnation/repeated failure detection including no-diff attempts, edit ping-pong, equivalent errors, repeated unanswered questions, and ignored Critic feedback;
- Planner/Critic role isolation: Critic does not receive Planner’s preferred verdict and has a distinct schema/prompt;
- roadmap traceability: off-roadmap task is rejected before dispatch unless an approved scope-change proposal exists;
- fresh executor session per task/attempt and compact role-specific context construction;
- mandatory lint/test/build checks are run by the orchestrator and cannot be marked passed by agent self-report;
- cost estimates account for Planner, Executor, Critic, visual reviewer and every permitted repair attempt; unknown external-agent cost is not recorded as zero;
- budget reservation is atomic under concurrent task/start requests and blocks provider calls before exceeding configured hard caps;
- browser verifier distinguishes passed/failed/not_run/not_applicable/blocked/inconclusive; screenshot presence alone cannot satisfy functional assertions;
- visual baseline approval and diff thresholds are enforced; no automatic baseline reblessing;
- failed task attempt preserves patch/logs/evidence, automatically rolls back only its isolated worktree, and leaves user working tree untouched;
- accepted task checkpoint commit and safe fast-forward integration, including base-moved/conflict cases;
- agent permission soft-denial and interactive question are converted into a visible paused/blocked state;
- rate-limit/backoff logic respects Retry-After and never retries quota/auth/policy failures indefinitely;
- artifact file-name/path handling;
- redaction of provider keys and bearer headers.

### 30.2 Integration tests

Use fake HTTP providers and a mock coding-agent adapter. Do not spend real API credits in normal CI.

- OpenAI-compatible local endpoint health/model probe;
- OpenAI adapter request mapping with mocked SDK/API;
- streaming and malformed JSON events from fake agent;
- process timeout/cancel/exit behavior;
- SQLite transaction and migration behavior;
- event persistence and SSE reconnect/replay;
- crash recovery from `running`/`dispatching` state;
- duplicate start request/idempotency;
- upload import/parsing limits;
- constraints conflict blocks the correct tasks;
- local model disconnected must pause, not cloud fallback;
- human direction sent mid-task is applied to the next safe task;
- forbidden file diff is blocked and reported.

### 30.3 End-to-end tests

1. Create project from idea only, select a profile, approve generated draft, and see ready state.
2. Import a Markdown blueprint, inspect extracted requirements/source provenance, approve it, and start the run.
3. Configure a local OpenAI-compatible test server and complete a reasoner request without Internet access.
4. Stop the local model; verify no cloud provider receives any request in Local-only mode.
5. Use a mock agent to change a fixture, verify a test failure, issue a repair, verify passing, and complete the task.
6. Send a human direction mid-task and verify it appears in the next prompt and is marked consumed.
7. Reach max iterations/budget and verify no new model call or agent process starts.
8. Restart the server during a run and verify state is recovered without duplicate dispatch.
9. Stop a hanging mock agent and verify the process is gone and partial evidence is preserved.
10. Verify no API key is present in UI payloads, logs, database config, exported config, or prompt artifacts.
11. Verify app binds to loopback only and rejects a cross-origin state-changing request.
12. Verify a Git dirty existing project is never reset/cleaned automatically.
13. Verify Planner output without an approved roadmap item is rejected before any agent process starts.
14. Verify a separate Critic invocation is made and cannot override failed lint/tests/build or scope-policy violations.
15. Verify a no-diff attempt, repeated equivalent error, edit-ping-pong sequence, and repeated ignored Critic request trigger a stalled/blocked status.
16. Verify each new task/repair uses a fresh agent session and only bounded relevant context.
17. Verify a failed isolated attempt leaves a recoverable patch/report, removes its workspace from the active path, and does not change user checkout files.
18. Verify permission prompts and agent questions pause visibly with no indefinite process wait; configured harmless allowlists work without enabling unrestricted bypass.
19. Verify task checkpoint commit is created only after all acceptance gates pass and integration refuses a moved baseline.
20. Build a small frontend fixture with one intentional browser assertion failure; verify Playwright captures the real screenshot, console/network evidence, fails the UI criterion, and retains artifacts through repair.
21. Run a responsive UI task at desktop and mobile viewports; verify screenshot and route/assertion artifacts are attached to the attempt and a visual-threshold breach is not silently accepted.
22. Exhaust the reserved cost budget with Planner + Executor + Critic + repair calls and prove the next request is blocked before provider dispatch.
23. Verify the pre-run cost breakdown includes Critic and the configured maximum repair reserve, and reports external CLI cost as unknown if not exposed.

### 30.4 Manual verification checklist

- Install/run on one Linux system and one Windows system when practical.
- Test paths containing spaces and Unicode.
- Test no Internet, unavailable local model, invalid API key, missing `agy`, unauthenticated `agy`, provider quota error, canceled task, disk almost full, and app restart.
- Confirm all UI controls do what they say.
- Confirm all user-visible claims have evidence or explicit “unknown/not verified” status.

## 31. Implementation milestones — vertical slice first

**Ordering rule:** prove the complete autonomous loop before building advanced setup workflows. The vertical slice must arrive at Milestone 3, before blueprint importers, advanced hybrid routing UI, and the full project wizard. Do not interpret this as permission to skip the budget, Git safety, or verifier minimums needed to run that slice safely.

At the end of each milestone, the app must build and applicable tests must pass. Use mock adapters for deterministic automated tests and conduct a separately labelled live smoke test only when the user configures a real provider/agent.

### Milestone 0 — Repository foundation

- inspect environment, working directory, operating system, package manager, Git status, and pre-existing files;
- initialize workspace/monorepo, TypeScript strict config, lint/format/test scripts;
- create backend and frontend shells;
- create README, security/privacy notes, and `.env.example`;
- add health endpoint and loopback-only binding;
- add CI-friendly scripts and a basic Playwright test harness for the orchestrator dashboard shell.

**Acceptance:** clean install, start backend and UI, health endpoint works, lint/typecheck/build/test scripts exist, and a Playwright smoke test launches the dashboard and captures a baseline screenshot. The screenshot is an artifact, not by itself proof that the UI is correct.

### Milestone 1 — Persistence and bare control dashboard

- SQLite migrations/schema for projects, policy versions, roadmap items, tasks, task attempts, runs, events, artifacts, provider profiles, budgets, and approvals;
- project create/read/list using a minimal form (no full wizard required yet);
- durable event log and SSE replay/reconnect;
- local session/origin protection;
- dashboard shows run state, active task, last event, provider/privacy route, current budget usage, and working Start/Pause/Stop controls (disabled when inapplicable with a clear reason);
- idempotent start and task-creation requests.

**Acceptance:** create/list a project persists after restart; invalid state transitions and duplicate start requests are rejected/idempotently handled; browser reconnect receives missed events; Stop can cancel a test worker.

### Milestone 2 — Minimum real provider and coding-agent adapters

- normalized `ReasoningProvider` interface;
- OpenAI API adapter and OpenAI-compatible local endpoint adapter (Ollama/`llama.cpp`/vLLM-style endpoint as supported by tested capabilities);
- minimal Cloud and Local-only selection with no silent fallback; full hybrid policy editor is deferred;
- official Antigravity CLI discovery/version/auth/capability probe and minimal headless adapter;
- normalized coding-agent interface plus deterministic mock adapter;
- provider rate/usage metadata, request/token ceilings, preliminary cost ledger, per-task/run budget enforcement hooks;
- schema-validated Planner/Executor/Critic message contracts; one fresh agent session per task attempt.

**Acceptance:** provider tests pass; configured local endpoint answers a real probe; disconnected local provider becomes a blocker without cloud calls; mock agent protocol handles normal/malformed output/timeout/cancel; Antigravity's current documented headless command is verified against the installed version before execution; no undocumented CLI flags are assumed.

### Milestone 3 — Early autonomous vertical slice (mandatory proof point)

Implement the **smallest complete but safe loop** using the minimal project form. Do not wait for upload parsing, preset customization, advanced hybrid routing, or a polished wizard.

- create a simple project with a short objective, workspace, one configured provider, one coding-agent adapter, and a manually approved initial roadmap item;
- assemble a compact Planner context from `SPEC.md`, `DECISIONS.md`, roadmap item, repo map/current state, policy, last relevant summaries, and budget;
- Planner emits one schema-valid, roadmap-linked task with acceptance criteria;
- create an isolated task worktree/branch where safe, dispatch a fresh coding-agent session, and collect a normalized JSON report;
- run the orchestrator's actual lint/typecheck/test/build and diff/policy checks regardless of agent claims;
- for a web/UI task, start the target app under supervision, run Playwright assertions, collect browser console/network failures, and capture desktop/mobile screenshots; a non-UI task records browser checks as `not_applicable` only under profile/task policy;
- run a separate Critic call against the actual diff and verifier evidence; apply the deterministic acceptance gate;
- make a checkpoint commit and integrate only after gates pass; preserve failed artifacts and discard/revert only the isolated attempt;
- show the timeline, current task, evidence, diff, cost estimate/usage state, and stop reason in the dashboard;
- implement finite repair/request/time/cost ceilings before any autonomous run is permitted.

**Acceptance — must pass before moving on:** a test fixture with a deliberately failing check receives a roadmap-approved task, is modified by a mock agent, fails the independent verifier, receives a fresh-session repair, passes checks, gets a separate Critic acceptance, and is committed/integrated safely. A UI fixture additionally demonstrates a browser assertion plus screenshot artifact. A budget-exhaustion test blocks the next model call before provider dispatch. The run is resumable after restart without duplicate execution. Conduct and label one optional live Antigravity smoke test after the mock-backed tests pass. This milestone is the project's primary feasibility gate.

### Milestone 4 — Cost accuracy, reliability, context compaction, and recovery

- cost estimation from token usage and configurable pricing catalogue, including Planner + Critic + repair reserve and any measurable agent/vision usage;
- beginner defaults: $0.50 soft per-task warning, $2.00 hard per-task ceiling, $10.00 hard per-run ceiling; warn at 70% and 90%; editable before a run;
- display observed vs estimated vs reserved vs unknown usage; never report unknown provider/CLI billing as zero;
- request/token ceilings when provider dollars cannot be observed; bounded exponential backoff with jitter and provider-specific handling of auth/quota/rate-limit errors;
- full run/task attempt state machine, crash recovery, event replay, process ownership/orphan cleanup;
- repeated-error/no-diff/edit-ping-pong/no-progress detection and blocker escalation;
- context compaction/rolling summaries with hard constraints and acceptance criteria preserved;
- Git dirty-state protection and checkpoint recovery hardening.

**Acceptance:** calculated estimate includes all Planner/Critic/repair calls; unknown cost is clearly labelled; atomic budget reservation prevents concurrent overspend; restart does not duplicate execution; repeated failure becomes `stalled`; local-only remains offline at the reasoning layer; Stop terminates or safely marks surviving child processes.

### Milestone 5 — Project wizard, autonomy modes, profiles, and blueprint import

- six-step project wizard (idea, blueprint, profile, autonomy, constraints/provider, plan review);
- creative-within-constraints, creative exploration, and strict blueprint adherence modes;
- customizable profiles for general software, frontend, backend, full-stack, AI/ML, data science, CLI, embedded/IoT, and custom projects;
- import `.md`, `.txt`, `.json`, `.yaml`/`.yml`, `.pdf`, `.docx` with size/type limits and preview/provenance;
- extracted requirements include explicit/inferred status, source location, confidence and proposed acceptance tests;
- hard/soft/informational constraints, conflict UI and versioning; user-approved initial roadmap and baseline policy;
- explicit Cloud/Local-only/Hybrid routing UI and data-classification policy; show reasoning-provider privacy separately from coding-agent privacy;
- import content is untrusted and cannot modify system safety, secrets, provider privacy mode, spending limits, or authorization rules.

**Acceptance:** wizard creates an approved project plan; preset edits persist; contradictory requirements block initialization until resolved; unsupported format/parse warnings are honest; local-only routes never fall back; hybrid provider routing is recorded per call.

### Milestone 6 — Human direction and full browser/visual verification

- direction inbox with `next_task`, `replan`, `safe_interrupt`, approval/rejection, pause, and stop semantics;
- safe-boundary interrupt, task/message ordering, policy update/version records;
- Playwright BrowserVerifier for target web UI tasks and the orchestrator itself;
- desktop/mobile browser assertions, console/network capture, screenshots, optional approved visual diff baseline, accessibility smoke tests, traces/reports, evidence linking to acceptance criteria;
- critic screenshot review if the configured model supports vision; otherwise mark visual judgement as requiring human review when visual intent is subjective;
- task inspector shows screenshots/diffs next to code diff, tests, agent claims, actual verifier results and Critic outcome.

**Acceptance:** a mid-task human message affects the next safe prompt; Stop blocks further dispatch; UI test catches a deliberately broken interaction; screenshots and browser logs are preserved; visual baseline cannot be silently replaced; a non-vision Critic cannot mark subjective visual criteria verified.

### Milestone 7 — Advanced UI, export, and hardening

- searchable timeline and logs, run report, configurable retention and export;
- provider/settings screen, cost breakdown, privacy badges, approvals/blockers, policy history;
- advanced profile/policy editor; allowlists and per-role provider settings;
- accessibility and responsive pass for the orchestrator; full E2E/security tests; documentation for Linux/Windows where practical;
- final acceptance checklist and known-limitations inventory.

**Acceptance:** all release-gate criteria pass; no known unresolved critical security issue; actual supported features and provider limitations are clearly documented; no fake controls or misleading success states remain.

## 32. MVP acceptance criteria — release gate

Do not label the MVP complete until these are demonstrated:

- [ ] New project can be created from an informal idea.
- [ ] Existing project can be selected without destructive modification.
- [ ] Blueprint upload supports the listed formats or clearly marks any format that is still unsupported.
- [ ] Extracted requirements show source provenance and explicit/inferred status.
- [ ] The user can select and customize each of the three autonomy modes.
- [ ] Hard constraints are enforced outside the language model where claimed.
- [ ] Presets exist for general, frontend, backend, full-stack, AI/ML, data science, CLI and embedded/IoT projects.
- [ ] Local-only reasoning connects to a configured local model endpoint and never silently falls back to the cloud.
- [ ] OpenAI cloud reasoning works through protected backend configuration, with billing/usage caveats shown.
- [ ] Hybrid routes are explicit and logged per operation.
- [ ] The UI independently labels reasoning-provider privacy and coding-agent privacy.
- [ ] A local-only reasoning configuration paired with Antigravity is not misrepresented as end-to-end offline.
- [ ] Antigravity CLI integration uses official supported headless interfaces, handles streaming and errors, and does not require browser UI automation.
- [ ] Human messages can change the next task, cause re-planning, request safe interruption, or stop the run.
- [ ] The task loop is governed by a persisted state machine and finite limits.
- [ ] Before a run, the UI shows a cost estimate/breakdown including Planner, Executor, Critic, optional vision review, and all configured repair attempts.
- [ ] Beginner budgets default to $0.50 soft per-task warning, $2.00 hard estimated/known per-task ceiling, and $10.00 hard per-run ceiling, unless explicitly changed by the user; the UI labels these as estimates when exact billing cannot be enforced.
- [ ] Usage distinguishes measured, estimated, reserved, unknown, and local-no-API-charge states; a quota/subscription-based coding agent with no cost telemetry is not falsely shown as $0.
- [ ] The end-to-end vertical slice is implemented and accepted by Milestone 3, before the full wizard/importers and advanced hybrid routing UI.
- [ ] The verifier independently runs every configured mandatory lint/typecheck/test/build command and captures actual argv, exit status, output artifact, duration, and check state; agent self-reports are only claims.
- [ ] A web/UI task runs Playwright browser assertions when relevant, captures actual console/network failures and desktop/mobile screenshots, and links each UI acceptance criterion to evidence; screenshot presence alone never means functional pass.
- [ ] Visual baseline diffs and thresholds are explicit; baseline updates cannot silently make failed checks pass; subjective criteria are marked for human review if no vision-capable Critic is configured.
- [ ] Planner and Critic are separate logical roles and invocations with separate validated schemas; a distinct critic model can be configured, and neither model can waive the deterministic acceptance gate.
- [ ] Every executable task references an approved roadmap item or approved scope-change proposal; unapproved scope expansion is not dispatched.
- [ ] The Planner consults canonical `SPEC.md`, `DECISIONS.md`, `ROADMAP.md`, repo map, current state, recent summaries, and blockers.
- [ ] Each task attempt uses a fresh coding-agent session and a bounded task-specific executor context by default.
- [ ] Git worktree/branch isolation is used by default when safely available; accepted task changes receive checkpoint commits; failed isolated attempts are safely reverted/discarded only after artifacts are preserved.
- [ ] No automatic reset/clean/stash or rollback can destroy pre-existing user changes; uncertain mixed diffs pause for human resolution.
- [ ] Repeated errors, no-diff attempts, edit ping-pong, ignored review feedback, and repeated agent questions trigger bounded stall detection and escalation.
- [ ] Agent permission prompts/soft denials/questions become explicit approval/blocker states instead of indefinite headless hangs.
- [ ] Provider retries use bounded backoff/jitter and respect rate-limit instructions; auth/quota/policy failures do not loop.
- [ ] Project memory persists across application and agent restarts.
- [ ] A failing task gets bounded repair attempts and then stops/blocks rather than looping forever.
- [ ] Git dirty state is preserved; no automatic destructive cleanup is used.
- [ ] UI control reconnection does not start duplicate work.
- [ ] Stop and Pause work even if the current provider is stuck.
- [ ] API credentials are never returned to the browser, logged, or saved in plaintext project config.
- [ ] Service binds to loopback by default and rejects untrusted cross-origin mutations.
- [ ] Core unit/integration/E2E tests pass, including offline/no-fallback tests.
- [ ] README explains setup, provider configuration, privacy boundaries, known limitations, and the distinction between local reasoning and end-to-end offline execution.

## 33. Recommended defaults for beginner users

The default experience should not overwhelm someone who has never configured an agent loop.

- Default project mode: **Creative within constraints**.
- Default safety: restrictive workspace, no deployment, no destructive operations, no automatic credential handling, no cloud fallback from local-only.
- Default concurrency: one agent writing to a workspace.
- Default task: small and independently verifiable.
- Default retry: two repair attempts before blocking.
- Default cost controls for API-metered reasoning: $0.50 soft per-task warning, $2.00 hard per-task ceiling, $10.00 hard per-run ceiling; show estimates and reserve the maximum configured repair cost before dispatch. These are configurable starter values, not a guarantee of third-party coding-agent billing.
- Default visual validation: Playwright desktop (`1440×900`) and mobile (`390×844`) smoke/assertion runs for UI-related tasks, plus screenshots and console/network evidence; visual-diff gating is enabled only when an approved baseline/criterion exists.
- Default run iteration cap: 30; expose this as adjustable and explain that it is a limit, not completion.
- Default initial project preset: recommended from the idea, but user can change it.
- Default project plan: show and require approval before code changes.
- Default imported blueprint handling: preview source and inferred requirements before approval.
- Default user steering: incorporated into the next safe task unless marked urgent/stop.
- Default model privacy: ask user to choose provider mode during setup; Local-only is the privacy-preserving choice but requires a configured local model. Never promise it will be “one-click” if a model server is not present.
- Default UI: show progress, last action, tests, active model/agent, budget and blockers without requiring advanced configuration knowledge.

## 34. Advanced customization for power users

Expose an Advanced section without making it required for basic use.

- arbitrary user-defined hard/soft/informational constraints;
- YAML/JSON policy editor with schema validation and diff/rollback;
- custom profiles and import/export;
- hybrid route table by operation and data classification;
- custom OpenAI-compatible base URL, model ID, API mode, timeout, temperature/top-p if supported, output-token cap, context budget;
- local model capability testing and optional manual capability override with a warning;
- custom task/plan/review prompt templates with immutable policy footer;
- path allow/deny globs, sensitive path patterns, ignore rules;
- task risk classification and approval thresholds;
- allowed verification command definitions, timeouts, environment variables and output limits;
- task/run iteration/time/request/token/cost limits;
- custom completion criteria and quality gates;
- stagnation thresholds and retry policy;
- retention/backup/export settings;
- Git checkpoint strategy, branch naming, worktree strategy, and whether commits are manual or opt-in automated;
- agent executable override and per-platform CLI arguments, validated and shown before use;
- per-provider concurrency and timeout settings;
- provider routing logs, task event timeline, raw diagnostic artifact access after secret redaction;
- feature flags for experimental capabilities.

Advanced mode must not permit disabling the immutable safety guarantees or creating a public network server without a separate explicit, well-explained deployment path that is outside MVP.

## 35. Future roadmap (not MVP blockers)

After core reliability is demonstrated:

1. Desktop package using Tauri/Electron while reusing the same backend/domain logic.
2. Additional coding-agent adapters and possibly an explicit locally hosted coding agent for true end-to-end offline workflows.
3. Local model installation management, hardware benchmark suggestions, model download verification and model license display.
4. Optional visual browser automation and screenshot-based acceptance checks.
5. More advanced Git worktree/branch review and safe merge workflow.
6. Multi-agent research/review roles with isolated workspaces and conflict arbitration.
7. MCP tool integrations with explicit permissions and per-tool privacy metadata.
8. Optional local semantic search/vector index for large projects, with an option to disable embeddings or keep them fully local.
9. Project-specific evaluation suites and scorecards.
10. Remote access behind explicitly configured, authenticated VPN/tunnel; never expose raw localhost service publicly.
11. Team/multi-user features only after a separate threat model and server-side auth/RBAC are designed.
12. Optional notifications and opt-in usage telemetry with privacy controls.

## 36. Known limitations and honest UI labels

The system must be clear about what it cannot guarantee:

- An LLM can make incorrect plans or miss defects; independent tests reduce risk but cannot prove all software correct.
- A local OpenAI-compatible endpoint may support only a subset of the OpenAI API; the adapter must expose capability differences.
- A model may be too weak/slow for complex planning even when it can connect technically.
- API usage/cost may be partly unknown when a provider does not report usage or pricing metadata.
- Antigravity’s own execution permissions and network behavior are controlled partly by that tool. Running its CLI locally does not make its model local.
- The orchestrator cannot guarantee no network egress by arbitrary child processes without OS-level sandbox/firewall enforcement.
- Screenshots do not prove every UX behavior works; physical hardware checks cannot be inferred from simulation.
- Git rollback can be unsafe when user changes and agent changes are mixed or when no reliable baseline exists; in such cases pause and request resolution.
- Imported blueprints can be incomplete, contradictory, untrusted, or impossible to parse perfectly.

## 37. Official references to consult during implementation

Use these as living references and verify the current content when building. Do not assume undocumented flags or third-party wrappers are supported by the official product.

- **Antigravity CLI overview:** https://www.antigravity.google/docs/cli/overview
- **Antigravity headless mode:** https://www.antigravity.google/docs/cli/headless/ — documents print mode, JSON/stream-JSON output, streaming prompts via stdin, result events, permissions and error handling.
- **Antigravity CLI use/configuration:** https://www.antigravity.google/docs/cli/using/
- **OpenAI API platform:** https://platform.openai.com/docs/ — consult current Responses API/SDK references and model capability details.
- **OpenAI API data controls:** https://platform.openai.com/docs/guides/your-data
- **OpenAI API billing vs ChatGPT billing:** https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- **vLLM OpenAI-compatible server:** https://docs.vllm.ai/en/latest/serving/openai_compatible_server/
- **llama.cpp server:** https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- **Ollama documentation:** https://docs.ollama.com/ — verify current OpenAI compatibility documentation and any endpoint-specific limitations.

## 38. Revision 1.2 implementation additions checklist

The following remain mandatory from Revision 1.1 and are extended by Revision 1.2. These items close failure modes that are easy to miss in a prompt-loop MVP:

- Separate Planner and Critic invocations, schemas, artifacts, and provider identities. The Critic is not primed with the Planner’s acceptance verdict.
- Independent orchestrator-run lint/typecheck/test/build evidence on every attempt; never trust agent self-reports.
- Canonical, versioned `SPEC.md`, `DECISIONS.md`, approved `.orchestrator/ROADMAP.md`, `.orchestrator/REPO_MAP.md`, and rolling `CURRENT_STATE.md`/summaries.
- Roadmap traceability and scope-drift rejection before task dispatch. Creative ideas become proposals subject to policy, not a backdoor to execute arbitrary scope.
- Fresh coding-agent session and compact executor context per task attempt.
- Default Git task/attempt worktree isolation, accepted task checkpoint commits, safe integration, and automatic rollback/discard of failed isolated attempts after preserving the evidence. Never destructively revert a mixed/user working tree.
- JSON-schema-validated agent reports, Planner plans, and Critic results, with explicit `task_id`, `status`, `files_changed`, `tests`, `blockers`, `questions`, and `suggestions`.
- Persistent state machine, idempotency, retry/backoff/rate-limit policies, provider cooldowns, and crash-safe resume.
- Explicit states for permission requests and agent questions; no infinite headless waiting and no unrestricted permission bypass.
- Deterministic stuck detection for repeated errors, no-diff attempts, edit ping-pong, unchanged plans, and repeatedly ignored feedback.
- Tests that prove each of these properties rather than relying on manual claims.

- Move the complete autonomous vertical slice to Milestone 3, before the full project wizard, file importers, and advanced provider routing UI; the slice includes finite budgets and browser evidence for UI work.
- Estimate all Planner/Executor/Critic/vision/repair model calls before execution; reserve repair costs; default to $0.50 soft task warning, $2.00 hard task cap, and $10.00 hard run cap for metered reasoning calls; keep all values editable.
- Explicitly show `measured`, `estimated`, `reserved`, `unknown`, or `local_no_api_charge`; never display unobservable subscription/CLI cost as zero.
- Add a Playwright-based BrowserVerifier for UI tasks with functional assertions, browser console/network evidence, desktop/mobile screenshots, artifact linkage, optional approved visual diffs, and human-review handling when visual judgment is unavailable.

## 39. Final implementation directive

Prioritize correctness and safe recovery over feature count. Build the smallest complete path from project initialization to a verified coding task before expanding UI polish or introducing parallelism.

The central product contract is:

> The user defines the goal and the permitted autonomy. The Project Brain plans and reviews. The coding agent implements. The orchestrator controls execution, enforces constraints, validates evidence, records memory, manages budgets, and decides whether the loop may continue. The user can redirect or stop it at any time.

The implementation is successful only when this contract is reflected in real code paths and tests—not just in prompts, labels, or documentation. The release gate is not satisfied if the system has a Planner but no independent Critic, reports “passed” based only on agent text, executes off-roadmap work without approval, reuses an unbounded executor session, lacks safe task-level Git recovery, or can hang indefinitely on a headless permission/question prompt.
