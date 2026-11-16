import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ConflictKind,
  DisputeStatus,
  InvitationStatus,
  MemberRole,
  OverlapPolicy,
  ProposalChanges,
  ProposalStatus,
  RoutineType,
} from '../../src/domain/entities/types';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  profileColor: text('profile_color').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  userAgent: text('user_agent'),
  ip: text('ip'),
});

export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull(),
});

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    description: text('description').notNull().default(''),
    color: text('color').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('activities_owner_title_active')
      .on(table.ownerId, table.normalizedTitle)
      .where(sql`deleted_at is null`),
  ],
);

export const routines = pgTable('routines', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  type: text('type').$type<RoutineType>().notNull(),
  color: text('color'),
  timezone: text('timezone').notNull(),
  overlapPolicy: text('overlap_policy').$type<OverlapPolicy>().notNull(),
  version: integer('version').notNull(),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

export const routineMembers = pgTable(
  'routine_members',
  {
    id: uuid('id').primaryKey(),
    routineId: uuid('routine_id').notNull().references(() => routines.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').$type<MemberRole>().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('routine_members_unique').on(table.routineId, table.userId)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey(),
    routineId: uuid('routine_id').notNull().references(() => routines.id),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'string' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'string' }).notNull(),
    timezone: text('timezone').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    updatedBy: uuid('updated_by').notNull().references(() => users.id),
    updatedByName: text('updated_by_name').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index('schedules_routine_idx').on(table.routineId, table.startAt)],
);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  routineId: uuid('routine_id').notNull().references(() => routines.id),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  recipientId: uuid('recipient_id').notNull().references(() => users.id),
  status: text('status').$type<InvitationStatus>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'string' }),
});

export const conflicts = pgTable('conflicts', {
  id: uuid('id').primaryKey(),
  routineId: uuid('routine_id').notNull().references(() => routines.id),
  kind: text('kind').$type<ConflictKind>().notNull(),
  affectedScheduleIds: jsonb('affected_schedule_ids').$type<string[]>().notNull(),
  involvedUserIds: jsonb('involved_user_ids').$type<string[]>().notNull(),
  baseState: jsonb('base_state').notNull(),
  proposedState: jsonb('proposed_state').notNull(),
  serverState: jsonb('server_state').notNull(),
  status: text('status').$type<DisputeStatus>().notNull(),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
});

export const conflictProposals = pgTable('conflict_proposals', {
  id: uuid('id').primaryKey(),
  conflictId: uuid('conflict_id').notNull().references(() => conflicts.id),
  proposerId: uuid('proposer_id').notNull().references(() => users.id),
  proposedChanges: jsonb('proposed_changes').$type<ProposalChanges>().notNull(),
  status: text('status').$type<ProposalStatus>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'string' }),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

export const syncOperations = pgTable('sync_operations', {
  id: uuid('id').primaryKey(),
  clientId: text('client_id').notNull(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  operationType: text('operation_type').notNull(),
  payload: jsonb('payload').notNull(),
  baseVersion: integer('base_version'),
  status: text('status').notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const changeLog = pgTable('change_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  op: text('op').notNull(),
  record: jsonb('record').notNull(),
  version: integer('version'),
  actorId: uuid('actor_id'),
  audienceUserIds: uuid('audience_user_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const mediaObjects = pgTable('media_objects', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  ciphertext: text('ciphertext').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const schema = {
  users,
  sessions,
  passwordResets,
  rateLimits,
  activities,
  routines,
  routineMembers,
  schedules,
  invitations,
  conflicts,
  conflictProposals,
  notifications,
  syncOperations,
  changeLog,
  auditLog,
  mediaObjects,
};
