import { ReportPage } from "@/features/teams";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportPage id={decodeURIComponent(id)} />;
}
