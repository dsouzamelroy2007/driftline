// Matches apps/server's DEVICE_DORMANCY_DAYS default (.env.example) — the client has no API to
// fetch the server's configured value, so this default is duplicated here for the countdown
// display. Purely informational (the server is authoritative on the actual cutoff).
export const DEVICE_DORMANCY_DAYS = 30;

export function daysUntilDormant(lastSeenAt: string, dormancyDays = DEVICE_DORMANCY_DAYS): number {
  const lastSeenMs = new Date(lastSeenAt).getTime();
  const dormantAtMs = lastSeenMs + dormancyDays * 24 * 60 * 60 * 1000;
  const remainingMs = dormantAtMs - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}
