import type { ReactNode } from "react";
import { AuthGate } from "@/features/auth";

/** Account-level pages need a session, nothing more. Home never waits behind setup. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
