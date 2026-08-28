import { Suspense } from "react";
import { IncidentsClient } from "./IncidentsClient";

export const metadata = {
  title: "RunProof - Incidents"
};

/**
 * Thin server wrapper, same shape as the Overview page. `Suspense` is
 * required here (not there) because `IncidentsClient` reads `useSearchParams`
 * for the `?status=` filter — Next requires a Suspense boundary around any
 * client component that does.
 */
export default function IncidentsPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Incidents</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        Every incident the team has opened, newest first. Filter by status or start a new one.
      </p>

      <div className="mt-6">
        <Suspense fallback={null}>
          <IncidentsClient />
        </Suspense>
      </div>
    </div>
  );
}
