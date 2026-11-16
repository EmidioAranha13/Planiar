import { and, arrayContains, eq, gt, isNull } from 'drizzle-orm';
import type {
  ConflictKind,
  ConflictProposal,
  OperationResult,
  ProposalChanges,
  ScheduleConflict,
  ScheduleSnapshot,
  SyncOperationInput,
} from '../../src/domain/entities/types';
import { applyDisputeEvent, type DisputeState } from '../../src/domain/rules/conflictMachine';
import { classifyScheduleMutation, evaluateBatchDelete } from '../../src/domain/rules/conflicts';
import { schedulesInScope } from '../../src/domain/rules/deletion';
import { evaluateOverlap } from '../../src/domain/rules/overlap';
import { canEditSchedules, canManageRoutine } from '../../src/domain/rules/permissions';
import { planRetention, retentionDeletionPolicy } from '../../src/domain/rules/retention';
import {
  activityInputSchema,
  deleteScopeSchema,
  invitationInputSchema,
  invitationResponseSchema,
  proposalChangesSchema,
  routineInputSchema,
  routineUpdateSchema,
  scheduleInputSchema,
  scheduleUpdateSchema,
  syncOperationSchema,
} from '../../src/domain/schemas/records';
import { normalizeTitle } from '../../src/domain/rules/title';
import { isValidTimeZone, validateScheduleRange } from '../../src/domain/rules/time';
import type { Database } from '../database/client';
import {
  activities,
  changeLog,
  conflictProposals,
  conflicts,
  invitations,
  notifications,
  routineMembers,
  routines,
  schedules,
  syncOperations,
  users,
} from '../database/schema';
import { AppError } from '../http/errors';
import { publishSync } from './realtime';
import {
  addChange,
  applied,
  audit,
  memberIds,
  memberRole,
  notify,
  personalRoutineId,
  rejected,
  toActivity,
  toConflict,
  toInvitation,
  toMember,
  toProfile,
  toRoutine,
  toSchedule,
  toSnapshot,
  zodMessage,
  type SyncContext,
} from './syncContext';

const conflictMessages: Record<ConflictKind, string> = {
  concurrent_edit: 'Outra alteração foi salva neste agendamento. A disputa foi aberta.',
  delete_vs_edit: 'Este agendamento foi excluído e editado ao mesmo tempo. A disputa foi aberta.',
  relocation: 'O agendamento foi movido em dois dispositivos. A disputa foi aberta.',
  overlap: 'O horário ficou incompatível com uma alteração que você ainda não tinha recebido.',
  batch: 'A exclusão em lote encontrou agendamentos modificados por outra pessoa.',
};

function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isSnapshot(value: unknown): value is ScheduleSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ScheduleSnapshot>;
  return Boolean(record.id && record.startAt && record.endAt && typeof record.version === 'number');
}

async function openConflict(
  ctx: SyncContext,
  input: Omit<ScheduleConflict, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<ScheduleConflict> {
  const record = {
    id: crypto.randomUUID(),
    status: 'open' as const,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...input,
  };
  await ctx.db.insert(conflicts).values(record);
  const conflict = toConflict(record);
  await addChange(ctx, {
    entityType: 'conflict',
    entityId: conflict.id,
    op: 'upsert',
    record: conflict,
    version: null,
    audienceUserIds: conflict.involvedUserIds,
  });
  for (const userId of conflict.involvedUserIds) {
    await notify(ctx, userId, 'conflict_opened', {
      conflictId: conflict.id,
      routineId: conflict.routineId,
      kind: conflict.kind,
    });
  }
  await audit(ctx, 'conflict.open', 'conflict', conflict.id, { kind: conflict.kind });
  return conflict;
}

async function activeSnapshots(db: Database, routineId: string): Promise<ScheduleSnapshot[]> {
  const rows = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.routineId, routineId), isNull(schedules.deletedAt)));
  return rows.map(toSnapshot);
}

async function handleActivity(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.operationType === 'create') {
    const parsed = activityInputSchema.safeParse(operation.payload);
    if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
    const title = cleanTitle(parsed.data.title);
    const normalizedTitle = normalizeTitle(title);
    const duplicates = await ctx.db
      .select()
      .from(activities)
      .where(and(eq(activities.ownerId, ctx.actorId), eq(activities.normalizedTitle, normalizedTitle), isNull(activities.deletedAt)));
    const duplicate = duplicates.find((row) => row.id !== operation.entityId);
    if (duplicate) {
      return rejected('duplicate_activity', 'Você já tem uma atividade com este título.', {
        serverRecord: toActivity(duplicate),
      });
    }
    const same = duplicates.find((row) => row.id === operation.entityId);
    if (same) return applied(same.version, toActivity(same));
    const row = {
      id: operation.entityId,
      ownerId: ctx.actorId,
      title,
      normalizedTitle,
      description: parsed.data.description ?? '',
      color: parsed.data.color,
      version: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      deletedAt: null,
    };
    await ctx.db.insert(activities).values(row);
    const activity = toActivity(row);
    await addChange(ctx, {
      entityType: 'activity',
      entityId: activity.id,
      op: 'upsert',
      record: activity,
      version: 1,
      audienceUserIds: [ctx.actorId],
    });
    await audit(ctx, 'activity.create', 'activity', activity.id);
    return applied(1, activity);
  }

  const rows = await ctx.db.select().from(activities).where(eq(activities.id, operation.entityId));
  const current = rows[0];
  if (!current || current.ownerId !== ctx.actorId) return rejected('forbidden', 'Você não pode alterar esta atividade.');
  if (operation.baseVersion != null && current.version !== operation.baseVersion) {
    const routineId = await personalRoutineId(ctx.db, ctx.actorId);
    const serverRecord = toActivity(current);
    if (!routineId) {
      return { status: 'conflict', code: 'version_conflict', message: conflictMessages.concurrent_edit, serverRecord };
    }
    const conflict = await openConflict(ctx, {
      routineId,
      kind: current.deletedAt ? 'delete_vs_edit' : 'concurrent_edit',
      affectedScheduleIds: [],
      involvedUserIds: [ctx.actorId],
      baseState: operation.baseSnapshot ?? null,
      proposedState: operation.payload,
      serverState: serverRecord,
    });
    return { status: 'conflict', code: conflict.kind, message: conflictMessages[conflict.kind], conflict, serverRecord };
  }
  if (operation.operationType === 'delete') {
    const next = { ...current, deletedAt: ctx.now, updatedAt: ctx.now, version: current.version + 1 };
    await ctx.db.update(activities).set({ deletedAt: ctx.now, updatedAt: ctx.now, version: next.version }).where(eq(activities.id, current.id));
    const activity = toActivity(next);
    await addChange(ctx, {
      entityType: 'activity',
      entityId: activity.id,
      op: 'upsert',
      record: activity,
      version: activity.version,
      audienceUserIds: [ctx.actorId],
    });
    await audit(ctx, 'activity.delete', 'activity', activity.id);
    return applied(activity.version, activity);
  }
  const parsed = activityInputSchema.safeParse({ ...toActivity(current), ...asRecord(operation.payload) });
  if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
  const title = cleanTitle(parsed.data.title);
  const normalizedTitle = normalizeTitle(title);
  const duplicates = await ctx.db
    .select()
    .from(activities)
    .where(and(eq(activities.ownerId, ctx.actorId), eq(activities.normalizedTitle, normalizedTitle), isNull(activities.deletedAt)));
  const duplicate = duplicates.find((row) => row.id !== current.id);
  if (duplicate) {
    return rejected('duplicate_activity', 'Você já tem uma atividade com este título.', { serverRecord: toActivity(duplicate) });
  }
  const next = {
    ...current,
    title,
    normalizedTitle,
    description: parsed.data.description ?? '',
    color: parsed.data.color,
    version: current.version + 1,
    updatedAt: ctx.now,
  };
  await ctx.db
    .update(activities)
    .set({
      title: next.title,
      normalizedTitle: next.normalizedTitle,
      description: next.description,
      color: next.color,
      version: next.version,
      updatedAt: next.updatedAt,
    })
    .where(eq(activities.id, current.id));
  const activity = toActivity(next);
  await addChange(ctx, {
    entityType: 'activity',
    entityId: activity.id,
    op: 'upsert',
    record: activity,
    version: activity.version,
    audienceUserIds: [ctx.actorId],
  });
  await audit(ctx, 'activity.update', 'activity', activity.id);
  return applied(activity.version, activity);
}

async function handleRoutine(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.operationType === 'create') {
    const parsed = routineInputSchema.safeParse(operation.payload);
    if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
    if (!parsed.data.timezone || !isValidTimeZone(parsed.data.timezone)) {
      return rejected('validation', 'Informe um fuso horário válido.');
    }
    const routineRow = {
      id: operation.entityId,
      name: cleanTitle(parsed.data.name),
      description: parsed.data.description ?? '',
      ownerId: ctx.actorId,
      type: parsed.data.type ?? 'personal',
      color: parsed.data.color ?? null,
      timezone: parsed.data.timezone,
      overlapPolicy: parsed.data.overlapPolicy ?? 'allow',
      version: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      deletedAt: null,
    };
    const memberRow = {
      id: crypto.randomUUID(),
      routineId: routineRow.id,
      userId: ctx.actorId,
      role: 'owner' as const,
      joinedAt: ctx.now,
    };
    await ctx.db.insert(routines).values(routineRow);
    await ctx.db.insert(routineMembers).values(memberRow);
    const routine = toRoutine(routineRow);
    const member = toMember(memberRow);
    await addChange(ctx, { entityType: 'routine', entityId: routine.id, op: 'upsert', record: routine, version: 1, audienceUserIds: [ctx.actorId] });
    await addChange(ctx, { entityType: 'member', entityId: member.id, op: 'upsert', record: member, version: null, audienceUserIds: [ctx.actorId] });
    await audit(ctx, 'routine.create', 'routine', routine.id);
    return applied(1, routine);
  }

  const rows = await ctx.db.select().from(routines).where(eq(routines.id, operation.entityId));
  const current = rows[0];
  if (!current) return rejected('not_found', 'A rotina não foi encontrada.');
  const role = await memberRole(ctx.db, current.id, ctx.actorId);
  if (!canManageRoutine(role)) return rejected('forbidden', 'Somente o proprietário pode alterar a rotina.');
  if (operation.baseVersion != null && current.version !== operation.baseVersion) {
    return { status: 'conflict', code: 'version_conflict', message: 'A rotina foi alterada em outro dispositivo.', serverRecord: toRoutine(current) };
  }
  const audience = await memberIds(ctx.db, current.id);
  if (operation.operationType === 'delete') {
    const next = { ...current, deletedAt: ctx.now, updatedAt: ctx.now, version: current.version + 1 };
    await ctx.db.update(routines).set({ deletedAt: ctx.now, updatedAt: ctx.now, version: next.version }).where(eq(routines.id, current.id));
    const routine = toRoutine(next);
    await addChange(ctx, { entityType: 'routine', entityId: routine.id, op: 'upsert', record: routine, version: routine.version, audienceUserIds: audience });
    await audit(ctx, 'routine.delete', 'routine', routine.id);
    return applied(routine.version, routine);
  }
  const parsed = routineUpdateSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
  if (parsed.data.timezone && !isValidTimeZone(parsed.data.timezone)) return rejected('validation', 'Informe um fuso horário válido.');
  const next = {
    ...current,
    name: parsed.data.name ? cleanTitle(parsed.data.name) : current.name,
    description: parsed.data.description ?? current.description,
    type: parsed.data.type ?? current.type,
    color: parsed.data.color === undefined ? current.color : parsed.data.color,
    timezone: parsed.data.timezone ?? current.timezone,
    overlapPolicy: parsed.data.overlapPolicy ?? current.overlapPolicy,
    version: current.version + 1,
    updatedAt: ctx.now,
  };
  await ctx.db
    .update(routines)
    .set({
      name: next.name,
      description: next.description,
      type: next.type,
      color: next.color,
      timezone: next.timezone,
      overlapPolicy: next.overlapPolicy,
      version: next.version,
      updatedAt: next.updatedAt,
    })
    .where(eq(routines.id, current.id));
  const routine = toRoutine(next);
  await addChange(ctx, { entityType: 'routine', entityId: routine.id, op: 'upsert', record: routine, version: routine.version, audienceUserIds: audience });
  await audit(ctx, 'routine.update', 'routine', routine.id);
  return applied(routine.version, routine);
}

async function ensureScheduleAccess(ctx: SyncContext, routineId: string) {
  const routineRows = await ctx.db.select().from(routines).where(eq(routines.id, routineId));
  const routine = routineRows[0];
  if (!routine || routine.deletedAt) return { error: rejected('not_found', 'A rotina não foi encontrada.') };
  const role = await memberRole(ctx.db, routine.id, ctx.actorId);
  if (!canEditSchedules(role)) return { error: rejected('forbidden', 'Você não pode alterar os agendamentos desta rotina.') };
  return { routine, role };
}

async function handleSchedule(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.operationType === 'delete_scope') return handleDeleteScope(ctx, operation);
  if (operation.operationType === 'create') {
    const parsed = scheduleInputSchema.safeParse(operation.payload);
    if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
    const range = validateScheduleRange(parsed.data);
    if (!range.ok) return rejected('validation', range.message);
    const access = await ensureScheduleAccess(ctx, parsed.data.routineId);
    if ('error' in access && access.error) return access.error;
    const routine = access.routine;
    if (!routine) return rejected('not_found', 'A rotina não foi encontrada.');
    const activityRows = await ctx.db.select().from(activities).where(eq(activities.id, parsed.data.activityId));
    const activity = activityRows[0];
    if (!activity || activity.deletedAt || activity.ownerId !== ctx.actorId) {
      return rejected('forbidden', 'Escolha uma atividade sua para agendar.');
    }
    const existingRows = await ctx.db.select().from(schedules).where(eq(schedules.id, operation.entityId));
    const actor = await ctx.db.select().from(users).where(eq(users.id, ctx.actorId));
    const actorName = actor[0]?.displayName ?? 'Usuário';
    const decision = classifyScheduleMutation({
      operation: 'create',
      base: null,
      current: existingRows[0] ? toSnapshot(existingRows[0]) : null,
      proposed: { startAt: range.startAt, endAt: range.endAt, activityId: activity.id },
    });
    if (decision.type === 'idempotent' && existingRows[0]) return applied(existingRows[0].version, toSchedule(existingRows[0]));
    if (decision.type === 'conflict') {
      const conflict = await openConflict(ctx, {
        routineId: routine.id,
        kind: decision.kind,
        affectedScheduleIds: [operation.entityId],
        involvedUserIds: [...new Set([ctx.actorId, existingRows[0]?.updatedBy ?? ctx.actorId])],
        baseState: null,
        proposedState: { ...parsed.data, startAt: range.startAt, endAt: range.endAt },
        serverState: existingRows[0] ? toSchedule(existingRows[0]) : null,
      });
      return { status: 'conflict', code: decision.kind, message: conflictMessages[decision.kind], conflict, serverRecord: existingRows[0] ? toSchedule(existingRows[0]) : null };
    }
    const snapshots = await activeSnapshots(ctx.db, routine.id);
    const overlap = evaluateOverlap({
      policy: routine.overlapPolicy,
      proposed: { id: operation.entityId, startAt: range.startAt, endAt: range.endAt },
      schedules: snapshots,
      knownVersions: operation.knownScheduleVersions ?? {},
    });
    if (overlap.type === 'validation') return rejected('overlap_not_allowed', overlap.message);
    if (overlap.type === 'conflict') {
      const involved = new Set<string>([ctx.actorId, routine.ownerId]);
      for (const snapshot of snapshots.filter((item) => overlap.scheduleIds.includes(item.id))) involved.add(snapshot.updatedBy);
      const conflict = await openConflict(ctx, {
        routineId: routine.id,
        kind: 'overlap',
        affectedScheduleIds: [operation.entityId, ...overlap.scheduleIds],
        involvedUserIds: [...involved],
        baseState: operation.knownScheduleVersions ?? {},
        proposedState: {
          id: operation.entityId,
          routineId: routine.id,
          activityId: activity.id,
          startAt: range.startAt,
          endAt: range.endAt,
          timezone: routine.timezone,
          version: 0,
          deletedAt: null,
          updatedBy: ctx.actorId,
          updatedByName: actorName,
        },
        serverState: snapshots.filter((item) => overlap.scheduleIds.includes(item.id)),
      });
      return { status: 'conflict', code: 'overlap', message: conflictMessages.overlap, conflict };
    }
    const row = {
      id: operation.entityId,
      routineId: routine.id,
      activityId: activity.id,
      startAt: range.startAt,
      endAt: range.endAt,
      timezone: routine.timezone,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      updatedByName: actorName,
      version: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      deletedAt: null,
    };
    await ctx.db.insert(schedules).values(row);
    const schedule = toSchedule(row);
    const audience = await memberIds(ctx.db, routine.id);
    await addChange(ctx, { entityType: 'schedule', entityId: schedule.id, op: 'upsert', record: schedule, version: 1, audienceUserIds: audience });
    await addChange(ctx, { entityType: 'activity', entityId: activity.id, op: 'upsert', record: toActivity(activity), version: activity.version, audienceUserIds: audience });
    if (actor[0]) {
      await addChange(ctx, { entityType: 'profile', entityId: actor[0].id, op: 'upsert', record: toProfile(actor[0]), version: null, audienceUserIds: audience });
    }
    await audit(ctx, 'schedule.create', 'schedule', schedule.id);
    return applied(1, schedule);
  }

  const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, operation.entityId));
  const current = rows[0];
  if (!current) return rejected('not_found', 'O agendamento não foi encontrado.');
  const access = await ensureScheduleAccess(ctx, current.routineId);
  if (access.error) return access.error;
  const routine = access.routine;
  if (!routine) return rejected('not_found', 'A rotina não foi encontrada.');
  const base = isSnapshot(operation.baseSnapshot) ? operation.baseSnapshot : null;
  const parsedUpdate = operation.operationType === 'update' ? scheduleUpdateSchema.safeParse(operation.payload) : null;
  if (parsedUpdate && !parsedUpdate.success) return rejected('validation', zodMessage(parsedUpdate.error));
  const proposedRange = parsedUpdate?.success
    ? validateScheduleRange({ startAt: parsedUpdate.data.startAt, endAt: parsedUpdate.data.endAt, timezone: routine.timezone })
    : null;
  if (proposedRange && !proposedRange.ok) return rejected('validation', proposedRange.message);
  const decision = classifyScheduleMutation({
    operation: operation.operationType === 'delete' ? 'delete' : 'update',
    base,
    current: toSnapshot(current),
    proposed: proposedRange && proposedRange.ok ? { startAt: proposedRange.startAt, endAt: proposedRange.endAt, activityId: parsedUpdate?.success ? parsedUpdate.data.activityId : undefined } : null,
  });
  if (decision.type === 'missing') return rejected('not_found', 'O agendamento não foi encontrado.');
  if (decision.type === 'idempotent') return applied(current.version, toSchedule(current));
  if (decision.type === 'conflict') {
    const involved = [...new Set([ctx.actorId, current.updatedBy, routine.ownerId])];
    const conflict = await openConflict(ctx, {
      routineId: routine.id,
      kind: decision.kind,
      affectedScheduleIds: [current.id],
      involvedUserIds: involved,
      baseState: base,
      proposedState: proposedRange && proposedRange.ok
        ? { ...toSnapshot(current), startAt: proposedRange.startAt, endAt: proposedRange.endAt, deletedAt: operation.operationType === 'delete' ? ctx.now : null }
        : { ...toSnapshot(current), deletedAt: ctx.now },
      serverState: toSnapshot(current),
    });
    return { status: 'conflict', code: decision.kind, message: conflictMessages[decision.kind], conflict, serverRecord: toSchedule(current) };
  }
  const audience = await memberIds(ctx.db, routine.id);
  if (operation.operationType === 'delete') {
    const nextVersion = current.version + 1;
    await ctx.db.update(schedules).set({ deletedAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actorId, version: nextVersion }).where(eq(schedules.id, current.id));
    const schedule = toSchedule({ ...current, deletedAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actorId, version: nextVersion });
    await addChange(ctx, { entityType: 'schedule', entityId: schedule.id, op: 'upsert', record: schedule, version: nextVersion, audienceUserIds: audience });
    await audit(ctx, 'schedule.delete', 'schedule', schedule.id);
    return applied(nextVersion, schedule);
  }
  if (!proposedRange || !proposedRange.ok || !parsedUpdate?.success) return rejected('validation', 'Informe o novo horário.');
  const snapshots = await activeSnapshots(ctx.db, routine.id);
  const overlap = evaluateOverlap({
    policy: routine.overlapPolicy,
    proposed: { id: current.id, startAt: proposedRange.startAt, endAt: proposedRange.endAt },
    schedules: snapshots,
    knownVersions: operation.knownScheduleVersions ?? {},
  });
  if (overlap.type === 'validation') return rejected('overlap_not_allowed', overlap.message);
  if (overlap.type === 'conflict') {
    const conflict = await openConflict(ctx, {
      routineId: routine.id,
      kind: 'overlap',
      affectedScheduleIds: [current.id, ...overlap.scheduleIds],
      involvedUserIds: [...new Set([ctx.actorId, current.updatedBy, routine.ownerId])],
      baseState: base,
      proposedState: { ...toSnapshot(current), startAt: proposedRange.startAt, endAt: proposedRange.endAt },
      serverState: snapshots.filter((item) => overlap.scheduleIds.includes(item.id)),
    });
    return { status: 'conflict', code: 'overlap', message: conflictMessages.overlap, conflict, serverRecord: toSchedule(current) };
  }
  const actor = await ctx.db.select().from(users).where(eq(users.id, ctx.actorId));
  const nextVersion = current.version + 1;
  const next = {
    ...current,
    activityId: parsedUpdate.data.activityId ?? current.activityId,
    startAt: proposedRange.startAt,
    endAt: proposedRange.endAt,
    updatedBy: ctx.actorId,
    updatedByName: actor[0]?.displayName ?? current.updatedByName,
    updatedAt: ctx.now,
    version: nextVersion,
  };
  await ctx.db
    .update(schedules)
    .set({
      activityId: next.activityId,
      startAt: next.startAt,
      endAt: next.endAt,
      updatedBy: next.updatedBy,
      updatedByName: next.updatedByName,
      updatedAt: next.updatedAt,
      version: next.version,
    })
    .where(eq(schedules.id, current.id));
  const schedule = toSchedule(next);
  await addChange(ctx, { entityType: 'schedule', entityId: schedule.id, op: 'upsert', record: schedule, version: nextVersion, audienceUserIds: audience });
  await audit(ctx, 'schedule.update', 'schedule', schedule.id);
  return applied(nextVersion, schedule);
}

async function handleDeleteScope(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  const parsed = deleteScopeSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
  const access = await ensureScheduleAccess(ctx, parsed.data.routineId);
  if (access.error) return access.error;
  const rows = await ctx.db.select().from(schedules).where(eq(schedules.routineId, parsed.data.routineId));
  const mapped = rows.map((row) => ({ ...toSnapshot(row), activityId: row.activityId, routineId: row.routineId, version: row.version }));
  const matched = schedulesInScope({
    schedules: mapped,
    anchor: {
      id: parsed.data.anchorScheduleId,
      activityId: parsed.data.activityId,
      routineId: parsed.data.routineId,
      startAt: parsed.data.anchorStartAt,
    },
    scope: parsed.data.scope,
    timeZone: parsed.data.timezone,
  });
  const batch = evaluateBatchDelete({
    expected: parsed.data.expected,
    matched: matched.map((item) => ({ id: item.id, version: item.version, deletedAt: item.deletedAt })),
  });
  if (!batch.ok) {
    const routine = access.routine;
    const involved = [...new Set([ctx.actorId, routine?.ownerId ?? ctx.actorId, ...rows.filter((row) => matched.some((item) => item.id === row.id)).map((row) => row.updatedBy)])];
    const conflict = await openConflict(ctx, {
      routineId: parsed.data.routineId,
      kind: 'batch',
      affectedScheduleIds: [...new Set([...parsed.data.expected.map((item) => item.id), ...matched.map((item) => item.id)])],
      involvedUserIds: involved,
      baseState: parsed.data.expected,
      proposedState: parsed.data,
      serverState: matched,
    });
    return { status: 'conflict', code: 'batch', message: batch.message, conflict };
  }
  const audience = await memberIds(ctx.db, parsed.data.routineId);
  const deleted: ScheduleSnapshot[] = [];
  for (const item of matched) {
    const source = rows.find((row) => row.id === item.id);
    if (!source) continue;
    const nextVersion = source.version + 1;
    await ctx.db
      .update(schedules)
      .set({ deletedAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actorId, version: nextVersion })
      .where(eq(schedules.id, source.id));
    const schedule = toSchedule({ ...source, deletedAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actorId, version: nextVersion });
    deleted.push(schedule);
    await addChange(ctx, { entityType: 'schedule', entityId: schedule.id, op: 'upsert', record: schedule, version: nextVersion, audienceUserIds: audience });
  }
  await audit(ctx, 'schedule.delete_scope', 'schedule', parsed.data.anchorScheduleId, { scope: parsed.data.scope, count: deleted.length });
  return applied(null, { deleted });
}

async function handleInvitation(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.operationType === 'create') {
    const parsed = invitationInputSchema.safeParse(operation.payload);
    if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
    const routineRows = await ctx.db.select().from(routines).where(eq(routines.id, parsed.data.routineId));
    const routine = routineRows[0];
    if (!routine || routine.deletedAt) return rejected('not_found', 'A rotina não foi encontrada.');
    const role = await memberRole(ctx.db, routine.id, ctx.actorId);
    if (!canManageRoutine(role)) return rejected('forbidden', 'Somente o proprietário pode convidar.');
    const recipients = await ctx.db.select().from(users).where(eq(users.username, parsed.data.username));
    const recipient = recipients[0];
    if (!recipient) return rejected('user_not_found', 'Não encontramos esse nome de usuário.');
    if (recipient.id === ctx.actorId) return rejected('validation', 'Você já participa desta rotina.');
    const existingMember = await memberRole(ctx.db, routine.id, recipient.id);
    if (existingMember) return rejected('already_member', 'Essa pessoa já participa da rotina.');
    const pending = await ctx.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.routineId, routine.id), eq(invitations.recipientId, recipient.id), eq(invitations.status, 'pending')));
    if (pending[0]) return rejected('invite_pending', 'Já existe um convite pendente para essa pessoa.');
    if (routine.type === 'personal') {
      await ctx.db.update(routines).set({ type: 'shared', version: routine.version + 1, updatedAt: ctx.now }).where(eq(routines.id, routine.id));
    }
    const sender = await ctx.db.select().from(users).where(eq(users.id, ctx.actorId));
    const row = {
      id: operation.entityId,
      routineId: routine.id,
      senderId: ctx.actorId,
      recipientId: recipient.id,
      status: 'pending' as const,
      createdAt: ctx.now,
      respondedAt: null,
    };
    await ctx.db.insert(invitations).values(row);
    const invitation = { ...toInvitation(row), routineName: routine.name, senderName: sender[0]?.displayName ?? 'Usuário' };
    const audience = [ctx.actorId, recipient.id];
    await addChange(ctx, { entityType: 'invitation', entityId: invitation.id, op: 'upsert', record: invitation, version: null, audienceUserIds: audience });
    await notify(ctx, recipient.id, 'invitation_received', {
      invitationId: invitation.id,
      routineId: routine.id,
      routineName: routine.name,
      senderId: ctx.actorId,
      senderName: invitation.senderName,
      createdAt: ctx.now,
    });
    await audit(ctx, 'invitation.create', 'invitation', invitation.id);
    return applied(null, invitation);
  }

  const parsed = invitationResponseSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
  const rows = await ctx.db.select().from(invitations).where(eq(invitations.id, operation.entityId));
  const current = rows[0];
  if (!current) return rejected('not_found', 'O convite não foi encontrado.');
  if (current.status !== 'pending') return applied(null, toInvitation(current));
  const routineRows = await ctx.db.select().from(routines).where(eq(routines.id, current.routineId));
  const routine = routineRows[0];
  if (!routine) return rejected('not_found', 'A rotina não foi encontrada.');
  if (parsed.data.status === 'cancelled') {
    const role = await memberRole(ctx.db, routine.id, ctx.actorId);
    if (ctx.actorId !== current.senderId && !canManageRoutine(role)) return rejected('forbidden', 'Você não pode cancelar este convite.');
  } else if (ctx.actorId !== current.recipientId) {
    return rejected('forbidden', 'Somente a pessoa convidada pode responder.');
  }
  const next = { ...current, status: parsed.data.status, respondedAt: ctx.now };
  await ctx.db.update(invitations).set({ status: next.status, respondedAt: ctx.now }).where(eq(invitations.id, current.id));
  const invitation = toInvitation(next);
  let audience = [current.senderId, current.recipientId];
  await addChange(ctx, { entityType: 'invitation', entityId: invitation.id, op: 'upsert', record: invitation, version: null, audienceUserIds: audience });
  if (parsed.data.status === 'accepted') {
    const memberRow = {
      id: crypto.randomUUID(),
      routineId: routine.id,
      userId: current.recipientId,
      role: 'editor' as const,
      joinedAt: ctx.now,
    };
    await ctx.db.insert(routineMembers).values(memberRow);
    audience = await memberIds(ctx.db, routine.id);
    await addChange(ctx, { entityType: 'member', entityId: memberRow.id, op: 'upsert', record: toMember(memberRow), version: null, audienceUserIds: audience });
    await addChange(ctx, { entityType: 'routine', entityId: routine.id, op: 'upsert', record: toRoutine(routine), version: routine.version, audienceUserIds: audience });
    const scheduleRows = await ctx.db.select().from(schedules).where(eq(schedules.routineId, routine.id));
    for (const schedule of scheduleRows) {
      await addChange(ctx, { entityType: 'schedule', entityId: schedule.id, op: 'upsert', record: toSchedule(schedule), version: schedule.version, audienceUserIds: [current.recipientId] });
      const activityRows = await ctx.db.select().from(activities).where(eq(activities.id, schedule.activityId));
      if (activityRows[0]) {
        await addChange(ctx, {
          entityType: 'activity',
          entityId: activityRows[0].id,
          op: 'upsert',
          record: toActivity(activityRows[0]),
          version: activityRows[0].version,
          audienceUserIds: [current.recipientId],
        });
      }
    }
    const memberRows = await ctx.db.select().from(routineMembers).where(eq(routineMembers.routineId, routine.id));
    for (const member of memberRows) {
      const profileRows = await ctx.db.select().from(users).where(eq(users.id, member.userId));
      if (profileRows[0]) {
        await addChange(ctx, { entityType: 'profile', entityId: profileRows[0].id, op: 'upsert', record: toProfile(profileRows[0]), version: null, audienceUserIds: audience });
      }
    }
    await notify(ctx, current.senderId, 'invitation_accepted', { invitationId: current.id, routineId: routine.id, routineName: routine.name });
  } else if (parsed.data.status === 'rejected') {
    await notify(ctx, current.senderId, 'invitation_rejected', { invitationId: current.id, routineId: routine.id, routineName: routine.name });
  }
  await audit(ctx, `invitation.${parsed.data.status}`, 'invitation', current.id);
  return applied(null, invitation);
}

async function loadDispute(ctx: SyncContext, conflictId: string): Promise<{ conflict: typeof conflicts.$inferSelect; state: DisputeState } | null> {
  const rows = await ctx.db.select().from(conflicts).where(eq(conflicts.id, conflictId));
  const conflict = rows[0];
  if (!conflict) return null;
  const proposalRows = await ctx.db.select().from(conflictProposals).where(eq(conflictProposals.conflictId, conflictId));
  return {
    conflict,
    state: {
      status: conflict.status,
      involvedUserIds: conflict.involvedUserIds,
      proposals: proposalRows.map((proposal) => ({
        id: proposal.id,
        proposerId: proposal.proposerId,
        proposedChanges: proposal.proposedChanges,
        status: proposal.status,
        createdAt: proposal.createdAt,
        respondedAt: proposal.respondedAt,
      })),
    },
  };
}

async function persistDispute(ctx: SyncContext, conflict: typeof conflicts.$inferSelect, state: DisputeState): Promise<ScheduleConflict> {
  await ctx.db.update(conflicts).set({ status: state.status, updatedAt: ctx.now }).where(eq(conflicts.id, conflict.id));
  for (const proposal of state.proposals) {
    const existing = await ctx.db.select().from(conflictProposals).where(eq(conflictProposals.id, proposal.id));
    if (!existing[0]) {
      await ctx.db.insert(conflictProposals).values({
        id: proposal.id,
        conflictId: conflict.id,
        proposerId: proposal.proposerId,
        proposedChanges: proposal.proposedChanges,
        status: proposal.status,
        createdAt: proposal.createdAt,
        respondedAt: proposal.respondedAt,
      });
    } else if (existing[0].status !== proposal.status) {
      await ctx.db
        .update(conflictProposals)
        .set({ status: proposal.status, respondedAt: proposal.respondedAt })
        .where(eq(conflictProposals.id, proposal.id));
    }
    await addChange(ctx, {
      entityType: 'proposal',
      entityId: proposal.id,
      op: 'upsert',
      record: { ...proposal, conflictId: conflict.id },
      version: null,
      audienceUserIds: state.involvedUserIds,
    });
  }
  const updated = toConflict({ ...conflict, status: state.status, updatedAt: ctx.now });
  await addChange(ctx, {
    entityType: 'conflict',
    entityId: updated.id,
    op: 'upsert',
    record: updated,
    version: null,
    audienceUserIds: state.involvedUserIds,
  });
  return updated;
}

async function writeSnapshot(ctx: SyncContext, snapshot: ScheduleSnapshot, audience: string[]): Promise<void> {
  const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, snapshot.id));
  const current = rows[0];
  if (!current) {
    if (snapshot.version === 0) {
      const actor = await ctx.db.select().from(users).where(eq(users.id, ctx.actorId));
      const row = {
        id: snapshot.id,
        routineId: snapshot.routineId,
        activityId: snapshot.activityId,
        startAt: snapshot.startAt,
        endAt: snapshot.endAt,
        timezone: snapshot.timezone,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        updatedByName: actor[0]?.displayName ?? snapshot.updatedByName,
        version: 1,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        deletedAt: snapshot.deletedAt,
      };
      await ctx.db.insert(schedules).values(row);
      await addChange(ctx, { entityType: 'schedule', entityId: row.id, op: 'upsert', record: toSchedule(row), version: 1, audienceUserIds: audience });
    }
    return;
  }
  if (isSnapshot(snapshot) && current.version !== snapshot.version && snapshot.version !== 0) {
    throw new AppError(409, 'conflict_changed', 'O agendamento mudou outra vez antes da resolução.');
  }
  const nextVersion = current.version + 1;
  await ctx.db
    .update(schedules)
    .set({
      activityId: snapshot.activityId,
      startAt: snapshot.startAt,
      endAt: snapshot.endAt,
      deletedAt: snapshot.deletedAt,
      updatedBy: ctx.actorId,
      updatedAt: ctx.now,
      version: nextVersion,
    })
    .where(eq(schedules.id, current.id));
  await addChange(ctx, {
    entityType: 'schedule',
    entityId: current.id,
    op: 'upsert',
    record: toSchedule({ ...current, ...snapshot, updatedBy: ctx.actorId, updatedAt: ctx.now, version: nextVersion, createdAt: current.createdAt, createdBy: current.createdBy }),
    version: nextVersion,
    audienceUserIds: audience,
  });
}

async function applyResolution(ctx: SyncContext, conflict: typeof conflicts.$inferSelect, changes: ProposalChanges): Promise<void> {
  const audience = await memberIds(ctx.db, conflict.routineId);
  if (changes.action === 'keep' && changes.choice === 'server') return;
  if (changes.action === 'keep' && changes.choice === 'proposed') {
    if (!isSnapshot(conflict.proposedState)) throw new AppError(409, 'conflict_changed', 'A proposta original não pode mais ser aplicada.');
    const serverVersion = isSnapshot(conflict.serverState) ? conflict.serverState.version : null;
    const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, conflict.proposedState.id));
    if (rows[0] && serverVersion != null && rows[0].version !== serverVersion && conflict.proposedState.version !== 0) {
      throw new AppError(409, 'conflict_changed', 'O agendamento mudou outra vez antes da resolução.');
    }
    await writeSnapshot(ctx, conflict.proposedState, audience);
    return;
  }
  if (changes.action === 'reschedule') {
    const routineRows = await ctx.db.select().from(routines).where(eq(routines.id, conflict.routineId));
    const routine = routineRows[0];
    if (!routine) throw new AppError(404, 'not_found', 'A rotina não foi encontrada.');
    const range = validateScheduleRange({ startAt: changes.startAt, endAt: changes.endAt, timezone: routine.timezone });
    if (!range.ok) throw new AppError(400, 'validation', range.message);
    const snapshots = await activeSnapshots(ctx.db, routine.id);
    const known = Object.fromEntries(snapshots.map((item) => [item.id, item.version]));
    const overlap = evaluateOverlap({
      policy: routine.overlapPolicy,
      proposed: { id: changes.scheduleId, startAt: range.startAt, endAt: range.endAt },
      schedules: snapshots,
      knownVersions: known,
    });
    if (overlap.type !== 'ok') throw new AppError(409, 'overlap_not_allowed', 'O horário proposto continua incompatível.');
    const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, changes.scheduleId));
    const current = rows[0];
    if (!current) throw new AppError(404, 'not_found', 'O agendamento não foi encontrado.');
    await writeSnapshot(ctx, { ...toSnapshot(current), startAt: range.startAt, endAt: range.endAt, version: current.version }, audience);
    return;
  }
  if (changes.action === 'delete') {
    const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, changes.scheduleId));
    const current = rows[0];
    if (!current || current.deletedAt) return;
    await writeSnapshot(ctx, { ...toSnapshot(current), deletedAt: ctx.now, version: current.version }, audience);
    return;
  }
  for (const scheduleId of conflict.affectedScheduleIds) {
    const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, scheduleId));
    const current = rows[0];
    if (!current || current.deletedAt) continue;
    await writeSnapshot(ctx, { ...toSnapshot(current), deletedAt: ctx.now, version: current.version }, audience);
  }
}

async function handleProposal(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.operationType === 'propose') {
    const payload = asRecord(operation.payload);
    const changesParsed = proposalChangesSchema.safeParse(payload.changes ?? payload);
    const conflictId = typeof payload.conflictId === 'string' ? payload.conflictId : operation.entityId;
    if (!changesParsed.success) return rejected('validation', zodMessage(changesParsed.error));
    const loaded = await loadDispute(ctx, conflictId);
    if (!loaded) return rejected('not_found', 'A disputa não foi encontrada.');
    const proposal: ConflictProposal = {
      id: operation.entityId,
      conflictId,
      proposerId: ctx.actorId,
      proposedChanges: changesParsed.data,
      status: 'pending',
      createdAt: ctx.now,
      respondedAt: null,
    };
    const outcome = applyDisputeEvent(loaded.state, { type: 'propose', actorId: ctx.actorId, proposal });
    if (!outcome.ok) return rejected(outcome.code, outcome.message);
    const conflict = await persistDispute(ctx, loaded.conflict, outcome.state);
    for (const userId of loaded.conflict.involvedUserIds.filter((id) => id !== ctx.actorId)) {
      await notify(ctx, userId, 'proposal_received', { conflictId, proposalId: proposal.id });
    }
    await audit(ctx, 'conflict.propose', 'proposal', proposal.id);
    return applied(null, { conflict, proposals: outcome.state.proposals });
  }

  const payload = asRecord(operation.payload);
  const decision = payload.decision === 'rejected' ? 'rejected' : payload.decision === 'accepted' ? 'accepted' : null;
  if (!decision) return rejected('validation', 'Informe se a proposta foi aceita ou recusada.');
  const proposalRows = await ctx.db.select().from(conflictProposals).where(eq(conflictProposals.id, operation.entityId));
  const proposal = proposalRows[0];
  if (!proposal) return rejected('not_found', 'A proposta não foi encontrada.');
  const loaded = await loadDispute(ctx, proposal.conflictId);
  if (!loaded) return rejected('not_found', 'A disputa não foi encontrada.');
  const outcome = applyDisputeEvent(loaded.state, {
    type: decision === 'accepted' ? 'accept' : 'reject',
    actorId: ctx.actorId,
    proposalId: proposal.id,
    respondedAt: ctx.now,
  });
  if (!outcome.ok) return rejected(outcome.code, outcome.message);
  if (decision === 'accepted') {
    const role = await memberRole(ctx.db, loaded.conflict.routineId, ctx.actorId);
    if (!canEditSchedules(role)) return rejected('forbidden', 'Você não pode resolver esta disputa.');
    await applyResolution(ctx, loaded.conflict, proposal.proposedChanges);
  }
  const conflict = await persistDispute(ctx, loaded.conflict, outcome.state);
  await notify(ctx, proposal.proposerId, decision === 'accepted' ? 'proposal_accepted' : 'proposal_rejected', {
    conflictId: conflict.id,
    proposalId: proposal.id,
  });
  await audit(ctx, `conflict.${decision}`, 'proposal', proposal.id);
  return applied(null, { conflict, proposals: outcome.state.proposals });
}

async function handleNotification(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  const rows = await ctx.db.select().from(notifications).where(eq(notifications.id, operation.entityId));
  const current = rows[0];
  if (!current || current.userId !== ctx.actorId) return rejected('forbidden', 'Você não pode alterar esta notificação.');
  await ctx.db.update(notifications).set({ readAt: ctx.now }).where(eq(notifications.id, current.id));
  const record = { ...current, readAt: ctx.now };
  await addChange(ctx, { entityType: 'notification', entityId: current.id, op: 'upsert', record, version: null, audienceUserIds: [ctx.actorId] });
  return applied(null, record);
}

async function handleMember(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  const rows = await ctx.db.select().from(routineMembers).where(eq(routineMembers.id, operation.entityId));
  const member = rows[0];
  if (!member) return rejected('not_found', 'O participante não foi encontrado.');
  const role = await memberRole(ctx.db, member.routineId, ctx.actorId);
  if (!canManageRoutine(role)) return rejected('forbidden', 'Somente o proprietário pode remover participantes.');
  if (member.role === 'owner') return rejected('forbidden', 'O proprietário não pode ser removido.');
  await ctx.db.delete(routineMembers).where(eq(routineMembers.id, member.id));
  const audience = [...new Set([...(await memberIds(ctx.db, member.routineId)), member.userId])];
  await addChange(ctx, { entityType: 'member', entityId: member.id, op: 'delete', record: { id: member.id, userId: member.userId, routineId: member.routineId }, version: null, audienceUserIds: audience });
  await audit(ctx, 'member.delete', 'member', member.id);
  return applied(null, { id: member.id });
}

async function dispatch(ctx: SyncContext, operation: SyncOperationInput): Promise<OperationResult> {
  if (operation.entityType === 'activity') return handleActivity(ctx, operation);
  if (operation.entityType === 'routine') return handleRoutine(ctx, operation);
  if (operation.entityType === 'schedule') return handleSchedule(ctx, operation);
  if (operation.entityType === 'invitation') return handleInvitation(ctx, operation);
  if (operation.entityType === 'proposal' || operation.entityType === 'conflict') return handleProposal(ctx, operation);
  if (operation.entityType === 'notification') return handleNotification(ctx, operation);
  if (operation.entityType === 'member') return handleMember(ctx, operation);
  return rejected('validation', 'Tipo de operação desconhecido.');
}

export async function executeOperation(db: Database, actorId: string, operationInput: SyncOperationInput): Promise<OperationResult> {
  const parsed = syncOperationSchema.safeParse(operationInput);
  if (!parsed.success) return rejected('validation', zodMessage(parsed.error));
  const operation = parsed.data as SyncOperationInput;
  try {
    const outcome = await db.transaction(async (tx) => {
      const ctx: SyncContext = {
        db: tx as unknown as Database,
        actorId,
        now: new Date().toISOString(),
        audience: new Set<string>(),
      };
      const existing = await ctx.db.select().from(syncOperations).where(eq(syncOperations.id, operation.id));
      if (existing[0]) return { result: existing[0].result as OperationResult, audience: [] as string[] };
      const result = await dispatch(ctx, operation);
      await ctx.db.insert(syncOperations).values({
        id: operation.id,
        clientId: operation.clientId,
        actorId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        operationType: operation.operationType,
        payload: operation.payload ?? {},
        baseVersion: operation.baseVersion,
        status: result.status,
        result,
        createdAt: ctx.now,
      });
      return { result, audience: [...ctx.audience] };
    });
    await publishSync(outcome.audience);
    return outcome.result;
  } catch (error) {
    if (error instanceof AppError) return rejected(error.code, error.message);
    console.error(error instanceof Error ? error.message : 'operation failed');
    return rejected('internal', 'Não foi possível aplicar a operação.');
  }
}

export async function pullChanges(db: Database, userId: string, cursor: number) {
  const rows = await db
    .select()
    .from(changeLog)
    .where(and(gt(changeLog.seq, cursor), arrayContains(changeLog.audienceUserIds, [userId])))
    .orderBy(changeLog.seq)
    .limit(200);
  const changes = rows.map((row) => ({
    seq: Number(row.seq),
    entityType: row.entityType,
    entityId: row.entityId,
    op: row.op as 'upsert' | 'delete',
    record: row.record,
    version: row.version,
    actorId: row.actorId,
  }));
  return {
    changes,
    cursor: changes.at(-1)?.seq ?? cursor,
    hasMore: rows.length === 200,
  };
}

export async function retentionReport(db: Database, userId: string) {
  const memberships = await db.select().from(routineMembers).where(eq(routineMembers.userId, userId));
  const reports = [];
  for (const membership of memberships) {
    const routineRows = await db.select().from(routines).where(eq(routines.id, membership.routineId));
    const routine = routineRows[0];
    if (!routine || routine.deletedAt) continue;
    const scheduleRows = await db.select().from(schedules).where(eq(schedules.routineId, routine.id));
    const openConflicts = await db.select().from(conflicts).where(and(eq(conflicts.routineId, routine.id), eq(conflicts.status, 'open')));
    const pendingConflicts = await db.select().from(conflicts).where(and(eq(conflicts.routineId, routine.id), eq(conflicts.status, 'proposal_pending')));
    const conflictIds = [...openConflicts, ...pendingConflicts].flatMap((conflict) => conflict.affectedScheduleIds);
    const plan = planRetention({
      schedules: scheduleRows.map((row) => ({ id: row.id, startAt: toSnapshot(row).startAt, deletedAt: asDeleted(row.deletedAt) })),
      pendingEntityIds: [],
      conflictEntityIds: conflictIds,
      now: new Date(),
      timeZone: routine.timezone,
    });
    reports.push({
      routineId: routine.id,
      name: routine.name,
      timezone: routine.timezone,
      operational: plan.operational.length,
      archiveEligible: plan.archiveEligible.length,
      blocked: plan.blocked.length,
    });
  }
  return { deletion: retentionDeletionPolicy(), routines: reports };
}

function asDeleted(value: string | null): string | null {
  return value;
}
