import Image from "next/image";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Container } from "./Section";
import { footerGroups } from "../landingContent";

export function Footer() {
  return (
    <footer className="bg-ink text-white">
      <Container className="py-14 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
          <div>
            <Image
              src="/brand/runproof-wordmark-white.png"
              alt="RunProof"
              width={160}
              height={38}
              className="h-8 w-auto"
            />
            <p className="mt-5 max-w-md text-sm leading-6 text-white/60">
              Evidence-gated runbook execution for teams that need AI assistance
              without giving up production control.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">
                  {group.title}
                </h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-white/70 transition hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <Separator className="my-10 bg-white/10" />

        <p className="text-sm text-white/45">
          Copyright 2026 RunProof Labs. All rights reserved.
        </p>
      </Container>
    </footer>
  );
}
