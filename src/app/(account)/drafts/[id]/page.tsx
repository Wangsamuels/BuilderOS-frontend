import { DraftReview } from "@/features/drafts";

export const metadata = { title: "Plan" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DraftReview id={decodeURIComponent(id)} />;
}
