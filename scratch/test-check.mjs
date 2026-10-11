import { runCommand } from "../apps/server/src/platform/process-runner.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-test-"));
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", scripts: { test: "node --test" } }));
fs.writeFileSync(path.join(dir, "limiter.js"), `
class RateLimiter {
  constructor(cap) { this.cap = cap; this.tokens = cap; }
  acquire() {
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}
module.exports = { RateLimiter };
`);
fs.writeFileSync(path.join(dir, "limiter.test.js"), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false);
});
`);

console.log("Running check with runCommand...");
const t0 = Date.now();
const res = await runCommand(["npm.cmd", "test"], { cwd: dir, timeoutMs: 10000 });
console.log(`Finished in ${Date.now() - t0}ms, exitCode: ${res.exitCode}`);
console.log("stdout:", res.stdout);
console.log("stderr:", res.stderr);

fs.rmSync(dir, { recursive: true, force: true });
