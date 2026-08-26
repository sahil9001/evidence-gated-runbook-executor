import { DashboardClient } from "./DashboardClient";

export const metadata = {
  title: "RunProof - Operator Dashboard"
};

/**
 * Temporary: this is still the single-seeded-incident dashboard from the
 * prior slice, now mounted inside the console shell (`app/app/layout.tsx`)
 * instead of rendering its own `<main>`/`Navbar` — those now live one level
 * up, and nesting a second `<main>` inside the shell's would be invalid.
 * Task B8 replaces this with the real Overview screen.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-2 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Operator dashboard</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        Live evidence for the seeded payment-service incident. Nothing executes until you
        approve it below.
      </p>

      <div className="mt-6">
        <DashboardClient />
      </div>
    </div>
  );
}
