import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewIncidentClient } from "./NewIncidentClient";

export const metadata = {
  title: "RunProof - New incident"
};

export default function NewIncidentPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <Link
        href="/app/incidents"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 transition hover:text-signal"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        Back to incidents
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">New incident</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        Describe what&apos;s happening. RunProof shows you the runbook that would run — and exactly what
        it authorises the agent to touch — before anything starts.
      </p>

      <div className="mt-6">
        <NewIncidentClient />
      </div>
    </div>
  );
}
