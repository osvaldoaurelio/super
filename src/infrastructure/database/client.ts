import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../../config/env.ts';
import * as schema from './schema.ts';

export const sqlClient = postgres(env.DATABASE_URL, {
  max: 10,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(sqlClient, { schema });
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
let closed = false;
export async function closeDatabase(): Promise<void> {
  if (closed) return;
  closed = true;
  await sqlClient.end();
}
