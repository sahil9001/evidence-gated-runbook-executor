import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../components/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in - RunProof"
};

export default function LoginPage() {
  return (
    <AuthShell
      title={
        <>
          Welcome <span className="font-serif font-normal italic leading-[1.1]">back</span>
        </>
      }
      subtitle="Sign in to review evidence and decide what ships."
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
