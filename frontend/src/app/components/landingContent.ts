import type { LucideIcon } from "lucide-react";
import { FileSearch, GitBranch, LockKeyhole, Terminal } from "lucide-react";

type IconCard = {
  body: string;
  icon: LucideIcon;
  title: string;
};

export const workflowRows = [
  ["Fetching logs", "10s", "complete"],
  ["Processing traces", "20s", "complete"],
  ["Running sandbox", "30s", "complete"],
  ["Writing proof packet", "40s", "complete"],
  ["Waiting for approval", "50s", "pending"]
] as const;

export const outcomes = [
  "Incident packet ready before the first production step",
  "Human approval visible at the exact decision point",
  "Sandbox diagnostics attached to every recommendation",
  "Audit history that survives handoff and retrospectives"
];

export const platformCards: IconCard[] = [
  {
    icon: FileSearch,
    title: "Evidence graph",
    body: "Link alerts, deploys, logs, traces, and runbook rules into one reviewable packet."
  },
  {
    icon: Terminal,
    title: "Sandbox replay",
    body: "Run diagnostics against an isolated target before the system recommends a production step."
  },
  {
    icon: LockKeyhole,
    title: "Approval gate",
    body: "Keep high-risk actions locked until an operator reviews the evidence and approves the run."
  },
  {
    icon: GitBranch,
    title: "Audit trail",
    body: "Record the recommendation, reviewer decision, and action state for incident review."
  }
];

export const integrations = [
  {
    detail: "deploy diffs",
    logo: "/integrations/github.svg",
    name: "GitHub"
  },
  {
    detail: "metrics",
    logo: "/integrations/datadog.svg",
    name: "Datadog"
  },
  {
    detail: "exceptions",
    logo: "/integrations/sentry.svg",
    name: "Sentry"
  },
  {
    detail: "alerts",
    logo: "/integrations/pagerduty.svg",
    name: "PagerDuty"
  },
  {
    detail: "approvals",
    logo: "/integrations/slack.svg",
    name: "Slack"
  },
  {
    detail: "runtime logs",
    logo: "/integrations/cloudflare.svg",
    name: "Cloudflare"
  }
];

export const assuranceItems = [
  "No production action runs without approval",
  "Sandbox output stays attached to the recommendation",
  "Every decision has an audit record",
  "Policy pages explain privacy, terms, and security posture"
];

export const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Workflow", href: "#workflow" },
      { label: "Runbooks", href: "#runbooks" },
      { label: "Integrations", href: "#integrations" },
      { label: "Demo console", href: "/app" }
    ]
  },
  {
    title: "Company",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Security", href: "/security" }
    ]
  }
];
