-- Migration number: 0005 	 2026-08-28T00:10:00.000Z

-- 0004 added single-column indexes on runs(state), runs(created_at), and
-- runs(incident_id), plus incidents already had a single-column index on
-- status (0002). SQLite can only use one index per table reference in a
-- simple query, so a standalone equality index (incident_id, state, status)
-- finds the matching rows but leaves the `ORDER BY created_at DESC` before
-- LIMIT unindexed -- and a standalone created_at index doesn't narrow to the
-- filter in the first place. Either way D1 falls back to a temp b-tree sort
-- over the filtered rows, so cost still grows with the filtered set's size
-- even though the response is capped.
--
-- Composite indexes (equality column first, then the ordering column) let
-- SQLite satisfy the filter AND walk the index in already-sorted order, so
-- the LIMIT can be applied without materializing/sorting the full match set.
--
-- listRunsByIncident (routes/incidents.ts embedded run list): WHERE
-- incident_id = ? ORDER BY created_at DESC LIMIT ?
CREATE INDEX IF NOT EXISTS idx_runs_incident_created ON runs (incident_id, created_at DESC);

-- listRuns (routes/runs.ts) when filtered by state: WHERE state = ? ORDER BY
-- created_at DESC LIMIT ?. The unfiltered case (no state) still benefits
-- from the plain idx_runs_created_at index kept below.
CREATE INDEX IF NOT EXISTS idx_runs_state_created ON runs (state, created_at DESC);

-- listIncidents (routes/incidents.ts) when filtered by status: WHERE
-- status = ? ORDER BY created_at DESC LIMIT ?. The unfiltered case has no
-- equality predicate to index on, so it still needs a sort -- that's
-- unavoidable without a plain created_at index on incidents, which no
-- current query needs, so it isn't added speculatively (YAGNI).
CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents (status, created_at DESC);

-- listAudit (routes/audit.ts): WHERE run_id = ? ORDER BY at ASC, id ASC
-- LIMIT ?. idx_audit_log_run_id_at (0002) already covers run_id + at, so
-- rows arrive at-sorted; only ties on identical `at` still need a secondary
-- sort ("temp b-tree for last term of order by"). Extending the index with
-- id closes that gap so the whole ORDER BY is satisfied by the index walk.
CREATE INDEX IF NOT EXISTS idx_audit_log_run_id_at_id ON audit_log (run_id, at, id);

-- idx_runs_incident_id (0004) is now redundant: WHERE incident_id = ? only
-- ever appears in listRunsByIncident above, so idx_runs_incident_created's
-- leading column covers every remaining use.
DROP INDEX IF EXISTS idx_runs_incident_id;

-- idx_runs_state and idx_incidents_status (0004/0002) are kept: they still
-- back countRunsByState (`WHERE state = ?`, no ORDER BY) and
-- countIncidentsExcludingStatus (`WHERE status != ?`, no ORDER BY), which
-- gain nothing from the ordering column and don't need the wider composite.
-- idx_runs_created_at is kept for the unfiltered listRuns case (no equality
-- predicate to lead a composite index with) and countRunsSince's range scan.
