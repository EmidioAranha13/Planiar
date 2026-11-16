import { zonedWeekRange } from './time';

export type RetentionClass = 'operational' | 'archive-eligible' | 'blocked';

export type RetentionItem = {
  id: string;
  startAt: string;
  deletedAt: string | null;
};

export function planRetention(input: {
  schedules: RetentionItem[];
  pendingEntityIds: string[];
  conflictEntityIds: string[];
  now: Date;
  timeZone: string;
}): { operational: string[]; archiveEligible: string[]; blocked: string[] } {
  const week = zonedWeekRange(input.now, input.timeZone);
  const pending = new Set(input.pendingEntityIds);
  const conflicts = new Set(input.conflictEntityIds);
  const operational: string[] = [];
  const archiveEligible: string[] = [];
  const blocked: string[] = [];

  for (const schedule of input.schedules) {
    if (schedule.deletedAt) continue;
    const time = new Date(schedule.startAt).getTime();
    const inWeek = time >= week.start.getTime() && time < week.end.getTime();
    if (inWeek) {
      operational.push(schedule.id);
      continue;
    }
    if (pending.has(schedule.id) || conflicts.has(schedule.id)) blocked.push(schedule.id);
    else archiveEligible.push(schedule.id);
  }

  return { operational, archiveEligible, blocked };
}

export function retentionDeletionPolicy(): {
  ok: false;
  code: 'retention_disabled';
  message: string;
} {
  return {
    ok: false,
    code: 'retention_disabled',
    message:
      'A exclusão de históricos no servidor permanece desativada. A aplicação só classifica e exporta, para não apagar dados de dispositivos que ainda estejam offline.',
  };
}
