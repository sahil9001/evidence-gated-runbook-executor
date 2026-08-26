#!/usr/bin/env node
// Registers a Google Gemini model provider with a running TrueForge instance.
// TrueForge needs at least one model provider configured before any agent can
// run — without one, the MCP tools `register:mcp` registers are never called.
//
// Usage:
//   export GEMINI_API_KEY="..."
//   node scripts/register-model-provider.mjs
//
// Required:
//   GEMINI_API_KEY    Google AI Studio API key. Get a free one (no credit
//                      card required) at https://aistudio.google.com/apikey
//
// Env vars (optional, defaults match local dev):
//   TRUEFORGE_URL      TrueForge base URL         (default http://localhost:8790)
//   GEMINI_MODEL_ID    Gemini model id to register (default gemini-2.0-flash)
//
// The API key is read from the environment only. This script never logs it,
// echoes it, or writes it to disk — not even partially, not even on failure.

import { isMainModule } from "./lib/is-main.mjs";

const DEFAULT_MODEL_ID = "gemini-2.0-flash";
const DEFAULT_MODEL_NAME = "gemini-flash";

const MISSING_KEY_MESSAGE = [
  "GEMINI_API_KEY is not set.",
  "",
  "TrueForge needs a model provider configured before any agent can run —",
  "without one, RunProof's registered MCP tools are never called.",
  "",
  "Get a free Google AI Studio API key (no credit card required):",
  "  https://aistudio.google.com/apikey",
  "",
  "Then export it and re-run this script:",
  '  export GEMINI_API_KEY="your-key-here"',
  "  npm run register:model"
].join("\n");

/**
 * Builds the TrueForge ModelProviderManifest for a Gemini provider.
 * The api key is threaded through as a parameter, never read from a literal.
 */
export function buildManifest(apiKey, modelId = DEFAULT_MODEL_ID) {
  return {
    type: "google-gemini",
    auth: { api_key: apiKey },
    models: [
      {
        model_id: modelId,
        name: DEFAULT_MODEL_NAME,
        properties: { context_length: 1000000, max_output_tokens: 8192 }
      }
    ]
  };
}

/**
 * Reads GEMINI_API_KEY from the given env (defaults to process.env).
 * Throws a judge-friendly error — never a stack trace — when it's unset.
 */
export function requireApiKey(env = process.env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
  return apiKey;
}

async function main() {
  const apiKey = requireApiKey();
  const trueforgeUrl = process.env.TRUEFORGE_URL ?? "http://localhost:8790";
  const modelId = process.env.GEMINI_MODEL_ID ?? DEFAULT_MODEL_ID;
  const manifest = buildManifest(apiKey, modelId);
  const endpoint = `${trueforgeUrl}/api/v1/settings/model-providers`;

  console.log(`Registering Gemini model provider (${modelId}) with TrueForge at ${trueforgeUrl} ...`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest })
  });

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    console.error(`Registration failed: HTTP ${response.status}`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`Registered (HTTP ${response.status}):`);
  console.log(JSON.stringify(body, null, 2));
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
