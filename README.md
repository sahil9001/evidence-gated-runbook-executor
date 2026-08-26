# RunProof

RunProof is an evidence-gated runbook executor for incident response.

It helps an operations team move from alert to action without letting an AI agent make risky production changes on its own. The agent follows a scoped runbook, gathers evidence, runs diagnostics in a sandbox, explains the recommended action, and waits for human approval before anything sensitive happens.

## Why It Exists

Production incidents are stressful. Teams need speed, but they also need control.

RunProof is built around one simple rule:

> Prove first. Act only after approval.

Instead of asking an AI assistant to improvise, RunProof gives it a controlled path:

1. Start from a known runbook.
2. Read logs, metrics, deploy history, and related context.
3. Run diagnostic checks in isolation.
4. Produce an evidence packet.
5. Recommend a safe next step.
6. Keep production actions locked until an operator approves.

## Product Surface

The current repository contains a polished Next.js frontend that presents RunProof as a standalone SaaS product.

Current frontend sections:

- Product hero with generated RunProof logo.
- Incident workflow preview.
- Runbook execution model.
- Evidence packet illustration.
- Governed execution path.
- Human approval flow.
- Product footer.

Live deployment:

https://runproof-frontend.sahilsilare.workers.dev

## Repository Structure

```text
.
|-- backend/                  # Placeholder for future API, MCP, and domain logic
|-- docs/                     # Deployment and project documentation
|-- frontend/                 # Next.js product frontend
|   |-- public/brand/         # Generated logo assets
|   |-- public/illustrations/ # Product illustration assets
|   `-- src/app/              # App routes and components
`-- testing/                  # Placeholder for runbooks, fixtures, prompts, and tests
```

## Frontend Stack

- Next.js 16
- React 19
- Tailwind CSS
- Lucide icons
- OpenNext for Cloudflare
- Wrangler for deployment

## Local Development

From the repo root:

```bash
cd frontend
npm ci
npm run dev
```

Open:

```text
http://localhost:3000
```

## Verification

Run these before pushing changes:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

## Cloudflare Deployment

The frontend is configured for Cloudflare Workers through OpenNext.

Deploy with:

```bash
cd frontend
npm run deploy
```

Useful related commands:

```bash
npm run preview
npx wrangler tail
```

More details are in [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md).

## Future Buildout

The full breakdown of remaining work — the idea in plain terms, open decisions, and a phased task list — is in [docs/roadmap.md](docs/roadmap.md).

Planned backend and testing work can live in the existing placeholder folders:

- `backend/src/domain`: incident, runbook, evidence, and approval models.
- `backend/src/mcp`: tool adapters and controlled agent actions.
- `backend/src/routes`: API endpoints.
- `testing/runbooks`: sample runbooks.
- `testing/fixtures`: logs, metrics, commits, and incident data.
- `testing/tests`: workflow and safety checks.

The intended product direction is a system where agent actions are explainable, replayable, and gated by evidence.
