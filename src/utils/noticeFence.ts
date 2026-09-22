/**
 * Receiver-side rate limit for room notices: a quiet period per subject and a
 * burst cap per bucket. A peer can flood the wire, not somebody else's room.
 */
export function createNoticeFence(quietMs: number, burst: number, windowMs: number) {
  const toldAt = new Map<string, number>();
  const recentByBucket = new Map<string, number[]>();
  return (subject: string, bucket: string, now: number): boolean => {
    const told = toldAt.get(subject) ?? Number.NEGATIVE_INFINITY;
    if (now - told < quietMs) return false;
    const recent = (recentByBucket.get(bucket) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= burst) {
      recentByBucket.set(bucket, recent);
      return false;
    }
    recent.push(now);
    recentByBucket.set(bucket, recent);
    toldAt.set(subject, now);
    return true;
  };
}
