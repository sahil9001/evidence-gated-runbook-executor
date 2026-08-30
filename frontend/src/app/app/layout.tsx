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
    // One continuous white page: no grey mat, no gutter between the rail and
    // the content, nothing floating. Regions are separated by hairlines.
    <div className="flex min-h-[100dvh] w-full flex-col bg-white font-sans lg:flex-row">
      <Sidebar isOpen={isNavOpen} onClose={closeNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={openNav} />
        <main className="flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
