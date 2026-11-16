import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './client';
import { schema } from './schema';
import { MIGRATION_SQL } from './sql';

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  await client.exec(MIGRATION_SQL);
  return drizzle(client, { schema }) as unknown as Database;
}
