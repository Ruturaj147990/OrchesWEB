const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false);
});