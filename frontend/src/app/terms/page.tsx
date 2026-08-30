import type { Metadata } from "next";
import { PolicyPage } from "../components/PolicyPage";

export const metadata: Metadata = {
  title: "Terms of Service - RunProof",
  description: "Terms for using RunProof and its evidence-gated runbook workflows."
};

const sections = [
  {
    title: "Use of the product",
    body: "RunProof is provided to help teams evaluate and operate evidence-gated runbook workflows. Users are responsible for validating outputs before relying on them in production."
  },
  {
    title: "Human approval",
    body: "Approval gates are part of the product design, but each team remains responsible for its own operational decisions, access policies, and production changes."
  },
  {
    title: "Customer content",
    body: "Incident details, logs, metrics, runbook entries, and approval notes remain customer content. Users should not submit secrets or data they are not authorized to process."
  },
  {
    title: "Acceptable use",
    body: "Do not use RunProof to bypass security controls, execute unauthorized production actions, disrupt services, or process data in violation of applicable obligations."
  },
  {
    title: "Availability",
    body: "This project may change as the product evolves. Features, integrations, and demo data can be updated, limited, or removed as needed."
  },
  {
    title: "Changes",
    body: "These terms may be updated to reflect product, security, or legal changes. Continued use of the product means the current terms apply."
  }
];

export default function TermsPage() {
  return (
    <PolicyPage
      badge="Terms"
      title="Terms for controlled incident automation."
      description="RunProof helps teams review evidence before taking action. These terms explain the basic responsibilities around using that workflow."
      sections={sections}
    />
  );
}
