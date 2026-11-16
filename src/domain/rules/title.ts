import type { Activity } from '../entities/types';

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

export function findDuplicateActivity(
  activities: Activity[],
  title: string,
  ignoreId?: string,
): Activity | undefined {
  const normalized = normalizeTitle(title);
  if (!normalized) return undefined;
  return activities.find(
    (activity) =>
      activity.deletedAt == null &&
      activity.id !== ignoreId &&
      activity.normalizedTitle === normalized,
  );
}
