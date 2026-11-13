import type { ReactNode } from "react";
import { WorkspaceFrame } from "@/features/workspace";

export const metadata = { title: "Sample company" };

/** The public sample company: the same frame and the same pages, fed from GET /v1/demo. */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceFrame slug="demo" demo>
      {children}
    </WorkspaceFrame>
  );
}
