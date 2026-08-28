"use client";

import { useCallback, useEffect, useState } from "react";
import { currentUser } from "../lib/auth";
import type { User } from "../lib/types";

export type SessionState =
  /** The answer is not back yet. Render whatever is true for most visitors. */
  | { status: "unknown" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User };

/**
 * Who is signed in, for public surfaces that adapt to it.
 *
 * Resolved on the client rather than the server on purpose: `/` is a static
 * route, and reading the session cookie during render would make it dynamic —
 * every visit to the marketing page would then run the Worker. The cost is one
 * request after mount and a brief `unknown` state, which callers should render
 * as the anonymous view, since that is what most visitors to a public page
 * actually are.
 *
 * A failure that is not "no session" (the API being down, say) leaves the
 * state `unknown` rather than claiming `anonymous`. Telling a signed-in
 * operator they are signed out, and hiding the console from them, is a worse
 * answer than showing the same nav an anonymous visitor sees.
 */
export function useSession(): {
  readonly state: SessionState;
  readonly refresh: () => void;
} {
  const [state, setState] = useState<SessionState>({ status: "unknown" });
  const [token, setToken] = useState(0);

  useEffect(() => {
    let active = true;

    currentUser()
      .then((user) => {
        if (!active) return;
        setState(user === null ? { status: "anonymous" } : { status: "authenticated", user });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "unknown" });
      });

    return () => {
      active = false;
    };
  }, [token]);

  // For callers that change the session themselves — signing out from the nav
  // — so the UI reflects it without a full page load.
  const refresh = useCallback(() => setToken((current) => current + 1), []);

  return { state, refresh };
}
