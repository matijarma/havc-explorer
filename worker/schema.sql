-- Usage-measurement schema for havc-explorer.
-- Apply with: npx wrangler d1 execute havc-explorer-db --remote --file=worker/schema.sql

-- Append-only ingest buffer: one row per beacon flush, not one row per event.
-- Raw rows are retained for 30 days. Authenticated /stats visits and scheduled
-- maintenance atomically refresh completed days in usage_daily, then perform
-- retention cleanup.
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

-- Permanent Cloudflare edge archive. Cloudflare's adaptive request dataset is
-- queryable for only eight days, so bounded hourly aggregates are copied here
-- and retained indefinitely. No request-level edge data is stored.
CREATE TABLE IF NOT EXISTS edge_hourly (
  hour_utc      TEXT    PRIMARY KEY,     -- normalized ISO UTC hour
  request_count INTEGER NOT NULL DEFAULT 0,
  visit_count   INTEGER NOT NULL DEFAULT 0,
  synced_at     INTEGER NOT NULL         -- epoch ms
);

CREATE TABLE IF NOT EXISTS edge_browser_hourly (
  hour_utc      TEXT    NOT NULL,
  browser       TEXT    NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  visit_count   INTEGER NOT NULL DEFAULT 0,
  synced_at     INTEGER NOT NULL,
  PRIMARY KEY (hour_utc, browser)
);

CREATE TABLE IF NOT EXISTS edge_sync_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Private review notes for the HAVC application dossier. These are readable
-- only through the Access-protected /prijava API and are intentionally kept
-- separate from anonymous usage analytics.
CREATE TABLE IF NOT EXISTS application_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item       TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_notes_item_created
  ON application_notes(item, created_at DESC);
