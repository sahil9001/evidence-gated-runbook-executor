import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared between /login and /register, which submit different calls but present
 * failure, progress, and the cross-link identically.
 */

export function AuthFormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AuthSubmitButton({
  idleLabel,
  pending,
  pendingLabel
}: {
  idleLabel: string;
  pending: boolean;
  pendingLabel: string;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      className="mt-1 h-11 w-full gap-2 rounded-xl bg-signal text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
      ) : (
        <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      )}
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function AuthSwitchPrompt({
  href,
  linkLabel,
  prompt
}: {
  href: string;
  linkLabel: string;
  prompt: ReactNode;
}) {
  return (
    <p className="text-center text-sm text-neutral-600">
      {prompt}{" "}
      <Link
        href={href}
        className="font-semibold text-signal underline-offset-2 transition hover:text-ink hover:underline"
      >
        {linkLabel}
      </Link>
    </p>
  );
}
