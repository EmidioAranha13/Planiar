import type {
  Activity,
  ConflictProposal,
  CurrentUser,
  DeleteScope,
  Invitation,
  ProposalChanges,
  PublicProfile,
  Routine,
  RoutineMember,
  Schedule,
} from '../../domain/entities/types';
import { schedulesInScope } from '../../domain/rules/deletion';
import { findDuplicateActivity, normalizeTitle } from '../../domain/rules/title';
import { normalizeScheduleRange } from '../../domain/rules/time';
import { getUserDb, type LocalOperation, type PlaniarDB } from '../dexie/database';

export function getClientId(): string {
  if (typeof localStorage === 'undefined') return 'test-client-0001';
  const existing = localStorage.getItem('planiar.clientId');
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem('planiar.clientId', created);
  return created;
}

function operation(input: Omit<LocalOperation, 'status' | 'retryCount' | 'lastError' | 'clientId' | 'createdAt'>): LocalOperation {
  return {
    ...input,
    clientId: getClientId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    baseSnapshot: input.baseSnapshot ?? null,
  };
}

async function knownVersions(db: PlaniarDB, routineId: string): Promise<Record<string, number>> {
  const rows = await db.schedules.where('routineId').equals(routineId).toArray();
  return Object.fromEntries(rows.filter((row) => !row.deletedAt).map((row) => [row.id, row.version]));
}

export async function seedAccount(userId: string, routine: Routine, member: RoutineMember, profile: PublicProfile): Promise<void> {
  const db = getUserDb(userId);
  await db.transaction('rw', [db.routines, db.members, db.profiles], async () => {
    await db.routines.put(routine);
    await db.members.put(member);
    await db.profiles.put(profile);
  });
}

export async function createActivity(
  userId: string,
  input: { title: string; description?: string; color: string },
): Promise<{ ok: true; activity: Activity } | { ok: false; code: 'duplicate' | 'validation'; activity?: Activity; message: string }> {
  const db = getUserDb(userId);
  const title = input.title.trim().replace(/\s+/g, ' ');
  if (!title) return { ok: false, code: 'validation', message: 'Informe o título da atividade.' };
  const activities = await db.activities.toArray();
  const duplicate = findDuplicateActivity(activities, title);
  if (duplicate) return { ok: false, code: 'duplicate', activity: duplicate, message: 'Você já tem uma atividade com este título.' };
  const now = new Date().toISOString();
  const activity: Activity = {
    id: crypto.randomUUID(),
    ownerId: userId,
    title,
    normalizedTitle: normalizeTitle(title),
    description: input.description?.trim() ?? '',
    color: input.color,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'activity',
    entityId: activity.id,
    operationType: 'create',
    payload: { title, description: activity.description, color: activity.color },
    baseVersion: null,
    baseSnapshot: null,
  });
  await db.transaction('rw', [db.activities, db.operations], async () => {
    await db.activities.add(activity);
    await db.operations.add(op);
  });
  return { ok: true, activity };
}

export async function updateActivity(
  userId: string,
  activityId: string,
  input: { title: string; description?: string; color: string },
): Promise<{ ok: true; activity: Activity } | { ok: false; code: 'duplicate' | 'not_found'; activity?: Activity; message: string }> {
  const db = getUserDb(userId);
  const current = await db.activities.get(activityId);
  if (!current || current.deletedAt) return { ok: false, code: 'not_found', message: 'Atividade não encontrada.' };
  const title = input.title.trim().replace(/\s+/g, ' ');
  const activities = await db.activities.toArray();
  const duplicate = findDuplicateActivity(activities, title, activityId);
  if (duplicate) return { ok: false, code: 'duplicate', activity: duplicate, message: 'Você já tem uma atividade com este título.' };
  const activity: Activity = {
    ...current,
    title,
    normalizedTitle: normalizeTitle(title),
    description: input.description?.trim() ?? '',
    color: input.color,
    updatedAt: new Date().toISOString(),
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'activity',
    entityId: activity.id,
    operationType: 'update',
    payload: { title, description: activity.description, color: activity.color },
    baseVersion: current.version,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.activities, db.operations], async () => {
    await db.activities.put(activity);
    await db.operations.add(op);
  });
  return { ok: true, activity };
}

export async function deleteActivity(userId: string, activityId: string): Promise<{ ok: boolean; message?: string }> {
  const db = getUserDb(userId);
  const current = await db.activities.get(activityId);
  if (!current || current.deletedAt) return { ok: false, message: 'Atividade não encontrada.' };
  const activity = { ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'activity',
    entityId: activity.id,
    operationType: 'delete',
    payload: {},
    baseVersion: current.version,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.activities, db.operations], async () => {
    await db.activities.put(activity);
    await db.operations.add(op);
  });
  return { ok: true };
}

export async function createRoutine(
  userId: string,
  input: { name: string; description?: string; color?: string | null; timezone: string; overlapPolicy?: 'allow' | 'conflict'; type?: 'personal' | 'shared' },
): Promise<Routine> {
  const db = getUserDb(userId);
  const now = new Date().toISOString();
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: input.name.trim().replace(/\s+/g, ' '),
    description: input.description?.trim() ?? '',
    ownerId: userId,
    type: input.type ?? 'personal',
    color: input.color ?? null,
    timezone: input.timezone,
    overlapPolicy: input.overlapPolicy ?? 'allow',
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const member: RoutineMember = {
    id: crypto.randomUUID(),
    routineId: routine.id,
    userId,
    role: 'owner',
    joinedAt: now,
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'routine',
    entityId: routine.id,
    operationType: 'create',
    payload: {
      name: routine.name,
      description: routine.description,
      type: routine.type,
      color: routine.color,
      timezone: routine.timezone,
      overlapPolicy: routine.overlapPolicy,
    },
    baseVersion: null,
    baseSnapshot: null,
  });
  await db.transaction('rw', [db.routines, db.members, db.operations], async () => {
    await db.routines.add(routine);
    await db.members.add(member);
    await db.operations.add(op);
  });
  return routine;
}

export async function updateRoutine(userId: string, routineId: string, patch: Partial<Routine>): Promise<Routine | null> {
  const db = getUserDb(userId);
  const current = await db.routines.get(routineId);
  if (!current || current.deletedAt) return null;
  const routine: Routine = {
    ...current,
    ...patch,
    id: current.id,
    ownerId: current.ownerId,
    updatedAt: new Date().toISOString(),
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'routine',
    entityId: routine.id,
    operationType: 'update',
    payload: {
      name: routine.name,
      description: routine.description,
      type: routine.type,
      color: routine.color,
      timezone: routine.timezone,
      overlapPolicy: routine.overlapPolicy,
    },
    baseVersion: current.version,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.routines, db.operations], async () => {
    await db.routines.put(routine);
    await db.operations.add(op);
  });
  return routine;
}

export async function deleteRoutine(userId: string, routineId: string): Promise<boolean> {
  const db = getUserDb(userId);
  const current = await db.routines.get(routineId);
  if (!current) return false;
  const routine = { ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'routine',
    entityId: routine.id,
    operationType: 'delete',
    payload: {},
    baseVersion: current.version,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.routines, db.operations], async () => {
    await db.routines.put(routine);
    await db.operations.add(op);
  });
  return true;
}

export async function createSchedule(
  userId: string,
  input: { routineId: string; activityId: string; startAt: string; endAt: string; timezone: string; updatedByName: string },
): Promise<{ ok: true; schedule: Schedule } | { ok: false; message: string }> {
  const range = normalizeScheduleRange(input.startAt, input.endAt, input.timezone);
  if (!range.ok) return { ok: false, message: range.message };
  const db = getUserDb(userId);
  const now = new Date().toISOString();
  const schedule: Schedule = {
    id: crypto.randomUUID(),
    routineId: input.routineId,
    activityId: input.activityId,
    startAt: range.startAt,
    endAt: range.endAt,
    timezone: input.timezone,
    createdBy: userId,
    updatedBy: userId,
    updatedByName: input.updatedByName,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'schedule',
    entityId: schedule.id,
    operationType: 'create',
    payload: {
      routineId: schedule.routineId,
      activityId: schedule.activityId,
      startAt: schedule.startAt,
      endAt: schedule.endAt,
      timezone: schedule.timezone,
    },
    baseVersion: null,
    baseSnapshot: null,
    knownScheduleVersions: await knownVersions(db, input.routineId),
  });
  await db.transaction('rw', [db.schedules, db.operations], async () => {
    await db.schedules.add(schedule);
    await db.operations.add(op);
  });
  return { ok: true, schedule };
}

export async function updateSchedule(
  userId: string,
  scheduleId: string,
  input: { startAt: string; endAt: string; activityId?: string },
): Promise<{ ok: true; schedule: Schedule } | { ok: false; message: string }> {
  const db = getUserDb(userId);
  const current = await db.schedules.get(scheduleId);
  if (!current || current.deletedAt) return { ok: false, message: 'Agendamento não encontrado.' };
  const range = normalizeScheduleRange(input.startAt, input.endAt, current.timezone);
  if (!range.ok) return { ok: false, message: range.message };
  const schedule: Schedule = {
    ...current,
    activityId: input.activityId ?? current.activityId,
    startAt: range.startAt,
    endAt: range.endAt,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'schedule',
    entityId: schedule.id,
    operationType: 'update',
    payload: { startAt: schedule.startAt, endAt: schedule.endAt, activityId: schedule.activityId },
    baseVersion: current.version,
    baseSnapshot: current,
    knownScheduleVersions: await knownVersions(db, current.routineId),
  });
  await db.transaction('rw', [db.schedules, db.operations], async () => {
    await db.schedules.put(schedule);
    await db.operations.add(op);
  });
  return { ok: true, schedule };
}

export async function deleteSchedules(
  userId: string,
  input: { anchorId: string; scope: DeleteScope },
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const db = getUserDb(userId);
  const anchor = await db.schedules.get(input.anchorId);
  if (!anchor || anchor.deletedAt) return { ok: false, message: 'Agendamento não encontrado.' };
  const routine = await db.routines.get(anchor.routineId);
  const timezone = routine?.timezone ?? anchor.timezone;
  const all = await db.schedules.where('routineId').equals(anchor.routineId).toArray();
  const matched = schedulesInScope({
    schedules: all,
    anchor,
    scope: input.scope,
    timeZone: timezone,
  });
  if (matched.length === 0) return { ok: false, message: 'Nenhum agendamento encontrado nesse período.' };
  const now = new Date().toISOString();
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'schedule',
    entityId: anchor.id,
    operationType: 'delete_scope',
    payload: {
      scope: input.scope,
      anchorScheduleId: anchor.id,
      activityId: anchor.activityId,
      routineId: anchor.routineId,
      timezone,
      anchorStartAt: anchor.startAt,
      expected: matched.map((item) => ({ id: item.id, baseVersion: item.version })),
    },
    baseVersion: anchor.version,
    baseSnapshot: anchor,
    knownScheduleVersions: await knownVersions(db, anchor.routineId),
  });
  await db.transaction('rw', [db.schedules, db.operations], async () => {
    for (const item of matched) {
      const current = all.find((schedule) => schedule.id === item.id);
      if (!current) continue;
      await db.schedules.put({ ...current, deletedAt: now, updatedAt: now, updatedBy: userId });
    }
    await db.operations.add(op);
  });
  return { ok: true, count: matched.length };
}

export async function inviteMember(userId: string, routineId: string, username: string): Promise<Invitation> {
  const db = getUserDb(userId);
  const invitation: Invitation = {
    id: crypto.randomUUID(),
    routineId,
    senderId: userId,
    recipientId: 'pending',
    status: 'pending',
    createdAt: new Date().toISOString(),
    respondedAt: null,
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'invitation',
    entityId: invitation.id,
    operationType: 'create',
    payload: { routineId, username },
    baseVersion: null,
    baseSnapshot: null,
  });
  await db.transaction('rw', [db.invitations, db.operations], async () => {
    await db.invitations.add(invitation);
    await db.operations.add(op);
  });
  return invitation;
}

export async function respondInvitation(userId: string, invitationId: string, status: 'accepted' | 'rejected' | 'cancelled'): Promise<void> {
  const db = getUserDb(userId);
  const current = await db.invitations.get(invitationId);
  if (!current) return;
  const invitation = { ...current, status, respondedAt: new Date().toISOString() };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'invitation',
    entityId: invitation.id,
    operationType: 'respond',
    payload: { status },
    baseVersion: null,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.invitations, db.operations, db.members], async () => {
    await db.invitations.put(invitation);
    if (status === 'accepted' && current.recipientId === userId) {
      const existing = await db.members.where('routineId').equals(current.routineId).filter((member) => member.userId === userId).first();
      if (!existing) {
        await db.members.add({
          id: crypto.randomUUID(),
          routineId: current.routineId,
          userId,
          role: 'editor',
          joinedAt: invitation.respondedAt ?? new Date().toISOString(),
        });
      }
    }
    await db.operations.add(op);
  });
}

export async function proposeResolution(userId: string, conflictId: string, changes: ProposalChanges): Promise<ConflictProposal> {
  const db = getUserDb(userId);
  const proposal: ConflictProposal = {
    id: crypto.randomUUID(),
    conflictId,
    proposerId: userId,
    proposedChanges: changes,
    status: 'pending',
    createdAt: new Date().toISOString(),
    respondedAt: null,
  };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'proposal',
    entityId: proposal.id,
    operationType: 'propose',
    payload: { conflictId, changes },
    baseVersion: null,
    baseSnapshot: null,
  });
  const conflict = await db.conflicts.get(conflictId);
  await db.transaction('rw', [db.proposals, db.conflicts, db.operations], async () => {
    await db.proposals.add(proposal);
    if (conflict) await db.conflicts.put({ ...conflict, status: 'proposal_pending', updatedAt: proposal.createdAt });
    await db.operations.add(op);
  });
  return proposal;
}

export async function respondProposal(userId: string, proposalId: string, decision: 'accepted' | 'rejected'): Promise<void> {
  const db = getUserDb(userId);
  const current = await db.proposals.get(proposalId);
  if (!current) return;
  const proposal = { ...current, status: decision, respondedAt: new Date().toISOString() };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'proposal',
    entityId: proposal.id,
    operationType: 'respond_proposal',
    payload: { decision },
    baseVersion: null,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.proposals, db.conflicts, db.operations], async () => {
    await db.proposals.put(proposal);
    const conflict = await db.conflicts.get(current.conflictId);
    if (conflict) {
      await db.conflicts.put({
        ...conflict,
        status: decision === 'accepted' ? 'resolved' : 'open',
        updatedAt: proposal.respondedAt ?? conflict.updatedAt,
      });
    }
    await db.operations.add(op);
  });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const db = getUserDb(userId);
  const current = await db.notifications.get(notificationId);
  if (!current || current.readAt) return;
  const notification = { ...current, readAt: new Date().toISOString() };
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'notification',
    entityId: notification.id,
    operationType: 'mark_read',
    payload: {},
    baseVersion: null,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.notifications, db.operations], async () => {
    await db.notifications.put(notification);
    await db.operations.add(op);
  });
}

export async function removeMember(userId: string, memberId: string): Promise<void> {
  const db = getUserDb(userId);
  const current = await db.members.get(memberId);
  if (!current) return;
  const op = operation({
    id: crypto.randomUUID(),
    entityType: 'member',
    entityId: memberId,
    operationType: 'delete',
    payload: {},
    baseVersion: null,
    baseSnapshot: current,
  });
  await db.transaction('rw', [db.members, db.operations], async () => {
    await db.members.delete(memberId);
    await db.operations.add(op);
  });
}

export function profileFromUser(user: CurrentUser): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    profileColor: user.profileColor,
    avatarUrl: user.avatarUrl,
  };
}
