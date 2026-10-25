// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/**
 * Fixed-window counter kept in memory for one process.
 * A club box runs as a single instance; the limit resets when the process restarts.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    if (this.hits.size > 10_000) this.hits.clear();
    const current = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((stamp) => current - stamp < this.windowMs);
    if (fresh.length >= this.max) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(current);
    this.hits.set(key, fresh);
    return true;
  }
}
