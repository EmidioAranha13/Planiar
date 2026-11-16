import type { Activity, Schedule } from '../entities/types';
import { rangesOverlap } from './time';

export type ActivitySummary = {
  activityId: string;
  title: string;
  color: string;
  minutes: number;
  count: number;
};

export function summarizeMinutes(input: {
  schedules: Schedule[];
  activities: Activity[];
  rangeStart: string;
  rangeEnd: string;
}): ActivitySummary[] {
  const totals = new Map<string, ActivitySummary>();
  for (const schedule of input.schedules) {
    if (schedule.deletedAt) continue;
    if (!rangesOverlap(schedule.startAt, schedule.endAt, input.rangeStart, input.rangeEnd)) continue;
    const overlapStart = Math.max(new Date(schedule.startAt).getTime(), new Date(input.rangeStart).getTime());
    const overlapEnd = Math.min(new Date(schedule.endAt).getTime(), new Date(input.rangeEnd).getTime());
    const minutes = Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
    const activity = input.activities.find((item) => item.id === schedule.activityId);
    const current = totals.get(schedule.activityId) ?? {
      activityId: schedule.activityId,
      title: activity?.title ?? 'Atividade removida',
      color: activity?.color ?? '#64748B',
      minutes: 0,
      count: 0,
    };
    current.minutes += minutes;
    current.count += 1;
    totals.set(schedule.activityId, current);
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
}
