"use client";

import type { KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { FlaskConical, Layers, ScrollText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabId } from "../shared";

interface TabDef {
  readonly id: TabId;
  readonly label: string;
  readonly icon: LucideIcon;
}

const TAB_DEFS: readonly TabDef[] = [
  { id: "evidence", label: "Evidence", icon: Layers },
  { id: "diagnostics", label: "Diagnostics", icon: FlaskConical },
  { id: "approval", label: "Approval", icon: ShieldCheck },
  { id: "audit", label: "Audit", icon: ScrollText }
];

interface TabNavProps {
  readonly activeTab: TabId;
  readonly onChange: (tab: TabId) => void;
}

/**
 * A real WAI-ARIA tablist, not a row of styled buttons: `role="tablist"` /
 * `role="tab"` / `aria-selected` / `aria-controls`, plus roving tabindex and
 * arrow-key navigation between tabs (Home/End jump to the ends).
 *
 * Drawn as an underline rail rather than a pill row: the selected tab is
 * marked by a rule that continues the page's own hairline, so switching tabs
 * never looks like moving between floating objects. The icons are decorative
 * -- each tab's accessible name stays exactly its label.
 */
export function TabNav({ activeTab, onChange }: TabNavProps) {
  const activeIndex = TAB_DEFS.findIndex((tab) => tab.id === activeTab);

  function focusTab(id: TabId): void {
    // Runs after the click/keydown handler returns and React has committed
    // the re-render, so the newly-active tab's DOM node already exists with
    // its updated tabIndex by the time focus() is called.
    requestAnimationFrame(() => {
      document.getElementById(`tab-${id}`)?.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const isArrow = event.key === "ArrowRight" || event.key === "ArrowLeft";
    const isEdge = event.key === "Home" || event.key === "End";
    if (!isArrow && !isEdge) return;
    event.preventDefault();

    let nextIndex = activeIndex < 0 ? 0 : activeIndex;
    if (event.key === "ArrowRight") nextIndex = (nextIndex + 1) % TAB_DEFS.length;
    if (event.key === "ArrowLeft") nextIndex = (nextIndex - 1 + TAB_DEFS.length) % TAB_DEFS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TAB_DEFS.length - 1;

    const next = TAB_DEFS[nextIndex];
    if (next === undefined) return;
    onChange(next.id);
    focusTab(next.id);
  }

  return (
    <div
      role="tablist"
      aria-label="Run detail sections"
      onKeyDown={handleKeyDown}
      className="flex gap-6 overflow-x-auto border-b border-sky-100 sm:gap-9"
    >
      {TAB_DEFS.map((tab) => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
              isActive
                ? "border-signal text-ink"
                : "border-transparent text-neutral-500 hover:border-sky-200 hover:text-ink"
            )}
          >
            <Icon
              className={cn("h-4 w-4", isActive ? "text-signal" : "text-neutral-400")}
              strokeWidth={2}
              aria-hidden="true"
            />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
