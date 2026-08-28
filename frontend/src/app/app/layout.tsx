"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

/**
 * The frame every `/app/*` screen renders inside. A client component (not a
 * server layout) because the mobile nav drawer needs shared, interactive
 * open/close state between the sidebar and the top bar's hamburger — that
 * state has to live above both of them.
 */
export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [isNavOpen, setIsNavOpen] = useState(false);

  const openNav = useCallback(() => setIsNavOpen(true), []);
  const closeNav = useCallback(() => setIsNavOpen(false), []);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col gap-3 bg-paper p-3 font-sans sm:gap-4 sm:p-4 lg:flex-row">
      <Sidebar isOpen={isNavOpen} onClose={closeNav} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
        <TopBar onOpenNav={openNav} />
        <main className="flex-1 pb-6">{children}</main>
      </div>
    </div>
  );
}
