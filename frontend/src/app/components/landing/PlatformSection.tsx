import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accent, Eyebrow, Section, SectionHeading } from "./Section";
import { assuranceItems, platformCards } from "../landingContent";

export function PlatformSection() {
  return (
    <Section id="platform" className="border-t border-sky-100/70 bg-white">
      <Eyebrow>Platform</Eyebrow>
      <SectionHeading
        className="mt-6"
        title={
          <>
            A control layer for AI-assisted <Accent>operations</Accent>.
          </>
        }
        lead="Use agents for investigation and diagnosis while keeping the production boundary explicit."
      />

      <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {platformCards.map((card) => {
            const Icon = card.icon;

            return (
              <Card
                key={card.title}
                className="group border-neutral-200/80 shadow-none transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_12px_32px_rgb(11_15_26/0.06)]"
              >
                <CardHeader className="space-y-0 pb-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-signal transition group-hover:bg-signal group-hover:text-white">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  <CardTitle className="pt-5 text-lg font-semibold text-ink">
                    {card.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-6 text-neutral-600">
                    {card.body}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="relative overflow-hidden border-sky-100 bg-sky-50 shadow-none">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(140deg,rgba(2,132,199,0.14),transparent_46%),radial-gradient(circle_at_84%_12%,rgba(14,165,233,0.22),transparent_34%)]" />
          <CardHeader className="relative space-y-0 pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-signal">
              Policy-aware by default
            </p>
            <CardTitle className="pt-4 text-2xl font-semibold leading-snug text-ink">
              Recommendations are useful only when the evidence is <Accent>visible</Accent>.
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <ul className="space-y-2.5">
              {assuranceItems.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-xl bg-white/90 px-4 py-3"
                >
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-signal"
                    strokeWidth={2.2}
                  />
                  <span className="text-[13px] font-medium leading-5 text-neutral-700">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
