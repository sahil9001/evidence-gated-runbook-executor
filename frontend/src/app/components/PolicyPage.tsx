import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";

type PolicySection = {
  body: string;
  title: string;
};

type PolicyPageProps = {
  badge: string;
  children?: ReactNode;
  description: string;
  sections: PolicySection[];
  title: string;
};

const policyLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Security", href: "/security" }
];

export function PolicyPage({ badge, children, description, sections, title }: PolicyPageProps) {
  return (
    <main className="min-h-[100dvh] bg-paper p-3 font-sans text-ink sm:p-4">
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm sm:rounded-3xl">
        <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="relative min-h-[300px] overflow-hidden bg-sky-50 lg:min-h-full">
            <Image
              src="/landing/daytime-forest-stream.png"
              alt=""
              aria-hidden="true"
              fill
              unoptimized
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-cover"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/20 via-transparent to-white/20" />
            <Link
              href="/"
              className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-ink shadow-sm backdrop-blur transition hover:bg-white"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Home
            </Link>
          </div>

          <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14 lg:py-16">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-sm font-semibold text-signal">
              <ShieldCheck className="h-4 w-4" strokeWidth={2} />
              {badge}
            </div>
            <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-600">{description}</p>
            {children}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-2 py-8 sm:px-4 lg:py-12">
        <div className="grid gap-4 lg:grid-cols-3">
          {sections.map((section) => (
            <article key={section.title} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-ink">{section.title}</h2>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="relative left-1/2 w-screen -translate-x-1/2 bg-ink text-white">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <Link href="/" className="inline-flex w-fit items-center gap-3">
            <Image
              src="/brand/runproof-wordmark-white.png"
              alt="RunProof"
              width={150}
              height={36}
              className="h-8 w-auto"
            />
          </Link>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            {policyLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-white/65 transition hover:text-white">
                {link.label}
              </Link>
            ))}
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-signal px-4 py-2 font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0"
            >
              Get started
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
