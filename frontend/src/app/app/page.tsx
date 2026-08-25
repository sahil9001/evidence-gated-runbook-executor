import { Navbar } from "../components/Navbar";
import { DashboardClient } from "./DashboardClient";

export const metadata = {
  title: "RunProof - Operator Dashboard"
};

export default function DashboardPage() {
  return (
    <main className="min-h-[100dvh] w-full bg-paper p-3 font-sans sm:p-4">
      <div className="mx-auto max-w-[1180px]">
        <Navbar />

        <div className="px-2 pb-10 pt-8 sm:px-4">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Operator dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Live evidence for the seeded payment-service incident. Nothing executes until you
            approve it below.
          </p>

          <div className="mt-6">
            <DashboardClient />
          </div>
        </div>
      </div>
    </main>
  );
}
