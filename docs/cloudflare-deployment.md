# Deploying the RunProof Frontend on Cloudflare

This guide deploys the Next.js app in `frontend/` to Cloudflare.

Cloudflare currently recommends **Cloudflare Workers with the OpenNext adapter** for full Next.js apps. Use Cloudflare Pages only if you intentionally export the app as a fully static site.

## Prerequisites

- A Cloudflare account.
- Node.js 22 LTS installed locally.
- The Cloudflare Wrangler CLI available through `npx`.
- The frontend app builds locally:

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run build
```

## Recommended: Deploy to Cloudflare Workers

Run these commands from the repo root unless a step says otherwise.

### 1. Install Cloudflare deployment packages

```bash
cd frontend
npm install @opennextjs/cloudflare@latest
npm install --save-dev wrangler@latest
```

### 2. Add OpenNext config

Create `frontend/open-next.config.ts`:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
```

### 3. Add Wrangler config

Create `frontend/wrangler.jsonc`:

```jsonc
{
  "name": "runproof-frontend",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-08-24",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }
}
```

The `nodejs_compat` flag is required for Next.js apps running through OpenNext on Workers.

### 4. Add deploy scripts

Update `frontend/package.json`:

```json
{
  "scripts": {
    "preview": "opennextjs-cloudflare build && wrangler dev",
    "deploy": "opennextjs-cloudflare build && wrangler deploy"
  }
}
```

Keep the existing `dev`, `build`, `lint`, and `typecheck` scripts.

### 5. Log in to Cloudflare

```bash
cd frontend
npx wrangler login
```

This opens a browser window and authorizes Wrangler.

### 6. Preview locally in the Workers runtime

```bash
cd frontend
npm run preview
```

Use this before deploy because `npm run dev` runs in the normal Next.js development server, while `preview` runs closer to Cloudflare production.

### 7. Deploy

```bash
cd frontend
npm run deploy
```

Wrangler will print a `*.workers.dev` URL after deployment.

## GitHub-Based Deployment

If you want Cloudflare to deploy automatically from GitHub:

1. Push this repo to GitHub.
2. In Cloudflare Dashboard, open **Workers & Pages**.
3. Create a new Worker project connected to the GitHub repo.
4. Set the project root/directory to:

```text
frontend
```

5. Set the deploy command to:

```bash
npm ci && npm run deploy
```

6. Add any environment variables in Cloudflare under **Build Variables and secrets** — see the next section for the ones this console needs.

## Pointing the Console at a Deployed Backend

The operator console is a browser client for the `runproof-api` Worker in
`backend/`, served from a different origin. Two settings have to agree, or the
console deploys successfully and then fails at login:

| Where | Setting | Value |
|---|---|---|
| `frontend` (build-time env var) | `NEXT_PUBLIC_API_URL` | The deployed backend's origin, e.g. `https://runproof-api.<your-subdomain>.workers.dev`. Defaults to `http://localhost:8787` — see `frontend/.env.example`. |
| `backend/wrangler.jsonc` (`vars`) | `ALLOWED_FRONTEND_ORIGINS` | The deployed console's origin, e.g. `https://runproof-frontend.<your-subdomain>.workers.dev`. |

`NEXT_PUBLIC_*` variables are inlined at build time, not read at runtime, so
changing the API URL requires a rebuild, not just a redeploy.

`ALLOWED_FRONTEND_ORIGINS` is the backend's CORS allow-list. The session is an
`HttpOnly` cookie, so the console's requests are credentialed, and browsers
reject a wildcard `Access-Control-Allow-Origin` on a credentialed request — the
backend must echo back one exact origin it recognises. `http://localhost:3000`
is always allowed for local dev without any configuration; every other origin
has to be listed here (comma-separated for more than one). An origin is scheme
+ host + port matched exactly, so `https://` and the account-specific
`*.workers.dev` subdomain both matter.

If this is wrong, the symptom is not a helpful error: the login request fails
in the browser with a CORS message in the devtools console while the backend's
own logs look fine, because the browser blocks the response before the page
ever sees it.

### The console and the API must stay on the same site

CORS is only one of two gates. The session is a `SameSite=Lax` cookie, which
browsers refuse to attach to a cross-**site** `fetch()`, so allow-listing an
origin is necessary but not sufficient — the console must also be served from
the same registrable domain as the API.

Two Workers under one Cloudflare account satisfy this. `workers.dev` is a
public suffix, so `runproof-frontend.<account>.workers.dev` and
`runproof-api.<account>.workers.dev` are different *origins* (hence the CORS
config above) but the same *site*, `<account>.workers.dev`. These deployments
are supported:

- Both Workers on one account's `workers.dev` subdomain — the checked-in setup.
- Both on custom domains under one registrable domain, e.g. `console.example.com`
  and `api.example.com`.

These are not, without further work:

- Console and API on **different** Cloudflare accounts, e.g.
  `runproof-frontend.a.workers.dev` calling `runproof-api.b.workers.dev`.
- Console on a custom domain calling an API still on `*.workers.dev`, or any
  other pair spanning two registrable domains.

An unsupported pair fails in a way that looks like an auth bug rather than a
deployment one: CORS passes, login returns 200 and sets the cookie, and then
every authenticated request 401s, because the browser never sends the cookie
back. Nothing in the backend's logs distinguishes this from an expired session.

Supporting a cross-site split means changing the cookie to
`SameSite=None; Secure` in `backend/src/routes/auth.ts` — which lets it ride
along on requests from any site and therefore needs a CSRF defence this
codebase does not yet have. Today the only barrier to a cross-site
state-changing request is that every route requires
`Content-Type: application/json`, forcing a preflight that the CORS allow-list
rejects. Do not flip `SameSite` without adding one.

## Optional: Static Cloudflare Pages Deployment

Use this only if the frontend stays static and does not need server-side rendering, route handlers, server actions, or dynamic backend behavior.

### 1. Enable static export

Update `frontend/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "export"
};

export default nextConfig;
```

### 2. Build

```bash
cd frontend
npm run build
```

The static output will be created in:

```text
frontend/out
```

### 3. Deploy with Wrangler Pages

```bash
cd frontend
npx wrangler pages deploy out --project-name runproof-frontend
```

## Which Option Should You Use?

Use **Workers + OpenNext** if:

- You will add backend routes to the Next.js app.
- You need server-side rendering.
- You want the deployment path that supports more Next.js features.
- You want fewer migration problems later.

Use **Pages static export** if:

- The frontend is only a static landing/demo page.
- You want the simplest deployment.
- You do not need server-side Next.js features.

For this hackathon project, start with **Workers + OpenNext**. It leaves room to add real demo APIs, auth, approval flows, and backend integrations later.

## Troubleshooting

### `nodejs_compat` missing

If deployment fails with Node.js API errors, confirm `wrangler.jsonc` contains:

```jsonc
"compatibility_flags": ["nodejs_compat"]
```

### Build works locally but fails in Cloudflare

Set the Cloudflare build Node version to Node 22:

```text
NODE_VERSION=22
```

### Dependency or lockfile issues

Use a clean install:

```bash
cd frontend
npm ci
```

### Check Cloudflare logs

```bash
cd frontend
npx wrangler tail
```

## References

- Cloudflare Next.js Workers guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- Cloudflare Next.js Pages guide: https://developers.cloudflare.com/pages/framework-guides/nextjs/
- OpenNext Cloudflare guide: https://opennext.js.org/cloudflare
