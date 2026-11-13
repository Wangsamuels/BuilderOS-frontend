"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/auth/session";
import { Skeleton } from "@/components/ui";
import { AuthGate } from "./auth";

/**
 * Emails and alerts link to short paths (/approvals, /audit, /settings/keys). Each opens the same page in the
 * person's current company: the one the server names in home.openCompanyId, else their first, else Home.
 */
function Go({ to }: { to: string }) {
  const { me } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!me.data) return;
    const slug = me.data.companies.find((c) => c.companyId === me.data!.home.openCompanyId)?.slug ?? me.data.companies[0]?.slug;
    router.replace(slug ? `/c/${slug}${to}` : "/home");
  }, [me.data, router, to]);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6" role="status" aria-label="Opening your company">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
export const CompanyRedirect = ({ to }: { to: string }) => (
  <AuthGate>
    <Go to={to} />
  </AuthGate>
);
