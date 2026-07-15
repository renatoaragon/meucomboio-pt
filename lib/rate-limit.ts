interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

function pruneExpired(now: number) {
  if (store.size > 5000) {
    for (const [k, v] of store.entries()) {
      if (now > v.resetAt) store.delete(k);
    }
  }
}

export function checkRateLimit(
  namespace: string,
  ip: string,
  limit: number,
  windowMs: number,
): boolean {
  const key = `${namespace}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    pruneExpired(now);
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export function getClientIp(request: Request): string {
  const forwarded = (request.headers as Headers).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}
