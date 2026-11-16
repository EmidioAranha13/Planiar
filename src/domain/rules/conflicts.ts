import type { ConflictKind, ScheduleSnapshot } from '../entities/types';

export type VersionDecision =
  | { type: 'apply' }
  | { type: 'idempotent' }
  | { type: 'missing' }
  | { type: 'conflict'; kind: ConflictKind };

export function classifyScheduleMutation(input: {
  operation: 'create' | 'update' | 'delete';
  base: ScheduleSnapshot | null;
  current: ScheduleSnapshot | null;
  proposed?: { startAt: string; endAt: string; activityId?: string } | null;
}): VersionDecision {
  const { operation, base, current, proposed } = input;
  if (operation === 'create') {
    if (!current || current.deletedAt) return { type: 'apply' };
    const sameActivity = proposed?.activityId == null || current.activityId === proposed.activityId;
    if (proposed && sameActivity && current.startAt === proposed.startAt && current.endAt === proposed.endAt) {
      return { type: 'idempotent' };
    }
    return { type: 'conflict', kind: 'concurrent_edit' };
  }
  if (!current) return { type: 'missing' };
  if (operation === 'delete' && current.deletedAt) return { type: 'idempotent' };
  if (!base) return { type: 'conflict', kind: 'concurrent_edit' };
  if (current.version === base.version && !current.deletedAt) return { type: 'apply' };
  if (current.deletedAt || (operation === 'delete' && !current.deletedAt && current.version !== base.version)) {
    return { type: 'conflict', kind: 'delete_vs_edit' };
  }
  const serverMoved = current.startAt !== base.startAt || current.endAt !== base.endAt;
  const clientMoved = Boolean(
    proposed && (proposed.startAt !== base.startAt || proposed.endAt !== base.endAt),
  );
  if (serverMoved && clientMoved) return { type: 'conflict', kind: 'relocation' };
  return { type: 'conflict', kind: 'concurrent_edit' };
}

export function evaluateBatchDelete(input: {
  expected: { id: string; baseVersion: number }[];
  matched: { id: string; version: number; deletedAt: string | null }[];
}): { ok: true } | { ok: false; kind: 'batch'; message: string } {
  const expectedIds = new Set(input.expected.map((item) => item.id));
  const matchedActive = input.matched.filter((item) => item.deletedAt == null);
  const matchedIds = new Set(matchedActive.map((item) => item.id));
  if (expectedIds.size !== matchedIds.size || [...expectedIds].some((id) => !matchedIds.has(id))) {
    return {
      ok: false,
      kind: 'batch',
      message: 'O conjunto de agendamentos mudou desde que a exclusão foi preparada.',
    };
  }
  const versionById = new Map(input.expected.map((item) => [item.id, item.baseVersion]));
  const stale = matchedActive.some((item) => versionById.get(item.id) !== item.version);
  if (stale) {
    return {
      ok: false,
      kind: 'batch',
      message: 'Algum agendamento deste lote foi alterado por outra pessoa.',
    };
  }
  return { ok: true };
}
