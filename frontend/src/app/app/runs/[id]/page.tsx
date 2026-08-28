import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RunDetailClient } from "./RunDetailClient";

export const metadata = {
  title: "RunProof - Run"
};

interface RunDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;

  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <Link
        href="/app/incidents"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 transition hover:text-signal"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        Back to incidents
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">Run</h1>

      <div className="mt-6">
        <RunDetailClient runId={id} />
      </div>
    </div>
  );
}
