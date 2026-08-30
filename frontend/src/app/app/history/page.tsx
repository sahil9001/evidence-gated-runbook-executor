import { Suspense } from "react";
import { HistoryClient } from "./HistoryClient";
import { Accent, ConsoleContainer, PageHeader } from "@/app/app/components/console/Surface";

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
    <ConsoleContainer>
      <PageHeader
        eyebrow="Record"
        title={
          <>
            What actually <Accent>happened</Accent>
          </>
        }
        lead="Every run the agent has made, newest first. Filter by state, and open any run to see the full evidence and decision trail."
      />
      <Suspense fallback={null}>
        <HistoryClient />
      </Suspense>
    </ConsoleContainer>
  );
}
