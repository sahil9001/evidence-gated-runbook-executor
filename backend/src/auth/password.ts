/**
 * Password hashing via Web Crypto's PBKDF2 (`crypto.subtle`). bcrypt and
 * argon2 do not exist on Workers — the runtime ships no native module host
 * for either — so PBKDF2-SHA256 with a high iteration count is the
 * standard substitute in this environment.
 */

// OWASP's 2023 guidance for PBKDF2-SHA256 is >=600,000 iterations. This is
// deliberately pinned lower, at 210,000, to bound per-request CPU time
// against Workers' CPU limits — a conscious trade-off, not an oversight.
// Revisit if Workers CPU limits change.
const PBKDF2_ITERATIONS = 210_000;
const SALT_LENGTH_BYTES = 16;
const DERIVED_KEY_LENGTH_BITS = 256; // 32 bytes

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKeyBits(plain: string, saltBytes: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    DERIVED_KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Constant-time byte comparison. Prefers the runtime's native
 * `crypto.subtle.timingSafeEqual` (available on Workers) when both inputs
 * are the same length — that's the one case the native function accepts.
 * Any other case (native API missing, or a length mismatch, which a
 * tampered/truncated stored hash can produce) falls back to a hand-rolled
 * XOR-accumulate loop that always walks the full length of the longer
 * input, so neither branch's runtime depends on where a mismatch occurs.
 * Never use `===` on derived key bytes — that comparison short-circuits on
 * the first differing byte and leaks timing information about the secret.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (x: ArrayBuffer | ArrayBufferView, y: ArrayBuffer | ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function" && a.length === b.length) {
    return subtle.timingSafeEqual(a, b);
  }

  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    const byteA = i < a.length ? a[i]! : 0;
    const byteB = i < b.length ? b[i]! : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

/** Derives a fresh salt + PBKDF2 hash for a plaintext password. Both are base64. */
export async function hashPassword(plain: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveKeyBits(plain, saltBytes);
  return { hash: toBase64(derived), salt: toBase64(saltBytes) };
}

/** Re-derives from `plain` + `salt` and compares to `hash` in constant time. */
export async function verifyPassword(plain: string, hash: string, salt: string): Promise<boolean> {
  const saltBytes = fromBase64(salt);
  const derived = await deriveKeyBits(plain, saltBytes);
  const expected = fromBase64(hash);
  return constantTimeEqual(derived, expected);
}
