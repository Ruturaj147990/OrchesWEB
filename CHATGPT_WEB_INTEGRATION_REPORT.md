# Orches — ChatGPT Web Reasoning Integration Report

## 1. Executive Summary

Orches has completed its architectural migration from API/local reasoning models (OpenAI API and Ollama) to a **browser-based ChatGPT Web reasoning provider** (`ChatGPTWebProvider`, `id: "chatgpt-web"`). 

All dependencies on the official `openai` SDK and local Ollama daemon have been eliminated. Orches now drives Playwright Chromium against `chatgpt.com` using a dedicated persistent profile (`data/browser/chatgpt`), maintaining 1-to-1 project-scoped conversation mappings, robust source material attachment manifests with SHA-256 integrity and secret redaction, and direct engineering instruction extraction for the native Antigravity agent.

---

## 2. Inventory of Removed & Added Components

### Removed (Completely Eradicated):
- **Dependencies**: Removed `openai` from `apps/server/package.json`.
- **OpenAI API Classes & Modules**: Deleted `apps/server/src/providers/reasoning/openai/` (`openai-provider.ts`). Zero API key requirements or cloud USD billing.
- **Ollama / OpenAI-Compatible Provider**: Deleted `apps/server/src/providers/reasoning/openai-compatible/` (`local-provider.ts`). Removed endpoint normalization, model tagging, and Ollama pull routines.
- **Settings & Environment Variables**: Removed `openaiApiKey`, `openaiModel`, `LOCAL_REASONING_BASE_URL`, `LOCAL_REASONING_MODEL`.
- **UI Provider Selectors**: Eradicated OpenAI and Ollama selection options from SettingsDialog and TaskComposer.

### Added (ChatGPT Web Architecture):
- **Playwright Chromium**: Added Playwright integration in `apps/server/package.json` for headful/headless persistent browser automation.
- **ChatGPT Web Core Engine** (`apps/server/src/providers/reasoning/chatgpt-web/`):
  - `browser-manager.ts`: Cross-platform Chromium lifecycle, persistent profile at `data/browser/chatgpt`, multi-tab safety, process exit cleanup, profile lock detection.
  - `state-machine.ts`: Explicit state transition enforcement (`IDLE` -> `LAUNCHING_BROWSER` -> `NAVIGATING` -> `SUBMITTING_PROMPT` -> `GENERATING` -> `RESPONSE_COMPLETE`).
  - `auth-detector.ts`: Accurate detection of authentication state (`AUTHENTICATED`, `LOGIN_REQUIRED`, `CHALLENGE_DETECTED`), informing user when sign-in is required without scraping credentials.
  - `conversation-manager.ts`: Persistent 1-to-1 mapping of each Orches project to a dedicated ChatGPT Web conversation URL, preventing cross-project context leaks.
  - `attachment-uploader.ts`: Inspects source materials and blueprints, scans for secrets via `SecretRedactor`, attempts direct file input upload, and falls back to numbered chunked text.
  - `prompt-sender.ts`: Pre-submission DOM inspection, baseline text tracking, duplicate prompt submission prevention.
  - `response-reader.ts`: Multi-signal generation completion detection (Stop button disappearance, DOM text stabilization, Send button re-enable), error banner detection, and marker extraction.
  - `selectors.ts`: Resilient semantic selectors prioritizing accessibility, ARIA labels, and data attributes.
  - `chatgpt-web-provider.ts`: Full implementation of `ReasoningProvider` interface (`id: "chatgpt-web"`).
- **SQLite Persistence**:
  - Migration `0006_chatgpt_web_and_source_manifest` adding `project_chatgpt_conversations` and `source_manifest_items`.
  - `ProjectChatGptRepository` for managing 1-to-1 project conversation mappings.
  - `SourceManifestRepository` for tracking attachment delivery receipts and SHA-256 hashes.
- **Web Dashboard Integration**:
  - Settings dialog with ChatGPT Web configuration, persistent session status, and direct "Open ChatGPT Browser" launcher.
  - TaskComposer badge showing "ChatGPT Web · Browser".

---

## 3. Data Flow Architecture

```
User Task (Web Dashboard)
        │
        ▼
Orches RunPipeline
        │
        ├─► SourceManifestRepository (Compute SHA-256, sanitize secrets via SecretRedactor)
        │
        ├─► ProjectChatGptRepository (Retrieve or establish 1-to-1 project conversation)
        │
        ▼
ChatGPTWebProvider (Playwright Chromium)
  ├─► Profile: data/browser/chatgpt (Persistent cookies & login session)
  ├─► Navigate to mapped conversation: https://chatgpt.com/c/<uuid>
  ├─► Deliver Attachments / Chunked Text Fallback
  ├─► Submit Engineering Prompt (wrapped in instructions protocol)
  ├─► ResponseReader: detect completion & extract [ORCHES_ANTIGRAVITY_INSTRUCTION] markers
        │
        ▼
Extracted Antigravity Instruction
        │
        ▼
Orches Bridge Extension (IDE)
  ├─► Executes antigravity.sendPromptToAgentPanel
  ├─► Antigravity Agent inspects code, edits files, and executes commands
        │
        ▼
Orches Verification & Review Gate
  ├─► Project Checks (npm test, build, lint, pytest, etc.)
  ├─► Path-Safety and Git Status Inspection
  ├─► Acceptance or Scoped Rollback
```

---

## 4. Test Verification Summary

- **Total Test Suites**: 17 passed (17 total, 100%)
- **Total Unit & Integration Tests**: 158 passed (158 total, 100%)
- **Static Compilation**:
  - `packages/shared-types`: Clean build (`tsc`)
  - `apps/server`: Clean build (`tsc`)
  - `apps/web`: Clean production build (`tsc && vite build`)
- **Key Suites Verified**:
  - `chatgpt-web.test.ts`: 9 tests passing (SQLite mappings, manifest tracking, secret sanitization, chunking, marker extraction, conversation URL parsing).
  - `providers-and-process.test.ts`: 12 tests passing (ChatGPT Web provider defaults, directory resolution, registry resolution, settings persistence, process runner).
  - `conversation-memory.test.ts`: 12 tests passing (ChatGPT Web 32k context window budget calculations, compaction triggers, memory persistence).
  - `conversation-memory-validation.test.ts`: 10 tests passing (full multi-turn persistence, compaction, boundary conditions).
  - `pipeline.test.ts`: 17 tests passing (end-to-end task execution with scripted model, repair loops, rollback, Git safety).
  - `closed-loop.test.ts`: 5 tests passing (Antigravity instruction loops, external agent coordination, error preservation).
