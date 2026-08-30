import type { Metadata } from "next";
import { PolicyPage } from "../components/PolicyPage";

export const metadata: Metadata = {
  title: "Security - RunProof",
  description: "Security posture for RunProof evidence-gated runbook execution."
};

const sections = [
  {
    title: "Approval-first execution",
    body: "Production actions remain gated until a human reviews the evidence packet and approves the proposed runbook step."
  },
  {
    title: "Evidence visibility",
    body: "RunProof keeps the supporting logs, traces, metrics, sandbox output, and decision history visible so reviewers can understand the recommendation."
  },
  {
    title: "Sandbox diagnostics",
    body: "Diagnostics are designed to run outside production first, reducing the chance that investigation work becomes an operational change."
  },
  {
    title: "Least privilege",
    body: "Deployments should grant the application only the permissions required for the configured runbooks, data sources, and approval workflow."
  },
  {
    title: "Audit trail",
    body: "Run decisions are recorded with context so teams can review what was proposed, what was approved, and when the gate changed state."
  },
  {
    title: "Report an issue",
    body: "Security concerns should be reported through the repository or the disclosure process configured by the team operating this deployment."
  }
];

export default function SecurityPage() {
  return (
    <PolicyPage
      badge="Security"
      title="Security centered on proof and approval."
      description="RunProof keeps investigation, recommendation, and execution separated so automation can assist without silently taking control."
      sections={sections}
    />
  );
}
