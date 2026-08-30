import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { Accent, Eyebrow, Section, SectionHeading } from "./Section";
import { outcomes } from "../landingContent";

export function WorkflowSection() {
  return (
    <Section id="workflow" className="bg-white">
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <div>
          <Eyebrow>The loop</Eyebrow>
          <SectionHeading
            className="mt-6"
            title={
              <>
                From noisy alert to approved <Accent>run</Accent>.
              </>
            }
            lead="RunProof turns a page into a staged workflow: gather the signal, replay the failure, and approve the action with proof attached."
          />

          <ul className="mt-9 grid gap-2.5">
            {outcomes.map((outcome, index) => (
              <li
                key={outcome}
                className="group flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4 transition hover:border-sky-200 hover:bg-sky-50"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-signal ring-1 ring-sky-100">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                </span>
                <span className="text-[14px] leading-6 text-neutral-700">{outcome}</span>
                <span className="ml-auto shrink-0 pt-0.5 text-[11px] font-bold tabular-nums text-sky-300">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Contained and rounded rather than half-bleeding to an arbitrary
            stopping point partway across the viewport. */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-sky-100 bg-sky-50 lg:aspect-[5/6]">
          <Image
            src="/landing/daytime-forest-stream.png"
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(min-width: 1024px) 46vw, 100vw"
            className="object-cover"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/25 via-transparent to-transparent" />

          <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/60 bg-white/85 p-4 backdrop-blur-sm sm:inset-x-6 sm:bottom-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">
              Current gate
            </p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">
              Rollback payment-service stays locked until an engineer approves the
              evidence packet.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
