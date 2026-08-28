import type { InputHTMLAttributes } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly id: string;
  readonly error?: string;
  readonly hint?: string;
}

export function FormField({ label, id, error, hint, className, ...inputProps }: FormFieldProps) {
  const hasError = error !== undefined && error.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={`rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-neutral-400 focus:border-signal focus:ring-2 focus:ring-signal/30 ${
          hasError ? "border-rose-400" : "border-neutral-200"
        } ${className ?? ""}`}
        {...inputProps}
      />
      {hasError ? (
        <p id={`${id}-error`} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="text-xs text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}
