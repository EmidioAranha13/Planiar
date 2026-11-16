import type { DeleteScope } from '../entities/types';
import { zonedDayRange, zonedMonthRange, zonedWeekRange } from './time';

export type ScopeSchedule = {
  id: string;
  activityId: string;
  routineId: string;
  startAt: string;
  deletedAt: string | null;
  version: number;
};

export function schedulesInScope(input: {
  schedules: ScopeSchedule[];
  anchor: { id: string; activityId: string; routineId: string; startAt: string };
  scope: DeleteScope;
  timeZone: string;
}): ScopeSchedule[] {
  const related = input.schedules.filter(
    (schedule) =>
      schedule.deletedAt == null &&
      schedule.activityId === input.anchor.activityId &&
      schedule.routineId === input.anchor.routineId,
  );
  if (input.scope === 'one') return related.filter((schedule) => schedule.id === input.anchor.id);
  const range =
    input.scope === 'day'
      ? zonedDayRange(input.anchor.startAt, input.timeZone)
      : input.scope === 'week'
        ? zonedWeekRange(input.anchor.startAt, input.timeZone)
        : zonedMonthRange(input.anchor.startAt, input.timeZone);
  return related.filter((schedule) => {
    const time = new Date(schedule.startAt).getTime();
    return time >= range.start.getTime() && time < range.end.getTime();
  });
}

export const deleteScopeLabels: Record<DeleteScope, string> = {
  one: 'Somente este agendamento',
  day: 'Todos desta atividade neste dia',
  week: 'Todos desta atividade nesta semana',
  month: 'Todos desta atividade neste mês',
};
