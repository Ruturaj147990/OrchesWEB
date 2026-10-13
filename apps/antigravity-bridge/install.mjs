// Packages the Orches Bridge and installs it into Antigravity IDE using the IDE's own CLI.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vsix = execFileSync(process.execPath, [path.join(here, "package-vsix.mjs")], { encoding: "utf8" }).trim();

const home = os.homedir();
const candidates =
  process.platform === "win32"
    ? [
        path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
      ]
    : [
        path.join(home, ".local", "bin", "antigravity-ide"),
        "/usr/local/bin/antigravity-ide",
        "/usr/bin/antigravity-ide",
        "/snap/bin/antigravity-ide",
        "/opt/Antigravity IDE/bin/antigravity-ide",
        "/opt/antigravity/bin/antigravity-ide",
        "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
      ];
const cli = candidates.find((c) => fs.existsSync(c));
if (!cli) {
  console.error(`Antigravity IDE CLI not found. Install manually: Extensions view → "Install from VSIX…" → ${vsix}`);
  process.exit(1);
}
const res =
  process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${cli}" --install-extension "${vsix}" --force"`], { stdio: "inherit", windowsVerbatimArguments: true })
    : spawnSync(cli, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log("Orches Bridge installed. Open (or reload) the project folder in Antigravity IDE; the bridge activates automatically.");
