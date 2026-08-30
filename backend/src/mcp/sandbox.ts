import { z } from "zod";
import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";
import { CollectorError, type CollectContext, type EvidenceSource } from "./source";
import defaultSandboxFixtures from "../../../testing/fixtures/checkout-incident/sandbox.json";

const SOURCE_KIND: EvidenceSourceKind = "sandbox";

/**
 * A recorded diagnostic run. RunProof never executes code -- TrueForge owns
 * the sandbox -- so what this collector reads is the captured stdout of a
 * previous run of the runbook's `diagnostic.script`, not a live execution.
 *
 * Storing raw stdout rather than pre-parsed fields is deliberate: stdout is
 * what a sandbox actually hands back, and parsing it here means the contract
 * in the runbook's `expectedOutput` is checked by code on every collection
 * instead of being taken on trust.
 */
export const sandboxFixtureSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  runbookId: z.string().min(1),
  recordedAt: z.iso.datetime(),
  exitCode: z.number().int(),
  stdout: z.string().min(1)
});
export type SandboxFixture = z.infer<typeof sandboxFixtureSchema>;

/**
 * The four keys `checkout-failure`'s `diagnostic.expectedOutput` promises, in
 * the order it promises them. A recording that does not satisfy this is a
 * broken recording, and saying so loudly beats attaching an unreadable card
 * to an evidence packet an operator is about to make a production decision on.
 */
const EXPECTED_KEYS = ["timeout_ms", "failed_requests", "likely_commit", "recommendation"] as const;

const diagnosticOutputSchema = z.object({
  timeout_ms: z.coerce.number().int().nonnegative(),
  failed_requests: z.coerce.number().int().nonnegative(),
  likely_commit: z.string().min(1),
  recommendation: z.enum(["rollback", "none"])
});
export type DiagnosticOutput = z.infer<typeof diagnosticOutputSchema>;

/**
 * Parses `key=value` stdout into the shape `expectedOutput` describes.
 *
 * This is the "interpret stdout against expectedOutput" step, done by a
 * parser rather than by a model. The whole point of running a deterministic
 * script is that its result can be checked deterministically; handing these
 * four lines to an LLM to judge would reintroduce exactly the fabrication
 * risk the sandbox exists to remove.
 */
export function parseDiagnosticOutput(stdout: string, fixtureId: string): DiagnosticOutput {
  const pairs = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      throw new CollectorError(
        SOURCE_KIND,
        `sandbox fixture "${fixtureId}" has a stdout line that is not key=value: "${trimmed}"`
      );
    }
    pairs.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }

  const missing = EXPECTED_KEYS.filter((key) => !pairs.has(key));
  if (missing.length > 0) {
    throw new CollectorError(
      SOURCE_KIND,
      `sandbox fixture "${fixtureId}" is missing expected stdout key(s): ${missing.join(", ")}`
    );
  }

  const result = diagnosticOutputSchema.safeParse(Object.fromEntries(pairs));
  if (!result.success) {
    throw new CollectorError(
      SOURCE_KIND,
      `sandbox fixture "${fixtureId}" stdout does not match the runbook's expected output: ${result.error.message}`
    );
  }
  return result.data;
}

function parseFixtures(fixtures: readonly unknown[]): SandboxFixture[] {
  return fixtures.map((raw, index) => {
    const result = sandboxFixtureSchema.safeParse(raw);
    if (!result.success) {
      throw new CollectorError(SOURCE_KIND, `sandbox fixture at index ${index} is malformed: ${result.error.message}`);
    }
    return result.data;
  });
}

/**
 * The reproduction itself: the diagnostic ran and these are the numbers it
 * printed. `high` confidence because a deterministic script over fixed input
 * is the strongest evidence in the packet -- unlike a log line, it can be
 * re-run to the same answer.
 */
function toReproductionCard(
  fixture: SandboxFixture,
  output: DiagnosticOutput,
  ctx: CollectContext
): EvidenceCard {
  return {
    id: `${ctx.incidentId}-sandbox-${fixture.id}`,
    source: SOURCE_KIND,
    claim:
      `Diagnostic reproduced the ${ctx.service} timeout in an isolated sandbox: ` +
      `${output.failed_requests} failed requests against a ${output.timeout_ms}ms threshold`,
    raw: { ...fixture, parsed: output },
    collectedAt: ctx.now(),
    confidence: "high"
  };
}

/**
 * The conclusion, separated from the reproduction so a reviewer can accept
 * the measurement and still disagree with what it implies. Mirrors the
 * deploys collector's split between per-entry cards and its suspect card.
 *
 * `unknown` is a real value the script emits when it finds no risky deploy,
 * so it is reported as "no candidate" rather than dressed up as one.
 */
function toRecommendationCard(
  fixture: SandboxFixture,
  output: DiagnosticOutput,
  ctx: CollectContext
): EvidenceCard {
  const hasCandidate = output.likely_commit !== "unknown" && output.recommendation === "rollback";

  return {
    id: `${ctx.incidentId}-sandbox-${fixture.id}-recommendation`,
    source: SOURCE_KIND,
    claim: hasCandidate
      ? `Sandbox run points at ${output.likely_commit} and recommends rollback — still gated on approval`
      : "Sandbox run found no rollback candidate; it recommends no action",
    raw: {
      likelyCommit: output.likely_commit,
      recommendation: output.recommendation,
      // Named so nobody reads the card as authorisation: a recommendation is
      // an input to the gate, never a substitute for passing through it.
      requiresApproval: true
    },
    collectedAt: ctx.now(),
    confidence: hasCandidate ? "high" : "low"
  };
}

/**
 * Evidence from the sandbox stage.
 *
 * The `checkout-failure` runbook has always listed `sandbox` in its
 * `allowedSources`, but no collector produced it, so every packet was
 * permanently short one promised source: the run detail screen warned "no
 * evidence collected from source sandbox" on every run, the Diagnostics tab
 * was always empty, and the Overview's evidence-completeness term was pinned
 * at 0% by construction. This closes that gap with the recording the runbook
 * already describes.
 */
export function createSandboxSource(fixtures: readonly unknown[] = defaultSandboxFixtures): EvidenceSource {
  return {
    kind: SOURCE_KIND,
    async collect(ctx: CollectContext): Promise<EvidenceCard[]> {
      const parsed = parseFixtures(fixtures);
      // Scoped by service like every other collector: a recording made
      // against one service is not evidence about another.
      const scoped = parsed.filter((fixture) => fixture.service === ctx.service);

      return scoped.flatMap((fixture) => {
        // A non-zero exit means the diagnostic did not complete, so there is
        // no trustworthy output to parse. Surfacing it as a failed collection
        // keeps the packet honestly incomplete rather than quietly empty.
        if (fixture.exitCode !== 0) {
          throw new CollectorError(
            SOURCE_KIND,
            `sandbox fixture "${fixture.id}" exited ${fixture.exitCode}; no diagnostic output to trust`
          );
        }
        const output = parseDiagnosticOutput(fixture.stdout, fixture.id);
        return [toReproductionCard(fixture, output, ctx), toRecommendationCard(fixture, output, ctx)];
      });
    }
  };
}
