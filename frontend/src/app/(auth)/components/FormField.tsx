"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly id: string;
  readonly error?: string;
  readonly hint?: string;
  readonly icon?: LucideIcon;
  /**
   * Adds a reveal toggle. The button is labelled "Show"/"Hide value" rather
   * than "…password" so it never collides with the field's own label in
   * accessible-name lookups.
   */
  readonly revealable?: boolean;
}

export function FormField({
  className,
  error,
  hint,
  icon: Icon,
  id,
  label,
  revealable = false,
  type,
  ...inputProps
}: FormFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const describedBy = useId();
  const hasError = error !== undefined && error.length > 0;
  const hasHint = !hasError && hint !== undefined;
  const resolvedType = revealable && revealed ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </Label>

      <div className="relative">
        {Icon ? (
          <Icon
            aria-hidden="true"
            strokeWidth={1.9}
            className={cn(
              "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors",
              hasError ? "text-rose-500" : "text-neutral-400"
            )}
          />
        ) : null}

        <Input
          id={id}
          type={resolvedType}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError || hasHint ? describedBy : undefined}
          className={cn(
            "h-11 rounded-xl border-neutral-200 bg-white text-sm text-ink shadow-none transition",
            "placeholder:text-neutral-400 focus-visible:border-signal focus-visible:ring-2 focus-visible:ring-signal/25 focus-visible:ring-offset-0",
            Icon && "pl-10",
            revealable && "pr-11",
            hasError && "border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/25",
            className
          )}
          {...inputProps}
        />

        {revealable ? (
          <button
            type="button"
            aria-label={revealed ? "Hide value" : "Show value"}
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {hasError ? (
        <p id={describedBy} className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      ) : hasHint ? (
        <p id={describedBy} className="text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
