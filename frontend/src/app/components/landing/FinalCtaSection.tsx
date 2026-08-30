import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Container } from "./Section";

export function FinalCtaSection() {
  return (
    <section className="border-t border-sky-100/70 bg-white py-16 sm:py-20 lg:py-24">
      <Container>
        {/* One contained panel, so the artwork has a deliberate edge instead of
            stopping partway across the viewport. */}
        <div className="relative overflow-hidden rounded-3xl border border-sky-100 bg-sky-50">
          <Image
            src="/landing/daytime-meadow-lake.png"
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(min-width: 1200px) 1200px, 100vw"
            className="object-cover"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/30 sm:via-white/88 sm:to-transparent" />

          <div className="relative grid gap-8 px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-14 lg:py-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                Evidence first
              </span>
              <h2
                className="mt-6 max-w-xl text-balance font-semibold tracking-[-0.02em] text-ink"
                style={{ fontSize: "clamp(1.9rem, 1.2rem + 2.2vw, 3.15rem)", lineHeight: 1.07 }}
              >
                Ready to review the incident loop?
              </h2>
              <p className="mt-5 max-w-lg text-pretty text-base leading-7 text-neutral-700">
                Create an account, open the console, and walk through an
                evidence-gated runbook from alert to approval.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-3 rounded-full bg-signal py-2.5 pl-6 pr-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 active:translate-y-0"
                >
                  Get started
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  </span>
                </Link>
                <Link
                  href="/app"
                  className="inline-flex items-center rounded-full border border-neutral-300 bg-white/80 px-5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:border-neutral-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  Open demo console
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
