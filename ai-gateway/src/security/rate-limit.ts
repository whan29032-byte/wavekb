export type QuotaDecision = { allowed: boolean; remaining: number; resetAt: string };

export class FixedWindowQuota {
  private readonly counts = new Map<string, { day: string; count: number }>();
  private readonly limit: number;
  private readonly now: () => Date;
  constructor(limit: number, now = () => new Date()) {
    this.limit = limit;
    this.now = now;
  }

  consume(key: string): QuotaDecision {
    const current = this.now();
    const day = current.toISOString().slice(0, 10);
    const previous = this.counts.get(key);
    const count = previous?.day === day ? previous.count : 0;
    const nextMidnight = new Date(`${day}T00:00:00.000Z`);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    if (count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: nextMidnight.toISOString() };
    }
    this.counts.set(key, { day, count: count + 1 });
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - count - 1),
      resetAt: nextMidnight.toISOString(),
    };
  }
}
