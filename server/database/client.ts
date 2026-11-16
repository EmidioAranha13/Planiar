import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { AppError } from '../http/errors';
import { schema } from './schema';
import { MIGRATION_SQL } from './sql';

export type Database = PostgresJsDatabase<typeof schema>;

type DatabaseMode = 'postgres' | 'pglite' | 'unconfigured';

let current: Database | null = null;
let mode: DatabaseMode = 'unconfigured';

export function getDatabaseMode(): DatabaseMode {
  return mode;
}

export function setDatabase(database: Database, nextMode: Exclude<DatabaseMode, 'unconfigured'>): void {
  current = database;
  mode = nextMode;
}

export function clearDatabase(): void {
  current = null;
  mode = 'unconfigured';
}

export async function getDatabase(): Promise<Database> {
  if (current) return current;
  const url = process.env.DATABASE_URL;
  if (!url) {
    mode = 'unconfigured';
    throw new AppError(
      503,
      'database_unconfigured',
      'O PostgreSQL não está configurado. Defina DATABASE_URL com a conexão do Neon ou do Supabase.',
    );
  }
  const client = postgres(url, { max: 1 });
  await client.unsafe(MIGRATION_SQL);
  current = drizzle(client, { schema });
  mode = 'postgres';
  return current;
}
