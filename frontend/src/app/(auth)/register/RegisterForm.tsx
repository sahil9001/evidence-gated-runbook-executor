"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { ApiClientError } from "../../../lib/api";
import { register } from "../../../lib/auth";
import { resolveNextPath, withNextParam } from "../../../lib/next-redirect";
import { AuthFormError, AuthSubmitButton, AuthSwitchPrompt } from "../components/AuthFormParts";
import { FormField } from "../components/FormField";
import { cn } from "@/lib/utils";

// Mirrors backend/src/routes/auth.ts MIN_PASSWORD_LENGTH - kept in sync
// manually since the frontend and backend are separate builds (see
// lib/types.ts's header comment for why nothing is imported across that
// boundary).
const MIN_PASSWORD_LENGTH = 12;

interface FieldErrors {
  readonly email?: string;
  readonly password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(trimmed)) return "Enter a valid email address.";
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (value.length === 0) return "Choose a password.";
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return undefined;
}

function describeRegisterError(error: ApiClientError): string {
  if (error.code === "email_taken" || error.code === "validation_failed") {
    return error.message;
  }
  if (error.code === "network_error") {
    return "Could not reach RunProof. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * Progress toward the minimum length, shown while typing. This is a length
 * gauge, not an entropy score - `MIN_PASSWORD_LENGTH` is the only rule the
 * backend actually enforces, so claiming anything stronger would be a lie.
 * Deliberately avoids the phrase the validator uses, so the two never collide
 * on screen or in tests.
 */
function PasswordLengthMeter({ value }: { value: string }) {
  const met = value.length >= MIN_PASSWORD_LENGTH;
  const percent = Math.min(100, Math.round((value.length / MIN_PASSWORD_LENGTH) * 100));

  return (
    <div className="mt-0.5 flex items-center gap-3">
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-label="Password length"
        aria-valuemin={0}
        aria-valuemax={MIN_PASSWORD_LENGTH}
        aria-valuenow={Math.min(value.length, MIN_PASSWORD_LENGTH)}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-300",
            met ? "bg-emerald-500" : percent > 50 ? "bg-amber-500" : "bg-rose-400"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-semibold tabular-nums",
          met ? "text-emerald-600" : "text-neutral-500"
        )}
      >
        {Math.min(value.length, MIN_PASSWORD_LENGTH)}/{MIN_PASSWORD_LENGTH}
      </span>
    </div>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError !== undefined || passwordError !== undefined) {
      setFieldErrors({ email: emailError, password: passwordError });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      await register(email.trim(), password);
      router.push(resolveNextPath(nextParam));
    } catch (error: unknown) {
      setIsSubmitting(false);
      const apiError =
        error instanceof ApiClientError ? error : new ApiClientError("Unexpected error", "unknown_error", 0);
      setFormError(describeRegisterError(apiError));
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {formError !== null ? <AuthFormError message={formError} /> : null}

      <FormField
        id="email"
        label="Email"
        type="email"
        icon={Mail}
        placeholder="you@company.com"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />

      <div>
        <FormField
          id="password"
          label="Password"
          type="password"
          icon={Lock}
          revealable
          placeholder="Choose a strong password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint={
            fieldErrors.password === undefined && password.length === 0
              ? `At least ${MIN_PASSWORD_LENGTH} characters.`
              : undefined
          }
        />
        {password.length > 0 ? <PasswordLengthMeter value={password} /> : null}
      </div>

      <AuthSubmitButton
        pending={isSubmitting}
        idleLabel="Create account"
        pendingLabel="Creating account..."
      />

      <AuthSwitchPrompt
        prompt="Already have an account?"
        href={withNextParam("/login", nextParam)}
        linkLabel="Sign in"
      />
    </form>
  );
}
