import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, 'migrations');
const rpcFolder = path.join(here, '..', 'sql', 'rpc');

async function applyRpcFunctions() {
  const files = readdirSync(rpcFolder)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(path.join(rpcFolder, file), 'utf8');
    console.log(`[db:migrate] applying ${file}`);
    await pool.query(sql);
  }
}

async function main() {
  console.log('[db:migrate] running Drizzle migrations...');
  await migrate(db, { migrationsFolder });
  console.log('[db:migrate] applying RPC SQL files...');
  await applyRpcFunctions();
  console.log('[db:migrate] done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[db:migrate] failed:', err);
  process.exit(1);
});
