import { PlanPage } from "@/features/work";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanPage id={decodeURIComponent(id)} />;
}
