const MAX_SYNC_BACKOFF_MS = 6 * 60 * 60_000;

// 2, 4, 8 ... minutes, capped at six hours, so a broken to-do stops hitting
// Google on every poll but still retries on its own.
export function syncBackoffMs(attempts: number) {
  return Math.min(MAX_SYNC_BACKOFF_MS, 2 * 60_000 * 2 ** Math.max(0, attempts - 1));
}
