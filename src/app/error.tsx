"use client";

import { Mark } from "@/components/singularity";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-void px-4 text-center">
      <div className="max-w-md">
        <Mark size={48} paused className="mx-auto mb-6" />
        <h1 className="text-2xl font-semibold">This page hit a problem</h1>
        <p className="mt-2 text-ink-2">Nothing was changed on chain. Try again; if it keeps happening, reload the page.</p>
        <p className="num mt-3 text-[13px] break-words text-ink-3">{error.message}</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex h-10 items-center rounded-full bg-ember px-5 text-sm font-semibold text-[#1a1206] hover:bg-[#ffc37d]">
          Try again
        </button>
      </div>
    </main>
  );
}
