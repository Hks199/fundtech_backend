CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_id_format CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$')
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase', 'sale')),
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  event_id UUID NOT NULL UNIQUE REFERENCES processed_events(event_id),
  original_quantity INTEGER NOT NULL CHECK (original_quantity > 0),
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= original_quantity),
  unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_batches_fifo_idx
  ON inventory_batches(product_id, occurred_at, id) WHERE remaining_quantity > 0;

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  event_id UUID NOT NULL UNIQUE REFERENCES processed_events(event_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_cost NUMERIC(30, 4) NOT NULL CHECK (total_cost >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_product_time_idx ON sales(product_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS sale_allocations (
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  batch_id BIGINT NOT NULL REFERENCES inventory_batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
  cost NUMERIC(30, 4) NOT NULL CHECK (cost >= 0),
  PRIMARY KEY (sale_id, batch_id)
);
