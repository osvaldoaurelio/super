import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check('users_email_lowercase', sql`${table.email} = lower(${table.email})`)],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    chain: varchar('chain', { length: 120 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    state: varchar('state', { length: 2 }).notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('stores_location_idx').on(table.state, table.city),
    index('stores_coordinates_idx').on(table.latitude, table.longitude),
    check(
      'stores_coordinates_pair_check',
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
    check(
      'stores_latitude_bounds_check',
      sql`${table.latitude} is null or ${table.latitude} between -90 and 90`,
    ),
    check(
      'stores_longitude_bounds_check',
      sql`${table.longitude} is null or ${table.longitude} between -180 and 180`,
    ),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gtin: varchar('gtin', { length: 14 }),
    name: varchar('name', { length: 240 }).notNull(),
    brand: varchar('brand', { length: 120 }),
    category: varchar('category', { length: 120 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('products_gtin_unique')
      .on(table.gtin)
      .where(sql`${table.gtin} is not null`),
    index('products_category_name_idx').on(table.category, table.name),
    index('products_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    index('products_brand_trgm_idx').using('gin', table.brand.op('gin_trgm_ops')),
  ],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    targetPriceCents: integer('target_price_cents').notNull(),
    active: boolean('active').default(true).notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
  },
  (table) => [
    index('alerts_user_created_idx').on(table.userId, table.createdAt),
    index('alerts_product_active_idx').on(table.productId, table.active),
    check('alerts_target_price_positive', sql`${table.targetPriceCents} > 0`),
    check('alerts_channel_valid', sql`${table.channel} in ('email', 'push')`),
  ],
);

export const currentPrices = pgTable(
  'current_prices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    priceCents: integer('price_cents').notNull(),
    currency: varchar('currency', { length: 3 }).default('BRL').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('current_prices_product_store_unique').on(table.productId, table.storeId),
    index('current_prices_product_price_idx').on(table.productId, table.priceCents),
    check('current_prices_positive', sql`${table.priceCents} > 0`),
  ],
);

// Append-only observations. Consider monthly range partitioning by observed_at once volume/retention justify it.
export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').defaultRandom().notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    priceCents: integer('price_cents').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    source: varchar('source', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.observedAt, table.id] }),
    unique('price_history_source_idempotency_unique').on(table.source, table.idempotencyKey),
    index('price_history_product_time_idx').on(table.productId, table.observedAt),
    index('price_history_store_time_idx').on(table.storeId, table.observedAt),
    check('price_history_positive', sql`${table.priceCents} > 0`),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: varchar('type', { length: 120 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    status: varchar('status', { length: 16 }).default('pending').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
  },
  (table) => [
    unique('outbox_events_type_idempotency_unique').on(table.type, table.idempotencyKey),
    index('outbox_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check('outbox_attempts_non_negative', sql`${table.attempts} >= 0`),
    check('outbox_status_valid', sql`${table.status} in ('pending', 'processed', 'dead')`),
  ],
);
