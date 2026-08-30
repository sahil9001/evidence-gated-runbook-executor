import { Suspense } from "react";
import { IncidentsClient } from "./IncidentsClient";
import { Accent, ConsoleContainer, PageHeader } from "@/app/app/components/console/Surface";

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
    <ConsoleContainer>
      <PageHeader
        eyebrow="Operations"
        title={
          <>
            Incident <Accent>roster</Accent>
          </>
        }
        lead="Every incident the team has opened, newest first. Filter by status or start a new one."
      />
      <Suspense fallback={null}>
        <IncidentsClient />
      </Suspense>
    </ConsoleContainer>
  );
}
