import { and, eq, isNull } from 'drizzle-orm';
import type { ZodError } from 'zod';
import type {
  Activity,
  CurrentUser,
  EntityType,
  Invitation,
  MemberRole,
  OperationResult,
  PublicProfile,
  Routine,
  RoutineMember,
  Schedule,
  ScheduleConflict,
  ScheduleSnapshot,
} from '../../src/domain/entities/types';
import { asIso } from '../../src/domain/rules/time';
import type { Database } from '../database/client';
import {
  activities,
  auditLog,
  changeLog,
  invitations,
  notifications,
  routineMembers,
  routines,
  schedules,
  users,
} from '../database/schema';

export type SyncContext = {
  db: Database;
  actorId: string;
  now: string;
  audience: Set<string>;
};

export function zodMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'Os dados enviados são inválidos.';
}

export function rejected(code: string, message: string, extra?: Partial<OperationResult>): OperationResult {
  return { status: 'rejected', code, message, ...extra };
}

export function applied(version: number | null, serverRecord?: unknown): OperationResult {
  return { status: 'applied', version, serverRecord };
}

export async function addChange(
  ctx: SyncContext,
  change: {
    entityType: EntityType;
    entityId: string;
    op: 'upsert' | 'delete';
    record: unknown;
    version: number | null;
    audienceUserIds: string[];
  },
): Promise<void> {
  for (const userId of change.audienceUserIds) ctx.audience.add(userId);
  await ctx.db.insert(changeLog).values({
    entityType: change.entityType,
    entityId: change.entityId,
    op: change.op,
    record: change.record,
    version: change.version,
    actorId: ctx.actorId,
    audienceUserIds: change.audienceUserIds,
    createdAt: ctx.now,
  });
}

export async function notify(
  ctx: SyncContext,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const record = {
    id: crypto.randomUUID(),
    userId,
    type,
    payload,
    readAt: null,
    createdAt: ctx.now,
  };
  await ctx.db.insert(notifications).values(record);
  await addChange(ctx, {
    entityType: 'notification',
    entityId: record.id,
    op: 'upsert',
    record,
    version: null,
    audienceUserIds: [userId],
  });
}

export async function audit(
  ctx: SyncContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await ctx.db.insert(auditLog).values({
    id: crypto.randomUUID(),
    actorId: ctx.actorId,
    action,
    entityType,
    entityId,
    metadata,
    createdAt: ctx.now,
  });
}

export async function memberRole(db: Database, routineId: string, userId: string): Promise<MemberRole | null> {
  const rows = await db
    .select({ role: routineMembers.role })
    .from(routineMembers)
    .where(and(eq(routineMembers.routineId, routineId), eq(routineMembers.userId, userId)));
  return rows[0]?.role ?? null;
}

export async function memberIds(db: Database, routineId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: routineMembers.userId })
    .from(routineMembers)
    .where(eq(routineMembers.routineId, routineId));
  return rows.map((row) => row.userId);
}

export function toProfile(row: typeof users.$inferSelect): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    profileColor: row.profileColor,
    avatarUrl: row.avatarUrl,
  };
}

export function toCurrentUser(row: typeof users.$inferSelect): CurrentUser {
  return {
    ...toProfile(row),
    email: row.email,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    updatedAt: asIso(row.updatedAt) ?? row.updatedAt,
  };
}

export function toActivity(row: typeof activities.$inferSelect): Activity {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    description: row.description,
    color: row.color,
    version: row.version,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    updatedAt: asIso(row.updatedAt) ?? row.updatedAt,
    deletedAt: asIso(row.deletedAt),
  };
}

export function toRoutine(row: typeof routines.$inferSelect): Routine {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    type: row.type,
    color: row.color,
    timezone: row.timezone,
    overlapPolicy: row.overlapPolicy,
    version: row.version,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    updatedAt: asIso(row.updatedAt) ?? row.updatedAt,
    deletedAt: asIso(row.deletedAt),
  };
}

export function toMember(row: typeof routineMembers.$inferSelect): RoutineMember {
  return {
    id: row.id,
    routineId: row.routineId,
    userId: row.userId,
    role: row.role,
    joinedAt: asIso(row.joinedAt) ?? row.joinedAt,
  };
}

export function toSchedule(row: typeof schedules.$inferSelect): Schedule {
  return {
    ...toSnapshot(row),
    createdBy: row.createdBy,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    updatedAt: asIso(row.updatedAt) ?? row.updatedAt,
  };
}

export function toSnapshot(row: typeof schedules.$inferSelect): ScheduleSnapshot {
  return {
    id: row.id,
    routineId: row.routineId,
    activityId: row.activityId,
    startAt: asIso(row.startAt) ?? row.startAt,
    endAt: asIso(row.endAt) ?? row.endAt,
    timezone: row.timezone,
    version: row.version,
    deletedAt: asIso(row.deletedAt),
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByName,
  };
}

export function toInvitation(row: typeof invitations.$inferSelect): Invitation {
  return {
    id: row.id,
    routineId: row.routineId,
    senderId: row.senderId,
    recipientId: row.recipientId,
    status: row.status,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    respondedAt: asIso(row.respondedAt),
  };
}

export function toConflict(row: {
  id: string;
  routineId: string;
  kind: ScheduleConflict['kind'];
  affectedScheduleIds: string[];
  involvedUserIds: string[];
  baseState: unknown;
  proposedState: unknown;
  serverState: unknown;
  status: ScheduleConflict['status'];
  createdAt: string;
  updatedAt: string;
}): ScheduleConflict {
  return {
    ...row,
    createdAt: asIso(row.createdAt) ?? row.createdAt,
    updatedAt: asIso(row.updatedAt) ?? row.updatedAt,
  };
}

export async function personalRoutineId(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: routines.id })
    .from(routines)
    .where(and(eq(routines.ownerId, userId), eq(routines.type, 'personal'), isNull(routines.deletedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}
