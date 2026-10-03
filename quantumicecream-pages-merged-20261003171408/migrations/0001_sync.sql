CREATE TABLE IF NOT EXISTS sync_meta (
  user_id TEXT PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_entities (
  user_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  client_updated_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  payload TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, collection, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_entities_cursor
  ON sync_entities (user_id, revision);

CREATE TABLE IF NOT EXISTS sync_ops (
  user_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, op_id)
);