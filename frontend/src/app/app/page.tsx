import { OverviewClient } from "./OverviewClient";
import { Accent, ConsoleContainer, PageHeader } from "./components/console/Surface";

export const metadata = {
  title: "RunProof - Overview"
};

/**
 * Thin server-component wrapper around the Overview screen — mounted inside
 * the console shell (`app/app/layout.tsx`), which already owns the
 * top bar/sidebar chrome, so this page only needs to lay out its own content.
 */
export default function OverviewPage() {
  return (
    <>
      <ConsoleContainer>
        <PageHeader
          eyebrow="Overview"
          title={
            <>
              Where your incidents <Accent>stand</Accent>
            </>
          }
          lead="A readiness score built from what actually happened, the stages every incident moves through, and what is waiting on you right now."
        />
      </ConsoleContainer>
      <OverviewClient />
    </>
  );
}
