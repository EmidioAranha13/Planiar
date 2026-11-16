export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  profile_color text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  window_start timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  normalized_title text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS activities_owner_title_active
  ON activities (owner_id, normalized_title)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS routines (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  color text,
  timezone text NOT NULL,
  overlap_policy text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS routine_members (
  id uuid PRIMARY KEY,
  routine_id uuid NOT NULL REFERENCES routines(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL,
  UNIQUE (routine_id, user_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY,
  routine_id uuid NOT NULL REFERENCES routines(id),
  activity_id uuid NOT NULL REFERENCES activities(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_by_name text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS schedules_routine_idx ON schedules (routine_id, start_at);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY,
  routine_id uuid NOT NULL REFERENCES routines(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS conflicts (
  id uuid PRIMARY KEY,
  routine_id uuid NOT NULL REFERENCES routines(id),
  kind text NOT NULL,
  affected_schedule_ids jsonb NOT NULL,
  involved_user_ids jsonb NOT NULL,
  base_state jsonb NOT NULL,
  proposed_state jsonb NOT NULL,
  server_state jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS conflict_proposals (
  id uuid PRIMARY KEY,
  conflict_id uuid NOT NULL REFERENCES conflicts(id),
  proposer_id uuid NOT NULL REFERENCES users(id),
  proposed_changes jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at);

CREATE TABLE IF NOT EXISTS sync_operations (
  id uuid PRIMARY KEY,
  client_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation_type text NOT NULL,
  payload jsonb NOT NULL,
  base_version integer,
  status text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  seq bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  op text NOT NULL,
  record jsonb NOT NULL,
  version integer,
  actor_id uuid,
  audience_user_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS media_objects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO schema_migrations (version, applied_at)
SELECT 1, now()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1);
`;
