-- Usage-measurement schema for havc-explorer.
-- Apply with: npx wrangler d1 execute havc-explorer-db --remote --file=worker/schema.sql

-- Append-only ingest buffer: ONE row per beacon flush (a batch of events), not
-- one row per event. A session produces ~2-3 flushes, keeping writes far below
-- the 100k rows/day free-tier cap. Rows older than today are folded into
-- usage_daily and deleted by the compaction that runs on /stats visits.
CREATE TABLE IF NOT EXISTS usage_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,             -- epoch ms, server-assigned
  day      TEXT    NOT NULL,             -- 'YYYY-MM-DD' UTC, server-assigned
  session  TEXT    NOT NULL,             -- in-memory tab id; meaningless once the tab closes
  country  TEXT,                         -- from request.cf.country
  device   TEXT,                         -- 'mobile' | 'tablet' | 'desktop'
  ref_host TEXT,                         -- referrer HOST only, never a full URL
  payload  TEXT    NOT NULL              -- JSON array of {n,d,v,t} events
);
CREATE INDEX IF NOT EXISTS idx_usage_events_day ON usage_events(day);

-- Permanent aggregate archive. Append/increment only; never pruned. This is the
-- long-term record — D1 has no retention window, unlike Analytics Engine's 90 days.
CREATE TABLE IF NOT EXISTS usage_daily (
  day   TEXT    NOT NULL,
  event TEXT    NOT NULL,                -- event name, or 'session' for session-level aggregates
  dim   TEXT    NOT NULL DEFAULT '',     -- 'lang' | 'view' | 'country' | 'device' | 'ref_host' | 'chapter' | 'field' | ''
  val   TEXT    NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, dim, val)
);

CREATE TABLE IF NOT EXISTS usage_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
