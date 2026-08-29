import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

interface AuthShellProps {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}

/**
 * Shared frame for /login and /register. It keeps the landing page's tokens
 * while using a split media/form composition for both auth routes.
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] w-screen overflow-x-hidden bg-white font-sans">
      <div className="min-h-[100dvh] w-screen">
        <div className="grid min-h-[100dvh] w-screen grid-cols-1 bg-white lg:grid-cols-2">
          <section
            aria-hidden="true"
            className="relative min-h-[38dvh] overflow-hidden bg-ink lg:min-h-[100dvh]"
          >
            <Image
              src="/auth/pixel-tulip-windmill.png"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              unoptimized
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/35 via-ink/0 to-white/10" />
          </section>

          <section className="flex min-h-[62dvh] flex-col justify-center bg-white px-6 py-8 sm:px-10 lg:min-h-[100dvh] lg:px-16 lg:py-12 xl:px-20">
            <div className="mx-auto flex w-full max-w-sm flex-col justify-center">
              <Link
                href="/"
                aria-label="RunProof home"
                className="mb-16 inline-flex w-fit transition hover:opacity-75"
              >
                <Image
                  src="/brand/runproof-wordmark-black.png"
                  alt="RunProof"
                  width={160}
                  height={38}
                  className="h-8 w-auto"
                />
              </Link>

              <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">{title}</h1>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{subtitle}</p>

              <div className="mt-8">{children}</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
