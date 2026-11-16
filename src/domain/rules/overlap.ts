import type { OverlapPolicy, ScheduleSnapshot } from '../entities/types';
import { rangesOverlap } from './time';

export type OverlapDecision =
  | { type: 'ok' }
  | { type: 'validation'; message: string }
  | { type: 'conflict'; scheduleIds: string[] };

export function evaluateOverlap(input: {
  policy: OverlapPolicy;
  proposed: { id: string; startAt: string; endAt: string };
  schedules: ScheduleSnapshot[];
  knownVersions: Record<string, number>;
}): OverlapDecision {
  if (input.policy === 'allow') return { type: 'ok' };
  const overlapping = input.schedules.filter(
    (schedule) =>
      schedule.id !== input.proposed.id &&
      schedule.deletedAt == null &&
      rangesOverlap(input.proposed.startAt, input.proposed.endAt, schedule.startAt, schedule.endAt),
  );
  if (overlapping.length === 0) return { type: 'ok' };
  const stale = overlapping.filter((schedule) => input.knownVersions[schedule.id] !== schedule.version);
  if (stale.length > 0) {
    return { type: 'conflict', scheduleIds: stale.map((schedule) => schedule.id) };
  }
  return {
    type: 'validation',
    message: 'Esta rotina não permite sobrepor horários. Escolha outro intervalo.',
  };
}
