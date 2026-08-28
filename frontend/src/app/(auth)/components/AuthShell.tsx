import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, LockKeyhole } from "lucide-react";

const VALUE_PROPS: readonly string[] = [
  "Every proposed action stays locked until a human approves it.",
  "Evidence is gathered and shown before any change ships.",
  "A full audit trail records who decided what, and when."
];

interface AuthShellProps {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}

/**
 * Shared frame for /login and /register. Deliberately not a centred card on
 * grey — it reuses the landing page's tokens (bg-paper, text-ink, bg-panel
 * accents via text-signal, rounded-3xl surfaces, shadow-soft) and pairs a
 * dark marketing panel with the form panel so the screen has the same
 * layered, considered feel as the hero rather than looking like a bolted-on
 * auth scaffold.
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] w-full bg-paper p-3 font-sans sm:p-4">
      <div className="mx-auto flex min-h-[calc(100dvh-24px)] max-w-[1180px] items-center sm:min-h-[calc(100dvh-32px)]">
        <div className="grid w-full grid-cols-1 overflow-hidden rounded-3xl bg-white shadow-soft lg:grid-cols-[1fr_1.05fr]">
          <section className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex">
            <Link
              href="/"
              aria-label="RunProof home"
              className="inline-flex w-fit items-center gap-2 transition hover:opacity-80"
            >
              <Image
                src="/brand/runproof-wordmark-white.png"
                alt="RunProof"
                width={160}
                height={38}
                className="h-8 w-auto"
              />
            </Link>

            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                <LockKeyhole className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h2 className="mt-6 max-w-xs font-serif text-3xl italic leading-tight text-white">
                Prove incidents before action.
              </h2>
              <ul className="mt-8 flex flex-col gap-4">
                {VALUE_PROPS.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-white/80">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" strokeWidth={2} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-white/50">Evidence-gated incident response.</p>
          </section>

          <section className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
            <div className="mx-auto w-full max-w-sm">
              <Link
                href="/"
                className="text-xs font-semibold uppercase tracking-wide text-neutral-500 transition hover:text-ink lg:hidden"
              >
                RunProof
              </Link>
              <h1 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl lg:mt-0">{title}</h1>
              <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>

              <div className="mt-8">{children}</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
