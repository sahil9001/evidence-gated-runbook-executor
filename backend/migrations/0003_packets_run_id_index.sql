-- Migration number: 0003 	 2026-08-27T00:00:00.000Z

-- `getPacketByRun` (src/store/d1.ts) queries packets by `run_id` — evidence
-- must be resolved for the specific run a gate belongs to, never "whatever
-- the incident's latest packet is" (see Store#getPacketByRun). `run_id` was
-- already a column (0001_init.sql) but had no index of its own, only the
-- composite (incident_id, built_at) index used by getPacketByIncident.
CREATE INDEX idx_packets_run_id ON packets (run_id);
