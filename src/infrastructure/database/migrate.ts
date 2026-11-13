import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDatabase, db } from './client.ts';
import { logger } from '../observability/logger.ts';

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('database_migrations_applied');
} finally {
  await closeDatabase();
}
