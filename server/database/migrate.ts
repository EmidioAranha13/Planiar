import { getDatabase } from './client';
import { loadEnv } from '../loadEnv';

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL para aplicar a migração no PostgreSQL.');
  process.exit(1);
}

await getDatabase();
console.log('Migração aplicada.');
