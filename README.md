# Orches — Autonomous Development Orchestrator

Orches is a local-first development orchestrator that plans engineering tasks using an external reasoning provider (ChatGPT Web), drives coding agents inside a scoped workspace folder, independently verifies code changes with project checks and chunked review gates, and guarantees durable idempotency across restarts and crash windows.

---

## Key Capabilities

- **ChatGPT Web Reasoning Provider**: Browser-automated integration with ChatGPT Web featuring crash-window recovery, user-turn reconciliation, and bounded generation waits.
- **Durable Idempotency & Concurrency Locking**: Atomic SQLite-backed operation lifecycle (`prepared` → `submitting` → `accepted_by_browser` → `response_received` → `completed`) preventing duplicate prompt dispatches across retries and restarts.
- **Chunked Diff & Independent Review**: Validates implementation changes in scoped diff chunks against acceptance criteria, rejecting contradictory verdicts.
- **Continuous Quality Loop**: Mandatory full-system audit and remediation passes before final completion.
- **Antigravity IDE Bridge & Built-in Coder**: Native extension bridge to Antigravity IDE or standalone built-in code modification runner.
- **Safe Path Confinement**: Strict boundary checking preventing workspace escape or unauthorized modification of system and environment files.

---

## Prerequisites

- **Node.js**: `v22.5.0` or higher (Orches uses Node's native `node:sqlite`).
- **npm**: `v10.0.0` or higher.
- **Git**: Installed and available in PATH.
- **Web Browser**: Chromium (managed via Playwright for ChatGPT Web automation).

---

## Quick Start

### Windows

1. Run the automated setup script:
   ```cmd
   scripts\setup.bat
   ```
2. Launch Orches:
   ```cmd
   scripts\start.bat
   ```
3. Open the web dashboard in your browser at `http://127.0.0.1:4317`.

### Linux (Ubuntu / Debian / Fedora)

1. Make scripts executable and run setup:
   ```bash
   chmod +x scripts/*.sh
   ./scripts/setup.sh
   ```
2. Launch Orches:
   ```bash
   ./scripts/start.sh
   ```
3. Open `http://127.0.0.1:4317` in your browser.

---

## Manual Installation & Verification

If you prefer to configure manually:

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browser binary
npx playwright install chromium

# 3. Build shared packages, server, and web frontend
npm run build

# 4. Run system diagnostic self-check
npm run diagnose

# 5. Start the production server
npm start
```

---

## Configuration

Configuration can be set via environment variables or a local `.env` file (copied from `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ORCHESTRATOR_HOST` | `127.0.0.1` | Host address to bind (loopback only for security). |
| `ORCHESTRATOR_PORT` | `4317` | HTTP port for server and web UI. |
| `NODE_ENV` | `production` | Runtime mode (`production` or `development`). |
| `ORCHESTRATOR_DATA_DIR` | Platform default | Root directory for SQLite DB and metadata. |
| `CHATGPT_WEB_HEADLESS` | `false` | Set to `true` to run Chromium in headless mode. |
| `CHATGPT_WEB_TIMEOUT_MS` | `300000` | Response timeout in milliseconds (5 minutes). |

### Platform Data Directories

If `ORCHESTRATOR_DATA_DIR` is not explicitly set, Orches stores runtime state in standard platform folders:
- **Windows**: `%APPDATA%\AutonomousDevOrchestrator`
- **Linux**: `~/.config/AutonomousDevOrchestrator`
- **macOS**: `~/Library/Application Support/AutonomousDevOrchestrator`

---

## Antigravity IDE Native Bridge

If you use Google Antigravity IDE:
1. Build and install the bridge extension:
   ```bash
   npm run bridge:install
   ```
2. Open your project workspace in Antigravity IDE. The extension activates automatically, advertising its communication port to Orches.

---

## Diagnostics & Troubleshooting

Run the self-check diagnostic suite anytime:
```bash
npm run diagnose
```

### Common Issues

1. **Port 4317 in use**:
   - Another Orches instance is already running. Either stop the running instance or configure `ORCHESTRATOR_PORT=4318` in `.env`.
2. **ChatGPT Web session not authenticated**:
   - When running with `CHATGPT_WEB_HEADLESS=false`, log in to your account at `chatgpt.com` in the spawned browser window. The browser profile persists automatically.
3. **Linux Headless Environments**:
   - If running on a headless Linux server without a display server, install dependencies with `npx playwright install-deps chromium` and run under `xvfb-run` or set `CHATGPT_WEB_HEADLESS=true`.

---

## License

MIT
