# Security & Privacy Policy

## 1. Loopback-Only By Default
The Autonomous Development Orchestrator is designed as a local-first application. By default, the Fastify HTTP server binds exclusively to `127.0.0.1` (loopback). It does not listen on public interfaces (`0.0.0.0`) and rejects external connections.

## 2. Cross-Origin Mutation & CSRF Protection
- Origin headers are strictly checked against configured loopback origins.
- State-mutating requests (POST, PATCH, DELETE) require a valid local session token.
- Web browser access is restricted to localhost/127.0.0.1.

## 3. Provider Privacy Boundaries
- **Cloud Reasoning:** When enabled, prompts are transmitted to the OpenAI API over HTTPS. Never place secrets, private keys, or passwords in prompts.
- **Local-Only Reasoning:** Project Brain operations call only the locally configured HTTP endpoint (Ollama, llama.cpp, vLLM). No silent cloud fallback is permitted.
- **Privacy Labeling:** The application independently labels the privacy status of the reasoning provider and coding agent. Using Antigravity with a remote service while using local reasoning is marked as **Hybrid/Remote**, never falsely advertised as "End-to-End Offline".

## 4. Child Process & Execution Isolation
- Child processes are invoked using `child_process.spawn` with `shell: false` and explicit argument arrays.
- Model prose is untrusted and never directly evaluated in shell contexts.
- Pre-approved command allowlists govern verification commands.
- Verification outputs and logs are bounded to prevent denial-of-service via unbounded log creation.

## 5. Secret Handling & Redaction
- API keys are stored in backend environment configuration or secure OS-level data files.
- Keys are never echoed back in API responses or SSE streams (only masked suffixes are displayed).
- Automated regex and entropy scanners redact credentials and tokens prior to persisting run artifacts.
