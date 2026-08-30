import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Every landing section shares these primitives so the page keeps one gutter,
 * one measure, and one vertical rhythm. Before this, sections each rolled their
 * own `max-w` + padding and the left edges of consecutive headings landed on
 * three different x positions.
 */

export const CONTAINER = "mx-auto w-full max-w-[1200px] px-6 sm:px-8 lg:px-12";

export function Container({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(CONTAINER, className)}>{children}</div>;
}

export function Section({
  children,
  className,
  id,
  bleed = false
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  /** Skip the container when the section lays out its own full-width grid. */
  bleed?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn("relative scroll-mt-24 py-14 sm:py-16 lg:py-24", className)}
    >
      {bleed ? children : <Container>{children}</Container>}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
      {children}
    </span>
  );
}

export function SectionHeading({
  align = "left",
  className,
  id,
  lead,
  title
}: {
  align?: "left" | "center";
  className?: string;
  id?: string;
  lead?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-2xl",
        className
      )}
    >
      <h2
        id={id}
        className="text-balance font-semibold tracking-[-0.02em] text-ink"
        style={{ fontSize: "clamp(1.9rem, 1.2rem + 2.2vw, 3.15rem)", lineHeight: 1.07 }}
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-5 text-pretty text-base leading-7 text-neutral-600 sm:text-[17px]">
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** The serif italic accent used for one word per major heading. */
export function Accent({ children }: { children: ReactNode }) {
  return (
    <span className="font-serif font-normal italic leading-[1.1]">{children}</span>
  );
}
