import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The console's flat layout vocabulary.
 *
 * The previous console drew every region as a white `rounded-3xl` card with
 * `shadow-soft` floating on a grey mat. Nothing here casts a shadow or draws a
 * card: structure comes from hairline rules, spacing, and type scale alone, on
 * one continuous white page. Keep it that way -- a card reintroduced anywhere
 * makes every neighbouring region look unfinished by comparison.
 */

/** One shared gutter and measure for every console screen. */
export const CONSOLE_CONTAINER = "mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-10";

export function ConsoleContainer({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(CONSOLE_CONTAINER, className)}>{children}</div>;
}

/**
 * A horizontal band of the page. Regions are separated by a single hairline
 * and vertical rhythm, never by a card edge.
 */
export function Band({
  children,
  className,
  divided = true,
  id
}: {
  children: ReactNode;
  className?: string;
  /** Draws the hairline that separates this band from the one above it. */
  divided?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("py-8 sm:py-10", divided && "border-t border-sky-100", className)}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400",
        className
      )}
    >
      {children}
    </p>
  );
}

/** The serif italic accent the brand uses for one word of a title. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-serif font-normal italic leading-[1.1]">{children}</span>;
}

export function PageHeader({
  actions,
  eyebrow,
  lead,
  title
}: {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 pb-8 pt-8 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
        <h1
          className="text-balance font-semibold tracking-[-0.02em] text-ink"
          style={{ fontSize: "clamp(1.65rem, 1.2rem + 1.4vw, 2.5rem)", lineHeight: 1.08 }}
        >
          {title}
        </h1>
        {lead ? (
          <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-neutral-600">{lead}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({
  action,
  hint,
  title
}: {
  action?: ReactNode;
  hint?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-neutral-500">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A list of records. Rows are separated by hairlines inside one continuous
 * region -- not a stack of individually bordered cards.
 */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn("divide-y divide-sky-100 border-y border-sky-100", className)}>{children}</ul>
  );
}

export function EmptyState({
  action,
  body,
  icon: Icon,
  title
}: {
  action?: ReactNode;
  body: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center border-y border-sky-100 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-signal">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <p className="mt-4 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-neutral-500">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
