/**
 * Only a same-origin relative path is a safe post-auth redirect target.
 *
 * `next` arrives as a query parameter on `/login` and `/register` — i.e. from
 * a URL an attacker can construct and hand to a victim. Accepting it
 * unvalidated is a classic open-redirect: `//evil.com` is parsed by browsers
 * as "same scheme, different host" (protocol-relative), some browsers
 * normalize a leading backslash (`/\evil.com`) the same way, and an absolute
 * URL (`https://evil.com`) is obviously off-origin. The pattern below accepts
 * only a path that starts with exactly one `/` followed by something other
 * than another `/` or `\`.
 */
const SAFE_NEXT_PATH = /^\/(?!\/|\\)\S*$/;

export function resolveNextPath(nextParam: string | null | undefined, fallback = "/app"): string {
  if (typeof nextParam !== "string" || nextParam.length === 0) return fallback;
  return SAFE_NEXT_PATH.test(nextParam) ? nextParam : fallback;
}

/**
 * Carries an in-flight `next` value across the login/register cross-link so
 * a visitor bounced to `/register?next=/app/incidents` who decides they
 * already have an account lands back on the same destination after signing
 * in instead. Not itself a security boundary — `resolveNextPath` is what
 * validates the value before it is ever used to navigate.
 */
export function withNextParam(path: string, nextParam: string | null | undefined): string {
  if (typeof nextParam !== "string" || nextParam.length === 0) return path;
  return `${path}?next=${encodeURIComponent(nextParam)}`;
}
