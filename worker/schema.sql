-- Usage-measurement schema for havc-explorer.
-- Apply with: npx wrangler d1 execute havc-explorer-db --remote --file=worker/schema.sql

-- Append-only ingest buffer: one row per beacon flush, not one row per event.
-- Raw rows are retained for 30 days. Each authenticated /stats visit atomically
-- refreshes completed days in usage_daily, then performs retention cleanup.
-- There is deliberately no cron.
CREATE TABLE IF NOT EXISTS usage_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,             -- epoch ms, server-assigned
  day      TEXT    NOT NULL,             -- 'YYYY-MM-DD' Europe/Zagreb, server-assigned
  session  TEXT    NOT NULL,             -- in-memory tab id; disappears with the tab
  country  TEXT,                         -- from request.cf.country
  device   TEXT,                         -- 'mobile' | 'tablet' | 'desktop'
  ref_host TEXT,                         -- referrer host only, never a full URL
  payload  TEXT    NOT NULL              -- JSON array of validated {n,d,p,v,t} events
);
CREATE INDEX IF NOT EXISTS idx_usage_events_day ON usage_events(day);

-- Permanent daily archive. A completed day is replaced from its retained raw
-- source, making retries and concurrent /stats visits idempotent. Rows are
-- never pruned.
CREATE TABLE IF NOT EXISTS usage_daily (
  day   TEXT    NOT NULL,
  event TEXT    NOT NULL,
  dim   TEXT    NOT NULL DEFAULT '',
  val   TEXT    NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, dim, val)
);

CREATE TABLE IF NOT EXISTS usage_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
