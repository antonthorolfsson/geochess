import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Both drivers expose the same query builder, so the rest of the server is written against the
 * node-postgres type and the embedded PGlite database is used through it.
 */
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/**
 * Opens Postgres when `url` is set, otherwise an embedded PGlite database stored in `dataDir`
 * (or held in memory when `dataDir` is null). Applies pending migrations either way.
 */
export async function openDatabase(opts: { url?: string; dataDir: string | null }): Promise<Database> {
  const migrationsFolder = resolveMigrationsDir();

  if (opts.url) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url });
    const db = drizzle({ client: pool, schema });
    await migrate(db, { migrationsFolder });
    return { db, kind: 'postgres', close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.dataDir) mkdirSync(path.dirname(path.resolve(opts.dataDir)), { recursive: true });
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'drizzle'),
    fileURLToPath(new URL('../../drizzle', import.meta.url)), // running from src/db
    fileURLToPath(new URL('../drizzle', import.meta.url)), // running from the dist bundle
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, 'meta', '_journal.json')));
  if (!found) throw new Error(`Database migrations not found; looked in ${candidates.join(', ')}`);
  return found;
}
