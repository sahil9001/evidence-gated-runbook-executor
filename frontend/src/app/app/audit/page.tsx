import { Suspense } from "react";
import { AuditClient } from "./AuditClient";
import { Accent, ConsoleContainer, PageHeader } from "@/app/app/components/console/Surface";

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
    <ConsoleContainer>
      <PageHeader
        eyebrow="Audit"
        title={
          <>
            The record nothing can <Accent>rewrite</Accent>
          </>
        }
        lead="Every step, newest first. Filter to one run, or scan the full trail across every incident."
      />
      <Suspense fallback={null}>
        <AuditClient />
      </Suspense>
    </ConsoleContainer>
  );
}
