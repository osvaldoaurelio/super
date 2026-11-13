import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../../src/infrastructure/database/client.ts';

let initialized = false;
export async function runIntegrationSetup(): Promise<void> {
  if (initialized) return;
  await migrate(db, { migrationsFolder: './drizzle' });
  initialized = true;
}
