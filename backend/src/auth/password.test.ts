import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  PBKDF2_ITERATIONS,
  WORKERS_PBKDF2_MAX_ITERATIONS
} from "./password";

describe("hashPassword", () => {
  it("produces different hash and salt for the same password across calls", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("returns base64-encoded hash and salt", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");

    // base64 alphabet only (with optional padding)
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("decodes the salt to exactly 16 bytes", async () => {
    const { salt } = await hashPassword("correct horse battery staple");
    expect(Buffer.from(salt, "base64").length).toBe(16);
  });

  it("decodes the hash to exactly 32 bytes (256-bit derived key)", async () => {
    const { hash } = await hashPassword("correct horse battery staple");
    expect(Buffer.from(hash, "base64").length).toBe(32);
  });
});

describe("PBKDF2 cost", () => {
  // Local workerd does not enforce the runtime's iteration ceiling, so a
  // too-high value hashes happily under vitest and throws only once deployed:
  // every registration 500s, and every login is silently rejected because
  // verifyPassword turns the throw into `false`. Timing assertions would not
  // catch it either. Asserting the constant is the only check that can fail in
  // the environment where this mistake gets made.
  it("stays within the iteration ceiling the deployed Workers runtime enforces", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThan(0);
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(WORKERS_PBKDF2_MAX_ITERATIONS);
  });
});

describe("verifyPassword", () => {
  it("succeeds for the correct password", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
  });

  it("fails for the wrong password", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash, salt)).toBe(false);
  });

  it("fails when the hash has been tampered with", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");
    const tampered = hash.slice(0, -4) + (hash.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(await verifyPassword("correct horse battery staple", tampered, salt)).toBe(false);
  });

  it("fails when verified against a different salt entirely", async () => {
    const { hash } = await hashPassword("correct horse battery staple");
    const { salt: otherSalt } = await hashPassword("unrelated password");
    expect(await verifyPassword("correct horse battery staple", hash, otherSalt)).toBe(false);
  });

  it("fails when the stored hash is a different length than expected (defense against a truncated/corrupted row)", async () => {
    const { salt } = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", "dG9vc2hvcnQ=", salt)).toBe(false);
  });

  it("returns false instead of throwing when the stored hash is not valid base64", async () => {
    const { salt } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", "not-valid-base64!!!", salt)).resolves.toBe(false);
  });

  it("returns false instead of throwing when the stored salt is not valid base64", async () => {
    const { hash } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash, "not-valid-base64!!!")).resolves.toBe(false);
  });

  it("returns false instead of throwing when both hash and salt are malformed", async () => {
    await expect(verifyPassword("correct horse battery staple", "!!!", "!!!")).resolves.toBe(false);
  });
});
