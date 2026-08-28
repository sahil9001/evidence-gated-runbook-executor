-- Migration number: 0006 	 2026-08-28T00:20:00.000Z

-- 0005 added composite (filter-column, created_at DESC) indexes for every
-- listing query's FILTERED path, but left each query's UNFILTERED path
-- unindexed: a composite index is only usable when its leading column is
-- constrained by an equality predicate, so a call with no filter can't use
-- idx_incidents_status_created or a hypothetical audit equivalent at all --
-- it still falls back to a full table scan plus a temp b-tree sort before
-- the LIMIT is applied, leaving request cost unbounded by the response cap.
--
-- listIncidents (routes/incidents.ts) with no status filter: SELECT ...
-- FROM incidents ORDER BY created_at DESC LIMIT ?. idx_incidents_status
-- (0002) and idx_incidents_status_created (0005) both lead with `status`,
-- which is unconstrained here, so neither is usable. A standalone
-- created_at index lets SQLite walk it directly in already-sorted order.
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents (created_at DESC);

-- listRecentAudit (routes/audit.ts, the no-runId branch of GET /audit):
-- SELECT ... FROM audit_log ORDER BY at DESC, id DESC LIMIT ?.
-- idx_audit_log_run_id_at_id (0005) leads with run_id, which is
-- unconstrained here, so it can't help either -- same gap as incidents
-- above, just missed in the previous round because that round only
-- considered the runId-filtered path (listAudit). A standalone (at, id)
-- index — matching the query's own tie-break order — lets the unfiltered
-- scan walk pre-sorted instead of materializing and sorting the table.
CREATE INDEX IF NOT EXISTS idx_audit_log_at_id ON audit_log (at DESC, id DESC);

-- listRuns (routes/runs.ts) with no state filter already has this covered
-- by idx_runs_created_at (0004), confirmed via EXPLAIN QUERY PLAN to walk
-- that index directly with no temp b-tree -- so runs needs no new index
-- here.
