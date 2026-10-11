# Security model

Orches changes files on your machine based on language-model output, so it treats that output as untrusted
and keeps the blast radius to one folder you chose. This document describes what is actually enforced.

## Network exposure
- The server binds to `127.0.0.1` by default.
- Requests whose `Host` header is not `127.0.0.1`/`localhost`/`[::1]` are refused (DNS-rebinding protection).
- Browser requests from non-loopback origins are rejected by CORS.
- There is no login: anything that can reach the loopback port can use the API. Do not expose the port
  (for example via `ORCHESTRATOR_HOST=0.0.0.0` or a tunnel) on shared machines.

## Workspace confinement
- A project's folder must be an absolute path to an existing (or explicitly created) directory. Drive roots,
  your home folder itself, system folders, and the orchestrator's own install and data folders are refused.
- Every path proposed by a model is resolved by `workspace/path-safety.ts`: absolute paths are accepted only
  when they point inside the workspace, `..` traversal is rejected, Windows device names and invalid
  characters are rejected, and writes through symlinks/junctions that leave the workspace are refused.
- `.git`, `.orchestrator`, `.env*` (except `.env.example`-style templates) and key files (`.pem`, `.key`, …)
  can never be written by the built-in coder, and any change to them fails the acceptance gate.

## Changes are reversible
- Before a run touches anything, a snapshot of the workspace is stored **outside** the workspace (in the
  data directory). A rejected, cancelled or crashed run restores exactly the files it changed; the discarded
  versions are kept in a backup folder rather than deleted.
- The orchestrator never switches, creates, resets or deletes Git branches. In a clean repository it commits
  only the accepted files on the current branch; in a repository with uncommitted work it commits nothing.

## Command execution
- Verification commands come from the project (npm scripts, pytest/unittest, `go test`, `cargo test`) or from
  commands **you** typed into the project settings. Model output is never executed.
- Commands run with argument vectors; `cmd.exe` is used only for `.cmd` shims, with metacharacters rejected.
- Every process has a timeout and is killed with its whole process tree on timeout or Stop.

## Secrets
- The OpenAI key is read from `OPENAI_API_KEY` or stored in `settings.json` inside the data directory
  (plain text, protected only by your user account's file permissions). It is never returned by the API
  (only a masked form) and is not passed to verification processes.
- Event payloads (logs shown in the dashboard and stored in the database) pass through a secret redactor.
- Local providers never fall back to a cloud provider. When OpenAI is selected, task text, project file
  excerpts and diffs are sent to OpenAI.
