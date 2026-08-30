import { FeatureShowcase } from "./landing/FeatureShowcase";
import { FinalCtaSection } from "./landing/FinalCtaSection";
import { Footer } from "./landing/Footer";
import { IntegrationSection } from "./landing/IntegrationSection";
import { PlatformSection } from "./landing/PlatformSection";
import { WorkflowSection } from "./landing/WorkflowSection";

export function LandingSections() {
  return (
    <div className="flex w-full flex-col bg-white">
      <WorkflowSection />
      <PlatformSection />
      <FeatureShowcase />
      <IntegrationSection />
      <FinalCtaSection />
      <Footer />
    </div>
  );
}
