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
    } else {
      record("Browser", "Playwright Chromium Binary", "WARN", `Playwright executable not pre-installed. Run "npx playwright install chromium" if browser automation fails.`);
    }
  } catch (err: any) {
    record("Browser", "Playwright Module", "WARN", `Could not resolve Playwright: ${err.message}`);
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

// 4. Antigravity Bridge Integration
function checkAntigravityBridge() {
  const home = os.homedir();
  const antigravityPaths = [
    path.join(home, ".gemini", "antigravity-ide"),
    path.join(home, ".gemini", "config"),
  ];

  const foundAny = antigravityPaths.some((p) => fs.existsSync(p));
  if (foundAny) {
    record("Antigravity Bridge", "Antigravity Environment", "PASS", `Detected Antigravity directory structure under ${home}`);
  } else {
    record("Antigravity Bridge", "Antigravity Environment", "WARN", `Antigravity IDE directory not found at standard path (${path.join(home, ".gemini")}). If using native Bridge, ensure Antigravity is installed.`);
  }

  const bridgeInstallScript = path.join(ORCHESTRATOR_ROOT, "apps", "antigravity-bridge", "install.mjs");
  if (fs.existsSync(bridgeInstallScript)) {
    record("Antigravity Bridge", "Bridge Installer Script", "PASS", `Found bridge installer: ${bridgeInstallScript}`);
  } else {
    record("Antigravity Bridge", "Bridge Installer Script", "WARN", `Bridge installer script not found at ${bridgeInstallScript}`);
  }
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
  checkAntigravityBridge();
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
