import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { fileDatasetProvider } from './datasets';
import { openDatabase } from './db/client';
import { loadEnv } from './env';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = loadEnv();

const database = await openDatabase({ url: env.DATABASE_URL, dataDir: env.DATA_DIR });
const app = await buildApp({ db: database.db, env, datasets: fileDatasetProvider() });

await app.listen({ host: env.HOST, port: env.PORT });
app.log.info(
  `Game server ready on port ${env.PORT} (${database.kind === 'pglite' ? `embedded database in ${env.DATA_DIR}` : 'Postgres'}${env.devLogin ? ', dev sign-in enabled' : ''})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await database.close();
    process.exit(0);
  });
}
