import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const dir = 'scratch/test-limiter-dir';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'rate-limiter',
  version: '1.0.0',
  scripts: { test: 'node --test' }
}));
fs.writeFileSync(path.join(dir, 'limiter.js'), `
class RateLimiter {
  constructor(cap) { this.cap = cap; this.tokens = cap; }
  acquire() {
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}
module.exports = { RateLimiter };
`.trim());
fs.writeFileSync(path.join(dir, 'limiter.test.js'), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false);
});
`.trim());

console.log('Running test...');
const res = spawnSync('cmd.exe', ['/d', '/s', '/c', '"npm test"'], {
  cwd: path.resolve(dir),
  windowsVerbatimArguments: true,
  encoding: 'utf8',
  timeout: 5000,
});
console.log('Exit code:', res.status);
console.log('Stdout:', res.stdout);
console.log('Stderr:', res.stderr);
