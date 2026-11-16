import { z } from 'zod';
import { hexColorSchema } from './auth';

export const activityInputSchema = z.object({
  title: z.string().trim().min(1, 'Informe o título da atividade.').max(80),
  description: z.string().trim().max(2000).optional(),
  color: hexColorSchema,
});

export const routineInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da rotina.').max(80),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['personal', 'shared']).optional(),
  color: hexColorSchema.nullable().optional(),
  timezone: z.string().trim().min(1).max(80),
  overlapPolicy: z.enum(['allow', 'conflict']).optional(),
});

export const routineUpdateSchema = routineInputSchema.partial();

export const scheduleInputSchema = z.object({
  routineId: z.uuid(),
  activityId: z.uuid(),
  startAt: z.string().min(10),
  endAt: z.string().min(10),
  timezone: z.string().trim().min(1).max(80),
});

export const scheduleUpdateSchema = z.object({
  startAt: z.string().min(10),
  endAt: z.string().min(10),
  activityId: z.uuid().optional(),
});

export const deleteScopeSchema = z.object({
  scope: z.enum(['one', 'day', 'week', 'month']),
  anchorScheduleId: z.uuid(),
  activityId: z.uuid(),
  routineId: z.uuid(),
  timezone: z.string().min(1),
  anchorStartAt: z.string().min(10),
  expected: z.array(z.object({ id: z.uuid(), baseVersion: z.number().int() })).min(1),
});

export const invitationInputSchema = z.object({
  routineId: z.uuid(),
  username: z.string().trim().min(3).max(30).transform((value) => value.toLowerCase()),
});

export const invitationResponseSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'cancelled']),
});

export const proposalChangesSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep'), choice: z.enum(['server', 'proposed']) }),
  z.object({
    action: z.literal('reschedule'),
    scheduleId: z.uuid(),
    startAt: z.string().min(10),
    endAt: z.string().min(10),
  }),
  z.object({ action: z.literal('delete'), scheduleId: z.uuid() }),
  z.object({ action: z.literal('delete_all') }),
]);

export const syncOperationSchema = z.object({
  id: z.uuid(),
  clientId: z.string().min(8).max(80),
  entityType: z.enum([
    'activity',
    'routine',
    'schedule',
    'invitation',
    'member',
    'conflict',
    'proposal',
    'notification',
    'profile',
  ]),
  entityId: z.uuid(),
  operationType: z.enum([
    'create',
    'update',
    'delete',
    'delete_scope',
    'respond',
    'propose',
    'respond_proposal',
    'mark_read',
  ]),
  payload: z.unknown(),
  baseVersion: z.number().int().nullable(),
  baseSnapshot: z.unknown().nullable().optional(),
  knownScheduleVersions: z.record(z.string(), z.number().int()).optional(),
  createdAt: z.string(),
});

export const pushRequestSchema = z.object({
  operations: z.array(syncOperationSchema).max(50),
});

export const pullRequestSchema = z.object({
  cursor: z.number().int().min(0).default(0),
});

export const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  userId: z.uuid(),
  activities: z.array(z.unknown()),
  routines: z.array(z.unknown()),
  schedules: z.array(z.unknown()),
  conflicts: z.array(z.unknown()),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;
export type RoutineInput = z.infer<typeof routineInputSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
