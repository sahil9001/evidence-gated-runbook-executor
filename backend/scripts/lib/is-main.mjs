// Shared "is this module the entry point?" check for CLI scripts.
//
// Do NOT hand-build `file://${process.argv[1]}` and compare it to
// `import.meta.url` — that comparison silently diverges whenever the path
// needs percent-escaping (spaces, unicode) or uses a Windows drive letter
// (`C:\...`). On those platforms `import.meta.url` is already a correctly
// escaped `file://` URL, but the hand-built string is not, so the two never
// match. The script then exits 0 without ever calling main() or printing
// anything, which reads as success to anyone running `npm run register:model`.
//
// `pathToFileURL` performs the same normalization Node used internally to
// produce `import.meta.url`, so the comparison is exact on every platform.
import { pathToFileURL } from "node:url";

/**
 * Returns true when the given module was invoked directly (`node script.mjs`)
 * rather than imported by another module (e.g. a test file).
 *
 * @param {string} importMetaUrl - the caller's `import.meta.url`
 * @param {readonly string[]} argv - the caller's `process.argv` (injectable for tests)
 * @param {{ windows?: boolean }} [pathToFileURLOptions] - forwarded to `pathToFileURL`;
 *   omit in production so it follows the real OS (`process.platform`). Tests pass
 *   `{ windows: true }` to deterministically exercise Windows drive-letter handling
 *   regardless of which OS the test suite itself runs on.
 * @returns {boolean}
 */
export function isMainModule(importMetaUrl, argv = process.argv, pathToFileURLOptions) {
  const entryPath = argv[1];
  if (entryPath === undefined) {
    return false;
  }
  return importMetaUrl === pathToFileURL(entryPath, pathToFileURLOptions).href;
}
