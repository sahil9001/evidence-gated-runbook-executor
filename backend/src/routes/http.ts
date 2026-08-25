import type { Context } from "hono";
import type { ZodType } from "zod";
import { apiError, type Env } from "../index";

export type ParsedBody<T> = { success: true; data: T } | { success: false; response: Response };

/**
 * Reads and validates a JSON request body against a Zod schema. Handles both
 * failure modes a caller can produce — a body that is not valid JSON at all,
 * and a body that parses but fails schema validation — with the same
 * `400 validation_failed` shape, so neither can slip through to `app.onError`
 * as a 500.
 */
export async function parseJsonBody<T>(
  c: Context<{ Bindings: Env }>,
  schema: ZodType<T>
): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      success: false,
      response: c.json(apiError("validation_failed", "Request body must be valid JSON"), 400)
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      response: c.json(
        apiError("validation_failed", "Request body failed validation", result.error.flatten()),
        400
      )
    };
  }

  return { success: true, data: result.data };
}
