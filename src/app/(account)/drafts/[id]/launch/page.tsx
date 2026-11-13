import { LaunchWizard } from "@/features/launch";

export const metadata = { title: "Launch" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LaunchWizard id={decodeURIComponent(id)} />;
}
