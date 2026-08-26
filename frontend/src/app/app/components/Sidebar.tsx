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
        className={`fixed inset-y-3 left-3 z-50 flex w-64 flex-col gap-6 rounded-3xl bg-panel p-5 shadow-soft transition-transform duration-300 ease-out lg:sticky lg:top-4 lg:z-auto lg:h-[calc(100dvh-32px)] lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-[120%] lg:translate-x-0"
        }`}
      >
        <Link
          href="/app"
          aria-label="RunProof console home"
          className="flex items-center rounded-xl px-1 py-1 transition hover:opacity-80"
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

        <ul className="flex flex-1 flex-col gap-1.5">
          {NAV_ITEMS.map((item) => {
            const active = isItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                    active ? "bg-white text-ink shadow-sm" : "text-neutral-600 hover:bg-white/70 hover:text-ink"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? "text-signal" : "text-neutral-400 group-hover:text-signal"}`}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  {item.label}
                  {active ? (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] font-medium leading-relaxed text-neutral-400">
          Evidence-gated. Nothing executes without approval.
        </p>
      </nav>
    </>
  );
}
