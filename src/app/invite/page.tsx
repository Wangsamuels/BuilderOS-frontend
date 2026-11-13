import { AuthGate } from "@/features/auth";
import { InvitePage } from "@/features/invites";

export const metadata = { title: "Invite" };

/** The path and the `code` parameter are fixed by the backend's invite emails. */
export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <AuthGate>
      <InvitePage code={code ?? ""} />
    </AuthGate>
  );
}
