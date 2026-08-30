import { RunbooksClient } from "./RunbooksClient";
import { Accent, ConsoleContainer, PageHeader } from "@/app/app/components/console/Surface";

export const metadata = {
  title: "RunProof - Runbooks"
};

/**
 * Thin server wrapper, same shape as the Incidents and Overview pages.
 * No `Suspense` boundary needed — unlike History and Audit, this screen has
 * no URL-backed filter, so `RunbooksClient` never calls `useSearchParams`.
 */
export default function RunbooksPage() {
  return (
    <ConsoleContainer>
      <PageHeader
        eyebrow="Runbooks"
        title={
          <>
            What the agent is allowed to <Accent>do</Accent>
          </>
        }
        lead="Each runbook is a scope contract: the evidence it may read, the steps it follows, and the action it would propose — locked until a human approves it."
      />
      <RunbooksClient />
    </ConsoleContainer>
  );
}
