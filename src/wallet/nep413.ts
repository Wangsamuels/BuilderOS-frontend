import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";

/** NEP-413 payload hash: sha256(borsh({ tag: 2^31+413, message, nonce[32], recipient, callbackUrl: None })). */
const TAG = 2 ** 31 + 413;
const enc = new TextEncoder();

function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
const borshString = (s: string) => {
  const b = enc.encode(s);
  return concat(u32(b.length), b);
};
export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function nep413Hash(p: { message: string; nonce: Uint8Array; recipient: string }): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  return sha256(concat(u32(TAG), borshString(p.message), p.nonce, borshString(p.recipient), new Uint8Array([0])));
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return Uint8Array.from(s.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
};
/** Implicit NEAR account (64 hex) → "ed25519:<base58>" public key. */
export const implicitToPublicKey = (accountId: string) => `ed25519:${bs58.encode(fromHex(accountId))}`;
export const publicKeyBytes = (pk: string) => bs58.decode(pk.replace(/^ed25519:/, ""));
