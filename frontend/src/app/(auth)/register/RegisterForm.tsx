"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { ApiClientError } from "../../../lib/api";
import { register } from "../../../lib/auth";
import { resolveNextPath, withNextParam } from "../../../lib/next-redirect";
import { FormField } from "../components/FormField";

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
      {formError !== null ? (
        <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {formError}
        </div>
      ) : null}

      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />

      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        hint={fieldErrors.password === undefined ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-signal px-4 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        )}
        {isSubmitting ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-neutral-600">
        Already have an account?{" "}
        <Link href={withNextParam("/login", nextParam)} className="font-semibold text-signal transition hover:text-ink">
          Sign in
        </Link>
      </p>
    </form>
  );
}
