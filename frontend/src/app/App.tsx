import { ArrowRight, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "./components/Navbar";
import { RunbookPreview } from "./components/RunbookPreview";
import { LandingSections } from "./components/LandingSections";

const heroProof = ["Evidence packet", "Sandbox replay", "Human approval"];

export default function App() {
  return (
    <main className="min-h-[100dvh] w-full bg-white font-sans">
      <section className="relative w-full overflow-hidden bg-[#d9d9d9]">
        <Image
          src="/landing/daytime-meadow-lake.png"
          alt=""
          aria-hidden="true"
          fill
          priority
          unoptimized
          sizes="100vw"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_62%]"
          style={{ imageRendering: "pixelated" }}
        />
        {/* Two scrims: a flat lift for headline contrast against the busy
            pixel art, then a bottom fade that hands off to the white page. */}
        <div className="absolute inset-0 bg-white/45" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white via-white/60 to-transparent" />

        <div className="relative z-10">
          <Navbar />

          <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-6 pt-10 sm:px-8 sm:pt-12 lg:px-12 lg:pt-16">
            {/* text-center is scoped to the copy block. It used to sit on the
                wrapper, where it cascaded into the product preview below and
                centre-aligned its timeline labels and sandbox output. */}
            <div className="flex flex-col items-center text-center">
              <h1
                className="max-w-4xl text-balance font-medium tracking-[-0.02em] text-ink"
                style={{ fontSize: "clamp(38px, 7vw, 76px)", lineHeight: 1.04 }}
              >
                Prove incidents before{" "}
                <span className="font-serif italic leading-[1.1]">action</span>
              </h1>

              <p
                className="mt-4 max-w-2xl text-pretty text-neutral-700"
                style={{ fontSize: "clamp(14px, 1.6vw, 17px)", lineHeight: 1.6 }}
              >
                An AI runbook executor that gathers evidence, runs safe diagnostics,
                and asks before production changes.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-3 rounded-full bg-ink py-2.5 pl-6 pr-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-0"
                >
                  Get started
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                    <ArrowRight className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white/75 px-5 py-2.5 text-sm font-semibold text-neutral-800 backdrop-blur-sm transition hover:border-neutral-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  <ShieldCheck className="h-4 w-4" strokeWidth={1.9} />
                  View workflow
                </a>
              </div>

              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-neutral-600 sm:text-[13px]">
                {heroProof.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div id="product-preview" className="mt-9 w-full sm:mt-10 lg:mt-12">
              <RunbookPreview />
            </div>
          </div>
        </div>
      </section>
      <LandingSections />
    </main>
  );
}
