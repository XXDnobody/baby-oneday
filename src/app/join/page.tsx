import { Workspace } from "@/components/workspace";
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <Workspace initialMode="join" token={(await searchParams).token ?? ""} />;
}
