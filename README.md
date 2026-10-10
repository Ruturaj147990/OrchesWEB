# Autonomous Development Orchestrator

A local-first application that coordinates a **project reasoning brain** and a **coding agent** in a verifiable, bounded, and human-steerable autonomous development loop.

## Overview

The orchestrator combines:
- **Project Brain / Reasoning Provider:** High-level planning, decomposition, constraint validation, and independent Critic review (supporting OpenAI API and local OpenAI-compatible endpoints like Ollama, llama.cpp, vLLM).
- **Coding Agent Adapter:** Task dispatch to official Antigravity CLI (`agy`) or deterministic mock agent.
- **Independent Verification Subsystem:** Orchestrator-driven linting, typechecking, testing, building, and Playwright browser/screenshot validation for web tasks.
- **Deterministic Policy & Acceptance Gate:** Code changes require both independent verification passes and separate Critic review before safe Git checkpoint commits.
- **Cost & Budget Controls:** Hard per-task and per-run ceilings ($0.50 warning, $2.00 task ceiling, $10.00 run ceiling defaults) preventing accidental model overspend.

## Prerequisites

- Node.js (Active LTS, v20+ or v24+)
- Git 2.30+
- (Optional) Antigravity CLI (`agy`) installed and authenticated for live coding agent tasks.
- (Optional) Ollama or local LLM server for local reasoning mode.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run tests:**
   ```bash
   npm test
   ```

3. **Run end-to-end browser tests:**
   ```bash
   npm run test:e2e
   ```

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   Access the dashboard at `http://127.0.0.1:4317`.

## Architecture & Monorepo Structure

- `apps/server`: Fastify REST + SSE backend with SQLite database, task loop, Git manager, and verification supervisor.
- `apps/web`: React + Vite dashboard with real-time SSE stream, task inspector, visual diff viewer, and control deck.
- `packages/shared-types`: Canonical domain models, schemas, and API contracts.
- `packages/policy-schema`: Hard/soft constraint validation and policy engine.
- `packages/profile-presets`: Built-in project profiles (Frontend, Backend, Fullstack, AI/ML, etc.).

## Privacy Boundaries

- **Local Reasoning:** Uses loopback endpoints only; strictly forbids automatic cloud fallback.
- **Honest Labels:** Clearly separates Reasoning Provider privacy (Local/Cloud) and Coding Agent privacy (Local/Remote/Unknown).
