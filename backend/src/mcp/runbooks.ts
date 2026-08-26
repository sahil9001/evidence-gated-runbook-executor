import { loadRunbook, type Runbook } from "../domain/runbook";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

/**
 * Every runbook this slice ships, in no particular order. A real deployment
 * would build this list from a configured runbook store instead — the
 * `Runbook` shape and `loadRunbook` validation are unchanged either way.
 */
export const ALL_RUNBOOKS: readonly Runbook[] = [loadRunbook(checkoutFailureRaw)];
