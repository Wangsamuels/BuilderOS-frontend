import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // the end-to-end build (pointed at the mock API) gets its own output folder
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Wallet SDKs ship optional Node-only requires; they are never reached in the browser.
  turbopack: { resolveAlias: { fs: { browser: "./src/lib/empty.ts" }, "pino-pretty": { browser: "./src/lib/empty.ts" } } },
};

export default config;
