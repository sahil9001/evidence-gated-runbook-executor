import { Suspense } from "react";
import { HistoryClient } from "./HistoryClient";

export const metadata = {
  title: "RunProof - History"
};

/**
 * Thin server wrapper, same shape as the Incidents page. `Suspense` is
 * required here because `HistoryClient` reads `useSearchParams` for the
 * `?state=` filter — Next requires a Suspense boundary around any client
 * component that does.
 */
export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">History</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        What has actually happened, newest first. Filter by state, and open any run to see the full evidence and
        decision trail.
      </p>

      <div className="mt-6">
        <Suspense fallback={null}>
          <HistoryClient />
        </Suspense>
      </div>
    </div>
  );
}
