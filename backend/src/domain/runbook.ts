import { z } from "zod";
import { evidenceSourceKindSchema } from "./evidence";
import { actionKindSchema } from "./action";

export const runbookStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
  source: evidenceSourceKindSchema.optional()
});
export type RunbookStep = z.infer<typeof runbookStepSchema>;

export const runbookActionSchema = z.object({
  kind: actionKindSchema,
  target: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  reversible: z.boolean(),
  description: z.string().min(1)
});
export type RunbookAction = z.infer<typeof runbookActionSchema>;

export const runbookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger: z.object({
    service: z.string().min(1),
    signals: z.array(z.string().min(1))
  }),
  allowedSources: z.array(evidenceSourceKindSchema),
  steps: z.array(runbookStepSchema).min(1, "a runbook must have at least one step"),
  proposedAction: runbookActionSchema
});
export type Runbook = z.infer<typeof runbookSchema>;

/**
 * Thrown by loadRunbook when a runbook fails validation. The message names
 * the offending field's readable dotted path (e.g. "trigger.service",
 * "allowedSources.1") so a malformed runbook fails loudly with an actionable
 * message rather than a generic parse error.
 */
export class RunbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunbookValidationError";
  }
}

function readablePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map(String).join(".");
}

export function loadRunbook(raw: unknown): Runbook {
  const result = runbookSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${readablePath(issue.path)}: ${issue.message}`)
      .join("; ");
    throw new RunbookValidationError(`Invalid runbook: ${issues}`);
  }
  return result.data;
}

function countOverlap(runbookSignals: readonly string[], incidentSignals: readonly string[]): number {
  const incidentSet = new Set(incidentSignals);
  return runbookSignals.filter((signal) => incidentSet.has(signal)).length;
}

/**
 * Selects the runbook that best matches an incident. Only runbooks whose
 * trigger.service matches exactly are candidates. Among those, the one
 * sharing the most signals with the incident wins. Returns null when there
 * are no candidates, when the best candidate shares zero signals, or when
 * two or more candidates tie for the highest overlap — an ambiguous match
 * is never resolved by guessing.
 */
export function matchRunbook(
  runbooks: readonly Runbook[],
  incident: { service: string; signals: string[] }
): Runbook | null {
  const candidates = runbooks.filter((runbook) => runbook.trigger.service === incident.service);
  if (candidates.length === 0) return null;

  const scored = candidates.map((runbook) => ({
    runbook,
    overlap: countOverlap(runbook.trigger.signals, incident.signals)
  }));

  const bestOverlap = scored.reduce((max, entry) => Math.max(max, entry.overlap), 0);
  if (bestOverlap === 0) return null;

  const winners = scored.filter((entry) => entry.overlap === bestOverlap);
  if (winners.length !== 1) return null;

  const winner = winners[0];
  return winner ? winner.runbook : null;
}
