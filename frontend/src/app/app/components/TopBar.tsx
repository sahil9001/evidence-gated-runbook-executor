"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { getOverview } from "../../../lib/api";
import { logout, me } from "../../../lib/auth";

type OverviewState =
  | { status: "loading" | "error" }
  | { status: "loaded"; awaitingApproval: number };

type UserState = { status: "loading" | "error" } | { status: "loaded"; email: string };

interface AwaitingBadgeProps {
  readonly overview: OverviewState;
}

/**
 * The number every on-call engineer opens this console to check. Zero is
 * rendered calm (muted, no motion); anything else is loud on purpose — the
 * whole point of this badge is that it's the first thing you see, not a
 * decoration that blends into the bar.
 */
function AwaitingBadge({ overview }: AwaitingBadgeProps) {
  if (overview.status !== "loaded") return null;
  const count = overview.awaitingApproval;
  const isCalm = count === 0;

  return (
    <Link
      href="/app/incidents"
      aria-label={`${count} gate${count === 1 ? "" : "s"} awaiting approval`}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
        isCalm ? "bg-neutral-100 text-neutral-600" : "bg-rose-50 text-rose-700 hover:bg-rose-100"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${isCalm ? "bg-neutral-500" : "bg-rose-600 rp-pulse"}`}
      />
      {count} awaiting approval
    </Link>
  );
}

interface TopBarProps {
  readonly onOpenNav: () => void;
}

export function TopBar({ onOpenNav }: TopBarProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });
  const [user, setUser] = useState<UserState>({ status: "loading" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Independent of the user fetch below: a failure here must not cost the
  // shell its email/logout controls, and vice versa.
  useEffect(() => {
    let cancelled = false;
    getOverview()
      .then((data) => {
        if (!cancelled) setOverview({ status: "loaded", awaitingApproval: data.awaitingApproval });
      })
      .catch(() => {
        if (!cancelled) setOverview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((current) => {
        if (!cancelled) setUser({ status: "loaded", email: current.email });
      })
      .catch(() => {
        if (!cancelled) setUser({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // Swallow: we redirect regardless (see comment below), and the
      // backend's own /auth/logout contract is idempotent/never-erroring —
      // any rejection here is a network hiccup, not a session that failed
      // to end server-side.
    } finally {
      // Redirect unconditionally: a network hiccup on this call must not
      // strand an operator behind what looks like a still-active session.
      router.push("/login");
    }
  }

  return (
    <header className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-soft sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:hidden"
        >
          <Menu className="h-4 w-4" strokeWidth={2} />
        </button>

        <AwaitingBadge overview={overview} />
      </div>

      <div className="flex items-center gap-3">
        {user.status === "loaded" ? (
          <span className="hidden truncate text-sm font-medium text-neutral-600 sm:inline">{user.email}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={isLoggingOut}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{isLoggingOut ? "Signing out…" : "Log out"}</span>
        </button>
      </div>
    </header>
  );
}
