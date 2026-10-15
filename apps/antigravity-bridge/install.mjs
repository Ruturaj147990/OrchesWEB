// Packages the Orches Bridge and installs it into Antigravity / Antigravity IDE using the IDE's own CLI.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vsix = execFileSync(process.execPath, [path.join(here, "package-vsix.mjs")], { encoding: "utf8" }).trim();

const home = os.homedir();
// Both products are supported: "Antigravity IDE" (antigravity-ide) and "Antigravity" (antigravity).
const variants = [
  { cli: "antigravity-ide", name: "Antigravity IDE", id: "antigravity-ide" },
  { cli: "antigravity", name: "Antigravity", id: "antigravity" },
];
const candidates =
  process.platform === "win32"
    ? variants.flatMap((v) =>
        [path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs"), process.env.ProgramFiles || "C:\\Program Files", process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"].map((r) =>
          path.join(r, v.name, "bin", `${v.cli}.cmd`)
        )
      )
    : process.platform === "darwin"
      ? variants.map((v) => `/Applications/${v.name}.app/Contents/Resources/app/bin/${v.cli}`)
      : variants.flatMap((v) => [
          path.join(home, ".local", "bin", v.cli),
          `/usr/local/bin/${v.cli}`,
          `/usr/bin/${v.cli}`,
          `/snap/bin/${v.cli}`,
          `/var/lib/flatpak/exports/bin/${v.cli}`,
          path.join(home, ".local", "share", "flatpak", "exports", "bin", v.cli),
          `/opt/${v.name}/bin/${v.cli}`,
          `/opt/${v.id}/bin/${v.cli}`,
          `/usr/share/${v.id}/bin/${v.cli}`,
        ]);
const onPath = () => {
  const exts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean))
    for (const v of variants) for (const ext of exts) if (fs.existsSync(path.join(dir, v.cli + ext))) return path.join(dir, v.cli + ext);
  return null;
};
const cli = process.argv[2] || candidates.find((c) => fs.existsSync(c)) || onPath();
if (!cli) {
  console.error(`Antigravity command-line launcher not found (looked for antigravity-ide and antigravity).`);
  console.error(`Install manually: in Antigravity open the Extensions view → "Install from VSIX…" → ${vsix}`);
  console.error(`Or pass the launcher path: node apps/antigravity-bridge/install.mjs /path/to/antigravity`);
  process.exit(1);
}
console.log(`Installing ${vsix} with ${cli}`);
const res =
  process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${cli}" --install-extension "${vsix}" --force"`], { stdio: "inherit", windowsVerbatimArguments: true })
    : spawnSync(cli, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log("Orches Bridge installed. Open (or reload) the project folder in Antigravity; the bridge activates automatically.");
