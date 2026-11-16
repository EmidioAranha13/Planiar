import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  AppNotification,
  ConflictProposal,
  Invitation,
  PublicProfile,
  Routine,
  RoutineMember,
  Schedule,
  ScheduleConflict,
  SyncOperationInput,
} from '../../domain/entities/types';

export type LocalOperation = SyncOperationInput & {
  status: 'pending' | 'syncing' | 'synced' | 'error' | 'conflict' | 'rejected';
  retryCount: number;
  lastError: string | null;
};

export type MetaRecord = {
  key: string;
  value: unknown;
};

export class PlaniarDB extends Dexie {
  activities!: Table<Activity, string>;
  routines!: Table<Routine, string>;
  members!: Table<RoutineMember, string>;
  schedules!: Table<Schedule, string>;
  invitations!: Table<Invitation, string>;
  operations!: Table<LocalOperation, string>;
  conflicts!: Table<ScheduleConflict, string>;
  proposals!: Table<ConflictProposal, string>;
  notifications!: Table<AppNotification, string>;
  profiles!: Table<PublicProfile, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      activities: 'id, ownerId, normalizedTitle, updatedAt',
      routines: 'id, ownerId, updatedAt',
      members: 'id, routineId, userId',
      schedules: 'id, routineId, activityId, startAt',
      invitations: 'id, routineId, recipientId, senderId, status',
      operations: 'id, status, entityId, createdAt',
      conflicts: 'id, routineId, status',
      proposals: 'id, conflictId, status',
      notifications: 'id, userId, createdAt, readAt',
      profiles: 'id, username',
      meta: 'key',
    });
  }
}

const databases = new Map<string, PlaniarDB>();

export function databaseName(userId: string): string {
  return `planiar-${userId}`;
}

export function getUserDb(userId: string): PlaniarDB {
  const existing = databases.get(userId);
  if (existing) return existing;
  const database = new PlaniarDB(databaseName(userId));
  databases.set(userId, database);
  return database;
}

export async function closeUserDb(userId: string): Promise<void> {
  const database = databases.get(userId);
  if (!database) return;
  database.close();
  databases.delete(userId);
}

export async function deleteUserDb(userId: string): Promise<void> {
  await closeUserDb(userId);
  await Dexie.delete(databaseName(userId));
}
