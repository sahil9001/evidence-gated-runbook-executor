import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IncidentDetailClient } from "./IncidentDetailClient";
import { ConsoleContainer } from "@/app/app/components/console/Surface";

export const metadata = {
  title: "RunProof - Incident"
};

interface IncidentDetailPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function IncidentDetailPage({ params }: IncidentDetailPageProps) {
  const { id } = await params;

  return (
    <ConsoleContainer>
      <div className="pb-6 pt-8">
        <Link
          href="/app/incidents"
          className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-neutral-500 transition hover:text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Back to incidents
        </Link>
      </div>

      <IncidentDetailClient incidentId={id} />
    </ConsoleContainer>
  );
}
