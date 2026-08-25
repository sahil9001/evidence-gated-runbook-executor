import type { EvidenceSource } from "./source";
import { createLogSource } from "./logs";
import { createMetricSource } from "./metrics";
import { createDeploySource } from "./deploys";

export * from "./source";
export * from "./logs";
export * from "./metrics";
export * from "./deploys";

/**
 * Every fixture-backed collector this slice ships, in no particular order.
 * A real deployment would build this list from configured HTTP sources
 * instead — the `EvidenceSource` shape is unchanged either way.
 */
export const ALL_SOURCES: readonly EvidenceSource[] = [
  createLogSource(),
  createMetricSource(),
  createDeploySource()
];
