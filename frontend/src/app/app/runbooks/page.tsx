import { RunbooksClient } from "./RunbooksClient";

export const metadata = {
  title: "RunProof - Runbooks"
};

/**
 * Thin server wrapper, same shape as the Incidents and Overview pages.
 * No `Suspense` boundary needed — unlike History and Audit, this screen has
 * no URL-backed filter, so `RunbooksClient` never calls `useSearchParams`.
 */
export default function RunbooksPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Runbooks</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        What the agent is authorised to do. Each card is a scope contract: the evidence it may read, the steps it
        follows, and the action it would propose — locked until a human approves it.
      </p>

      <div className="mt-6">
        <RunbooksClient />
      </div>
    </div>
  );
}
