"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Menu,
  ShieldCheck,
  X
} from "lucide-react";

const navItems = ["Home", "Runbooks", "Evidence", "Approvals"];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="flex justify-center px-3 pt-4 sm:px-4 sm:pt-6">
      <div className="relative flex w-full max-w-[760px] items-center rounded-full border border-neutral-200 bg-white py-2 pl-2 pr-2 shadow-sm">
        <a
          href="#"
          aria-label="RunProof home"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal text-white sm:h-9 sm:w-9"
        >
          <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
        </a>

        <div className="ml-6 hidden items-center gap-6 text-sm font-medium text-neutral-700 md:flex">
          {navItems.map((item) => (
            <a
              key={item}
              href="#"
              className="flex items-center gap-2 transition hover:text-ink"
            >
              {item === "Home" ? (
                <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              ) : null}
              {item}
              {item === "Approvals" ? (
                <ChevronDown className="h-3.5 w-3.5 text-signal" />
              ) : null}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="hidden h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition hover:bg-neutral-50 md:flex"
            aria-label="Open live incident feed"
          >
            <Activity className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <a
            href="#demo-preview"
            className="inline-flex items-center gap-2 rounded-full bg-signal py-2 pl-4 pr-2 text-xs font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 sm:text-sm md:pl-5"
          >
            Run demo
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
            </span>
          </a>
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
          <div className="absolute left-2 right-2 top-full z-20 mt-2 rounded-2xl border border-neutral-200 bg-white p-3 text-left text-sm font-medium text-neutral-700 shadow-lg md:hidden">
            {navItems.map((item) => (
              <a
                key={item}
                href="#"
                className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                {item}
                {item === "Approvals" ? (
                  <ChevronDown className="h-3.5 w-3.5 text-signal" />
                ) : null}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
