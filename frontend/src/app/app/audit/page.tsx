import { Suspense } from "react";
import { AuditClient } from "./AuditClient";

export const metadata = {
  title: "RunProof - Audit"
};

/**
 * Thin server wrapper, same shape as the Incidents and History pages.
 * `Suspense` is required because `AuditClient` reads `useSearchParams` for
 * the `?runId=` filter.
 */
export default function AuditPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Audit</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        The immutable record of every step, newest first. Filter to one run, or scan the full trail across every
        incident.
      </p>

      <div className="mt-6">
        <Suspense fallback={null}>
          <AuditClient />
        </Suspense>
      </div>
    </div>
  );
}
