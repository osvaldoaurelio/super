CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  chain varchar(120) NOT NULL,
  city varchar(120) NOT NULL,
  state varchar(2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stores_location_idx ON stores(state, city);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gtin varchar(14),
  name varchar(240) NOT NULL,
  brand varchar(120),
  category varchar(120) NOT NULL,
  unit varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_gtin_unique ON products(gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_category_name_idx ON products(category, name);

CREATE TABLE IF NOT EXISTS current_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  currency varchar(3) NOT NULL DEFAULT 'BRL',
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT current_prices_product_store_unique UNIQUE(product_id, store_id)
);
CREATE INDEX IF NOT EXISTS current_prices_product_price_idx ON current_prices(product_id, price_cents);
CREATE INDEX IF NOT EXISTS current_prices_store_product_idx ON current_prices(store_id, product_id);

CREATE TABLE IF NOT EXISTS price_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  observed_at timestamptz NOT NULL,
  source varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(observed_at, id),
  UNIQUE(observed_at, idempotency_key)
);
CREATE INDEX IF NOT EXISTS price_history_product_time_idx ON price_history(product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS price_history_store_time_idx ON price_history(store_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  idempotency_key varchar(128) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_events(created_at) WHERE published_at IS NULL;
