import type { ReactNode } from "react";
import { WorkspaceFrame } from "@/features/workspace";

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WorkspaceFrame slug={slug}>{children}</WorkspaceFrame>;
}
