import { PrintView } from "@/components/printing";
export default async function PrintPage({ searchParams }: { searchParams: Promise<{ household?: string; snapshot?: string }> }) {
  const params = await searchParams;
  return <PrintView householdId={params.household ?? ""} snapshotId={params.snapshot ?? ""} />;
}
