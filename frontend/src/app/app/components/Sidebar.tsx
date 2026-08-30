"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { FileCode2, History as HistoryIcon, LayoutDashboard, ShieldCheck, Siren } from "lucide-react";

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "/app", icon: LayoutDashboard },
  { label: "Incidents", href: "/app/incidents", icon: Siren },
  { label: "Runbooks", href: "/app/runbooks", icon: FileCode2 },
  { label: "History", href: "/app/history", icon: HistoryIcon },
  { label: "Audit", href: "/app/audit", icon: ShieldCheck }
];

/**
 * `/app` must match exactly — a prefix match would leave "Overview" lit up
 * on every other console route (`/app/incidents`, `/app/runs/:id`, ...)
 * since they all start with `/app`.
 */
function isItemActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  // Close the mobile drawer whenever navigation actually happens — but not
  // on the initial mount, which would otherwise fire this same effect once
  // with no real route change behind it. Only `pathname` belongs in the
  // dependency list — depending on `onClose` too would re-run this on every
  // parent re-render (e.g. the top bar's overview poll resolving) and could
  // slam the drawer shut mid-interaction.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire only on route change, see comment above.
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen ? (
        <div
          data-testid="mobile-nav-backdrop"
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity lg:hidden"
        />
      ) : null}

      <nav
        aria-label="Console navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col gap-7 border-r border-sky-100 bg-white px-4 py-6 transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-[100dvh] lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-[120%] lg:translate-x-0"
        }`}
      >
        <Link
          href="/app"
          aria-label="RunProof console home"
          className="flex items-center rounded-lg px-2 py-1 transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
        >
          <Image
            src="/brand/runproof-logo-blue.png"
            alt="RunProof"
            width={176}
            height={50}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <p className="px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
          Console
        </p>

        <ul className="-mt-4 flex flex-1 flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                    active ? "bg-sky-50 text-ink" : "text-neutral-600 hover:bg-neutral-50 hover:text-ink"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? "text-signal" : "text-neutral-400 group-hover:text-signal"}`}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  {item.label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-sky-100 pt-4">
          <p className="flex items-start gap-2 px-2 text-[11px] font-medium leading-relaxed text-neutral-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} aria-hidden="true" />
            Evidence-gated. Nothing executes without approval.
          </p>
        </div>
      </nav>
    </>
  );
}
