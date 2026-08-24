import { Navbar } from "./components/Navbar";
import { RunbookPreview } from "./components/RunbookPreview";
import { ShieldCheck } from "lucide-react";

export default function App() {
  return (
    <main className="min-h-[100dvh] w-full bg-paper p-3 font-sans sm:p-4">
      <section className="relative min-h-[calc(100dvh-24px)] w-full overflow-hidden rounded-2xl bg-[#d9d9d9] sm:min-h-[calc(100dvh-32px)] sm:rounded-3xl">
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disableRemotePlayback
          poster="https://images.unsplash.com/photo-1557683316-973673baf926?w=1600&q=60"
          aria-hidden="true"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260424_064411_9e9d7f84-9277-41f4-ab10-59172d89e6be.mp4"
            type="video/mp4"
          />
        </video>
        <div className="absolute inset-0 bg-white/35 backdrop-blur-[1px]" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white/80 via-white/25 to-transparent" />

        <div className="relative z-10">
          <Navbar />

          <div className="flex flex-col items-center px-4 pb-8 pt-10 text-center sm:pb-12 sm:pt-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-[13px] font-medium shadow-sm ring-1 ring-neutral-200">
              <ShieldCheck className="h-4 w-4 text-signal" strokeWidth={1.8} />
              RunProof
            </div>

            <h1
              className="mt-5 max-w-4xl font-medium text-ink sm:mt-6"
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
              href="#demo-preview"
              className="mt-6 inline-flex items-center gap-3 rounded-full bg-ink py-2 pl-6 pr-2 text-sm font-semibold text-white shadow-sm transition hover:translate-y-[-1px] active:translate-y-0 sm:mt-8 sm:py-2.5 sm:pl-7"
            >
              View demo
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 sm:h-7 sm:w-7">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
              </span>
            </a>
          </div>

          <div id="demo-preview" className="px-3 sm:px-4">
            <RunbookPreview />
          </div>
        </div>
      </section>
    </main>
  );
}
