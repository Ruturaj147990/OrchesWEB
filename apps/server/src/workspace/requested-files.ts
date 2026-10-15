import path from "node:path";

const FILE_TOKEN = /(?<![\w./\\-])([\w.-]+(?:[\\/][\w.-]+)*\.(?:js|mjs|cjs|jsx|ts|tsx|py|json|md|txt|html|css|scss|go|rs|java|toml|ya?ml|sh|ps1|sql))(?![\w-])/gi;
const NEGATING = /(delete|remove|rename|without|instead of|don't|do not|never|avoid|not)\s+(?:(?:create|add|write|touch|modify|edit|change|use)\s+)?(?:the\s+|a\s+|an\s+|any\s+)?(?:file\s+)?$/i;
const REFERENCING = /\b(from|in|into|inside|within|to|of|on|at|via|using|by)\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+)?(?:existing\s+)?(?:file\s+)?[`'"]?$/i;

/** Product names that look like file names ("Node.js") but are not files. */
const TECHNOLOGY_NAMES = new Set(
  ["node.js", "next.js", "nuxt.js", "vue.js", "react.js", "express.js", "nest.js", "deno.js", "three.js", "d3.js", "chart.js", "ember.js", "backbone.js", "svelte.js", "solid.js", "alpine.js", "p5.js", "socket.io.js", "moment.js", "day.js", "anime.js", "electron.js", "ext.js"]
);

/**
 * File names the user's task explicitly asks for that do not exist after the attempt. A deterministic
 * guard against a reviewer (or agent) declaring success while a requested file is simply missing.
 * Mentions preceded by "delete", "remove", "without", "do not" … are ignored.
 */
export function missingRequestedFiles(taskText: string, existingFiles: string[]): string[] {
  const existing = existingFiles.map((f) => f.replace(/\\/g, "/").toLowerCase());
  const basenames = new Set(existing.map((f) => path.posix.basename(f)));
  const missing: string[] = [];
  for (const m of taskText.matchAll(FILE_TOKEN)) {
    const token = m[1].replace(/\\/g, "/").replace(/^\.\//, "");
    if (/^node:/.test(token) || /^\d+(\.\d+)+$/.test(token) || /^(e\.g|i\.e)\./i.test(token)) continue;
    if (TECHNOLOGY_NAMES.has(token.toLowerCase())) continue;
    const before = taskText.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (NEGATING.test(before)) continue;
    // "removes tasks from tasks.json", "stored in config.json": a location or runtime data the work refers to,
    // not a file the task asks to deliver. The reviewer still judges these.
    if (REFERENCING.test(before)) continue;
    const lower = token.toLowerCase();
    const found = lower.includes("/") ? existing.some((f) => f === lower || f.endsWith(`/${lower}`)) : basenames.has(lower);
    if (!found && !missing.includes(token)) missing.push(token);
  }
  return missing;
}
