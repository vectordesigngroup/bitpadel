import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare. Unequal lengths still walk a buffer so they are not a fast path. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
