# Runbook Format

A runbook is the unit of authority in RunProof. When an alert fires, the system
selects one runbook and follows it — it does not let the AI agent improvise
what evidence to look at or what action to propose. Everything the agent is
permitted to do during an incident traces back to a field in the matched
runbook.

## Why JSON, not YAML

Runbooks ship as native JSON imports bundled directly into the Worker at
build time (`import runbook from "../../testing/runbooks/checkout-failure.json"`
style resolution via `resolveJsonModule`). Cloudflare Workers have no
filesystem at runtime, so a runbook cannot be "read from disk" the way a
Node service might read a YAML file — it has to already be part of the
bundle. Using JSON means the bundler's native JSON-module support does the
loading for free. Choosing YAML would mean shipping a YAML parser into the
Worker bundle purely to convert it back into the JSON-shaped object we
wanted in the first place — extra bytes and an extra dependency for zero
benefit in an environment with no file I/O.

## Where runbooks live

Runbook JSON files live under `testing/runbooks/`. Each one is validated
through `loadRunbook` (see `backend/src/domain/runbook.ts`) before it is
trusted anywhere else in the system.

## Shape

```
Runbook = {
  id: string;
  title: string;
  trigger: {
    service: string;
    signals: string[];
  };
  allowedSources: EvidenceSourceKind[];
  steps: RunbookStep[];
  proposedAction: RunbookAction;
}

RunbookStep = {
  id: string;
  label: string;
  detail: string;
  source?: EvidenceSourceKind;
}

RunbookAction = {
  kind: ActionKind;
  target: string;
  params: Record<string, unknown>;
  reversible: boolean;
  description: string;
}
```

### Field reference

| Field | Meaning |
|---|---|
| `id` | Stable identifier for the runbook. Used as `runbookId` on the evidence packet it produces. |
| `title` | Human-readable name shown to operators. |
| `trigger.service` | The service this runbook applies to. An incident's `service` must match this exactly for the runbook to be a matching candidate — see [Matching](#matching). |
| `trigger.signals` | The alert signals (e.g. `timeout`, `error_rate`) this runbook is written to respond to. Used to rank candidates by overlap with the incident's own signals. |
| `allowedSources` | The `EvidenceSourceKind` values (`logs`, `metrics`, `deploys`, `sandbox`) this runbook may collect evidence from. **This is a security boundary, not a hint.** Task 6 (the collector dispatcher) refuses to run any collector whose source is absent from this list, even if a step in `steps` names it. A runbook cannot expand its own authority by editing `steps` — only `allowedSources` grants access. |
| `steps` | The ordered timeline the agent walks through for this incident. Must contain at least one step — a runbook with no steps authorizes nothing and is rejected by the loader. Each step's optional `source` should be one of `allowedSources` (enforced at the collector layer, not by the loader). |
| `steps[].id` | Stable identifier for the step. |
| `steps[].label` | Short label, shown in the operator-facing timeline UI. |
| `steps[].detail` | Longer description of what happens at this step. |
| `steps[].source` | Which evidence source (if any) this step pulls from. Optional — some steps (e.g. "Approval required") don't collect evidence. |
| `proposedAction` | The single action this runbook recommends once evidence is gathered. It is a *proposal* — nothing in this schema causes it to execute; execution is gated by the approval flow (see `backend/src/domain/approval.ts`, Task 3). |
| `proposedAction.kind` | One of the `ActionKind` values from `backend/src/domain/action.ts` (`rollback`, `restart`, `scale`, `read_logs`, `read_metrics`, `run_diagnostic`). |
| `proposedAction.target` | What the action applies to — typically the service name. |
| `proposedAction.params` | Action-specific parameters (e.g. `{ "commit": "8f31c2b" }` for a rollback). |
| `proposedAction.reversible` | Whether the action can be undone. Informational for the approval UI; the authoritative "is this state-changing" classification lives in `action.ts`'s `createAction`, which derives it from `kind` and cannot be overridden by this field. |
| `proposedAction.description` | Human-readable summary of the action, shown at the approval gate. |

## The security boundary: `allowedSources`

`allowedSources` is the runbook's declared scope for evidence collection. It
exists because the AI agent must never be able to reach outside what a human
author explicitly authorized for this incident type. A runbook step naming
a source is not sufficient authorization on its own — that source must also
appear in `allowedSources`. Task 6's collector dispatcher treats a collector
request for a source outside `allowedSources` as a hard refusal, not a
warning. Treat any change to `allowedSources` with the same care as a change
to a permission grant, because that is exactly what it is.

## Matching

Given a list of loaded runbooks and an incoming incident
(`{ service: string; signals: string[] }`), `matchRunbook`:

1. Filters to runbooks whose `trigger.service` equals the incident's
   `service` exactly. Runbooks for other services are never candidates,
   regardless of how many signals they share.
2. Among candidates, counts how many signals in the incident's `signals`
   list also appear in the runbook's `trigger.signals`, and picks the
   candidate with the highest count.
3. Returns `null` if there are no candidates, if the best candidate shares
   zero signals with the incident, or if two or more candidates tie for the
   highest overlap. A tie is not resolved by picking one arbitrarily —
   running the wrong runbook against a live incident is worse than running
   none, so an ambiguous match surfaces to the operator as "nothing
   matched" rather than silently guessing.

## Worked example

```json
{
  "id": "checkout-failure",
  "title": "Checkout payment-service failure",
  "trigger": {
    "service": "payment-service",
    "signals": ["timeout", "error_rate"]
  },
  "allowedSources": ["logs", "metrics", "deploys"],
  "steps": [
    {
      "id": "alert-received",
      "label": "Alert received",
      "detail": "Checkout error rate increased on payment-service."
    },
    {
      "id": "evidence-gathered",
      "label": "Evidence gathered",
      "detail": "Logs, deploy history, and metrics agree on one likely cause.",
      "source": "logs"
    },
    {
      "id": "sandbox-check",
      "label": "Sandbox check",
      "detail": "Diagnostic script reproduced timeout failure in isolation."
    },
    {
      "id": "approval-required",
      "label": "Approval required",
      "detail": "Rollback stays locked until an engineer approves it."
    }
  ],
  "proposedAction": {
    "kind": "rollback",
    "target": "payment-service",
    "params": { "commit": "8f31c2b" },
    "reversible": true,
    "description": "Roll back payment-service to 8f31c2b"
  }
}
```

Note that `sandbox` never appears in this runbook's `allowedSources`, even
though a "Sandbox check" step exists in the timeline: the sandbox step here
runs a pre-baked diagnostic result rather than collecting live evidence via
the `sandbox` `EvidenceSourceKind`. If a future runbook wants a step to
collect through `sandbox`, it must add `"sandbox"` to its own
`allowedSources` explicitly.
