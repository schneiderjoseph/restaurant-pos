'use strict';

/**
 * Simple sliding-window rate limiter for Loyverse (~50 req/min default).
 */
class RateLimiter {
  /**
   * @param {{ rpm?: number }} [opts]
   */
  constructor(opts = {}) {
    this.rpm = Math.max(1, Number(opts.rpm) || 50);
    this.windowMs = 60_000;
    /** @type {number[]} */
    this.timestamps = [];
  }

  async waitTurn() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.rpm) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 25;
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    this.timestamps.push(Date.now());
  }
}

/**
 * Wrap LoyverseClient.get with rate limiting.
 * @param {import('./loyverse-client').LoyverseClient} client
 * @param {RateLimiter} limiter
 */
function wrapClientWithRateLimit(client, limiter) {
  const originalGet = client.get.bind(client);
  client.get = async (path, query) => {
    await limiter.waitTurn();
    return originalGet(path, query);
  };
  return client;
}

module.exports = { RateLimiter, wrapClientWithRateLimit };
