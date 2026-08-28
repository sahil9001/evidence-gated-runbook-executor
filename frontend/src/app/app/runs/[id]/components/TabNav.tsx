"use client";

import type { KeyboardEvent } from "react";
import type { TabId } from "../shared";

interface TabDef {
  readonly id: TabId;
  readonly label: string;
}

const TAB_DEFS: readonly TabDef[] = [
  { id: "evidence", label: "Evidence" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "approval", label: "Approval" },
  { id: "audit", label: "Audit" }
];

interface TabNavProps {
  readonly activeTab: TabId;
  readonly onChange: (tab: TabId) => void;
}

/**
 * A real WAI-ARIA tablist, not a row of styled buttons: `role="tablist"` /
 * `role="tab"` / `aria-selected` / `aria-controls`, plus roving tabindex and
 * arrow-key navigation between tabs (Home/End jump to the ends).
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
      className="flex flex-wrap gap-1 rounded-2xl bg-white p-1.5 shadow-soft"
    >
      {TAB_DEFS.map((tab) => {
        const isActive = tab.id === activeTab;
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
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
              isActive ? "bg-signal text-white shadow-sm" : "text-neutral-600 hover:bg-panel hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
