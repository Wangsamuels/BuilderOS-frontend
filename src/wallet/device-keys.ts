import { blake2b } from "@noble/hashes/blake2.js";
import nacl from "tweetnacl";
import { fromBase64, toBase64 } from "./nep413";

/**
 * Device keys. Each device holds an x25519 key pair; the company's code key is wrapped to every device's
 * public half, so only those devices can read private code. The private half is generated here and never
 * leaves this browser. The server only ever sees public keys and ciphertext.
 */
const store = (slug: string) => `builderos.device-key.${slug}`;

export function deviceKey(slug: string): { publicKey: string } | null {
  try {
    const raw = window.localStorage.getItem(store(slug));
    return raw ? { publicKey: (JSON.parse(raw) as { publicKey: string }).publicKey } : null;
  } catch {
    return null;
  }
}
export function createDeviceKey(slug: string): { publicKey: string } {
  const kp = nacl.box.keyPair();
  window.localStorage.setItem(store(slug), JSON.stringify({ publicKey: toBase64(kp.publicKey), secretKey: toBase64(kp.secretKey) }));
  return { publicKey: toBase64(kp.publicKey) };
}

/** libsodium-compatible sealed box (crypto_box_seal): ephemeral key ‖ box, nonce = blake2b(epk ‖ recipient, 24). */
export function sealTo(message: Uint8Array, recipientPublicKeyB64: string): string {
  const recipient = fromBase64(recipientPublicKeyB64);
  const eph = nacl.box.keyPair();
  const both = new Uint8Array(64);
  both.set(eph.publicKey);
  both.set(recipient, 32);
  const nonce = blake2b(both, { dkLen: 24 });
  const box = nacl.box(message, nonce, recipient, eph.secretKey);
  const out = new Uint8Array(32 + box.length);
  out.set(eph.publicKey);
  out.set(box, 32);
  return toBase64(out);
}
export const newCodeKey = () => nacl.randomBytes(32);
