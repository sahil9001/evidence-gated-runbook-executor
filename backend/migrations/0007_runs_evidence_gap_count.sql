-- The Overview readiness score needs to know how many runs finished with an
-- incomplete evidence packet. It previously derived that from `evidence_partial`
-- audit rows, which is wrong twice over: the audit log is a record of events,
-- not a projection to count against, and runs created before that entry covered
-- clean zero-card collection have a real gap with no row to find. Counting them
-- as complete inflated the score.
--
-- Deliberately NULLable with no default. NULL means "this run predates the
-- measurement", which is not the same as 0 ("measured, no gaps") -- backfilling
-- a 0 here would re-assert exactly the false claim this column exists to stop.
-- Runs with NULL are excluded from the score's evidence term rather than
-- counted as complete.
ALTER TABLE runs ADD COLUMN evidence_gap_count INTEGER;

-- Backs `COUNT(*) WHERE evidence_gap_count IS NOT NULL` and the
-- `> 0` variant, so both stay index-only scans as history grows.
CREATE INDEX IF NOT EXISTS idx_runs_evidence_gap_count ON runs (evidence_gap_count);
