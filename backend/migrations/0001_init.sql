-- Migration number: 0001 	 2026-08-25T03:06:58.376Z

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  runbook_id TEXT NOT NULL,
  service TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Evidence packets are read whole and validated with `evidencePacketSchema.parse`
-- on the way back out, so the body is stored as opaque JSON rather than being
-- decomposed into columns.
CREATE TABLE packets (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX idx_packets_incident_id ON packets (incident_id);

-- Actions are read whole via `createAction`, so the body is stored as opaque
-- JSON rather than being decomposed into columns.
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Approval gates are a discriminated union (locked/approved/rejected); the
-- whole variant is stored as opaque JSON so the discriminant round-trips
-- exactly as constructed by the domain layer.
CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Append-only audit trail. The PRIMARY KEY on id is the enforcement
-- mechanism: a second insert with the same id fails instead of silently
-- overwriting the original entry. No UPDATE or DELETE statement may ever
-- target this table.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE INDEX idx_audit_log_run_id_at ON audit_log (run_id, at);
