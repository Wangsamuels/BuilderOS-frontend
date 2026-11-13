import { actionCreators, createTransaction, encodeTransaction, Signature, SignedTransaction, type Action } from "@near-js/transactions";
import { PublicKey } from "@near-js/crypto";
import { baseDecode } from "@near-js/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Tx } from "@/api/types";
import { NEAR_RPC_URL } from "@/lib/config";
import { ChainFailure, outcomeFailure } from "./signer";
import { toBase64 } from "./nep413";

/** The API returns wallet-selector shaped actions; wallets and the chain want near-api-js actions. */
export function toActions(tx: Tx): Action[] {
  return tx.actions.map((a) => {
    if (a.type !== "FunctionCall") throw new Error(`Unsupported action ${String((a as { type: string }).type)}`);
    return actionCreators.functionCall(a.params.methodName, a.params.args ?? {}, BigInt(a.params.gas ?? "30000000000000"), BigInt(a.params.deposit ?? "0"));
  });
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NEAR_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "builderos", method, params }) });
  const json = await res.json();
  if (json.error) {
    const cause = json.error.cause?.name ?? json.error.name;
    if (cause === "UNKNOWN_ACCOUNT" || cause === "UNKNOWN_ACCESS_KEY") throw new ChainFailure("This wallet has no NEAR yet, so it can't pay for the transaction. Add a little NEAR and try again.");
    throw new ChainFailure(json.error.data ?? json.error.message ?? "The NEAR network didn't accept the request.");
  }
  return json.result as T;
}

/**
 * Builds, signs and broadcasts one transaction with a raw ed25519 signer (the Privy embedded wallet).
 * `signHash` receives the 32-byte transaction hash and returns the 64-byte signature.
 */
export async function sendWithRawSigner(tx: Tx, accountId: string, publicKey: string, signHash: (hash: Uint8Array) => Promise<Uint8Array>): Promise<{ hash: string }> {
  const key = await rpc<{ nonce: number; block_hash: string }>("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
  const pk = PublicKey.fromString(publicKey);
  const transaction = createTransaction(accountId, pk, tx.receiverId, BigInt(key.nonce) + 1n, toActions(tx), baseDecode(key.block_hash));
  const encoded = encodeTransaction(transaction);
  const hash = sha256(encoded);
  const signature = await signHash(hash);
  const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: pk.keyType, data: signature }) });
  const outcome = await rpc<any>("send_tx", { signed_tx_base64: toBase64(signed.encode()), wait_until: "EXECUTED_OPTIMISTIC" });
  const failure = outcomeFailure(outcome);
  if (failure) throw new ChainFailure(failure);
  return { hash: outcome?.transaction?.hash ?? "" };
}
