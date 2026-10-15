import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { config, ORCHESTRATOR_ROOT } from "../config/env.js";

interface DiagnosticResult {
  category: string;
  item: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
  detail?: string;
}

const results: DiagnosticResult[] = [];

function record(category: string, item: string, status: "PASS" | "WARN" | "FAIL", message: string, detail?: string) {
  results.push({ category, item, status, message, detail });
}

// 1. Runtime Environment
function checkNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const versionStr = `v${process.versions.node}`;
  if (major > 22 || (major === 22 && minor >= 5)) {
    record("Runtime", "Node.js Version", "PASS", `${versionStr} (meets requirement >= 22.5.0)`);
  } else {
    record("Runtime", "Node.js Version", "FAIL", `${versionStr} is below required >= 22.5.0`);
  }
  record("Runtime", "Platform / Architecture", "PASS", `${process.platform} (${process.arch}), OS: ${os.type()} ${os.release()}`);
}

// 2. Data Directory & Persistence
function checkDataDirectory() {
  const dataDir = config.dataDir;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probeFile = path.join(dataDir, `.probe-${Date.now()}`);
    fs.writeFileSync(probeFile, "ok", "utf8");
    fs.unlinkSync(probeFile);
    record("Storage", "Data Directory Writable", "PASS", `Directory accessible: ${dataDir}`);
  } catch (err: any) {
    record("Storage", "Data Directory Writable", "FAIL", `Cannot write to ${dataDir}: ${err.message}`);
  }
}

// 3. Playwright & Browser Subsystem
async function checkBrowserSubsystem() {
  try {
    const { chromium } = await import("playwright");
    const browserPath = chromium.executablePath();
    if (browserPath && fs.existsSync(browserPath)) {
      record("Browser", "Playwright Chromium Binary", "PASS", `Found browser executable at: ${browserPath}`);
      // A binary that cannot start (missing system libraries on a fresh Linux install) only shows up on launch.
      try {
        const browser = await chromium.launch({ headless: true, timeout: 30_000 });
        await browser.close();
        record("Browser", "Chromium Starts", "PASS", "Chromium launched and closed successfully.");
      } catch (err: any) {
        const first = String(err.message).split("\n").find((l) => l.trim()) ?? String(err.message);
        record(
          "Browser",
          "Chromium Starts",
          "FAIL",
          process.platform === "linux"
            ? `Chromium could not start: ${first}. Install its system libraries with: sudo npx playwright install-deps chromium`
            : `Chromium could not start: ${first}`
        );
      }
    } else {
      record("Browser", "Playwright Chromium Binary", "WARN", `Playwright executable not pre-installed. Run "npx playwright install chromium" if browser automation fails.`);
    }
  } catch (err: any) {
    record("Browser", "Playwright Module", "WARN", `Could not resolve Playwright: ${err.message}`);
  }

  // The ChatGPT window is shown (sign-in happens there), which needs a graphical session on Linux.
  if (process.platform === "linux" && !config.chatgptWebHeadless) {
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      record("Browser", "Graphical Session", "PASS", `Display available (${process.env.WAYLAND_DISPLAY ? `Wayland ${process.env.WAYLAND_DISPLAY}` : ""}${process.env.WAYLAND_DISPLAY && process.env.DISPLAY ? ", " : ""}${process.env.DISPLAY ? `X ${process.env.DISPLAY}` : ""}).`);
    } else {
      record("Browser", "Graphical Session", "WARN", "No DISPLAY or WAYLAND_DISPLAY: the ChatGPT window cannot open. Start Orches from the Ubuntu desktop session (or run it under xvfb-run after signing in once on the desktop).");
    }
  }

  // Check ChatGPT Profile Dir
  const profileDir = config.chatgptWebProfileDir;
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    record("Browser", "ChatGPT Profile Directory", "PASS", `Persistent profile path ready: ${profileDir}`);
  } catch (err: any) {
    record("Browser", "ChatGPT Profile Directory", "FAIL", `Unable to initialize browser profile directory at ${profileDir}: ${err.message}`);
  }
}

// 4. Antigravity Bridge Integration (both "Antigravity IDE" and "Antigravity"; Windows, macOS, Linux incl. Snap/Flatpak)
async function checkAntigravityBridge() {
  const { findCli, bridgeDirs, conversationDirs, userSettingsDirs, primaryBridgeDir } = await import("./antigravity-locations.js");
  const { listBridges, getBridgeStatus } = await import("./antigravity-agent.js");
  const C = "Antigravity Bridge";

  const cli = findCli();
  record(C, "Antigravity Launcher", cli ? "PASS" : "WARN", cli ? `Found ${cli}` : "Neither 'antigravity-ide' nor 'antigravity' launcher found (needed for 'npm run bridge:install' and 'Open in IDE').");

  const settings = userSettingsDirs();
  record(C, "Antigravity Settings", settings.length ? "PASS" : "WARN", settings.length ? `Found: ${settings.join(", ")}` : "No Antigravity user settings folder found.");

  const dirs = bridgeDirs();
  const advertised = listBridges();
  record(C, "Bridge Discovery Folders", dirs.length ? "PASS" : "FAIL", dirs.length ? `Searched: ${dirs.join(", ")}` : `No bridge folder found (expected ${primaryBridgeDir()}). Install the bridge (npm run bridge:install), then open the project in Antigravity.`);
  record(C, "Advertised Bridge Windows", advertised.length ? "PASS" : "WARN", `${advertised.length} advertised: ${advertised.map((b) => `pid ${b.pid} port ${b.port} app ${b.app ?? "?"} home ${b.home ?? "?"} folders [${(b.folders || []).join(", ")}]`).join(" | ") || "none"}`);

  const status = await getBridgeStatus();
  record(
    C,
    "Responding Bridge Windows",
    status.windows.length ? "PASS" : advertised.length ? "FAIL" : "WARN",
    status.windows.length
      ? status.windows.map((w) => `pid ${w.pid} (${w.app ?? "?"}) canSubmit=${w.canSubmit} folders [${w.folders.join(", ")}]`).join(" | ")
      : advertised.length
        ? "Advertised windows did not answer on 127.0.0.1 (stale files, a firewall/sandbox blocking loopback, or the window was closed)."
        : "No running Antigravity window with the bridge. Open the project folder in Antigravity."
  );
  if (status.windows.some((w) => !w.canSubmit)) {
    record(C, "Agent Panel Command", "FAIL", "A bridge window does not expose 'antigravity.sendPromptToAgentPanel'. Check /status 'agentCommands' for this Antigravity build's command names.");
  }

  const convo = conversationDirs(advertised.map((b) => b.home).filter((h): h is string => Boolean(h)));
  record(C, "Agent Conversation Records", convo.length ? "PASS" : "WARN", convo.length ? `Found: ${convo.join(", ")}` : "No ~/.gemini/antigravity-ide or ~/.gemini/antigravity conversations folder found yet (created after the first agent conversation).");

  const bridgeInstallScript = path.join(ORCHESTRATOR_ROOT, "apps", "antigravity-bridge", "install.mjs");
  record(C, "Bridge Installer Script", fs.existsSync(bridgeInstallScript) ? "PASS" : "WARN", fs.existsSync(bridgeInstallScript) ? `Found bridge installer: ${bridgeInstallScript}` : `Bridge installer script not found at ${bridgeInstallScript}`);
}

// 5. Network & Port Availability
function checkPortAvailability(): Promise<void> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        record("Network", `Port ${config.port} Availability`, "WARN", `Port ${config.port} is currently in use (Orches or another server may already be running)`);
      } else {
        record("Network", `Port ${config.port} Availability`, "WARN", `Port check returned: ${err.message}`);
      }
      resolve();
    });
    server.once("listening", () => {
      server.close(() => {
        record("Network", `Port ${config.port} Availability`, "PASS", `Port ${config.port} is available for binding on ${config.host}`);
        resolve();
      });
    });
    server.listen(config.port, config.host);
  });
}

// 6. Security & Secrets Sanitization
function checkSecuritySanitization() {
  const envFile = path.join(ORCHESTRATOR_ROOT, ".env");
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf8");
    const suspiciousKeyPatterns = [/sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{20,}/, /AKIA[0-9A-Z]{16}/];
    const leaked = suspiciousKeyPatterns.some((pattern) => pattern.test(content));
    if (leaked) {
      record("Security", "Secret Leak Detection", "FAIL", "Found potential raw API keys or tokens in .env. Never commit or distribute real secrets.");
    } else {
      record("Security", "Secret Leak Detection", "PASS", "No exposed API keys or tokens detected in .env");
    }
  } else {
    record("Security", "Secret Leak Detection", "PASS", "No local .env file found (using defaults or .env.example)");
  }
}

export async function runDiagnostics(): Promise<{ pass: boolean; results: DiagnosticResult[] }> {
  checkNodeVersion();
  checkDataDirectory();
  await checkBrowserSubsystem();
  await checkAntigravityBridge();
  await checkPortAvailability();
  checkSecuritySanitization();

  const failCount = results.filter((r) => r.status === "FAIL").length;
  const warnCount = results.filter((r) => r.status === "WARN").length;
  const passCount = results.filter((r) => r.status === "PASS").length;

  return {
    pass: failCount === 0,
    results,
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("diagnose.ts")) {
  console.log("==================================================================");
  console.log("           ORCHES SYSTEM DIAGNOSTICS & SELF-CHECK                 ");
  console.log("==================================================================\n");

  runDiagnostics().then(({ pass, results }) => {
    let currentCategory = "";
    for (const res of results) {
      if (res.category !== currentCategory) {
        currentCategory = res.category;
        console.log(`\n[${currentCategory}]`);
      }
      const tag = res.status === "PASS" ? "\x1b[32m[PASS]\x1b[0m" : res.status === "WARN" ? "\x1b[33m[WARN]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
      console.log(`  ${tag} ${res.item}: ${res.message}`);
      if (res.detail) {
        console.log(`         ${res.detail}`);
      }
    }

    const failCount = results.filter((r) => r.status === "FAIL").length;
    const warnCount = results.filter((r) => r.status === "WARN").length;
    const passCount = results.filter((r) => r.status === "PASS").length;

    console.log("\n------------------------------------------------------------------");
    console.log(`Summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failures`);
    console.log("------------------------------------------------------------------");

    if (!pass) {
      console.error("\nDiagnostics found critical failures. Please resolve the issues marked [FAIL].");
      process.exit(1);
    } else {
      console.log("\nDiagnostics passed! System is ready to launch.");
      process.exit(0);
    }
  });
}
