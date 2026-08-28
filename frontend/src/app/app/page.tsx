import { OverviewClient } from "./OverviewClient";

export const metadata = {
  title: "RunProof - Overview"
};

/**
 * Thin server-component wrapper around the Overview screen — mounted inside
 * the console shell (`app/app/layout.tsx`), which already owns the
 * `<main>`/top bar/sidebar chrome, so this page only needs to lay out its
 * own content.
 */
export default function OverviewPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Overview</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        What needs you right now — approvals waiting on a decision, active incidents, and recent
        activity across runs.
      </p>

      <div className="mt-6">
        <OverviewClient />
      </div>
    </div>
  );
}
