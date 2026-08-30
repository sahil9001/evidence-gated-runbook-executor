import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, Terminal } from "lucide-react";

interface AuthShellProps {
  readonly title: ReactNode;
  readonly subtitle: string;
  readonly children: ReactNode;
}

/**
 * The three things the product promises, restated at the moment someone
 * commits to an account. The media panel used to be decoration only; carrying
 * the proof story here is the one job that half of the viewport can usefully do.
 */
const proofPoints = [
  {
    body: "Deploys, logs, traces, and metrics gathered before anything is suggested.",
    icon: CheckCircle2,
    label: "Evidence packet"
  },
  {
    body: "Diagnostics replay against an isolated target, never production.",
    icon: Terminal,
    label: "Sandbox replay"
  },
  {
    body: "Risky actions stay locked until a person reviews the proof.",
    icon: LockKeyhole,
    label: "Human approval"
  }
];

/**
 * Shared frame for /login and /register. It keeps the landing page's tokens
 * while using a split media/form composition for both auth routes.
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] w-screen overflow-x-hidden bg-white font-sans">
      <div className="min-h-[100dvh] w-screen">
        <div className="grid min-h-[100dvh] w-screen grid-cols-1 bg-white lg:grid-cols-[1.05fr_1fr]">
          <section className="relative flex min-h-[30dvh] flex-col justify-end overflow-hidden bg-ink lg:min-h-[100dvh]">
            <Image
              src="/auth/pixel-tulip-windmill.png"
              alt=""
              aria-hidden="true"
              fill
              priority
              sizes="(min-width: 1024px) 52vw, 100vw"
              unoptimized
              className="object-cover"
            />
            {/* Bottom-weighted on purpose: the copy needs an opaque bed, but a
                flat scrim over the whole panel turned the sunset to mud. Stops
                are explicit so the ramp lands under the headline, not above it. */}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_15_26)_0%,rgb(11_15_26/0.93)_36%,rgb(11_15_26/0.62)_56%,rgb(11_15_26/0.12)_82%,transparent_100%)]" />

            <div className="relative p-8 sm:p-10 lg:p-12 xl:p-14">
              <p
                className="max-w-md text-balance font-medium text-white"
                style={{ fontSize: "clamp(1.5rem, 1rem + 1.4vw, 2.4rem)", lineHeight: 1.12 }}
              >
                Evidence before{" "}
                <span className="font-serif italic leading-[1.1]">action</span>, every time.
              </p>

              <ul className="mt-7 hidden max-w-md flex-col gap-3 sm:flex">
                {proofPoints.map((point) => {
                  const Icon = point.icon;

                  return (
                    <li
                      key={point.label}
                      className="flex items-start gap-3 rounded-xl border border-white/20 bg-white/[0.13] p-3.5 backdrop-blur-sm"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                        <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white">{point.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-white/75">
                          {point.body}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <section className="flex min-h-[70dvh] flex-col bg-white px-6 py-8 sm:px-10 lg:min-h-[100dvh] lg:px-14 lg:py-10 xl:px-20">
            <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col">
              <div className="flex items-center justify-between gap-4">
                <Link
                  href="/"
                  aria-label="RunProof home"
                  className="inline-flex w-fit rounded-md transition hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  <Image
                    src="/brand/runproof-wordmark-black.png"
                    alt="RunProof"
                    width={160}
                    height={38}
                    className="h-7 w-auto"
                  />
                </Link>

                {/* The wordmark is a link, but nothing said so. This is the
                    explicit way back out of a page with no other navigation. */}
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Back to site
                </Link>
              </div>

              <div className="flex flex-1 flex-col justify-center py-10">
                <h1
                  className="text-balance font-semibold tracking-[-0.02em] text-ink"
                  style={{ fontSize: "clamp(1.75rem, 1.3rem + 1.2vw, 2.35rem)", lineHeight: 1.1 }}
                >
                  {title}
                </h1>
                <p className="mt-3 text-pretty text-sm leading-6 text-neutral-600">{subtitle}</p>

                <div className="mt-8">{children}</div>
              </div>

              <p className="text-xs leading-5 text-neutral-500">
                By continuing you agree to the{" "}
                <Link href="/terms" className="font-semibold text-neutral-700 underline-offset-2 hover:text-signal hover:underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="font-semibold text-neutral-700 underline-offset-2 hover:text-signal hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
