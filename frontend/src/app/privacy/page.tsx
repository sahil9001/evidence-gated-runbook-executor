import type { Metadata } from "next";
import { PolicyPage } from "../components/PolicyPage";

export const metadata: Metadata = {
  title: "Privacy Policy - RunProof",
  description: "How RunProof handles account, incident, and operational data."
};

const sections = [
  {
    title: "What we collect",
    body: "RunProof uses account details, incident records, runbook metadata, evidence packets, and approval decisions to provide the product experience. We avoid collecting data that is not needed for those workflows."
  },
  {
    title: "How we use data",
    body: "Product data is used to authenticate users, prepare evidence-backed recommendations, display audit history, and improve reliability. We do not sell customer operational data."
  },
  {
    title: "Operational records",
    body: "Evidence packets and approvals are retained so teams can review what happened, who approved an action, and why a production step was allowed or blocked."
  },
  {
    title: "Access controls",
    // Says what the system actually enforces. Authentication gates the console,
    // but incident and audit reads are not filtered per account, so any signed-in
    // user can list every incident and every audit entry. Claiming workspace
    // scoping we do not implement would be exactly the kind of unearned
    // assurance this product exists to argue against.
    body: "Every console route requires an authenticated session. Access is not partitioned per user or per workspace: any signed-in account can read all incidents, runs, and audit entries in the deployment. Grant accounts only to people who should see all of it."
  },
  {
    title: "Data requests",
    body: "Customers can request export or deletion of account-linked data where legal, security, and audit obligations allow it."
  },
  {
    title: "Contact",
    body: "For privacy questions, contact the project maintainers through the repository or the support channel configured for your deployment."
  }
];

export default function PrivacyPage() {
  return (
    <PolicyPage
      badge="Privacy"
      title="Privacy built around operational trust."
      description="RunProof is designed to handle incident context with restraint: collect what the product needs, preserve the approval trail, and keep production control visible."
      sections={sections}
    />
  );
}
