"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { isApiError } from "@/api/client";
import { SessionProvider } from "@/auth/session";
import { ToastProvider } from "@/components/ui";
import { PRIVY_APP_ID } from "@/lib/config";
import { StreamProvider } from "@/stream/stream";
import { SigningProvider } from "@/wallet/signing";

// Privy is only downloaded when an app id is configured.
const PrivyRoot = PRIVY_APP_ID ? dynamic(() => import("@/wallet/privy"), { ssr: false }) : null;

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            // 4xx answers are final (403 = no access, 404 = gone); only retry network and 5xx failures
            retry: (n, e) => n < 2 && !(isApiError(e) && e.status >= 400 && e.status < 500),
          },
        },
      }),
  );
  const tree = (
    <SessionProvider>
      <ToastProvider>
        <SigningProvider>
          <StreamProvider>{children}</StreamProvider>
        </SigningProvider>
      </ToastProvider>
    </SessionProvider>
  );
  return <QueryClientProvider client={qc}>{PrivyRoot ? <PrivyRoot>{tree}</PrivyRoot> : tree}</QueryClientProvider>;
}
