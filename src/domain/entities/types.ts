export type OverlapPolicy = 'allow' | 'conflict';
export type RoutineType = 'personal' | 'shared';
export type MemberRole = 'owner' | 'editor';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type DisputeStatus = 'open' | 'proposal_pending' | 'resolved';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
export type ConflictKind = 'concurrent_edit' | 'delete_vs_edit' | 'relocation' | 'overlap' | 'batch';
export type DeleteScope = 'one' | 'day' | 'week' | 'month';
export type EntityType =
  | 'activity'
  | 'routine'
  | 'schedule'
  | 'invitation'
  | 'member'
  | 'conflict'
  | 'proposal'
  | 'notification'
  | 'profile';
export type OperationType =
  | 'create'
  | 'update'
  | 'delete'
  | 'delete_scope'
  | 'respond'
  | 'propose'
  | 'respond_proposal'
  | 'mark_read';

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  profileColor: string;
  avatarUrl: string | null;
};

export type CurrentUser = PublicProfile & {
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  ownerId: string;
  title: string;
  normalizedTitle: string;
  description: string;
  color: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Routine = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  type: RoutineType;
  color: string | null;
  timezone: string;
  overlapPolicy: OverlapPolicy;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RoutineMember = {
  id: string;
  routineId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
};

export type Schedule = {
  id: string;
  routineId: string;
  activityId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  createdBy: string;
  updatedBy: string;
  updatedByName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ScheduleSnapshot = {
  id: string;
  routineId: string;
  activityId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  version: number;
  deletedAt: string | null;
  updatedBy: string;
  updatedByName: string;
};

export type Invitation = {
  id: string;
  routineId: string;
  senderId: string;
  recipientId: string;
  status: InvitationStatus;
  createdAt: string;
  respondedAt: string | null;
  routineName?: string;
  senderName?: string;
};

export type ProposalChanges =
  | { action: 'keep'; choice: 'server' | 'proposed' }
  | { action: 'reschedule'; scheduleId: string; startAt: string; endAt: string }
  | { action: 'delete'; scheduleId: string }
  | { action: 'delete_all' };

export type ConflictProposal = {
  id: string;
  conflictId: string;
  proposerId: string;
  proposedChanges: ProposalChanges;
  status: ProposalStatus;
  createdAt: string;
  respondedAt: string | null;
};

export type ScheduleConflict = {
  id: string;
  routineId: string;
  kind: ConflictKind;
  affectedScheduleIds: string[];
  involvedUserIds: string[];
  baseState: unknown;
  proposedState: unknown;
  serverState: unknown;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
};

export type AppNotification = {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type SyncOperationInput = {
  id: string;
  clientId: string;
  entityType: EntityType;
  entityId: string;
  operationType: OperationType;
  payload: unknown;
  baseVersion: number | null;
  baseSnapshot?: unknown;
  knownScheduleVersions?: Record<string, number>;
  createdAt: string;
};

export type OperationResult = {
  status: 'applied' | 'conflict' | 'rejected';
  code?: string;
  message?: string;
  version?: number | null;
  conflict?: ScheduleConflict;
  proposals?: ConflictProposal[];
  serverRecord?: unknown;
};

export type RemoteChange = {
  seq: number;
  entityType: EntityType;
  entityId: string;
  op: 'upsert' | 'delete';
  record: unknown;
  version: number | null;
  actorId: string | null;
};

export type HealthStatus = {
  ok: boolean;
  database: 'postgres' | 'pglite' | 'unconfigured';
  emailConfigured: boolean;
  realtimeConfigured: boolean;
  storage: 'postgres' | 'blob';
  mediaEncryption: boolean;
  retentionDeletion: 'disabled';
  app: 'Planiar';
};
