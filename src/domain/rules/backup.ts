import { backupSchema } from '../schemas/records';

export type BackupParseResult =
  | { ok: true; version: 1; userId: string; counts: { activities: number; routines: number; schedules: number; conflicts: number } }
  | { ok: false; message: string };

export function parseBackup(input: unknown): BackupParseResult {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'O arquivo não é um backup válido do Planiar.' };
  }
  return {
    ok: true,
    version: 1,
    userId: parsed.data.userId,
    counts: {
      activities: parsed.data.activities.length,
      routines: parsed.data.routines.length,
      schedules: parsed.data.schedules.length,
      conflicts: parsed.data.conflicts.length,
    },
  };
}

export function buildBackup(input: {
  userId: string;
  exportedAt: string;
  activities: unknown[];
  routines: unknown[];
  schedules: unknown[];
  conflicts: unknown[];
}) {
  return {
    version: 1 as const,
    exportedAt: input.exportedAt,
    userId: input.userId,
    activities: input.activities,
    routines: input.routines,
    schedules: input.schedules,
    conflicts: input.conflicts,
  };
}
