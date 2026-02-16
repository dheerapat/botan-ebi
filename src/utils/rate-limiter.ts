export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
}

export class RateLimiter {
  private entries: Map<string, RateLimitEntry>;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.entries = new Map();
    this.config = config;
  }

  check(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = this.entries.get(identifier);

    if (!entry) {
      this.entries.set(identifier, {
        count: 1,
        resetAt: now + 60000,
      });
      return { allowed: true };
    }

    if (now >= entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + 60000;
      return { allowed: true };
    }

    if (entry.count >= this.config.maxRequestsPerMinute) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    entry.count++;
    return { allowed: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.resetAt) {
        this.entries.delete(key);
      }
    }
  }
}
