import { Navbar } from "./components/Navbar";
import { RunbookPreview } from "./components/RunbookPreview";
import { LandingSections } from "./components/LandingSections";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";

export default function App() {
  return (
    <main className="min-h-[100dvh] w-full bg-paper p-3 font-sans sm:p-4">
      <section className="relative min-h-[calc(100dvh-24px)] w-full overflow-hidden rounded-2xl bg-[#d9d9d9] sm:min-h-[calc(100dvh-32px)] sm:rounded-3xl">
        <Image
          src="/hero/runproof-hero-8bit.png"
          alt=""
          aria-hidden="true"
          fill
          priority
          unoptimized
          sizes="100vw"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="absolute inset-0 bg-white/42" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white/80 via-white/25 to-transparent" />

        <div className="relative z-10">
          <Navbar />

          <div className="flex flex-col items-center px-4 pb-4 pt-10 text-center sm:pb-6 sm:pt-16">
            <h1
              className="max-w-4xl font-medium text-ink"
              style={{
                fontSize: "clamp(38px, 7.4vw, 76px)",
                lineHeight: 1.04,
                letterSpacing: "-0.02em"
              }}
            >
              Prove incidents before{" "}
              <span className="font-serif italic leading-[1.1]">action</span>
            </h1>

            <p
              className="mt-4 max-w-2xl px-2 text-neutral-700 sm:mt-6"
              style={{ fontSize: "clamp(13px, 3.5vw, 16px)" }}
            >
              An AI runbook executor that gathers evidence, runs safe diagnostics,
              and asks before production changes.
            </p>

            <a
              href="#product-preview"
              className="mt-6 inline-flex items-center gap-3 rounded-full bg-ink py-2 pl-6 pr-2 text-sm font-semibold text-white shadow-sm transition hover:translate-y-[-1px] active:translate-y-0 sm:mt-8 sm:py-2.5 sm:pl-7"
            >
              View workflow
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 sm:h-7 sm:w-7">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
              </span>
            </a>
          </div>

          <div id="product-preview" className="px-2 sm:px-4">
            <RunbookPreview />
          </div>
        </div>
      </section>
      <LandingSections />
    </main>
  );
}
