// Backup-nagging cadence (docs/UI_DIRECTION.md §8): first nag at 7 days since the last backup (or
// since account creation if never backed up), escalates to a stronger visual treatment at 30 days,
// snooze holds 7 days, capped at 4 consecutive snoozes before the next prompt can't be snoozed at
// all — the user must dismiss it with an explicit "I understand the risk" instead. State lives in
// localStorage: this is a per-device UX nicety, not synced data (same reasoning as the "read"
// boundary in packages/local-store's countMessagesAfter comment).
const LAST_BACKUP_AT_KEY = "driftline.backupNag.lastBackupAt";
const SNOOZE_UNTIL_KEY = "driftline.backupNag.snoozeUntil";
const SNOOZE_COUNT_KEY = "driftline.backupNag.snoozeCount";

const NAG_AFTER_DAYS = 7;
const ESCALATE_AFTER_DAYS = 30;
const SNOOZE_DAYS = 7;
const MAX_CONSECUTIVE_SNOOZES = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BackupNagLevel = "none" | "nag" | "escalated";

export interface BackupNagState {
  level: BackupNagLevel;
  daysSinceBackup: number;
  canSnooze: boolean;
}

export function recordBackupCompleted(): void {
  localStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString());
  localStorage.removeItem(SNOOZE_UNTIL_KEY);
  localStorage.removeItem(SNOOZE_COUNT_KEY);
}

export function snoozeBackupNag(): void {
  const count = Number(localStorage.getItem(SNOOZE_COUNT_KEY) ?? "0") + 1;
  localStorage.setItem(SNOOZE_COUNT_KEY, String(count));
  localStorage.setItem(SNOOZE_UNTIL_KEY, new Date(Date.now() + SNOOZE_DAYS * MS_PER_DAY).toISOString());
}

export function getBackupNagState(accountCreatedAt: string): BackupNagState {
  const lastBackupRaw = localStorage.getItem(LAST_BACKUP_AT_KEY);
  const since = lastBackupRaw ? new Date(lastBackupRaw) : new Date(accountCreatedAt);
  const daysSinceBackup = Math.floor((Date.now() - since.getTime()) / MS_PER_DAY);

  const snoozeCount = Number(localStorage.getItem(SNOOZE_COUNT_KEY) ?? "0");
  const snoozeUntilRaw = localStorage.getItem(SNOOZE_UNTIL_KEY);
  const snoozedActive = snoozeUntilRaw ? new Date(snoozeUntilRaw).getTime() > Date.now() : false;

  let level: BackupNagLevel = "none";
  if (daysSinceBackup >= ESCALATE_AFTER_DAYS) level = "escalated";
  else if (daysSinceBackup >= NAG_AFTER_DAYS) level = "nag";

  if (level !== "none" && snoozedActive) level = "none";

  return { level, daysSinceBackup, canSnooze: snoozeCount < MAX_CONSECUTIVE_SNOOZES };
}
