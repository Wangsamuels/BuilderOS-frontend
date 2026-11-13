import { TeamPage } from "@/features/teams";

export default async function Page({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <TeamPage team={decodeURIComponent(team)} />;
}
