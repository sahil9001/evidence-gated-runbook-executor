import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewIncidentClient } from "./NewIncidentClient";
import { Accent, ConsoleContainer, PageHeader } from "@/app/app/components/console/Surface";

export const metadata = {
  title: "RunProof - New incident"
};

export default function NewIncidentPage() {
  return (
    <ConsoleContainer>
      <div className="pt-8">
        <Link
          href="/app/incidents"
          className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-neutral-500 transition hover:text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Back to incidents
        </Link>
      </div>

      <PageHeader
        title={
          <>
            Open a new <Accent>incident</Accent>
          </>
        }
        lead="Describe what's happening. RunProof shows you the runbook that would run — and exactly what it authorises the agent to touch — before anything starts."
      />

      <NewIncidentClient />
    </ConsoleContainer>
  );
}
