import { eq } from 'drizzle-orm';
import type { Database } from '../database/client';
import { rateLimits } from '../database/schema';

export async function consumeRateLimit(
  db: Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean }> {
  const now = new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(rateLimits).where(eq(rateLimits.key, key));
    const row = rows[0];
    if (!row || now.getTime() - new Date(row.windowStart).getTime() >= windowMs) {
      await tx
        .insert(rateLimits)
        .values({ key, count: 1, windowStart: nowIso })
        .onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, windowStart: nowIso } });
      return { allowed: true };
    }
    if (row.count >= limit) return { allowed: false };
    await tx.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key));
    return { allowed: true };
  });
}

export function loginRateLimit(): { identity: number; ip: number; windowMs: number } {
  const identity = Number(process.env.LOGIN_RATE_LIMIT ?? 8);
  return {
    identity: Number.isFinite(identity) && identity > 0 ? identity : 8,
    ip: 30,
    windowMs: 15 * 60 * 1000,
  };
}
