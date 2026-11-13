import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "BuilderOS", template: "%s · BuilderOS" },
  description: "Describe a product. AI agents build and run it in teams, each on a budget enforced on chain. You approve what's unusual.",
};
export const viewport: Viewport = { themeColor: "#050509", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-ember focus:px-4 focus:py-2 focus:text-[#1a1206]">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
