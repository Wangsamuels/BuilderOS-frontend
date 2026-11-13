import Link from "next/link";
import { Mark } from "@/components/singularity";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-void px-4 text-center">
      <div>
        <Mark size={48} paused className="mx-auto mb-6" />
        <h1 className="text-3xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-ink-2">This page doesn't exist, or it moved.</p>
        <Link href="/home" className="mt-6 inline-flex h-10 items-center rounded-full bg-ember px-5 text-sm font-semibold text-[#1a1206] hover:bg-[#ffc37d]">
          Go to your home
        </Link>
      </div>
    </main>
  );
}
