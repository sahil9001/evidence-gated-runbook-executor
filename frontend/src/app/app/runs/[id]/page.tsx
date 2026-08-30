import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RunDetailClient } from "./RunDetailClient";
import { ConsoleContainer } from "@/app/app/components/console/Surface";

export const metadata = {
  title: "RunProof - Run"
};

interface RunDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * No page title here: `RunDetailClient` leads with the incident's own title,
 * which is what identifies the run to an operator. A generic "Run" heading
 * above it only pushed the useful line further down the page.
 */
export default async function RunDetailPage({ params }: RunDetailPageProps) {
  return (
    <>
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
      </ConsoleContainer>

      <RunDetailClient runId={(await params).id} />
    </>
  );
}
