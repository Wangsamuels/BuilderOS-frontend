import type { ReactNode } from "react";
import { IS_TESTNET, TESTNET_FAUCET_URL } from "@/lib/config";

/** A brand-new wallet holds no NEAR, so it can't pay the small network fee for joining a company. */
export function gasHelp(message: string): ReactNode {
  if (!/NEAR|balance|gas|fund/i.test(message)) return null;
  return (
    <p className="mt-3 text-[13px] text-ink-2" data-testid="gas-help">
      Joining needs a tiny network fee, and a new wallet holds no NEAR yet. About 0.1 NEAR is plenty.{" "}
      {IS_TESTNET ? (
        <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="text-ember underline underline-offset-4">
          Get free testnet NEAR
        </a>
      ) : (
        "Add some to your wallet"
      )}
      , then try again.
    </p>
  );
}
