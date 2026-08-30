"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useSession } from "../../hooks/useSession";
import { logout } from "../../lib/auth";
import type { User } from "../../lib/types";

const navItems = [
  { label: "Home", href: "#" },
  { label: "Workflow", href: "#workflow" },
  { label: "Platform", href: "#platform" },
  { label: "Runbooks", href: "#runbooks" },
  { label: "Integrations", href: "#integrations" }
];

/**
 * The avatar letter. `User` carries no display name, so the email's local part
 * is the only human-readable handle available; its first character is the
 * initial. Falls back to a bullet rather than rendering an empty circle if an
 * address ever arrives without one.
 */
export function accountInitial(email: string): string {
  const initial = email.trim().charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(initial) ? initial : "•";
}

function AccountMenu({
  onSignOut,
  signingOut,
  user
}: {
  onSignOut: () => void;
  signingOut: boolean;
  user: User;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.email}`}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal text-sm font-bold text-white transition hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 data-[state=open]:bg-sky-700"
      >
        <span aria-hidden="true">{accountInitial(user.email)}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Signed in as
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-ink">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app" className="cursor-pointer">
            <LayoutDashboard className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Open console
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          // Radix closes the menu on select, which would unmount the trigger
          // mid-request; the sign-out call itself is fire-and-forget and the
          // session refresh re-renders the nav when it settles.
          onSelect={onSignOut}
          className="cursor-pointer"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { state, refresh } = useSession();

  // `unknown` renders as signed-out on purpose: this is a public marketing
  // page, so that is the right guess for most visitors and the right thing to
  // show if the session check never answers. A signed-in operator sees it flip
  // to the account menu once the check lands.
  const user = state.status === "authenticated" ? state.user : null;

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
          {user ? (
            <AccountMenu user={user} signingOut={signingOut} onSignOut={() => void handleSignOut()} />
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-full border border-neutral-200 px-4 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 sm:text-sm md:inline-flex"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full bg-signal py-2 pl-4 pr-2 text-xs font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 sm:text-sm md:pl-5"
              >
                Get started
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              </Link>
            </>
          )}
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

            {/* The desktop sign-in control is hidden below md, so without this
                the only way to reach it on a phone would be the primary CTA.
                A signed-in operator gets their controls from the account menu,
                which stays visible at every width. */}
            {user ? null : (
              <div className="mt-1 border-t border-neutral-200 pt-1">
                <Link
                  href="/login"
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-neutral-50"
                  onClick={() => setOpen(false)}
                >
                  Sign in
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
