import type { EntityType, OperationResult, RemoteChange } from '../../domain/entities/types';
import { getUserDb, type LocalOperation, type PlaniarDB } from '../../db/dexie/database';
import { apiRequest, ApiError } from '../api/client';
import { useSyncStore } from '../../stores/syncStore';

let chain: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function commit<T>(task: () => Promise<T>, userId: string): Promise<T> {
  const result = enqueue(task);
  void result.then(() => {
    void enqueue(() => syncNow(userId));
  });
  return result;
}

async function putRecord(db: PlaniarDB, entityType: EntityType, record: unknown): Promise<void> {
  if (!record || typeof record !== 'object' || !('id' in record)) return;
  const row = record as { id: string };
  if (entityType === 'activity') await db.activities.put(record as never);
  if (entityType === 'routine') await db.routines.put(record as never);
  if (entityType === 'schedule') await db.schedules.put(record as never);
  if (entityType === 'invitation') await db.invitations.put(record as never);
  if (entityType === 'member') await db.members.put(record as never);
  if (entityType === 'conflict') await db.conflicts.put(record as never);
  if (entityType === 'proposal') await db.proposals.put(record as never);
  if (entityType === 'notification') await db.notifications.put(record as never);
  if (entityType === 'profile') await db.profiles.put(record as never);
  void row;
}

async function revertOperation(db: PlaniarDB, operation: LocalOperation): Promise<void> {
  if (operation.operationType === 'create') {
    if (operation.entityType === 'activity') await db.activities.delete(operation.entityId);
    if (operation.entityType === 'routine') await db.routines.delete(operation.entityId);
    if (operation.entityType === 'schedule' && operation.operationType === 'create') await db.schedules.delete(operation.entityId);
    if (operation.entityType === 'invitation') await db.invitations.delete(operation.entityId);
    if (operation.entityType === 'proposal') await db.proposals.delete(operation.entityId);
    return;
  }
  if (operation.baseSnapshot) await putRecord(db, operation.entityType, operation.baseSnapshot);
}

export async function syncNow(userId: string): Promise<void> {
  const store = useSyncStore.getState();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    store.setStatus('offline');
    return;
  }
  const db = getUserDb(userId);
  store.setStatus('syncing');
  try {
    const pending = (await db.operations.toArray())
      .filter((operation) => operation.status === 'pending' || (operation.status === 'error' && operation.retryCount < 8))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 50);
    if (pending.length > 0) {
      const response = await apiRequest<{ results: (OperationResult & { id: string })[] }>('/api/sync/push', {
        method: 'POST',
        body: {
          operations: pending.map(({ status: _status, retryCount: _retry, lastError: _error, ...operation }) => operation),
        },
      });
      for (const result of response.results) {
        const operation = pending.find((item) => item.id === result.id);
        if (!operation) continue;
        if (result.status === 'applied') {
          if (result.serverRecord) await putRecord(db, operation.entityType, result.serverRecord);
          const payload = result.serverRecord as { conflict?: unknown; proposals?: unknown[] } | undefined;
          if (payload && typeof payload === 'object' && 'conflict' in payload && payload.conflict) {
            await putRecord(db, 'conflict', payload.conflict);
          }
          if (payload && typeof payload === 'object' && Array.isArray(payload.proposals)) {
            for (const proposal of payload.proposals) await putRecord(db, 'proposal', proposal);
          }
          await db.operations.update(operation.id, { status: 'synced', lastError: null });
        } else if (result.status === 'conflict') {
          if (result.serverRecord) await putRecord(db, operation.entityType, result.serverRecord);
          else if (operation.operationType === 'create') await revertOperation(db, operation);
          if (result.conflict) await db.conflicts.put(result.conflict);
          await db.operations.update(operation.id, { status: 'conflict', lastError: result.message ?? 'Conflito detectado.' });
        } else {
          await revertOperation(db, operation);
          if (result.serverRecord) await putRecord(db, operation.entityType, result.serverRecord);
          await db.operations.update(operation.id, {
            status: 'rejected',
            lastError: result.message ?? 'A operação foi recusada.',
            retryCount: operation.retryCount + 1,
          });
        }
      }
    }
    let cursor = Number((await db.meta.get('syncCursor'))?.value ?? 0);
    for (let page = 0; page < 10; page += 1) {
      const pulled = await apiRequest<{ changes: RemoteChange[]; cursor: number; hasMore: boolean }>('/api/sync/pull', {
        method: 'POST',
        body: { cursor },
      });
      const blocked = new Set(
        (await db.operations.toArray())
          .filter((operation) => operation.status === 'pending' || operation.status === 'error')
          .map((operation) => operation.entityId),
      );
      for (const change of pulled.changes) {
        if (blocked.has(change.entityId)) continue;
        if (change.op === 'delete') {
          if (change.entityType === 'member') await db.members.delete(change.entityId);
          continue;
        }
        await putRecord(db, change.entityType, change.record);
        if (change.entityType === 'conflict' && change.record && typeof change.record === 'object' && 'status' in change.record && change.record.status === 'resolved') {
          const affected = 'affectedScheduleIds' in change.record && Array.isArray(change.record.affectedScheduleIds)
            ? change.record.affectedScheduleIds.filter((id): id is string => typeof id === 'string')
            : [];
          const operations = await db.operations.where('status').equals('conflict').toArray();
          for (const operation of operations) {
            if (affected.includes(operation.entityId) || operation.entityId === change.entityId) await db.operations.delete(operation.id);
          }
        }
      }
      cursor = pulled.cursor;
      await db.meta.put({ key: 'syncCursor', value: cursor });
      if (!pulled.hasMore) break;
    }
    const remaining = (await db.operations.toArray()).filter((operation) =>
      operation.status === 'pending' || operation.status === 'error' || operation.status === 'conflict',
    );
    const conflicts = await db.conflicts.filter((conflict) => conflict.status !== 'resolved').count();
    store.setPending(remaining.length);
    store.setConflicts(conflicts);
    store.setStatus(conflicts > 0 ? 'conflict' : remaining.some((operation) => operation.status === 'pending' || operation.status === 'error') ? 'pending' : 'synced');
    store.setLastSyncAt(new Date().toISOString());
  } catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.code === 'network')) {
      store.setStatus('offline');
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      store.setStatus('error');
      store.setLastError('Sua sessão expirou. Entre novamente para sincronizar.');
      return;
    }
    store.setStatus('error');
    store.setLastError(error instanceof Error ? error.message : 'Falha na sincronização.');
  }
}
