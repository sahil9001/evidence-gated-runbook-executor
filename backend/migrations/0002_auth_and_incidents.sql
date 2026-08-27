-- Migration number: 0002 	 2026-08-26T01:37:23.020Z

-- Users: local password auth (PBKDF2 hash + salt live at the auth layer,
-- a later PR). One row per operator; email is the login identifier.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions: opaque bearer id stored in an HttpOnly cookie (a later PR).
-- Revocation is a DELETE; expiry is checked by the caller against
-- expires_at.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);

-- Incidents: first-class entity (a later PR) rather than a string embedded
-- in a run. `signals` is stored as a JSON array of strings, same rationale
-- as `packets.data` — read whole, never queried by individual signal.
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  service TEXT NOT NULL,
  signals TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_incidents_status ON incidents (status);

-- `runs.incident_id` already exists (0001) as a loose string; this formalizes
-- attribution now that `incidents` and `users` are real tables. Nullable
-- because pre-auth runs (this migration's predecessor) have no operator to
-- attribute to, and D1/SQLite's ALTER TABLE cannot add a NOT NULL column
-- without a default to an existing table.
ALTER TABLE runs ADD COLUMN created_by TEXT;

-- `getPacketByIncident` must order deterministically by build time, not by
-- the packet's (effectively random) UUID primary key. Nullable for the
-- same ALTER TABLE reason as above; every row written after this migration
-- populates it (see store/d1.ts#savePacket).
ALTER TABLE packets ADD COLUMN built_at TEXT;

CREATE INDEX idx_packets_incident_built_at ON packets (incident_id, built_at DESC);
