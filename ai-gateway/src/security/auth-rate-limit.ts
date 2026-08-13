import { createHmac } from "node:crypto";

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export class AuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly secret: Buffer;
  private readonly now: () => number;
  private operations = 0;

  constructor(
    secret: Buffer,
    now: () => number = Date.now,
  ) {
    this.secret = secret;
    this.now = now;
  }

  subject(value: string): string {
    return createHmac("sha256", this.secret)
      .update(value)
      .digest("hex");
  }

  consume(
    action: string,
    subjectHash: string,
    limit: number,
    windowMs: number,
  ): RateLimitResult {
    const key = `${action}:${subjectHash}`;
    const currentTime = this.now();
    this.operations += 1;
    if (this.operations % 256 === 0) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= currentTime) this.buckets.delete(bucketKey);
      }
    }
    const existing = this.buckets.get(key);
    const bucket = !existing || existing.resetAt <= currentTime
      ? { count: 0, resetAt: currentTime + windowMs }
      : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    const allowed = bucket.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
    };
  }
}
