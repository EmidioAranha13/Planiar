import { format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const FIVE_MINUTES = 5 * 60 * 1000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function asIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function snapIso(iso: string, timeZone: string): string {
  const zoned = toZonedTime(iso, timeZone);
  const remainder = zoned.getMinutes() % 5;
  const delta = remainder < 3 ? -remainder : 5 - remainder;
  zoned.setMinutes(zoned.getMinutes() + delta, 0, 0);
  return fromZonedTime(zoned, timeZone).toISOString();
}

export function isFiveMinuteAligned(iso: string, timeZone: string): boolean {
  const zoned = toZonedTime(iso, timeZone);
  return zoned.getSeconds() === 0 && zoned.getMilliseconds() === 0 && zoned.getMinutes() % 5 === 0;
}

export type ScheduleRangeResult =
  | { ok: true; startAt: string; endAt: string; minutes: number }
  | { ok: false; message: string };

export function validateScheduleRange(input: {
  startAt: string;
  endAt: string;
  timezone: string;
}): ScheduleRangeResult {
  if (!isValidTimeZone(input.timezone)) {
    return { ok: false, message: 'O fuso horário da rotina é inválido.' };
  }
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, message: 'Informe data e hora válidas.' };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, message: 'O horário final precisa ser posterior ao inicial.' };
  }
  if (end.getTime() - start.getTime() < FIVE_MINUTES) {
    return { ok: false, message: 'A duração mínima é de 5 minutos.' };
  }
  if (!isFiveMinuteAligned(start.toISOString(), input.timezone) || !isFiveMinuteAligned(end.toISOString(), input.timezone)) {
    return { ok: false, message: 'Os horários precisam cair em intervalos de 5 minutos.' };
  }
  return {
    ok: true,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
  };
}

export function normalizeScheduleRange(startAt: string, endAt: string, timezone: string): ScheduleRangeResult {
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, message: 'Informe data e hora válidas.' };
  }
  let start = startDate;
  let end = endDate;
  if (end.getTime() < start.getTime()) {
    const swap = start;
    start = end;
    end = swap;
  }
  let snappedStart = snapIso(start.toISOString(), timezone);
  let snappedEnd = snapIso(end.toISOString(), timezone);
  if (new Date(snappedEnd).getTime() <= new Date(snappedStart).getTime()) {
    snappedEnd = new Date(new Date(snappedStart).getTime() + FIVE_MINUTES).toISOString();
  }
  return validateScheduleRange({ startAt: snappedStart, endAt: snappedEnd, timezone });
}

export function zonedWeekRange(anchor: string | Date, timeZone: string): { start: Date; end: Date } {
  const zoned = toZonedTime(anchor, timeZone);
  const mondayOffset = (zoned.getDay() + 6) % 7;
  const startLocal = new Date(zoned);
  startLocal.setHours(0, 0, 0, 0);
  startLocal.setDate(startLocal.getDate() - mondayOffset);
  const endLocal = new Date(startLocal);
  endLocal.setDate(endLocal.getDate() + 7);
  return {
    start: fromZonedTime(startLocal, timeZone),
    end: fromZonedTime(endLocal, timeZone),
  };
}

export function zonedDayRange(anchor: string | Date, timeZone: string): { start: Date; end: Date } {
  const zoned = toZonedTime(anchor, timeZone);
  const startLocal = new Date(zoned);
  startLocal.setHours(0, 0, 0, 0);
  const endLocal = new Date(startLocal);
  endLocal.setDate(endLocal.getDate() + 1);
  return {
    start: fromZonedTime(startLocal, timeZone),
    end: fromZonedTime(endLocal, timeZone),
  };
}

export function zonedMonthRange(anchor: string | Date, timeZone: string): { start: Date; end: Date } {
  const zoned = toZonedTime(anchor, timeZone);
  const startLocal = new Date(zoned.getFullYear(), zoned.getMonth(), 1, 0, 0, 0, 0);
  const endLocal = new Date(zoned.getFullYear(), zoned.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    start: fromZonedTime(startLocal, timeZone),
    end: fromZonedTime(endLocal, timeZone),
  };
}

export function isoToZonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const zoned = toZonedTime(iso, timeZone);
  return {
    date: format(zoned, 'yyyy-MM-dd'),
    time: format(zoned, 'HH:mm'),
  };
}

export function zonedDateTimeToIso(date: string, time: string, timeZone: string): string {
  return fromZonedTime(`${date}T${time}:00`, timeZone).toISOString();
}

export function fiveMinuteTimes(): string[] {
  const times: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 5) {
      times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
  }
  return times;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${String(rest).padStart(2, '0')}min`;
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(startB).getTime() < new Date(endA).getTime();
}
