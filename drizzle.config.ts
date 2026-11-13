import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://super:super@localhost:5432/super',
  },
  migrations: { table: '__drizzle_migrations_super_api', schema: 'public' },
  strict: true,
  verbose: true,
});
