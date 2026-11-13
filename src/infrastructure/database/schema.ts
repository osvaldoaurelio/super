import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
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
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('stores_location_idx').on(table.state, table.city)],
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
    unique('price_history_idempotency_unique').on(table.idempotencyKey),
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
    publishedAt: timestamp('published_at', { withTimezone: true }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull().unique(),
  },
  (table) => [
    index('outbox_unpublished_idx')
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);
