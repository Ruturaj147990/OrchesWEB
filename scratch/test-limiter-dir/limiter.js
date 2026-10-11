class RateLimiter {
  constructor(cap) { this.cap = cap; this.tokens = cap; }
  acquire() {
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}
module.exports = { RateLimiter };