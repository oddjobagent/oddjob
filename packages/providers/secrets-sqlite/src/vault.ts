import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface SealedSecret {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export function seal(plaintext: string, key: Buffer): SealedSecret {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) throw new Error("unexpected tag length");
  return { iv, ciphertext: ct, tag };
}

export function open(sealed: SealedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  const pt = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  return pt.toString("utf8");
}
