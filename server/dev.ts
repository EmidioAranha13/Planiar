import { createServer } from 'node:http';
import { getDatabase, getDatabaseMode, setDatabase } from './database/client';
import { createPgliteDatabase } from './database/pglite';
import { handleNodeRequest } from './http/node';
import { loadEnv } from './loadEnv';

loadEnv();

const port = Number(process.env.PORT ?? 8787);

if (!process.env.DATABASE_URL) {
  const database = await createPgliteDatabase('.data/pglite');
  setDatabase(database, 'pglite');
  console.log('Desenvolvimento usando PGlite em .data/pglite. Para produção, defina DATABASE_URL.');
} else {
  await getDatabase();
  console.log(`PostgreSQL conectado (${getDatabaseMode()}).`);
}

createServer((req, res) => {
  void handleNodeRequest(req, res);
}).listen(port, () => {
  console.log(`API do Planiar em http://localhost:${port}`);
});
