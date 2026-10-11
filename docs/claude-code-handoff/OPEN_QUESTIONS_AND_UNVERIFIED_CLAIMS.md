# Autonomous Development Orchestrator (`orches`)
## Open Questions & Unverified Claims

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Target Audience:** Claude Code / Engineering Handoff  

---

## 1. Executive Summary

This document catalogues every capability, integration boundary, external dependency, or architectural claim that **could not be fully established from the source code alone or through safe non-destructive runtime testing**.

For each item, this document details the exact missing evidence, the potential risks, and concrete steps Claude Code or the human operator should take to obtain clarification.

---

## 2. Inventory of Unverified Claims & Open Questions

### Question 1: Does the Native Antigravity IDE Provide a Direct Agent IPC Protocol?
- **Category:** Architecture & Coding Agent Integration
- **Context:** `VisibleIdeAdapter` currently detects the IDE via process list (`Antigravity IDE`) and `storage.json`. It then delegates code generation to the reasoning provider rather than sending instructions into Antigravity's internal agent chat.
- **Unverified Claim:** Whether an official Antigravity IDE extension API, IPC socket, or Language Server Protocol (LSP) command exists that would allow an external process to submit prompts directly to the native agent and capture its streaming canvas edits.
- **Missing Evidence:** No extension source or socket endpoints exist in the repository.
- **How to Obtain Evidence:**
  1. Inspect Antigravity IDE extension directory (`%USERPROFILE%\.gemini\antigravity-ide\extensions\`).
  2. Check if a local HTTP or WebSocket server is spawned by the IDE on startup.
  3. If none exists, keep the current delegation pattern and update documentation to reflect that the orchestrator acts as its own autonomous agent.

---

### Question 2: Official Antigravity CLI (`agy`) Binary Distribution on Windows
- **Category:** External CLI Tooling
- **Context:** `AntigravityAdapter` (`apps/server/src/providers/coding-agents/antigravity/antigravity-adapter.ts`) is designed to invoke `agy --headless --output-format stream-json`.
- **Unverified Claim:** Whether `agy` is packaged for Windows or if it is currently a Google-internal / preview CLI tool.
- **Missing Evidence:** `Get-Command agy` in PowerShell returns command not found.
- **How to Obtain Evidence:**
  - Verify whether `agy` is available as an npm package (e.g. `@google/agy` or `@antigravity/cli`) or a standalone executable. If unavailable on Windows, mark `AntigravityAdapter` as experimental or disabled in Windows environments.

---

### Question 3: BrowserVerifier / Puppeteer in Headless Server Deployments
- **Category:** Verification & UI Assertions
- **Context:** `apps/server/src/verification/browser-verifier.ts` contains Puppeteer integration for running visual assertions and capturing screenshot artifacts.
- **Unverified Claim:** Whether `BrowserVerifier` functions seamlessly in headless Linux Docker containers or Windows Server environments without Chrome pre-installed.
- **Missing Evidence:** Unit tests in `milestone3.test.ts` test `BrowserVerifier`, but rely on system Chrome or Puppeteer's bundled Chromium.
- **How to Obtain Evidence:**
  - Run a smoke test targeting a local HTML server with `BrowserVerifier` to ensure Chromium downloads and launches reliably without GPU hardware.

---

### Question 4: SnapshotManager Memory Scalability on Large Codebases
- **Category:** Workspace Safety & Performance
- **Context:** `SnapshotManager` (`apps/server/src/git/snapshot-manager.ts`) reads files recursively, computes SHA-256 hashes, and calculates unified diffs in memory.
- **Unverified Claim:** Performance and memory footprint when running in a workspace containing 20,000+ files (excluding `node_modules`).
- **Missing Evidence:** Tests to date have run on projects with 5 to 50 files.
- **How to Obtain Evidence:**
  - Benchmark `SnapshotManager.takeSnapshot()` against a directory with 10,000 files to measure memory usage and ensure it does not exceed Node.js heap limits.

---

### Question 5: Handling of Git Worktrees, Submodules, and Uncommitted Stashes
- **Category:** Git Integration
- **Context:** `GitManager` creates attempt branches (`orchestrator/<project>/<task>/attempt-<n>`).
- **Unverified Claim:** How the system behaves if the target Git repository contains submodules, detached HEAD, or uncommitted merge conflicts.
- **Missing Evidence:** Existing Git tests use clean, freshly initialized repositories.
- **How to Obtain Evidence:**
  - Add edge-case test cases in `apps/server/tests/real-world-e2e.test.ts` with uncommitted changes and detached HEAD states to verify that `GitManager` safely pauses execution without destroying unstaged work.
