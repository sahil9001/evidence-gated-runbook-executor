import { describe, expect, it } from "vitest";
import { buildManifest, requireApiKey } from "./register-model-provider.mjs";

describe("requireApiKey", () => {
  it("throws a guidance error when GEMINI_API_KEY is unset", () => {
    expect(() => requireApiKey({})).toThrow(/GEMINI_API_KEY is not set/);
  });

  it("points the user at a free API key and the export command", () => {
    try {
      requireApiKey({});
      throw new Error("expected requireApiKey to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("https://aistudio.google.com/apikey");
      expect(message).toContain("export GEMINI_API_KEY");
    }
  });

  it("reads the key from the provided env object, not a literal", () => {
    const env = { GEMINI_API_KEY: "test-only-key-do-not-use" };
    expect(requireApiKey(env)).toBe(env.GEMINI_API_KEY);
  });

  it("returns different values for different env inputs (no hardcoded key)", () => {
    expect(requireApiKey({ GEMINI_API_KEY: "key-one" })).toBe("key-one");
    expect(requireApiKey({ GEMINI_API_KEY: "key-two" })).toBe("key-two");
  });
});

describe("buildManifest", () => {
  it("builds a google-gemini manifest with the given api key", () => {
    const manifest = buildManifest("some-key");
    expect(manifest.type).toBe("google-gemini");
    expect(manifest.auth).toEqual({ api_key: "some-key" });
  });

  it("defaults the model id to gemini-2.0-flash", () => {
    const manifest = buildManifest("some-key");
    expect(manifest.models).toHaveLength(1);
    expect(manifest.models[0].model_id).toBe("gemini-2.0-flash");
  });

  it("honors a custom model id", () => {
    const manifest = buildManifest("some-key", "gemini-1.5-pro");
    expect(manifest.models[0].model_id).toBe("gemini-1.5-pro");
  });

  it("uses a name that satisfies TrueForge's ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$ rule", () => {
    const manifest = buildManifest("some-key");
    expect(manifest.models[0].name).toMatch(/^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/);
  });

  it("sets model properties required by ConfiguredModel", () => {
    const manifest = buildManifest("some-key");
    expect(manifest.models[0].properties).toEqual({
      context_length: 1000000,
      max_output_tokens: 8192
    });
  });
});
