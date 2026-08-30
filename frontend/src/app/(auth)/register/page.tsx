import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../components/AuthShell";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = {
  title: "Create account - RunProof"
};

export default function RegisterPage() {
  return (
    <AuthShell
      title={
        <>
          Create your <span className="font-serif font-normal italic leading-[1.1]">account</span>
        </>
      }
      subtitle="Evidence before action, every time, for every operator on your team."
    >
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
