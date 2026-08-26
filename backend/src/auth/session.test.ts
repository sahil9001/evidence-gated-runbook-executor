import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../store/memory";
import type { Store } from "../domain/store";
import { createSession, resolveSession, revokeSession, SESSION_TTL_MS } from "./session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const T0 = "2026-08-26T00:00:00.000Z";

describe("session", () => {
  let store: Store;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({
      id: "user-1",
      email: "operator@example.com",
      passwordHash: "hash",
      salt: "salt",
      createdAt: T0
    });
  });

  describe("createSession", () => {
    it("mints a crypto.randomUUID() id and computes expiresAt from ttlMs", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);

      expect(session.id).toMatch(UUID_RE);
      expect(session.userId).toBe("user-1");
      expect(session.createdAt).toBe(T0);
      expect(session.expiresAt).toBe("2026-08-26T01:00:00.000Z");
    });

    it("persists the session in the store", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      expect(await store.getSession(session.id)).toEqual(session);
    });

    it("defaults to the 30-day TTL when none is given", async () => {
      const session = await createSession(store, "user-1", T0);
      expect(session.expiresAt).toBe(new Date(Date.parse(T0) + SESSION_TTL_MS).toISOString());
    });
  });

  describe("resolveSession", () => {
    it("returns the user for a live session", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      const user = await resolveSession(store, session.id, "2026-08-26T00:30:00.000Z");
      expect(user?.id).toBe("user-1");
      expect(user?.email).toBe("operator@example.com");
    });

    it("returns null for an unknown session id", async () => {
      expect(await resolveSession(store, "no-such-session", T0)).toBeNull();
    });

    it("returns null for a session past its expiresAt", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      const afterExpiry = "2026-08-26T02:00:00.000Z";
      expect(await resolveSession(store, session.id, afterExpiry)).toBeNull();
    });

    it("returns null exactly at expiresAt (boundary is expired, not live)", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      expect(await resolveSession(store, session.id, session.expiresAt)).toBeNull();
    });
  });

  describe("revokeSession", () => {
    it("makes the session resolve to null immediately", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      await revokeSession(store, session.id);
      expect(await resolveSession(store, session.id, T0)).toBeNull();
    });

    it("is idempotent — revoking an already-revoked session does not throw", async () => {
      const session = await createSession(store, "user-1", T0, 1000 * 60 * 60);
      await revokeSession(store, session.id);
      await expect(revokeSession(store, session.id)).resolves.not.toThrow();
    });
  });
});
