-- Migration number: 0004 	 2026-08-28T00:00:00.000Z

-- Backs the count-pushed-into-the-store fix for the Overview endpoint
-- (routes/overview.ts, Store#countRunsByState / Store#countRunsSince /
-- Store#countIncidentsExcludingStatus): each now runs a `SELECT COUNT(*)
-- ... WHERE` instead of loading every row into the Worker to filter in
-- memory. Without these indexes those COUNT queries (and
-- listRunsByIncident's own WHERE incident_id = ?, which existed before this
-- migration with no index of its own) would still be full table scans.
CREATE INDEX idx_runs_state ON runs (state);
CREATE INDEX idx_runs_created_at ON runs (created_at);
CREATE INDEX idx_runs_incident_id ON runs (incident_id);
