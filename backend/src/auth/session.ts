import type { Store, SessionRow, UserRow } from "../domain/store";

/** 30 days. Sessions are bearer cookies with no refresh/rolling-window
 * behaviour in this slice — a session is good for exactly this long from
 * creation, then must be re-established via `/auth/login`. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mints a new session for `userId` and persists it. Pure aside from
 * `crypto.randomUUID()` — `nowIso` and `ttlMs` are both parameters, never
 * read from the clock internally, so callers (the route layer) own the
 * single source of "now" for a request.
 */
export async function createSession(
  store: Store,
  userId: string,
  nowIso: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<SessionRow> {
  const session: SessionRow = {
    id: crypto.randomUUID(),
    userId,
    createdAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString()
  };
  await store.createSession(session);
  return session;
}

/**
 * Resolves a session id to its user, or `null` if the session does not
 * exist or has expired. Expiry uses `>=` (matching `ApprovalGate.isExpired`
 * and `Store#deleteExpiredSessions`'s `expires_at <= ?`) — a session is
 * treated as expired at the exact instant of `expiresAt`, not strictly
 * after it, so this can never resolve a session the store itself considers
 * eligible for cleanup.
 */
export async function resolveSession(store: Store, sessionId: string, nowIso: string): Promise<UserRow | null> {
  const session = await store.getSession(sessionId);
  if (session === null) return null;
  if (Date.parse(nowIso) >= Date.parse(session.expiresAt)) return null;
  return store.getUserById(session.userId);
}

/**
 * Revokes a session. Idempotent: revoking an id that is already gone (or
 * never existed) is not an error — `Store#deleteSession` is a DELETE, which
 * is naturally idempotent for both the D1 and memory adapters.
 */
export async function revokeSession(store: Store, sessionId: string): Promise<void> {
  await store.deleteSession(sessionId);
}
