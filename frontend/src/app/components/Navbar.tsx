"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ChevronRight,
  LogOut,
  Menu,
  X
} from "lucide-react";
import { useSession } from "../../hooks/useSession";
import { logout } from "../../lib/auth";

const navItems = [
  { label: "Home", href: "#" },
  { label: "Workflow", href: "#workflow" },
  { label: "Platform", href: "#platform" },
  { label: "Runbooks", href: "#runbooks" },
  { label: "Integrations", href: "#integrations" }
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { state, refresh } = useSession();

  // `unknown` renders as signed-out on purpose: this is a public marketing
  // page, so that is the right guess for most visitors and the right thing to
  // show if the session check never answers. A signed-in operator sees it flip
  // to the console link once the check lands.
  const signedIn = state.status === "authenticated";

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // /auth/logout is idempotent and the cookie is cleared server-side, so
      // there is nothing useful to tell the user here. Re-checking below
      // settles what the session actually is either way.
    } finally {
      setSigningOut(false);
      setOpen(false);
      refresh();
    }
  }

  return (
    <nav className="flex justify-center px-3 pt-4 sm:px-4 sm:pt-6">
      <div className="relative grid w-full max-w-[980px] grid-cols-[1fr_auto] items-center rounded-full border border-neutral-200 bg-white py-2 pl-2 pr-2 md:grid-cols-[1fr_auto_1fr]">
        <a
          href="#"
          aria-label="RunProof home"
          className="flex h-9 min-w-0 shrink-0 items-center justify-self-start rounded-full pl-1 pr-2 transition hover:opacity-80 sm:h-10"
        >
          <Image
            src="/brand/runproof-logo-blue.png"
            alt="RunProof"
            width={188}
            height={45}
            priority
            className="h-8 w-auto sm:h-9"
          />
        </a>

        <div className="hidden items-center justify-center gap-5 text-sm font-medium text-neutral-700 md:flex lg:gap-6">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="flex items-center gap-2 transition hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          {signedIn ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="hidden h-9 items-center gap-1.5 rounded-full border border-neutral-200 px-3.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60 md:inline-flex"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          ) : (
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-full border border-neutral-200 px-4 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 sm:text-sm md:inline-flex"
            >
              Sign in
            </Link>
          )}
          <Link
            href={signedIn ? "/app" : "/register"}
            className="inline-flex items-center gap-2 rounded-full bg-signal py-2 pl-4 pr-2 text-xs font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 sm:text-sm md:pl-5"
          >
            {signedIn ? "Open console" : "Get started"}
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
            </span>
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-800 transition hover:bg-neutral-50 md:hidden"
          >
            {open ? (
              <X className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Menu className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </div>

        {open ? (
          <div className="absolute left-2 right-2 top-full z-20 mt-2 rounded-2xl border border-neutral-200 bg-white p-3 text-left text-sm font-medium text-neutral-700 md:hidden">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}

            {/* The desktop sign-in / sign-out control is hidden below md, so
                without these the only way to reach it on a phone would be the
                primary CTA. */}
            <div className="mt-1 border-t border-neutral-200 pt-1">
              {signedIn ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-neutral-50 disabled:opacity-60"
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                  <LogOut className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-neutral-50"
                  onClick={() => setOpen(false)}
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
