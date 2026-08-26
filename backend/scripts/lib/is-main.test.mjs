import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { isMainModule } from "./is-main.mjs";

describe("isMainModule", () => {
  it("returns true when import.meta.url matches the entry script path", () => {
    const entryPath = "/Users/dev/project/scripts/register-model-provider.mjs";
    const importMetaUrl = pathToFileURL(entryPath).href;
    expect(isMainModule(importMetaUrl, ["node", entryPath])).toBe(true);
  });

  it("returns false when import.meta.url does not match argv[1] (imported, not run directly)", () => {
    const entryPath = "/Users/dev/project/scripts/some-other-script.mjs";
    const importMetaUrl = pathToFileURL("/Users/dev/project/scripts/register-model-provider.mjs").href;
    expect(isMainModule(importMetaUrl, ["node", entryPath])).toBe(false);
  });

  it("returns false when argv[1] is undefined (e.g. imported in a REPL or test runner)", () => {
    const importMetaUrl = pathToFileURL("/Users/dev/project/scripts/register-model-provider.mjs").href;
    expect(isMainModule(importMetaUrl, ["node"])).toBe(false);
  });

  it("handles a path containing a space correctly", () => {
    const entryPath = "/Users/foo/My Projects/evidence-gated-runbook-executor/backend/scripts/register-model-provider.mjs";
    const importMetaUrl = pathToFileURL(entryPath).href;
    expect(isMainModule(importMetaUrl, ["node", entryPath])).toBe(true);

    // The naive `file://${argv[1]}` construction this replaces would have
    // produced an unescaped string that never equals import.meta.url here —
    // guard against regressing back to that comparison.
    expect(importMetaUrl).not.toBe(`file://${entryPath}`);
  });

  it("handles a Windows-style drive-letter path correctly", () => {
    // Force Windows path semantics explicitly so this assertion is
    // deterministic regardless of which OS actually runs the test suite —
    // pathToFileURL otherwise defaults to process.platform, which is what
    // isMainModule relies on in production.
    const entryPath = "C:\\Users\\foo\\evidence-gated-runbook-executor\\backend\\scripts\\register-model-provider.mjs";
    const windowsOptions = { windows: true };
    const importMetaUrl = pathToFileURL(entryPath, windowsOptions).href;

    expect(isMainModule(importMetaUrl, ["node", entryPath], windowsOptions)).toBe(true);
    expect(importMetaUrl).toBe("file:///C:/Users/foo/evidence-gated-runbook-executor/backend/scripts/register-model-provider.mjs");

    // The naive comparison would produce "file://C:\Users\..." which never
    // equals the properly-escaped import.meta.url with forward slashes.
    expect(importMetaUrl).not.toBe(`file://${entryPath}`);
  });
});
