"use client";

import { useState } from "react";
import { Database, LockKeyhole, Terminal, Workflow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Accent, Section, SectionHeading } from "./Section";
import {
  ApprovalGateVisual,
  EvidenceCaptureVisual,
  IncidentWorkspaceVisual,
  SandboxReplayVisual
} from "./featureVisuals";

const features = [
  {
    body: "Every alert becomes a structured workspace holding the deploys, logs, metrics, and runbook rules needed to reason about the fix.",
    icon: Workflow,
    id: "track",
    label: "Track",
    title: "Track incidents with evidence",
    visual: IncidentWorkspaceVisual
  },
  {
    body: "Evidence moves into the packet as the agent checks each safe source, so reviewers can see exactly what has been gathered and what is still open.",
    icon: Database,
    id: "capture",
    label: "Capture",
    title: "Capture proof automatically",
    visual: EvidenceCaptureVisual
  },
  {
    body: "Diagnostics run against an isolated target first, so every recommendation arrives with visible output behind it instead of a confident guess.",
    icon: Terminal,
    id: "replay",
    label: "Replay",
    title: "Replay the failure safely",
    visual: SandboxReplayVisual
  },
  {
    body: "Production actions stay blocked until a human reviews the proof packet and approves the runbook step. The decision is recorded either way.",
    icon: LockKeyhole,
    id: "gate",
    label: "Gate",
    title: "Deploy only after approval",
    visual: ApprovalGateVisual
  }
] as const;

export function FeatureShowcase() {
  const [active, setActive] = useState<string>(features[0].id);

  return (
    <Section id="runbooks" className="border-t border-sky-100/70 bg-white">
      <SectionHeading
        align="center"
        title={
          <>
            Packed with proof-first <Accent>features</Accent>
          </>
        }
        lead="RunProof connects the parts of an incident that usually stay scattered: issue context, logs, runbooks, sandbox output, and the final approval gate."
      />

      <Tabs value={active} onValueChange={setActive} className="mt-12 lg:mt-14">
        <TabsList className="mx-auto flex h-auto w-full max-w-xl flex-wrap justify-center gap-1 rounded-2xl border border-sky-100 bg-sky-50/70 p-1.5">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <TabsTrigger
                key={feature.id}
                value={feature.id}
                className={cn(
                  "flex-1 gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-neutral-600 transition",
                  "data-[state=active]:bg-white data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(11_15_26/0.06)]",
                  "hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                {feature.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {features.map((feature, index) => {
          const Visual = feature.visual;

          return (
            <TabsContent
              key={feature.id}
              value={feature.id}
              className="mt-8 focus-visible:outline-none lg:mt-10"
            >
              <div className="grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
                <div className="rp-rise">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif text-5xl italic leading-none text-sky-200">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-400">
                      Step {index + 1} of {features.length}
                    </span>
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold tracking-[-0.015em] text-ink sm:text-3xl">
                    {feature.title}
                  </h3>
                  <p className="mt-4 max-w-md text-[15px] leading-7 text-neutral-600">
                    {feature.body}
                  </p>

                  <ol className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
                    {features.map((step, stepIndex) => (
                      <li
                        key={step.id}
                        className={cn(
                          "flex items-center gap-2 text-[13px] font-semibold",
                          stepIndex === index ? "text-ink" : "text-neutral-400"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            stepIndex === index ? "bg-signal" : "bg-neutral-300"
                          )}
                        />
                        {step.label}
                      </li>
                    ))}
                  </ol>
                </div>
                <Visual />
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </Section>
  );
}
