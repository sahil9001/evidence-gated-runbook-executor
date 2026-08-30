"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { ApiClientError } from "../../../lib/api";
import { login } from "../../../lib/auth";
import { resolveNextPath, withNextParam } from "../../../lib/next-redirect";
import { AuthFormError, AuthSubmitButton, AuthSwitchPrompt } from "../components/AuthFormParts";
import { FormField } from "../components/FormField";

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
  if (value.length === 0) return "Enter your password.";
  return undefined;
}

/**
 * Never rephrase this into anything that hints whether the email exists
 * (e.g. "no account with that email") - the backend deliberately returns the
 * same `invalid_credentials` message, with the same response timing, for an
 * unknown email and a wrong password (see backend/src/routes/auth.ts). This
 * renders that message verbatim; the UI must not undo the work the server
 * did to prevent email-enumeration.
 */
function describeLoginError(error: ApiClientError): string {
  if (error.code === "invalid_credentials" || error.code === "validation_failed") {
    return error.message;
  }
  if (error.code === "network_error") {
    return "Could not reach RunProof. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

export function LoginForm() {
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
      await login(email.trim(), password);
      router.push(resolveNextPath(nextParam));
    } catch (error: unknown) {
      setIsSubmitting(false);
      const apiError =
        error instanceof ApiClientError ? error : new ApiClientError("Unexpected error", "unknown_error", 0);
      setFormError(describeLoginError(apiError));
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

      <FormField
        id="password"
        label="Password"
        type="password"
        icon={Lock}
        revealable
        placeholder="Your password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />

      <AuthSubmitButton pending={isSubmitting} idleLabel="Sign in" pendingLabel="Signing in..." />

      <AuthSwitchPrompt
        prompt={<>Don&apos;t have an account?</>}
        href={withNextParam("/register", nextParam)}
        linkLabel="Create one"
      />
    </form>
  );
}
